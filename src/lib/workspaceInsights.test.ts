import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveOutlineTextPreview,
  computeChapterVolumeAndCoverage,
  searchExtractedContentUnits,
} from './workspaceInsights';
import type {
  ContentUnitDto,
  OutlineNodeDto,
  ProjectBundleDto,
  SourceFileDto,
} from './bookTypes';

const SAMPLE_FILES: SourceFileDto[] = [
  {
    id: 'f1',
    projectId: 'p1',
    fileName: 'جزوه_سوخت_۱.md',
    format: 'md',
    fileRole: 'standard',
    sizeBytes: 1200,
    wordCount: 30,
    unitCount: 2,
    checksum: 'abc1',
    uploadedAt: '2026-11-23T00:00:00Z',
  },
  {
    id: 'f2',
    projectId: 'p1',
    fileName: 'کارگاه_اکسیژن_۲.md',
    format: 'md',
    fileRole: 'supplement',
    sizeBytes: 900,
    wordCount: 22,
    unitCount: 2,
    checksum: 'abc2',
    uploadedAt: '2026-11-23T00:01:00Z',
  },
];

const SAMPLE_NODES: OutlineNodeDto[] = [
  {
    id: 'n1',
    projectId: 'p1',
    parentId: null,
    level: 1,
    nodeOrder: 1,
    title: 'فصل ۱: استانداردهای سیستم سوخت',
    summary: 'فشار ریل و انژکتور',
    isApproved: false,
    webEnrichmentJson: null,
  },
  {
    id: 'n2',
    projectId: 'p1',
    parentId: null,
    level: 1,
    nodeOrder: 2,
    title: 'فصل ۲: سنسور اکسیژن',
    summary: 'خطای P0135 و حلقه بسته',
    isApproved: false,
    webEnrichmentJson: {
      title: 'توضیح تکمیلی سنسور اکسیژن',
      summary: 'ولتاژ استاندارد سنسور بین ۰.۱ تا ۰.۹ ولت نوسان می‌کند.',
      sources: [],
      checkedAt: '2026-11-23T00:05:00Z',
    },
  },
];

const SAMPLE_UNITS: ContentUnitDto[] = [
  {
    id: 'u1',
    projectId: 'p1',
    sourceFileId: 'f1',
    unitOrder: 1,
    unitType: 'paragraph',
    headingPath: 'فصل ۱ > فشار ریل',
    rawText: 'نسبت هوا به سوخت استوکیومتری در موتورهای بنزینی برابر ۱۴.۷ به ۱ است.',
    normalizedHash: 'h1',
    status: 'active',
    canonicalUnitId: null,
    outlineNodeId: 'n1',
    metadataJson: null,
  },
  {
    id: 'u2',
    projectId: 'p1',
    sourceFileId: 'f1',
    unitOrder: 2,
    unitType: 'paragraph',
    headingPath: 'فصل ۱ > فشار ریل',
    rawText: 'حداکثر فشار ایمن ریل سوخت ۴ بار است.',
    normalizedHash: 'h2',
    status: 'merged',
    canonicalUnitId: 'u1',
    outlineNodeId: 'n1',
    metadataJson: null,
  },
  {
    id: 'u3',
    projectId: 'p1',
    sourceFileId: 'f2',
    unitOrder: 3,
    unitType: 'paragraph',
    headingPath: 'فصل ۲ > عیب‌یابی',
    rawText: 'در صورت خرابی هیتر سنسور اکسیژن خطای P0135 ثبت می‌شود و مصرف سوخت بالا می‌رود.',
    normalizedHash: 'h3',
    status: 'active',
    canonicalUnitId: null,
    outlineNodeId: 'n2',
    metadataJson: null,
  },
];

function makeBundle(overrides?: Partial<ProjectBundleDto>): ProjectBundleDto {
  return {
    project: {
      id: 'p1',
      title: 'کتابچه فنی کالیبراسیون',
      workflowMode: 'multi_merge',
      pipelineStage: 3,
      status: 'awaiting_outline',
      settingsJson: {},
      checkpointJson: {},
      createdAt: '2026-11-23T00:00:00Z',
      updatedAt: '2026-11-23T00:05:00Z',
      bookSnapshotJson: null,
    },
    sourceFiles: SAMPLE_FILES,
    contentUnits: SAMPLE_UNITS,
    dedupClusters: [],
    conflicts: [],
    outlineNodes: SAMPLE_NODES,
    auditReport: null,
    ...overrides,
  };
}

