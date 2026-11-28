import JSZip from 'jszip';
import type {
  CalloutBlock,
  CalloutVariant,
  ChapterMetaItem,
  ChapterNode,
  ContentBlock,
  FootnoteEntry,
  GlossaryEntry,
  ParsedBook,
  SectionNode,
  SourceFileFormat,
  TableBlock,
  VolumeNode,
} from './bookTypes.ts';
import { scrubRawSourceArtifacts } from './universalSystemPrompt.ts';
import {
  resolveUploadedMediaUrl,
  stitchAndEnrichParsedBookTables,
} from './tableStitcherAndConsolidator.ts';
import { convertRawWinolsTablesToMarkdown } from './winolsTableDetector.ts';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toPersianDigits(input: number | string): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function toAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function cleanDirectionalMarks(text: string): string {
  return text.replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, '').trim();
}

export function detectCalloutVariant(title: string): CalloutVariant {
  if (/⛔|هشدار|ممنوع|خط قرمز|بحرانی|الزام کلیدی/.test(title)) return 'warning';
  if (/❓|پرسش و پاسخ|سؤال|سوال/.test(title)) return 'qa';
  if (/🔄|اصلاحیه|تدقیق|تحلیل بازار/.test(title)) return 'revision';
  if (/⚙️|نکتهٔ? مهندسی|برگهٔ? تقلب|کدهای|پیدا کردن|نسخه ویژه/.test(title)) return 'engineering';
  if (/📘|پروژه|جمع‌بندی|نقشهٔ راه/.test(title)) return 'project';
  if (/💡|مبانی علمی|پیش‌نیاز|قانون طلایی/.test(title)) return 'concept';
  return 'general';
}

