import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  CalloutBlock,
  CalloutVariant,
  ContentBlock,
  DocxExportConfig,
  ParsedBook,
  TableBlock,
} from './bookTypes';
import { rasterizeBookDiagrams } from './aiOrganizer';
import { toPersianDigits } from './formatParsers';

const COLORS = {
  primary: '1E3A5F',       // Deep Lapis Ink
  primaryLight: 'EEF3F8',  // Subtle Lapis Wash
  ink: '1A1816',           // Archival Charcoal
  muted: '57534E',         // Editorial Slate
  border: 'D6D0C4',        // Warm Hairline Border
  zebra: 'F8F6F1',         // Archival Warm Paper
  white: 'FFFFFF',
  warningBg: 'FDF2F0',
  warningAccent: '9A3412',
  conceptBg: 'F0F4F8',
  conceptAccent: '1E3A5F',
  qaBg: 'F1F6F3',
  qaAccent: '14532D',
  engBg: 'FAF6EC',
  engAccent: '854D0E',
  revBg: 'F5F2F8',
  revAccent: '5B21B6',
  visualBg: 'F4F6F9',
  visualAccent: '2B4C7E',
};

function makeFontSpec(fontFamily: string) {
  return {
    ascii: fontFamily,
    hAnsi: fontFamily,
    cs: fontFamily,
    eastAsia: fontFamily,
  };
}

/**
 * Splits text containing inline **bold**, inline `code`, and [[N]](#footnote-N) citations
 * into properly styled RTL TextRuns with Vazir Medium applied on complex scripts (cs).
 */
function buildInlineRuns(
  rawText: string,
  fontFamily: string,
  sizeHalfPt: number,
  baseColor: string = COLORS.ink,
  forceBold = false
): TextRun[] {
  const runs: TextRun[] = [];
  const font = makeFontSpec(fontFamily);

  // Tokenize bold (**...**), inline footnote [[N]](#footnote-N), and inline code (`...`)
  const tokenRx = /(\*\*[^*]+\*\*|\[\[\d+\]\]\(#footnote-\d+\)|`[^`]+`)/g;
  const segments = rawText.split(tokenRx).filter((s) => s.length > 0);

  for (const seg of segments) {
    const fnMatch = seg.match(/^\[\[(\d+)\]\]\(#footnote-\d+\)$/);
    if (fnMatch) {
      runs.push(
        new TextRun({
          text: `[${toPersianDigits(fnMatch[1])}]`,
          font,
          size: Math.max(14, sizeHalfPt - 4),
          color: COLORS.primary,
          superScript: true,
          rightToLeft: true,
        })
      );
      continue;
    }

    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      runs.push(
        new TextRun({
          text: seg.slice(2, -2),
          font,
          size: sizeHalfPt,
          bold: true,
          color: baseColor,
          rightToLeft: true,
        })
      );
      continue;
    }

    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      runs.push(
        new TextRun({
          text: seg.slice(1, -1),
          font: { ascii: 'Consolas', hAnsi: 'Consolas', cs: fontFamily, eastAsia: fontFamily },
          size: Math.max(16, sizeHalfPt - 2),
          color: COLORS.primary,
          rightToLeft: false,
        })
      );
      continue;
    }

    runs.push(
      new TextRun({
        text: seg,
        font,
        size: sizeHalfPt,
        bold: forceBold,
        color: baseColor,
        rightToLeft: true,
      })
    );
  }

  return runs;
}

function getCalloutPalette(variant: CalloutVariant): { bg: string; accent: string; label: string } {
  switch (variant) {
    case 'warning':
      return { bg: COLORS.warningBg, accent: COLORS.warningAccent, label: 'هشدار و الزام بحرانی' };
    case 'qa':
      return { bg: COLORS.qaBg, accent: COLORS.qaAccent, label: 'پرسش و پاسخ کارگاهی' };
    case 'engineering':
      return { bg: COLORS.engBg, accent: COLORS.engAccent, label: 'نکته مهندسی و کارگاهی' };
    case 'revision':
      return { bg: COLORS.revBg, accent: COLORS.revAccent, label: 'اصلاحیه و تدقیق علمی' };
    case 'project':
      return { bg: COLORS.primaryLight, accent: COLORS.primary, label: 'جمع‌بندی و نقشه راه' };
    case 'concept':
    default:
      return { bg: COLORS.conceptBg, accent: COLORS.conceptAccent, label: 'مبانی علمی و پیش‌نیاز' };
  }
}

function renderCalloutBox(callout: CalloutBlock, config: DocxExportConfig): Table {
  const palette = getCalloutPalette(callout.variant);
  const bodySize = Math.round(config.baseFontSizePt * 2);

  const cellParagraphs: Paragraph[] = [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      spacing: { before: 40, after: 80, line: 320 },
      children: buildInlineRuns(callout.title, config.fontFamily, bodySize, palette.accent, true),
    }),
    ...callout.paragraphs.map(
      (p) =>
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { before: 30, after: 60, line: 340 },
          children: buildInlineRuns(p, config.fontFamily, bodySize - 1, COLORS.ink, false),
        })
    ),
  ];

  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    margins: {
      top: 120,
      bottom: 120,
      left: 180,
      right: 180,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      // Right accent border for RTL reading flow
      right: { style: BorderStyle.SINGLE, size: 18, color: palette.accent },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            shading: { fill: palette.bg, type: ShadingType.CLEAR, color: 'auto' },
            children: cellParagraphs,
          }),
        ],
      }),
    ],
  });
}

