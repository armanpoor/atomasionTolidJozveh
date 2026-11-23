import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

import {
  buildDefaultDamosConfigsFromReport,
  computeAsap2RatFuncCoeffs,
  computeFce6PointerAddress,
  generateWinols224A2l,
  generateWinols224CsvMapPack,
  generateWinols224DamosBundleZip,
  normalizeHexAddress,
  type WinolsDamosMapConfig,
} from './winolsDamosExporter';
import { extractWinolsMapGuides } from './winolsMapGuide';
import {
  parseMarkdownDocument,
  preprocessMessyRemapText,
} from './formatParsers';
import {
  extractAtomicUnitsFromBook,
  runDeterministicLosslessDedup,
} from './zeroLossPipeline';
import {
  computeRevisionMetricDeltas,
  exportRevisionsToCsv,
  exportRevisionsToJson,
  filterProjectRevisions,
  getRevisionCategory,
  type ProjectRevisionDto,
} from './changeLogUtils';
import type { ContentUnitDto, SourceFileDto } from './bookTypes';

test('Siemens FCE6 pointer calculator computes exact addresses and 4 search patterns', () => {
  const res1 = computeFce6PointerAddress('14000', 'FDA');
  assert.equal(res1.valid, true);
  assert.equal(res1.baseHex, '0x14000');
  assert.equal(res1.offsetHex, '0xFDA');
  assert.equal(res1.finalAddressHex, '0x14FDA');
  assert.deepEqual(res1.searchPatterns, ['0FDA', '1FDA', '2FDA', '3FDA']);

  const res2 = computeFce6PointerAddress('0x14000', '78');
  assert.equal(res2.valid, true);
  assert.equal(res2.finalAddressHex, '0x14078');
  assert.deepEqual(res2.searchPatterns, ['0078', '1078', '2078', '3078']);

  const res3 = computeFce6PointerAddress('68000', '29EE');
  assert.equal(res3.valid, true);
  assert.equal(res3.finalAddressHex, '0x6A9EE');

  assert.equal(normalizeHexAddress('1a9ee'), '0x1A9EE');
});

test('ASAP2 RAT_FUNC linear coefficients round-trip Factor & Offset accurately', () => {
  // Ignition angle: PHYS = RAW * 0.375 - 23.6
  const [a, b, c, d, e, f] = computeAsap2RatFuncCoeffs(0.375, -23.6);
  // ASAP2 formula: f(PHYS) = (a*PHYS^2 + b*PHYS + c) / (d*PHYS^2 + e*PHYS + f) = RAW
  // For linear: a=0, d=0, e=0, f=1 => RAW = b*PHYS + c
  assert.equal(a, 0);
  assert.equal(d, 0);
  assert.equal(e, 0);
  assert.equal(f, 1);

  for (const raw of [0, 64, 100, 128, 255]) {
    const phys = raw * 0.375 - 23.6;
    const reconstructedRaw = b * phys + c;
    assert.ok(
      Math.abs(reconstructedRaw - raw) < 1e-3,
      `Expected reconstructed RAW ${reconstructedRaw} to match ${raw}`
    );
  }
});