export function formatReadableEquation(rawLatex: string): string {
  let s = rawLatex.trim();
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\text\{([^}]*)\}/g, '$1');
  s = s.replace(/\\mathrm\{([^}]*)\}/g, '$1');
  s = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1) ÷ ($2)');
  s = s.replace(/\\times/g, ' × ');
  s = s.replace(/([0-9a-zA-Z\)])\s*imes\s*([0-9a-zA-Z\(])/g, '$1 × $2');
  s = s.replace(/Δheta/g, 'Δθ');
  s = s.replace(/\\Delta/g, 'Δ');
  s = s.replace(/\\theta/g, 'θ');
  s = s.replace(/\\lambda/g, 'λ');
  s = s.replace(/\\approx/g, ' ≈ ');
  s = s.replace(/\\le/g, ' ≤ ');
  s = s.replace(/\\ge/g, ' ≥ ');
  s = s.replace(/\\cdot/g, ' · ');
  s = s.replace(/\\pm/g, ' ± ');
  s = s.replace(/\\rightarrow|\\to/g, ' → ');
  s = s.replace(/\\left|\\right/g, '');
  s = s.replace(/\{|\}/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  const cells = splitMarkdownTableRow(t);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function stripOuterBold(text: string): string {
  const t = text.trim();
  if (t.startsWith('**') && t.endsWith('**') && t.indexOf('**', 2) === t.length - 2) {
    return t.slice(2, -2).trim();
  }
  return t;
}

function parseCalloutCellContent(rawCell: string, id: string): CalloutBlock {
  const cleaned = cleanDirectionalMarks(rawCell).replace(/<br\s*\/?>/gi, '\n');
  // Split into title and body; source often uses "**Title**  Body..."
  let title = '';
  let rest = cleaned;

  const boldStart = cleaned.match(/^\*\*([^*]+)\*\*\s*(.*)$/s);
  if (boldStart) {
    title = boldStart[1].trim();
    rest = boldStart[2].trim();
  } else {
    const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    title = lines[0] || 'نکته فنی';
    rest = lines.slice(1).join('\n');
  }

  // Split remaining text on double spaces or newlines where distinct sub-paragraphs exist
  const rawParas = rest
    .split(/\n+|\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // If the first paragraph is also bolded as a sub-header (e.g. "**۱. نسبت سوخت...**"), keep it nicely
  const variant = detectCalloutVariant(title);
  return {
    type: 'callout',
    id,
    variant,
    title,
    paragraphs: rawParas.length > 0 ? rawParas : [title],
  };
}

function isChapterMetaTable(headers: string[], rows: string[][]): boolean {
  if (headers.length !== 2) return false;
  const h0 = stripOuterBold(headers[0]);
  const h1 = stripOuterBold(headers[1]);
  if (h0 === 'قلم' && h1 === 'مقدار') return true;
  return rows.some((r) => stripOuterBold(r[0] || '') === 'مجلد' || stripOuterBold(r[0] || '') === 'حجم');
}

export function extractFootnoteTermKey(rawText: string): string {
  const clean = cleanDirectionalMarks(rawText)
    .replace(/^\d+\.\s+/, '')
    .replace(/\s*\[↑\]\(#footnote-ref-\d+\)\s*$/, '')
    .replace(/\*\*/g, '')
    .trim();

  // Extract headword before :, ؛, —, –, or Persian "یا"
  const head = clean.split(/[:؛—–]|\s+یا\s+/)[0] || clean;
  const normalized = head
    .replace(/\([^)]*\)/g, '')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return normalized.slice(0, 48) || clean.slice(0, 32).toLowerCase();
}

/**
 * Cleans messy/unstructured Persian ECU remap notes (copied from Telegram, rough Word drafts,
 * raw OCR/voice transcripts) without altering a single hex address, calibration number, or table cell.
 * Also promotes standalone Persian lesson/chapter headings ("درس ۱:", "فصل ۲ -", "جلسه 82:")
 * into structured Markdown headings when the input file has few or no explicit `#` headings.
 */
export function preprocessMessyRemapText(rawContent: string): string {
  const scrubbed = scrubRawSourceArtifacts(rawContent);
  const normalized = scrubbed
    // Strip invisible directional junk while strictly keeping Persian ZWNJ (\u200c)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    // Collapse 4+ blank lines into 2
    .replace(/\n{4,}/g, '\n\n\n');

  const lines = normalized.split('\n');
  let explicitH1Count = 0;
  for (const l of lines) {
    if (/^#\s+/.test(l.trim())) {
      explicitH1Count++;
      if (explicitH1Count >= 2) break;
    }
  }

  // If the file already uses real Markdown # headings, preserve structure as-is (only fix "### درس X" promotion if zero H1)
  if (explicitH1Count >= 2) {
    return normalized;
  }

  const PERSIAN_ORDINAL_OR_NUM =
    '(?:[۰-۹0-9]+|صفر|اول|یکم|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|یازدهم|دوازدهم|سیزدهم|چهاردهم|پانزدهم|شانزدهم|هفدهم|هجدهم|نوزدهم|بیستم)';
  const h2ToH1Re = new RegExp(`^#{2,4}\\s+(?:درس|فصل|جلسه|فاز)\\s+${PERSIAN_ORDINAL_OR_NUM}`);
  const plainHeadingRe = new RegExp(
    `^(?:\\*\\*)?(?:درس|فصل|جلسه|فاز|بخش)\\s+${PERSIAN_ORDINAL_OR_NUM}(?:\\s*[:：\\-—–(]|\\s+[\\u0600-\\u06FFA-Za-z])`
  );
  const strictColonHeadingRe = new RegExp(
    `^(?:\\*\\*)?(?:درس|فصل|جلسه|فاز)\\s+${PERSIAN_ORDINAL_OR_NUM}\\s*[:：\\-—–]`
  );

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Promote "### درس 8 (فصل هشتم ...)" to H1 when file has zero H1 headings (like real multi-part split notebooks)
    if (explicitH1Count === 0 && h2ToH1Re.test(trimmed) && trimmed.length <= 220) {
      out.push(`# ${trimmed.replace(/^#{2,4}\s+/, '')}`);
      continue;
    }

    // Promote plain unstructured chapter/lesson/phase lines in messy TXT/Word/Pandoc notes (not inside tables or bullet lists)
    if (
      explicitH1Count === 0 &&
      !trimmed.startsWith('|') &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('* ') &&
      trimmed.length >= 6 &&
      trimmed.length <= 160 &&
      plainHeadingRe.test(trimmed) &&
      !/[.؟!]$/.test(trimmed)
    ) {
      const prevEmpty =
        i === 0 || lines[i - 1].trim() === '' || strictColonHeadingRe.test(trimmed);
      if (prevEmpty) {
        const cleanTitle = trimmed.replace(/^\*\*|\*\*$/g, '').trim();
        const isSubSection = /^(?:\*\*)?بخش\s+/.test(trimmed);
        out.push(`${isSubSection ? '##' : '#'} ${cleanTitle}`);
        continue;
      }
    }

    out.push(raw);
  }

  return convertRawWinolsTablesToMarkdown(out.join('\n')).markdown;
}

export function parseMarkdownDocument(rawContent: string, fileName: string): ParsedBook {
  const prepared = preprocessMessyRemapText(rawContent);
  const lines = prepared.split('\n');

  let bookTitle = fileName.replace(/\.(md|txt|docx|json)$/i, '');
  let bookSubtitle = 'نسخه مهندسی، ساختاریافته و یکپارچه برای نشر حرفه‌ای در مایکروسافت ورد';

  // Detect title from front matter before first volume/chapter heading
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = cleanDirectionalMarks(lines[i]);
    if (!line || line.startsWith('[')) continue;
    if (line.startsWith('#')) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1 && !/^مجلد\s/.test(h1[1].trim())) {
        const cleanedH1 = stripOuterBold(h1[1])
          .replace(/^فصل\s+[۰-۹0-9]+\s*[:：—–-]\s*/, '')
          .trim();
        if (cleanedH1.length >= 3 && cleanedH1.length <= 120) {
          bookTitle = cleanedH1;
        }
      }
      break;
    }
    if (line.length >= 10 && line.length <= 120 && !line.includes('#_Toc')) {
      bookTitle = stripOuterBold(line);
      break;
    }
  }

  // Title and subtitle remain strictly derived from the uploaded document headings or file name.

  const volumes: VolumeNode[] = [];
  const chapters: ChapterNode[] = [];
  const footnotes: FootnoteEntry[] = [];
  const glossary: GlossaryEntry[] = [];
  const sourceMapRows: string[][] = [];

  let currentVolume: VolumeNode | null = null;
  let currentChapter: ChapterNode | null = null;
  let currentSection: SectionNode | null = null;
  let pendingCaption: string | undefined;
  let blockSeq = 0;

  let mode: 'front' | 'body' | 'appendix_glossary' | 'appendix_tables' | 'appendix_sources' = 'front';

  const nextId = (prefix: string) => `${prefix}_${++blockSeq}`;

  const ensureDefaultChapter = () => {
    if (!currentVolume) {
      currentVolume = {
        id: 'vol_1',
        index: 1,
        title: 'بخش اصلی سند',
      };
      volumes.push(currentVolume);
    }
    if (!currentChapter) {
      currentChapter = {
        id: `ch_${chapters.length + 1}`,
        chapterNumber: chapters.length + 1,
        title: bookTitle,
        volumeIndex: currentVolume.index,
        volumeTitle: currentVolume.title,
        meta: [],
        introBlocks: [],
        sections: [],
        sourceFileName: fileName,
      };
      chapters.push(currentChapter);
    }
  };

  const pushBlock = (block: ContentBlock) => {
    ensureDefaultChapter();
    if (currentSection) {
      currentSection.blocks.push(block);
    } else {
      currentChapter!.introBlocks.push(block);
    }
  };

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = cleanDirectionalMarks(rawLine);

    // Detect end-of-document markdown footnotes: "1. Text... [↑](#footnote-ref-1)"
    const fnMatch = line.match(/^(\d+)\.\s+(.+?)\s*\[↑\]\(#footnote-ref-(\d+)\)\s*$/);
    if (fnMatch) {
      const fnId = Number(fnMatch[1]);
      const fnBody = fnMatch[2].trim();
      footnotes.push({
        id: fnId,
        canonicalId: fnId,
        termKey: extractFootnoteTermKey(fnBody),
        text: fnBody,
        chapters: [],
      });
      i++;
      continue;
    }

    // Skip manual TOC links in front matter
    if (mode === 'front') {
      if (/^#\s+/.test(line)) {
        mode = 'body';
        // Fall through to process this heading
      } else if (
        line === '' ||
        /^\[.+\]\(#_Toc\d+\)$/.test(line) ||
        /^فهرست مطالب/.test(line) ||
        /^فهرست/.test(line)
      ) {
        i++;
        continue;
      } else {
        // Non-TOC real content before first H1 (for user-uploaded general markdown files)
        const hasAnyH1 = lines.slice(i, Math.min(lines.length, i + 400)).some((l) => /^#\s+/.test(l.trim()));
        const looksLikeManualToc = lines
          .slice(i, Math.min(lines.length, i + 30))
          .some((l) => l.includes('#_Toc'));
        if (looksLikeManualToc && hasAnyH1) {
          i++;
          continue;
        }
        mode = 'body';
      }
    }

    // Empty line
    if (!line) {
      i++;
      continue;
    }

    // H1 Headings: Volumes, Chapters, or Appendices
    if (/^#\s+/.test(line)) {
      const headingText = line.replace(/^#\s+/, '').trim();
      pendingCaption = undefined;

      if (/^پیوست\s+الف|^واژه‌نامه/.test(headingText)) {
        mode = 'appendix_glossary';
        i++;
        continue;
      }
      if (/^پیوست\s+ب|^فهرست\s+جداول/.test(headingText)) {
        mode = 'appendix_tables';
        i++;
        continue;
      }
      if (/^پیوست\s+ج|^نقشهٔ?\s+منابع/.test(headingText)) {
        mode = 'appendix_sources';
        i++;
        continue;
      }

      mode = 'body';

      // Volume divider?
      if (/^(مجلد|جلد|بخش\s+بزرگ|دفتر)\s/.test(headingText)) {
        const volIdx = volumes.length + 1;
        currentVolume = {
          id: `vol_${volIdx}`,
          index: volIdx,
          title: headingText,
        };
        volumes.push(currentVolume);
        currentChapter = null;
        currentSection = null;
        i++;
        continue;
      }

      // Otherwise treat H1 as Chapter
      if (!currentVolume) {
        currentVolume = {
          id: 'vol_1',
          index: 1,
          title: 'مجلد یکم — متن اصلی',
        };
        volumes.push(currentVolume);
      }

      const chNumMatch = toAsciiDigits(headingText).match(/فصل\s+(\d+)/);
      const chapterNumber = chNumMatch ? Number(chNumMatch[1]) : chapters.length + 1;
      currentChapter = {
        id: `ch_${chapters.length + 1}`,
        chapterNumber,
        title: headingText,
        volumeIndex: currentVolume.index,
        volumeTitle: currentVolume.title,
        meta: [],
        introBlocks: [],
        sections: [],
        sourceFileName: fileName,
      };
      chapters.push(currentChapter);
      currentSection = null;
      i++;
      continue;
    }

    // Handle appendices tables
    if (mode === 'appendix_glossary') {
      if (line.startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const cols = splitMarkdownTableRow(lines[i]);
          if (cols.length >= 2) {
            const term = stripOuterBold(cleanDirectionalMarks(cols[0]));
            const def = cleanDirectionalMarks(cols[1]);
            const chNum = Number(toAsciiDigits(cols[2] || '').match(/\d+/)?.[0] || 0);
            if (term && def) {
              glossary.push({
                term,
                definition: def,
                chapters: chNum ? [chNum] : [],
              });
            }
          }
          i++;
        }
        continue;
      }
      i++;
      continue;
    }

    if (mode === 'appendix_tables') {
      // We regenerate the authoritative List of Tables directly from parsed tables!
      i++;
      continue;
    }

    if (mode === 'appendix_sources') {
      if (line.startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const cols = splitMarkdownTableRow(lines[i]).map((c) => stripOuterBold(cleanDirectionalMarks(c)));
          if (cols.length >= 2) {
            sourceMapRows.push(cols);
          }
          i++;
        }
        continue;
      }
      i++;
      continue;
    }

    // H2 Section headings
    if (/^##\s+/.test(line)) {
      ensureDefaultChapter();
      pendingCaption = undefined;
      const rawTitle = line.replace(/^##\s+/, '').trim();
      const numMatch = rawTitle.match(/^([۰-۹0-9]+[-–][۰-۹0-9]+)\.?\s*(.*)$/);
      const numberLabel = numMatch ? numMatch[1] : '';
      const cleanTitle = numMatch ? numMatch[2].trim() : rawTitle;

      currentSection = {
        id: nextId('sec'),
        numberLabel,
        title: cleanTitle || rawTitle,
        originalTitle: rawTitle,
        wasUnnumbered: !numMatch,
        blocks: [],
      };
      currentChapter!.sections.push(currentSection);
      i++;
      continue;
    }

    // H3 / H4 Subheadings
    if (/^###\s+/.test(line) || /^####\s+/.test(line)) {
      const level: 3 | 4 = line.startsWith('####') ? 4 : 3;
      const text = line.replace(/^#{3,4}\s+/, '').trim();
      pendingCaption = undefined;
      pushBlock({
        type: 'subheading',
        id: nextId('sub'),
        level,
        text,
      });
      i++;
      continue;
    }

    // Skip standalone "**شناسنامهٔ فصل**" heading right before chapter metadata table
    if (/^\*\*شناسنامهٔ?\s+فصل\*\*$/.test(line) || /^شناسنامهٔ?\s+فصل$/.test(line)) {
      i++;
      continue;
    }

    // Table caption line immediately before a table
    if (/^\*\*جدول\s/.test(line) || /^جدول\s+[۰-۹0-9]+[-–][۰-۹0-9]+/.test(line)) {
      const nextNonEmpty = lines.slice(i + 1, i + 5).find((l) => l.trim().length > 0);
      if (nextNonEmpty && nextNonEmpty.trim().startsWith('|')) {
        pendingCaption = stripOuterBold(line);
        i++;
        continue;
      }
    }

    // Markdown Tables (either single-cell Callout Box or real multi-column Data Table)
    if (line.startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headerCells = splitMarkdownTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitMarkdownTableRow(lines[i]));
        i++;
      }

      // Single-cell callout table: |  | \n | --- | \n | **💡 ...** |
      if (headerCells.length === 1 && headerCells[0] === '' && rows.length >= 1) {
        const mergedCell = rows.map((r) => r[0] || '').join('\n').trim();
        if (mergedCell) {
          pushBlock(parseCalloutCellContent(mergedCell, nextId('cal')));
        }
        pendingCaption = undefined;
        continue;
      }

      // Chapter metadata table
      if (currentChapter && !currentSection && isChapterMetaTable(headerCells, rows)) {
        const meta: ChapterMetaItem[] = rows
          .filter((r) => r.length >= 2)
          .map((r) => ({
            label: stripOuterBold(cleanDirectionalMarks(r[0])),
            value: cleanDirectionalMarks(r[1]),
          }));
        currentChapter.meta.push(...meta);
        pendingCaption = undefined;
        continue;
      }

      // Regular engineering/data table
      const cleanHeaders = headerCells.map((h) => stripOuterBold(cleanDirectionalMarks(h)));
      const cleanRows = rows.map((r) => {
        const padded = [...r];
        while (padded.length < cleanHeaders.length) padded.push('');
        return padded.slice(0, cleanHeaders.length).map((c) => cleanDirectionalMarks(c));
      });

      const tableBlock: TableBlock = {
        type: 'table',
        id: nextId('tbl'),
        caption: pendingCaption,
        originalCaption: pendingCaption,
        headers: cleanHeaders,
        rows: cleanRows,
      };
      pendingCaption = undefined;
      pushBlock(tableBlock);
      continue;
    }

    // Display Equation $$ ... $$
    if (line.startsWith('$$')) {
      let eqContent = line.slice(2);
      if (eqContent.endsWith('$$') && eqContent.length >= 2) {
        eqContent = eqContent.slice(0, -2);
      } else {
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          eqContent += ' ' + lines[i].trim();
          i++;
        }
        if (i < lines.length) {
          eqContent += ' ' + lines[i].trim().replace(/\$\$$/, '');
        }
      }
      const latex = eqContent.trim();
      if (latex) {
        pushBlock({
          type: 'equation',
          id: nextId('eq'),
          latex,
          readable: formatReadableEquation(latex),
        });
      }
      i++;
      continue;
    }

    // Markdown Image: ![alt](src) optionally followed by inline caption text (e.g. ![](j34_files/media/image1.png)جدول جرقه قبل از تغییرات)
    const mdImgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*(.*)$/);
    if (mdImgMatch) {
      const altText = mdImgMatch[1].trim();
      const rawSrc = mdImgMatch[2].trim();
      const trailingCaption = mdImgMatch[3].trim();
      const resolvedUrl = resolveUploadedMediaUrl(rawSrc);
      const caption =
        trailingCaption ||
        altText ||
        `تصویر جدول کالیبراسیون (${rawSrc.split('/').pop() || 'تصویر فنی'})`;
      pushBlock({
        type: 'image',
        id: nextId('img'),
        dataUrl: resolvedUrl,
        mimeType: resolvedUrl.toLowerCase().endsWith('.jpg') || resolvedUrl.toLowerCase().endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/png',
        caption,
      });
      i++;
      continue;
    }

    // Figure placeholder: [تصویر مهندسی: ...]
    const figMatch = line.match(/^\[تصویر[^\]]*:\s*([^\]]+)\]$/);
    if (figMatch) {
      pushBlock({
        type: 'figure',
        id: nextId('fig'),
        caption: 'تصویر فنی پیشنهادی',
        description: figMatch[1].trim(),
      });
      i++;
      continue;
    }

    // Unordered or ordered lists
    if (/^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const l = cleanDirectionalMarks(lines[i]);
        if (ordered && /^\d+[.)]\s+/.test(l)) {
          items.push(l.replace(/^\d+[.)]\s+/, '').trim());
          i++;
        } else if (!ordered && /^[-*•]\s+/.test(l)) {
          items.push(l.replace(/^[-*•]\s+/, '').trim());
          i++;
        } else {
          break;
        }
      }
      if (items.length > 0) {
        pushBlock({
          type: 'list',
          id: nextId('lst'),
          ordered,
          items,
        });
      }
      continue;
    }

    // Regular paragraph
    pushBlock({
      type: 'paragraph',
      id: nextId('p'),
      text: line,
    });
    i++;
  }

  // Automatically stitch broken multi-fragment tables, merge wrapped continuation rows, normalize RTL columns, and enrich Valeo J34 image tables
  stitchAndEnrichParsedBookTables(chapters);

  return {
    title: bookTitle,
    subtitle: bookSubtitle,
    editionNote: 'تولید و صفحه‌آرایی‌شده با موتور یکپارچه‌سازی اسناد فنی فارسی (فونت وزیر مدیوم · راست‌چین استاندارد)',
    sourceFiles: [fileName],
    volumes,
    chapters,
    footnotes,
    glossary,
    tableIndex: [],
    cheatSheets: [],
    visualSuggestions: [],
    sourceMapRows,
  };
}

