import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildQuickDraftStructure,
  cleanSourceFileLabel,
  parseHeadingTreeSegments,
} from './quickDraftBuilder.ts';
import type { ContentUnitDto, SourceFileDto } from './bookTypes.ts';

function makeFile(id: string, fileName: string, wordCount = 400): SourceFileDto {
  return {
    id,
    projectId: 'proj_qd',
    fileName,
    format: 'md',
    fileRole: 'standard',
    sizeBytes: 2048,
    wordCount,
    unitCount: 3,
    checksum: `hash_${id}`,
    uploadedAt: '2026-11-26T10:00:00.000Z',
  };
}

function makeUnit(overrides: Partial<ContentUnitDto> & { id: string; sourceFileId: string; unitOrder: number; rawText: string }): ContentUnitDto {
  return {
    projectId: 'proj_qd',
    headingPath: null,
    unitType: 'paragraph',
    normalizedHash: `nh_${overrides.id}`,
    status: 'active',
    canonicalUnitId: null,
    outlineNodeId: 'old_node_1',
    metadataJson: {},
    ...overrides,
  };
}

test('parseHeadingTreeSegments splits hierarchical delimiters and removes consecutive duplicates', () => {
  assert.deepEqual(
    parseHeadingTreeSegments('## فصل ۱: مبانی داینو > کالیبراسیون > کالیبراسیون > سنسور گشتاور'),
    ['فصل ۱: مبانی داینو', 'کالیبراسیون', 'سنسور گشتاور']
  );
  assert.deepEqual(parseHeadingTreeSegments('بخش الف » زیربخش ب › نکته ج'), [
    'بخش الف',
    'زیربخش ب',
    'نکته ج',
  ]);
  assert.deepEqual(parseHeadingTreeSegments('   '), []);
});

test('cleanSourceFileLabel strips extensions and normalizes underscores/hyphens', () => {
  assert.equal(cleanSourceFileLabel('Bakhsh1_Dars_01-intro.md'), 'Bakhsh1 Dars 01 intro');
  assert.equal(cleanSourceFileLabel('dyno_guide.docx'), 'dyno guide');
});

test('buildQuickDraftStructure builds multi-level heading tree across multiple files with 100% zero-loss mapping', () => {
  const files = [
    makeFile('f1', 'dyno_part1.md'),
    makeFile('f2', 'dyno_part2.md'),
  ];

  const units: ContentUnitDto[] = [
    makeUnit({
      id: 'u1',
      sourceFileId: 'f1',
      unitOrder: 1,
      headingPath: 'مبانی تست داینو > تعریف گشتاور و توان',
      unitType: 'paragraph',
      rawText: 'گشتاور نیروی چرخشی موتور است و توان حاصل‌ضرب گشتاور در دور موتور می‌باشد.',
    }),
    makeUnit({
      id: 'u2',
      sourceFileId: 'f1',
      unitOrder: 2,
      headingPath: 'مبانی تست داینو > تعریف گشتاور و توان > فرمول تبدیل واحدها',
      unitType: 'equation',
      rawText: 'HP = (Torque_Nm × RPM) / 7127',
    }),
    makeUnit({
      id: 'u3',
      sourceFileId: 'f2',
      unitOrder: 1,
      headingPath: 'مبانی تست داینو > ایمنی روی غلتک',
      unitType: 'callout',
      rawText: 'پیش از شروع تست حتماً تسمه‌های مهار خودرو و باد لاستیک‌ها را کنترل کنید.',
    }),
    makeUnit({
      id: 'u4',
      sourceFileId: 'f2',
      unitOrder: 2,
      headingPath: 'تحلیل نمودار خروجی > جدول مقایسه وضعیت‌ها',
      unitType: 'table',
      rawText: '| دور موتور | گشتاور | توان |\n| 3000 | 180 | 76 |',
    }),
    // Merged duplicate unit should not inflate active count but should stay aligned with canonical chapter
    makeUnit({
      id: 'u5_dup',
      sourceFileId: 'f2',
      unitOrder: 3,
      headingPath: 'مبانی تست داینو > تعریف گشتاور و توان',
      status: 'merged',
      canonicalUnitId: 'u1',
      rawText: 'گشتاور نیروی چرخشی موتور است.',
    }),
  ];

  const result = buildQuickDraftStructure({
    projectId: 'proj_qd',
    projectTitle: 'راهنمای جامع داینو',
    sourceFiles: files,
    contentUnits: units,
    strategy: 'heading_tree',
  });

  assert.equal(result.strategy, 'heading_tree');
  assert.equal(result.summary.totalSourceFiles, 2);
  assert.equal(result.summary.totalChapters, 2);
  assert.equal(result.summary.totalActiveUnits, 4);
  assert.equal(result.summary.totalMergedUnits, 1);
  assert.equal(result.summary.coveragePercent, 100);
  assert.equal(result.summary.hasHierarchicalHeadings, true);

  // Chapter 1 merges cross-file units under "مبانی تست داینو"
  const ch1 = result.chapters[0];
  assert.equal(ch1.title, 'مبانی تست داینو');
  assert.equal(ch1.unitCount, 3);
  assert.deepEqual(ch1.sourceFileNames, ['dyno_part1.md', 'dyno_part2.md']);
  assert.equal(ch1.blockCounts.paragraphs, 1);
  assert.equal(ch1.blockCounts.equations, 1);
  assert.equal(ch1.blockCounts.callouts, 1);
  assert.equal(ch1.tree.length, 2);
  assert.equal(ch1.tree[0].title, 'تعریف گشتاور و توان');
  assert.equal(ch1.tree[0].children.length, 1);
  assert.equal(ch1.tree[0].children[0].title, 'فرمول تبدیل واحدها');
  assert.equal(ch1.tree[0].unitCount, 2);
  assert.equal(ch1.tree[1].title, 'ایمنی روی غلتک');

  // Chapter 2
  const ch2 = result.chapters[1];
  assert.equal(ch2.title, 'تحلیل نمودار خروجی');
  assert.equal(ch2.unitCount, 1);
  assert.equal(ch2.blockCounts.tables, 1);

  // 100% lossless unitAssignments: 4 active + 1 merged aligned to canonical
  assert.equal(result.outlineNodes.length, 2);
  const activeAssignedIds = new Set(
    result.unitAssignments
      .filter((a) => !a.unitId.includes('dup'))
      .map((a) => a.unitId)
  );
  assert.deepEqual(activeAssignedIds, new Set(['u1', 'u2', 'u3', 'u4']));
  const dupAssign = result.unitAssignments.find((a) => a.unitId === 'u5_dup');
  assert.equal(dupAssign?.outlineNodeId, ch1.id);

  // Markdown blueprint contains chapter and nested bullet headings
  assert.match(result.outlineMarkdown, /مبانی تست داینو/);
  assert.match(result.outlineMarkdown, /فرمول تبدیل واحدها/);
});

