import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LeaderType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  TabStopType,
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
  ContentBlock,
  DocxExportConfig,
  ParsedBook,
  TableBlock,
} from './bookTypes';
import { rasterizeBookDiagrams } from './aiOrganizer';
import { getCalloutTheme, SPECIAL_FRAME_THEMES } from './calloutThemes';
import {
  computeContentWidthDxa,
  enforceRtlOoxmlIntegrity,
  HEADER_CHAPTER_STYLEREF_MARKER,
} from './docxRtlPostProcessor';
import { segmentBidiTechnicalRuns } from './ecuTechnicalIntegrity';
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
 * Splits text containing inline **bold**, inline `code`, [[N]](#footnote-N) citations,
 * and technical LTR tokens (hex 0x..., DTC P0135, ECU ME7.4.4, ratios 14.7:1, signed -2.5°)
 * into UAX #9 BiDi-safe TextRuns with Vazir Medium on Persian runs and isolated LTR runs for technical tokens.
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
  const codeFont = { ascii: 'Consolas', hAnsi: 'Consolas', cs: fontFamily, eastAsia: fontFamily };

  const pushBidiSegmentedRuns = (textChunk: string, bold: boolean) => {
    const bidiSegments = segmentBidiTechnicalRuns(textChunk);
    for (const part of bidiSegments) {
      if (part.kind === 'ltr_code') {
        runs.push(
          new TextRun({
            text: `\u2066${part.text}\u2069`,
            font: codeFont,
            size: Math.max(16, sizeHalfPt - 1),
            bold,
            color: baseColor === COLORS.white ? COLORS.white : COLORS.primary,
            rightToLeft: false,
            language: { value: 'en-US' },
          })
        );
      } else if (part.kind === 'ltr_tech') {
        runs.push(
          new TextRun({
            text: `\u2066${part.text}\u2069`,
            font,
            size: sizeHalfPt,
            bold,
            color: baseColor,
            rightToLeft: false,
            language: { value: 'en-US' },
          })
        );
      } else {
        runs.push(
          new TextRun({
            text: part.text,
            font,
            size: sizeHalfPt,
            bold,
            color: baseColor,
            rightToLeft: true,
            language: { value: 'fa-IR', bidirectional: 'fa-IR' },
          })
        );
      }
    }
  };

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
      pushBidiSegmentedRuns(seg.slice(2, -2), true);
      continue;
    }

    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      runs.push(
        new TextRun({
          text: `\u2066${seg.slice(1, -1)}\u2069`,
          font: codeFont,
          size: Math.max(16, sizeHalfPt - 2),
          color: baseColor === COLORS.white ? COLORS.white : COLORS.primary,
          rightToLeft: false,
          language: { value: 'en-US' },
        })
      );
      continue;
    }

    pushBidiSegmentedRuns(seg, forceBold);
  }

  return runs;
}

function renderCalloutBox(callout: CalloutBlock, config: DocxExportConfig): Table {
  const theme = getCalloutTheme(callout.variant);
  const bodySize = Math.round(config.baseFontSizePt * 2);
  const cleanTitle = callout.title.replace(/^[⛔💡⚙️🔄❓📘]+\s*/, '').trim();
  const titleText =
    cleanTitle && !cleanTitle.includes(theme.labelFa)
      ? `${theme.labelFa} · ${cleanTitle}`
      : cleanTitle || theme.labelFa;

  const headerParagraph = new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.START,
    keepNext: true,
    widowControl: true,
    spacing: { before: 30, after: 30, line: 300 },
    children: buildInlineRuns(titleText, config.fontFamily, bodySize, theme.docxAccentHex, true),
  });

  const bodyParagraphs: Paragraph[] = callout.paragraphs.map(
    (p) =>
      new Paragraph({
        bidirectional: true,
        alignment: config.bodyAlignment === 'right' ? AlignmentType.START : AlignmentType.BOTH,
        widowControl: true,
        spacing: { before: 40, after: 65, line: 345 },
        children: buildInlineRuns(p, config.fontFamily, bodySize - 1, COLORS.ink, false),
      })
  );

  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: theme.docxBorderHex },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: theme.docxBorderHex },
      left: { style: BorderStyle.SINGLE, size: 6, color: theme.docxBorderHex },
      // Strong RTL right-edge accent stripe for clean technical book callouts
      right: { style: BorderStyle.SINGLE, size: 28, color: theme.docxAccentHex },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: theme.docxDividerHex },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            shading: { fill: theme.docxHeaderBgHex, type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 90, bottom: 90, left: 180, right: 200 },
            children: [headerParagraph],
          }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            shading: { fill: theme.docxBodyBgHex, type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 120, bottom: 120, left: 180, right: 200 },
            children:
              bodyParagraphs.length > 0
                ? bodyParagraphs
                : [
                    new Paragraph({
                      bidirectional: true,
                      alignment: AlignmentType.START,
                      children: [],
                    }),
                  ],
          }),
        ],
      }),
    ],
  });
}