// ============================================================================
// REAL .DOCX PARSER (Pure XML + JSZip — works in Browser AND Node.js!)
// ============================================================================

function decodeXmlEntities(str: string): string {
  const safeFromCodePoint = (cp: number, fallback: string): string => {
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return fallback;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return fallback;
    }
  };
  return str
    .replace(/&#(\d+);/g, (match, num) => safeFromCodePoint(Number.parseInt(num, 10), match))
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => safeFromCodePoint(Number.parseInt(hex, 16), match))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTextFromWXml(xmlChunk: string, preserveInlineBold = false): string {
  // Strip nested Word textboxes when extracting main paragraph text (they are extracted separately as callouts)
  const sanitizedChunk = xmlChunk.replace(/<w:txbxContent[\s>][\s\S]*?<\/w:txbxContent>/g, '');

  if (!preserveInlineBold) {
    const parts: string[] = [];
    const tokenRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s+[^>]*)?\/>/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(sanitizedChunk)) !== null) {
      if (match[1] !== undefined) {
        parts.push(decodeXmlEntities(match[1]));
      } else if (match[0].startsWith('<w:tab')) {
        parts.push(' ');
      } else {
        parts.push('\n');
      }
    }
    return cleanDirectionalMarks(parts.join(''));
  }

  // Run-aware extraction that preserves inline bold emphasis (<w:b/> or <w:bCs/>) when mixed with normal text
  const runMatches = sanitizedChunk.match(/<w:r(?:\s+[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
  if (runMatches.length === 0) {
    return extractTextFromWXml(sanitizedChunk, false);
  }

  const runs: Array<{ text: string; bold: boolean }> = [];
  for (const rXml of runMatches) {
    const rPrMatch = rXml.match(/<w:rPr[\s>][\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : '';
    const isBold =
      /(?:<w:b\s*\/>|<w:b\s+w:val="(?:1|true)"\s*\/>|<w:bCs\s*\/>|<w:bCs\s+w:val="(?:1|true)"\s*\/>)/i.test(
        rPr
      ) && !/<w:b\s+w:val="(?:0|false)"\s*\/>/i.test(rPr);

    const runText = extractTextFromWXml(rXml, false);
    if (!runText) continue;
    const prev = runs[runs.length - 1];
    if (prev && prev.bold === isBold) {
      prev.text += runText;
    } else {
      runs.push({ text: runText, bold: isBold });
    }
  }

  const allBold = runs.length > 0 && runs.every((r) => r.bold);
  const combined = runs
    .map((r) => {
      if (!r.bold || allBold) return r.text;
      const trimmed = r.text.trim();
      if (trimmed.length < 2) return r.text;
      const leadSpace = r.text.match(/^\s*/)?.[0] || '';
      const trailSpace = r.text.match(/\s*$/)?.[0] || '';
      return `${leadSpace}**${trimmed}**${trailSpace}`;
    })
    .join('');

  return cleanDirectionalMarks(combined);
}

/**
 * Resolves heading outline levels (0..3 -> H1..H4) from word/styles.xml including custom
 * Persian styles and style inheritance (<w:basedOn>).
 */
function parseDocxHeadingStylesMap(stylesXml: string): Map<string, number> {
  const directLevel = new Map<string, number>();
  const basedOnMap = new Map<string, string>();
  const styleBlocks = stylesXml.match(/<w:style\s+[^>]*>[\s\S]*?<\/w:style>/g) || [];

  for (const sb of styleBlocks) {
    const idMatch = sb.match(/w:styleId="([^"]+)"/);
    if (!idMatch) continue;
    const styleId = idMatch[1];
    const nameMatch = sb.match(/<w:name\s+w:val="([^"]+)"/);
    const styleName = (nameMatch ? nameMatch[1] : '').toLowerCase();
    const basedOnMatch = sb.match(/<w:basedOn\s+w:val="([^"]+)"/);
    if (basedOnMatch) basedOnMap.set(styleId, basedOnMatch[1]);

    const outlineMatch = sb.match(/<w:outlineLvl\s+w:val="(\d+)"/);
    if (outlineMatch) {
      const lvl = Number(outlineMatch[1]);
      if (lvl >= 0 && lvl <= 3) {
        directLevel.set(styleId, lvl);
        continue;
      }
    }

    if (/^heading\s*1$|^title$|^عنوان\s*[1۱]$|^سرفصل\s*[1۱]?$/i.test(styleName)) {
      directLevel.set(styleId, 0);
    } else if (/^heading\s*2$|^عنوان\s*[2۲]$/i.test(styleName)) {
      directLevel.set(styleId, 1);
    } else if (/^heading\s*3$|^عنوان\s*[3۳]$/i.test(styleName)) {
      directLevel.set(styleId, 2);
    } else if (/^heading\s*4$|^عنوان\s*[4۴]$/i.test(styleName)) {
      directLevel.set(styleId, 3);
    }
  }

  // Follow basedOn chains up to depth 5
  const resolved = new Map<string, number>(directLevel);
  for (const styleId of basedOnMap.keys()) {
    if (resolved.has(styleId)) continue;
    let curr: string | undefined = basedOnMap.get(styleId);
    for (let hop = 0; hop < 5 && curr; hop++) {
      if (directLevel.has(curr)) {
        resolved.set(styleId, directLevel.get(curr)!);
        break;
      }
      curr = basedOnMap.get(curr);
    }
  }
  return resolved;
}

/**
 * Resolves OOXML numId -> 'ordered' | 'bullet' from word/numbering.xml so procedural
 * lists in Word documents survive merging as true ordered/unordered lists.
 */
function parseDocxNumberingFormatMap(numberingXml: string): Map<string, 'ordered' | 'bullet'> {
  const abstractFmt = new Map<string, 'ordered' | 'bullet'>();
  const absBlocks = numberingXml.match(/<w:abstractNum\s+[^>]*>[\s\S]*?<\/w:abstractNum>/g) || [];
  for (const ab of absBlocks) {
    const idMatch = ab.match(/w:abstractNumId="(\d+)"/);
    if (!idMatch) continue;
    const fmtMatch = ab.match(/<w:numFmt\s+w:val="([^"]+)"/);
    const fmt = (fmtMatch ? fmtMatch[1] : 'bullet').toLowerCase();
    abstractFmt.set(idMatch[1], fmt === 'bullet' || fmt === 'none' ? 'bullet' : 'ordered');
  }

  const numMap = new Map<string, 'ordered' | 'bullet'>();
  const numBlocks = numberingXml.match(/<w:num\s+[^>]*>[\s\S]*?<\/w:num>/g) || [];
  for (const nb of numBlocks) {
    const numIdMatch = nb.match(/w:numId="(\d+)"/);
    const absRefMatch = nb.match(/<w:abstractNumId\s+w:val="(\d+)"/);
    if (numIdMatch && absRefMatch) {
      numMap.set(numIdMatch[1], abstractFmt.get(absRefMatch[1]) || 'bullet');
    }
  }
  return numMap;
}