test('generateWinols224A2l outputs valid ASAM ASAP2 v1.51 with ASCII identifiers and ZIP bundle', async () => {
  const configs: WinolsDamosMapConfig[] = [
    {
      id: 'map_ign_1',
      mapCode: 'IGN_BASE',
      nameFa: 'جرقه پایه موتور زیمنس',
      folder: 'Ignition',
      description: 'Siemens EF7 Base Ignition Advance',
      startAddressHex: '0x14FDA',
      baseAddressHex: '0x14000',
      columns: 16,
      rows: 12,
      type: 'MAP',
      dataOrg: '8bit',
      signed: false,
      byteOrder: 'HiLo',
      factor: 0.375,
      offset: -23.6,
      precision: 2,
      unit: 'deg',
      axisX: {
        label: 'RPM',
        addressHex: '0x14078',
        count: 16,
        dataOrg: '8bit',
        signed: false,
        factor: 32,
        offset: 0,
        unit: 'rpm',
        minValue: 600,
        maxValue: 6800,
      },
      axisY: {
        label: 'Load',
        addressHex: '0x14098',
        count: 12,
        dataOrg: '8bit',
        signed: false,
        factor: 0.392157,
        offset: 0,
        unit: '%',
        minValue: 0,
        maxValue: 100,
      },
      ecuFamily: 'Siemens EF7 CBAR',
      lineSwappingRequired: true,
      checksumExternal: true,
      addressVerified: true,
      safetyNote: 'تست آوانس جرقه بنزین معمولی',
    },
  ];

  const a2lRes = generateWinols224A2l({
    projectName: 'جزوه ریمپ زیمنس EF7',
    ecuFamily: 'Siemens EF7 CBAR',
    baseAddressHex: '0x14000',
    byteOrder: 'HiLo',
    maps: configs,
  });

  assert.equal(a2lRes.validation.totalMaps, 1);
  assert.equal(a2lRes.validation.readyWithAddressCount, 1);
  assert.match(a2lRes.a2lContent, /ASAP2_VERSION 1 51/);
  assert.match(a2lRes.a2lContent, /\/begin PROJECT /);
  assert.match(a2lRes.a2lContent, /\/begin RECORD_LAYOUT RL_UBYTE/);
  assert.match(a2lRes.a2lContent, /\/begin COMPU_METHOD CM_1_/);
  assert.match(a2lRes.a2lContent, /\/begin AXIS_PTS IGN_BASE_AXIS_X/);
  assert.match(a2lRes.a2lContent, /\/begin CHARACTERISTIC IGN_BASE/);
  assert.match(a2lRes.a2lContent, /0x14FDA/);
  assert.match(a2lRes.a2lContent, /0x14078/);
  assert.match(a2lRes.a2lContent, /\/begin GROUP /);
  assert.match(a2lRes.a2lContent, /\/end PROJECT/);

  const csv = generateWinols224CsvMapPack(configs);
  assert.ok(csv.includes('IGN_BASE'));
  assert.ok(csv.includes('0x14FDA'));

  const bundle = await generateWinols224DamosBundleZip({
    projectName: 'جزوه ریمپ زیمنس EF7',
    ecuFamily: 'Siemens EF7 CBAR',
    baseAddressHex: '0x14000',
    byteOrder: 'HiLo',
    maps: configs,
  });

  assert.ok(bundle.zipBytes.length > 200);
  const loadedZip = await JSZip.loadAsync(bundle.zipBytes);
  const fileNames = Object.keys(loadedZip.files);
  assert.ok(fileNames.some((f) => f.endsWith('.a2l')), 'ZIP should contain .a2l file');
  assert.ok(fileNames.some((f) => f.endsWith('.csv')), 'ZIP should contain .csv file');
  assert.ok(fileNames.includes('README-WinOLS-2.24.txt'), 'ZIP should contain Persian README');
  assert.ok(fileNames.includes('damos-manifest.json'), 'ZIP should contain damos-manifest.json');
});

test('preprocessMessyRemapText recovers implicit Persian lesson headings while preserving ZWNJ', () => {
  const messy = [
    '\u200fدرس ۱: شناخت آدرس‌های زیمنس EF7',
    '',
    '',
    '',
    'ناحیه کاری در فایل‌های CBAR روی 14000 قرار دارد و نیم‌فاصله باید حفظ شود.',
    'درس ۲: جدول جرقه و آوانس',
    'ضریب 0.375 و آفست -23.6 در WinOLS 2.24 تنظیم می‌شود.',
  ].join('\n');

  const cleaned = preprocessMessyRemapText(messy);
  assert.ok(cleaned.includes('# درس ۱: شناخت آدرس‌های زیمنس EF7'));
  assert.ok(cleaned.includes('# درس ۲: جدول جرقه و آوانس'));
  assert.ok(cleaned.includes('نیم‌فاصله'), 'ZWNJ must be preserved');
  assert.ok(!cleaned.includes('\u200f'), 'Stray RLM mark should be cleaned');

  const parsed = parseMarkdownDocument(messy, 'messy-notes.md');
  assert.equal(parsed.chapters.length, 2);
});

