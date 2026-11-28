import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { isAdminUser, requireAdmin } from '../middleware/adminAuth.ts';
import {
  enqueueMasterIngestJob,
  getMasterKnowledgeUnitById,
  listMasterCanonicalEntities,
  listMasterChapters,
  listMasterConflicts,
  listMasterIngestJobs,
  listMasterIngestLogs,
  listMasterKnowledgeUnits,
  listMasterVolumes,
  mergeMasterChapters,
  moveMasterChapterToVolume,
  recalculateVolumeAndChapterStats,
  resetMasterEncyclopedia,
  resolveMasterConflict,
  rollbackIngestBatch,
  takedownBySourceUploadHash,
  updateMasterChapter,
  updateMasterKnowledgeUnit,
  updateMasterVolume,
  createMasterIngestLog,
} from '../db/masterEncyclopediaRepository.ts';
import {
  isMasterEncyclopediaEnabled,
  runEncyclopediaIsolated,
} from '../lib/masterEncyclopedia/featureFlag.ts';
import { getPlatformSettings } from '../db/collaborationRepository.ts';
import {
  AUTOMOTIVE_REJECTION_MESSAGE_FA,
  ECU_BINARY_AND_CALIBRATION_FORMATS,
  checkGuestUploadRateLimit,
  computeSha256Hex,
  evaluateAutomotiveGatekeeper,
  extractFileExtension,
  verifyFileMagicBytes,
} from '../lib/masterEncyclopedia/automotiveGatekeeper.ts';
import {
  analyzeEcuFileInMemory,
  formatEcuProfileAsMarkdown,
} from '../lib/masterEncyclopedia/ecuBinaryAnalyzer.ts';
import { stripImageExifBytes } from '../lib/masterEncyclopedia/multimodalExtractors.ts';
import { AUTOMOTIVE_DOMAIN_TAXONOMY } from '../lib/masterEncyclopedia/automotiveDomainEngine.ts';
import {
  ingestDocumentIntoMasterEncyclopedia,
  runMasterKnowledgeLinter,
} from '../lib/masterEncyclopedia/deltaMergeEngine.ts';
import {
  compileEncyclopediaToDocxBuffer,
  compileEncyclopediaToMarkdown,
  extractCalibrationMapsFromUnits,
  generateCalibrationSpecJson,
  generateGoogleSheetsCalibrationCsv,
  generateValidatedAsap2A2l,
  generateValidatedTunerProXdf,
} from '../lib/masterEncyclopedia/masterExporters.ts';
import {
  setMasterIngestJobProcessor,
  triggerMasterIngestWorkerDrain,
} from './masterIngestWorker.ts';

/**
 * Configures the background worker to execute the real Delta-Merge Engine on queued jobs.
 */
export function registerMasterEncyclopediaWorkerProcessor(): void {
  setMasterIngestJobProcessor(async (job) => {
    const payload = (job.payloadJson ?? {}) as {
      rawText?: string;
      evidenceTier?: 'a2l_xdf_verified' | 'text_or_screenshot_reported' | 'pattern_candidate';
      actorEmail?: string | null;
    };

    const rawText = typeof payload.rawText === 'string' ? payload.rawText : '';
    if (!rawText.trim()) {
      return {
        newUnitsCount: 0,
        duplicateUnitsCount: 0,
        mergedUnitsCount: 0,
        conflictsCount: 0,
        stagingUnitsCount: 0,
        createdVolumes: [],
        createdChapters: [],
        modelsUsed: ['layer0-deterministic'],
        summaryFa: `فایل ${job.sourceFileName} فاقد متن قابل استخراج بود.`,
      };
    }

    const res = await ingestDocumentIntoMasterEncyclopedia({
      ingestBatchId: job.ingestBatchId,
      sourceUploadHash: job.sourceUploadHash,
      sourceFileName: job.sourceFileName,
      rawText,
      submittedByRole:
        job.submittedByRole === 'owner' || job.submittedByRole === 'guest'
          ? job.submittedByRole
          : 'user',
      submitterSessionHash: job.submitterSessionHash,
      evidenceTier: payload.evidenceTier ?? 'text_or_screenshot_reported',
      actorEmail: payload.actorEmail ?? null,
    });

    return {
      newUnitsCount: res.newUnitsCount,
      duplicateUnitsCount: res.duplicateUnitsCount,
      mergedUnitsCount: res.mergedUnitsCount,
      conflictsCount: res.conflictsCount,
      stagingUnitsCount: res.stagingUnitsCount,
      createdVolumes: res.createdVolumes,
      createdChapters: res.createdChapters,
      modelsUsed: res.modelsUsed,
      summaryFa: res.summaryFa,
    };
  });
}