function extractTopLevelElements(bodyXml: string): Array<{ tag: 'p' | 'tbl'; xml: string }> {
  const results: Array<{ tag: 'p' | 'tbl'; xml: string }> = [];
  let pos = 0;
  while (pos < bodyXml.length) {
    const nextP = bodyXml.indexOf('<w:p', pos);
    const nextTbl = bodyXml.indexOf('<w:tbl', pos);
    const pValid = nextP !== -1 && /[\s>]/.test(bodyXml[nextP + 4] || '');
    const tblValid = nextTbl !== -1 && /[\s>]/.test(bodyXml[nextTbl + 6] || '');

    let start = -1;
    let tag: 'p' | 'tbl' = 'p';
    if (pValid && (!tblValid || nextP < nextTbl)) {
      start = nextP;
      tag = 'p';
    } else if (tblValid) {
      start = nextTbl;
      tag = 'tbl';
    } else {
      if (nextP !== -1 || nextTbl !== -1) {
        pos = Math.min(nextP === -1 ? Infinity : nextP, nextTbl === -1 ? Infinity : nextTbl) + 4;
        continue;
      }
      break;
    }

    // Track nesting depth for <w:tbl> or <w:p>
    const openToken = `<w:${tag}`;
    const closeToken = `</w:${tag}>`;
    let depth = 0;
    let cursor = start;
    while (cursor < bodyXml.length) {
      const oIdx = bodyXml.indexOf(openToken, cursor);
      const cIdx = bodyXml.indexOf(closeToken, cursor);
      if (cIdx === -1) {
        cursor = bodyXml.length;
        break;
      }
      if (oIdx !== -1 && oIdx < cIdx && /[\s>]/.test(bodyXml[oIdx + openToken.length] || '')) {
        // Check self-closing
        const tagEnd = bodyXml.indexOf('>', oIdx);
        if (tagEnd !== -1 && bodyXml[tagEnd - 1] === '/') {
          cursor = tagEnd + 1;
          if (depth === 0) {
            results.push({ tag, xml: bodyXml.slice(start, cursor) });
            break;
          }
          continue;
        }
        depth++;
        cursor = oIdx + openToken.length;
      } else {
        depth--;
        cursor = cIdx + closeToken.length;
        if (depth <= 0) {
          results.push({ tag, xml: bodyXml.slice(start, cursor) });
          break;
        }
      }
    }
    pos = cursor;
  }
  return results;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function parseOoxmlChartXml(
  chartXml: string,
  fallbackTitle: string
): { title: string; items: Array<{ label: string; value: number; detail?: string }> } | null {
  // Extract chart title from <c:title>...<a:t>...</a:t>
  const titleBlockMatch = chartXml.match(/<c:title[\s>][\s\S]*?<\/c:title>/);
  const titleParts = titleBlockMatch
    ? Array.from(titleBlockMatch[0].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) =>
        decodeXmlEntities(m[1]).trim()
      )
    : [];
  const title = titleParts.filter(Boolean).join(' ').trim() || fallbackTitle;

  // Parse first quantitative series (<c:ser>) categories (<c:cat>/<c:xVal>) and values (<c:val>/<c:yVal>)
  const serMatches = chartXml.match(/<c:ser[\s>][\s\S]*?<\/c:ser>/g) || [];
  for (const serXml of serMatches) {
    const serNameMatch = serXml.match(/<c:tx[\s>][\s\S]*?<c:v[^>]*>([\s\S]*?)<\/c:v>/);
    const seriesUnitOrName = serNameMatch ? decodeXmlEntities(serNameMatch[1]).trim() : undefined;

    const catBlockMatch =
      serXml.match(/<c:cat[\s>][\s\S]*?<\/c:cat>/) || serXml.match(/<c:xVal[\s>][\s\S]*?<\/c:xVal>/);
    const valBlockMatch =
      serXml.match(/<c:val[\s>][\s\S]*?<\/c:val>/) || serXml.match(/<c:yVal[\s>][\s\S]*?<\/c:yVal>/);
    if (!valBlockMatch) continue;

    const extractPts = (xml: string): Map<number, string> => {
      const map = new Map<number, string>();
      const ptRx = /<c:pt\s+idx="(\d+)"[^>]*>[\s\S]*?<c:v[^>]*>([\s\S]*?)<\/c:v>[\s\S]*?<\/c:pt>/g;
      let m: RegExpExecArray | null;
      while ((m = ptRx.exec(xml)) !== null) {
        map.set(Number(m[1]), decodeXmlEntities(m[2]).trim());
      }
      return map;
    };

    const catPts = catBlockMatch ? extractPts(catBlockMatch[0]) : new Map<number, string>();
    const valPts = extractPts(valBlockMatch[0]);
    const items: Array<{ label: string; value: number; detail?: string }> = [];

    const sortedIndices = Array.from(valPts.keys()).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
      const rawVal = toAsciiDigits(valPts.get(idx) || '').replace(/,/g, '');
      const numVal = Number(rawVal);
      if (!Number.isFinite(numVal)) continue;
      const label = catPts.get(idx) || `نقطه ${toPersianDigits(idx + 1)}`;
      items.push({
        label,
        value: numVal,
        ...(seriesUnitOrName ? { detail: seriesUnitOrName } : {}),
      });
    }

    if (items.length >= 2) {
      return { title, items };
    }
  }
  return null;
}