test('Real-world Iranian Siemens/TNM remap samples parse, dedup quickly, extract >=10 maps, and build WinOLS 2.24 A2L', () => {
  const file1Path = path.resolve(
    process.cwd(),
    'public/assets/aistudio/Bakhsh1_Dars_01_ta_08-1_1707ad79.md'
  );
  const file2Path = path.resolve(
    process.cwd(),
    'public/assets/aistudio/Bakhsh2_Dars_08-2_ta_09-3_89994058.md'
  );

  assert.ok(fs.existsSync(file1Path), 'Sample file 1 must exist on disk');
  assert.ok(fs.existsSync(file2Path), 'Sample file 2 must exist on disk');

  const raw1 = fs.readFileSync(file1Path, 'utf8');
  const raw2 = fs.readFileSync(file2Path, 'utf8');

  const t0 = Date.now();
  const book1 = parseMarkdownDocument(raw1, 'Bakhsh1_Dars_01_ta_08-1.md');
  const book2 = parseMarkdownDocument(raw2, 'Bakhsh2_Dars_08-2_ta_09-3.md');

  assert.ok(
    book1.chapters.length >= 4,
    `Expected >=4 chapters in Bakhsh1, got ${book1.chapters.length}`
  );
  assert.ok(
    book2.chapters.length >= 2,
    `Expected >=2 chapters in Bakhsh2, got ${book2.chapters.length}`
  );

  const sourceFiles: SourceFileDto[] = [
    {
      id: 'sf_1',
      projectId: 'proj_real',
      fileName: 'Bakhsh1_Dars_01_ta_08-1.md',
      format: 'md',
      fileRole: 'supplement',
      sizeBytes: Buffer.byteLength(raw1, 'utf8'),
      wordCount: raw1.split(/\s+/).length,
      unitCount: 0,
      checksum: 'hash_1',
      uploadedAt: new Date().toISOString(),
    },
    {
      id: 'sf_2',
      projectId: 'proj_real',
      fileName: 'Bakhsh2_Dars_08-2_ta_09-3.md',
      format: 'md',
      fileRole: 'supplement',
      sizeBytes: Buffer.byteLength(raw2, 'utf8'),
      wordCount: raw2.split(/\s+/).length,
      unitCount: 0,
      checksum: 'hash_2',
      uploadedAt: new Date().toISOString(),
    },
  ];

  const extracted1 = extractAtomicUnitsFromBook({
    projectId: 'proj_real',
    sourceFileId: 'sf_1',
    fileName: sourceFiles[0].fileName,
    fileRole: 'supplement',
    book: book1,
  });
  const extracted2 = extractAtomicUnitsFromBook({
    projectId: 'proj_real',
    sourceFileId: 'sf_2',
    fileName: sourceFiles[1].fileName,
    fileRole: 'supplement',
    book: book2,
    startingOrder: extracted1.length,
  });

  const allUnits: ContentUnitDto[] = [...extracted1, ...extracted2].map((u) => ({
    id: u.id,
    projectId: u.projectId,
    sourceFileId: u.sourceFileId,
    outlineNodeId: null,
    unitOrder: u.unitOrder,
    unitType: u.unitType,
    headingPath: u.headingPath,
    rawText: u.rawText,
    normalizedHash: u.normalizedHash,
    status: 'active',
    canonicalUnitId: null,
    metadataJson: u.metadataJson,
  }));

  const tDedupStart = Date.now();
  const dedupOut = runDeterministicLosslessDedup({
    projectId: 'proj_real',
    workflowMode: 'multi_merge',
    sourceFiles,
    units: allUnits,
  });
  const dedupMs = Date.now() - tDedupStart;
  const totalMs = Date.now() - t0;

  assert.ok(
    dedupMs < 8000,
    `Expected fast dedup on real ~900KB files (<8000ms), took ${dedupMs}ms (total ${totalMs}ms)`
  );

  // Apply unitUpdates onto allUnits just like the server route does
  const updateMap = new Map(dedupOut.unitUpdates.map((upd) => [upd.id, upd]));
  const finalUnits: ContentUnitDto[] = allUnits.map((u) => {
    const upd = updateMap.get(u.id);
    if (!upd) return u;
    return {
      ...u,
      status: upd.status,
      canonicalUnitId: upd.canonicalUnitId,
      rawText: upd.rawText,
    };
  });

  const winolsReport = extractWinolsMapGuides({
    sourceFiles,
    units: finalUnits,
  });

  assert.ok(
    winolsReport.mapsDetected >= 10,
    `Expected >=10 Siemens maps extracted from real files, got ${winolsReport.mapsDetected}`
  );

  const codes = new Set(winolsReport.entries.map((e) => e.mapCode));
  assert.ok(codes.has('IGN_BASE'), 'Should detect Siemens IGN_BASE');
  assert.ok(codes.has('VVT_MAP') || codes.has('VALVE_OVERLAP'), 'Should detect VVT / Valve Overlap');
  assert.ok(codes.has('OVERRUN'), 'Should detect Overrun (Cut-Off)');

  const allHex = winolsReport.entries.flatMap((e) => e.hexAddresses);
  assert.ok(allHex.length >= 5, `Expected >=5 real hex addresses extracted, got ${allHex.length}`);

  const damosConfigs = buildDefaultDamosConfigsFromReport(winolsReport);
  const a2l = generateWinols224A2l({
    projectName: 'جزوه جامع ریمپ زیمنس',
    ecuFamily: 'Siemens EF7 / Tiba / TU5',
    baseAddressHex: '0x14000',
    byteOrder: 'HiLo',
    maps: damosConfigs,
  });

  assert.ok(a2l.validation.totalMaps >= 10);
  assert.match(a2l.a2lContent, /ASAP2_VERSION 1 51/);
});

