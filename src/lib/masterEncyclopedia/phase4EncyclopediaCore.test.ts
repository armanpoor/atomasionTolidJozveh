import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearInMemoryMasterEncyclopediaStore,
  createMasterChapter,
  createMasterVolume,
  listMasterConflicts,
  listMasterKnowledgeUnits,
  listMasterVolumes,
  rollbackIngestBatch,
  setForceInMemoryMasterEncyclopedia,
  updateMasterVolume,
} from '../../db/masterEncyclopediaRepository.ts';
import {
  STRICT_NULL_DISPLAY_FA,
  areMeasurementsEquivalent,
  classifyAutomotiveContent,
  extractPhysicalMeasurements,
  formatStrictNullableField,
  normalizeRemapMapRecord,
  resolveCanonicalAutomotiveEntity,
} from './automotiveDomainEngine.ts';
import {
  ingestDocumentIntoMasterEncyclopedia,
  runMasterKnowledgeLinter,
} from './deltaMergeEngine.ts';
import {
  buildAdaptiveAutomotivePromptDirective,
  buildHighPrecisionRemapDirective,
} from '../universalSystemPrompt.ts';

describe('Phase 4 — Master Encyclopedia Core, Delta-Merge, Unit Normalization & High-Precision Remap Mode', () => {
  beforeEach(() => {
    setForceInMemoryMasterEncyclopedia(true);
    clearInMemoryMasterEncyclopediaStore();
  });

  after(() => {
    setForceInMemoryMasterEncyclopedia(false);
  });

  it('classifies general automotive vs High-Precision Remap Mode and enforces Strict Null Policy + No Invented Map Names', () => {
    // General automotive diagnostics -> High-Precision Remap Mode OFF
    const diagClass = classifyAutomotiveContent(
      'پروتکل OBDonUDS (SAE J1979-2) جایگزین نسل قدیم OBD2 برای خواندن DTC و داده‌های زنده PID است.'
    );
    assert.equal(diagClass.primaryDomain, 'diagnostics_obd');
    assert.equal(diagClass.highPrecisionRemapMode, false);

    // Remap / WinOLS / Hex -> High-Precision Remap Mode AUTO-ON
    const remapClass = classifyAutomotiveContent(
      'در WinOLS نقشه KFZW روی ECU Bosch ME7.4.4 در آدرس 0x18000 به صورت 16x12 و 16-bit HiLo قرار دارد.'
    );
    assert.equal(remapClass.primaryDomain, 'remap_tuning');
    assert.equal(remapClass.highPrecisionRemapMode, true);

    // Strict Null Policy & No Invented Map Names
    const mapRec = normalizeRemapMapRecord({
      hexAddress: '18000',
      mapName: '',
      bitWidth: 16,
      byteOrder: 'HiLo',
      stockValue: 'نامشخص',
      safeChangeRange: null,
      evidenceTier: 'pattern_candidate',
    });
    assert.equal(mapRec.mapName, 'UNKNOWN_MAP_0x18000');
    assert.equal(mapRec.stockValue, null);
    assert.equal(mapRec.safeChangeRange, null);
    assert.equal(formatStrictNullableField(mapRec.stockValue), STRICT_NULL_DISPLAY_FA);
    assert.equal(mapRec.humanReviewRequired, true);
    assert.equal(mapRec.flashReady, false);

    // Prompt directives include strict remap rules when enabled
    const directive = buildAdaptiveAutomotivePromptDirective({
      domainTitleFa: 'ریمپ و کالیبراسیون',
      highPrecisionRemapMode: true,
    });
    assert.ok(directive.includes('Strict Null Policy'));
    assert.ok(directive.includes('UNKNOWN_MAP_<HEX>'));
    assert.ok(buildHighPrecisionRemapDirective().includes('آماده فلش مستقیم'));
  });

  it('normalizes physical units (Bar↔PSI, Nm↔lb-ft, Lambda↔AFR, HP↔kW) and resolves canonical entities', () => {
    const mBar = extractPhysicalMeasurements('فشار بوست توربو برابر 1.0 bar است.')[0];
    const mPsi = extractPhysicalMeasurements('Boost pressure is 14.5 psi.')[0];
    assert.ok(mBar && mPsi);
    assert.equal(areMeasurementsEquivalent(mBar, mPsi), true);

    const mLam = extractPhysicalMeasurements('Lambda 0.85 در بار کامل')[0];
    const mAfr = extractPhysicalMeasurements('AFR 12.5:1 در تمام گاز')[0];
    assert.ok(mLam && mAfr);
    assert.equal(areMeasurementsEquivalent(mLam, mAfr), true);

    const mNm = extractPhysicalMeasurements('گشتاور 200 Nm')[0];
    const mLbFt = extractPhysicalMeasurements('Torque 147.5 lb-ft')[0];
    assert.ok(mNm && mLbFt);
    assert.equal(areMeasurementsEquivalent(mNm, mLbFt), true);

    const mHp = extractPhysicalMeasurements('قدرت 134 HP')[0];
    const mKw = extractPhysicalMeasurements('Power 100 kW')[0];
    assert.ok(mHp && mKw);
    assert.equal(areMeasurementsEquivalent(mHp, mKw), true);

    // Canonical Entity Resolver maps ME7.4.4 / بوش ۷.۴.۴ / ۲۰۶ تیپ ۵ to one canonical ID
    assert.equal(resolveCanonicalAutomotiveEntity('ایسیو بوش ۷.۴.۴ پژو')?.id, 'ECU:BOSCH_ME7.4.4');
    assert.equal(resolveCanonicalAutomotiveEntity('خودرو ۲۰۶ تیپ ۵')?.id, 'ECU:BOSCH_ME7.4.4');
    assert.equal(resolveCanonicalAutomotiveEntity('Bosch ME7.4.4 tuning')?.id, 'ECU:BOSCH_ME7.4.4');
  });

  it('executes incremental Delta-Merge: physical equivalence corroborates without false conflict, Anti-Sybil blocks same-session boost, and real conflicts route to master_conflicts', async () => {
    // 1. First independent upload (pressure in Bar)
    const r1 = await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_01',
      sourceUploadHash: 'hash_01',
      sourceFileName: 'turbo_boost_bar.md',
      rawText: '## فشار بوست توربو موتور EF7\nحداکثر فشار بوست مجاز توربوشارژر در بار کامل معادل 1.0 bar ثبت شده است.',
      submittedByRole: 'owner',
      submitterSessionHash: 'sess_owner_1',
    });
    assert.equal(r1.newUnitsCount, 1);

    // 2. Same session re-uploading exact duplicate MUST NOT inflate corroborationCount (Anti-Sybil)
    const rSameSession = await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_02',
      sourceUploadHash: 'hash_02',
      sourceFileName: 'turbo_boost_dup.md',
      rawText: '## فشار بوست توربو موتور EF7\nحداکثر فشار بوست مجاز توربوشارژر در بار کامل معادل 1.0 bar ثبت شده است.',
      submittedByRole: 'owner',
      submitterSessionHash: 'sess_owner_1',
    });
    assert.equal(rSameSession.duplicateUnitsCount, 1);
    let units = await listMasterKnowledgeUnits();
    assert.equal(units.length, 1);
    assert.equal(units[0].corroborationCount, 1);

    // 3. Second INDEPENDENT session uploading equivalent value in PSI (14.5 psi == 1.0 bar) -> corroboration, NOT conflict!
    const rEquiv = await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_03',
      sourceUploadHash: 'hash_03',
      sourceFileName: 'turbo_boost_psi.md',
      rawText: '## فشار بوست توربو موتور EF7\nحداکثر فشار بوست مجاز توربوشارژر در بار کامل معادل 14.5 psi ثبت شده است.',
      submittedByRole: 'user',
      submitterSessionHash: 'sess_user_2',
    });
    assert.equal(rEquiv.conflictsCount, 0);
    assert.equal(rEquiv.duplicateUnitsCount, 1);
    units = await listMasterKnowledgeUnits();
    assert.equal(units[0].corroborationCount, 2);

    // 4. Real divergent numeric value with different condition (octane / stage) -> master_conflicts!
    const rConflict = await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_04',
      sourceUploadHash: 'hash_04',
      sourceFileName: 'turbo_boost_stage2.md',
      rawText: '## فشار بوست توربو موتور EF7\nحداکثر فشار بوست مجاز توربوشارژر در بار کامل برای Stage 2 با بنزین سوپر اکتان ۹۸ برابر 1.8 bar است.',
      submittedByRole: 'user',
      submitterSessionHash: 'sess_user_3',
    });
    assert.equal(rConflict.conflictsCount, 1);
    const conflicts = await listMasterConflicts('open');
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].conflictType, 'implicit_conditional');
    assert.ok(conflicts[0].conditionContext);

    // 5. Rollback batch_04 removes the conflict cleanly
    await rollbackIngestBatch('batch_04');
    assert.equal((await listMasterConflicts('open')).length, 0);
  });

  it('places guest sensitive remap units in staging and auto-promotes to verified upon >= 2 independent corroborations', async () => {
    const remapDoc =
      '## نقشه جرقه KFZW بوش ME7.4.4\nآدرس نقشه KFZW در WinOLS برای Bosch ME7.4.4 برابر 0x18000 با ابعاد 16x12 و ساختار 16-bit HiLo است.';

    // Guest 1 submits sensitive remap info -> MUST start in 'staging'
    const g1 = await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_g1',
      sourceUploadHash: 'hash_g1',
      sourceFileName: 'guest_remap1.md',
      rawText: remapDoc,
      submittedByRole: 'guest',
      submitterSessionHash: 'guest_sess_1',
    });
    assert.equal(g1.stagingUnitsCount, 1);
    let units = await listMasterKnowledgeUnits();
    assert.equal(units.length, 1);
    assert.equal(units[0].verificationStatus, 'staging');

    // Independent User 2 corroborates same unit -> corroborationCount reaches 2 -> auto-promotes to 'verified'!
    await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_u2',
      sourceUploadHash: 'hash_u2',
      sourceFileName: 'user_remap2.md',
      rawText: remapDoc,
      submittedByRole: 'user',
      submitterSessionHash: 'user_sess_2',
    });
    units = await listMasterKnowledgeUnits();
    assert.equal(units[0].corroborationCount, 2);
    assert.equal(units[0].verificationStatus, 'verified');
  });

  it('proposes draft_proposal volume when split threshold is exceeded and detects orphan chapters via Knowledge Linter', async () => {
    const vol = await createMasterVolume({
      volumeNumber: 3,
      title: 'جلد ۳: عیب‌یابی و دیاگ',
      automotiveDomain: 'diagnostics_obd',
      status: 'published',
      splitThresholdWords: 10, // low threshold to trigger proposal cleanly
      splitThresholdPages: 1,
    });
    await updateMasterVolume(vol.id, { wordCount: 9, estimatedPages: 1 });
    // Create an orphan chapter with 0 units
    await createMasterChapter({
      volumeId: vol.id,
      title: 'فصل یتیم بدون محتوا',
    });

    await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_split',
      sourceUploadHash: 'hash_split',
      sourceFileName: 'obd_pids.md',
      rawText:
        '## پروتکل OBDonUDS و کدهای خطا\nدر استاندارد جدید SAE J1979-2 و OBDonUDS خواندن کدهای خطا DTC و داده‌های زنده PID و Freeze Frame با دقت بسیار بالاتر از OBD2 کلاسیک انجام می‌شود.',
      submittedByRole: 'owner',
      submitterSessionHash: 'owner_sess',
    });

    const volumes = await listMasterVolumes();
    assert.ok(volumes.some((v) => v.status === 'draft_proposal'));

    const lintReport = await runMasterKnowledgeLinter();
    assert.equal(lintReport.orphanChapters.length, 1);
    assert.equal(lintReport.orphanChapters[0].title, 'فصل یتیم بدون محتوا');
    assert.equal(lintReport.healthy, false);
  });

  it('verifies Generation-2 Commercial Refactoring: Entity Funnel, Inverse ASAM RAT_FUNC, Non-Strict AXIS_PTS, Dyno Coupling, Wildcard ContextScope, and Non-Destructive Physical Guard Quarantine', async () => {
    const {
      normalizeAutomotiveEntityKey,
      resolveCanonicalAutomotiveEntityFunnel,
    } = await import('./automotiveDomainEngine.ts');
    const {
      analyzeAutomotiveDatalogCsv,
      computeInverseAsamRatFunc,
      evaluateAutomotivePhysicalGuards,
      validateA2lAxisMonotonicity,
      verifyDynoTorquePowerCoupling,
    } = await import('./telemetryAnalyzer.ts');
    const {
      compareContextScopes,
      extractAutomotiveContextScope,
      resolveDeltaMergeDecisionMatrix,
    } = await import('./deltaMergeEngine.ts');

    // 1. Entity Key Normalization with positive lookahead (never corrupts multi-dot versions like 7.4.4 -> 744)
    assert.equal(normalizeAutomotiveEntityKey('ایسیو بوش 7.4.4'), 'ایسیو بوش 744');
    assert.equal(normalizeAutomotiveEntityKey('ME 17.9.71'), 'me 17971');
    const funnel = resolveCanonicalAutomotiveEntityFunnel('تیونینگ ایسیو بوش ۷.۴.۵ پژو ۲۰۶');
    assert.equal(funnel?.entity.id, 'ECU:BOSCH_ME7.4.5');

    // 2. True Inverse ASAM MCD-2 MC RAT_FUNC: Raw = (b*Phys + c)/f => Phys = (f*Raw - c)/b
    const inv = computeInverseAsamRatFunc({ a: 0, b: 4, c: 40, d: 0, e: 0, f: 1 });
    assert.equal(inv.valid, true);
    assert.equal(inv.rawToPhysicalFactor, 0.25);
    assert.equal(inv.rawToPhysicalOffset, -10);
    assert.equal((inv.rawToPhysicalFactor ?? 0) * 100 + (inv.rawToPhysicalOffset ?? 0), 15);
    const invZeroB = computeInverseAsamRatFunc({ a: 0, b: 0, c: 10, d: 0, e: 0, f: 1 });
    assert.equal(invZeroB.valid, false);

    // 3. Non-Strict A2L AXIS_PTS Monotonicity (descending axes & plateau repetitions allowed, zig-zag rejected)
    assert.equal(validateA2lAxisMonotonicity([6000, 4500, 3000, 1500]).valid, true);
    assert.equal(validateA2lAxisMonotonicity([1000, 2000, 2000, 3500]).valid, true);
    assert.equal(validateA2lAxisMonotonicity([1000, 3000, 2000, 4000]).valid, false);

    // 4. Dyno Mechanical Coupling: P_kW = (T_Nm * RPM) / 9549 within 3.5%
    assert.equal(
      verifyDynoTorquePowerCoupling({
        rpm: 4774.5,
        torqueValue: 200,
        torqueUnit: 'nm',
        powerValue: 100,
        powerUnit: 'kw',
      }).valid,
      true
    );
    assert.equal(
      verifyDynoTorquePowerCoupling({
        rpm: 4774.5,
        torqueValue: 200,
        torqueUnit: 'nm',
        powerValue: 145,
        powerUnit: 'kw',
      }).valid,
      false
    );

    // 5. Wildcard-Safe compareContextScopes (undefined field is WILDCARD_SUBSET_OVERLAP, never DISJOINT)
    const scopeWithEngine = extractAutomotiveContextScope('موتور TU5 با ایسیو Bosch ME7.4.4');
    const scopeWithoutEngine = extractAutomotiveContextScope('ایسیو Bosch ME7.4.4 در دور بالا');
    assert.notEqual(
      compareContextScopes(scopeWithEngine, scopeWithoutEngine),
      'DISJOINT_PLATFORM_SCOPE'
    );
    const decision = resolveDeltaMergeDecisionMatrix({
      existingTier: 'a2l_xdf_verified',
      incomingTier: 'pattern_candidate',
      scopeRelation: 'EXACT_SCOPE_MATCH',
      hasMeasurementConflict: true,
      equivalentPhysicalCorroboration: false,
      similarityScore: 0.75,
      exactHashMatch: false,
    });
    assert.equal(decision.decision, 'TIER_PROTECTED_SKIP');

    // 6. Generation-2 Physical Guard Non-Destructive Staging Quarantine (PFI rail pressure 120 bar anomaly)
    const anomalyText =
      '## تست فشار ریل سوخت PFI\nدر سیستم پاشش منیفولد PFI فشار ریل سوخت برابر 120 bar اندازه‌گیری شد.';
    const physCheck = evaluateAutomotivePhysicalGuards(anomalyText);
    assert.equal(physCheck.quarantineRecommended, true);

    const ingestAnomaly = await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: 'batch_phys_quarantine',
      sourceUploadHash: 'hash_phys_q1',
      sourceFileName: 'pfi_anomaly.md',
      rawText: anomalyText,
      submittedByRole: 'owner',
      submitterSessionHash: 'owner_phys_sess',
    });
    assert.equal(ingestAnomaly.newUnitsCount, 1);
    assert.equal(ingestAnomaly.stagingUnitsCount, 1);
    assert.equal(ingestAnomaly.physicalQuarantinedCount, 1);

    // 7. Deterministic Datalog CSV Analyzer (< 1,500 tokens brief)
    const sampleDatalogCsv = [
      'Time,RPM,Boost_bar,Lambda,Knock_Retard,IAT_C,ECT_C',
      '0.1,2500,0.4,0.98,0.0,34,88',
      '0.2,3800,1.1,0.86,-1.5,38,90',
      '0.3,5600,1.25,0.83,-4.2,44,93',
    ].join('\n');
    const brief = analyzeAutomotiveDatalogCsv(sampleDatalogCsv);
    assert.equal(brief.totalRowsParsed, 3);
    assert.ok(brief.estimatedBriefTokens < 1500);
    assert.ok(brief.anomalies.length >= 1);
  });
});