export async function parseDocxDocument(buffer: ArrayBuffer | Uint8Array, fileName: string): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error(`فایل ورد معتبر نیست (word/document.xml در ${fileName} یافت نشد).`);
  }
  const docXml = await docFile.async('string');
  const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  const bodyXml = bodyMatch ? bodyMatch[1] : docXml;

  // Resolve custom Persian/inherited Heading styles from word/styles.xml
  const stylesFile = zip.file('word/styles.xml');
  const styleHeadingMap = stylesFile
    ? parseDocxHeadingStylesMap(await stylesFile.async('string'))
    : new Map<string, number>();

  // Resolve ordered vs bullet list formats from word/numbering.xml
  const numberingFile = zip.file('word/numbering.xml');
  const numberingFormatMap = numberingFile
    ? parseDocxNumberingFormatMap(await numberingFile.async('string'))
    : new Map<string, 'ordered' | 'bullet'>();

  // Map relationship IDs (rId -> word/media/imageX.png|jpg AND word/charts/chartX.xml)
  const relImageMap = new Map<string, { dataUrl: string; mimeType: 'image/png' | 'image/jpeg'; target: string }>();
  const relChartMap = new Map<
    string,
    { title: string; items: Array<{ label: string; value: number; detail?: string }> }
  >();
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    const relRx = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"[^>]*>/g;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relRx.exec(relsXml)) !== null) {
      const rId = relMatch[1];
      const target = relMatch[2].replace(/^\/+/, '');
      const fullPath = target.startsWith('word/') ? target : `word/${target}`;
      const lowerPath = fullPath.toLowerCase();

      if (/^word\/charts\/chart\d+\.xml$/.test(lowerPath)) {
        const chartFile = zip.file(fullPath);
        if (chartFile) {
          try {
            const chartXml = await chartFile.async('string');
            const parsedChart = parseOoxmlChartXml(chartXml, `نمودار استخراج‌شده از ${fileName}`);
            if (parsedChart) {
              relChartMap.set(rId, parsedChart);
            }
          } catch {
            // Ignore malformed chart XML
          }
        }
        continue;
      }

      if (!/\.(png|jpe?g)$/.test(lowerPath)) continue;
      const mediaFile = zip.file(fullPath);
      if (!mediaFile) continue;
      try {
        const bytes = await mediaFile.async('uint8array');
        // Keep reasonable image size (<= 2.5 MB each) to avoid blowing up JSON snapshots
        if (bytes.byteLength > 0 && bytes.byteLength <= 2_500_000) {
          const mimeType: 'image/png' | 'image/jpeg' = lowerPath.endsWith('.png')
            ? 'image/png'
            : 'image/jpeg';
          relImageMap.set(rId, {
            dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
            mimeType,
            target: fullPath,
          });
        }
      } catch {
        // Ignore unreadable media entry
      }
    }
  }

  const elements = extractTopLevelElements(bodyXml);
  const extractedImagesByMarker = new Map<
    string,
    { dataUrl: string; mimeType: 'image/png' | 'image/jpeg'; caption: string }
  >();
  const extractedChartsByMarker = new Map<
    string,
    { title: string; items: Array<{ label: string; value: number; detail?: string }> }
  >();

  const mdLines: string[] = [];
  const baseTitle = fileName.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim();
  let detectedHeading = false;
  let imageSeq = 0;
  let chartSeq = 0;
  const listCounters = new Map<string, number>();

  // Detect whether this DOCX uses a 3-tier Volume(H1)/Chapter(H2)/Section(H3) hierarchy (e.g. our exported books)
  const hasHeading3InDoc = elements.some((el) => {
    if (el.tag !== 'p') return false;
    const sm = el.xml.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const om = el.xml.match(/<w:outlineLvl\s+w:val="(\d+)"/);
    const st = sm ? sm[1] : '';
    const lv = styleHeadingMap.get(st);
    return /^Heading3$|^3$/i.test(st) || om?.[1] === '2' || lv === 2;
  });

  for (const el of elements) {
    if (el.tag === 'p') {
      // Extract ALL embedded images in this paragraph (modern DrawingML r:embed AND legacy VML v:imagedata r:id)
      const imgRefIds = new Set<string>();
      for (const m of el.xml.matchAll(/r:embed="([^"]+)"/g)) {
        if (relImageMap.has(m[1])) imgRefIds.add(m[1]);
      }
      for (const m of el.xml.matchAll(/<v:imagedata[^>]+r:id="([^"]+)"/g)) {
        if (relImageMap.has(m[1])) imgRefIds.add(m[1]);
      }
      const descrMatches = Array.from(el.xml.matchAll(/descr="([^"]+)"/g)).map((m) =>
        decodeXmlEntities(m[1]).trim()
      );
      let localImgIdx = 0;
      for (const rId of imgRefIds) {
        const imgAsset = relImageMap.get(rId)!;
        const marker = `DOCX_IMG_${++imageSeq}`;
        const caption =
          descrMatches[localImgIdx] ||
          `تصویر استخراج‌شده ${toPersianDigits(imageSeq)} از ${fileName}`;
        localImgIdx++;
        extractedImagesByMarker.set(marker, {
          dataUrl: imgAsset.dataUrl,
          mimeType: imgAsset.mimeType,
          caption,
        });
        mdLines.push(`[DOCX_IMAGE_TOKEN:${marker}]`, '');
      }

      // Extract native OOXML embedded Word charts (<c:chart r:id="..."/>)
      for (const m of el.xml.matchAll(/<c:chart[^>]+r:id="([^"]+)"/g)) {
        const chartAsset = relChartMap.get(m[1]);
        if (chartAsset) {
          const marker = `DOCX_CHART_${++chartSeq}`;
          extractedChartsByMarker.set(marker, chartAsset);
          mdLines.push(`[DOCX_CHART_TOKEN:${marker}]`, '');
        }
      }

      // Extract embedded Word TextBoxes (<w:txbxContent>) cleanly as callout boxes
      const txbxMatches = el.xml.match(/<w:txbxContent[\s>][\s\S]*?<\/w:txbxContent>/g) || [];
      for (const txbx of txbxMatches) {
        const tbParas = (txbx.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [])
          .map((p) => extractTextFromWXml(p, true).trim())
          .filter(Boolean);
        if (tbParas.length > 0) {
          const boxContent = tbParas.join('<br>').replace(/\|/g, '\\|');
          mdLines.push('|  |', '| --- |', `| ${boxContent} |`, '');
        }
      }

      const styleMatch = el.xml.match(/<w:pStyle\s+w:val="([^"]+)"/);
      const style = styleMatch ? styleMatch[1] : '';
      const outlineMatch = el.xml.match(/<w:outlineLvl\s+w:val="(\d+)"/);
      const resolvedStyleLevel = styleHeadingMap.get(style);

      const isHeading =
        /^Heading[1-4]$|^[1-4]$|^Title$/i.test(style) ||
        outlineMatch !== null ||
        resolvedStyleLevel !== undefined;

      const text = extractTextFromWXml(el.xml, !isHeading);
      if (!text) continue;
      // Skip TOC instruction field lines
      if (/\bTOC\b.*\\o/i.test(el.xml) || /^PAGEREF\s+_Toc/i.test(text)) continue;

      if (
        /^Heading1$|^1$|^Title$/i.test(style) ||
        outlineMatch?.[1] === '0' ||
        resolvedStyleLevel === 0
      ) {
        detectedHeading = true;
        mdLines.push(`# ${text}`, '');
      } else if (
        /^Heading2$|^2$/i.test(style) ||
        outlineMatch?.[1] === '1' ||
        resolvedStyleLevel === 1
      ) {
        detectedHeading = true;
        // In 3-tier books (H1=Volume, H2=Chapter, H3=Section) or explicit chapter prefixes, keep H2 as '#'; in 2-tier docs (H1=Chapter, H2=Section), map H2 to '##'
        const isChapterLevelH2 =
          hasHeading3InDoc ||
          /^(?:فصل|درس|روز|باب|Chapter|Lesson|Day|Module)\b/i.test(text) ||
          /^[\d۰-۹]+\s*[-–:]\s*(?:فصل|درس|روز)/i.test(text);
        mdLines.push(`${isChapterLevelH2 ? '#' : '##'} ${text}`, '');
      } else if (
        /^Heading3$|^3$/i.test(style) ||
        outlineMatch?.[1] === '2' ||
        resolvedStyleLevel === 2
      ) {
        mdLines.push(`### ${text}`, '');
      } else if (
        /^Heading4$|^4$/i.test(style) ||
        outlineMatch?.[1] === '3' ||
        resolvedStyleLevel === 3
      ) {
        mdLines.push(`#### ${text}`, '');
      } else {
        // Preserve OOXML Word numbered & bulleted lists (<w:numPr>)
        const numPrMatch = el.xml.match(/<w:numPr[\s>][\s\S]*?<\/w:numPr>/);
        if (numPrMatch) {
          const numIdMatch = numPrMatch[0].match(/<w:numId\s+w:val="(\d+)"/);
          const numId = numIdMatch ? numIdMatch[1] : '0';
          const listKind = numberingFormatMap.get(numId) || 'bullet';
          if (listKind === 'ordered') {
            const nextNum = (listCounters.get(numId) || 0) + 1;
            listCounters.set(numId, nextNum);
            mdLines.push(`${nextNum}. ${text}`);
          } else {
            mdLines.push(`- ${text}`);
          }
        } else {
          mdLines.push(text, '');
        }
      }
    } else if (el.tag === 'tbl') {
      const rowMatches = el.xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
      const tableRows: string[][] = [];
      const prevRowValues: string[] = [];

      for (const rXml of rowMatches) {
        const cellMatches = rXml.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) || [];
        const expandedRow: string[] = [];
        let colIdx = 0;

        for (const cXml of cellMatches) {
          const tcPrMatch = cXml.match(/<w:tcPr[\s>][\s\S]*?<\/w:tcPr>/);
          const tcPr = tcPrMatch ? tcPrMatch[0] : '';
          const gridSpanMatch = tcPr.match(/<w:gridSpan\s+w:val="(\d+)"/);
          const span = Math.max(1, Math.min(12, gridSpanMatch ? Number(gridSpanMatch[1]) : 1));
          const isVMergeContinue =
            /<w:vMerge\s*\/>/i.test(tcPr) || /<w:vMerge\s+w:val="continue"\s*\/>/i.test(tcPr);

          const pMatches = cXml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
          const pTexts = pMatches.map((p) => extractTextFromWXml(p, false)).filter(Boolean);
          let cellText = pTexts.join('  ').replace(/\|/g, '\\|');

          // Propagate vertically merged cell value down so pinout / map tables keep complete row context
          if (!cellText && isVMergeContinue && prevRowValues[colIdx]) {
            cellText = prevRowValues[colIdx];
          }

          for (let s = 0; s < span; s++) {
            const val = s === 0 ? cellText : '';
            expandedRow.push(val);
            if (cellText && s === 0) {
              prevRowValues[colIdx] = cellText;
            }
            colIdx++;
          }
        }
        if (expandedRow.length > 0) tableRows.push(expandedRow);
      }
      if (tableRows.length === 0) continue;

      if (tableRows.length === 1 && tableRows[0].length === 1) {
        // Treat 1x1 shaded/bordered box as a callout box!
        mdLines.push('|  |');
        mdLines.push('| --- |');
        mdLines.push(`| ${tableRows[0][0]} |`);
        mdLines.push('');
      } else {
        const colCount = Math.max(...tableRows.map((r) => r.length));
        const headers = tableRows[0].concat(Array(Math.max(0, colCount - tableRows[0].length)).fill(''));
        mdLines.push(`| ${headers.join(' | ')} |`);
        mdLines.push(`| ${headers.map(() => '---').join(' | ')} |`);
        for (const r of tableRows.slice(1)) {
          const padded = r.concat(Array(Math.max(0, colCount - r.length)).fill(''));
          mdLines.push(`| ${padded.join(' | ')} |`);
        }
        mdLines.push('');
      }
    }
  }

  // Extract footnotes if word/footnotes.xml exists
  const fnFile = zip.file('word/footnotes.xml');
  if (fnFile) {
    const fnXml = await fnFile.async('string');
    const fnMatches = fnXml.match(/<w:footnote\s+[^>]*w:id="(\d+)"[^>]*>[\s\S]*?<\/w:footnote>/g) || [];
    for (const fXml of fnMatches) {
      const idMatch = fXml.match(/w:id="(\d+)"/);
      const fnId = idMatch ? Number(idMatch[1]) : 0;
      if (fnId <= 0) continue;
      const text = extractTextFromWXml(fXml);
      if (text) {
        mdLines.push(`${fnId}. ${text} [↑](#footnote-ref-${fnId})`);
      }
    }
  }

  if (!detectedHeading) {
    mdLines.unshift(`# فصل ۱: ${baseTitle}`, '');
  }

  const parsed = parseMarkdownDocument(mdLines.join('\n'), fileName);

  // Hydrate [DOCX_IMAGE_TOKEN:...] and [DOCX_CHART_TOKEN:...] paragraphs into structured nodes
  const hydrateBlocks = (blocks: ContentBlock[]): ContentBlock[] =>
    blocks.map((block) => {
      if (block.type === 'paragraph') {
        const tokenMatch = block.text.match(/^\[DOCX_IMAGE_TOKEN:([^\]]+)\]$/);
        if (tokenMatch && extractedImagesByMarker.has(tokenMatch[1])) {
          const asset = extractedImagesByMarker.get(tokenMatch[1])!;
          return {
            type: 'image',
            id: `img_${tokenMatch[1]}`,
            dataUrl: asset.dataUrl,
            mimeType: asset.mimeType,
            caption: asset.caption,
            sourceFileNames: [fileName],
          };
        }
        const chartMatch = block.text.match(/^\[DOCX_CHART_TOKEN:([^\]]+)\]$/);
        if (chartMatch && extractedChartsByMarker.has(chartMatch[1])) {
          const chart = extractedChartsByMarker.get(chartMatch[1])!;
          return {
            type: 'diagram',
            id: `cht_${chartMatch[1]}`,
            kind: 'comparison_bars',
            title: chart.title,
            caption: chart.title,
            items: chart.items,
            svgMarkup: '',
            widthPx: 960,
            heightPx: 420,
            generatedBy: 'local',
            sourceFileNames: [fileName],
          };
        }
      }
      return block;
    });

  for (const ch of parsed.chapters) {
    ch.introBlocks = hydrateBlocks(ch.introBlocks);
    for (const sec of ch.sections) {
      sec.blocks = hydrateBlocks(sec.blocks);
    }
  }

  if (!parsed.title || parsed.title === fileName) {
    parsed.title = baseTitle;
  }
  return parsed;
}

