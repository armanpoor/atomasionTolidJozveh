import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DOCX_CONFIG, ContentUnitDto, SourceFileDto } from './bookTypes.ts';
import { parseMarkdownDocument } from './formatParsers.ts';
import {
  assembleFinalBookAndAudit,
  buildInitialOutline,
  extractAtomicUnitsFromBook,
  hasDistinctParallelIdentifiers,
  isGenuineNumericConflict,
  losslessUnionTexts,
  runDeterministicLosslessDedup,
} from './zeroLossPipeline.ts';

test('losslessUnionTexts preserves unique details from both overlapping texts (X+Y) U (X+Z)', () => {
  const textA = 'فشار بوست استاندارد در موتور توربو ۱.۲ بار است. دمای هوای ورودی باید زیر ۵۰ درجه بماند.';
  const textB = 'فشار بوست استاندارد در موتور توربو ۱.۲ بار است. استفاده از اینترکولر بزرگ‌تر از ناک جلوگیری می‌کند.';

  const union = losslessUnionTexts(textA, textB);
  assert.ok(union.mergedText.includes('۱.۲ بار'), 'Shared fact X must remain');
  assert.ok(union.mergedText.includes('۵۰ درجه'), 'Unique fact Y from A must remain');
  assert.ok(union.mergedText.includes('اینترکولر'), 'Unique fact Z from B must be merged in');
  assert.equal(union.addedSentences.length, 1);
});

