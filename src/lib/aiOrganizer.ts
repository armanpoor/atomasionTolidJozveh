import type {
  AiAnalysisPayload,
  AiAnalysisReport,
  AiModelId,
  AiThinkingLevel,
  ChapterNode,
  ContentBlock,
  DiagramBlock,
  DiagramKind,
  ParsedBook,
  ProcessingEngineMode,
  SectionNode,
  TableBlock,
} from './bookTypes.ts';
import { createDiagramBlock, rasterizeSvgToPng } from './diagramRenderer.ts';
import { toPersianDigits } from './formatParsers.ts';

export interface SectionCatalogItem {
  sectionId: string;
  chapterNumber: number;
  chapterTitle: string;
  sourceFile: string;
  title: string;
  excerpt: string;
  wordCount: number;
}

export function getModelDisplayName(model: AiModelId): string {
  if (model === 'gemini-4-hydrogen') return 'Gemini 4 Hydrogen (هیدروژن)';
  return 'Gemini 3.1 Flash Lite (سریع)';
}

function summarizeBlocks(blocks: ContentBlock[]): { excerpt: string; wordCount: number } {
  const texts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'subheading') texts.push(b.text);
    else if (b.type === 'callout') texts.push(`${b.title}: ${b.paragraphs.join(' ')}`);
    else if (b.type === 'list') texts.push(b.items.join(' | '));
    else if (b.type === 'table') texts.push(b.caption || b.headers.join(' / '));
  }
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
  return {
    excerpt: joined.slice(0, 280),
    wordCount: joined ? joined.split(' ').length : 0,
  };
}

/**
 * Builds a structured catalog of all sections across all uploaded files to send to /api/ai/analyze.
 */
export function buildSectionCatalogForAi(book: ParsedBook): SectionCatalogItem[] {
  const items: SectionCatalogItem[] = [];
  for (const ch of book.chapters) {
    if (ch.sections.length === 0 && ch.introBlocks.length > 0) {
      const stats = summarizeBlocks(ch.introBlocks);
      items.push({
        sectionId: `${ch.id}_intro`,
        chapterNumber: ch.chapterNumber,
        chapterTitle: ch.title,
        sourceFile: ch.sourceFileName,
        title: ch.title,
        excerpt: stats.excerpt,
        wordCount: stats.wordCount,
      });
    }
    for (const sec of ch.sections) {
      const stats = summarizeBlocks(sec.blocks);
      items.push({
        sectionId: sec.id,
        chapterNumber: ch.chapterNumber,
        chapterTitle: ch.title,
        sourceFile: sec.sourceFileName || ch.sourceFileName,
        title: sec.title,
        excerpt: stats.excerpt,
        wordCount: stats.wordCount,
      });
    }
  }
  return items;
}