// ============================================================================
// REAL .JSON PARSER (Structured Books, Transcripts, Arrays of Objects)
// ============================================================================

function jsonToMarkdown(data: unknown, fileName: string): { md: string; title: string; subtitle?: string } {
  const baseTitle = fileName.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').trim();
  const lines: string[] = [];

  if (Array.isArray(data)) {
    lines.push(`# فصل ۱: ${baseTitle}`, '');
    renderArrayAsMarkdown(data, lines, 2);
    return { md: lines.join('\n'), title: baseTitle };
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const title = String(obj.title || obj.name || obj.bookTitle || baseTitle);
    const subtitle =
      typeof obj.subtitle === 'string' && obj.subtitle.trim()
        ? obj.subtitle.trim()
        : typeof obj.description === 'string' && obj.description.trim()
          ? obj.description.trim()
          : undefined;

    if (Array.isArray(obj.chapters)) {
      obj.chapters.forEach((ch, idx) => {
        if (ch && typeof ch === 'object') {
          const c = ch as Record<string, unknown>;
          const cTitle = String(c.title || c.name || `بخش ${toPersianDigits(idx + 1)}`);
          lines.push(`# فصل ${toPersianDigits(idx + 1)}: ${cTitle.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '')}`, '');
          if (typeof c.summary === 'string') lines.push(c.summary, '');
          if (typeof c.content === 'string') lines.push(c.content, '');
          if (Array.isArray(c.sections)) {
            c.sections.forEach((sec, sIdx) => {
              if (sec && typeof sec === 'object') {
                const s = sec as Record<string, unknown>;
                const sTitle = String(s.title || s.heading || `زیربخش ${toPersianDigits(sIdx + 1)}`);
                lines.push(`## ${toPersianDigits(idx + 1)}-${toPersianDigits(sIdx + 1)}. ${sTitle}`, '');
                renderObjectFields(s, lines, ['title', 'heading']);
              } else if (typeof sec === 'string') {
                lines.push(sec, '');
              }
            });
          } else {
            renderObjectFields(c, lines, ['title', 'name', 'summary', 'content', 'sections']);
          }
        }
      });
      return { md: lines.join('\n'), title, subtitle };
    }

    if (Array.isArray(obj.sections)) {
      lines.push(`# فصل ۱: ${title}`, '');
      obj.sections.forEach((sec, sIdx) => {
        if (sec && typeof sec === 'object') {
          const s = sec as Record<string, unknown>;
          const sTitle = String(s.title || s.heading || `بخش ${toPersianDigits(sIdx + 1)}`);
          lines.push(`## ۱-${toPersianDigits(sIdx + 1)}. ${sTitle}`, '');
          renderObjectFields(s, lines, ['title', 'heading']);
        }
      });
      return { md: lines.join('\n'), title, subtitle };
    }

    // Generic JSON object: turn top-level keys into sections
    lines.push(`# فصل ۱: ${title}`, '');
    renderObjectFields(obj, lines, ['title', 'name', 'bookTitle', 'subtitle', 'description']);
    return { md: lines.join('\n'), title, subtitle };
  }

  return { md: `# فصل ۱: ${baseTitle}\n\n${String(data)}`, title: baseTitle };
}

function renderObjectFields(obj: Record<string, unknown>, lines: string[], skipKeys: string[]) {
  for (const [key, value] of Object.entries(obj)) {
    if (skipKeys.includes(key) || value === null || value === undefined) continue;
    if (typeof value === 'string') {
      if (value.length > 140 || ['content', 'body', 'text', 'description', 'answer', 'explanation'].includes(key.toLowerCase())) {
        lines.push(value.trim(), '');
      } else {
        lines.push(`- **${key}**: ${value.trim()}`);
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`- **${key}**: ${String(value)}`);
    } else if (Array.isArray(value)) {
      lines.push(`### ${key}`, '');
      renderArrayAsMarkdown(value, lines, 3);
    } else if (typeof value === 'object') {
      lines.push(`### ${key}`, '');
      renderObjectFields(value as Record<string, unknown>, lines, []);
    }
  }
  lines.push('');
}

