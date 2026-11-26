import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookSlidesPlan,
  buildBookSpreadsheetReportPayload,
  buildGoogleDocSegmentsFromBook,
  buildMultipartRelatedUploadPayload,
  convertSheetValuesToMarkdown,
  createGoogleDriveService,
  DOCX_MIME_TYPE,
  extractPresentationTextToMarkdown,
  GOOGLE_WORKSPACE_SCOPES,
  normalizeDriveExportFileName,
} from './googleWorkspace.ts';
import type { ParsedBook } from './bookTypes.ts';
import type { WinolsExtractionReport } from './winolsMapGuide.ts';

test('GOOGLE_WORKSPACE_SCOPES includes required Drive, Sheets, Docs, and Slides scopes without duplicates', () => {
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/drive.file'));
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.ok(
    GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/spreadsheets.readonly')
  );
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/documents'));
  assert.ok(
    GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/documents.readonly')
  );
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/presentations'));
  assert.ok(
    GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/presentations.readonly')
  );
  assert.equal(new Set(GOOGLE_WORKSPACE_SCOPES).size, GOOGLE_WORKSPACE_SCOPES.length);
});

test('convertSheetValuesToMarkdown preserves table headers and rows losslessly', () => {
  const md = convertSheetValuesToMarkdown({
    spreadsheetTitle: 'جداول کالیبراسیون',
    sheetTitle: 'آدرس‌های زیمنس',
    values: [
      ['نقشه', 'آدرس هگز', 'تغییر مجاز'],
      ['KFZW', '0x1A4F0', '+2°'],
      ['LAMFA', '0x1B200', '0.85'],
    ],
  });

  assert.ok(md.includes('# جداول کالیبراسیون — آدرس‌های زیمنس'));
  assert.ok(md.includes('| نقشه | آدرس هگز | تغییر مجاز |'));
  assert.ok(md.includes('| KFZW | 0x1A4F0 | +2° |'));
  assert.ok(md.includes('| LAMFA | 0x1B200 | 0.85 |'));
});

test('buildBookSpreadsheetReportPayload generates Audit, Chapters, and WinOLS Maps tabs from book data', () => {
  const book: ParsedBook = {
    title: 'کتاب مرجع ECU',
    subtitle: 'جلد اول',
    editionNote: '',
    sourceFiles: ['a.md'],
    volumes: [],
    chapters: [
      {
        id: 'ch1',
        chapterNumber: 1,
        title: 'فصل ۱: آوانس جرقه',
        volumeIndex: 1,
        volumeTitle: 'جلد ۱',
        meta: [],
        sourceFileName: 'a.md',
        introBlocks: [],
        sections: [
          {
            id: 's1',
            numberLabel: '۱-۱',
            title: 'نقشه KFZW',
            originalTitle: 'نقشه KFZW',
            blocks: [{ type: 'paragraph', id: 'p1', text: 'متن فنی.' }],
          },
        ],
      },
    ],
    glossary: [],
    footnotes: [],
    tableIndex: [],
    cheatSheets: [],
    visualSuggestions: [],
    sourceMapRows: [],
  };

  const winolsReport: WinolsExtractionReport = {
    mapsDetected: 1,
    generatedAt: '2026-11-24T00:00:00Z',
    summaryTable: null,
    entries: [
      {
        id: 'm1',
        mapCode: 'KFZW',
        mapNameFa: 'آوانس جرقه',
        category: 'ignition',
        categoryLabelFa: 'جرقه‌زنی',
        ecuModels: ['ME7.4.4'],
        hexAddresses: ['0x1A4F0'],
        dimensions: '12x16',
        isScalar: false,
        targetRpmRange: { min: 3000, max: 5500 },
        targetLoadRange: { min: 70, max: 100 },
        targetZoneLabelFa: '۳۰۰۰-۵۵۰۰',
        modificationSummaryFa: 'اصلاح',
        numericValuesDetected: ['+2°'],
        recommendedDeltaLabel: '+2.0°',
        safetyChecklistFa: 'کنترل ناک',
        winolsStepsFa: ['گام ۱'],
        sourceFiles: ['a.md'],
        evidenceSnippets: [],
        zoneMatrix: null,
        confidence: 'high',
        damosMeta: { factor: 0.75, offset: -23.6, dataOrg: '8bit' },
      },
    ],
  };

  const tabs = buildBookSpreadsheetReportPayload({ book, winolsReport });
  assert.equal(tabs.length, 3);
  assert.equal(tabs[0].tabTitle, 'خلاصه_ممیزی');
  assert.equal(tabs[1].tabTitle, 'فهرست_فصل‌ها');
  assert.equal(tabs[2].tabTitle, 'نقشه‌های_WinOLS');
  assert.ok(tabs[2].rows.some((r) => r.includes('KFZW') && r.includes('0x1A4F0')));

  const docSegments = buildGoogleDocSegmentsFromBook(book);
  assert.ok(docSegments.some((s) => s.namedStyleType === 'TITLE' && s.text.includes('کتاب مرجع ECU')));
  assert.ok(docSegments.some((s) => s.namedStyleType === 'HEADING_1' && s.text.includes('آوانس جرقه')));

  const slidePlan = buildBookSlidesPlan({ book, winolsReport });
  assert.equal(slidePlan.length, 3);
  assert.equal(slidePlan[0].slideId, 'slide_cover');
  assert.ok(slidePlan[2].body.includes('KFZW'));
});

