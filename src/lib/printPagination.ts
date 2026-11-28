import type { ParsedBook } from './bookTypes.ts';

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

export type PrintMarginPresetId = 'standard' | 'binding' | 'compact';

export interface PrintMarginPreset {
  id: PrintMarginPresetId;
  labelFa: string;
  shortLabelFa: string;
  topMm: number;
  rightMm: number;
  bottomMm: number;
  leftMm: number;
}

export const PRINT_MARGIN_PRESETS: Record<PrintMarginPresetId, PrintMarginPreset> = {
  standard: {
    id: 'standard',
    labelFa: 'استاندارد کتاب A4 (۲۰×۲۲ میلی‌متر)',
    shortLabelFa: 'استاندارد (۲۰×۲۲mm)',
    topMm: 20,
    rightMm: 22,
    bottomMm: 22,
    leftMm: 22,
  },
  binding: {
    id: 'binding',
    labelFa: 'حاشیه صحافی عریض (۲۵×۲۵ میلی‌متر)',
    shortLabelFa: 'صحافی (۲۵×۲۵mm)',
    topMm: 25,
    rightMm: 25,
    bottomMm: 25,
    leftMm: 25,
  },
  compact: {
    id: 'compact',
    labelFa: 'فشرده اقتصادی (۱۵×۱۵ میلی‌متر)',
    shortLabelFa: 'فشرده (۱۵×۱۵mm)',
    topMm: 15,
    rightMm: 15,
    bottomMm: 15,
    leftMm: 15,
  },
};

export interface A4GeometryMetrics {
  pageWidthMm: number;
  pageHeightMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
  printableAreaPercent: number;
}

export function computeA4Geometry(presetId: PrintMarginPresetId): A4GeometryMetrics {
  const preset = PRINT_MARGIN_PRESETS[presetId] || PRINT_MARGIN_PRESETS.standard;
  const contentWidthMm = Math.max(80, A4_WIDTH_MM - preset.leftMm - preset.rightMm);
  const contentHeightMm = Math.max(120, A4_HEIGHT_MM - preset.topMm - preset.bottomMm);
  const totalArea = A4_WIDTH_MM * A4_HEIGHT_MM;
  const printableAreaPercent = Math.round(((contentWidthMm * contentHeightMm) / totalArea) * 100);
  return {
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    contentWidthMm,
    contentHeightMm,
    printableAreaPercent,
  };
}

export type PrintScope = 'full_book' | 'active_chapter';

export interface PrintSheetDescriptor {
  id: string;
  kind: 'cover' | 'toc' | 'chapter' | 'cheatsheets' | 'tables' | 'glossary' | 'footnotes';
  titleFa: string;
  runningHeaderFa: string;
  chapterNumber?: number;
  pageNumber: number;
  estimatedPrintedPages: number;
}

export interface PrintPlanSummary {
  sheets: PrintSheetDescriptor[];
  totalSheets: number;
  estimatedTotalPages: number;
}

function estimateChapterPages(book: ParsedBook, chapterNumber: number, fontSizePt: number): number {
  const ch = book.chapters.find((c) => c.chapterNumber === chapterNumber);
  if (!ch) return 1;
  let weight = 0.25; // heading + meta card
  for (const b of ch.introBlocks) {
    weight += b.type === 'paragraph' ? Math.max(0.08, b.text.length / 1900) : 0.22;
  }
  for (const sec of ch.sections) {
    weight += 0.14;
    for (const b of sec.blocks) {
      if (b.type === 'paragraph') {
        weight += Math.max(0.08, b.text.length / 1900);
      } else if (b.type === 'table') {
        weight += 0.2 + b.rows.length * 0.045;
      } else if (b.type === 'callout' || b.type === 'web_enrichment' || b.type === 'conflict_note') {
        weight += 0.28;
      } else if (b.type === 'diagram' || b.type === 'image') {
        weight += 0.38;
      } else {
        weight += 0.14;
      }
    }
  }
  const fontScale = fontSizePt >= 12 ? 1.15 : fontSizePt <= 10.5 ? 0.92 : 1;
  return Math.max(1, Math.ceil(weight * fontScale));
}

