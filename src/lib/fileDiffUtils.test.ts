import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ContentUnitDto, SourceFileDto } from './bookTypes.ts';
import {
  buildIngestedFileComparisonData,
  computeLineDiff,
  filterQueuedFilesByName,
  filterSourceFilesByName,
  matchQueuedToIngestedFile,
} from './fileDiffUtils.ts';

const SAMPLE_FILES: SourceFileDto[] = [
  {
    id: 'sf-1',
    projectId: 'p1',
    fileName: 'فصل_۱_کالیبراسیون_ME7.4.4.docx',
    format: 'docx',
    fileRole: 'master',
    sizeBytes: 42000,
    wordCount: 850,
    unitCount: 12,
    checksum: 'abc',
    uploadedAt: '2026-11-26T00:00:00.000Z',
  },
  {
    id: 'sf-2',
    projectId: 'p1',
    fileName: 'WinOLS_Maps_Bosch.md',
    format: 'md',
    fileRole: 'standard',
    sizeBytes: 12000,
    wordCount: 320,
    unitCount: 5,
    checksum: 'def',
    uploadedAt: '2026-11-26T00:00:00.000Z',
  },
  {
    id: 'sf-3',
    projectId: 'p1',
    fileName: 'جدول_سوخت_و_جرقه.csv',
    format: 'csv',
    fileRole: 'supplement',
    sizeBytes: 6400,
    wordCount: 140,
    unitCount: 3,
    checksum: 'ghi',
    uploadedAt: '2026-11-26T00:00:00.000Z',
  },
];

describe('fileDiffUtils — Sidebar Source File Filter & Visual Diff Engine', () => {
  it('filters source files by Persian, Arabic-variant, digit, and case-insensitive English queries with highlight segments', () => {
    // Arabic ك/ي and ASCII digit 1 should match Persian ک/ی and Persian digit ۱
    const persianMatches = filterSourceFilesByName(SAMPLE_FILES, '1_كاليبراسيون');
    assert.equal(persianMatches.length, 1);
    assert.equal(persianMatches[0].item.id, 'sf-1');
    assert.equal(
      persianMatches[0].nameSegments.some((s) => s.matched),
      true,
      'Matched substring must be marked for highlighting'
    );

    const englishMatches = filterSourceFilesByName(SAMPLE_FILES, 'winols');
    assert.equal(englishMatches.length, 1);
    assert.equal(englishMatches[0].item.id, 'sf-2');

    const formatMatches = filterSourceFilesByName(SAMPLE_FILES, 'csv');
    assert.equal(formatMatches.length, 1);
    assert.equal(formatMatches[0].item.id, 'sf-3');

    assert.equal(filterSourceFilesByName(SAMPLE_FILES, '').length, 3);
    assert.equal(filterSourceFilesByName(SAMPLE_FILES, 'nonexistent_file_xyz').length, 0);
  });

  it('filters queued files and matches queued filename to its ingested SourceFileDto', () => {
    const queued = [
      { id: 'q1', name: 'WinOLS_Maps_Bosch.md', format: 'md' },
      { id: 'q2', name: 'Extra_Notes.txt', format: 'txt' },
    ];
    assert.equal(filterQueuedFilesByName(queued, 'bosch').length, 1);

    const matchedExact = matchQueuedToIngestedFile('WinOLS_Maps_Bosch.md', SAMPLE_FILES);
    assert.equal(matchedExact?.id, 'sf-2');

    const matchedBase = matchQueuedToIngestedFile('WinOLS_Maps_Bosch.txt', SAMPLE_FILES);
    assert.equal(matchedBase?.id, 'sf-2');

    assert.equal(matchQueuedToIngestedFile('Unknown.pdf', SAMPLE_FILES), null);
  });

  it('reconstructs ingested file summary separating unique, merged, and conflict units', () => {
    const units: ContentUnitDto[] = [
      {
        id: 'u1',
        projectId: 'p1',
        sourceFileId: 'sf-2',
        unitOrder: 1,
        unitType: 'paragraph',
        headingPath: 'نقشه KFZW',
        rawText: 'آدرس نقشه جرقه 0x1A4F0 است.',
        normalizedHash: 'h1',
        status: 'unique',
        canonicalUnitId: null,
        outlineNodeId: 'n1',
        metadataJson: null,
      },
      {
        id: 'u2',
        projectId: 'p1',
        sourceFileId: 'sf-2',
        unitOrder: 2,
        unitType: 'paragraph',
        headingPath: 'نقشه KFZW',
        rawText: 'بند تکراری ادغام‌شده با فایل دیگر.',
        normalizedHash: 'h2',
        status: 'merged',
        canonicalUnitId: 'u-other',
        outlineNodeId: 'n1',
        metadataJson: null,
      },
      {
        id: 'u3',
        projectId: 'p1',
        sourceFileId: 'sf-2',
        unitOrder: 3,
        unitType: 'paragraph',
        headingPath: 'مقدار AFR',
        rawText: 'مقدار AFR در تمام‌گاز 12.6 است.',
        normalizedHash: 'h3',
        status: 'conflict',
        canonicalUnitId: null,
        outlineNodeId: 'n1',
        metadataJson: null,
      },
    ];

    const summary = buildIngestedFileComparisonData('sf-2', units);
    assert.equal(summary.totalUnits, 3);
    assert.equal(summary.uniqueUnits, 1);
    assert.equal(summary.mergedUnits, 1);
    assert.equal(summary.conflictUnits, 1);
    assert.ok(summary.allExtractedText.includes('بند تکراری ادغام‌شده'));
    assert.ok(!summary.activeIngestedText.includes('بند تکراری ادغام‌شده'));
    assert.ok(summary.activeIngestedText.includes('0x1A4F0'));
  });

  it('computes accurate LCS line diff and aligned side-by-side rows', () => {
    const source = ['خط یک ثابت', 'مقدار AFR برابر 14.7 است', 'خط حذف‌شده', 'خط پایانی'].join('\n');
    const ingested = ['خط یک ثابت', 'مقدار AFR برابر 14.5 است', 'خط جدید سیستم', 'خط پایانی'].join('\n');

    const diff = computeLineDiff(source, ingested);
    assert.equal(diff.unchangedCount, 2);
    assert.equal(diff.removedCount, 2);
    assert.equal(diff.addedCount, 2);
    assert.equal(diff.similarityPercent, 50);
    assert.equal(diff.truncated, false);
    assert.equal(diff.sideBySideRows.length, 4);
    assert.equal(diff.sideBySideRows[0].leftKind, 'equal');
    assert.equal(diff.sideBySideRows[1].leftKind, 'removed');
    assert.equal(diff.sideBySideRows[1].rightKind, 'added');
    assert.equal(diff.sideBySideRows[3].rightKind, 'equal');
  });
});