test('runDeterministicLosslessDedup merges duplicates cleanly while preserving conflicting numbers in both files', () => {
  const projectId = 'proj_test_1';
  const fileA: SourceFileDto = {
    id: 'file_a',
    projectId,
    fileName: 'manual-v1.md',
    format: 'md',
    fileRole: 'standard',
    sizeBytes: 500,
    wordCount: 60,
    unitCount: 3,
    checksum: 'a1',
    uploadedAt: new Date().toISOString(),
  };
  const fileB: SourceFileDto = {
    id: 'file_b',
    projectId,
    fileName: 'manual-v2.md',
    format: 'md',
    fileRole: 'standard',
    sizeBytes: 520,
    wordCount: 65,
    unitCount: 3,
    checksum: 'b2',
    uploadedAt: new Date().toISOString(),
  };

  const docA = parseMarkdownDocument(
    [
      '# فصل ۱: سوخت‌رسانی',
      '## ۱-۱. تنظیم پاشش',
      'نسبت هوا به سوخت استوکیومتری در بنزین معمولی برابر ۱۴.۷ به ۱ است.',
      'حداکثر فشار ریل سوخت در حالت تمام‌گاز برابر ۴ بار است.',
      'فیلتر بنزین باید هر ۲۰۰۰۰ کیلومتر تعویض شود. استفاده از بنزین سوپر توصیه می‌شود.',
    ].join('\n\n'),
    fileA.fileName
  );

  const docB = parseMarkdownDocument(
    [
      '# فصل ۱: سوخت‌رسانی',
      '## ۱-۱. تنظیم پاشش',
      'نسبت هوا به سوخت استوکیومتری در بنزین معمولی برابر ۱۴.۷ به ۱ است.',
      'حداکثر فشار ریل سوخت در حالت تمام‌گاز برابر ۶ بار است.',
      'فیلتر بنزین باید هر ۲۰۰۰۰ کیلومتر تعویض شود. گرفتگی فیلتر باعث افت توان می‌شود.',
    ].join('\n\n'),
    fileB.fileName
  );

  const unitsA = extractAtomicUnitsFromBook({
    projectId,
    sourceFileId: fileA.id,
    fileName: fileA.fileName,
    fileRole: 'standard',
    book: docA,
  });
  const unitsB = extractAtomicUnitsFromBook({
    projectId,
    sourceFileId: fileB.id,
    fileName: fileB.fileName,
    fileRole: 'standard',
    book: docB,
    startingOrder: unitsA.length,
  });

  const allUnits: ContentUnitDto[] = [...unitsA, ...unitsB].map((u) => ({
    ...u,
    canonicalUnitId: null,
    outlineNodeId: null,
  }));

  const dedup = runDeterministicLosslessDedup({
    projectId,
    workflowMode: 'multi_merge',
    sourceFiles: [fileA, fileB],
    units: allUnits,
  });

  // 1) Exact duplicate (14.7:1) merged + Near duplicate (fuel filter) lossless-unioned => 2 clusters
  assert.ok(dedup.clusters.length >= 2, `Expected >=2 dedup clusters, got ${dedup.clusters.length}`);

  // 2) Numeric conflict (4 bar vs 6 bar) detected AND BOTH preserved (neither marked merged!)
  assert.equal(dedup.conflicts.length, 1, 'Expected 1 numeric conflict between 4 bar and 6 bar');
  assert.equal(dedup.conflicts[0].fileAName, 'manual-v1.md');
  assert.equal(dedup.conflicts[0].fileBName, 'manual-v2.md');

  // Verify neither side of conflict was dropped/merged
  const conflictUpdates = dedup.unitUpdates.filter(
    (u) => u.id === dedup.conflicts[0].unitAId || u.id === dedup.conflicts[0].unitBId
  );
  assert.equal(conflictUpdates.length, 2);
  assert.ok(conflictUpdates.every((u) => u.status === 'conflict'));

  // Apply dedup updates and assemble final book to verify 100% coverage
  const updatedUnits: ContentUnitDto[] = allUnits.map((u) => {
    const patch = dedup.unitUpdates.find((p) => p.id === u.id);
    return patch ? { ...u, status: patch.status, canonicalUnitId: patch.canonicalUnitId, rawText: patch.rawText } : u;
  });

  const outline = buildInitialOutline({
    projectId,
    workflowMode: 'multi_merge',
    sourceFiles: [fileA, fileB],
    units: updatedUnits,
  });

  const assignedUnits = updatedUnits.map((u) => {
    const a = outline.unitAssignments.find((x) => x.unitId === u.id);
    return a ? { ...u, outlineNodeId: a.outlineNodeId } : u;
  });

  const finalOut = assembleFinalBookAndAudit({
    projectId,
    projectTitle: 'کتاب یکپارچه تست',
    workflowMode: 'multi_merge',
    config: DEFAULT_DOCX_CONFIG,
    sourceFiles: [fileA, fileB],
    units: assignedUnits,
    clusters: dedup.clusters,
    conflicts: dedup.conflicts.map((c) => ({
      ...c,
      resolutionNote: null,
      webGroundingJson: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    outlineNodes: outline.nodes.map((n) => ({ ...n, isApproved: true, webEnrichmentJson: null })),
  });

  assert.equal(finalOut.audit.coveragePercent, 100, 'Coverage must be 100%');
  assert.equal(finalOut.audit.conflictsDetected, 1);
  // Ensure the lossless union sentence from File B is inside the final assembled book
  const fullText = JSON.stringify(finalOut.book);
  assert.ok(fullText.includes('افت توان'), 'Unique detail from merged File B unit must be in final book');
  assert.ok(fullText.includes('۴ بار') && fullText.includes('۶ بار'), 'Both conflicting values must remain in final book');
});

test('master_update mode anchors chapters to Master file and injects only genuinely new supplement facts', () => {
  const projectId = 'proj_master_1';
  const masterFile: SourceFileDto = {
    id: 'f_master',
    projectId,
    fileName: 'master-book.md',
    format: 'md',
    fileRole: 'master',
    sizeBytes: 600,
    wordCount: 50,
    unitCount: 2,
    checksum: 'm1',
    uploadedAt: new Date().toISOString(),
  };
  const suppFile: SourceFileDto = {
    id: 'f_supp',
    projectId,
    fileName: 'update-2026.md',
    format: 'md',
    fileRole: 'supplement',
    sizeBytes: 300,
    wordCount: 30,
    unitCount: 2,
    checksum: 's1',
    uploadedAt: new Date().toISOString(),
  };

  const masterBook = parseMarkdownDocument(
    '# فصل ۱: عیب‌یابی سنسور اکسیژن\n\nسنسور اکسیژن میزان آلایندگی اگزوز را می‌سنجد.\n\n# فصل ۲: کالیبراسیون جرقه\n\nآوانس جرقه با جدول ناک کنترل می‌شود.',
    masterFile.fileName
  );
  const suppBook = parseMarkdownDocument(
    '# یادداشت جدید\n\nسنسور اکسیژن میزان آلایندگی اگزوز را می‌سنجد.\n\nسنسور اکسیژن وایدبند دقت بسیار بالاتری در بار کامل دارد.',
    suppFile.fileName
  );

  const uMaster = extractAtomicUnitsFromBook({
    projectId,
    sourceFileId: masterFile.id,
    fileName: masterFile.fileName,
    fileRole: 'master',
    book: masterBook,
  });
  const uSupp = extractAtomicUnitsFromBook({
    projectId,
    sourceFileId: suppFile.id,
    fileName: suppFile.fileName,
    fileRole: 'supplement',
    book: suppBook,
    startingOrder: uMaster.length,
  });

  const allUnits: ContentUnitDto[] = [...uMaster, ...uSupp].map((u) => ({
    ...u,
    canonicalUnitId: null,
    outlineNodeId: null,
  }));

  const dedup = runDeterministicLosslessDedup({
    projectId,
    workflowMode: 'master_update',
    sourceFiles: [masterFile, suppFile],
    units: allUnits,
  });

  const updatedUnits = allUnits.map((u) => {
    const p = dedup.unitUpdates.find((x) => x.id === u.id);
    return p ? { ...u, status: p.status, canonicalUnitId: p.canonicalUnitId, rawText: p.rawText } : u;
  });

  // Duplicate from supplement must be merged into Master
  assert.equal(dedup.clusters.length, 1);

  const outline = buildInitialOutline({
    projectId,
    workflowMode: 'master_update',
    sourceFiles: [masterFile, suppFile],
    units: updatedUnits,
  });

  // Master chapters preserved as top 2 chapters, and new wideband oxygen sensor note injected into Master Chapter 1!
  assert.equal(outline.nodes[0].title, 'عیب‌یابی سنسور اکسیژن');
  assert.equal(outline.nodes[1].title, 'کالیبراسیون جرقه');
  const newSuppUnit = updatedUnits.find((u) => u.rawText.includes('وایدبند'));
  assert.ok(newSuppUnit, 'New supplement unit must exist');
  const assigned = outline.unitAssignments.find((a) => a.unitId === newSuppUnit!.id);
  assert.equal(assigned?.outlineNodeId, outline.nodes[0].id, 'New O2 sensor note should inject into Master Chapter 1');
});

test('assembleFinalBookAndAudit preserves 100% original units alongside full-document Google enrichment and deep review callouts', () => {
  const projectId = 'proj_enrich_review';
  const fileA: SourceFileDto = {
    id: 'f1',
    projectId,
    fileName: 'ch1.md',
    format: 'md',
    fileRole: 'standard',
    sizeBytes: 300,
    wordCount: 30,
    unitCount: 2,
    checksum: 'c1',
    uploadedAt: new Date().toISOString(),
  };

  const units: ContentUnitDto[] = [
    {
      id: 'u_orig_1',
      projectId,
      sourceFileId: 'f1',
      unitOrder: 1,
      unitType: 'paragraph',
      headingPath: 'فصل ۱: مبانی ریمپ',
      rawText: 'نقشه جرقه پایه باید با توجه به اکتان سوخت کالیبره شود.',
      normalizedHash: 'h1',
      status: 'active',
      canonicalUnitId: null,
      outlineNodeId: 'n1',
      metadataJson: { fileName: 'ch1.md', block: { type: 'paragraph', id: 'u_orig_1', text: 'نقشه جرقه پایه باید با توجه به اکتان سوخت کالیبره شود.' } },
    },
    {
      id: 'u_rev_co_1',
      projectId,
      sourceFileId: 'f1',
      unitOrder: 2,
      unitType: 'callout',
      headingPath: 'فصل ۱: مبانی ریمپ > نکات تکمیلی بازبینی هوشمند',
      rawText: 'هشدار کوبش\nهمواره سنسور ناک را هنگام تست داینو پایش کنید.',
      normalizedHash: 'h2',
      status: 'active',
      canonicalUnitId: null,
      outlineNodeId: 'n1',
      metadataJson: {
        fileName: 'بازبینی عمیق هوش مصنوعی (XHIGH)',
        block: {
          type: 'callout',
          id: 'u_rev_co_1',
          variant: 'warning',
          title: 'هشدار کوبش',
          paragraphs: ['همواره سنسور ناک را هنگام تست داینو پایش کنید.'],
        },
      },
    },
  ];

  const assembled = assembleFinalBookAndAudit({
    projectId,
    projectTitle: 'راهنمای تست',
    workflowMode: 'single_polish',
    config: { ...DEFAULT_DOCX_CONFIG, googleSearchMode: 'full_document_enrichment' },
    sourceFiles: [fileA],
    units,
    clusters: [],
    conflicts: [],
    outlineNodes: [
      {
        id: 'n1',
        projectId,
        parentId: null,
        level: 1,
        nodeOrder: 1,
        title: 'مبانی ریمپ',
        summary: 'خلاصه فصل',
        isApproved: true,
        webEnrichmentJson: {
          title: 'تکمیل جامع با جستجوی گوگل — مبانی ریمپ',
          summary: 'استانداردهای جدید کالیبراسیون بر پایش لحظه‌ای لامبدا تأکید دارند.',
          sources: [{ title: 'SAE Calibration Guide', uri: 'https://example.org/sae' }],
          checkedAt: new Date().toISOString(),
        },
      },
    ],
  });

  assert.equal(assembled.audit.coveragePercent, 100);
  const allBlocks = [
    ...assembled.book.chapters[0].introBlocks,
    ...assembled.book.chapters[0].sections.flatMap((s) => s.blocks),
  ];
  assert.ok(allBlocks.some((b) => b.type === 'paragraph' && b.text.includes('اکتان سوخت')));
  assert.ok(allBlocks.some((b) => b.type === 'callout' && b.title === 'هشدار کوبش'));
  assert.ok(
    allBlocks.some(
      (b) => b.type === 'web_enrichment' && b.sources.length === 1 && b.summary.includes('لامبدا')
    ),
    'Isolated Google Search enrichment block with source citation must be embedded'
  );
});

test('isGenuineNumericConflict eliminates false positives on complementary decimal/hex rows, distinct conditions, codes, and elaborations while catching true contradictions', () => {
  // 1. Exact complementary hex/decimal mapping rows from user report -> NOT conflicts
  const hexEF = 'عدد ۱۴ در دسیمال = حرف E در هگزادسیمال عدد ۱۵ در دسیمال = حرف F در هگزادسیمال';
  const hexB = 'عدد ۱۱ در دسیمال = حرف B در هگزادسیمال';
  const hexC = 'عدد ۱۲ در دسیمال = حرف C در هگزادسیمال';
  const hexD = 'عدد ۱۳ در دسیمال = حرف D در هگزادسیمال';

  assert.equal(isGenuineNumericConflict(hexEF, hexB), false, '14=E/15=F vs 11=B is complementary, not a conflict');
  assert.equal(isGenuineNumericConflict(hexEF, hexC), false, '14=E/15=F vs 12=C is complementary, not a conflict');
  assert.equal(isGenuineNumericConflict(hexEF, hexD), false, '14=E/15=F vs 13=D is complementary, not a conflict');
  assert.equal(hasDistinctParallelIdentifiers(hexEF, hexB), true, 'Parallel hex rows must not be merged');

  // 2. Same LHS mapping with conflicting RHS -> GENUINE conflict!
  assert.equal(
    isGenuineNumericConflict(
      'عدد ۱۱ در دسیمال = حرف B در هگزادسیمال',
      'عدد ۱۱ در دسیمال = حرف C در هگزادسیمال'
    ),
    true,
    'Same LHS mapping to different RHS must be detected as a real conflict'
  );

  // 3. Distinct operating conditions -> NOT conflicts
  assert.equal(
    isGenuineNumericConflict(
      'دمای کارکرد نرمال موتور ۹۰ درجه است.',
      'دمای فعال‌شدن فن موتور ۱۰۲ درجه است.'
    ),
    false,
    'Normal operating temp vs fan activation temp are complementary'
  );
  assert.equal(
    isGenuineNumericConflict(
      'فشار بوست در دور آرام ۱.۵ بار است.',
      'فشار بوست در حالت تمام‌گاز ۴ بار است.'
    ),
    false,
    'Idle boost vs full-throttle boost are distinct conditions'
  );

  // 4. Distinct diagnostic codes / entity indices -> NOT conflicts
  assert.equal(
    isGenuineNumericConflict(
      'کد خطای P0135 مربوط به گرمکن سنسور اکسیژن بانک ۱ با ولتاژ ۱۲ ولت است.',
      'کد خطای P0141 مربوط به گرمکن سنسور اکسیژن بانک ۲ با ولتاژ ۵ ولت است.'
    ),
    false,
    'Different DTC codes P0135 vs P0141 are complementary items'
  );

  // 5. Superset / elaboration -> NOT a conflict
  assert.equal(
    isGenuineNumericConflict(
      'فیلتر بنزین باید هر ۲۰۰۰۰ کیلومتر تعویض شود.',
      'فیلتر بنزین باید هر ۲۰۰۰۰ کیلومتر تعویض شود و در شرایط پرفشار هر ۱۵۰۰۰ کیلومتر بررسی شود.'
    ),
    false,
    'Elaboration adding a secondary condition is not a conflict'
  );

  // 6. Genuine numeric contradiction about the exact same property and condition -> TRUE conflict!
  assert.equal(
    isGenuineNumericConflict(
      'حداکثر فشار ریل سوخت در حالت تمام‌گاز برابر ۴ بار است.',
      'حداکثر فشار ریل سوخت در حالت تمام‌گاز برابر ۶ بار است.'
    ),
    true,
    'Contradictory max fuel rail pressure under identical full-throttle condition must be flagged'
  );
});

test('runDeterministicLosslessDedup keeps all complementary hex mapping rows active with 0 conflicts and 0 accidental merges', () => {
  const projectId = 'proj_hex_zero_fp';
  const file1: SourceFileDto = {
    id: 'f_hex_1',
    projectId,
    fileName: '1-مفاهیم-پایه.docx',
    format: 'docx',
    fileRole: 'standard',
    sizeBytes: 400,
    wordCount: 30,
    unitCount: 1,
    checksum: 'h1',
    uploadedAt: new Date().toISOString(),
  };
  const file2: SourceFileDto = {
    id: 'f_hex_2',
    projectId,
    fileName: '2-مفاهیم-تکمیلی.docx',
    format: 'docx',
    fileRole: 'standard',
    sizeBytes: 420,
    wordCount: 35,
    unitCount: 3,
    checksum: 'h2',
    uploadedAt: new Date().toISOString(),
  };

  const doc1 = parseMarkdownDocument(
    '# مفاهیم پایه\n\nعدد ۱۴ در دسیمال = حرف E در هگزادسیمال عدد ۱۵ در دسیمال = حرف F در هگزادسیمال',
    file1.fileName
  );
  const doc2 = parseMarkdownDocument(
    [
      '# مفاهیم پایه',
      'عدد ۱۱ در دسیمال = حرف B در هگزادسیمال',
      'عدد ۱۲ در دسیمال = حرف C در هگزادسیمال',
      'عدد ۱۳ در دسیمال = حرف D در هگزادسیمال',
    ].join('\n\n'),
    file2.fileName
  );

  const u1 = extractAtomicUnitsFromBook({
    projectId,
    sourceFileId: file1.id,
    fileName: file1.fileName,
    fileRole: 'standard',
    book: doc1,
  });
  const u2 = extractAtomicUnitsFromBook({
    projectId,
    sourceFileId: file2.id,
    fileName: file2.fileName,
    fileRole: 'standard',
    book: doc2,
    startingOrder: u1.length,
  });

  const allUnits: ContentUnitDto[] = [...u1, ...u2].map((u) => ({
    ...u,
    canonicalUnitId: null,
    outlineNodeId: null,
  }));

  const dedup = runDeterministicLosslessDedup({
    projectId,
    workflowMode: 'multi_merge',
    sourceFiles: [file1, file2],
    units: allUnits,
  });

  assert.equal(dedup.conflicts.length, 0, 'Expected 0 false-positive conflicts for complementary hex rows');
  assert.equal(dedup.clusters.length, 0, 'Expected 0 accidental merges across distinct hex rows');
  assert.equal(dedup.unitUpdates.length, 4, 'All 4 complementary rows must remain active');
  assert.ok(dedup.unitUpdates.every((u) => u.status === 'active'), 'Every complementary row must stay active');
});