function computeProportionalColumnWidths(headers: string[], rows: string[][]): number[] {
  const colCount = Math.max(1, headers.length);
  if (colCount === 1) return [100];
  const scores = Array.from({ length: colCount }, (_, colIdx) => {
    const headerLen = (headers[colIdx] || '').trim().length;
    let avgCellLen = 0;
    const sampleRows = rows.slice(0, 12);
    for (const r of sampleRows) {
      avgCellLen += Math.min(90, (r[colIdx] || '').trim().length);
    }
    const meanLen = sampleRows.length > 0 ? avgCellLen / sampleRows.length : headerLen;
    return Math.max(8, Math.round(headerLen * 0.45 + meanLen * 0.55));
  });
  const total = scores.reduce((a, b) => a + b, 0) || colCount;
  const minPct = Math.max(10, Math.floor(60 / colCount));
  const rawPcts = scores.map((s) => Math.max(minPct, Math.round((s / total) * 100)));
  const sum = rawPcts.reduce((a, b) => a + b, 0);
  if (sum !== 100) {
    const maxIdx = rawPcts.indexOf(Math.max(...rawPcts));
    rawPcts[maxIdx] = Math.max(minPct, rawPcts[maxIdx] + (100 - sum));
  }
  return rawPcts;
}

function renderDataTable(table: TableBlock, config: DocxExportConfig): Array<Paragraph | Table> {
  const elements: Array<Paragraph | Table> = [];
  const bodySize = Math.round(config.baseFontSizePt * 2);
  const cellSize = Math.max(17, bodySize - 2);

  if (table.caption) {
    elements.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.START,
        keepNext: true,
        widowControl: true,
        spacing: { before: 200, after: 80, line: 300 },
        children: buildInlineRuns(table.caption, config.fontFamily, bodySize, COLORS.primary, true),
      })
    );
  }

  const colWidths = computeProportionalColumnWidths(table.headers, table.rows);

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: table.headers.map(
      (h, colIdx) =>
        new TableCell({
          width: { size: colWidths[colIdx] ?? Math.floor(100 / Math.max(1, table.headers.length)), type: WidthType.PERCENTAGE },
          shading: { fill: COLORS.primary, type: ShadingType.CLEAR, color: 'auto' },
          margins: { top: 95, bottom: 95, left: 110, right: 110 },
          children: [
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.START,
              widowControl: true,
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
          (cell, colIdx) =>
            new TableCell({
              width: { size: colWidths[colIdx] ?? Math.floor(100 / Math.max(1, table.headers.length)), type: WidthType.PERCENTAGE },
              shading:
                rIdx % 2 === 1
                  ? { fill: COLORS.zebra, type: ShadingType.CLEAR, color: 'auto' }
                  : undefined,
              margins: { top: 80, bottom: 80, left: 110, right: 110 },
              children: [
                new Paragraph({
                  bidirectional: true,
                  alignment: AlignmentType.START,
                  widowControl: true,
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
        top: { style: BorderStyle.SINGLE, size: 10, color: COLORS.primary },
        bottom: { style: BorderStyle.SINGLE, size: 10, color: COLORS.primary },
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
          alignment: config.bodyAlignment === 'right' ? AlignmentType.START : AlignmentType.BOTH,
          widowControl: true,
          spacing: { before: 60, after: 115, line: 360 },
          children: buildInlineRuns(block.text, config.fontFamily, bodySize, COLORS.ink),
        }),
      ];

    case 'subheading':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          bidirectional: true,
          alignment: AlignmentType.START,
          keepNext: true,
          keepLines: true,
          widowControl: true,
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

    case 'equation': {
      const eqTheme = SPECIAL_FRAME_THEMES.equation;
      return [
        new Table({
          visuallyRightToLeft: true,
          width: { size: 100, type: WidthType.PERCENTAGE },
          layout: TableLayoutType.FIXED,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: eqTheme.docxBorderHex },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: eqTheme.docxBorderHex },
            left: { style: BorderStyle.SINGLE, size: 6, color: eqTheme.docxBorderHex },
            right: { style: BorderStyle.SINGLE, size: 6, color: eqTheme.docxBorderHex },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: eqTheme.docxBorderHex },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          },
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  shading: { fill: eqTheme.docxHeaderBgHex, type: ShadingType.CLEAR, color: 'auto' },
                  margins: { top: 60, bottom: 60, left: 140, right: 140 },
                  children: [
                    new Paragraph({
                      bidirectional: true,
                      alignment: AlignmentType.RIGHT,
                      children: buildInlineRuns(
                        eqTheme.labelFa,
                        config.fontFamily,
                        Math.max(16, bodySize - 3),
                        eqTheme.docxAccentHex,
                        true
                      ),
                    }),
                  ],
                }),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  shading: { fill: eqTheme.docxBodyBgHex, type: ShadingType.CLEAR, color: 'auto' },
                  margins: { top: 100, bottom: 100, left: 160, right: 160 },
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
                          color: eqTheme.docxAccentHex,
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
    }

    case 'list':
      return block.items.map(
        (item, idx) =>
          new Paragraph({
            bidirectional: true,
            alignment: config.bodyAlignment === 'right' ? AlignmentType.START : AlignmentType.BOTH,
            widowControl: true,
            // Under <w:bidi/> in OOXML, w:left is the visual RIGHT start-edge indent (hanging bullet)
            indent: { left: 420, hanging: 240 },
            spacing: { before: 40, after: 65, line: 345 },
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
  // 1. ARCHITECTURAL COVER PAGE (RTL)
  // =========================================================================
  if (config.includeCoverPage) {
    children.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.START,
        spacing: { before: 240, after: 180 },
        shading: { fill: COLORS.primary, type: ShadingType.CLEAR, color: 'auto' },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 18, color: 'B45309', space: 4 },
        },
        children: [
          new TextRun({
            text: '  نسخه صفحه‌آرایی‌شده و یکپارچه · استاندارد نشر فنی و مهندسی',
            font: fontSpec,
            size: 20,
            bold: true,
            color: COLORS.white,
            rightToLeft: true,
          }),
        ],
      }),
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.START,
        spacing: { before: 780, after: 220, line: 440 },
        border: {
          right: { style: BorderStyle.SINGLE, size: 32, color: COLORS.primary, space: 12 },
        },
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
        alignment: AlignmentType.START,
        spacing: { before: 80, after: 560, line: 380 },
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
      // Summary Edition & Integrity Card
      new Table({
        visuallyRightToLeft: true,
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 10, color: COLORS.primary },
          bottom: { style: BorderStyle.SINGLE, size: 10, color: COLORS.primary },
          left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
          right: { style: BorderStyle.SINGLE, size: 24, color: COLORS.primary },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        },
        rows: [
          ['فونت و قطع استاندارد', `${config.fontFamily} · قطع ${config.paperSize} (۱۰۰٪ راست‌چین / RTL)`],
          ['ساختار و حجم سند', `${toPersianDigits(book.volumes.length)} مجلد · ${toPersianDigits(book.chapters.length)} فصل · ${toPersianDigits(book.tableIndex.length)} جدول · ${toPersianDigits(book.footnotes.length)} پانویس یکتا`],
          ['تضمین حفظ مفاهیم فنی', `${toPersianDigits(book.audit?.conceptRetentionRate ?? 100)}٪ حفظ بدون افت محتوایی و عددهای کالیبراسیون`],
          ['اسناد ورودی مبنا', book.sourceFiles.join('، ')],
        ].map(
          ([k, v]) =>
            new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  width: { size: 32, type: WidthType.PERCENTAGE },
                  shading: { fill: COLORS.zebra, type: ShadingType.CLEAR, color: 'auto' },
                  margins: { top: 95, bottom: 95, left: 130, right: 140 },
                  children: [
                    new Paragraph({
                      bidirectional: true,
                      alignment: AlignmentType.START,
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
                  margins: { top: 95, bottom: 95, left: 130, right: 140 },
                  children: [
                    new Paragraph({
                      bidirectional: true,
                      alignment: AlignmentType.START,
                      children: buildInlineRuns(v, config.fontFamily, 20, COLORS.ink, false),
                    }),
                  ],
                }),
              ],
            })
        ),
      }),
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.START,
        spacing: { before: 640, after: 120, line: 320 },
        shading: { fill: COLORS.zebra, type: ShadingType.CLEAR, color: 'auto' },
        border: {
          right: { style: BorderStyle.SINGLE, size: 16, color: COLORS.border, space: 8 },
        },
        children: [
          new TextRun({
            text: 'راهنمای بروزرسانی شماره صفحات فهرست مطالب در Word: فهرست مطالب به‌صورت پیش‌فرض کاملاً راست‌چین و آماده نمایش است. در صورت ویرایش مجدد متن در مایکروسافت ورد، کافی است در پنجره Update Fields گزینه «Yes / بله» را بزنید یا با کلید F9 شماره صفحات را خودکار بروز کنید.',
            font: fontSpec,
            size: 18,
            color: COLORS.muted,
            rightToLeft: true,
          }),
        ],
      }),
      new Paragraph({ bidirectional: true, children: [new PageBreak()] })
    );
  }

  // =========================================================================
  // 2. 100% RTL AUTOMATIC WORD TABLE OF CONTENTS (Post-processed with pre-rendered rows + dot leaders)
  // =========================================================================
  if (config.includeAutoToc) {
    children.push(
      new Paragraph({
        style: 'TOCHeading',
        bidirectional: true,
        alignment: AlignmentType.START,
        keepNext: true,
        spacing: { before: 120, after: 220 },
        border: {
          right: { style: BorderStyle.SINGLE, size: 24, color: COLORS.primary, space: 8 },
          bottom: { style: BorderStyle.SINGLE, size: 10, color: COLORS.primary, space: 6 },
        },
        children: [
          new TextRun({
            text: 'فهرست مطالب',
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
      new Paragraph({ bidirectional: true, children: [new PageBreak()] })
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
        children.push(new Paragraph({ bidirectional: true, children: [new PageBreak()] }));
      }

      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          bidirectional: true,
          alignment: AlignmentType.START,
          keepNext: true,
          keepLines: true,
          spacing: { before: 320, after: 200, line: 380 },
          shading: { fill: COLORS.primaryLight, type: ShadingType.CLEAR, color: 'auto' },
          border: {
            right: { style: BorderStyle.SINGLE, size: 28, color: COLORS.primary, space: 10 },
            bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.primary, space: 6 },
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

    // Chapter Heading (Heading 2) — architectural banner with right vertical accent stripe
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        bidirectional: true,
        alignment: AlignmentType.START,
        pageBreakBefore: chapter.chapterNumber > 1,
        keepNext: true,
        keepLines: true,
        spacing: { before: 220, after: 160, line: 360 },
        shading: { fill: 'F4F7FA', type: ShadingType.CLEAR, color: 'auto' },
        border: {
          right: { style: BorderStyle.SINGLE, size: 28, color: COLORS.primary, space: 10 },
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

    // Chapter Metadata Strip (Warm Stone Card)
    if (config.includeChapterMetaCards && chapter.meta.length > 0) {
      children.push(
        new Table({
          visuallyRightToLeft: true,
          width: { size: 100, type: WidthType.PERCENTAGE },
          layout: TableLayoutType.FIXED,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
            left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
            right: { style: BorderStyle.SINGLE, size: 18, color: COLORS.primary },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E7E2D8' },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E7E2D8' },
          },
          rows: chapter.meta.map(
            (m) =>
              new TableRow({
                cantSplit: true,
                children: [
                  new TableCell({
                    width: { size: 26, type: WidthType.PERCENTAGE },
                    shading: { fill: 'EFECE4', type: ShadingType.CLEAR, color: 'auto' },
                    margins: { top: 65, bottom: 65, left: 100, right: 120 },
                    children: [
                      new Paragraph({
                        bidirectional: true,
                        alignment: AlignmentType.START,
                        children: buildInlineRuns(m.label, config.fontFamily, Math.max(17, bodySize - 2), COLORS.primary, true),
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 74, type: WidthType.PERCENTAGE },
                    shading: { fill: COLORS.zebra, type: ShadingType.CLEAR, color: 'auto' },
                    margins: { top: 65, bottom: 65, left: 100, right: 120 },
                    children: [
                      new Paragraph({
                        bidirectional: true,
                        alignment: AlignmentType.START,
                        children: buildInlineRuns(m.value, config.fontFamily, Math.max(17, bodySize - 2), COLORS.ink, false),
                      }),
                    ],
                  }),
                ],
              })
          ),
        }),
        new Paragraph({ bidirectional: true, spacing: { before: 0, after: 100 }, children: [] })
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
          alignment: AlignmentType.START,
          keepNext: true,
          keepLines: true,
          spacing: { before: 260, after: 110, line: 340 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border, space: 4 },
          },
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
  // 5. DOCUMENT STYLES, DYNAMIC STYLEREF HEADER, RTL TOC STYLES & SECTION CONFIG
  // =========================================================================
  const contentWidthDxa = computeContentWidthDxa(config);
  const tocTabStop = {
    type: TabStopType.RIGHT,
    leader: LeaderType.DOT,
    position: contentWidthDxa,
  };

  const headerObj = config.includeHeadersAndFooters
    ? new Header({
        children: [
          new Table({
            visuallyRightToLeft: true,
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
              left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
              right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
              insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
              insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
            },
            rows: [
              new TableRow({
                cantSplit: true,
                children: [
                  new TableCell({
                    width: { size: 52, type: WidthType.PERCENTAGE },
                    margins: { top: 0, bottom: 60, left: 60, right: 0 },
                    children: [
                      new Paragraph({
                        bidirectional: true,
                        alignment: AlignmentType.START,
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
                  }),
                  new TableCell({
                    width: { size: 48, type: WidthType.PERCENTAGE },
                    margins: { top: 0, bottom: 60, left: 0, right: 60 },
                    children: [
                      new Paragraph({
                        bidirectional: true,
                        alignment: AlignmentType.END,
                        children: [
                          new TextRun({
                            text: HEADER_CHAPTER_STYLEREF_MARKER,
                            font: fontSpec,
                            size: 17,
                            bold: true,
                            color: COLORS.primary,
                            rightToLeft: true,
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
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
              top: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border, space: 6 },
            },
            spacing: { before: 80, after: 0 },
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
                size: 19,
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
            language: { value: 'en-US', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
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
            language: { value: 'en-US', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            keepNext: true,
            keepLines: true,
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
            language: { value: 'en-US', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            keepNext: true,
            keepLines: true,
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
            language: { value: 'en-US', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            keepNext: true,
            keepLines: true,
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
            language: { value: 'en-US', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            keepNext: true,
            keepLines: true,
            spacing: { before: 180, after: 80 },
          },
        },
      },
      paragraphStyles: [
        {
          id: 'TOCHeading',
          name: 'TOC Heading',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            font: fontSpec,
            size: 34,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
            language: { value: 'fa-IR', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            keepNext: true,
            spacing: { before: 120, after: 200 },
          },
        },
        {
          id: 'TOC1',
          name: 'toc 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            font: fontSpec,
            size: 23,
            bold: true,
            color: COLORS.primary,
            rightToLeft: true,
            language: { value: 'fa-IR', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            spacing: { before: 140, after: 45, line: 300 },
          },
        },
        {
          id: 'TOC2',
          name: 'toc 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            font: fontSpec,
            size: 21,
            bold: true,
            color: COLORS.ink,
            rightToLeft: true,
            language: { value: 'fa-IR', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            indent: { left: 260 },
            spacing: { before: 70, after: 35, line: 300 },
          },
        },
        {
          id: 'TOC3',
          name: 'toc 3',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            font: fontSpec,
            size: 19,
            color: COLORS.muted,
            rightToLeft: true,
            language: { value: 'fa-IR', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            indent: { left: 560 },
            spacing: { before: 25, after: 25, line: 290 },
          },
        },
        {
          id: 'TOC4',
          name: 'toc 4',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            font: fontSpec,
            size: 18,
            color: COLORS.muted,
            rightToLeft: true,
            language: { value: 'fa-IR', bidirectional: 'fa-IR' },
          },
          paragraph: {
            alignment: AlignmentType.START,
            indent: { left: 820 },
            spacing: { before: 20, after: 20, line: 280 },
          },
        },
      ],
      characterStyles: [
        {
          id: 'Hyperlink',
          name: 'Hyperlink',
          run: {
            font: fontSpec,
            color: COLORS.primary,
            rightToLeft: true,
            language: { value: 'fa-IR', bidirectional: 'fa-IR' },
          },
        },
      ],
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

export async function generateDocxUint8Array(
  book: ParsedBook,
  config: DocxExportConfig
): Promise<Uint8Array> {
  const readyBook = await rasterizeBookDiagrams(book);
  const doc = buildWordDocument(readyBook, config);
  const rawBuffer = await Packer.toBuffer(doc);
  return enforceRtlOoxmlIntegrity(new Uint8Array(rawBuffer), readyBook, config);
}

export async function generateDocxBlob(book: ParsedBook, config: DocxExportConfig): Promise<Blob> {
  const readyBook = await rasterizeBookDiagrams(book);
  const doc = buildWordDocument(readyBook, config);
  const rawBlob = await Packer.toBlob(doc);
  const rawBytes = new Uint8Array(await rawBlob.arrayBuffer());
  const hardenedBytes = await enforceRtlOoxmlIntegrity(rawBytes, readyBook, config);
  const safeBuffer = new ArrayBuffer(hardenedBytes.byteLength);
  new Uint8Array(safeBuffer).set(hardenedBytes);
  return new Blob([safeBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
