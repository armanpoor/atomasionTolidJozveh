import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAntiDriftContract,
  buildCompactChapterDigestsWire,
  buildCompactConflictBatchWire,
  computeCallCostUsd,
  computeHarnessComparisonProof,
  estimateMultiTierPipelineCost,
  extractEntityPreservingExcerpt,
  extractTechnicalFactLedger,
  lookupModelPricing,
  validateDeepReviewOutput,
  validateOutlineRefinementOutput,
} from './tokenOptimizer';
import {
  applyMultiTierRecipe,
  DEFAULT_AI_PROVIDER_CONFIG,
  MULTI_TIER_RECIPES,
  resolveTierSlotForTask,
} from './aiProviderConfig';
import { buildInitialOutline, extractAtomicUnitsFromBook } from './zeroLossPipeline';
import { parseMarkdownDocument } from './formatParsers';
import type { ContentUnitDto, SourceFileDto } from './bookTypes';

test('extractEntityPreservingExcerpt keeps tail hex, WinOLS map code, and ECU specs in tight budget', () => {
  const filler =
    'در این بخش به صورت عمومی درباره روش مطالعه جزوه و نکات مقدماتی کارگاه صحبت می‌کنیم تا هنرجو با فضای کار آشنا شود. '.repeat(
      24
    );
  const criticalTail =
    'هشدار مهم: در ایسیو ME7.4.4 نقشه جرقه KFZW در آدرس 0x14FDA قرار دارد و بیش از +2.5 درجه در دور 4500 RPM نباید آوانس داد.';

  const units = [
    {
      outlineNodeId: 'ch_1',
      status: 'active',
      unitType: 'paragraph',
      rawText: `${filler}\n${criticalTail}`,
    },
  ];

  const excerpt = extractEntityPreservingExcerpt(units, 'ch_1', 420);
  assert.ok(excerpt.length <= 425, `Expected compact excerpt, got ${excerpt.length}`);
  assert.ok(excerpt.includes('0x14FDA'), 'Must preserve explicit hex address from tail of chapter');
  assert.ok(excerpt.includes('KFZW'), 'Must preserve WinOLS map code');
  assert.ok(excerpt.includes('ME7.4.4'), 'Must preserve ECU model');
});

test('buildCompactChapterDigestsWire achieves >= 30% token compression vs legacy verbose JSON', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({
    id: `node_${i + 1}`,
    nodeOrder: i + 1,
    title: `فصل ${i + 1}: کالیبراسیون نقشه KFZW و سوخت LAMFA در ME7.4.4`,
  }));

  const units = nodes.flatMap((n, idx) => [
    {
      outlineNodeId: n.id,
      status: 'active',
      unitType: 'paragraph',
      rawText:
        `توضیحات جامع کارگاهی درباره تنظیم نقشه در آدرس 0x14FD${idx} و ضریب لامبدا 0.85 در تمام بار (WOT) روی دور 5200 RPM. ` +
        'این توضیحات تکمیلی برای ارزیابی واقعی میزان فشرده‌سازی پرامپت و حذف سربار JSON استفاده می‌شود. '.repeat(
          10
        ),
    },
    {
      outlineNodeId: n.id,
      status: 'active',
      unitType: 'table',
      rawText: '| RPM | Load | Delta |\n| 4000 | 90% | +2.0° |',
    },
  ]);

  const balanced = buildCompactChapterDigestsWire({
    nodes,
    units,
    optimizationMode: 'balanced_pro',
  });
  const aggressive = buildCompactChapterDigestsWire({
    nodes,
    units,
    optimizationMode: 'aggressive_saver',
  });

  assert.ok(
    balanced.savingsPercent >= 30,
    `Expected >=30% savings in balanced_pro, got ${balanced.savingsPercent}%`
  );
  assert.ok(
    aggressive.savingsPercent >= balanced.savingsPercent,
    'Aggressive saver should compress at least as much as balanced_pro'
  );
  assert.ok(balanced.wireText.includes('0x14FD0'), 'Compact wire must preserve hex anchors');
});

