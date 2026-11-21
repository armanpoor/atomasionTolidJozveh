import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEditorialSystemDirective,
  buildWinolsGuideCsv,
  extractWinolsMapGuides,
  normalizeEditorialSettings,
} from './winolsMapGuide';
import { ContentUnitDto, SourceFileDto } from './bookTypes';

function makeFile(id: string, fileName: string): SourceFileDto {
  return {
    id,
    projectId: 'proj_test',
    fileName,
    format: 'docx',
    fileRole: 'standard',
    wordCount: 120,
    sizeBytes: 2048,
    unitCount: 4,
    checksum: `chk_${id}`,
    uploadedAt: '2026-01-01T00:00:00Z',
  };
}

function makeUnit(id: string, sourceFileId: string, rawText: string, unitType: ContentUnitDto['unitType'] = 'paragraph'): ContentUnitDto {
  return {
    id,
    projectId: 'proj_test',
    sourceFileId,
    unitOrder: 1,
    unitType,
    headingPath: 'فصل ۱',
    rawText,
    normalizedHash: `h_${id}`,
    status: 'unique',
    canonicalUnitId: null,
    outlineNodeId: 'node_1',
    metadataJson: {},
  };
}

test('normalizeEditorialSettings defaults safely and sanitizes invalid values', () => {
  const defaults = normalizeEditorialSettings({});
  assert.equal(defaults.aiRewriteLevel, 'light_polish');
  assert.equal(defaults.outputTone, 'workshop_practical');
  assert.equal(defaults.customStylePrompt, '');
  assert.equal(defaults.includeWinolsActionTables, true);

  const custom = normalizeEditorialSettings({
    aiRewriteLevel: 'strict_zero_touch',
    outputTone: 'academic_engineering',
    customStylePrompt: '  فقط با لحن رسمی کتاب مرجع بنویس  ',
    includeWinolsActionTables: false,
  });
  assert.equal(custom.aiRewriteLevel, 'strict_zero_touch');
  assert.equal(custom.outputTone, 'academic_engineering');
  assert.equal(custom.customStylePrompt, 'فقط با لحن رسمی کتاب مرجع بنویس');
  assert.equal(custom.includeWinolsActionTables, false);
});

test('buildEditorialSystemDirective enforces hard numeric/hex freeze across all rewrite levels and injects custom prompt', () => {
  const strict = buildEditorialSystemDirective({
    aiRewriteLevel: 'strict_zero_touch',
    outputTone: 'concise_cheatsheet',
  });
  assert.match(strict, /۰٪ بازنویسی/);
  assert.match(strict, /قفل مطلق داده‌های فنی/);
  assert.match(strict, /0x1A4F0/);

  const cohesive = buildEditorialSystemDirective({
    aiRewriteLevel: 'cohesive_synthesis',
    outputTone: 'beginner_step_by_step',
    customStylePrompt: 'بعد از هر نقشه یک مثال عددی برای TU5 بنویس',
  });
  assert.match(cohesive, /ترکیب منسجم آموزشی/);
  assert.match(cohesive, /آموزشی گام‌به‌گام/);
  assert.match(cohesive, /بعد از هر نقشه یک مثال عددی برای TU5 بنویس/);
  assert.match(cohesive, /Hard Numeric & Hex Freeze/);
});

test('extractWinolsMapGuides detects KFZW, LAMFA, KFMIRL, and scalar NMAX with exact hex, RPM/Load zone, 2D matrix, and summary table', () => {
  const files = [
    makeFile('f1', 'جزوه_ME7.4.4.docx'),
    makeFile('f2', 'جزوه_کارگاهی_۲.docx'),
  ];
  const units = [
    makeUnit(
      'u1',
      'f1',
      'در ایسیو ME7.4.4 نقشه آوانس جرقه KFZW (آدرس 0x1A4F0، ابعاد 12x16) را در دور 3000 تا 5500 RPM و بار بالای 70% به میزان +2.5° افزایش دهید.'
    ),
    makeUnit(
      'u2',
      'f1',
      'نقشه LAMFA در بار کامل روی 12.5:1 AFR تنظیم شود تا دمای اگزوز کنترل گردد.'
    ),
    makeUnit(
      'u3',
      'f2',
      'در ایسیو SIM2K-241 آدرس مپ KFMIRL روی 0x1A520 است و برای افزایش گشتاور در دور 2500 تا 5500 RPM به اندازه +12% اصلاح می‌شود.'
    ),
    makeUnit(
      'u4',
      'f2',
      'محدودکننده دور موتور NMAX در ایسیو ME7.4.4 از 6500 RPM به 6950 RPM افزایش می‌یابد.'
    ),
  ];

  const report = extractWinolsMapGuides({ sourceFiles: files, units });
  assert.equal(report.mapsDetected, 4);

  const kfzw = report.entries.find((e) => e.mapCode === 'KFZW');
  assert.ok(kfzw, 'KFZW map must be detected');
  assert.deepEqual(kfzw.hexAddresses, ['0x1A4F0']);
  assert.ok(kfzw.ecuModels.includes('ME7.4.4'));
  assert.equal(kfzw.dimensions, '12x16');
  assert.equal(kfzw.recommendedDeltaLabel, '+2.5°');
  assert.deepEqual(kfzw.targetRpmRange, { min: 3000, max: 5500 });
  assert.deepEqual(kfzw.targetLoadRange, { min: 70, max: 100 });
  assert.ok(kfzw.zoneMatrix, 'KFZW should have a 2D WinOLS cell-zone matrix');
  assert.ok(kfzw.zoneMatrix.highlightedCellCount > 0);
  // Cell at load 80% (row index 3), rpm 4500 (col index 3) must be 'modify' with '+2.5°'
  const cell80x4500 = kfzw.zoneMatrix.cells[3][3];
  assert.equal(cell80x4500.zone, 'modify');
  assert.equal(cell80x4500.deltaLabel, '+2.5°');
  // Cell at load 20% (row index 0), rpm 1500 (col index 0) must remain 'stock'
  assert.equal(kfzw.zoneMatrix.cells[0][0].zone, 'stock');

  const nmax = report.entries.find((e) => e.mapCode === 'NMAX');
  assert.ok(nmax, 'NMAX scalar limiter must be detected');
  assert.equal(nmax.isScalar, true);
  assert.equal(nmax.zoneMatrix, null);
  assert.ok(nmax.numericValuesDetected.some((v) => v.includes('6950')));

  assert.ok(report.summaryTable, 'Summary TableBlock must be auto-generated');
  assert.equal(report.summaryTable.headers.length, 5);
  assert.equal(report.summaryTable.rows.length, 4);

  const csv = buildWinolsGuideCsv(report.entries);
  assert.ok(csv.includes('KFZW'));
  assert.ok(csv.includes('0x1A4F0'));
  assert.ok(csv.includes('LAMFA'));
});

test('extractWinolsMapGuides ignores merged duplicate units and returns empty report cleanly when no maps exist', () => {
  const files = [makeFile('f1', 'متن_عمومی.docx')];
  const units = [
    makeUnit('u1', 'f1', 'این یک پاراگراف عمومی درباره تاریخچه خودرو بدون اشاره به نقشه کالیبراسیون است.'),
    {
      ...makeUnit('u2', 'f1', 'نقشه KFZW آدرس 0x1A4F0'),
      status: 'merged' as const,
    },
  ];
  const report = extractWinolsMapGuides({ sourceFiles: files, units });
  assert.equal(report.mapsDetected, 0);
  assert.equal(report.summaryTable, null);
});