test('changeLogUtils supports category filtering, Before/After metric deltas, and JSON/CSV export', () => {
  const revOld: ProjectRevisionDto = {
    id: 'rev_1',
    projectId: 'p1',
    versionNumber: 1,
    actorType: 'user',
    actorName: 'کاربر تست',
    actionType: 'files_ingested',
    title: 'بارگذاری فایل‌های منبع',
    summary: '۲ فایل اضافه شد',
    hasSnapshot: true,
    details: {
      chaptersCount: 4,
      unitsCount: 50,
      openConflictsCount: 3,
    },
    createdAt: '2026-11-22T10:00:00.000Z',
  };

  const revNew: ProjectRevisionDto = {
    id: 'rev_2',
    projectId: 'p1',
    versionNumber: 2,
    actorType: 'user',
    actorName: 'کاربر تست',
    actionType: 'winols_damos_exported',
    title: 'خروجی داموس WinOLS 2.24',
    summary: 'دانلود بسته A2L + CSV',
    hasSnapshot: false,
    details: {
      chaptersCount: 6,
      unitsCount: 54,
      openConflictsCount: 1,
      exportFormat: 'ASAP2 (.a2l)',
      mapsExported: 12,
    },
    createdAt: '2026-11-22T10:05:00.000Z',
  };

  assert.equal(getRevisionCategory('winols_damos_exported'), 'winols');
  assert.equal(getRevisionCategory('docx_exported'), 'export');
  assert.equal(getRevisionCategory('manual_checkpoint'), 'settings');

  const onlyWinols = filterProjectRevisions([revNew, revOld], {
    actorFilter: 'all',
    categoryFilter: 'winols',
    query: '',
  });
  assert.equal(onlyWinols.length, 1);
  assert.equal(onlyWinols[0].id, 'rev_2');

  const deltas = computeRevisionMetricDeltas([revNew, revOld]);
  assert.equal(deltas['rev_2'].chaptersDelta, 2);
  assert.equal(deltas['rev_2'].unitsDelta, 4);
  assert.equal(deltas['rev_2'].openConflictsDelta, -2);

  const jsonOut = exportRevisionsToJson('پروژه ریمپ', [revNew, revOld]);
  const parsed = JSON.parse(jsonOut);
  assert.equal(parsed.totalRevisions, 2);

  const csvOut = exportRevisionsToCsv([revNew, revOld]);
  assert.ok(csvOut.includes('winols_damos_exported'));
  assert.ok(csvOut.includes('خروجی داموس WinOLS 2.24'));
});
