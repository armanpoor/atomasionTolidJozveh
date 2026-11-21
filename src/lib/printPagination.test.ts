import test from 'node:test';
import assert from 'node:assert/strict';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  buildPrintSheetPlan,
  computeA4Geometry,
} from './printPagination';
import type { ParsedBook } from './bookTypes';

const MOCK_BOOK: ParsedBook = {
  title: 'راهنمای استاندارد کالیبراسیون',
  subtitle: 'نسخه مرجع مهندسی',
  editionNote: 'ویرایش ۱',
  sourceFiles: ['a.md', 'b.md'],
  volumes: [{ id: 'v1', index: 1, title: 'بخش اول' }],
  chapters: [
    {
      id: 'ch1',
      chapterNumber: 1,
      title: 'فصل ۱: فشار ریل سوخت',
      volumeIndex: 1,
      volumeTitle: 'بخش اول',
      meta: [{ label: 'تعداد زیربخش‌ها', value: '۱' }],
      introBlocks: [{ type: 'paragraph', id: 'p0', text: 'مقدمه فصل اول.' }],
      sections: [
        {
          id: 's1',
          numberLabel: '۱-۱',
          title: 'مبانی فشار ریل',
          originalTitle: 'مبانی فشار ریل',
          blocks: [
            { type: 'paragraph', id: 'p1', text: 'نسبت هوا به سوخت ۱۴.۷ به ۱ است.' },
          ],
        },
      ],
      sourceFileName: 'a.md',
    },
    {
      id: 'ch2',
      chapterNumber: 2,
      title: 'فصل ۲: سنسور اکسیژن',
      volumeIndex: 1,
      volumeTitle: 'بخش اول',
      meta: [],
      introBlocks: [],
      sections: [
        {
          id: 's2',
          numberLabel: '۲-۱',
          title: 'عیب‌یابی خطای P0135',
          originalTitle: 'عیب‌یابی خطای P0135',
          blocks: [
            { type: 'paragraph', id: 'p2', text: 'در صورت خرابی هیتر سنسور اکسیژن خطا ثبت می‌شود.' },
          ],
        },
      ],
      sourceFileName: 'b.md',
    },
  ],
  footnotes: [{ id: 1, canonicalId: 1, termKey: 'ecu', text: 'واحد کنترل الکترونیکی', chapters: [1] }],
  glossary: [{ term: 'ECU', definition: 'واحد کنترل موتور', chapters: [1, 2] }],
  tableIndex: [],
  cheatSheets: [],
  visualSuggestions: [],
  sourceMapRows: [],
};

test('computes accurate A4 dimensions and printable area for margin presets', () => {
  const std = computeA4Geometry('standard');
  assert.equal(std.pageWidthMm, A4_WIDTH_MM);
  assert.equal(std.pageHeightMm, A4_HEIGHT_MM);
  assert.equal(std.contentWidthMm, 166);
  assert.equal(std.contentHeightMm, 255);
  assert.ok(std.printableAreaPercent > 60 && std.printableAreaPercent < 80);

  const binding = computeA4Geometry('binding');
  const compact = computeA4Geometry('compact');
  assert.ok(compact.contentWidthMm > std.contentWidthMm);
  assert.ok(std.contentWidthMm > binding.contentWidthMm);
});

test('builds complete A4 print sheet plan for full book and single chapter scopes', () => {
  const full = buildPrintSheetPlan(MOCK_BOOK, {
    scope: 'full_book',
    includeCoverAndToc: true,
    includeAppendices: true,
    fontSizePt: 11,
  });
  // Cover + TOC + 2 chapters + glossary + footnotes = 6 sheets
  assert.equal(full.totalSheets, 6);
  assert.equal(full.sheets[0].kind, 'cover');
  assert.equal(full.sheets[0].pageNumber, 1);
  assert.equal(full.sheets[1].kind, 'toc');
  assert.equal(full.sheets[2].kind, 'chapter');
  assert.equal(full.sheets[2].chapterNumber, 1);
  assert.ok(full.estimatedTotalPages >= 6);

  const single = buildPrintSheetPlan(MOCK_BOOK, {
    scope: 'active_chapter',
    activeChapterNumber: 2,
  });
  assert.equal(single.totalSheets, 1);
  assert.equal(single.sheets[0].chapterNumber, 2);
  assert.equal(single.sheets[0].pageNumber, 1);
});