test('extractPresentationTextToMarkdown extracts slide text, tables, and speaker notes losslessly', () => {
  const md = extractPresentationTextToMarkdown({
    title: 'ارائه کالیبراسیون',
    slides: [
      {
        objectId: 's1',
        pageElements: [
          {
            shape: {
              text: {
                textElements: [{ textRun: { content: 'مقدمه ریمپ\n' } }],
              },
            },
          },
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    { text: { textElements: [{ textRun: { content: 'پارامتر' } }] } },
                    { text: { textElements: [{ textRun: { content: 'مقدار' } }] } },
                  ],
                },
                {
                  tableCells: [
                    { text: { textElements: [{ textRun: { content: 'AFR' } }] } },
                    { text: { textElements: [{ textRun: { content: '14.7' } }] } },
                  ],
                },
              ],
            },
          },
        ],
        slideProperties: {
          notesPage: {
            pageElements: [
              {
                shape: {
                  text: {
                    textElements: [{ textRun: { content: 'توضیح تکمیلی استاد' } }],
                  },
                },
              },
            ],
          },
        },
      },
    ],
  });

  assert.ok(md.includes('# ارائه کالیبراسیون'));
  assert.ok(md.includes('## اسلاید 1'));
  assert.ok(md.includes('مقدمه ریمپ'));
  assert.ok(md.includes('| پارامتر | مقدار |'));
  assert.ok(md.includes('| AFR | 14.7 |'));
  assert.ok(md.includes('توضیح تکمیلی استاد'));
});

test('normalizeDriveExportFileName enforces .docx/.md extensions and strips invalid path characters', () => {
  assert.equal(normalizeDriveExportFileName('کتاب/فصل:۱', 'docx'), 'کتاب_فصل_۱.docx');
  assert.equal(normalizeDriveExportFileName('book.md', 'docx'), 'book.docx');
  assert.equal(normalizeDriveExportFileName('book.docx', 'md'), 'book.md');
  assert.equal(normalizeDriveExportFileName('final.docx', 'docx'), 'final.docx');
});

test('buildMultipartRelatedUploadPayload creates RFC-2387 multipart/related body with metadata and binary payload', () => {
  const payload = buildMultipartRelatedUploadPayload({
    metadata: { name: 'output.docx', mimeType: DOCX_MIME_TYPE },
    contentBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    mimeType: DOCX_MIME_TYPE,
    boundary: 'test_boundary_123',
  });
  assert.equal(payload.contentType, 'multipart/related; boundary=test_boundary_123');
  const decoded = new TextDecoder().decode(payload.bytes);
  assert.ok(decoded.includes('--test_boundary_123\r\nContent-Type: application/json; charset=UTF-8'));
  assert.ok(decoded.includes('"name":"output.docx"'));
  assert.ok(decoded.includes(`Content-Type: ${DOCX_MIME_TYPE}`));
  assert.ok(decoded.includes('PK\x03\x04'));
  assert.ok(decoded.endsWith('\r\n--test_boundary_123--'));

  const svc = createGoogleDriveService('fake-token');
  assert.equal(typeof svc.listFiles, 'function');
  assert.equal(typeof svc.listExportFiles, 'function');
  assert.equal(typeof svc.uploadFinalDocument, 'function');
  assert.equal(typeof svc.findOrCreateFolder, 'function');
});