function renderArrayAsMarkdown(arr: unknown[], lines: string[], headingLevel: number) {
  if (arr.length === 0) return;
  const allFlatObjects = arr.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      Object.values(item as Record<string, unknown>).every(
        (v) => v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
      )
  );

  if (allFlatObjects && arr.length >= 2) {
    const keySet = new Set<string>();
    arr.forEach((item) => Object.keys(item as Record<string, unknown>).forEach((k) => keySet.add(k)));
    const headers = Array.from(keySet);
    if (headers.length >= 2 && headers.length <= 7) {
      lines.push(`| ${headers.join(' | ')} |`);
      lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
      for (const item of arr) {
        const rec = item as Record<string, unknown>;
        const row = headers.map((h) => String(rec[h] ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' '));
        lines.push(`| ${row.join(' | ')} |`);
      }
      lines.push('');
      return;
    }
  }

  arr.forEach((item, idx) => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      lines.push(`- ${String(item)}`);
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      const itemTitle = String(rec.title || rec.heading || rec.name || rec.question || `مورد ${toPersianDigits(idx + 1)}`);
      const hashes = '#'.repeat(Math.min(4, headingLevel));
      lines.push(`${hashes} ${itemTitle}`, '');
      renderObjectFields(rec, lines, ['title', 'heading', 'name', 'question']);
    }
  });
  lines.push('');
}

export function parseJsonDocument(rawContent: string, fileName: string): ParsedBook {
  let data: unknown;
  try {
    data = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(`ساختار فایل JSON نامعتبر است (${fileName}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const { md, title, subtitle } = jsonToMarkdown(data, fileName);
  const parsed = parseMarkdownDocument(md, fileName);
  parsed.title = title;
  if (subtitle) parsed.subtitle = subtitle;
  return parsed;
}

// ============================================================================
// CSV & HTML & PLAIN TXT PARSERS
// ============================================================================

function parseCsvDocument(rawContent: string, fileName: string): ParsedBook {
  const baseTitle = fileName.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim();
  const normalized = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Auto-detect dominant delimiter (',' vs ';') from first non-empty line outside quotes
  const firstLine = normalized.split('\n').find((l) => l.trim().length > 0) || '';
  let commaCount = 0;
  let semiCount = 0;
  let qProbe = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') qProbe = !qProbe;
    else if (!qProbe && ch === ',') commaCount++;
    else if (!qProbe && ch === ';') semiCount++;
  }
  const delimiter = semiCount > commaCount ? ';' : ',';

  // RFC-4180 compliant character-stream parser (handles escaped "" and multiline quoted cells)
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell.replace(/\n+/g, ' ').trim());
      currentCell = '';
    } else if (ch === '\n') {
      currentRow.push(currentCell.replace(/\n+/g, ' ').trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.replace(/\n+/g, ' ').trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return parseMarkdownDocument(`# فصل ۱: ${baseTitle}\n\n(فایل CSV خالی است)`, fileName);
  }

  const colCount = Math.max(1, ...rows.map((r) => r.length));
  const headers = rows[0].concat(Array(Math.max(0, colCount - rows[0].length)).fill(''));
  const mdLines = [
    `# فصل ۱: ${baseTitle}`,
    '',
    `## ۱-۱. داده‌های جدولی ${baseTitle}`,
    '',
    `**جدول ۱-۱: داده‌های استخراج‌شده از ${fileName}**`,
    `| ${headers.map((h) => h.replace(/\|/g, '\\|')).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => {
      const padded = r.concat(Array(Math.max(0, headers.length - r.length)).fill(''));
      return `| ${padded.slice(0, headers.length).map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
    }),
  ];

  const parsed = parseMarkdownDocument(mdLines.join('\n'), fileName);
  parsed.title = baseTitle;
  return parsed;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function parseHtmlDocument(rawContent: string, fileName: string): ParsedBook {
  const baseTitle = fileName.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ').trim();
  const withoutScripts = rawContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Convert HTML <table> blocks into structured Markdown tables before stripping generic tags
  const withMdTables = withoutScripts.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_full, inner: string) => {
    const trMatches = inner.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const parsedRows: string[][] = [];
    for (const tr of trMatches) {
      const cellMatches = tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
      if (cellMatches.length === 0) continue;
      const cells = cellMatches.map((cellXml) =>
        decodeHtmlEntities(
          cellXml
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        ).replace(/\|/g, '\\|')
      );
      if (cells.some((c) => c.length > 0)) {
        parsedRows.push(cells);
      }
    }
    if (parsedRows.length === 0) return '';
    const colCount = Math.max(1, ...parsedRows.map((r) => r.length));
    const pad = (r: string[]) => r.concat(Array(Math.max(0, colCount - r.length)).fill(''));
    const header = pad(parsedRows[0]);
    const body = parsedRows.slice(1).map(pad);
    return [
      '',
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...body.map((r) => `| ${r.join(' | ')} |`),
      '',
    ].join('\n');
  });

  const cleaned = decodeHtmlEntities(
    withMdTables
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
  const parsed = parseMarkdownDocument(cleaned, fileName);
  if (!parsed.title || parsed.title === fileName) parsed.title = baseTitle;
  return parsed;
}

function parsePlainTextDocument(rawContent: string, fileName: string): ParsedBook {
  const baseTitle = fileName.replace(/\.txt$/i, '').replace(/[_-]+/g, ' ').trim();
  const withWinolsTables = convertRawWinolsTablesToMarkdown(rawContent).markdown;
  const hasMdHeadings = /^#{1,3}\s+/m.test(withWinolsTables);
  if (hasMdHeadings) {
    return parseMarkdownDocument(withWinolsTables, fileName);
  }
  const lines = withWinolsTables.replace(/\r\n/g, '\n').split('\n');
  const mdLines: string[] = [`# فصل ۱: ${baseTitle}`, ''];
  let secCount = 0;

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      mdLines.push('');
      continue;
    }
    // Preserve converted Markdown table rows verbatim
    if (l.startsWith('|')) {
      mdLines.push(l);
      continue;
    }
    // Promote Persian chapter/section headings or short underlined/colon lines
    if (/^(فصل|بخش|مبحث|درس|جلسه)\s+[۰-۹0-9آ-ی]+/.test(l) && l.length < 100) {
      secCount++;
      mdLines.push(`## ۱-${toPersianDigits(secCount)}. ${l}`, '');
    } else {
      mdLines.push(l);
    }
  }
  const parsed = parseMarkdownDocument(mdLines.join('\n'), fileName);
  parsed.title = baseTitle;
  return parsed;
}

export async function parsePdfDocument(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string
): Promise<ParsedBook> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let extractedText = '';
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
    extractedText = pages
      .map((p, idx) => {
        const cleaned = cleanDirectionalMarks(String(p || ''));
        return cleaned ? `## صفحه ${toPersianDigits(idx + 1)}\n\n${cleaned}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
  } catch (err) {
    // Graceful fallback if PDF has unusual encoding — filter out PDF object/dictionary syntax
    const rawFallback = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const pdfSyntaxRx = /\b(?:endobj|endstream|startxref|xref|trailer|FlateDecode|FontDescriptor|MediaBox|Resources|Catalog)\b|^%PDF-/i;
    const readableChunks = (rawFallback.match(/[\u0600-\u06FFa-zA-Z0-9\s.,:;()\-–—]{24,}/g) || [])
      .map((s) => s.trim())
      .filter((s) => s.length >= 24 && !pdfSyntaxRx.test(s) && /[\u0600-\u06FFa-zA-Z]{4,}/.test(s));
    if (readableChunks.length === 0) {
      throw new Error(
        `استخراج متن از فایل PDF (${fileName}) با خطا مواجه شد: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    extractedText = readableChunks.slice(0, 500).join('\n\n');
  }

  const baseTitle = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  const parsed = parsePlainTextDocument(
    extractedText || `(متن قابل استخراجی در ${fileName} یافت نشد)`,
    fileName.replace(/\.pdf$/i, '.txt')
  );
  parsed.title = baseTitle;
  parsed.sourceFiles = [fileName];
  return parsed;
}

// ============================================================================
// UNIFIED ENTRY POINT & MULTI-FILE MERGER
// ============================================================================

export function detectFileFormat(fileName: string): SourceFileFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.txt')) return 'txt';
  return 'md';
}

export async function parseAnySourceFile(input: {
  name: string;
  format?: SourceFileFormat;
  text?: string;
  buffer?: ArrayBuffer | Uint8Array;
}): Promise<ParsedBook> {
  const format = input.format ?? detectFileFormat(input.name);
  let parsed: ParsedBook;
  if (format === 'docx') {
    if (!input.buffer) throw new Error(`داده باینری برای فایل ورد ${input.name} ارسال نشده است.`);
    parsed = await parseDocxDocument(input.buffer, input.name);
  } else if (format === 'pdf') {
    if (!input.buffer) throw new Error(`داده باینری برای فایل پی‌دی‌اف ${input.name} ارسال نشده است.`);
    parsed = await parsePdfDocument(input.buffer, input.name);
  } else {
    const text = input.text ?? (input.buffer ? new TextDecoder('utf-8').decode(input.buffer) : '');
    if (format === 'json') parsed = parseJsonDocument(text, input.name);
    else if (format === 'csv') parsed = parseCsvDocument(text, input.name);
    else if (format === 'html') parsed = parseHtmlDocument(text, input.name);
    else if (format === 'txt') parsed = parsePlainTextDocument(text, input.name);
    else parsed = parseMarkdownDocument(text, input.name);
  }

  // Stamp sourceFileName on every section for multi-file thematic clustering traceability
  for (const ch of parsed.chapters) {
    ch.sourceFileName = input.name;
    for (const sec of ch.sections) {
      sec.sourceFileName = input.name;
    }
  }
  return parsed;
}

