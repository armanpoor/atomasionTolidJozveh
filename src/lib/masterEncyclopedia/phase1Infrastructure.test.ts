import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Response, NextFunction } from 'express';
import {
  clearInMemoryMasterEncyclopediaStore,
  createMasterChapter,
  createMasterConflict,
  createMasterKnowledgeUnit,
  createMasterUnitRevision,
  createMasterVolume,
  deleteMasterVolume,
  enqueueMasterIngestJob,
  getMasterIngestJobById,
  getMasterKnowledgeUnitById,
  listMasterChapters,
  listMasterConflicts,
  listMasterIngestLogs,
  listMasterKnowledgeUnits,
  listMasterVolumes,
  mergeMasterChapters,
  moveMasterChapterToVolume,
  recalculateVolumeAndChapterStats,
  resetMasterEncyclopedia,
  resolveMasterConflict,
  rollbackIngestBatch,
  setForceInMemoryMasterEncyclopedia,
  takedownBySourceUploadHash,
  upsertMasterCanonicalEntity,
  listMasterCanonicalEntities,
} from '../../db/masterEncyclopediaRepository.ts';
import { isSqlConfigured } from '../../db/index.ts';
import {
  isMasterEncyclopediaEnabled,
  runEncyclopediaIsolated,
} from './featureFlag.ts';
import { isAdminUser, requireAdmin, resolveAdminEmailSet } from '../../middleware/adminAuth.ts';
import {
  processNextMasterIngestJob,
  drainMasterIngestQueue,
} from '../../server/masterIngestWorker.ts';
import type { AuthRequest } from '../../middleware/auth.ts';

