import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { isAdminUser, requireAdmin } from '../middleware/adminAuth.ts';
import {
  createChapterComment,
  createTeamContribution,
  createTeamUploadedAsset,
  createWishlistItem,
  deleteWishlistItem,
  ensureStarterReferenceVolumes,
  ensureStarterWishlist,
  findAcceptedContributionBySourceHash,
  getPlatformSettings,
  getTeamContributionById,
  getTeamUploadedAssetWithPdf,
  listChapterComments,
  listTeamContributions,
  listTeamUploadedAssets,
  listWishlistItems,
  markWishlistFulfilled,
  recordTokenLedgerDelta,
  resolveChapterComment,
  updatePlatformSettings,
  updateTeamContributionWorkspaceSync,
} from '../db/collaborationRepository.ts';
import {
  getMasterChapterById,
  listMasterChapters,
  listMasterKnowledgeUnits,
  listMasterVolumes,
  rollbackIngestBatch,
} from '../db/masterEncyclopediaRepository.ts';
import {
  AUTOMOTIVE_REJECTION_MESSAGE_FA,
  ECU_BINARY_AND_CALIBRATION_FORMATS,
  checkGuestUploadRateLimit,
  computeSha256Hex,
  evaluateAutomotiveGatekeeperLayer0,
  verifyFileMagicBytes,
} from '../lib/masterEncyclopedia/automotiveGatekeeper.ts';
import {
  analyzeEcuFileInMemory,
  formatEcuProfileAsMarkdown,
  type EcuTechnicalProfileJson,
} from '../lib/masterEncyclopedia/ecuBinaryAnalyzer.ts';
import {
  buildPostIngestProjectHealthReport,
  runSmartClusteringAndCrossReferenceRouting,
} from '../lib/masterEncyclopedia/smartClusteringAndHealthMonitor.ts';
import {
  alignPostAsrAutomotiveTerms,
  mergeMultiPageBrokenTables,
} from '../lib/masterEncyclopedia/multimodalExtractors.ts';
import { ingestDocumentIntoMasterEncyclopedia } from '../lib/masterEncyclopedia/deltaMergeEngine.ts';
import {
  classifyAutomotiveContent,
  getAutomotiveDomainDefinition,
} from '../lib/masterEncyclopedia/automotiveDomainEngine.ts';
import { preprocessIncomingSourceFile } from '../lib/filePreprocessEngine.ts';
import {
  buildCategorizedDriveFolderPath,
  buildContributionSheetRow,
  calculateContributionScore,
  canAccessResource,
  classifyContributionFileCategory,
  computeContributionNovelty,
  computeTeamLeaderboard,
  isValidGoogleResourceId,
  isWinolsPackageExtension,
  maskEmailForViewer,
  resolveStarterVolumeForDomain,
  sanitizeExternalWorkspaceUrl,
  validateWinolsMetadata,
} from '../lib/collaboration/contributionScoring.ts';
import {
  CONTRIBUTION_SHEET_HEADERS,
  type AccessLevel,
  type VolumeGoogleDocLink,
} from '../lib/collaboration/platformTypes.ts';
import {
  resolveAiProviderFromRequest,
  resolveAudioRouteFromRequest,
  transcribeAudioUnified,
} from './aiProvider.ts';

const MAX_INLINE_PDF_BYTES = 5 * 1024 * 1024; // 5 MB inline PDF viewer cap
const MAX_BASE64_PAYLOAD_CHARS = 28 * 1024 * 1024; // ~21 MB decoded payload cap
const BASE64_PATTERN = /^[A-Za-z0-9+/=\s]+$/;

const VALID_ACCESS_LEVELS = new Set<AccessLevel>(['open_all', 'email_only', 'owner_only']);
const VALID_WISHLIST_DOMAINS = new Set<string>([
  'remap_tuning',
  'ecu_hardware',
  'wiring_diagrams',
  'fault_diagnosis',
  'mechanical_systems',
  'multiplex_can_networks',
]);
const VALID_WISHLIST_FORMATS = new Set<string>([
  'any',
  'ols',
  'kp',
  'pdf',
  'docx',
  'audio',
  'bin',
  'a2l',
  'xdf',
  'csv',
  'txt',
]);

function resolveUploaderIdentity(user: NonNullable<AuthRequest['user']>) {
  const isGuest = Boolean(user.isGuest);
  const uploaderType = isGuest ? ('guest' as const) : ('email' as const);
  const uploaderEmail = isGuest
    ? `guest:${user.uid.slice(0, 12)}`
    : (user.email || user.uid).trim().toLowerCase();
  const uploaderDisplayName =
    (user.name || '').trim() ||
    (isGuest ? `کاربر مهمان (${user.uid.slice(0, 6)})` : uploaderEmail.split('@')[0]);
  const submittedByRole = isAdminUser(user)
    ? ('owner' as const)
    : isGuest
      ? ('guest' as const)
      : ('user' as const);
  return {
    uploaderUid: user.uid,
    uploaderType,
    uploaderEmail,
    uploaderDisplayName,
    submittedByRole,
  };
}

async function extractTextFromPdfBytesServer(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    if (typeof result?.text === 'string' && result.text.trim().length > 0) {
      return result.text.trim();
    }
    if (Array.isArray(result?.text)) {
      return (result.text as string[]).join('\n\n').trim();
    }
  } catch (err) {
    console.warn('[CollabRoutes] Server PDF text extraction fallback:', err);
  }
  return '';
}

function buildWinolsKnowledgeMarkdown(params: {
  fileName: string;
  extension: string;
  vehicleModel: string | null;
  ecuModel: string | null;
  mapList: string | null;
  binarySummaryMarkdown: string;
  sha256: string;
}): string {
  const headingParts = [
    params.ecuModel ? `ECU ${params.ecuModel}` : '',
    params.vehicleModel ? `خودرو ${params.vehicleModel}` : '',
  ].filter(Boolean);
  const heading =
    headingParts.length > 0
      ? `پکیج WinOLS 2.24 (.${params.extension}) — ${headingParts.join(' | ')}`
      : `پکیج WinOLS 2.24 (.${params.extension}) — ${params.fileName}`;

  const lines: string[] = [
    `# ${heading}`,
    '',
    `- **نام فایل:** ${params.fileName}`,
    `- **نوع فایل:** WinOLS 2.24 (.${params.extension})`,
    `- **نوع/مدل خودرو:** ${params.vehicleModel || 'ثبت‌نشده'}`,
    `- **نوع/مدل ECU:** ${params.ecuModel || 'ثبت‌نشده'}`,
    `- **اثرانگشت فایل (SHA-256):** \`${params.sha256.slice(0, 16)}\``,
  ];

  if (params.mapList) {
    lines.push('', '## جداول و نقشه‌های ثبت‌شده در فایل (Map List / Damos)', params.mapList);
  }

  if (params.binarySummaryMarkdown.trim()) {
    lines.push('', '## مشخصات فنی استخراج‌شده از ساختار فایل', params.binarySummaryMarkdown.trim());
  }

  return lines.join('\n');
}