export function mergeParsedBooks(books: ParsedBook[]): ParsedBook {
  if (books.length === 0) {
    return {
      title: 'سند جدید بدون عنوان',
      subtitle: 'برای شروع، یک یا چند فایل Word (.docx)، PDF، Markdown (.md)، TXT یا JSON بارگذاری کنید.',
      editionNote: '',
      sourceFiles: [],
      volumes: [],
      chapters: [],
      footnotes: [],
      glossary: [],
      tableIndex: [],
      cheatSheets: [],
      visualSuggestions: [],
      sourceMapRows: [],
    };
  }
  if (books.length === 1) return books[0];

  const mergedVolumes: VolumeNode[] = [];
  const mergedChapters: ChapterNode[] = [];
  const mergedFootnotes: FootnoteEntry[] = [];
  const mergedGlossary: GlossaryEntry[] = [];
  const mergedSourceMap: string[][] = [];
  const sourceFiles: string[] = [];

  let footnoteOffset = 0;

  books.forEach((book, bIdx) => {
    sourceFiles.push(...book.sourceFiles);
    const volOffset = mergedVolumes.length;

    const localVolumes =
      book.volumes.length > 0
        ? book.volumes
        : [{ id: `vol_auto_${bIdx + 1}`, index: 1, title: `بخش ${toPersianDigits(bIdx + 1)} — ${book.title}` }];

    localVolumes.forEach((v, vIdx) => {
      mergedVolumes.push({
        id: `vol_${volOffset + vIdx + 1}`,
        index: volOffset + vIdx + 1,
        title: v.title,
        subtitle: v.subtitle,
      });
    });

    book.chapters.forEach((ch) => {
      const nextChapterNum = mergedChapters.length + 1;
      const mappedVolIdx = volOffset + Math.max(1, ch.volumeIndex);
      const volObj = mergedVolumes[mappedVolIdx - 1] || mergedVolumes[mergedVolumes.length - 1];

      const remapFn = (txt: string) =>
        footnoteOffset === 0
          ? txt
          : txt.replace(/\[\[(\d+)\]\]\(#footnote-(\d+)\)/g, (_, n) => {
              const shifted = Number(n) + footnoteOffset;
              return `[[${shifted}]](#footnote-${shifted})`;
            });

      const remapBlock = (b: ContentBlock): ContentBlock => {
        if (b.type === 'paragraph') return { ...b, text: remapFn(b.text) };
        if (b.type === 'callout') return { ...b, paragraphs: b.paragraphs.map(remapFn) };
        if (b.type === 'list') return { ...b, items: b.items.map(remapFn) };
        if (b.type === 'table') {
          return { ...b, rows: b.rows.map((r) => r.map(remapFn)) };
        }
        return b;
      };

      const cleanTitle = ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '');
      mergedChapters.push({
        ...ch,
        id: `ch_${nextChapterNum}`,
        chapterNumber: nextChapterNum,
        title: `فصل ${toPersianDigits(nextChapterNum)}: ${cleanTitle}`,
        volumeIndex: volObj.index,
        volumeTitle: volObj.title,
        introBlocks: ch.introBlocks.map(remapBlock),
        sections: ch.sections.map((sec, sIdx) => ({
          ...sec,
          id: `f${bIdx + 1}_c${nextChapterNum}_s${sIdx + 1}_${sec.id}`,
          sourceFileName: sec.sourceFileName || ch.sourceFileName,
          blocks: sec.blocks.map(remapBlock),
        })),
      });
    });

    book.footnotes.forEach((fn) => {
      mergedFootnotes.push({
        ...fn,
        id: fn.id + footnoteOffset,
        canonicalId: fn.canonicalId + footnoteOffset,
      });
    });
    footnoteOffset += book.footnotes.length;

    mergedGlossary.push(...book.glossary);
    mergedSourceMap.push(...book.sourceMapRows);
  });

  return {
    title: books.length > 1 ? `مجموعه یکپارچه — ${books[0].title}` : books[0].title,
    subtitle: `تلفیق و سازماندهی خودکار ${toPersianDigits(books.length)} سند ورودی (${sourceFiles.join('، ')})`,
    editionNote: books[0].editionNote,
    sourceFiles,
    volumes: mergedVolumes,
    chapters: mergedChapters,
    footnotes: mergedFootnotes,
    glossary: mergedGlossary,
    tableIndex: [],
    cheatSheets: [],
    visualSuggestions: [],
    sourceMapRows: mergedSourceMap,
  };
}

export function exportBookToMarkdown(book: ParsedBook): string {
  const lines: string[] = [];
  lines.push(`# ${book.title}`, '');
  if (book.subtitle) lines.push(`> ${book.subtitle}`, '');

  const renderBlock = (block: ContentBlock) => {
    switch (block.type) {
      case 'paragraph':
        lines.push(block.text, '');
        break;
      case 'subheading':
        lines.push(`${'#'.repeat(block.level)} ${block.text}`, '');
        break;
      case 'list':
        block.items.forEach((item, idx) => {
          lines.push(block.ordered ? `${idx + 1}. ${item}` : `- ${item}`);
        });
        lines.push('');
        break;
      case 'table':
        if (block.caption) lines.push(`**${block.caption}**`, '');
        lines.push(`| ${block.headers.join(' | ')} |`);
        lines.push(`| ${block.headers.map(() => '---').join(' | ')} |`);
        block.rows.forEach((r) => lines.push(`| ${r.join(' | ')} |`));
        lines.push('');
        break;
      case 'callout':
        lines.push(`> **${block.title}**`);
        block.paragraphs.forEach((p) => lines.push(`> ${p}`));
        lines.push('');
        break;
      case 'equation':
        lines.push(`$$${block.latex}$$`, '');
        break;
      case 'figure':
        if (
          block.aiPlaceholderSpec &&
          (block.imageStrategy === 'AI_PLACEHOLDER' ||
            block.resolutionStatus === 'ai_placeholder' ||
            block.resolutionStatus === 'fallback_placeholder')
        ) {
          const spec = block.aiPlaceholderSpec;
          lines.push(
            spec.compactTag,
            `> **[تصویر تولیدی AI | شناسه: ${spec.codeId} | نوع: ${spec.typeFa}]**`,
            `> • موضوع: ${spec.subjectFa}`,
            `> • عناصر کلیدی: ${spec.elementsFa}`,
            `> • برچسب‌های الزامی روی تصویر: ${spec.labelsFa}`,
            ''
          );
        } else if (block.imageStrategy === 'WEB_SEARCH') {
          lines.push(
            `> **[تصویر فنی مرجع وب: ${block.caption}]**`,
            `> • کوئری جستجو: \`${block.searchQuery || block.caption}\``,
            block.sourceUri
              ? `> • منبع: [${block.sourceTitle || 'مشاهده تصویر مرجع'}](${block.sourceUri})`
              : `> • توضیح: ${block.description}`,
            ''
          );
        } else {
          lines.push(`[تصویر فنی پیشنهادی: ${block.caption} — ${block.description}]`, '');
        }
        break;
      case 'image':
        lines.push(`![${block.caption}](embedded-image:${block.id})`, '');
        break;
      case 'diagram':
        lines.push(`> **نمودار: ${block.caption || block.title}**`);
        block.items.forEach((it, idx) => {
          lines.push(`> ${idx + 1}. **${it.label}**${it.detail ? `: ${it.detail}` : ''}`);
        });
        lines.push('');
        break;
      case 'adaptive_visual':
        lines.push(`> **${block.caption || block.title}**`);
        if (block.pedagogicalTakeaway) {
          lines.push(`> ${block.pedagogicalTakeaway}`);
        }
        if (block.pythonScript) {
          lines.push('', '```python', block.pythonScript.trim(), '```');
        }
        lines.push('');
        break;
      case 'web_enrichment':
        lines.push(`> **تکمیل‌شده از وب (جستجوی گوگل): ${block.title}**`);
        lines.push(`> ${block.summary}`);
        block.sources.forEach((s) => lines.push(`> - [${s.title}](${s.uri})`));
        lines.push('');
        break;
      case 'conflict_note':
        lines.push(`> **مقایسه دو روایت منبع: ${block.topic}**`);
        lines.push(`> - روایت ${block.fileAName}: ${block.excerptA}`);
        lines.push(`> - روایت ${block.fileBName}: ${block.excerptB}`);
        if (block.resolutionNote) lines.push(`> - تصمیم: ${block.resolutionNote}`);
        lines.push('');
        break;
    }
  };

  for (const ch of book.chapters) {
    lines.push(`# ${ch.title}`, '');
    ch.introBlocks.forEach(renderBlock);
    for (const sec of ch.sections) {
      const secHeading = sec.numberLabel ? `${sec.numberLabel}. ${sec.title}` : sec.title;
      lines.push(`## ${secHeading}`, '');
      sec.blocks.forEach(renderBlock);
    }
  }

  return lines.join('\n');
}