/**
 * Isolated non-blocking helper invoked from regular user/guest project ingest & audio routes.
 * Protected by ENABLE_MASTER_ENCYCLOPEDIA + try/catch so it NEVER slows or breaks user workflows.
 */
export async function enqueueAutomotiveDocumentForEncyclopediaIsolated(params: {
  fileName: string;
  format: string;
  rawText: string;
  userUid: string;
  userEmail?: string;
  isGuest: boolean;
  evidenceTier?: 'a2l_xdf_verified' | 'text_or_screenshot_reported' | 'pattern_candidate';
}): Promise<void> {
  await runEncyclopediaIsolated(
    `enqueue:${params.fileName}`,
    async () => {
      if (!params.rawText || params.rawText.trim().length < 24) return null;

      const gate = await evaluateAutomotiveGatekeeper({
        fileName: params.fileName,
        extractedText: params.rawText,
        format: params.format,
      });
      if (gate.decision !== 'approved') return null;

      const role: 'owner' | 'user' | 'guest' = params.isGuest
        ? 'guest'
        : isAdminUser({ uid: params.userUid, email: params.userEmail, isGuest: false })
        ? 'owner'
        : 'user';

      const sourceUploadHash = computeSha256Hex(`${params.fileName}\n${params.rawText}`);
      const submitterSessionHash = computeSha256Hex(`sess:${params.userUid}`).slice(0, 24);

      await enqueueMasterIngestJob({
        sourceUploadHash,
        sourceFileName: params.fileName,
        sourceFormat: params.format,
        submittedByRole: role,
        submitterSessionHash,
        payloadJson: {
          rawText: params.rawText,
          evidenceTier: params.evidenceTier ?? 'text_or_screenshot_reported',
          actorEmail: role === 'owner' ? params.userEmail ?? null : null,
        },
      });
      triggerMasterIngestWorkerDrain();
      return true;
    },
    null
  );
}

// ============================================================================
// 1. AUTH CAPABILITIES ROUTER (ZERO 403 CONSOLE NOISE FOR REGULAR/GUEST USERS)
// ============================================================================

export function createAuthCapabilitiesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/capabilities', async (req: Request, res: Response) => {
    const user = (req as AuthRequest).user;
    const masterEncyclopediaEnabled = isMasterEncyclopediaEnabled();
    const isOwner = isAdminUser(user);
    const canManageEncyclopedia = masterEncyclopediaEnabled && isOwner;
    const settings = await getPlatformSettings().catch(() => null);
    res.json({
      masterEncyclopediaEnabled,
      canManageEncyclopedia,
      isOwner,
      enableUserPersonalOutput: settings ? settings.enableUserPersonalOutput : false,
    });
  });

  return router;
}

// ============================================================================
// 2. AUTOMOTIVE GATEKEEPER & MULTIMODAL / ECU BINARY INGEST ROUTER
// ============================================================================

export function createAutomotiveGatekeeperRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/gatekeeper/check', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      if (user.isGuest) {
        const rate = checkGuestUploadRateLimit(`guest:${user.uid}`, 20, 10 * 60 * 1000);
        if (!rate.allowed) {
          res.status(429).json({
            error: `تعداد آپلودهای نشست مهمان به سقف موقت رسید. لطفاً پس از ${rate.retryAfterSeconds} ثانیه دوباره تلاش کنید.`,
          });
          return;
        }
      }

      const body = req.body as {
        fileName?: string;
        text?: string;
        base64Data?: string;
      };

      const fileName = String(body.fileName || '').trim();
      if (!fileName) {
        res.status(400).json({ error: 'نام فایل الزامی است.' });
        return;
      }

      const ext = extractFileExtension(fileName);
      let extractedText = typeof body.text === 'string' ? body.text : '';
      let ecuProfile = null;
      let exifStrippedCount = 0;

      if (typeof body.base64Data === 'string' && body.base64Data.trim().length > 0) {
        const cleanB64 = body.base64Data.trim().replace(/^data:[^;]+;base64,/i, '');
        const MAX_GATEKEEPER_BASE64_CHARS = 28 * 1024 * 1024;
        if (cleanB64.length > MAX_GATEKEEPER_BASE64_CHARS) {
          res.status(413).json({
            approved: false,
            error: 'حجم فایل ارسال‌شده بیش از سقف مجاز سامانه است.',
          });
          return;
        }
        if (!/^[A-Za-z0-9+/=\s]+$/.test(cleanB64)) {
          res.status(400).json({
            approved: false,
            error: 'قالب داده Base64 فایل ارسالی نامعتبر است.',
          });
          return;
        }
        const rawBuf = Buffer.from(cleanB64, 'base64');
        const bytes = new Uint8Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);

        const magicCheck = verifyFileMagicBytes(fileName, bytes);
        if (!magicCheck.ok) {
          bytes.fill(0);
          res.status(400).json({
            approved: false,
            error: magicCheck.reasonFa || 'فرمت یا امضای فایل معتبر نیست.',
          });
          return;
        }

        if (ECU_BINARY_AND_CALIBRATION_FORMATS.has(ext)) {
          // Safe in-memory ECU binary analysis with mandatory immediate buffer zeroing
          ecuProfile = analyzeEcuFileInMemory({
            fileName,
            rawBytes: bytes,
            zeroBufferAfterAnalysis: true,
          });
          extractedText = formatEcuProfileAsMarkdown(ecuProfile);
        } else if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') {
          const stripped = stripImageExifBytes(bytes, ext);
          exifStrippedCount = stripped.strippedMetadataSegments;
          bytes.fill(0);
        } else if (!extractedText) {
          extractedText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        }
      }

      const gate = await evaluateAutomotiveGatekeeper({
        fileName,
        extractedText,
        format: ext,
      });

      if (gate.decision !== 'approved') {
        res.status(400).json({
          approved: false,
          decision: gate.decision,
          error: gate.reasonFa || AUTOMOTIVE_REJECTION_MESSAGE_FA,
        });
        return;
      }

      // Enqueue asynchronously into Master Encyclopedia behind isolated boundary
      await enqueueAutomotiveDocumentForEncyclopediaIsolated({
        fileName,
        format: ext || 'md',
        rawText: extractedText,
        userUid: user.uid,
        userEmail: user.email,
        isGuest: Boolean(user.isGuest),
        evidenceTier:
          ext === 'a2l' || ext === 'xdf' || ext === 'csv'
            ? 'a2l_xdf_verified'
            : 'text_or_screenshot_reported',
      });

      res.json({
        approved: true,
        decision: gate.decision,
        layer: gate.layer,
        matchedDomains: gate.matchedDomains,
        exifStrippedCount,
        ecuProfile,
        extractedMarkdown: ecuProfile ? extractedText : undefined,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در بررسی تخصصی فایل خودرو.',
      });
    }
  });

  return router;
}

// ============================================================================
// 3. OWNER-ONLY MASTER ENCYCLOPEDIA ADMIN ROUTER (STRICT HTTP 403 FOR NON-OWNERS)
// ============================================================================

export function createMasterEncyclopediaAdminRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireAdmin);

  // Guard when feature flag is explicitly disabled
  router.use((_req, res, next) => {
    if (!isMasterEncyclopediaEnabled()) {
      res.status(503).json({
        error: 'زیرسیستم دایرةالمعارف مرجع از طریق متغیر محیطی ENABLE_MASTER_ENCYCLOPEDIA غیرفعال شده است.',
      });
      return;
    }
    next();
  });

  // GET /api/admin/encyclopedia/overview
  router.get('/overview', async (_req, res) => {
    try {
      const [volumes, chapters, units, entities, conflicts, jobs, logs] = await Promise.all([
        listMasterVolumes(),
        listMasterChapters(),
        listMasterKnowledgeUnits(),
        listMasterCanonicalEntities(),
        listMasterConflicts(),
        listMasterIngestJobs(50),
        listMasterIngestLogs(50),
      ]);

      const activeVerifiedUnits = units.filter(
        (u) => u.lifecycleStatus === 'active' && u.verificationStatus === 'verified'
      );
      const stagingUnits = units.filter(
        (u) => u.lifecycleStatus === 'active' && u.verificationStatus === 'staging'
      );
      const openConflicts = conflicts.filter((c) => c.status === 'open');
      const draftVolumeProposals = volumes.filter((v) => v.status === 'draft_proposal');

      const domainCounts = new Map<string, number>();
      for (const u of activeVerifiedUnits) {
        domainCounts.set(u.domainTag, (domainCounts.get(u.domainTag) ?? 0) + 1);
      }

      const domainBreakdown = AUTOMOTIVE_DOMAIN_TAXONOMY.map((d) => ({
        domainId: d.id,
        shortLabelFa: d.shortLabelFa,
        unitCount: domainCounts.get(d.id) ?? 0,
      }));

      const totalWords = activeVerifiedUnits.reduce((sum, u) => sum + u.wordCount, 0);
      const totalEstimatedPages = totalWords > 0 ? Math.max(1, Math.ceil(totalWords / 300)) : 0;

      res.json({
        summary: {
          volumesCount: volumes.length,
          publishedVolumesCount: volumes.filter((v) => v.status === 'published').length,
          draftProposalsCount: draftVolumeProposals.length,
          chaptersCount: chapters.length,
          verifiedUnitsCount: activeVerifiedUnits.length,
          stagingUnitsCount: stagingUnits.length,
          openConflictsCount: openConflicts.length,
          canonicalEntitiesCount: entities.length,
          totalWords,
          totalEstimatedPages,
          queuedJobsCount: jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length,
          dlqJobsCount: jobs.filter((j) => j.status === 'dlq').length,
        },
        domainBreakdown,
        volumes: volumes.map((vol) => ({
          ...vol,
          chapters: chapters
            .filter((c) => c.volumeId === vol.id)
            .map((ch) => ({
              ...ch,
              unitCount: activeVerifiedUnits.filter((u) => u.chapterId === ch.id).length,
            })),
        })),
        recentLogsCount: logs.length,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در دریافت نمای کلی دایرةالمعارف مرجع.',
      });
    }
  });

  // GET /api/admin/encyclopedia/jobs-and-logs
  router.get('/jobs-and-logs', async (_req, res) => {
    try {
      const [jobs, logs] = await Promise.all([
        listMasterIngestJobs(100),
        listMasterIngestLogs(100),
      ]);
      res.json({ jobs, logs });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در دریافت صف و لاگ‌های پردازش.',
      });
    }
  });

  // POST /api/admin/encyclopedia/rollback-batch
  router.post('/rollback-batch', async (req, res) => {
    try {
      const ingestBatchId = String((req.body as { ingestBatchId?: string }).ingestBatchId || '').trim();
      if (!ingestBatchId) {
        res.status(400).json({ error: 'شناسه ingestBatchId الزامی است.' });
        return;
      }
      const result = await rollbackIngestBatch(ingestBatchId);
      res.json({ ok: true, ingestBatchId, ...result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در بازگشت دسته (Rollback Batch).',
      });
    }
  });

  // POST /api/admin/encyclopedia/takedown
  router.post('/takedown', async (req, res) => {
    try {
      const sourceUploadHash = String(
        (req.body as { sourceUploadHash?: string }).sourceUploadHash || ''
      ).trim();
      if (!sourceUploadHash) {
        res.status(400).json({ error: 'شناسه sourceUploadHash الزامی است.' });
        return;
      }
      const result = await takedownBySourceUploadHash(sourceUploadHash);
      res.json({ ok: true, sourceUploadHash, ...result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در حذف حقوقی منبع (Source Takedown).',
      });
    }
  });

  // GET /api/admin/encyclopedia/staging
  router.get('/staging', async (_req, res) => {
    try {
      const [stagingUnits, volumes] = await Promise.all([
        listMasterKnowledgeUnits({ verificationStatus: 'staging', lifecycleStatus: 'active' }),
        listMasterVolumes(),
      ]);
      const draftProposals = volumes.filter((v) => v.status === 'draft_proposal');
      res.json({ stagingUnits, draftProposals });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در دریافت صف بازبینی (Staging).',
      });
    }
  });

  // POST /api/admin/encyclopedia/staging/units/:unitId
  router.post('/staging/units/:unitId', async (req, res) => {
    try {
      const unitId = req.params.unitId;
      const action = String((req.body as { action?: string }).action || '');
      const existing = await getMasterKnowledgeUnitById(unitId);
      if (!existing) {
        res.status(404).json({ error: 'واحد دانش یافت نشد.' });
        return;
      }
      if (action === 'approve') {
        const updated = await updateMasterKnowledgeUnit(unitId, {
          verificationStatus: 'verified',
          lifecycleStatus: 'active',
        });
        await recalculateVolumeAndChapterStats();
        res.json({ ok: true, unit: updated });
        return;
      }
      if (action === 'reject') {
        const updated = await updateMasterKnowledgeUnit(unitId, {
          verificationStatus: 'rejected',
        });
        await recalculateVolumeAndChapterStats();
        res.json({ ok: true, unit: updated });
        return;
      }
      if (action === 'deprecate') {
        const updated = await updateMasterKnowledgeUnit(unitId, {
          lifecycleStatus: 'deprecated',
        });
        await recalculateVolumeAndChapterStats();
        res.json({ ok: true, unit: updated });
        return;
      }
      res.status(400).json({ error: 'عملیات نامعتبر است (approve | reject | deprecate).' });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در به‌روزرسانی وضعیت واحد دانش.',
      });
    }
  });

  // POST /api/admin/encyclopedia/volumes/:volumeId/approve
  router.post('/volumes/:volumeId/approve', async (req, res) => {
    try {
      const updated = await updateMasterVolume(req.params.volumeId, { status: 'published' });
      if (!updated) {
        res.status(404).json({ error: 'جلد مورد نظر یافت نشد.' });
        return;
      }
      res.json({ ok: true, volume: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در تأیید جلد پیشنهادی.',
      });
    }
  });

  // PATCH /api/admin/encyclopedia/volumes/:volumeId
  router.patch('/volumes/:volumeId', async (req, res) => {
    try {
      const body = req.body as {
        title?: string;
        splitThresholdPages?: number;
        splitThresholdWords?: number;
      };
      const patch: Parameters<typeof updateMasterVolume>[1] = {};
      if (typeof body.title === 'string' && body.title.trim()) {
        patch.title = body.title.trim();
      }
      if (
        typeof body.splitThresholdPages === 'number' &&
        Number.isFinite(body.splitThresholdPages) &&
        body.splitThresholdPages >= 10
      ) {
        patch.splitThresholdPages = Math.round(body.splitThresholdPages);
      }
      if (
        typeof body.splitThresholdWords === 'number' &&
        Number.isFinite(body.splitThresholdWords) &&
        body.splitThresholdWords >= 1000
      ) {
        patch.splitThresholdWords = Math.round(body.splitThresholdWords);
      }

      const updated = await updateMasterVolume(req.params.volumeId, patch);
      if (!updated) {
        res.status(404).json({ error: 'جلد یافت نشد.' });
        return;
      }
      res.json({ ok: true, volume: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ویرایش تنظیمات جلد.',
      });
    }
  });

  // PATCH /api/admin/encyclopedia/chapters/:chapterId
  router.patch('/chapters/:chapterId', async (req, res) => {
    try {
      const body = req.body as { title?: string; pedagogicalRank?: number };
      const patch: Parameters<typeof updateMasterChapter>[1] = {};
      if (typeof body.title === 'string' && body.title.trim()) {
        patch.title = body.title.trim();
      }
      if (
        typeof body.pedagogicalRank === 'number' &&
        body.pedagogicalRank >= 1 &&
        body.pedagogicalRank <= 5
      ) {
        patch.pedagogicalRank = Math.round(body.pedagogicalRank);
      }
      const updated = await updateMasterChapter(req.params.chapterId, patch);
      if (!updated) {
        res.status(404).json({ error: 'فصل یافت نشد.' });
        return;
      }
      res.json({ ok: true, chapter: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ویرایش فصل.',
      });
    }
  });

  // POST /api/admin/encyclopedia/chapters/move
  router.post('/chapters/move', async (req, res) => {
    try {
      const { chapterId, targetVolumeId } = req.body as {
        chapterId?: string;
        targetVolumeId?: string;
      };
      if (!chapterId || !targetVolumeId) {
        res.status(400).json({ error: 'شناسه فصل و جلد مقصد الزامی است.' });
        return;
      }
      const moved = await moveMasterChapterToVolume(chapterId, targetVolumeId);
      if (!moved) {
        res.status(404).json({ error: 'فصل یا جلد مقصد یافت نشد.' });
        return;
      }
      res.json({ ok: true, chapter: moved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در انتقال فصل بین مجلدات.',
      });
    }
  });

  // POST /api/admin/encyclopedia/chapters/merge
  router.post('/chapters/merge', async (req, res) => {
    try {
      const { sourceChapterId, targetChapterId } = req.body as {
        sourceChapterId?: string;
        targetChapterId?: string;
      };
      if (!sourceChapterId || !targetChapterId) {
        res.status(400).json({ error: 'شناسه فصل مبدأ و فصل مقصد الزامی است.' });
        return;
      }
      const result = await mergeMasterChapters(sourceChapterId, targetChapterId);
      if (!result.targetChapter) {
        res.status(404).json({ error: 'یکی از فصل‌های انتخاب‌شده یافت نشد.' });
        return;
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ادغام دو فصل.',
      });
    }
  });

  // GET /api/admin/encyclopedia/conflicts
  router.get('/conflicts', async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const conflicts = await listMasterConflicts(status);
      res.json({ conflicts });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در دریافت تعارض‌های فنی.',
      });
    }
  });

  // POST /api/admin/encyclopedia/conflicts/:conflictId/resolve
  router.post('/conflicts/:conflictId/resolve', async (req, res) => {
    try {
      const body = req.body as {
        resolution?: 'approved_existing' | 'approved_incoming' | 'merged_conditional' | 'rejected';
        resolutionNote?: string;
        conditionContext?: string;
      };
      const allowed = new Set([
        'approved_existing',
        'approved_incoming',
        'merged_conditional',
        'rejected',
      ]);
      if (!body.resolution || !allowed.has(body.resolution)) {
        res.status(400).json({ error: 'نوع حل تعارض نامعتبر است.' });
        return;
      }
      const resolved = await resolveMasterConflict(
        req.params.conflictId,
        body.resolution,
        body.resolutionNote,
        body.conditionContext
      );
      if (!resolved) {
        res.status(404).json({ error: 'تعارض مورد نظر یافت نشد.' });
        return;
      }
      res.json({ ok: true, conflict: resolved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ثبت تصمیم تعارض فنی.',
      });
    }
  });

  // POST /api/admin/encyclopedia/linter/run
  router.post('/linter/run', async (_req, res) => {
    try {
      const report = await runMasterKnowledgeLinter();
      res.json(report);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در اجرای Knowledge Linter.',
      });
    }
  });

  // POST /api/admin/encyclopedia/import-markdown (Owner initial .md import)
  router.post('/import-markdown', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const body = req.body as { fileName?: string; markdownText?: string };
      const fileName = String(body.fileName || 'owner-initial-import.md').trim();
      const markdownText = String(body.markdownText || '').trim();
      if (!markdownText) {
        res.status(400).json({ error: 'متن Markdown برای ایمپورت اولیه خالی است.' });
        return;
      }

      const gate = await evaluateAutomotiveGatekeeper({
        fileName,
        extractedText: markdownText,
        format: 'md',
      });
      if (gate.decision !== 'approved') {
        res.status(400).json({ error: gate.reasonFa || AUTOMOTIVE_REJECTION_MESSAGE_FA });
        return;
      }

      const ingestBatchId = `batch_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
      const sourceUploadHash = computeSha256Hex(`${fileName}\n${markdownText}`);
      const startedAt = Date.now();

      const report = await ingestDocumentIntoMasterEncyclopedia({
        ingestBatchId,
        sourceUploadHash,
        sourceFileName: fileName,
        rawText: markdownText,
        submittedByRole: 'owner',
        submitterSessionHash: computeSha256Hex(`owner:${user.uid}`).slice(0, 24),
        evidenceTier: 'text_or_screenshot_reported',
        actorEmail: user.email ?? null,
      });

      await createMasterIngestLog({
        jobId: `direct_${ingestBatchId}`,
        ingestBatchId,
        sourceUploadHash,
        sourceFileName: fileName,
        newUnitsCount: report.newUnitsCount,
        duplicateUnitsCount: report.duplicateUnitsCount,
        mergedUnitsCount: report.mergedUnitsCount,
        conflictsCount: report.conflictsCount,
        stagingUnitsCount: report.stagingUnitsCount,
        createdVolumesJson: report.createdVolumes,
        createdChaptersJson: report.createdChapters,
        modelsUsedJson: report.modelsUsed,
        durationMs: Math.max(1, Date.now() - startedAt),
        status: 'completed',
        summaryFa: report.summaryFa,
      });

      res.json({ ok: true, ingestBatchId, sourceUploadHash, ...report });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ایمپورت Markdown اولیه.',
      });
    }
  });

  // POST /api/admin/encyclopedia/reset (Clean reset back to empty)
  router.post('/reset', async (req, res) => {
    try {
      const confirmReset = String((req.body as { confirmReset?: string }).confirmReset || '');
      if (confirmReset !== 'RESET_MASTER_ENCYCLOPEDIA') {
        res.status(400).json({ error: 'عبارت تأیید ریست کامل معتبر نیست.' });
        return;
      }
      await resetMasterEncyclopedia();
      res.json({ ok: true, messageFa: 'دایرةالمعارف مرجع به‌طور کامل ریست و خالی شد.' });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ریست دایرةالمعارف مرجع.',
      });
    }
  });

  // GET /api/admin/encyclopedia/export/:format (md | docx | csv | a2l | xdf | json)
  router.get('/export/:format', async (req, res) => {
    try {
      const format = String(req.params.format || '').toLowerCase();
      const volumeId = typeof req.query.volumeId === 'string' && req.query.volumeId.trim()
        ? req.query.volumeId.trim()
        : undefined;

      const [volumes, chapters, units] = await Promise.all([
        listMasterVolumes(),
        listMasterChapters(),
        listMasterKnowledgeUnits(),
      ]);

      const scopedUnits = volumeId ? units.filter((u) => u.volumeId === volumeId) : units;
      const maps = extractCalibrationMapsFromUnits(scopedUnits);

      if (format === 'md') {
        const md = compileEncyclopediaToMarkdown({ volumes, chapters, units, volumeId });
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="master-automotive-encyclopedia.md"');
        res.send(md);
        return;
      }

      if (format === 'docx') {
        const buf = await compileEncyclopediaToDocxBuffer({ volumes, chapters, units, volumeId });
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        res.setHeader('Content-Disposition', 'attachment; filename="master-automotive-encyclopedia.docx"');
        res.send(Buffer.from(buf));
        return;
      }

      if (format === 'csv') {
        const csv = generateGoogleSheetsCalibrationCsv(maps);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="master-automotive-calibration.csv"');
        res.send(csv);
        return;
      }

      if (format === 'a2l') {
        const a2l = generateValidatedAsap2A2l(maps, 'Master_Automotive_Encyclopedia');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="master-automotive-winols.a2l"');
        res.setHeader('X-Exported-Maps', String(a2l.exportedCount));
        res.setHeader('X-Excluded-Incomplete-Maps', String(a2l.excludedMaps.length));
        res.send(a2l.a2lContent);
        return;
      }

      if (format === 'xdf') {
        const xdf = generateValidatedTunerProXdf(maps, 'Master Automotive Encyclopedia');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="master-automotive-tunerpro.xdf"');
        res.send(xdf.xdfXml);
        return;
      }

      if (format === 'json') {
        const json = generateCalibrationSpecJson(maps, {
          volumeCount: volumes.length,
          unitCount: scopedUnits.length,
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="master-calibration-spec.json"');
        res.send(json);
        return;
      }

      res.status(400).json({
        error: 'فرمت خروجی پشتیبانی نمی‌شود. فرمت‌های مجاز: md, docx, csv, a2l, xdf, json.',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در تولید خروجی دایرةالمعارف مرجع.',
      });
    }
  });

  return router;
}