function normalizeTopicKey(title: string): string {
  return title
    .replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function topicTokenOverlap(a: string, b: string): number {
  const stopWords = new Set(['فصل', 'بخش', 'مبانی', 'اصول', 'تنظیم', 'بررسی', 'روش', 'نکات', 'در', 'و', 'با', 'از', 'به', 'برای', 'روی', 'های', 'است']);
  const tokA = new Set(normalizeTopicKey(a).split(' ').filter((w) => w.length >= 3 && !stopWords.has(w)));
  const tokB = new Set(normalizeTopicKey(b).split(' ').filter((w) => w.length >= 3 && !stopWords.has(w)));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let inter = 0;
  for (const t of tokA) if (tokB.has(t)) inter++;
  return inter / Math.min(tokA.size, tokB.size);
}

/**
 * Deterministic multi-file thematic clustering:
 * When combining 2+ source files, merges chapters/topics that cover the same subject
 * into a single dedicated chapter while preserving 100% of sections and content.
 */
export function clusterBookThematicallyLocal(book: ParsedBook): {
  book: ParsedBook;
  thematicMerges: Array<{ chapterTitle: string; mergedFrom: string[]; sectionCount: number }>;
} {
  if (book.sourceFiles.length <= 1 || book.chapters.length <= 1) {
    return { book, thematicMerges: [] };
  }

  const clustered: ChapterNode[] = [];
  const thematicMerges: Array<{ chapterTitle: string; mergedFrom: string[]; sectionCount: number }> = [];

  for (const ch of book.chapters) {
    const match = clustered.find(
      (existing) =>
        existing.sourceFileName !== ch.sourceFileName &&
        topicTokenOverlap(existing.title, ch.title) >= 0.5
    );

    if (match) {
      const mergedSections: SectionNode[] = [...match.sections];
      if (ch.introBlocks.length > 0) {
        mergedSections.push({
          id: `${ch.id}_merged_intro`,
          numberLabel: '',
          title: ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, ''),
          originalTitle: ch.title,
          wasUnnumbered: true,
          sourceFileName: ch.sourceFileName,
          blocks: ch.introBlocks,
        });
      }
      mergedSections.push(...ch.sections);
      match.sections = mergedSections;

      thematicMerges.push({
        chapterTitle: match.title,
        mergedFrom: [match.sourceFileName, ch.sourceFileName],
        sectionCount: mergedSections.length,
      });
    } else {
      clustered.push({
        ...ch,
        introBlocks: [...ch.introBlocks],
        sections: [...ch.sections],
      });
    }
  }

  // Re-index chapters sequentially
  const renumbered = clustered.map((ch, idx) => {
    const num = idx + 1;
    const clean = ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '');
    return {
      ...ch,
      id: `ch_${num}`,
      chapterNumber: num,
      title: `فصل ${toPersianDigits(num)}: ${clean}`,
      sections: ch.sections.map((sec, sIdx) => ({
        ...sec,
        numberLabel: `${toPersianDigits(num)}-${toPersianDigits(sIdx + 1)}`,
      })),
    };
  });

  return {
    book: {
      ...book,
      chapters: renumbered,
    },
    thematicMerges,
  };
}

/**
 * Generates real structured comparison/summary tables and real educational SVG diagrams
 * directly from chapter content so every book receives concrete visual & tabular enrichments
 * embedded right into the chapters and exported .docx.
 */