export function createCollaborationRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // --------------------------------------------------------------------------
  // 1. BOOTSTRAP & PLATFORM STATE
  // --------------------------------------------------------------------------
  router.get('/bootstrap', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);

      await Promise.all([ensureStarterReferenceVolumes(), ensureStarterWishlist()]);

      const [settings, volumes, contributions, wishlist, assets] = await Promise.all([
        getPlatformSettings(),
        listMasterVolumes(),
        listTeamContributions(200),
        listWishlistItems(),
        listTeamUploadedAssets(200),
      ]);

      const pendingSheetSyncCount = contributions.filter((c) => !c.sheetSynced).length;
      const openWishlistCount = wishlist.filter((w) => w.status === 'open').length;
      const winolsAssetsCount = assets.filter(
        (a) => a.fileCategory === 'ols' || a.fileCategory === 'kp'
      ).length;

      res.json({
        isOwner,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          isGuest: Boolean(user.isGuest),
        },
        enableUserPersonalOutput: settings.enableUserPersonalOutput,
        access: {
          library: canAccessResource(settings.accessLibrary, user, isOwner),
          drive: canAccessResource(settings.accessDrive, user, isOwner),
          docs: canAccessResource(settings.accessDocs, user, isOwner),
          sheets: canAccessResource(settings.accessSheets, user, isOwner),
          levels: {
            library: settings.accessLibrary,
            drive: settings.accessDrive,
            docs: settings.accessDocs,
            sheets: settings.accessSheets,
          },
        },
        workspaceConfig: {
          driveRootFolderId: settings.driveRootFolderId,
          driveRootFolderName: settings.driveRootFolderName,
          sheetsSpreadsheetId: settings.sheetsSpreadsheetId,
          sheetsSpreadsheetUrl: settings.sheetsSpreadsheetUrl,
          sheetsTabName: settings.sheetsTabName,
        },
        stats: {
          volumesCount: volumes.length,
          totalWords: volumes.reduce((s, v) => s + (v.wordCount || 0), 0),
          contributionsCount: contributions.length,
          acceptedContributionsCount: contributions.filter(
            (c) => c.status === 'added' || c.status === 'partial_merge'
          ).length,
          winolsAssetsCount,
          openWishlistCount,
          pendingSheetSyncCount,
        },
        tokenLedger: isOwner ? settings.tokenLedger : undefined,
      });
    } catch (err) {
      console.error('[CollabRoutes] GET /bootstrap error:', err);
      res.status(500).json({ error: 'خطا در بارگذاری وضعیت پلتفرم مشارکتی.' });
    }
  });

  // --------------------------------------------------------------------------
  // 1.5. DRY-RUN IMPACT PREVIEW (Zero-Token Smart Clustering & Health Audit)
  // --------------------------------------------------------------------------
  router.post('/preview-ingest', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        fileName?: string;
        extractedText?: string;
        vehicleModel?: string;
        ecuModel?: string;
        mapList?: string;
      };
      const fileName = String(body.fileName || 'preview-note.md').trim().slice(0, 240);
      const rawText = String(body.extractedText || '').trim();
      if (!rawText) {
        res.status(400).json({ error: 'متن یا محتوایی برای پیش‌نمایش خوشه‌بندی ارسال نشده است.' });
        return;
      }

      const fileMeta = classifyContributionFileCategory(fileName);
      const preprocessReport = preprocessIncomingSourceFile({
        fileName,
        format: fileMeta.extension,
        rawText,
      });
      const workingPreviewText =
        preprocessReport.cleanedText.trim().length > 0
          ? preprocessReport.cleanedText
          : rawText;

      const gatekeeper = evaluateAutomotiveGatekeeperLayer0({
        fileName,
        format: fileMeta.extension,
        extractedText: workingPreviewText,
      });

      const merged = mergeMultiPageBrokenTables(workingPreviewText);
      const clusteringResult = runSmartClusteringAndCrossReferenceRouting(
        merged.mergedMarkdown,
        fileName
      );
      const overallClassification = classifyAutomotiveContent(
        clusteringResult.rewrittenMarkdown,
        fileName
      );
      const targetVolume = resolveStarterVolumeForDomain(overallClassification.primaryDomain);

      const [activeUnits, chapters] = await Promise.all([
        listMasterKnowledgeUnits({ lifecycleStatus: 'active' }),
        listMasterChapters(),
      ]);

      const healthReport = buildPostIngestProjectHealthReport({
        clusteringResult,
        activeUnits,
        chapters,
      });

      res.json({
        ok: true,
        gatekeeperDecision:
          preprocessReport.classification === 'rejected_non_automotive'
            ? 'rejected'
            : gatekeeper.decision,
        gatekeeperReasonFa:
          preprocessReport.classification === 'mixed_hybrid_pruned'
            ? preprocessReport.summaryFa
            : gatekeeper.reasonFa,
        preprocessReport,
        detectedDomain: overallClassification.primaryDomain,
        detectedVolumeId: targetVolume.id,
        detectedVolumeTitle: targetVolume.title,
        brokenTablesMergedCount: merged.mergedTablesCount,
        primaryCluster: clusteringResult.primaryCluster,
        crossReferenceRoutedCount: clusteringResult.routedLines.length,
        routedLinesPreview: healthReport.routedLinesPreview,
        phoneticCorrectionsCount: clusteringResult.phoneticCorrectionsCount,
        tokenAccounting: clusteringResult.tokenAccounting,
        healthReport,
      });
    } catch (err) {
      console.error('[CollabRoutes] POST /preview-ingest error:', err);
      res.status(500).json({ error: 'خطا در پیش‌نمایش خوشه‌بندی هوشمند.' });
    }
  });

  // --------------------------------------------------------------------------
  // 2. CONTRIBUTE FILE / AUDIO / PDF / WORD / WINOLS (.ols, .kp)
  // --------------------------------------------------------------------------
  router.post('/contribute', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const identity = resolveUploaderIdentity(user);

      if (user.isGuest) {
        const rate = checkGuestUploadRateLimit(`collab-guest:${user.uid}`, 25, 10 * 60 * 1000);
        if (!rate.allowed) {
          res.status(429).json({
            error: `سقف موقت ارسال در حالت مهمان پر شده است. لطفاً پس از ${rate.retryAfterSeconds} ثانیه دوباره تلاش کنید.`,
          });
          return;
        }
      }

      const body = (req.body || {}) as {
        fileName?: string;
        mimeType?: string;
        extractedText?: string;
        base64Data?: string;
        vehicleModel?: string;
        ecuModel?: string;
        mapList?: string;
        bountyId?: string;
        driveFileId?: string;
        driveWebViewLink?: string;
        driveFolderPath?: string;
      };

      const fileName = String(body.fileName || '').trim();
      if (!fileName || fileName.length > 260) {
        res.status(400).json({ error: 'نام فایل معتبر نیست.' });
        return;
      }

      const fileMeta = classifyContributionFileCategory(fileName);
      const isWinols = isWinolsPackageExtension(fileMeta.extension);

      // Step A: Mandatory WinOLS 2.24 (.ols / .kp) metadata check (at least ONE of vehicleModel or ecuModel)
      const winolsValidation = validateWinolsMetadata({
        extension: fileMeta.extension,
        vehicleModel: body.vehicleModel,
        ecuModel: body.ecuModel,
        mapList: body.mapList,
      });
      if (!winolsValidation.valid) {
        res.status(400).json({
          error: winolsValidation.errorFa,
          code: 'WINOLS_METADATA_REQUIRED',
        });
        return;
      }

      // Decode optional base64 bytes and verify magic bytes
      let rawBytes: Uint8Array | null = null;
      let rawBase64Clean: string | null = null;
      if (typeof body.base64Data === 'string' && body.base64Data.trim().length > 0) {
        const stripped = body.base64Data.trim().replace(/^data:[^;]+;base64,/i, '');
        if (stripped.length > MAX_BASE64_PAYLOAD_CHARS || !BASE64_PATTERN.test(stripped)) {
          res.status(400).json({
            error: 'حجم یا ساختار Base64 فایل ارسالی نامعتبر است.',
            code: 'INVALID_BASE64_PAYLOAD',
          });
          return;
        }
        rawBase64Clean = stripped;
        const buf = Buffer.from(stripped, 'base64');
        rawBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

        const magicCheck = verifyFileMagicBytes(fileName, rawBytes);
        if (!magicCheck.ok) {
          rawBytes.fill(0);
          res.status(400).json({
            error: magicCheck.reasonFa || 'امضا یا فرمت فایل معتبر نیست.',
            code: 'INVALID_FILE_SIGNATURE',
          });
          return;
        }
      }

      let workingText = typeof body.extractedText === 'string' ? body.extractedText.trim() : '';

      // Step B: Compute deterministic SHA-256 BEFORE any AI or heavy processing (Script-First Deduplication)
      const hashSource: string | Uint8Array =
        rawBytes && rawBytes.byteLength > 0
          ? rawBytes
          : `${fileMeta.extension}:${workingText.replace(/\s+/g, ' ').trim()}`;
      const sourceUploadHash = computeSha256Hex(hashSource);

      // Check exact file duplicate first -> 0 AI tokens!
      const priorMatch = await findAcceptedContributionBySourceHash(sourceUploadHash);
      if (priorMatch) {
        if (rawBytes) rawBytes.fill(0);
        await recordTokenLedgerDelta({ zeroTokenDuplicateSaves: 1 }).catch(() => undefined);

        const dupRecord = await createTeamContribution({
          ingestBatchId: null,
          sourceUploadHash,
          uploaderUid: identity.uploaderUid,
          uploaderEmail: identity.uploaderEmail,
          uploaderDisplayName: identity.uploaderDisplayName,
          uploaderType: identity.uploaderType,
          fileName,
          fileExtension: fileMeta.extension,
          fileCategory: fileMeta.category,
          vehicleModel: winolsValidation.normalizedVehicleModel,
          ecuModel: winolsValidation.normalizedEcuModel,
          mapList: winolsValidation.normalizedMapList,
          detectedVolumeId: priorMatch.detectedVolumeId,
          detectedVolumeTitle: priorMatch.detectedVolumeTitle,
          detectedDomain: priorMatch.detectedDomain,
          newPercent: 0,
          duplicatePercent: 100,
          newUnitsCount: 0,
          mergedUnitsCount: 0,
          duplicateUnitsCount: Math.max(1, priorMatch.newUnitsCount),
          status: 'duplicate',
          statusLabelFa: 'کاملاً تکراری (بدون تغییر در مرجع)',
          reasonFa: `این فایل دقیقاً قبلاً در تاریخ ${priorMatch.createdAt.slice(0, 10)} توسط تیم ثبت و پردازش شده است؛ بنابراین بدون مصرف توکن هوش مصنوعی و بدون ایجاد تغییر در کتاب مرجع، تکراری تشخیص داده شد.`,
          score: 0,
          scoreBreakdown: { baseNoveltyScore: 0, winolsBonus: 0, bountyBonus: 0 },
          bountyId: null,
          driveFileId:
            sanitizeExternalWorkspaceUrl(body.driveWebViewLink) &&
            isValidGoogleResourceId(body.driveFileId)
              ? String(body.driveFileId).trim()
              : null,
          driveWebViewLink: sanitizeExternalWorkspaceUrl(body.driveWebViewLink),
          driveFolderPath: body.driveFolderPath || null,
          sheetSynced: false,
          tokensUsed: 0,
          assetId: priorMatch.assetId,
        });

        res.status(200).json({
          ok: true,
          contribution: dupRecord,
          sheetRow: buildContributionSheetRow(dupRecord),
          recommendedDriveFolder: buildCategorizedDriveFolderPath({
            fileCategory: dupRecord.fileCategory,
            vehicleModel: dupRecord.vehicleModel,
            ecuModel: dupRecord.ecuModel,
            detectedVolumeTitle: dupRecord.detectedVolumeTitle,
          }),
          bountyFulfilled: null,
        });
        return;
      }

      // Step C: Extract text/profile according to format (Audio STT / PDF / WinOLS / Text)
      let tokensUsed = 0;
      let transcriptPreview: string | null = null;
      let pdfBase64ToStore: string | null = null;
      let analyzedEcuProfile: EcuTechnicalProfileJson | null = null;

      if (fileMeta.category === 'audio') {
        if (!workingText) {
          if (!rawBase64Clean || !rawBytes || rawBytes.byteLength === 0) {
            res.status(400).json({
              error: 'برای پردازش فایل صوتی، ارسال محتوای صوتی یا متن استخراج‌شده الزامی است.',
            });
            return;
          }
          try {
            const provider = resolveAiProviderFromRequest(req);
            const audioRoute = resolveAudioRouteFromRequest(req);
            const stt = await transcribeAudioUnified({
              audioRoute,
              primaryProvider: provider,
              audioBase64: rawBase64Clean,
              mimeType: body.mimeType || `audio/${fileMeta.extension === 'mp3' ? 'mpeg' : fileMeta.extension}`,
              fileName,
            });
            const aligned = alignPostAsrAutomotiveTerms(stt.transcript || '');
            workingText = aligned.alignedText.trim();
            transcriptPreview = workingText.slice(0, 600);
            tokensUsed = Math.max(
              stt.usageDelta?.totalTokens || 0,
              Math.round(workingText.length * 0.8)
            );
            await recordTokenLedgerDelta({
              audioTranscribeTokens: tokensUsed,
              totalAiCalls: 1,
            }).catch(() => undefined);
          } catch (sttErr) {
            const msg = sttErr instanceof Error ? sttErr.message : 'خطا در تبدیل گفتار به متن';
            res.status(503).json({
              error: `خطا در تبدیل فایل صوتی به متن تخصصی خودرو: ${msg}`,
            });
            return;
          }
        } else {
          const aligned = alignPostAsrAutomotiveTerms(workingText);
          workingText = aligned.alignedText.trim();
          transcriptPreview = workingText.slice(0, 600);
        }
      } else if (fileMeta.category === 'pdf') {
        if (rawBytes && rawBytes.byteLength > 0) {
          if (!workingText) {
            workingText = await extractTextFromPdfBytesServer(rawBytes);
          }
          if (rawBytes.byteLength <= MAX_INLINE_PDF_BYTES && rawBase64Clean) {
            pdfBase64ToStore = rawBase64Clean;
          }
        }
      } else if (isWinols || ECU_BINARY_AND_CALIBRATION_FORMATS.has(fileMeta.extension)) {
        let binaryMarkdown = '';
        if (rawBytes && rawBytes.byteLength > 0) {
          analyzedEcuProfile = analyzeEcuFileInMemory({
            fileName,
            rawBytes,
            zeroBufferAfterAnalysis: true,
          });
          binaryMarkdown = formatEcuProfileAsMarkdown(analyzedEcuProfile);
        }
        workingText = buildWinolsKnowledgeMarkdown({
          fileName,
          extension: fileMeta.extension,
          vehicleModel: winolsValidation.normalizedVehicleModel,
          ecuModel: winolsValidation.normalizedEcuModel,
          mapList: winolsValidation.normalizedMapList,
          binarySummaryMarkdown: [binaryMarkdown, workingText].filter(Boolean).join('\n\n'),
          sha256: sourceUploadHash,
        });
      } else if (!workingText && rawBytes && rawBytes.byteLength > 0) {
        workingText = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes).trim();
      }

      if (rawBytes) {
        // Zero buffer memory after processing
        rawBytes.fill(0);
      }

      if (!workingText || workingText.length < 15) {
        res.status(400).json({
          error:
            'محتوای قابل استخراجی در فایل یافت نشد. لطفاً یک فایل متنی/PDF/Word خوانا، صوتی یا فایل معتبر WinOLS (.ols/.kp) بارگذاری کنید.',
        });
        return;
      }

      // Step D: Format-Specific Preprocessor & Hybrid Surgical Pruning + Layer-0 Gatekeeper (ZERO AI tokens!)
      const preprocessReport = preprocessIncomingSourceFile({
        fileName,
        format: fileMeta.extension,
        rawText: workingText,
      });
      if (
        preprocessReport.classification === 'mixed_hybrid_pruned' &&
        preprocessReport.cleanedText.trim().length > 0
      ) {
        workingText = preprocessReport.cleanedText;
      } else if (
        preprocessReport.classification === 'pure_automotive' &&
        preprocessReport.cleanedText.trim().length > 0
      ) {
        workingText = preprocessReport.cleanedText;
      }

      const gatekeeper = evaluateAutomotiveGatekeeperLayer0({
        fileName,
        extractedText: workingText,
        format: fileMeta.extension,
      });

      const hasExplicitAutoMeta = Boolean(
        winolsValidation.normalizedVehicleModel || winolsValidation.normalizedEcuModel
      );
      const isGatekeeperApproved =
        isWinols ||
        (preprocessReport.classification !== 'rejected_non_automotive' &&
          (gatekeeper.decision === 'approved' ||
            (gatekeeper.decision === 'ambiguous' && hasExplicitAutoMeta)));

      if (!isGatekeeperApproved) {
        await recordTokenLedgerDelta({ zeroTokenGatekeeperRejects: 1 }).catch(() => undefined);

        const rejectedRecord = await createTeamContribution({
          ingestBatchId: null,
          sourceUploadHash,
          uploaderUid: identity.uploaderUid,
          uploaderEmail: identity.uploaderEmail,
          uploaderDisplayName: identity.uploaderDisplayName,
          uploaderType: identity.uploaderType,
          fileName,
          fileExtension: fileMeta.extension,
          fileCategory: fileMeta.category,
          vehicleModel: winolsValidation.normalizedVehicleModel,
          ecuModel: winolsValidation.normalizedEcuModel,
          mapList: winolsValidation.normalizedMapList,
          detectedVolumeId: null,
          detectedVolumeTitle: 'خارج از حوزه خودرو',
          detectedDomain: 'non_automotive',
          newPercent: 0,
          duplicatePercent: 0,
          newUnitsCount: 0,
          mergedUnitsCount: 0,
          duplicateUnitsCount: 0,
          status: 'rejected',
          statusLabelFa: 'ردشده (غیرمرتبط با حوزه خودرو)',
          reasonFa: gatekeeper.reasonFa || AUTOMOTIVE_REJECTION_MESSAGE_FA,
          score: 0,
          scoreBreakdown: { baseNoveltyScore: 0, winolsBonus: 0, bountyBonus: 0 },
          bountyId: null,
          driveFileId: null,
          driveWebViewLink: null,
          driveFolderPath: null,
          sheetSynced: false,
          tokensUsed,
          assetId: null,
        });

        res.status(200).json({
          ok: true,
          contribution: rejectedRecord,
          sheetRow: buildContributionSheetRow(rejectedRecord),
          recommendedDriveFolder: null,
          bountyFulfilled: null,
        });
        return;
      }

      // Step E: Ensure the 6 Starter Reference Books exist & Delta-Merge deterministically (0 LLM tokens)
      await ensureStarterReferenceVolumes();

      const overallClassification = classifyAutomotiveContent(workingText, fileName);
      const effectiveDomain = isWinols ? 'remap_tuning' : overallClassification.primaryDomain;
      const targetStarterVolume = resolveStarterVolumeForDomain(effectiveDomain);
      const ingestBatchId = `batch-${crypto.randomUUID().slice(0, 12)}`;
      const submitterSessionHash = computeSha256Hex(identity.uploaderUid).slice(0, 16);

      const deltaResult = await ingestDocumentIntoMasterEncyclopedia({
        ingestBatchId,
        sourceUploadHash,
        sourceFileName: fileName,
        rawText: workingText,
        submittedByRole: identity.submittedByRole,
        submitterSessionHash,
        evidenceTier: isWinols ? 'a2l_xdf_verified' : 'text_or_screenshot_reported',
        actorEmail: identity.uploaderEmail,
        contributorDisplayName: identity.uploaderDisplayName,
        preferredVolumeResolver: (domain) =>
          isWinols ? targetStarterVolume.id : resolveStarterVolumeForDomain(domain).id,
      });

      const novelty = computeContributionNovelty({
        isRejected: false,
        isExactFileDuplicate: false,
        newUnitsCount: deltaResult.newUnitsCount,
        mergedUnitsCount: deltaResult.mergedUnitsCount,
        duplicateUnitsCount: deltaResult.duplicateUnitsCount,
      });

      const contributionId = `contrib-${crypto.randomUUID()}`;

      // Step F: Atomic Wishlist Bounty claim (prevents double-claim race conditions)
      let bountyBonusScore = 0;
      let fulfilledBounty = null;
      if (body.bountyId && (novelty.status === 'added' || novelty.status === 'partial_merge')) {
        const claimed = await markWishlistFulfilled(
          String(body.bountyId).trim(),
          identity.uploaderEmail,
          contributionId
        );
        if (claimed) {
          bountyBonusScore = claimed.bonusScore;
          fulfilledBounty = claimed;
        }
      }

      const scoreRes = calculateContributionScore({
        status: novelty.status,
        newPercent: novelty.newPercent,
        newUnitsCount: deltaResult.newUnitsCount,
        mergedUnitsCount: deltaResult.mergedUnitsCount,
        fileCategory: fileMeta.category,
        vehicleModel: winolsValidation.normalizedVehicleModel,
        ecuModel: winolsValidation.normalizedEcuModel,
        mapList: winolsValidation.normalizedMapList,
        bountyBonusScore,
      });

      const driveFolderPlan = buildCategorizedDriveFolderPath({
        fileCategory: fileMeta.category,
        vehicleModel: winolsValidation.normalizedVehicleModel,
        ecuModel: winolsValidation.normalizedEcuModel,
        detectedVolumeTitle: targetStarterVolume.title,
      });

      const safeDriveLink = sanitizeExternalWorkspaceUrl(body.driveWebViewLink);
      const safeDriveFileId =
        safeDriveLink && isValidGoogleResourceId(body.driveFileId)
          ? String(body.driveFileId).trim()
          : null;

      // Store indexed asset for Drive browser & internal PDF viewer (when accepted/partial)
      let createdAssetId: string | null = null;
      if (novelty.status === 'added' || novelty.status === 'partial_merge') {
        const asset = await createTeamUploadedAsset({
          contributionId,
          fileName,
          fileExtension: fileMeta.extension,
          fileCategory: fileMeta.category,
          mimeType: body.mimeType || (fileMeta.category === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
          sizeBytes: rawBase64Clean
            ? Math.floor((rawBase64Clean.length * 3) / 4)
            : Buffer.byteLength(workingText, 'utf8'),
          sha256: sourceUploadHash,
          vehicleModel: winolsValidation.normalizedVehicleModel,
          ecuModel: winolsValidation.normalizedEcuModel,
          mapList: winolsValidation.normalizedMapList,
          domainId: effectiveDomain,
          volumeId: targetStarterVolume.id,
          uploaderEmail: identity.uploaderEmail,
          uploaderDisplayName: identity.uploaderDisplayName,
          driveFileId: safeDriveFileId,
          driveWebViewLink: safeDriveLink,
          driveFolderPath: body.driveFolderPath || driveFolderPlan.displayPath,
          pdfBase64: pdfBase64ToStore,
        });
        createdAssetId = asset.id;
      }

      const reasonFa =
        novelty.status === 'duplicate'
          ? 'تمام بندهای فنی استخراج‌شده از این فایل پیش‌تر در کتاب مرجع ثبت شده بودند؛ بنابراین تغییری اعمال نشد.'
          : novelty.status === 'added'
            ? `${deltaResult.newUnitsCount} واحد دانش جدید بدون حذف اطلاعات قبلی به «${targetStarterVolume.title}» افزوده شد.`
            : `${deltaResult.newUnitsCount} واحد جدید و ${deltaResult.mergedUnitsCount} بند تکمیلی (Delta-Merge) به «${targetStarterVolume.title}» اضافه شد و ${deltaResult.duplicateUnitsCount} بخش تکراری نادیده گرفته شد.`;

      const record = await createTeamContribution({
        id: contributionId,
        ingestBatchId: novelty.status === 'duplicate' ? null : ingestBatchId,
        sourceUploadHash,
        uploaderUid: identity.uploaderUid,
        uploaderEmail: identity.uploaderEmail,
        uploaderDisplayName: identity.uploaderDisplayName,
        uploaderType: identity.uploaderType,
        fileName,
        fileExtension: fileMeta.extension,
        fileCategory: fileMeta.category,
        vehicleModel: winolsValidation.normalizedVehicleModel,
        ecuModel: winolsValidation.normalizedEcuModel,
        mapList: winolsValidation.normalizedMapList,
        detectedVolumeId: targetStarterVolume.id,
        detectedVolumeTitle: targetStarterVolume.title,
        detectedDomain: effectiveDomain,
        newPercent: novelty.newPercent,
        duplicatePercent: novelty.duplicatePercent,
        newUnitsCount: deltaResult.newUnitsCount,
        mergedUnitsCount: deltaResult.mergedUnitsCount,
        duplicateUnitsCount: deltaResult.duplicateUnitsCount,
        status: novelty.status,
        statusLabelFa: novelty.statusLabelFa,
        reasonFa,
        score: scoreRes.score,
        scoreBreakdown: {
          baseNoveltyScore: scoreRes.baseNoveltyScore,
          winolsBonus: scoreRes.winolsBonus,
          bountyBonus: scoreRes.bountyBonus,
        },
        bountyId: fulfilledBounty ? fulfilledBounty.id : null,
        driveFileId: safeDriveFileId,
        driveWebViewLink: safeDriveLink,
        driveFolderPath: body.driveFolderPath || driveFolderPlan.displayPath,
        sheetSynced: false,
        tokensUsed,
        assetId: createdAssetId,
      });

      const enrichedHealthReport =
        analyzedEcuProfile && deltaResult.clusteringResult
          ? buildPostIngestProjectHealthReport({
              clusteringResult: deltaResult.clusteringResult,
              extractedMaps: analyzedEcuProfile.extractedMaps,
              dumpByteLength: analyzedEcuProfile.byteLength,
              detectedEcuFamilies: analyzedEcuProfile.detectedEcuFamilies,
              activeUnits: await listMasterKnowledgeUnits({ lifecycleStatus: 'active' }),
              chapters: await listMasterChapters(),
            })
          : deltaResult.projectHealthReport ?? null;

      res.status(201).json({
        ok: true,
        contribution: record,
        sheetRow: buildContributionSheetRow(record),
        recommendedDriveFolder: driveFolderPlan,
        bountyFulfilled: fulfilledBounty,
        transcriptPreview,
        conflictsDetected: deltaResult.conflictsCount,
        crossReferenceRoutedCount: deltaResult.crossReferenceRoutedCount ?? 0,
        projectHealthReport: enrichedHealthReport,
      });
    } catch (err) {
      console.error('[CollabRoutes] POST /contribute error:', err);
      res.status(500).json({ error: 'خطا در پردازش و ثبت مشارکت. لطفاً دوباره تلاش کنید.' });
    }
  });

  // --------------------------------------------------------------------------
  // 3. ATTACH GOOGLE DRIVE LINK / MARK GOOGLE SHEETS SYNCED
  // --------------------------------------------------------------------------
  router.patch('/contributions/:id/workspace-sync', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const contributionId = String(req.params.id || '').trim();
      const existing = await getTeamContributionById(contributionId);
      if (!existing) {
        res.status(404).json({ error: 'رکورد مشارکت یافت نشد.' });
        return;
      }

      const isOwner = isAdminUser(user);
      if (!isOwner && existing.uploaderUid !== user.uid) {
        res.status(403).json({ error: 'شما مجاز به ویرایش وضعیت همگام‌سازی این رکورد نیستید.' });
        return;
      }

      const body = (req.body || {}) as {
        driveFileId?: string | null;
        driveWebViewLink?: string | null;
        driveFolderPath?: string | null;
        sheetSynced?: boolean;
      };

      if (
        body.driveFileId !== undefined &&
        body.driveFileId !== null &&
        String(body.driveFileId).trim() !== '' &&
        !isValidGoogleResourceId(body.driveFileId)
      ) {
        res.status(400).json({ error: 'شناسه فایل Google Drive معتبر نیست.' });
        return;
      }

      const safeLink =
        body.driveWebViewLink !== undefined
          ? sanitizeExternalWorkspaceUrl(body.driveWebViewLink)
          : undefined;

      const updated = await updateTeamContributionWorkspaceSync(contributionId, {
        driveFileId:
          body.driveFileId !== undefined
            ? body.driveFileId
              ? String(body.driveFileId).trim()
              : null
            : undefined,
        driveWebViewLink: safeLink,
        driveFolderPath: body.driveFolderPath !== undefined ? body.driveFolderPath : undefined,
        sheetSynced: body.sheetSynced !== undefined ? Boolean(body.sheetSynced) : undefined,
      });

      res.json({ ok: true, contribution: updated });
    } catch (err) {
      console.error('[CollabRoutes] PATCH /workspace-sync error:', err);
      res.status(500).json({ error: 'خطا در به‌روزرسانی لینک Google Drive/Sheets.' });
    }
  });

  // --------------------------------------------------------------------------
  // 4. OPEN REFERENCE LIBRARY + INTERNAL PDF VIEWER + GOOGLE DOCS SYNC
  // --------------------------------------------------------------------------
  router.get('/library', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();

      if (!canAccessResource(settings.accessLibrary, user, isOwner)) {
        res.status(403).json({
          error: 'دسترسی به کتابخانه مرجع بر اساس تنظیمات مالک برای سطح کاربری شما محدود شده است.',
          code: 'RESOURCE_ACCESS_RESTRICTED',
        });
        return;
      }

      await ensureStarterReferenceVolumes();

      const [volumes, chapters, units, assets, contributions] = await Promise.all([
        listMasterVolumes(),
        listMasterChapters(),
        listMasterKnowledgeUnits(),
        listTeamUploadedAssets(200),
        listTeamContributions(300),
      ]);

      const isGuestViewer = Boolean(user.isGuest) && !isOwner;
      const activeUnits = units.filter(
        (u) => u.lifecycleStatus === 'active' && u.verificationStatus !== 'rejected'
      );

      // Group units and contributor attribution per chapter
      const unitsByChapter = new Map<string, typeof activeUnits>();
      for (const u of activeUnits) {
        const list = unitsByChapter.get(u.chapterId) || [];
        list.push(u);
        unitsByChapter.set(u.chapterId, list);
      }

      const maskAssetForViewer = <T extends { uploaderEmail: string }>(asset: T): T => ({
        ...asset,
        uploaderEmail: maskEmailForViewer(asset.uploaderEmail, isGuestViewer),
      });

      const volumesPayload = volumes
        .sort((a, b) => a.volumeNumber - b.volumeNumber)
        .map((vol) => {
          const volChapters = chapters
            .filter((c) => c.volumeId === vol.id)
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((ch) => {
              const chUnits = (unitsByChapter.get(ch.id) || []).sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
              );
              const contributorsMap = new Map<
                string,
                { displayName: string; email: string; count: number; lastBatchId: string }
              >();
              const batchesSet = new Map<
                string,
                { ingestBatchId: string; sourceFileName: string; contributorName: string; createdAt: string; unitsCount: number }
              >();

              for (const u of chUnits) {
                const meta = (u.technicalMetadataJson || {}) as Record<string, unknown>;
                const rawEmail = String(meta.contributorEmail || 'team@reference');
                const maskedEmail = maskEmailForViewer(rawEmail, isGuestViewer);
                const cName = String(meta.contributorDisplayName || maskedEmail);
                const prev = contributorsMap.get(rawEmail);
                contributorsMap.set(rawEmail, {
                  displayName: cName,
                  email: maskedEmail,
                  count: (prev?.count || 0) + 1,
                  lastBatchId: u.ingestBatchId,
                });

                const existingBatch = batchesSet.get(u.ingestBatchId);
                const createdIso =
                  u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt);
                batchesSet.set(u.ingestBatchId, {
                  ingestBatchId: u.ingestBatchId,
                  sourceFileName: String(meta.sourceFileName || 'منبع مرجع'),
                  contributorName: cName,
                  createdAt: createdIso,
                  unitsCount: (existingBatch?.unitsCount || 0) + 1,
                });
              }

              const liveChapterWordCount = chUnits.reduce(
                (sum, u) =>
                  sum +
                  (u.wordCount ||
                    u.cleanText
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean).length),
                0
              );

              return {
                ...ch,
                wordCount: Math.max(ch.wordCount || 0, liveChapterWordCount),
                units: chUnits.map((u) => {
                  const meta = (u.technicalMetadataJson || {}) as Record<string, unknown>;
                  const maskedMeta =
                    typeof meta.contributorEmail === 'string'
                      ? {
                          ...meta,
                          contributorEmail: maskEmailForViewer(
                            meta.contributorEmail,
                            isGuestViewer
                          ),
                        }
                      : meta;
                  return {
                    ...u,
                    technicalMetadataJson: maskedMeta,
                    createdAt:
                      u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
                  };
                }),
                unitsCount: chUnits.length,
                contributors: Array.from(contributorsMap.values()),
                recentBatches: Array.from(batchesSet.values()).slice(-10).reverse(),
              };
            });

          const volPdfs = assets
            .filter((a) => a.fileCategory === 'pdf' && a.volumeId === vol.id)
            .map(maskAssetForViewer);

          const liveVolumeWordCount = volChapters.reduce(
            (sum, c) => sum + (c.wordCount || 0),
            0
          );

          return {
            ...vol,
            wordCount: Math.max(vol.wordCount || 0, liveVolumeWordCount),
            domainLabelFa: getAutomotiveDomainDefinition(vol.automotiveDomain as never).titleFa,
            googleDoc: settings.volumeDocs[vol.id] || null,
            chapters: volChapters,
            pdfAssets: volPdfs,
          };
        });

      const allPdfAssets = assets
        .filter((a) => a.fileCategory === 'pdf')
        .map(maskAssetForViewer);

      res.json({
        volumes: volumesPayload,
        pdfAssets: allPdfAssets,
        canUseDocs: canAccessResource(settings.accessDocs, user, isOwner),
        isOwner,
        totalContributions: contributions.length,
      });
    } catch (err) {
      console.error('[CollabRoutes] GET /library error:', err);
      res.status(500).json({ error: 'خطا در بارگذاری کتابخانه مرجع.' });
    }
  });

  // Internal PDF Viewer binary stream endpoint
  router.get('/library/pdf/:assetId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();

      if (!canAccessResource(settings.accessLibrary, user, isOwner)) {
        res.status(403).json({ error: 'دسترسی به پیش‌نمایش PDF محدود شده است.' });
        return;
      }

      const asset = await getTeamUploadedAssetWithPdf(String(req.params.assetId || '').trim());
      if (!asset || !asset.pdfBase64) {
        res.status(404).json({ error: 'نسخه داخلی این فایل PDF موجود نیست.' });
        return;
      }

      const buffer = Buffer.from(asset.pdfBase64, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(asset.fileName)}"`
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(buffer);
    } catch (err) {
      console.error('[CollabRoutes] GET /library/pdf error:', err);
      res.status(500).json({ error: 'خطا در نمایش فایل PDF.' });
    }
  });

  // Link or pull Google Doc edits for a Reference Volume
  router.post('/library/volumes/:volumeId/doc-link', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();

      if (!canAccessResource(settings.accessDocs, user, isOwner)) {
        res.status(403).json({
          error: 'دسترسی به همگام‌سازی Google Docs برای سطح کاربری شما مجاز نیست.',
        });
        return;
      }

      const volumeId = String(req.params.volumeId || '').trim();
      const body = (req.body || {}) as {
        googleDocId?: string;
        googleDocUrl?: string;
        pulledMarkdown?: string;
      };

      const googleDocId = String(body.googleDocId || '').trim();
      const safeDocUrl = sanitizeExternalWorkspaceUrl(body.googleDocUrl);

      if (!isValidGoogleResourceId(googleDocId) || !safeDocUrl) {
        res.status(400).json({ error: 'شناسه و لینک معتبر Google Docs الزامی است.' });
        return;
      }

      const identity = resolveUploaderIdentity(user);
      const nextDocs: Record<string, VolumeGoogleDocLink> = {
        ...settings.volumeDocs,
        [volumeId]: {
          volumeId,
          googleDocId,
          googleDocUrl: safeDocUrl,
          lastSyncedAt: new Date().toISOString(),
          syncedByEmail: identity.uploaderEmail,
        },
      };

      await updatePlatformSettings({ volumeDocs: nextDocs });

      let mergeSummary: { newUnitsCount: number; mergedUnitsCount: number; ingestBatchId: string } | null = null;
      if (typeof body.pulledMarkdown === 'string' && body.pulledMarkdown.trim().length >= 25) {
        const ingestBatchId = `gdoc-pull-${crypto.randomUUID().slice(0, 10)}`;
        const sourceHash = computeSha256Hex(`gdoc:${volumeId}:${body.pulledMarkdown.trim()}`);
        const delta = await ingestDocumentIntoMasterEncyclopedia({
          ingestBatchId,
          sourceUploadHash: sourceHash,
          sourceFileName: `GoogleDoc-${volumeId}.md`,
          rawText: body.pulledMarkdown.trim(),
          submittedByRole: identity.submittedByRole,
          submitterSessionHash: computeSha256Hex(identity.uploaderUid).slice(0, 16),
          evidenceTier: 'text_or_screenshot_reported',
          actorEmail: identity.uploaderEmail,
          contributorDisplayName: identity.uploaderDisplayName,
          preferredVolumeResolver: () => volumeId,
        });
        mergeSummary = {
          newUnitsCount: delta.newUnitsCount,
          mergedUnitsCount: delta.mergedUnitsCount,
          ingestBatchId,
        };
      }

      res.json({
        ok: true,
        googleDoc: nextDocs[volumeId],
        mergeSummary,
      });
    } catch (err) {
      console.error('[CollabRoutes] POST /doc-link error:', err);
      res.status(500).json({ error: 'خطا در ثبت اتصال Google Docs.' });
    }
  });

  // --------------------------------------------------------------------------
  // 5. CHAPTER COMMENTS / CORRECTIONS & OWNER 1-CLICK ROLLBACK
  // --------------------------------------------------------------------------
  router.get('/chapters/:chapterId/comments', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();
      if (!canAccessResource(settings.accessLibrary, user, isOwner)) {
        res.status(403).json({
          error: 'دسترسی به یادداشت‌های کتابخانه برای سطح کاربری شما محدود شده است.',
          code: 'RESOURCE_ACCESS_RESTRICTED',
        });
        return;
      }
      const isGuestViewer = Boolean(user.isGuest) && !isOwner;
      const chapterId = String(req.params.chapterId || '').trim();
      const comments = (await listChapterComments(chapterId)).map((c) => ({
        ...c,
        authorEmail: maskEmailForViewer(c.authorEmail, isGuestViewer),
      }));
      res.json({ comments });
    } catch (err) {
      console.error('[CollabRoutes] GET /comments error:', err);
      res.status(500).json({ error: 'خطا در دریافت یادداشت‌های فصل.' });
    }
  });

  router.post('/chapters/:chapterId/comments', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();
      if (!canAccessResource(settings.accessLibrary, user, isOwner)) {
        res.status(403).json({
          error: 'دسترسی به ثبت یادداشت در کتابخانه برای سطح کاربری شما مجاز نیست.',
          code: 'RESOURCE_ACCESS_RESTRICTED',
        });
        return;
      }

      if (user.isGuest) {
        const rate = checkGuestUploadRateLimit(`collab-comment:${user.uid}`, 20, 10 * 60 * 1000);
        if (!rate.allowed) {
          res.status(429).json({
            error: `سقف موقت ارسال یادداشت پر شده است. لطفاً پس از ${rate.retryAfterSeconds} ثانیه تلاش کنید.`,
          });
          return;
        }
      }

      const identity = resolveUploaderIdentity(user);
      const chapterId = String(req.params.chapterId || '').trim();
      const chapter = await getMasterChapterById(chapterId);
      if (!chapter) {
        res.status(404).json({ error: 'فصل موردنظر در کتابخانه مرجع یافت نشد.' });
        return;
      }

      const body = (req.body || {}) as {
        volumeId?: string;
        commentType?: 'comment' | 'correction';
        body?: string;
      };

      const text = String(body.body || '').trim();
      if (text.length < 3 || text.length > 2000) {
        res.status(400).json({ error: 'متن یادداشت یا پیشنهاد اصلاح باید بین ۳ تا ۲۰۰۰ کاراکتر باشد.' });
        return;
      }

      const comment = await createChapterComment({
        volumeId: chapter.volumeId || String(body.volumeId || 'unknown'),
        chapterId,
        authorUid: identity.uploaderUid,
        authorName: identity.uploaderDisplayName,
        authorEmail: identity.uploaderEmail,
        authorType: identity.uploaderType,
        commentType: body.commentType === 'correction' ? 'correction' : 'comment',
        body: text,
      });

      const isGuestViewer = Boolean(user.isGuest) && !isOwner;
      res.status(201).json({
        ok: true,
        comment: {
          ...comment,
          authorEmail: maskEmailForViewer(comment.authorEmail, isGuestViewer),
        },
      });
    } catch (err) {
      console.error('[CollabRoutes] POST /comments error:', err);
      res.status(500).json({ error: 'خطا در ثبت یادداشت فصل.' });
    }
  });

  router.patch('/chapters/comments/:commentId/resolve', requireAdmin, async (req: Request, res: Response) => {
    try {
      const resolved = await resolveChapterComment(String(req.params.commentId || '').trim());
      if (!resolved) {
        res.status(404).json({ error: 'یادداشت مورد نظر یافت نشد.' });
        return;
      }
      res.json({ ok: true, comment: resolved });
    } catch (err) {
      console.error('[CollabRoutes] PATCH /comments/resolve error:', err);
      res.status(500).json({ error: 'خطا در تغییر وضعیت یادداشت.' });
    }
  });

  router.post('/rollback/:ingestBatchId', requireAdmin, async (req: Request, res: Response) => {
    try {
      const batchId = String(req.params.ingestBatchId || '').trim();
      if (!batchId) {
        res.status(400).json({ error: 'شناسه دسته پردازش (ingestBatchId) الزامی است.' });
        return;
      }
      const result = await rollbackIngestBatch(batchId);
      res.json({
        ok: true,
        ...result,
        deletedCount: result.deletedUnits,
        revertedCount: result.revertedUnits,
      });
    } catch (err) {
      console.error('[CollabRoutes] POST /rollback error:', err);
      res.status(500).json({ error: 'خطا در بازگردانی (Rollback) تغییرات فصل.' });
    }
  });

  // --------------------------------------------------------------------------
  // 6. UNIFIED AUTOMOTIVE SEARCH (Books + DTCs + Vehicle/ECU + .ols/.kp/PDF)
  // --------------------------------------------------------------------------
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();

      const q = String(req.query.q || '').trim();
      if (!q || q.length < 2) {
        res.json({ query: q, bookMatches: [], assetMatches: [], contributionMatches: [] });
        return;
      }

      const qLower = q.toLowerCase();
      const canLib = canAccessResource(settings.accessLibrary, user, isOwner);
      const canDrv = canAccessResource(settings.accessDrive, user, isOwner);
      const canSheets = canAccessResource(settings.accessSheets, user, isOwner);
      const isGuestViewer = Boolean(user.isGuest) && !isOwner;

      const [volumes, chapters, units, assets, contributions] = await Promise.all([
        canLib ? listMasterVolumes() : Promise.resolve([]),
        canLib ? listMasterChapters() : Promise.resolve([]),
        canLib ? listMasterKnowledgeUnits() : Promise.resolve([]),
        canDrv ? listTeamUploadedAssets(300) : Promise.resolve([]),
        canDrv || canSheets ? listTeamContributions(200) : Promise.resolve([]),
      ]);

      const volById = new Map(volumes.map((v) => [v.id, v]));
      const chById = new Map(chapters.map((c) => [c.id, c]));

      const bookMatches = units
        .filter((u) => {
          if (u.lifecycleStatus !== 'active' || u.verificationStatus === 'rejected') return false;
          const chTitle = chById.get(u.chapterId)?.title || '';
          const volTitle = volById.get(u.volumeId)?.title || '';
          const haystack = `${volTitle} ${chTitle} ${u.cleanText} ${u.canonicalEntityId || ''}`.toLowerCase();
          return haystack.includes(qLower);
        })
        .slice(0, 40)
        .map((u) => ({
          unitId: u.id,
          volumeId: u.volumeId,
          volumeTitle: volById.get(u.volumeId)?.title || 'کتاب مرجع',
          chapterId: u.chapterId,
          chapterTitle: chById.get(u.chapterId)?.title || 'فصل مرجع',
          excerpt: u.cleanText.slice(0, 280),
          domainTag: u.domainTag,
          evidenceTier: u.evidenceTier,
          canonicalEntityId: u.canonicalEntityId,
        }));

      const assetMatches = assets
        .filter((a) => {
          const hay = [
            a.fileName,
            a.fileExtension,
            a.vehicleModel || '',
            a.ecuModel || '',
            a.mapList || '',
            a.driveFolderPath || '',
            a.uploaderDisplayName,
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(qLower);
        })
        .slice(0, 40)
        .map((a) => ({
          ...a,
          uploaderEmail: maskEmailForViewer(a.uploaderEmail, isGuestViewer),
        }));

      const contributionMatches = contributions
        .filter((c) => {
          const hay = [
            c.fileName,
            c.vehicleModel || '',
            c.ecuModel || '',
            c.mapList || '',
            c.detectedVolumeTitle,
            c.uploaderDisplayName,
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(qLower);
        })
        .slice(0, 30)
        .map((c) => ({
          ...c,
          uploaderEmail: maskEmailForViewer(c.uploaderEmail, isGuestViewer),
        }));

      res.json({
        query: q,
        bookMatches,
        assetMatches,
        contributionMatches,
      });
    } catch (err) {
      console.error('[CollabRoutes] GET /search error:', err);
      res.status(500).json({ error: 'خطا در جستجوی سراسری دیتابیس خودرو.' });
    }
  });

  // --------------------------------------------------------------------------
  // 7. TEAM LEADERBOARD & BADGES
  // --------------------------------------------------------------------------
  router.get('/leaderboard', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isGuestViewer = Boolean(user.isGuest) && !isAdminUser(user);
      const contributions = await listTeamContributions(500);
      const leaderboard = computeTeamLeaderboard(contributions).map((entry) => ({
        ...entry,
        email: maskEmailForViewer(entry.email, isGuestViewer),
        uploaderKey: entry.uploaderKey.includes('@')
          ? maskEmailForViewer(entry.uploaderKey, isGuestViewer)
          : entry.uploaderKey,
      }));
      res.json({
        leaderboard,
        totalContributions: contributions.length,
        totalScoreDistributed: contributions.reduce((s, c) => s + c.score, 0),
      });
    } catch (err) {
      console.error('[CollabRoutes] GET /leaderboard error:', err);
      res.status(500).json({ error: 'خطا در محاسبه جدول امتیازات تیم.' });
    }
  });

  // --------------------------------------------------------------------------
  // 8. KNOWLEDGE WISHLIST / BOUNTIES
  // --------------------------------------------------------------------------
  router.get('/wishlist', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isGuestViewer = Boolean(user.isGuest) && !isAdminUser(user);
      await ensureStarterWishlist();
      const items = (await listWishlistItems()).map((item) => ({
        ...item,
        createdByEmail: maskEmailForViewer(item.createdByEmail, isGuestViewer),
        fulfilledByEmail: item.fulfilledByEmail
          ? maskEmailForViewer(item.fulfilledByEmail, isGuestViewer)
          : null,
      }));
      res.json({ items });
    } catch (err) {
      console.error('[CollabRoutes] GET /wishlist error:', err);
      res.status(500).json({ error: 'خطا در دریافت لیست نیازهای دیتابیس.' });
    }
  });

  router.post('/wishlist', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      if (user.isGuest) {
        const rate = checkGuestUploadRateLimit(`collab-wishlist:${user.uid}`, 15, 10 * 60 * 1000);
        if (!rate.allowed) {
          res.status(429).json({
            error: `سقف موقت ثبت نیاز جدید پر شده است. لطفاً پس از ${rate.retryAfterSeconds} ثانیه تلاش کنید.`,
          });
          return;
        }
      }

      const identity = resolveUploaderIdentity(user);
      const body = (req.body || {}) as {
        title?: string;
        description?: string;
        domainId?: string;
        vehicleModel?: string;
        ecuModel?: string;
        wantedFormat?: string;
        bonusScore?: number;
      };

      const title = String(body.title || '').trim();
      const description = String(body.description || '').trim().slice(0, 1200);
      if (title.length < 4 || title.length > 200) {
        res.status(400).json({ error: 'عنوان نیاز دیتابیس باید بین ۴ تا ۲۰۰ کاراکتر باشد.' });
        return;
      }

      const rawDomain = String(body.domainId || 'remap_tuning').trim();
      const safeDomain = VALID_WISHLIST_DOMAINS.has(rawDomain) ? rawDomain : 'remap_tuning';
      const rawFormat = String(body.wantedFormat || 'any').trim().toLowerCase();
      const safeFormat = VALID_WISHLIST_FORMATS.has(rawFormat) ? rawFormat : 'any';

      const rawBonus = Number(body.bonusScore);
      const bonusScore = Number.isFinite(rawBonus)
        ? Math.max(10, Math.min(200, Math.round(rawBonus)))
        : 60;

      const created = await createWishlistItem({
        title,
        description: description || 'تکمیل این بخش باعث ارتقای دقت کتاب مرجع خودرو می‌شود.',
        domainId: safeDomain,
        vehicleModel: body.vehicleModel?.trim().slice(0, 120) || null,
        ecuModel: body.ecuModel?.trim().slice(0, 120) || null,
        wantedFormat: safeFormat,
        bonusScore,
        createdByEmail: identity.uploaderEmail,
      });

      const isGuestViewer = Boolean(user.isGuest) && !isAdminUser(user);
      res.status(201).json({
        ok: true,
        item: {
          ...created,
          createdByEmail: maskEmailForViewer(created.createdByEmail, isGuestViewer),
        },
      });
    } catch (err) {
      console.error('[CollabRoutes] POST /wishlist error:', err);
      res.status(500).json({ error: 'خطا در ثبت نیاز جدید دیتابیس.' });
    }
  });

  router.delete('/wishlist/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      await deleteWishlistItem(String(req.params.id || '').trim());
      res.json({ ok: true });
    } catch (err) {
      console.error('[CollabRoutes] DELETE /wishlist error:', err);
      res.status(500).json({ error: 'خطا در حذف مورد از لیست نیازها.' });
    }
  });

  // --------------------------------------------------------------------------
  // 9. INTERNAL GOOGLE DRIVE INDEX & BROWSER DATA
  // --------------------------------------------------------------------------
  router.get('/drive-index', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();

      if (!canAccessResource(settings.accessDrive, user, isOwner)) {
        res.status(403).json({
          error: 'دسترسی به مرورگر Google Drive بر اساس تنظیمات مالک برای سطح کاربری شما محدود شده است.',
          code: 'RESOURCE_ACCESS_RESTRICTED',
        });
        return;
      }

      const q = String(req.query.q || '').trim().toLowerCase();
      const format = String(req.query.format || 'all').trim().toLowerCase();
      const vehicle = String(req.query.vehicle || '').trim().toLowerCase();
      const ecu = String(req.query.ecu || '').trim().toLowerCase();
      const domain = String(req.query.domain || 'all').trim().toLowerCase();
      const isGuestViewer = Boolean(user.isGuest) && !isOwner;

      const allAssets = await listTeamUploadedAssets(300);
      const filtered = allAssets
        .filter((a) => {
          if (format !== 'all' && a.fileCategory !== format && a.fileExtension !== format) {
            return false;
          }
          if (domain !== 'all' && a.domainId !== domain) return false;
          if (vehicle && !(a.vehicleModel || '').toLowerCase().includes(vehicle)) return false;
          if (ecu && !(a.ecuModel || '').toLowerCase().includes(ecu)) return false;
          if (q) {
            const hay = `${a.fileName} ${a.vehicleModel || ''} ${a.ecuModel || ''} ${a.mapList || ''} ${a.driveFolderPath || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        .map((a) => ({
          ...a,
          uploaderEmail: maskEmailForViewer(a.uploaderEmail, isGuestViewer),
        }));

      res.json({
        assets: filtered,
        totalCount: allAssets.length,
        driveRootFolderId: settings.driveRootFolderId,
        driveRootFolderName: settings.driveRootFolderName,
      });
    } catch (err) {
      console.error('[CollabRoutes] GET /drive-index error:', err);
      res.status(500).json({ error: 'خطا در بارگذاری فهرست فایل‌های درایو.' });
    }
  });

  // --------------------------------------------------------------------------
  // 10. INTERNAL GOOGLE SHEETS CONTRIBUTION LOG & REPORT
  // --------------------------------------------------------------------------
  router.get('/sheets-report', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthRequest).user!;
      const isOwner = isAdminUser(user);
      const settings = await getPlatformSettings();

      if (!canAccessResource(settings.accessSheets, user, isOwner)) {
        res.status(403).json({
          error: 'دسترسی به گزارش Google Sheets بر اساس تنظیمات مالک برای سطح کاربری شما محدود شده است.',
          code: 'RESOURCE_ACCESS_RESTRICTED',
        });
        return;
      }

      const isGuestViewer = Boolean(user.isGuest) && !isOwner;
      const contributions = await listTeamContributions(300);
      const rows = contributions.map((c) => {
        const maskedContribution = isGuestViewer
          ? { ...c, uploaderEmail: maskEmailForViewer(c.uploaderEmail, true) }
          : c;
        return {
          contributionId: c.id,
          uploaderUid: c.uploaderUid,
          canSyncRow: isOwner || c.uploaderUid === user.uid,
          sheetSynced: c.sheetSynced,
          status: c.status,
          score: c.score,
          newPercent: c.newPercent,
          duplicatePercent: c.duplicatePercent,
          driveWebViewLink: c.driveWebViewLink,
          cells: buildContributionSheetRow(maskedContribution),
        };
      });

      const acceptedCount = contributions.filter(
        (c) => c.status === 'added' || c.status === 'partial_merge'
      ).length;
      const avgNewPercent =
        contributions.length > 0
          ? Math.round(
              contributions.reduce((s, c) => s + c.newPercent, 0) / contributions.length
            )
          : 0;

      res.json({
        headers: [...CONTRIBUTION_SHEET_HEADERS],
        rows,
        summary: {
          totalRows: contributions.length,
          acceptedCount,
          winolsCount: contributions.filter(
            (c) => c.fileCategory === 'ols' || c.fileCategory === 'kp'
          ).length,
          avgNewPercent,
          pendingSyncCount: contributions.filter((c) => !c.sheetSynced).length,
        },
        spreadsheet: {
          spreadsheetId: settings.sheetsSpreadsheetId,
          spreadsheetUrl: settings.sheetsSpreadsheetUrl,
          tabName: settings.sheetsTabName,
        },
        isOwner,
      });
    } catch (err) {
      console.error('[CollabRoutes] GET /sheets-report error:', err);
      res.status(500).json({ error: 'خطا در بارگذاری جدول گزارش مشارکت‌ها.' });
    }
  });

  // --------------------------------------------------------------------------
  // 11. OWNER CONTROL PANEL (STRICTLY OWNER ONLY)
  // --------------------------------------------------------------------------
  router.get('/owner/settings', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const settings = await getPlatformSettings();
      res.json({ settings });
    } catch (err) {
      console.error('[CollabRoutes] GET /owner/settings error:', err);
      res.status(500).json({ error: 'خطا در دریافت تنظیمات مالک.' });
    }
  });

  router.patch('/owner/settings', requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Partial<{
        enableUserPersonalOutput: boolean;
        accessLibrary: AccessLevel;
        accessDrive: AccessLevel;
        accessDocs: AccessLevel;
        accessSheets: AccessLevel;
        driveRootFolderId: string | null;
        driveRootFolderName: string;
        sheetsSpreadsheetId: string | null;
        sheetsSpreadsheetUrl: string | null;
        sheetsTabName: string;
      }>;

      const patch: Record<string, unknown> = {};
      if (typeof body.enableUserPersonalOutput === 'boolean') {
        patch.enableUserPersonalOutput = body.enableUserPersonalOutput;
      }
      if (body.accessLibrary && VALID_ACCESS_LEVELS.has(body.accessLibrary)) {
        patch.accessLibrary = body.accessLibrary;
      }
      if (body.accessDrive && VALID_ACCESS_LEVELS.has(body.accessDrive)) {
        patch.accessDrive = body.accessDrive;
      }
      if (body.accessDocs && VALID_ACCESS_LEVELS.has(body.accessDocs)) {
        patch.accessDocs = body.accessDocs;
      }
      if (body.accessSheets && VALID_ACCESS_LEVELS.has(body.accessSheets)) {
        patch.accessSheets = body.accessSheets;
      }
      if (body.driveRootFolderId !== undefined) {
        if (
          body.driveRootFolderId !== null &&
          String(body.driveRootFolderId).trim() !== '' &&
          !isValidGoogleResourceId(body.driveRootFolderId)
        ) {
          res.status(400).json({ error: 'شناسه پوشه ریشه Google Drive معتبر نیست.' });
          return;
        }
        patch.driveRootFolderId = body.driveRootFolderId ? String(body.driveRootFolderId).trim() : null;
      }
      if (typeof body.driveRootFolderName === 'string' && body.driveRootFolderName.trim()) {
        patch.driveRootFolderName = body.driveRootFolderName.trim().slice(0, 120);
      }
      if (body.sheetsSpreadsheetId !== undefined) {
        if (
          body.sheetsSpreadsheetId !== null &&
          String(body.sheetsSpreadsheetId).trim() !== '' &&
          !isValidGoogleResourceId(body.sheetsSpreadsheetId)
        ) {
          res.status(400).json({ error: 'شناسه سند Google Sheets معتبر نیست.' });
          return;
        }
        patch.sheetsSpreadsheetId = body.sheetsSpreadsheetId
          ? String(body.sheetsSpreadsheetId).trim()
          : null;
      }
      if (body.sheetsSpreadsheetUrl !== undefined) {
        patch.sheetsSpreadsheetUrl = sanitizeExternalWorkspaceUrl(body.sheetsSpreadsheetUrl);
      }
      if (typeof body.sheetsTabName === 'string' && body.sheetsTabName.trim()) {
        patch.sheetsTabName = body.sheetsTabName.trim().slice(0, 80);
      }

      const updated = await updatePlatformSettings(patch);
      res.json({ ok: true, settings: updated });
    } catch (err) {
      console.error('[CollabRoutes] PATCH /owner/settings error:', err);
      res.status(500).json({ error: 'خطا در ذخیره تنظیمات مالک.' });
    }
  });

  return router;
}