test('computeChapterVolumeAndCoverage aggregates unique and merged words per chapter accurately', () => {
  const summary = computeChapterVolumeAndCoverage(makeBundle());
  assert.equal(summary.sourceMode, 'outline');
  assert.equal(summary.chapterCount, 2);
  assert.equal(summary.chapters[0].uniqueWords, 13);
  assert.equal(summary.chapters[0].mergedWords, 8);
  assert.equal(summary.chapters[1].uniqueWords, 15);
  assert.equal(summary.chapters[1].hasWebEnrichment, true);
  assert.equal(summary.preservedUniqueWords, 28);
  assert.equal(summary.losslessMergedWords, 8);
  assert.equal(summary.overallWordCoveragePercent, 100);
  assert.equal(summary.largestChapterTitle, 'فصل ۲: سنسور اکسیژن');
});

test('computeChapterVolumeAndCoverage falls back to Stage 1 extracted units before Stage 3', () => {
  const summary = computeChapterVolumeAndCoverage(
    makeBundle({ outlineNodes: [], contentUnits: [SAMPLE_UNITS[0], SAMPLE_UNITS[2]] })
  );
  assert.equal(summary.sourceMode, 'extracted_units');
  assert.equal(summary.chapterCount, 2);
  assert.equal(summary.overallWordCoveragePercent, 100);
});

test('buildLiveOutlineTextPreview reflects live renaming, reordering, and pending merges immediately', () => {
  const reordered: OutlineNodeDto[] = [
    { ...SAMPLE_NODES[1], nodeOrder: 1, title: 'فصل اول جدید: اکسیژن و عیب‌یابی' },
    { ...SAMPLE_NODES[0], nodeOrder: 2, title: 'فصل دوم: سیستم سوخت' },
  ];

  const preview = buildLiveOutlineTextPreview({
    projectTitle: 'جزوه تست',
    draftNodes: reordered,
    contentUnits: SAMPLE_UNITS,
    sourceFiles: SAMPLE_FILES,
  });

  assert.equal(preview.chapters[0].title, 'فصل اول جدید: اکسیژن و عیب‌یابی');
  assert.equal(preview.chapters[0].unitCount, 1);
  assert.equal(preview.chapters[1].unitCount, 1);
  assert.ok(preview.plainMarkdown.includes('## فصل 1: فصل اول جدید: اکسیژن و عیب‌یابی'));
  assert.ok(preview.plainMarkdown.includes('[تکمیل‌شده با جستجوی گوگل]'));

  // Simulate merging chapter 2 (n1) into chapter 1 (n2) before saving to server
  const mergedPreview = buildLiveOutlineTextPreview({
    projectTitle: 'جزوه تست',
    draftNodes: [reordered[0]],
    contentUnits: SAMPLE_UNITS,
    sourceFiles: SAMPLE_FILES,
    pendingReassignments: [{ fromNodeId: 'n1', toNodeId: 'n2' }],
  });
  assert.equal(mergedPreview.totalChapters, 1);
  assert.equal(mergedPreview.chapters[0].unitCount, 2);
  assert.equal(mergedPreview.totalWords, 28);
});

test('searchExtractedContentUnits normalizes Persian/Arabic characters, digits, and English ECU codes', () => {
  // Arabic yeh/kaf query against Persian text
  const resPersian = searchExtractedContentUnits({
    query: 'اكسيژن',
    contentUnits: SAMPLE_UNITS,
    sourceFiles: SAMPLE_FILES,
    outlineNodes: SAMPLE_NODES,
  });
  assert.equal(resPersian.totalMatches, 1);
  assert.equal(resPersian.hits[0].unitId, 'u3');
  assert.equal(resPersian.hits[0].outlineNodeTitle, 'فصل ۲: سنسور اکسیژن');
  assert.ok(resPersian.hits[0].snippetSegments.some((s) => s.matched));

  // Case-insensitive English DTC code
  const resCode = searchExtractedContentUnits({
    query: 'p0135',
    contentUnits: SAMPLE_UNITS,
    sourceFiles: SAMPLE_FILES,
  });
  assert.equal(resCode.totalMatches, 1);
  assert.equal(resCode.hits[0].sourceFileName, 'کارگاه_اکسیژن_۲.md');

  // Latin digit query matching Persian digit in text ("14.7" matches "۱۴.۷")
  const resDigit = searchExtractedContentUnits({
    query: '14.7',
    contentUnits: SAMPLE_UNITS,
    sourceFiles: SAMPLE_FILES,
  });
  assert.equal(resDigit.totalMatches, 1);
  assert.equal(resDigit.hits[0].unitId, 'u1');

  // File filter scopes results strictly to selected file
  const resFiltered = searchExtractedContentUnits({
    query: 'سوخت',
    contentUnits: SAMPLE_UNITS,
    sourceFiles: SAMPLE_FILES,
    fileFilterId: 'f2',
  });
  assert.equal(resFiltered.totalMatches, 1);
  assert.equal(resFiltered.hits[0].sourceFileId, 'f2');
});