test('buildQuickDraftStructure by_source_file strategy groups cleanly per extracted file and keeps internal tree', () => {
  const files = [
    makeFile('f1', '01_prerequisites.md'),
    makeFile('f2', '02_advanced_tuning.md'),
  ];

  const units: ContentUnitDto[] = [
    makeUnit({
      id: 'u1',
      sourceFileId: 'f1',
      unitOrder: 1,
      headingPath: 'پیش‌نیازها > ابزارهای اندازه‌گیری',
      rawText: 'قبل از هر اقدامی باید با سنسورها و ابزارهای پایه آشنا شوید.',
    }),
    makeUnit({
      id: 'u2',
      sourceFileId: 'f2',
      unitOrder: 1,
      headingPath: null,
      rawText: 'این فایل بدون هدینگ است اما باید بدون افت به فصل دوم برود.',
    }),
  ];

  const result = buildQuickDraftStructure({
    projectId: 'proj_qd',
    projectTitle: 'کتاب فنی',
    sourceFiles: files,
    contentUnits: units,
    strategy: 'by_source_file',
  });

  assert.equal(result.chapters.length, 2);
  assert.equal(result.chapters[0].title, '01 prerequisites');
  assert.equal(result.chapters[0].tree.length, 1);
  assert.equal(result.chapters[0].tree[0].title, 'پیش‌نیازها');
  assert.equal(result.chapters[0].tree[0].children[0].title, 'ابزارهای اندازه‌گیری');
  assert.equal(result.chapters[1].title, '02 advanced tuning');
  assert.equal(result.chapters[1].directUnitCount, 1);
  assert.equal(result.unitAssignments.length, 2);
});

test('buildQuickDraftStructure handles empty units gracefully with fallback chapter', () => {
  const result = buildQuickDraftStructure({
    projectId: 'proj_empty',
    projectTitle: 'پروژه خالی',
    sourceFiles: [makeFile('f1', 'draft_notes.txt', 0)],
    contentUnits: [],
  });

  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0].title, 'draft notes');
  assert.equal(result.outlineNodes.length, 1);
  assert.equal(result.summary.totalActiveUnits, 0);
});