test('real Siemens sample files compress efficiently and cluster with 100% zero-loss unit preservation', () => {
  const f1Path = path.resolve(
    process.cwd(),
    'public/assets/aistudio/Bakhsh1_Dars_01_ta_08-1_1707ad79.md'
  );
  const f2Path = path.resolve(
    process.cwd(),
    'public/assets/aistudio/Bakhsh2_Dars_08-2_ta_09-3_89994058.md'
  );

  if (!fs.existsSync(f1Path) || !fs.existsSync(f2Path)) {
    return;
  }

  const book1 = parseMarkdownDocument(fs.readFileSync(f1Path, 'utf8'), 'Bakhsh1_Dars_01_ta_08-1.md');
  const book2 = parseMarkdownDocument(fs.readFileSync(f2Path, 'utf8'), 'Bakhsh2_Dars_08-2_ta_09-3.md');

  const extracted1 = extractAtomicUnitsFromBook({
    projectId: 'proj_siemens_test',
    sourceFileId: 'sf_1',
    fileName: 'Bakhsh1_Dars_01_ta_08-1.md',
    fileRole: 'standard',
    book: book1,
  });
  const extracted2 = extractAtomicUnitsFromBook({
    projectId: 'proj_siemens_test',
    sourceFileId: 'sf_2',
    fileName: 'Bakhsh2_Dars_08-2_ta_09-3.md',
    fileRole: 'standard',
    book: book2,
  });

  const sourceFiles: SourceFileDto[] = [
    {
      id: 'sf_1',
      projectId: 'proj_siemens_test',
      fileName: 'Bakhsh1_Dars_01_ta_08-1.md',
      format: 'md',
      fileRole: 'standard',
      sizeBytes: 42_000,
      checksum: 'chk_sf_1',
      wordCount: 4000,
      unitCount: extracted1.length,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sf_2',
      projectId: 'proj_siemens_test',
      fileName: 'Bakhsh2_Dars_08-2_ta_09-3.md',
      format: 'md',
      fileRole: 'standard',
      sizeBytes: 38_000,
      checksum: 'chk_sf_2',
      wordCount: 3500,
      unitCount: extracted2.length,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const allUnits: ContentUnitDto[] = [...extracted1, ...extracted2].map((u) => ({
    id: u.id,
    projectId: u.projectId,
    sourceFileId: u.sourceFileId,
    unitOrder: u.unitOrder,
    unitType: u.unitType,
    headingPath: u.headingPath,
    rawText: u.rawText,
    normalizedHash: u.normalizedHash,
    status: 'active',
    canonicalUnitId: null,
    outlineNodeId: null,
    metadataJson: u.metadataJson,
  }));

  const outlined = buildInitialOutline({
    projectId: 'proj_siemens_test',
    workflowMode: 'multi_merge',
    sourceFiles,
    units: allUnits,
  });

  // Strict Zero-Loss check: every single non-merged unit MUST be assigned to an outline node
  const assignmentMap = new Map(outlined.unitAssignments.map((a) => [a.unitId, a.outlineNodeId]));
  const activeUnitIds = new Set(allUnits.map((u) => u.id));
  assert.equal(
    assignmentMap.size,
    activeUnitIds.size,
    'Zero-loss invariant violated: every active unit must be assigned to an outline chapter'
  );
  for (const id of activeUnitIds) {
    assert.ok(assignmentMap.has(id), `Unit ${id} was lost during multi_merge clustering`);
  }

  // Verify compact wire compression on the real Siemens corpus
  const unitsWithNodes = allUnits.map((u) => ({
    outlineNodeId: assignmentMap.get(u.id) || null,
    status: u.status,
    unitType: u.unitType,
    rawText: u.rawText,
  }));
  const wire = buildCompactChapterDigestsWire({
    nodes: outlined.nodes.map((n) => ({ id: n.id, nodeOrder: n.nodeOrder, title: n.title })),
    units: unitsWithNodes,
    optimizationMode: 'balanced_pro',
  });
  assert.ok(
    wire.savingsPercent >= 25,
    `Expected >=25% wire compression on real Siemens files, got ${wire.savingsPercent}%`
  );
});

test('validateDeepReviewOutput blocks hallucinated hex, drops invalid nodeIds, and preserves ECU title codes', () => {
  const originalNodes = [
    { id: 'n_fuel', title: 'فصل ۱: کالیبراسیون سوخت LAMFA در ایسیو ME7.4.4' },
    { id: 'n_ign', title: 'فصل ۲: تنظیم جرقه KFZW و کنترل ناک' },
  ];
  const ledger = extractTechnicalFactLedger(
    [
      { rawText: 'نقشه LAMFA در آدرس 0x14FDA با نسبت هوا به سوخت 12.8 روی ME7.4.4 تنظیم می‌شود.' },
      { rawText: 'نقشه KFZW در آدرس 0x16B20 قرار دارد و کد خطای P0325 بررسی شود.' },
    ],
    originalNodes
  );

  const contract = buildAntiDriftContract(ledger, 'deep_review');
  assert.ok(contract.includes('ME7.4.4') && contract.includes('LAMFA') && contract.includes('KFZW'));
  assert.ok(ledger.knownHexAddresses.has('0x14FDA'));

  const mockAiOutput = {
    titleRefinements: [
      // Attempts to strip ME7.4.4 & LAMFA from chapter title -> MUST BE BLOCKED!
      { nodeId: 'n_fuel', newTitle: 'فصل اول: توضیحات کلی سوخت', rationale: 'خلاصه' },
      // Valid title refinement preserving KFZW -> MUST PASS
      { nodeId: 'n_ign', newTitle: 'فصل ۲: تنظیم دقیق نقشه جرقه KFZW و مهار ناک', rationale: 'بهبود' },
      // Fabricated nodeId -> MUST BE DROPPED
      { nodeId: 'n_nonexistent_99', newTitle: 'فصل جعلی', rationale: 'خطا' },
    ],
    addedCallouts: [
      {
        nodeId: 'n_fuel',
        variant: 'warning',
        title: 'هشدار آدرس هگز',
        body: 'آدرس واقعی 0x14FDA است اما آدرس ساختگی 0xDEAD1 نباید تغییر کند.',
        rationale: 'ایمنی',
      },
    ],
    addedTables: [],
    addedParagraphs: [],
  };

  const result = validateDeepReviewOutput(mockAiOutput, originalNodes, ledger);
  assert.equal(result.droppedInvalidNodes, 1);
  assert.equal(result.sanitized.titleRefinements?.length, 1);
  assert.equal(result.sanitized.titleRefinements?.[0]?.nodeId, 'n_ign');
  assert.deepEqual(result.flaggedHallucinatedHex, ['0xDEAD1']);
  assert.ok(
    result.sanitized.addedCallouts?.[0]?.body?.includes('0x14FDA'),
    'Legitimate source hex must stay intact'
  );
  assert.ok(
    !result.sanitized.addedCallouts?.[0]?.body?.includes('0xDEAD1'),
    'Hallucinated hex must be quarantined'
  );
  assert.ok(result.driftWarningsFa.length >= 2);
  assert.ok(result.integrityScore < 100 && result.integrityScore >= 40);

  // Outline validator check
  const outlineCheck = validateOutlineRefinementOutput(
    [
      { id: 'n_fuel', title: 'فصل ۱: کالیبراسیون سوخت بدون کد', summary: 'توضیح سالم' },
      { id: 'n_ign', title: 'فصل ۲: کالیبراسیون KFZW پیشرفته', summary: 'توضیح دقیق بدون هگز جعلی' },
    ],
    originalNodes,
    ledger
  );
  assert.equal(outlineCheck.acceptedById.get('n_fuel')?.title, undefined);
  assert.equal(
    outlineCheck.acceptedById.get('n_ign')?.title,
    'فصل ۲: کالیبراسیون KFZW پیشرفته'
  );
});

test('Multi-Tier Recipes route Economy/Balanced/Flagship properly and inherit Tab-1 API keys', () => {
  const baseWithAnthropicKey = {
    ...DEFAULT_AI_PROVIDER_CONFIG,
    provider: 'anthropic' as const,
    providers: {
      ...DEFAULT_AI_PROVIDER_CONFIG.providers,
      anthropic: {
        ...DEFAULT_AI_PROVIDER_CONFIG.providers.anthropic,
        apiKey: 'sk-ant-test-inherited-key',
      },
    },
  };

  const anthropicRecipe = MULTI_TIER_RECIPES.find((r) => r.id === 'anthropic_golden_trio');
  assert.ok(anthropicRecipe, 'anthropic_golden_trio recipe must exist');

  const routedConfig = applyMultiTierRecipe(baseWithAnthropicKey, 'anthropic_golden_trio');
  const conflictTarget = resolveTierSlotForTask(routedConfig, 'conflict_triage');
  const reorderTarget = resolveTierSlotForTask(routedConfig, 'semantic_reorder');
  const deepReviewTarget = resolveTierSlotForTask(routedConfig, 'deep_review');

  assert.equal(conflictTarget.tierUsed, 'economy');
  assert.ok(conflictTarget.modelId.includes('haiku'));
  assert.equal(conflictTarget.apiKey, 'sk-ant-test-inherited-key');

  assert.equal(reorderTarget.tierUsed, 'balanced');
  assert.ok(reorderTarget.modelId.includes('sonnet'));
  assert.equal(reorderTarget.apiKey, 'sk-ant-test-inherited-key');

  assert.equal(deepReviewTarget.tierUsed, 'flagship');
  assert.ok(deepReviewTarget.modelId.includes('opus'));
  assert.equal(deepReviewTarget.apiKey, 'sk-ant-test-inherited-key');
});

test('Multi-Tier USD simulator & Harness Comparison Proof prove >= 55% savings vs Raw Opus / Agent', () => {
  const costSim = estimateMultiTierPipelineCost({
    documentWords: 12_000,
    chapterCount: 12,
    conflictCount: 8,
    optimizationMode: 'balanced_pro',
    enablePromptCaching: true,
    tierModels: {
      economy: 'claude-3-5-haiku-20241022',
      balanced: 'claude-sonnet-4-20250514',
      flagship: 'claude-opus-4-1-20250805',
    },
    taskTierMap: {
      conflict_triage: 'economy',
      outline_polish: 'economy',
      semantic_reorder: 'balanced',
      web_grounding: 'balanced',
      editor_chat: 'balanced',
      deep_review: 'flagship',
    },
  });

  assert.ok(
    costSim.savingsPercent >= 55,
    `Expected >=55% cost savings on Anthropic trio, got ${costSim.savingsPercent}%`
  );
  assert.ok(costSim.routedOptimizedCostUsd < costSim.flagshipOnlyCostUsd);

  // Verify Prompt Caching discount math
  const uncachedCost = computeCallCostUsd({
    modelId: 'claude-opus-4-1-20250805',
    promptTokens: 100_000,
    outputTokens: 5_000,
    cachedInputTokens: 0,
  });
  const cachedCost = computeCallCostUsd({
    modelId: 'claude-opus-4-1-20250805',
    promptTokens: 100_000,
    outputTokens: 5_000,
    cachedInputTokens: 80_000,
  });
  assert.ok(cachedCost < uncachedCost * 0.65, 'Anthropic prompt caching must sharply reduce input cost');

  // Verify Harness Comparison Proof
  const proof = computeHarnessComparisonProof({
    totalInputUnits: 140,
    uniqueUnitsPreserved: 122,
    coveragePercent: 100,
    duplicatesMerged: 18,
    totalSourceFiles: 4,
    conflictsCount: 5,
    technicalEntitiesTotal: 42,
    technicalEntitiesPreserved: 42,
  });

  assert.equal(proof.uniqueUnitsCoveragePercent, 100);
  assert.equal(proof.technicalEntitiesRetentionPercent, 100);
  assert.equal(proof.hallucinatedHexCount, 0);
  assert.ok(
    proof.tokenSavingsPercent >= 65,
    `Expected >=65% token savings vs raw harness, got ${proof.tokenSavingsPercent}%`
  );
  assert.ok(
    proof.costSavingsPercent >= 70,
    `Expected >=70% USD savings vs raw Opus harness, got ${proof.costSavingsPercent}%`
  );
  assert.equal(proof.proofPillars.length, 4);
});

test('multi_merge buildInitialOutline groups scattered cross-file topics in pedagogical ECU order', () => {
  const sourceFiles: SourceFileDto[] = [
    {
      id: 'f1',
      projectId: 'p1',
      fileName: 'part1.md',
      format: 'md',
      fileRole: 'standard',
      sizeBytes: 1200,
      checksum: 'chk_f1',
      wordCount: 100,
      unitCount: 3,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'f2',
      projectId: 'p1',
      fileName: 'part2.md',
      format: 'md',
      fileRole: 'standard',
      sizeBytes: 1000,
      checksum: 'chk_f2',
      wordCount: 100,
      unitCount: 2,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const makeUnit = (
    id: string,
    sourceFileId: string,
    order: number,
    headingPath: string,
    rawText: string
  ) => ({
    id,
    projectId: 'p1',
    sourceFileId,
    unitOrder: order,
    headingPath,
    unitType: 'paragraph' as const,
    rawText,
    normalizedHash: `h_${id}`,
    status: 'active' as const,
    canonicalUnitId: null,
    outlineNodeId: null,
    metadataJson: null,
  });

  const units = [
    // Intentionally out of pedagogical order: DTC/immo first, basics last!
    makeUnit('u1', 'f1', 0, 'کد خطا و ایموبلایزر', 'حذف کد خطای P0420 کاتالیست و غیرفعال‌سازی DTC در ایسیو'),
    makeUnit('u2', 'f1', 1, 'تنظیم جرقه و آوانس', 'کالیبراسیون نقشه جرقه KFZW و کنترل ناک موتور'),
    makeUnit('u3', 'f1', 2, 'مبانی ریمپ و ایسیو', 'آشنایی با مفاهیم پایه ECU و اصول اولیه ریمپ'),
    makeUnit('u4', 'f2', 0, 'تکمیلی جرقه', 'نکات تکمیلی نقشه آوانس جرقه KFZW روی بنزین معمولی'),
    makeUnit('u5', 'f2', 1, 'تنظیم سوخت و لامبدا', 'کالیبراسیون پاشش سوخت LAMFA و نسبت AFR'),
  ];

  const outlined = buildInitialOutline({
    projectId: 'p1',
    workflowMode: 'multi_merge',
    sourceFiles,
    units,
  });

  const assignmentMap = new Map(outlined.unitAssignments.map((a) => [a.unitId, a.outlineNodeId]));
  assert.equal(assignmentMap.size, units.length, '100% of units must be preserved');

  // Basics should come BEFORE fuel/ignition, which should come BEFORE DTC/immo
  const titles = outlined.nodes.map((n) => n.title);
  const idxBasics = titles.findIndex((t) => /مبانی|پایه/.test(t));
  const idxFuel = titles.findIndex((t) => /سوخت|لامبدا/.test(t));
  const idxIgn = titles.findIndex((t) => /جرقه|آوانس/.test(t));
  const idxDtc = titles.findIndex((t) => /خطا|ایموبلایزر|DTC/.test(t));

  assert.ok(idxBasics >= 0 && idxFuel >= 0 && idxIgn >= 0 && idxDtc >= 0, `Unexpected outline: ${titles.join(' | ')}`);
  assert.ok(idxBasics < idxFuel, 'Basics must precede Fuel');
  assert.ok(idxFuel < idxIgn, 'Fuel must precede Ignition');
  assert.ok(idxIgn < idxDtc, 'Ignition must precede DTC/Immo');

  // Both ignition units from f1 and f2 should cluster into the same ignition chapter
  assert.equal(
    assignmentMap.get('u2'),
    assignmentMap.get('u4'),
    'Cross-file ignition notes should cluster into the same topic chapter'
  );
});

test('buildCompactConflictBatchWire compresses conflict pairs cleanly', () => {
  const batch = Array.from({ length: 8 }, (_, i) => ({
    id: `c_${i}`,
    topic: `مقایسه زاویه جرقه در دور ${3000 + i * 250} RPM`,
    excerptA: 'در فایل اول مقدار آوانس جرقه در این ناحیه برابر با +2.5 درجه ذکر شده است. '.repeat(5),
    excerptB: 'در فایل دوم مقدار آوانس جرقه در همین ناحیه برابر با +4.0 درجه پیشنهاد شده است. '.repeat(5),
  }));
  const res = buildCompactConflictBatchWire(batch, 'balanced_pro');
  assert.ok(res.savingsPercent >= 25, `Expected >=25% conflict batch compression, got ${res.savingsPercent}%`);
  assert.ok(res.wireText.includes('c_0'));
});

test('segmentBidiTechnicalRuns preserves multi-word English technical phrases without RTL reversal', async () => {
  const { segmentBidiTechnicalRuns } = await import('./ecuTechnicalIntegrity');
  const runs = segmentBidiTechnicalRuns(
    'لاگ‌گیری ناک (Knock Retard) روی نقشه Target Engine Load در آدرس 0x1A4F0 الزامی است.'
  );
  const techTexts = runs.filter((r) => r.kind === 'ltr_tech').map((r) => r.text);
  const codeTexts = runs.filter((r) => r.kind === 'ltr_code').map((r) => r.text);
  assert.ok(techTexts.includes('Knock Retard'), `Expected cohesive 'Knock Retard', got ${JSON.stringify(techTexts)}`);
  assert.ok(
    techTexts.includes('Target Engine Load'),
    `Expected cohesive 'Target Engine Load', got ${JSON.stringify(techTexts)}`
  );
  assert.ok(codeTexts.includes('0x1A4F0'), 'Hex address must remain isolated as ltr_code chip');
});

test('lookupModelPricing & computeCallCostUsd support Nov 2026 models and custom user USD pricing overrides', () => {
  const novSonnet = lookupModelPricing('claude-sonnet-5.5');
  assert.equal(novSonnet.inputPerMillionUsd, 3.0);
  assert.equal(novSonnet.outputPerMillionUsd, 15.0);

  const novGpt = lookupModelPricing('gpt-6.2-sol');
  assert.equal(novGpt.inputPerMillionUsd, 1.5);
  assert.equal(novGpt.outputPerMillionUsd, 6.0);

  const customProfiles = {
    'avalai/private-persian-ecu': {
      modelId: 'avalai/private-persian-ecu',
      displayName: 'AvalAI Private',
      inputPerMillionUsd: 0.8,
      outputPerMillionUsd: 3.2,
    },
  };
  const resolved = lookupModelPricing('avalai/private-persian-ecu', customProfiles);
  assert.equal(resolved.inputPerMillionUsd, 0.8);
  assert.equal(resolved.outputPerMillionUsd, 3.2);

  const cost = computeCallCostUsd({
    modelId: 'avalai/private-persian-ecu',
    promptTokens: 1_000_000,
    outputTokens: 500_000,
    customProfiles,
  });
  assert.equal(Number(cost.toFixed(6)), 2.4);
});


