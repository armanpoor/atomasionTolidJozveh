import JSZip from 'jszip';
import {
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
} from './bookTypes';

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

export function parseMarkdownDocument(rawContent: string, fileName: string): ParsedBook {
  const lines = rawContent.replace(/\r\n/g, '\n').split('\n');

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

  // If the attached book has its signature heading / content
  if (rawContent.includes('مجلد یکم — مهندسی کالیبراسیون')) {
    bookTitle = 'کتاب مرجع مهندسی کالیبراسیون و ریمپ ایسیو';
    bookSubtitle = 'دوره جامع چهارروزه تیونینگ، عیب‌یابی، الگوخوانی WinOLS و کالیبراسیون موتورهای اتمسفریک و پرخوران';
  }

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
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractTextFromWXml(xmlChunk: string): string {
  const parts: string[] = [];
  const tokenRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s+[^>]*)?\/>/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(xmlChunk)) !== null) {
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

export async function parseDocxDocument(buffer: ArrayBuffer | Uint8Array, fileName: string): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error(`فایل ورد معتبر نیست (word/document.xml در ${fileName} یافت نشد).`);
  }
  const docXml = await docFile.async('string');
  const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  const bodyXml = bodyMatch ? bodyMatch[1] : docXml;

  // Map relationship IDs (rId -> word/media/imageX.png|jpg) to preserve embedded DOCX visuals
  const relImageMap = new Map<string, { dataUrl: string; mimeType: 'image/png' | 'image/jpeg'; target: string }>();
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

  const mdLines: string[] = [];
  const baseTitle = fileName.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim();
  let detectedHeading = false;
  let imageSeq = 0;

  for (const el of elements) {
    if (el.tag === 'p') {
      // Check for embedded drawing / image reference inside this paragraph
      const embedMatch = el.xml.match(/r:embed="([^"]+)"/);
      if (embedMatch && relImageMap.has(embedMatch[1])) {
        const imgAsset = relImageMap.get(embedMatch[1])!;
        const marker = `DOCX_IMG_${++imageSeq}`;
        const descrMatch = el.xml.match(/descr="([^"]+)"/) || el.xml.match(/name="([^"]+)"/);
        const caption = descrMatch
          ? decodeXmlEntities(descrMatch[1]).trim()
          : `تصویر استخراج‌شده ${toPersianDigits(imageSeq)} از ${fileName}`;
        extractedImagesByMarker.set(marker, {
          dataUrl: imgAsset.dataUrl,
          mimeType: imgAsset.mimeType,
          caption,
        });
        mdLines.push(`[DOCX_IMAGE_TOKEN:${marker}]`, '');
      }

      const text = extractTextFromWXml(el.xml);
      if (!text) continue;
      // Skip TOC instruction field lines
      if (/\bTOC\b.*\\o/i.test(el.xml) || /^PAGEREF\s+_Toc/i.test(text)) continue;

      const styleMatch = el.xml.match(/<w:pStyle\s+w:val="([^"]+)"/);
      const style = styleMatch ? styleMatch[1] : '';
      const outlineMatch = el.xml.match(/<w:outlineLvl\s+w:val="(\d+)"/);

      if (/^Heading1$|^1$|^Title$/i.test(style) || outlineMatch?.[1] === '0') {
        detectedHeading = true;
        mdLines.push(`# ${text}`);
      } else if (/^Heading2$|^2$/i.test(style) || outlineMatch?.[1] === '1') {
        detectedHeading = true;
        mdLines.push(`# ${text}`);
      } else if (/^Heading3$|^3$/i.test(style) || outlineMatch?.[1] === '2') {
        mdLines.push(`## ${text}`);
      } else if (/^Heading4$|^4$/i.test(style) || outlineMatch?.[1] === '3') {
        mdLines.push(`### ${text}`);
      } else {
        mdLines.push(text);
      }
      mdLines.push('');
    } else if (el.tag === 'tbl') {
      const rowMatches = el.xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
      const tableRows: string[][] = [];
      for (const rXml of rowMatches) {
        const cellMatches = rXml.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) || [];
        const cells = cellMatches.map((cXml) => {
          const pMatches = cXml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
          const pTexts = pMatches.map(extractTextFromWXml).filter(Boolean);
          return pTexts.join('  ').replace(/\|/g, '\\|');
        });
        if (cells.length > 0) tableRows.push(cells);
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

  // Hydrate [DOCX_IMAGE_TOKEN:...] paragraphs into real EmbeddedImageBlock nodes
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
  const rows = rawContent
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if ((ch === ',' || ch === ';') && !inQuotes) {
          cells.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    });

  if (rows.length === 0) {
    return parseMarkdownDocument(`# فصل ۱: ${baseTitle}\n\n(فایل CSV خالی است)`, fileName);
  }

  const headers = rows[0];
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

function parseHtmlDocument(rawContent: string, fileName: string): ParsedBook {
  const baseTitle = fileName.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ').trim();
  const cleaned = rawContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const parsed = parseMarkdownDocument(cleaned, fileName);
  if (!parsed.title || parsed.title === fileName) parsed.title = baseTitle;
  return parsed;
}

function parsePlainTextDocument(rawContent: string, fileName: string): ParsedBook {
  const baseTitle = fileName.replace(/\.txt$/i, '').replace(/[_-]+/g, ' ').trim();
  const hasMdHeadings = /^#{1,3}\s+/m.test(rawContent);
  if (hasMdHeadings) {
    return parseMarkdownDocument(rawContent, fileName);
  }
  const lines = rawContent.replace(/\r\n/g, '\n').split('\n');
  const mdLines: string[] = [`# فصل ۱: ${baseTitle}`, ''];
  let secCount = 0;

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      mdLines.push('');
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
    // Graceful fallback if PDF has unusual encoding
    const rawFallback = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const readableChunks = rawFallback.match(/[\u0600-\u06FFa-zA-Z0-9\s.,:;()\-–—]{20,}/g) || [];
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
        lines.push(`[تصویر فنی پیشنهادی: ${block.caption} — ${block.description}]`, '');
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