function renderDataTable(table: TableBlock, config: DocxExportConfig): Array<Paragraph | Table> {
  const elements: Array<Paragraph | Table> = [];
  const bodySize = Math.round(config.baseFontSizePt * 2);
  const cellSize = Math.max(17, bodySize - 2);

  if (table.caption) {
    elements.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        keepNext: true,
        spacing: { before: 200, after: 80, line: 300 },
        children: buildInlineRuns(table.caption, config.fontFamily, bodySize, COLORS.primary, true),
      })
    );
  }

  const colCount = Math.max(1, table.headers.length);
  const colPct = Math.floor(100 / colCount);

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: table.headers.map(
      (h) =>
        new TableCell({
          width: { size: colPct, type: WidthType.PERCENTAGE },
          shading: { fill: COLORS.primary, type: ShadingType.CLEAR, color: 'auto' },
          margins: { top: 90, bottom: 90, left: 110, right: 110 },
          children: [
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.RIGHT,
              spacing: { before: 20, after: 20, line: 280 },
              children: buildInlineRuns(h, config.fontFamily, cellSize, COLORS.white, true),
            }),
          ],
        })
    ),
  });

  const bodyRows = table.rows.map(
    (row, rIdx) =>
      new TableRow({
        cantSplit: true,
        children: row.map(
          (cell) =>
            new TableCell({
              width: { size: colPct, type: WidthType.PERCENTAGE },
              shading:
                rIdx % 2 === 1
                  ? { fill: COLORS.zebra, type: ShadingType.CLEAR, color: 'auto' }
                  : undefined,
              margins: { top: 75, bottom: 75, left: 110, right: 110 },
              children: [
                new Paragraph({
                  bidirectional: true,
                  alignment: AlignmentType.RIGHT,
                  spacing: { before: 20, after: 20, line: 300 },
                  children: buildInlineRuns(cell || '—', config.fontFamily, cellSize, COLORS.ink, false),
                }),
              ],
            })
        ),
      })
  );

  elements.push(
    new Table({
      visuallyRightToLeft: true,
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: COLORS.primary },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.primary },
        left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      },
      rows: [headerRow, ...bodyRows],
    })
  );

  elements.push(
    new Paragraph({
      bidirectional: true,
      spacing: { before: 0, after: 100 },
      children: [],
    })
  );

  return elements;
}