describe('Phase 1 — Master Encyclopedia Infrastructure, Queue, Isolation & Admin RBAC', () => {
  beforeEach(() => {
    setForceInMemoryMasterEncyclopedia(true);
    clearInMemoryMasterEncyclopediaStore();
  });

  after(() => {
    setForceInMemoryMasterEncyclopedia(false);
  });

  it('persists volumes, chapters, entities, units and supports chapter move/merge + stats recalculation', async () => {
    const vol1 = await createMasterVolume({
      volumeNumber: 1,
      title: 'جلد ۱: مبانی موتور و احتراق',
      automotiveDomain: 'engine_mechanics',
      status: 'published',
    });
    const vol2 = await createMasterVolume({
      volumeNumber: 2,
      title: 'جلد ۲: ریمپ و کالیبراسیون ECU',
      automotiveDomain: 'remap_tuning',
      status: 'published',
    });

    const ch1 = await createMasterChapter({
      volumeId: vol1.id,
      title: 'مبانی احتراق PFI و GDI',
      pedagogicalRank: 1,
      orderIndex: 1,
    });
    const ch2 = await createMasterChapter({
      volumeId: vol1.id,
      title: 'نسبت هوا به سوخت Lambda',
      pedagogicalRank: 2,
      orderIndex: 2,
    });

    await upsertMasterCanonicalEntity({
      id: 'ECU:BOSCH_ME7.4.4',
      entityType: 'ecu',
      canonicalName: 'Bosch ME7.4.4',
      aliasesJson: ['ME7.4.4', 'بوش ۷.۴.۴'],
      domainTag: 'remap_tuning',
    });
    await upsertMasterCanonicalEntity({
      id: 'ECU:BOSCH_ME7.4.4',
      entityType: 'ecu',
      canonicalName: 'Bosch ME7.4.4',
      aliasesJson: ['۲۰۶ تیپ ۵'],
      domainTag: 'remap_tuning',
    });
    const entities = await listMasterCanonicalEntities();
    assert.equal(entities.length, 1);
    assert.ok(entities[0].aliasesJson.includes('ME7.4.4'));
    assert.ok(entities[0].aliasesJson.includes('۲۰۶ تیپ ۵'));

    const u1 = await createMasterKnowledgeUnit({
      volumeId: vol1.id,
      chapterId: ch1.id,
      cleanText: 'در موتورهای GDI فشار سوخت ریل بین ۵۰ تا ۲۰۰ بار متغیر است.',
      normalizedHash: 'hash_gdi_01',
      domainTag: 'engine_mechanics',
      distinctSourceHashesJson: ['src_hash_1'],
      ingestBatchId: 'batch_01',
      sourceUploadHash: 'src_hash_1',
    });
    const u2 = await createMasterKnowledgeUnit({
      volumeId: vol1.id,
      chapterId: ch2.id,
      cleanText: 'مقدار استوکیومتریک بنزین معادل AFR 14.7:1 و Lambda 1.00 است.',
      normalizedHash: 'hash_afr_01',
      domainTag: 'engine_mechanics',
      distinctSourceHashesJson: ['src_hash_1'],
      ingestBatchId: 'batch_01',
      sourceUploadHash: 'src_hash_1',
    });

    await recalculateVolumeAndChapterStats();
    let volumes = await listMasterVolumes();
    assert.ok(volumes[0].wordCount > 10);
    assert.equal(volumes[1].wordCount, 0);

    // Move ch2 to vol2
    const moved = await moveMasterChapterToVolume(ch2.id, vol2.id);
    assert.equal(moved?.volumeId, vol2.id);
    const updatedU2 = await getMasterKnowledgeUnitById(u2.id);
    assert.equal(updatedU2?.volumeId, vol2.id);

    // Merge ch2 back into ch1
    const merged = await mergeMasterChapters(ch2.id, ch1.id);
    assert.equal(merged.mergedUnits, 1);
    const remainingChapters = await listMasterChapters();
    assert.equal(remainingChapters.length, 1);
    assert.equal(remainingChapters[0].id, ch1.id);

    const movedBackU2 = await getMasterKnowledgeUnitById(u2.id);
    assert.equal(movedBackU2?.chapterId, ch1.id);
    assert.equal(movedBackU2?.volumeId, vol1.id);

    // Verify reset clears all master tables cleanly
    await resetMasterEncyclopedia();
    volumes = await listMasterVolumes();
    assert.equal(volumes.length, 0);
    assert.equal((await listMasterKnowledgeUnits()).length, 0);
    assert.ok(u1.id.startsWith('ku_'));
  });

  it('supports atomic batch rollback and full source_upload_hash takedown', async () => {
    const vol = await createMasterVolume({
      volumeNumber: 1,
      title: 'جلد ۱: برق و عیب‌یابی',
      automotiveDomain: 'diagnostics_obd',
    });
    const ch = await createMasterChapter({
      volumeId: vol.id,
      title: 'کدهای خطا DTC',
    });

    // Batch 1 creates unit A
    const unitA = await createMasterKnowledgeUnit({
      volumeId: vol.id,
      chapterId: ch.id,
      cleanText: 'کد خطای P0420 نشان‌دهنده افت راندمان کاتالیست بانک ۱ است.',
      normalizedHash: 'h_p0420',
      domainTag: 'diagnostics_obd',
      distinctSourceHashesJson: ['upload_hash_A'],
      ingestBatchId: 'batch_A',
      sourceUploadHash: 'upload_hash_A',
    });
    await createMasterUnitRevision({
      ingestBatchId: 'batch_A',
      unitId: unitA.id,
      action: 'created',
      previousStateJson: null,
      newStateJson: unitA as unknown as Record<string, unknown>,
    });

    // Batch 2 updates unit A and creates unit B + conflict
    const prevSnapshot = structuredClone(unitA) as unknown as Record<string, unknown>;
    await createMasterUnitRevision({
      ingestBatchId: 'batch_B',
      unitId: unitA.id,
      action: 'merged',
      previousStateJson: prevSnapshot,
      newStateJson: { ...prevSnapshot, cleanText: 'متن ادغام‌شده موقت' },
    });
    const unitB = await createMasterKnowledgeUnit({
      volumeId: vol.id,
      chapterId: ch.id,
      cleanText: 'کد خطای P0300 به معنای میس‌فایر تصادفی چندسیلندر است.',
      normalizedHash: 'h_p0300',
      domainTag: 'diagnostics_obd',
      distinctSourceHashesJson: ['upload_hash_B'],
      ingestBatchId: 'batch_B',
      sourceUploadHash: 'upload_hash_B',
    });
    await createMasterUnitRevision({
      ingestBatchId: 'batch_B',
      unitId: unitB.id,
      action: 'created',
      previousStateJson: null,
      newStateJson: unitB as unknown as Record<string, unknown>,
    });
    await createMasterConflict({
      existingUnitId: unitA.id,
      conflictType: 'explicit_numeric',
      topic: 'آستانه ولتاژ سنسور اکسیژن دوم',
      existingExcerpt: '۰.۴۵ ولت',
      incomingExcerpt: '۰.۸۰ ولت',
      ingestBatchId: 'batch_B',
      sourceUploadHash: 'upload_hash_B',
    });

    // Rollback batch_B: unitB deleted, unitA restored, conflict removed
    const rollbackRes = await rollbackIngestBatch('batch_B');
    assert.equal(rollbackRes.deletedUnits, 1);
    assert.equal(rollbackRes.revertedUnits, 1);
    assert.equal(rollbackRes.removedConflicts, 1);
    assert.equal(await getMasterKnowledgeUnitById(unitB.id), null);
    assert.equal((await listMasterConflicts()).length, 0);

    // Takedown by sourceUploadHash for upload_hash_A removes unitA completely
    const takedownRes = await takedownBySourceUploadHash('upload_hash_A');
    assert.equal(takedownRes.deletedUnits, 1);
    assert.equal(await getMasterKnowledgeUnitById(unitA.id), null);
  });

  it('resolves conflicts with merged_conditional preserving both versions and conditionContext', async () => {
    const vol = await createMasterVolume({
      volumeNumber: 1,
      title: 'جلد تست تعارض',
      automotiveDomain: 'remap_tuning',
    });
    const ch = await createMasterChapter({ volumeId: vol.id, title: 'جرقه و ناک' });
    const unit = await createMasterKnowledgeUnit({
      volumeId: vol.id,
      chapterId: ch.id,
      cleanText: 'آوانس مجاز در بار کامل برای بنزین اکتان ۹۵ برابر ۱۸ درجه است.',
      normalizedHash: 'h_ign',
      domainTag: 'remap_tuning',
      distinctSourceHashesJson: ['h1'],
      ingestBatchId: 'b1',
      sourceUploadHash: 'h1',
    });

    const conflict = await createMasterConflict({
      existingUnitId: unit.id,
      conflictType: 'implicit_conditional',
      topic: 'آوانس جرقه در بار کامل',
      existingExcerpt: '۱۸ درجه با بنزین اکتان ۹۵',
      incomingExcerpt: '۲۱ درجه با بنزین سوپر اکتان ۹۸',
      conditionContext: 'تفاوت عدد اکتان سوخت (۹۵ در برابر ۹۸)',
      ingestBatchId: 'b2',
      sourceUploadHash: 'h2',
    });

    const resolved = await resolveMasterConflict(
      conflict.id,
      'merged_conditional',
      'حفظ هر دو نسخه بر اساس اکتان سوخت',
      'بنزین اکتان ۹۸'
    );
    assert.equal(resolved?.status, 'merged_conditional');
    const updatedUnit = await getMasterKnowledgeUnitById(unit.id);
    assert.ok(updatedUnit?.cleanText.includes('۱۸ درجه'));
    assert.ok(updatedUnit?.cleanText.includes('۲۱ درجه'));
    assert.ok(updatedUnit?.cleanText.includes('بنزین اکتان ۹۸'));
  });

  it('executes persistent queue lifecycle with retry and DLQ transition', async () => {
    const okJob = await enqueueMasterIngestJob({
      sourceUploadHash: 'sha256_ok',
      sourceFileName: 'can_bus_guide.md',
      sourceFormat: 'md',
      submittedByRole: 'user',
      submitterSessionHash: 'sess_1',
    });
    assert.equal(okJob.status, 'queued');

    const resOk = await processNextMasterIngestJob(async () => ({
      newUnitsCount: 3,
      duplicateUnitsCount: 1,
      mergedUnitsCount: 0,
      conflictsCount: 0,
      stagingUnitsCount: 0,
      createdVolumes: ['vol_1'],
      createdChapters: ['ch_1'],
      modelsUsed: ['layer0-deterministic'],
      summaryFa: '۳ واحد دانش جدید افزوده شد.',
    }));
    assert.equal(resOk.processed, true);
    assert.equal(resOk.status, 'completed');
    const logs = await listMasterIngestLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].newUnitsCount, 3);

    // Failing job retries up to maxAttempts=2 then enters DLQ
    const failJob = await enqueueMasterIngestJob({
      sourceUploadHash: 'sha256_fail',
      sourceFileName: 'broken_ecu.bin',
      sourceFormat: 'bin',
      submittedByRole: 'guest',
      submitterSessionHash: 'sess_2',
      maxAttempts: 2,
    });

    const attempt1 = await processNextMasterIngestJob(async () => {
      throw new Error('Transient AI timeout');
    });
    assert.equal(attempt1.status, 'queued'); // requeued for retry
    assert.equal((await getMasterIngestJobById(failJob.id))?.attempts, 1);

    const attempt2 = await processNextMasterIngestJob(async () => {
      throw new Error('Persistent failure');
    });
    assert.equal(attempt2.status, 'dlq'); // moved to DLQ after maxAttempts
    assert.equal((await getMasterIngestJobById(failJob.id))?.status, 'dlq');
    assert.equal((await listMasterIngestLogs()).length, 2);
  });

  it('enforces feature flag isolation and graceful degradation without crashing normal flows', async () => {
    assert.equal(isMasterEncyclopediaEnabled({}), true);
    assert.equal(isMasterEncyclopediaEnabled({ ENABLE_MASTER_ENCYCLOPEDIA: 'true' }), true);
    assert.equal(isMasterEncyclopediaEnabled({ ENABLE_MASTER_ENCYCLOPEDIA: 'false' }), false);
    assert.equal(isMasterEncyclopediaEnabled({ ENABLE_MASTER_ENCYCLOPEDIA: '0' }), false);

    // Skipped cleanly when disabled
    const skipped = await runEncyclopediaIsolated(
      'disabled-op',
      async () => 'should-not-run',
      'fallback',
      { ENABLE_MASTER_ENCYCLOPEDIA: 'false' }
    );
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.value, 'fallback');

    // Degrades gracefully on runtime exception
    const degraded = await runEncyclopediaIsolated(
      'failing-db-op',
      async () => {
        throw new Error('Simulated PostgreSQL outage');
      },
      'safe-default',
      { ENABLE_MASTER_ENCYCLOPEDIA: 'true' }
    );
    assert.equal(degraded.ok, false);
    assert.equal(degraded.value, 'safe-default');
    assert.ok(degraded.errorMessage?.includes('Simulated PostgreSQL outage'));

    // Worker drain skips when flag disabled
    await enqueueMasterIngestJob({
      sourceUploadHash: 'h_skip',
      sourceFileName: 'obd.md',
      sourceFormat: 'md',
      submittedByRole: 'user',
      submitterSessionHash: 's1',
    });
    const drainedWhenDisabled = await drainMasterIngestQueue(5, undefined, {
      ENABLE_MASTER_ENCYCLOPEDIA: 'false',
    });
    assert.equal(drainedWhenDisabled, 0);
  });

  it('enforces strict server-side Admin RBAC (401 unauth, 403 guest & non-admin, 200 owner)', () => {
    const allowedSet = resolveAdminEmailSet('hossein.roosta.90@gmail.com, owner2@example.com');
    assert.equal(allowedSet.has('hossein.roosta.90@gmail.com'), true);
    assert.equal(allowedSet.has('owner2@example.com'), true);

    // Guest is ALWAYS denied even if email matches
    assert.equal(
      isAdminUser(
        { uid: 'guest_1', email: 'hossein.roosta.90@gmail.com', isGuest: true },
        'hossein.roosta.90@gmail.com'
      ),
      false
    );
    // Regular user denied
    assert.equal(
      isAdminUser(
        { uid: 'u_1', email: 'user@example.com', isGuest: false },
        'hossein.roosta.90@gmail.com'
      ),
      false
    );
    // Owner approved
    assert.equal(
      isAdminUser(
        { uid: 'owner_1', email: 'HOSSEIN.ROOSTA.90@GMAIL.COM', isGuest: false },
        'hossein.roosta.90@gmail.com'
      ),
      true
    );

    const runMiddleware = (user?: AuthRequest['user']) => {
      let statusCode = 200;
      let body: unknown = null;
      let calledNext = false;
      const req = { user } as AuthRequest;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          body = payload;
          return this;
        },
      } as unknown as Response;
      const next: NextFunction = () => {
        calledNext = true;
      };
      requireAdmin(req, res, next);
      return { statusCode, body, calledNext };
    };

    assert.equal(runMiddleware(undefined).statusCode, 401);
    assert.equal(runMiddleware({ uid: 'g1', email: 'guest@local', isGuest: true }).statusCode, 403);
    assert.equal(runMiddleware({ uid: 'u1', email: 'normal@user.com', isGuest: false }).statusCode, 403);
    const ownerRes = runMiddleware({
      uid: 'own1',
      email: 'hossein.roosta.90@gmail.com',
      isGuest: false,
    });
    assert.equal(ownerRes.calledNext, true);
    assert.equal(ownerRes.statusCode, 200);
  });

  it('verifies real PostgreSQL Cloud SQL round-trip parity when configured (and leaves DB clean)', async () => {
    if (!isSqlConfigured()) return;
    setForceInMemoryMasterEncyclopedia(false);
    const probe = await createMasterVolume({
      volumeNumber: 999,
      title: '__smoke_probe_volume__',
      automotiveDomain: 'diagnostics_obd',
      status: 'draft_proposal',
    });
    try {
      const vols = await listMasterVolumes();
      assert.ok(vols.some((v) => v.id === probe.id));
    } finally {
      await deleteMasterVolume(probe.id);
      setForceInMemoryMasterEncyclopedia(true);
    }
  });
});
