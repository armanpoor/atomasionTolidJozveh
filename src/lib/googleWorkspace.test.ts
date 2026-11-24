import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookSpreadsheetReportPayload,
  convertSheetValuesToMarkdown,
  GOOGLE_WORKSPACE_SCOPES,
} from './googleWorkspace.ts';
import type { ParsedBook } from './bookTypes.ts';
import type { WinolsExtractionReport } from './winolsMapGuide.ts';

test('GOOGLE_WORKSPACE_SCOPES includes required Drive and Sheets scopes without duplicates', () => {
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/drive.file'));
  assert.ok(GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.ok(
    GOOGLE_WORKSPACE_SCOPES.includes('https://www.googleapis.com/auth/spreadsheets.readonly')
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
});