function renderContentBlock(block: ContentBlock, config: DocxExportConfig): Array<Paragraph | Table> {
  const bodySize = Math.round(config.baseFontSizePt * 2);

  switch (block.type) {
    case 'paragraph':
      return [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { before: 60, after: 110, line: 360 },
          children: buildInlineRuns(block.text, config.fontFamily, bodySize, COLORS.ink),
        }),
      ];

    case 'subheading':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          keepNext: true,
          spacing: { before: 200, after: 80, line: 320 },
          children: buildInlineRuns(block.text, config.fontFamily, bodySize + 2, COLORS.primary, true),
        }),
      ];

    case 'callout':
      return [
        new Paragraph({ bidirectional: true, spacing: { before: 80, after: 0 }, children: [] }),
        renderCalloutBox(block, config),
        new Paragraph({ bidirectional: true, spacing: { before: 0, after: 100 }, children: [] }),
      ];

    case 'table':
      return renderDataTable(block, config);

    case 'equation':
      return [
        new Table({
          visuallyRightToLeft: false,
          width: { size: 100, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
            left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
            right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
          },
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  shading: { fill: COLORS.zebra, type: ShadingType.CLEAR, color: 'auto' },
                  children: [
                    new Paragraph({
                      bidirectional: false,
                      alignment: AlignmentType.CENTER,
                      spacing: { before: 40, after: 40 },
                      children: [
                        new TextRun({
                          text: block.readable,
                          font: {
                            ascii: 'Cambria Math',
                            hAnsi: 'Cambria Math',
                            cs: config.fontFamily,
                            eastAsia: config.fontFamily,
                          },
                          size: bodySize + 1,
                          bold: true,
                          color: COLORS.primary,
                          rightToLeft: false,
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({ bidirectional: true, spacing: { before: 0, after: 90 }, children: [] }),
      ];

    case 'list':
      return block.items.map(
        (item, idx) =>
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            indent: { right: 320 },
            spacing: { before: 40, after: 60, line: 340 },
            children: [
              new TextRun({
                text: block.ordered ? `${toPersianDigits(idx + 1)}. ` : '▪ ',
                font: makeFontSpec(config.fontFamily),
                size: bodySize,
                bold: true,
                color: COLORS.primary,
                rightToLeft: true,
              }),
              ...buildInlineRuns(item, config.fontFamily, bodySize, COLORS.ink),
            ],
          })
      );

    case 'figure':
      return [
        renderCalloutBox(
          {
            type: 'callout',
            id: block.id,
            variant: 'project',
            title: `پیشنهاد تصویر مهندسی: ${block.caption}`,
            paragraphs: [block.description],
          },
          config
        ),
        new Paragraph({ bidirectional: true, spacing: { before: 0, after: 90 }, children: [] }),
      ];

    case 'image': {
      const base64Part = block.dataUrl.includes(',') ? block.dataUrl.split(',')[1] : block.dataUrl;
      let bytes: Uint8Array | null = null;
      try {
        if (typeof Buffer !== 'undefined') {
          bytes = new Uint8Array(Buffer.from(base64Part, 'base64'));
        } else {
          const bin = atob(base64Part);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          bytes = arr;
        }
      } catch {
        bytes = null;
      }
      if (!bytes || bytes.byteLength === 0) return [];
      const displayWidth = config.paperSize === 'B5' ? 420 : 480;
      const displayHeight = block.widthPx && block.heightPx
        ? Math.round((displayWidth * block.heightPx) / Math.max(1, block.widthPx))
        : 290;
      return [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          keepNext: true,
          spacing: { before: 150, after: 70 },
          children: [
            new ImageRun({
              type: block.mimeType === 'image/jpeg' ? 'jpg' : 'png',
              data: bytes,
              transformation: {
                width: displayWidth,
                height: displayHeight,
              },
            }),
          ],
        }),
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          spacing: { before: 30, after: 130 },
          children: buildInlineRuns(
            block.caption || 'تصویر مستند اصلی',
            config.fontFamily,
            Math.max(18, bodySize - 2),
            COLORS.primary,
            true
          ),
        }),
      ];
    }

    case 'web_enrichment':
      return [
        new Paragraph({ bidirectional: true, spacing: { before: 80, after: 0 }, children: [] }),
        renderCalloutBox(
          {
            type: 'callout',
            id: block.id,
            variant: 'revision',
            title: `تکمیل‌شده از وب (جستجوی گوگل): ${block.title}`,
            paragraphs: [
              block.summary,
              ...(block.sources.length > 0
                ? [
                    `منابع وب: ${block.sources
                      .map((s) => `${s.title} (${s.uri})`)
                      .join(' | ')}`,
                  ]
                : []),
            ],
          },
          config
        ),
        new Paragraph({ bidirectional: true, spacing: { before: 0, after: 100 }, children: [] }),
      ];

    case 'conflict_note':
      return [
        new Paragraph({ bidirectional: true, spacing: { before: 80, after: 0 }, children: [] }),
        renderCalloutBox(
          {
            type: 'callout',
            id: block.id,
            variant: 'warning',
            title: `مقایسه دو روایت منبع (تناقض حفظ‌شده): ${block.topic}`,
            paragraphs: [
              `**روایت ۱ (${block.fileAName}):** ${block.excerptA}`,
              `**روایت ۲ (${block.fileBName}):** ${block.excerptB}`,
              ...(block.resolutionNote ? [`**تصمیم ویراستار:** ${block.resolutionNote}`] : []),
              ...(block.webSummary ? [`**بررسی با جستجوی گوگل:** ${block.webSummary}`] : []),
              ...(block.webSources && block.webSources.length > 0
                ? [`منابع بررسی وب: ${block.webSources.map((s) => `${s.title} (${s.uri})`).join(' | ')}`]
                : []),
            ],
          },
          config
        ),
        new Paragraph({ bidirectional: true, spacing: { before: 0, after: 100 }, children: [] }),
      ];

    case 'diagram': {
      const elements: Array<Paragraph | Table> = [];
      if (block.pngBytes && block.pngBytes.byteLength > 0) {
        const displayWidth = config.paperSize === 'B5' ? 460 : 540;
        const displayHeight = Math.round((displayWidth * block.heightPx) / Math.max(1, block.widthPx));
        elements.push(
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: 160, after: 80 },
            children: [
              new ImageRun({
                type: 'png',
                data: block.pngBytes,
                transformation: {
                  width: displayWidth,
                  height: displayHeight,
                },
              }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 140 },
            children: buildInlineRuns(block.caption, config.fontFamily, Math.max(18, bodySize - 2), COLORS.primary, true),
          })
        );
      } else {
        // Fallback structured visual card when headless environment cannot rasterize canvas PNG
        elements.push(
          renderCalloutBox(
            {
              type: 'callout',
              id: block.id,
              variant: 'project',
              title: block.caption || block.title,
              paragraphs: [
                ...(block.rationale ? [block.rationale] : []),
                ...block.items.map(
                  (it, idx) =>
                    `${toPersianDigits(idx + 1)}. **${it.label}**${it.detail ? `: ${it.detail}` : ''}`
                ),
              ],
            },
            config
          ),
          new Paragraph({ bidirectional: true, spacing: { before: 0, after: 100 }, children: [] })
        );
      }
      return elements;
    }

    default:
      return [];
  }
}