export function buildPrintSheetPlan(
  book: ParsedBook,
  options: {
    scope: PrintScope;
    activeChapterNumber?: number | null;
    includeCoverAndToc?: boolean;
    includeAppendices?: boolean;
    fontSizePt?: number;
  }
): PrintPlanSummary {
  const fontSizePt = options.fontSizePt ?? 11;
  const includeCoverAndToc = options.includeCoverAndToc !== false;
  const includeAppendices = options.includeAppendices !== false;
  const sheets: PrintSheetDescriptor[] = [];
  let runningPage = 1;

  if (options.scope === 'active_chapter' && options.activeChapterNumber) {
    const ch =
      book.chapters.find((c) => c.chapterNumber === options.activeChapterNumber) ||
      book.chapters[0];
    if (ch) {
      const est = estimateChapterPages(book, ch.chapterNumber, fontSizePt);
      sheets.push({
        id: `sheet_ch_${ch.chapterNumber}`,
        kind: 'chapter',
        titleFa: ch.title,
        runningHeaderFa: `${book.title} · ${ch.title}`,
        chapterNumber: ch.chapterNumber,
        pageNumber: runningPage,
        estimatedPrintedPages: est,
      });
      runningPage += est;
    }
    return {
      sheets,
      totalSheets: sheets.length,
      estimatedTotalPages: Math.max(1, runningPage - 1),
    };
  }

  if (includeCoverAndToc) {
    sheets.push({
      id: 'sheet_cover',
      kind: 'cover',
      titleFa: 'صفحه جلد و شناسنامه سند',
      runningHeaderFa: book.title,
      pageNumber: runningPage,
      estimatedPrintedPages: 1,
    });
    runningPage += 1;

    sheets.push({
      id: 'sheet_toc',
      kind: 'toc',
      titleFa: 'فهرست مطالب خودکار',
      runningHeaderFa: `${book.title} · فهرست مطالب`,
      pageNumber: runningPage,
      estimatedPrintedPages: Math.max(1, Math.ceil(book.chapters.length / 18)),
    });
    runningPage += Math.max(1, Math.ceil(book.chapters.length / 18));
  }

  for (const ch of book.chapters) {
    const est = estimateChapterPages(book, ch.chapterNumber, fontSizePt);
    sheets.push({
      id: `sheet_ch_${ch.chapterNumber}`,
      kind: 'chapter',
      titleFa: ch.title,
      runningHeaderFa: `${book.title} · ${ch.title}`,
      chapterNumber: ch.chapterNumber,
      pageNumber: runningPage,
      estimatedPrintedPages: est,
    });
    runningPage += est;
  }

  if (includeAppendices) {
    if (book.cheatSheets.length > 0) {
      sheets.push({
        id: 'sheet_cheatsheets',
        kind: 'cheatsheets',
        titleFa: 'پیوست ویژه: برگه تقلب و قوانین طلایی',
        runningHeaderFa: `${book.title} · برگه تقلب`,
        pageNumber: runningPage,
        estimatedPrintedPages: Math.max(1, Math.ceil(book.cheatSheets.length / 4)),
      });
      runningPage += Math.max(1, Math.ceil(book.cheatSheets.length / 4));
    }
    if (book.tableIndex.length > 0) {
      sheets.push({
        id: 'sheet_tables',
        kind: 'tables',
        titleFa: 'پیوست الف: فهرست جداول یکپارچه',
        runningHeaderFa: `${book.title} · فهرست جداول`,
        pageNumber: runningPage,
        estimatedPrintedPages: Math.max(1, Math.ceil(book.tableIndex.length / 22)),
      });
      runningPage += Math.max(1, Math.ceil(book.tableIndex.length / 22));
    }
    if (book.glossary.length > 0) {
      sheets.push({
        id: 'sheet_glossary',
        kind: 'glossary',
        titleFa: 'پیوست ب: واژه‌نامه یکپارچه',
        runningHeaderFa: `${book.title} · واژه‌نامه`,
        pageNumber: runningPage,
        estimatedPrintedPages: Math.max(1, Math.ceil(book.glossary.length / 14)),
      });
      runningPage += Math.max(1, Math.ceil(book.glossary.length / 14));
    }
    if (book.footnotes.length > 0) {
      sheets.push({
        id: 'sheet_footnotes',
        kind: 'footnotes',
        titleFa: 'پیوست ج: پانویس‌های یکتا',
        runningHeaderFa: `${book.title} · پانویس‌ها`,
        pageNumber: runningPage,
        estimatedPrintedPages: Math.max(1, Math.ceil(book.footnotes.length / 20)),
      });
      runningPage += Math.max(1, Math.ceil(book.footnotes.length / 20));
    }
  }

  return {
    sheets,
    totalSheets: sheets.length,
    estimatedTotalPages: Math.max(1, runningPage - 1),
  };
}