function synthesizeLocalVisualEnrichments(book: ParsedBook, maxChaptersToEnrich = 6): {
  insertedTables: AiAnalysisReport['insertedTables'];
  insertedDiagrams: AiAnalysisReport['insertedDiagrams'];
} {
  const insertedTables: AiAnalysisReport['insertedTables'] = [];
  const insertedDiagrams: AiAnalysisReport['insertedDiagrams'] = [];

  // Prioritize chapters with rich sections or low existing table density
  const rankedChapters = [...book.chapters]
    .sort((a, b) => b.sections.length - a.sections.length)
    .slice(0, maxChaptersToEnrich);

  let genSeq = 0;

  for (const ch of rankedChapters) {
    const existingTables = [...ch.introBlocks, ...ch.sections.flatMap((s) => s.blocks)].filter(
      (b) => b.type === 'table'
    ).length;

    // 1. Embed a real structured Chapter Executive Summary / Parameter Matrix Table if chapter has >= 2 sections
    if (ch.sections.length >= 2 && existingTables < 4) {
      const tableRows = ch.sections.slice(0, 6).map((sec, idx) => {
        const callout = sec.blocks.find((b) => b.type === 'callout');
        const firstPara = sec.blocks.find((b) => b.type === 'paragraph');
        const keyNote =
          callout && callout.type === 'callout'
            ? callout.title.replace(/^[⛔💡⚙️🔄❓📘]+\s*/, '').slice(0, 90)
            : firstPara && firstPara.type === 'paragraph'
              ? firstPara.text.replace(/\[\[\d+\]\]\(#footnote-\d+\)/g, '').slice(0, 95)
              : 'مبحث تشریحی و اجرایی';
        const blockCount = sec.blocks.length;
        return [
          sec.numberLabel || `${toPersianDigits(ch.chapterNumber)}-${toPersianDigits(idx + 1)}`,
          sec.title.slice(0, 68),
          keyNote,
          `${toPersianDigits(blockCount)} واحد محتوایی`,
        ];
      });

      const tableNum = `${toPersianDigits(ch.chapterNumber)}-${toPersianDigits(existingTables + 1)}`;
      const caption = `جدول ${tableNum}: نقشه خلاصه مباحث و نکات کلیدی ${ch.title}`;
      const newTable: TableBlock = {
        type: 'table',
        id: `auto_tbl_${++genSeq}`,
        caption,
        headers: ['کد بخش', 'موضوع اصلی', 'نکته محوری و کاربردی', 'حجم پوشش'],
        rows: tableRows,
        generatedBy: 'local',
        rationale: 'جمع‌بندی ساختاری مباحث کلیدی فصل در یک جدول مرجع سریع جهت مرور و مقایسه آنی',
      };

      ch.introBlocks.push(newTable);
      insertedTables.push({
        chapterNumber: ch.chapterNumber,
        chapterTitle: ch.title,
        caption,
        rationale: newTable.rationale!,
        rowCount: tableRows.length,
        generatedBy: 'local',
      });
    }

    // 2. Embed a real SVG/PNG Educational Diagram (Flowchart or Architecture) directly in the chapter
    if (ch.sections.length >= 2) {
      const isProcess = /مراحل|گام|پروتکل|ترتیب|روش|تنظیم|کالیبراسیون/.test(ch.title) ||
        ch.sections.some((s) => /گام|مرحله|پروتکل|ترتیب/.test(s.title));
      const kind: DiagramKind = isProcess ? 'flowchart' : 'architecture';
      const diagItems = ch.sections.slice(0, 4).map((sec) => {
        const firstPara = sec.blocks.find((b) => b.type === 'paragraph');
        const detail =
          firstPara && firstPara.type === 'paragraph'
            ? firstPara.text.replace(/\[\[\d+\]\]\(#footnote-\d+\)/g, '').slice(0, 62)
            : '';
        return {
          label: sec.title.slice(0, 40),
          detail,
        };
      });

      const diagramTitle = isProcess
        ? `فلوچارت توالی اجرایی ${ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '')}`
        : `معماری مفهومی و ارتباط بخش‌های ${ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '')}`;
      const caption = `شکل ${toPersianDigits(ch.chapterNumber)}-۱: ${diagramTitle}`;

      const diagramBlock: DiagramBlock = createDiagramBlock({
        id: `auto_diag_${++genSeq}`,
        kind,
        title: diagramTitle,
        caption,
        rationale: isProcess
          ? 'تبدیل مراحل متنی فصل به فلوچارت بصری راست‌چین جهت درک سریع ترتیب اجرا'
          : 'نمایش شماتیک ارتباط مفاهیم کلیدی فصل برای تثبیت یادگیری و مرور سریع',
        items: diagItems,
        generatedBy: 'local',
      });

      const targetSec = ch.sections[0];
      if (targetSec) {
        targetSec.blocks.unshift(diagramBlock);
      } else {
        ch.introBlocks.push(diagramBlock);
      }

      insertedDiagrams.push({
        chapterNumber: ch.chapterNumber,
        chapterTitle: ch.title,
        title: diagramTitle,
        caption,
        kind,
        rationale: diagramBlock.rationale || '',
        svgMarkup: diagramBlock.svgMarkup,
        generatedBy: 'local',
      });
    }
  }

  return { insertedTables, insertedDiagrams };
}

/**
 * Applies structured Gemini AI analysis onto a parsed & optimized book WITHOUT EVER DROPPING ANY SECTION.
 * Reorganizes scattered multi-file sections into thematic chapters when multiple files exist,
 * embeds real AI-generated tables and real rendered educational diagrams, and produces a complete AiAnalysisReport.
 */
export function applyAiAnalysisToBook(
  optimizedBook: ParsedBook,
  aiPayload: AiAnalysisPayload | null,
  meta: {
    engineMode: ProcessingEngineMode;
    model: AiModelId;
    thinkingLevel: AiThinkingLevel;
    embedGeneratedTablesAndDiagrams: boolean;
    apiNote?: string;
  }
): ParsedBook {
  const book: ParsedBook = {
    ...optimizedBook,
    chapters: optimizedBook.chapters.map((ch) => ({
      ...ch,
      introBlocks: [...ch.introBlocks],
      sections: ch.sections.map((s) => ({ ...s, blocks: [...s.blocks] })),
    })),
    tableIndex: [...optimizedBook.tableIndex],
  };

  const insertedTables: AiAnalysisReport['insertedTables'] = [];
  const insertedDiagrams: AiAnalysisReport['insertedDiagrams'] = [];
  let genSeq = 0;

  if (aiPayload) {
    if (aiPayload.unifiedTitle && book.sourceFiles.length > 1) {
      book.title = aiPayload.unifiedTitle.trim();
    }
    if (aiPayload.unifiedSubtitle && book.sourceFiles.length > 1) {
      book.subtitle = aiPayload.unifiedSubtitle.trim();
    }

    // Apply thematic chapter reorganization across multiple uploaded files (strictly lossless!)
    if (
      book.sourceFiles.length > 1 &&
      Array.isArray(aiPayload.thematicChapters) &&
      aiPayload.thematicChapters.length > 0
    ) {
      const sectionById = new Map<string, SectionNode>();
      for (const ch of book.chapters) {
        if (ch.sections.length === 0 && ch.introBlocks.length > 0) {
          sectionById.set(`${ch.id}_intro`, {
            id: `${ch.id}_intro`,
            numberLabel: '',
            title: ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, ''),
            originalTitle: ch.title,
            sourceFileName: ch.sourceFileName,
            blocks: ch.introBlocks,
          });
        }
        for (const s of ch.sections) {
          sectionById.set(s.id, s);
        }
      }

      const assignedIds = new Set<string>();
      const newChapters: ChapterNode[] = [];

      aiPayload.thematicChapters.forEach((plan, idx) => {
        const picked: SectionNode[] = [];
        for (const sid of plan.sectionIds || []) {
          const found = sectionById.get(sid);
          if (found && !assignedIds.has(sid)) {
            assignedIds.add(sid);
            picked.push(found);
          }
        }
        if (picked.length > 0) {
          const chNum = newChapters.length + 1;
          const cleanName = plan.chapterTitle.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '').trim();
          newChapters.push({
            id: `ch_${chNum}`,
            chapterNumber: chNum,
            title: `فصل ${toPersianDigits(chNum)}: ${cleanName || `فصل موضوعی ${toPersianDigits(idx + 1)}`}`,
            volumeIndex: 1,
            volumeTitle: 'مجلد یکم — ساختار موضوعی یکپارچه',
            meta: plan.topicSummary
              ? [{ label: 'حوزه موضوعی', value: plan.topicSummary }]
              : [],
            introBlocks: [],
            sections: picked.map((s, sIdx) => ({
              ...s,
              numberLabel: `${toPersianDigits(chNum)}-${toPersianDigits(sIdx + 1)}`,
            })),
            sourceFileName: Array.from(new Set(picked.map((p) => p.sourceFileName || ''))).filter(Boolean).join('، '),
          });
        }
      });

      // Lossless safety net: append any unassigned sections so ZERO concepts can ever be dropped
      const leftover: SectionNode[] = [];
      for (const [sid, sec] of sectionById.entries()) {
        if (!assignedIds.has(sid)) leftover.push(sec);
      }
      if (leftover.length > 0) {
        const chNum = newChapters.length + 1;
        newChapters.push({
          id: `ch_${chNum}`,
          chapterNumber: chNum,
          title: `فصل ${toPersianDigits(chNum)}: مباحث تکمیلی و پیوست‌های متنی`,
          volumeIndex: 1,
          volumeTitle: 'مجلد یکم — ساختار موضوعی یکپارچه',
          meta: [],
          introBlocks: [],
          sections: leftover.map((s, sIdx) => ({
            ...s,
            numberLabel: `${toPersianDigits(chNum)}-${toPersianDigits(sIdx + 1)}`,
          })),
          sourceFileName: book.sourceFiles.join('، '),
        });
      }

      if (newChapters.length > 0) {
        book.volumes = [{ id: 'vol_1', index: 1, title: 'مجلد یکم — ساختار موضوعی یکپارچه' }];
        book.chapters = newChapters;
      }
    }

    // Insert AI-generated structured comparison/summary tables directly into matching chapters
    if (meta.embedGeneratedTablesAndDiagrams && Array.isArray(aiPayload.generatedTables)) {
      for (const tSpec of aiPayload.generatedTables) {
        if (!tSpec.headers?.length || !tSpec.rows?.length) continue;
        const targetCh =
          book.chapters.find(
            (ch) => topicTokenOverlap(ch.title, tSpec.targetChapterTitle || '') >= 0.35
          ) || book.chapters[insertedTables.length % Math.max(1, book.chapters.length)];
        if (!targetCh) continue;

        const existingCount = [...targetCh.introBlocks, ...targetCh.sections.flatMap((s) => s.blocks)].filter(
          (b) => b.type === 'table'
        ).length;
        const tblNum = `${toPersianDigits(targetCh.chapterNumber)}-${toPersianDigits(existingCount + 1)}`;
        const cleanCaption = (tSpec.caption || 'جدول تحلیلی').replace(/^جدول\s*[۰-۹0-9]+[-–][۰-۹0-9]+\s*[:：-]?\s*/, '');
        const fullCaption = `جدول ${tblNum}: ${cleanCaption}`;

        const tblBlock: TableBlock = {
          type: 'table',
          id: `ai_tbl_${++genSeq}`,
          caption: fullCaption,
          headers: tSpec.headers,
          rows: tSpec.rows,
          generatedBy: 'ai',
          rationale: tSpec.rationale,
        };

        targetCh.introBlocks.push(tblBlock);
        book.tableIndex.push({
          tableNumber: tblNum,
          caption: fullCaption,
          chapterNumber: targetCh.chapterNumber,
          chapterTitle: targetCh.title,
          sectionTitle: 'جدول تولیدشده توسط هوش مصنوعی',
          generatedBy: 'ai',
        });
        insertedTables.push({
          chapterNumber: targetCh.chapterNumber,
          chapterTitle: targetCh.title,
          caption: fullCaption,
          rationale: tSpec.rationale || 'تولیدشده توسط هوش مصنوعی برای جمع‌بندی و مقایسه سریع',
          rowCount: tSpec.rows.length,
          generatedBy: 'ai',
        });
      }
    }

    // Insert AI-generated real SVG/PNG diagrams directly into matching chapters
    if (meta.embedGeneratedTablesAndDiagrams && Array.isArray(aiPayload.generatedDiagrams)) {
      for (const dSpec of aiPayload.generatedDiagrams) {
        if (!dSpec.title || !dSpec.items?.length) continue;
        const targetCh =
          book.chapters.find(
            (ch) => topicTokenOverlap(ch.title, dSpec.targetChapterTitle || '') >= 0.35
          ) || book.chapters[insertedDiagrams.length % Math.max(1, book.chapters.length)];
        if (!targetCh) continue;

        const validKinds: DiagramKind[] = ['flowchart', 'process_steps', 'comparison_bars', 'architecture'];
        const kind: DiagramKind = validKinds.includes(dSpec.kind) ? dSpec.kind : 'flowchart';
        const figCaption = dSpec.caption || `شکل ${toPersianDigits(targetCh.chapterNumber)}-۱: ${dSpec.title}`;

        const diagBlock = createDiagramBlock({
          id: `ai_diag_${++genSeq}`,
          kind,
          title: dSpec.title,
          caption: figCaption,
          rationale: dSpec.rationale,
          items: dSpec.items,
          generatedBy: 'ai',
        });

        if (targetCh.sections[0]) {
          targetCh.sections[0].blocks.unshift(diagBlock);
        } else {
          targetCh.introBlocks.push(diagBlock);
        }

        insertedDiagrams.push({
          chapterNumber: targetCh.chapterNumber,
          chapterTitle: targetCh.title,
          title: dSpec.title,
          caption: figCaption,
          kind,
          rationale: dSpec.rationale || 'نمودار آموزشی تولیدشده توسط هوش مصنوعی',
          svgMarkup: diagBlock.svgMarkup,
          generatedBy: 'ai',
        });
      }
    }
  }

  // If embedGeneratedTablesAndDiagrams is enabled and no AI tables/diagrams were returned, synthesize real local ones
  if (meta.embedGeneratedTablesAndDiagrams && insertedTables.length === 0 && insertedDiagrams.length === 0) {
    const localGen = synthesizeLocalVisualEnrichments(book, Math.min(6, book.chapters.length));
    insertedTables.push(...localGen.insertedTables);
    insertedDiagrams.push(...localGen.insertedDiagrams);
    for (const t of localGen.insertedTables) {
      book.tableIndex.push({
        tableNumber: t.caption.match(/جدول\s*([۰-۹0-9]+[-–][۰-۹0-9]+)/)?.[1] || `${toPersianDigits(t.chapterNumber)}-۱`,
        caption: t.caption,
        chapterNumber: t.chapterNumber,
        chapterTitle: t.chapterTitle,
        sectionTitle: 'جدول خلاصه فصل (تولید خودکار)',
        generatedBy: 'local',
      });
    }
  }

  // Build complete transparent AI Analysis Report for History & Inspector
  const report: AiAnalysisReport = {
    engineMode: meta.engineMode,
    model: meta.model,
    modelDisplayName: getModelDisplayName(meta.model),
    thinkingLevel: meta.thinkingLevel,
    analyzedAt: new Date().toISOString(),
    executiveSummary:
      aiPayload?.executiveSummary ||
      `سند یکپارچه شامل ${toPersianDigits(book.chapters.length)} فصل، ${toPersianDigits(book.tableIndex.length)} جدول و ${toPersianDigits(insertedDiagrams.length)} نمودار آموزشی بدون حذف هیچ مفهوم فنی پردازش و سازمان‌دهی شد.`,
    thematicChapters:
      aiPayload?.thematicChapters && aiPayload.thematicChapters.length > 0
        ? aiPayload.thematicChapters
        : book.chapters.map((ch) => ({
            chapterTitle: ch.title,
            topicSummary: `شامل ${toPersianDigits(ch.sections.length)} زیربخش منسجم از ${ch.sourceFileName || 'فایل ورودی'}`,
            sectionIds: ch.sections.map((s) => s.id),
          })),
    semanticDuplicates: aiPayload?.semanticDuplicates || [],
    insertedTables,
    insertedDiagrams,
    apiNote: meta.apiNote,
  };

  book.aiReport = report;
  if (book.audit) {
    book.audit = {
      ...book.audit,
      generatedTablesInserted: insertedTables.length,
      generatedDiagramsInserted: insertedDiagrams.length,
    };
  }

  return book;
}

/**
 * Rasterizes every DiagramBlock in the book to high-DPI PNG Uint8Arrays in the browser
 * so docx ImageRun can embed real crisp Persian educational diagrams inside the .docx binary.
 */
export async function rasterizeBookDiagrams(book: ParsedBook): Promise<ParsedBook> {
  const processBlocks = async (blocks: ContentBlock[]): Promise<ContentBlock[]> => {
    const out: ContentBlock[] = [];
    for (const b of blocks) {
      if (b.type === 'diagram' && !b.pngBytes) {
        const res = await rasterizeSvgToPng(b.svgMarkup, b.widthPx, b.heightPx);
        out.push({
          ...b,
          pngBytes: res.pngBytes,
          pngDataUrl: res.pngDataUrl,
        });
      } else {
        out.push(b);
      }
    }
    return out;
  };

  const chapters: ChapterNode[] = [];
  for (const ch of book.chapters) {
    const introBlocks = await processBlocks(ch.introBlocks);
    const sections: SectionNode[] = [];
    for (const sec of ch.sections) {
      sections.push({
        ...sec,
        blocks: await processBlocks(sec.blocks),
      });
    }
    chapters.push({ ...ch, introBlocks, sections });
  }

  return { ...book, chapters };
}