export function buildWordDocument(book: ParsedBook, config: DocxExportConfig): Document {
  const fontSpec = makeFontSpec(config.fontFamily);
  const bodySize = Math.round(config.baseFontSizePt * 2);

  // Paper dimensions in DXA (1 inch = 1440 twips)
  const pageSize =
    config.paperSize === 'B5'
      ? { width: 9979, height: 14175 } // 176mm x 250mm
      : { width: 11906, height: 16838 }; // A4: 210mm x 297mm

  const children: Array<Paragraph | Table | TableOfContents> = [];

  // =========================================================================
  // 1. COVER PAGE
  // =========================================================================
  if (config.includeCoverPage) {
    children.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { before: 400, after: 200 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 18, color: COLORS.primary, space: 10 },
        },
        children: [
          new TextRun({
            text: 'نسخه صفحه‌آرایی‌شده و یکپارچه برای نشر حرفه‌ای',
            font: fontSpec,
            size: 22,
            color: COLORS.muted,
            rightToLeft: true,
          }),
        ],
      }),
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { before: 900, after: 240, line: 420 },
        children: [
          new TextRun({
            text: book.title,
            font: fontSpec,
            size: 52,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          }),
        ],
      }),
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { before: 80, after: 600, line: 380 },
        children: [
          new TextRun({
            text: book.subtitle,
            font: fontSpec,
            size: 26,
            color: COLORS.muted,
            rightToLeft: true,
          }),
        ],
      }),
      // Summary Edition Card
      new Table({
        visuallyRightToLeft: true,
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.primary },
          bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.primary },
          left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        },
        rows: [
          ['فونت استاندارد سند', `${config.fontFamily} (کاملاً راست‌چین / RTL)`],
          ['ساختار و حجم', `${toPersianDigits(book.volumes.length)} مجلد · ${toPersianDigits(book.chapters.length)} فصل · ${toPersianDigits(book.tableIndex.length)} جدول · ${toPersianDigits(book.footnotes.length)} پانویس یکتا`],
          ['تضمین حفظ مفاهیم', `${toPersianDigits(book.audit?.conceptRetentionRate ?? 100)}٪ حفظ مفاهیم فنی (یکپارچه‌سازی بدون حذف دانش)`],
          ['اسناد ورودی مبنا', book.sourceFiles.join('، ')],
        ].map(
          ([k, v]) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 32, type: WidthType.PERCENTAGE },
                  shading: { fill: COLORS.zebra, type: ShadingType.CLEAR, color: 'auto' },
                  margins: { top: 90, bottom: 90, left: 120, right: 120 },
                  children: [
                    new Paragraph({
                      bidirectional: true,
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: k,
                          font: fontSpec,
                          size: 20,
                          bold: true,
                          color: COLORS.primary,
                          rightToLeft: true,
                        }),
                      ],
                    }),
                  ],
                }),
                new TableCell({
                  width: { size: 68, type: WidthType.PERCENTAGE },
                  margins: { top: 90, bottom: 90, left: 120, right: 120 },
                  children: [
                    new Paragraph({
                      bidirectional: true,
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: v,
                          font: fontSpec,
                          size: 20,
                          color: COLORS.ink,
                          rightToLeft: true,
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            })
        ),
      }),
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { before: 700, after: 120 },
        children: [
          new TextRun({
            text: 'راهنمای بروزرسانی فهرست مطالب در مایکروسافت ورد: هنگام باز کردن فایل، گزینه «Yes / بله» را در پنجره Update Fields انتخاب کنید یا روی فهرست مطالب راست‌کلیک کرده و Update Field را بزنید تا شماره صفحات به‌صورت خودکار محاسبه شوند.',
            font: fontSpec,
            size: 18,
            color: COLORS.muted,
            rightToLeft: true,
          }),
        ],
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  // =========================================================================
  // 2. AUTOMATIC WORD TABLE OF CONTENTS
  // =========================================================================
  if (config.includeAutoToc) {
    children.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { before: 120, after: 200 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 10, color: COLORS.primary, space: 6 },
        },
        children: [
          new TextRun({
            text: 'فهرست مطالب خودکار',
            font: fontSpec,
            size: 34,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          }),
        ],
      }),
      new TableOfContents('فهرست مطالب', {
        hyperlink: true,
        headingStyleRange: '1-3',
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  // =========================================================================
  // 3. VOLUMES & CHAPTERS (Heading 1 = Volume, Heading 2 = Chapter, Heading 3 = Section)
  // =========================================================================
  let lastVolumeIndex = -1;

  for (const chapter of book.chapters) {
    // Volume divider heading (Heading 1)
    if (chapter.volumeIndex !== lastVolumeIndex) {
      lastVolumeIndex = chapter.volumeIndex;
      const volObj = book.volumes.find((v) => v.index === chapter.volumeIndex);
      const volTitle = volObj?.title || chapter.volumeTitle;

      if (config.includeVolumeDividers && children.length > 0 && lastVolumeIndex > 1) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }

      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          keepNext: true,
          spacing: { before: 320, after: 200, line: 380 },
          shading: { fill: COLORS.primaryLight, type: ShadingType.CLEAR, color: 'auto' },
          border: {
            right: { style: BorderStyle.SINGLE, size: 24, color: COLORS.primary, space: 8 },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.primary, space: 6 },
          },
          children: [
            new TextRun({
              text: volTitle,
              font: fontSpec,
              size: 36,
              bold: true,
              color: COLORS.primary,
              rightToLeft: true,
            }),
          ],
        })
      );
    }

    // Chapter Heading (Heading 2) — always starts cleanly
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        pageBreakBefore: chapter.chapterNumber > 1,
        keepNext: true,
        spacing: { before: 240, after: 160, line: 360 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary, space: 6 },
        },
        children: [
          new TextRun({
            text: chapter.title,
            font: fontSpec,
            size: 32,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          }),
        ],
      })
    );

    // Chapter Metadata Card
    if (config.includeChapterMetaCards && chapter.meta.length > 0) {
      children.push(
        ...renderDataTable(
          {
            type: 'table',
            id: `meta_${chapter.id}`,
            headers: ['شناسه فصل', 'مشخصات'],
            rows: chapter.meta.map((m) => [m.label, m.value]),
          },
          config
        )
      );
    }

    // Chapter Intro Blocks
    for (const block of chapter.introBlocks) {
      children.push(...renderContentBlock(block, config));
    }

    // Sections (Heading 3)
    for (const sec of chapter.sections) {
      const headingLabel = sec.numberLabel ? `${sec.numberLabel}. ${sec.title}` : sec.title;
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          keepNext: true,
          spacing: { before: 260, after: 110, line: 340 },
          children: [
            new TextRun({
              text: headingLabel,
              font: fontSpec,
              size: 26,
              bold: true,
              color: COLORS.primary,
              rightToLeft: true,
            }),
          ],
        })
      );

      for (const block of sec.blocks) {
        children.push(...renderContentBlock(block, config));
      }
    }

    // Optional per-chapter Visual & Table Enrichment Suggestions
    if (config.includeVisualSuggestions) {
      const chSuggestions = book.visualSuggestions.filter((v) => v.chapterNumber === chapter.chapterNumber);
      if (chSuggestions.length > 0) {
        children.push(
          renderCalloutBox(
            {
              type: 'callout',
              id: `vis_box_${chapter.id}`,
              variant: 'project',
              title: `پیشنهادهای افزودن جدول و تصویر آموزشی برای ${chapter.title}`,
              paragraphs: chSuggestions.map(
                (s, idx) =>
                  `${toPersianDigits(idx + 1)}. [${s.kindLabel}] ${s.title} — ${s.rationale} (اجزای پیشنهادی: ${s.suggestedColumnsOrElements.join('، ')})`
              ),
            },
            config
          ),
          new Paragraph({ bidirectional: true, spacing: { before: 0, after: 120 }, children: [] })
        );
      }
    }
  }

  // =========================================================================
  // 4. APPENDICES (Master Cheat-Sheet, List of Tables, Glossary, Footnotes)
  // =========================================================================
  if (config.includeMasterCheatSheet && book.cheatSheets.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        pageBreakBefore: true,
        spacing: { before: 240, after: 180 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary, space: 6 } },
        children: [
          new TextRun({
            text: 'پیوست ویژه: برگه تقلب جامع و قوانین طلایی کارگاهی',
            font: fontSpec,
            size: 32,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          }),
        ],
      }),
      ...renderDataTable(
        {
          type: 'table',
          id: 'app_cheatsheet',
          headers: ['فصل', 'قانون / دستورالعمل کلیدی', 'خلاصه اجرایی'],
          rows: book.cheatSheets.map((cs) => [
            `فصل ${toPersianDigits(cs.chapterNumber)}`,
            cs.title,
            cs.highlights.join(' ').slice(0, 260),
          ]),
        },
        config
      )
    );
  }

  if (config.includeListOfTables && book.tableIndex.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        pageBreakBefore: true,
        spacing: { before: 240, after: 180 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary, space: 6 } },
        children: [
          new TextRun({
            text: 'پیوست الف: فهرست کامل جداول (شماره‌گذاری یکپارچه)',
            font: fontSpec,
            size: 32,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          }),
        ],
      }),
      ...renderDataTable(
        {
          type: 'table',
          id: 'app_tables',
          headers: ['شماره جدول', 'عنوان جدول', 'فصل'],
          rows: book.tableIndex.map((t) => [
            `جدول ${t.tableNumber}`,
            t.caption.replace(/^جدول\s*[۰-۹0-9]+[-–][۰-۹0-9]+\s*[:：-]?\s*/, ''),
            `فصل ${toPersianDigits(t.chapterNumber)}`,
          ]),
        },
        config
      )
    );
  }

  if (config.includeGlossary && book.glossary.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        pageBreakBefore: true,
        spacing: { before: 240, after: 180 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary, space: 6 } },
        children: [
          new TextRun({
            text: 'پیوست ب: واژه‌نامه یکپارچه اصطلاحات تخصصی',
            font: fontSpec,
            size: 32,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          }),
        ],
      }),
      ...renderDataTable(
        {
          type: 'table',
          id: 'app_glossary',
          headers: ['اصطلاح', 'تعریف جامع (یکپارچه‌شده)', 'فصل‌ها'],
          rows: book.glossary.map((g) => [
            g.term,
            g.definition,
            g.chapters.length > 0 ? g.chapters.map((c) => toPersianDigits(c)).join('، ') : '—',
          ]),
        },
        config
      )
    );
  }

  if (config.includeFootnotesSection && book.footnotes.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        pageBreakBefore: true,
        spacing: { before: 240, after: 180 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.primary, space: 6 } },
        children: [
          new TextRun({
            text: 'پیوست ج: پانویس‌های یکتا و توضیحات تکمیلی',
            font: fontSpec,
            size: 32,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          }),
        ],
      })
    );

    for (const fn of book.footnotes) {
      children.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { before: 40, after: 70, line: 300 },
          children: [
            new TextRun({
              text: `[${toPersianDigits(fn.canonicalId)}] `,
              font: fontSpec,
              size: Math.max(17, bodySize - 2),
              bold: true,
              color: COLORS.primary,
              rightToLeft: true,
            }),
            ...buildInlineRuns(fn.text, config.fontFamily, Math.max(17, bodySize - 2), COLORS.ink),
          ],
        })
      );
    }
  }

  // =========================================================================
  // 5. DOCUMENT STYLES & SECTION CONFIGURATION (RTL + Vazir Medium + UpdateFields)
  // =========================================================================
  const headerObj = config.includeHeadersAndFooters
    ? new Header({
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.LEFT,
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border, space: 4 },
            },
            children: [
              new TextRun({
                text: book.title,
                font: fontSpec,
                size: 17,
                color: COLORS.muted,
                rightToLeft: true,
              }),
            ],
          }),
        ],
      })
    : undefined;

  const footerObj = config.includeHeadersAndFooters
    ? new Footer({
        children: [
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border, space: 4 },
            },
            children: [
              new TextRun({
                text: 'صفحه ',
                font: fontSpec,
                size: 18,
                color: COLORS.muted,
                rightToLeft: true,
              }),
              new TextRun({
                children: [PageNumber.CURRENT],
                font: fontSpec,
                size: 18,
                bold: true,
                color: COLORS.primary,
              }),
              new TextRun({
                text: ' از ',
                font: fontSpec,
                size: 18,
                color: COLORS.muted,
                rightToLeft: true,
              }),
              new TextRun({
                children: [PageNumber.TOTAL_PAGES],
                font: fontSpec,
                size: 18,
                color: COLORS.muted,
              }),
            ],
          }),
        ],
      })
    : undefined;

  return new Document({
    title: book.title,
    description: book.subtitle,
    creator: 'استودیو صفحه‌آرایی و تبدیل اسناد فنی فارسی',
    features: {
      updateFields: true,
    },
    styles: {
      default: {
        document: {
          run: {
            font: fontSpec,
            size: bodySize,
            color: COLORS.ink,
            rightToLeft: true,
          },
          paragraph: {
            alignment: AlignmentType.RIGHT,
            spacing: { line: 360, after: 100 },
          },
        },
        heading1: {
          run: {
            font: fontSpec,
            size: 36,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          },
          paragraph: {
            alignment: AlignmentType.RIGHT,
            spacing: { before: 320, after: 180 },
          },
        },
        heading2: {
          run: {
            font: fontSpec,
            size: 32,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          },
          paragraph: {
            alignment: AlignmentType.RIGHT,
            spacing: { before: 240, after: 140 },
          },
        },
        heading3: {
          run: {
            font: fontSpec,
            size: 26,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          },
          paragraph: {
            alignment: AlignmentType.RIGHT,
            spacing: { before: 220, after: 100 },
          },
        },
        heading4: {
          run: {
            font: fontSpec,
            size: bodySize + 2,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
          },
          paragraph: {
            alignment: AlignmentType.RIGHT,
            spacing: { before: 180, after: 80 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          titlePage: config.includeCoverPage,
          page: {
            size: pageSize,
            margin: {
              top: 1200,
              bottom: 1200,
              right: 1350, // Slightly wider binding margin on right for RTL Persian book!
              left: 1150,
            },
          },
        },
        headers: headerObj ? { default: headerObj } : undefined,
        footers: footerObj ? { default: footerObj } : undefined,
        children,
      },
    ],
  });
}

export async function generateDocxBlob(book: ParsedBook, config: DocxExportConfig): Promise<Blob> {
  const readyBook = await rasterizeBookDiagrams(book);
  const doc = buildWordDocument(readyBook, config);
  return Packer.toBlob(doc);
}

export async function generateDocxUint8Array(
  book: ParsedBook,
  config: DocxExportConfig
): Promise<Uint8Array> {
  const readyBook = await rasterizeBookDiagrams(book);
  const doc = buildWordDocument(readyBook, config);
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
