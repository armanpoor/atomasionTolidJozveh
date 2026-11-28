import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type, type FunctionDeclaration } from '@google/genai';
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { guardPersonalProjectAiRoutes } from '../middleware/personalOutputGuard.ts';
import {
  AUTOMOTIVE_REJECTION_MESSAGE_FA,
  evaluateAutomotiveGatekeeperLayer0,
} from '../lib/masterEncyclopedia/automotiveGatekeeper.ts';
import { alignPostAsrAutomotiveTerms } from '../lib/masterEncyclopedia/multimodalExtractors.ts';
import { isMasterEncyclopediaEnabled } from '../lib/masterEncyclopedia/featureFlag.ts';
import { enqueueAutomotiveDocumentForEncyclopediaIsolated } from './masterEncyclopediaRoutes.ts';
import {
  clearProjectPipelineArtifacts,
  createProjectRecord,
  createProjectRevisionRecord,
  deleteProjectRecord,
  getOwnedProject,
  getProjectBundle,
  getProjectRevisionWithSnapshot,
  insertContentUnitRecord,
  insertSourceFileWithUnits,
  listProjectRevisions,
  listUserProjects,
  reassignUnitsOutlineNodeByPreviousNode,
  replaceProjectConflicts,
  restoreProjectFromRevisionSnapshot,
  saveAuditReportRecord,
  saveDedupResults,
  saveOutlineNodesForProject,
  updateConflictRecord,
  updateContentUnitOutlineNode,
  updateOutlineNodesOrderAndApproval,
  updateOutlineNodeWebEnrichment,
  updateProjectRecord,
} from '../db/repository.ts';
import {
  buildRevisionSnapshotPayload,
  isValidRevisionSnapshot,
  type RevisionActionType,
  type RevisionActorType,
} from '../lib/changeLogUtils.ts';
import {
  type ChatProposal,
  type ConflictDto,
  DEFAULT_DOCX_CONFIG,
  type DeepReviewFinding,
  type DeepReviewReportDto,
  type DocxExportConfig,
  type FileRole,
  type GoogleSearchMode,
  type OutlineNodeDto,
  type ParsedBook,
  type SourceFileFormat,
  type ValidationDomain,
  type WebGroundingSource,
  type WorkflowMode,
} from '../lib/bookTypes.ts';
import { detectFileFormat, exportBookToMarkdown, parseAnySourceFile, toPersianDigits } from '../lib/formatParsers.ts';
import {
  type FilePreprocessReport,
  preprocessIncomingSourceFile,
} from '../lib/filePreprocessEngine.ts';
import {
  assembleFinalBookAndAudit,
  buildInitialOutline,
  computeJaccardSimilarity,
  type DedupPipelineOutput,
  deterministicHash,
  extractAtomicUnitsFromBook,
  isGenuineNumericConflict,
  normalizePersianForComparison,
  runDeterministicLosslessDedup,
  tokenizeContent,
} from '../lib/zeroLossPipeline.ts';
import {
  buildQuickDraftStructure,
  type QuickDraftStrategy,
} from '../lib/quickDraftBuilder.ts';
import {
  buildEditorialSystemDirective,
  extractWinolsMapGuides,
} from '../lib/winolsMapGuide.ts';
import {
  buildStage5ComparativePieChartData,
  computeStage5QualityMetrics,
} from '../lib/stage5QualityMetrics.ts';
import {
  type AiUsageDelta,
  extractAiUsageFromCheckpoint,
  mergeAiUsageDelta,
} from '../lib/aiUsageMetrics.ts';
import {
  getGoogleModelMeta,
  normalizeGoogleModelId,
  normalizeProviderType,
} from '../lib/aiProviderConfig.ts';
import {
  buildAntiDriftContract,
  buildCompactChapterDigestsWire,
  buildCompactChatContextWire,
  buildCompactConflictBatchWire,
  buildCompactOutlineWire,
  extractEntityPreservingExcerpt,
  extractTechnicalFactLedger,
  getBudgetForOptimizationMode,
  sanitizeInventedHexInText,
  type TokenOptimizationMode,
  validateDeepReviewOutput,
  validateOutlineRefinementOutput,
} from '../lib/tokenOptimizer.ts';
import {
  buildAiTaskCacheKey,
  callNonGoogleChatWithFallback,
  checkHardCostCap,
  createGoogleGenAiClient,
  executeUnifiedWebSearch,
  executeWithGoogleClientFallback,
  generateGoogleContentResilient,
  generateUnifiedTextOrJson,
  getCachedAiTaskResult,
  isNonGoogleProvider,
  probeProviderModelsLive,
  probeProviderWithCreatorFallback,
  type ProviderToolDefinition,
  type ResolvedServerAiProvider,
  resolveAiProviderFromRequest,
  resolveAudioRouteFromRequest,
  resolveProviderForTaskFromRequest,
  resolveThinkingLevelForGoogleModel,
  resolveWebSearchRouteFromRequest,
  setCachedAiTaskResult,
  transcribeAudioUnified,
} from './aiProvider.ts';
import {
  approveHarnessBlueprintForProject,
  executeHarnessStepForProject,
  initHarnessBlueprintForProject,
  resolveHarnessQuarantineItem,
  retryQuarantinedSectionForProject,
  syncHarnessToBookSnapshot,
} from './harnessOrchestrator.ts';
import { extractHarnessStateFromCheckpoint } from '../lib/harness/harnessStore.ts';
import {
  HarnessRunAbortedError,
  HarnessStepConflictError,
} from '../lib/harness/orchestrationGuard.ts';
import { resolveProviderCapabilityProfile } from '../lib/harness/providerGuard.ts';

export function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return createGoogleGenAiClient(apiKey);
}

function resolveThinkingLevel(model: string, levelRaw?: string): ThinkingLevel {
  return resolveThinkingLevelForGoogleModel(model, levelRaw);
}

function extractGroundingSources(response: unknown): WebGroundingSource[] {
  const sources: WebGroundingSource[] = [];
  const seen = new Set<string>();
  const resp = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = resp?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri?.trim();
    const title = ch?.web?.title?.trim() || uri || 'منبع وب';
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title, uri });
    }
  }
  return sources;
}

function extractUsageDeltaFromResponse(
  response: unknown,
  opts: {
    modelUsed?: string;
    fallbackPromptChars?: number;
    fallbackOutputChars?: number;
    isGrounding?: boolean;
    isDeepReview?: boolean;
    isChat?: boolean;
  } = {}
): AiUsageDelta {
  const meta = (
    response as {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
      };
    }
  )?.usageMetadata;

  const promptTokens =
    typeof meta?.promptTokenCount === 'number' && meta.promptTokenCount > 0
      ? meta.promptTokenCount
      : Math.ceil((opts.fallbackPromptChars ?? 0) / 3);
  const outputTokens =
    typeof meta?.candidatesTokenCount === 'number' && meta.candidatesTokenCount > 0
      ? meta.candidatesTokenCount
      : Math.ceil((opts.fallbackOutputChars ?? 0) / 3);
  const thinkingTokens =
    typeof meta?.thoughtsTokenCount === 'number' && meta.thoughtsTokenCount > 0
      ? meta.thoughtsTokenCount
      : 0;
  const totalTokens =
    typeof meta?.totalTokenCount === 'number' && meta.totalTokenCount > 0
      ? meta.totalTokenCount
      : promptTokens + outputTokens + thinkingTokens;

  return {
    promptTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
    requestCount: 1,
    groundingCallCount: opts.isGrounding ? 1 : 0,
    deepReviewCount: opts.isDeepReview ? 1 : 0,
    chatCallCount: opts.isChat ? 1 : 0,
    modelUsed: opts.modelUsed,
  };
}

async function recordProjectAiUsage(
  projectId: string,
  ownerUid: string,
  delta: AiUsageDelta
) {
  try {
    const fresh = await getProjectBundle(projectId, ownerUid);
    if (!fresh) return null;
    const prevCheckpoint = (fresh.project.checkpointJson || {}) as Record<string, unknown>;
    const existing = extractAiUsageFromCheckpoint(prevCheckpoint);
    const updated = mergeAiUsageDelta(existing, delta);
    await updateProjectRecord(projectId, ownerUid, {
      checkpointJson: {
        ...prevCheckpoint,
        aiUsage: updated,
      },
    });
    return updated;
  } catch (err) {
    console.warn('[AI Usage ledger persist warning]:', err);
    return null;
  }
}

async function recordProjectRevision(params: {
  projectId: string;
  ownerUid: string;
  actorType: RevisionActorType;
  actorName: string;
  actionType: RevisionActionType;
  title: string;
  summary: string;
  extraDetails?: Record<string, unknown>;
  captureSnapshot?: boolean;
}) {
  try {
    const fresh = await getProjectBundle(params.projectId, params.ownerUid);
    if (!fresh) return null;

    const openConflictsCount = fresh.conflicts.filter((c) => c.status === 'open').length;
    const snapshot =
      params.captureSnapshot === false
        ? null
        : (buildRevisionSnapshotPayload({
            project: {
              title: fresh.project.title,
              workflowMode: fresh.project.workflowMode,
              pipelineStage: fresh.project.pipelineStage,
              status: fresh.project.status,
              settingsJson: (fresh.project.settingsJson as Record<string, unknown> | null) ?? null,
              checkpointJson: (fresh.project.checkpointJson as Record<string, unknown> | null) ?? null,
              bookSnapshotJson:
                (fresh.project.bookSnapshotJson as Record<string, unknown> | null) ?? null,
            },
            outlineNodes: fresh.outlineNodes.map((n) => ({
              id: n.id,
              parentId: n.parentId,
              level: n.level,
              nodeOrder: n.nodeOrder,
              title: n.title,
              summary: n.summary,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            })),
            contentUnits: fresh.contentUnits.map((u) => ({
              id: u.id,
              status: u.status,
              canonicalUnitId: u.canonicalUnitId,
              outlineNodeId: u.outlineNodeId,
              rawText: u.rawText,
            })),
            conflicts: fresh.conflicts.map((c) => ({
              id: c.id,
              status: c.status,
              resolutionNote: c.resolutionNote,
              webGroundingJson: (c.webGroundingJson as Record<string, unknown> | null) ?? null,
            })),
          }) as unknown as Record<string, unknown>);

    const detailsJson: Record<string, unknown> = {
      chaptersCount: fresh.outlineNodes.length,
      unitsCount: fresh.contentUnits.length,
      conflictsCount: fresh.conflicts.length,
      openConflictsCount,
      pipelineStage: fresh.project.pipelineStage,
      hasBookSnapshot: Boolean(fresh.project.bookSnapshotJson),
      ...(params.extraDetails || {}),
    };

    return await createProjectRevisionRecord({
      id: `rev_${crypto.randomBytes(6).toString('hex')}`,
      projectId: params.projectId,
      actorType: params.actorType,
      actorName: params.actorName,
      actionType: params.actionType,
      title: params.title,
      summary: params.summary,
      detailsJson,
      snapshotJson: snapshot,
    });
  } catch (err) {
    console.warn('[Project revision log warning]:', err);
    return null;
  }
}

function formatRevisionRowForClient(row: {
  id: string;
  projectId: string;
  versionNumber: number;
  actorType: string;
  actorName: string;
  actionType: string;
  title: string;
  summary: string;
  detailsJson: Record<string, unknown> | null;
  hasSnapshot?: boolean;
  snapshotJson?: Record<string, unknown> | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    versionNumber: row.versionNumber,
    actorType: row.actorType,
    actorName: row.actorName,
    actionType: row.actionType,
    title: row.title,
    summary: row.summary,
    details: row.detailsJson || {},
    hasSnapshot:
      typeof row.hasSnapshot === 'boolean' ? row.hasSnapshot : Boolean(row.snapshotJson),
    createdAt: row.createdAt.toISOString(),
  };
}

function safeParseGeminiJson<T>(rawText: string | undefined, fallback: T): T {
  const cleaned = (rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return fallback;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function formatGeminiError(err: unknown, fallbackMessage: string): { statusCode: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || '');
  const upper = raw.toUpperCase();

  let parsedCode: number | undefined;
  let parsedStatus = '';
  let parsedMessage = '';
  if (raw.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as {
        error?: { code?: number; status?: string; message?: string };
      };
      parsedCode = obj?.error?.code;
      parsedStatus = String(obj?.error?.status || '').toUpperCase();
      parsedMessage = String(obj?.error?.message || '').trim();
    } catch {
      // ignore non-JSON parse errors
    }
  }

  const combinedUpper = `${upper} ${parsedStatus}`;

  if (
    parsedCode === 429 ||
    combinedUpper.includes('429') ||
    combinedUpper.includes('RESOURCE_EXHAUSTED') ||
    combinedUpper.includes('EXCEEDED YOUR CURRENT QUOTA')
  ) {
    return {
      statusCode: 429,
      message:
        'سهمیه مجاز درخواست‌های Gemini API در پلن رایگان کلید متصل به پروژه پر شده است (خطای 429 RESOURCE_EXHAUSTED). لطفاً ۱ تا ۲ دقیقه دیگر مجدداً تلاش کنید یا از بخش Settings > Secrets یک کلید API دارای Billing فعال متصل کنید.',
    };
  }
  if (
    parsedCode === 503 ||
    combinedUpper.includes('503') ||
    combinedUpper.includes('UNAVAILABLE') ||
    combinedUpper.includes('OVERLOADED')
  ) {
    return {
      statusCode: 503,
      message:
        'سرویس هوش مصنوعی Gemini موقتاً شلوغ است (خطای 503). لطفاً ۳۰ ثانیه دیگر دوباره تلاش کنید.',
    };
  }
  if (
    parsedCode === 504 ||
    combinedUpper.includes('504') ||
    combinedUpper.includes('DEADLINE_EXCEEDED') ||
    combinedUpper.includes('TIMEOUT')
  ) {
    return {
      statusCode: 504,
      message:
        'زمان پردازش درخواست هوش مصنوعی به پایان رسید (Timeout). لطفاً دوباره تلاش کنید؛ سیستم به‌طور خودکار از سطح استدلال بهینه‌تر استفاده خواهد کرد.',
    };
  }
  if (
    parsedCode === 403 ||
    combinedUpper.includes('403') ||
    combinedUpper.includes('PERMISSION_DENIED') ||
    combinedUpper.includes('API_KEY_INVALID')
  ) {
    return {
      statusCode: 403,
      message:
        'کلید Gemini API معتبر نیست یا دسترسی لازم را ندارد (خطای 403). لطفاً کلید متصل در بخش Settings > Secrets را بررسی کنید.',
    };
  }
  if (parsedCode === 404 || combinedUpper.includes('404') || combinedUpper.includes('NOT_FOUND')) {
    return {
      statusCode: 404,
      message: 'مدل انتخاب‌شده در دسترس نیست (خطای 404). لطفاً مدل Gemini 4 Hydrogen را انتخاب کنید.',
    };
  }
  if (parsedCode === 400 || combinedUpper.includes('INVALID_ARGUMENT')) {
    return {
      statusCode: 400,
      message: parsedMessage
        ? `خطای پارامتر درخواست به Gemini API (کد 400): ${parsedMessage.slice(0, 180)}`
        : `${fallbackMessage} (کد 400)`,
    };
  }

  return {
    statusCode: 500,
    message: parsedMessage
      ? `${fallbackMessage} (${parsedMessage.slice(0, 180)})`
      : raw && !raw.trim().startsWith('{')
        ? raw
        : fallbackMessage,
  };
}

async function generateWithGroundingFallback(
  ai: GoogleGenAI,
  prompt: string,
  thinkingLevel: ThinkingLevel = ThinkingLevel.LOW,
  preferredModel = 'gemini-4-hydrogen'
) {
  const primary = normalizeGoogleModelId(preferredModel);
  const secondary = primary === 'gemini-4-hydrogen' ? 'gemini-3.8-flash' : 'gemini-4-hydrogen';
  try {
    const out = await generateGoogleContentResilient({
      ai,
      model: primary,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: resolveThinkingLevel(primary, thinkingLevel) },
      },
    });
    return out.response;
  } catch (primaryErr) {
    const raw = primaryErr instanceof Error ? primaryErr.message : String(primaryErr || '');
    const isQuotaOrBusy =
      raw.includes('429') ||
      raw.includes('503') ||
      raw.toUpperCase().includes('RESOURCE_EXHAUSTED') ||
      raw.toUpperCase().includes('UNAVAILABLE') ||
      raw.toUpperCase().includes('QUOTA');
    if (!isQuotaOrBusy) throw primaryErr;

    await new Promise((r) => setTimeout(r, 1200));
    const fallbackOut = await generateGoogleContentResilient({
      ai,
      model: secondary,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    return fallbackOut.response;
  }
}

/**
 * Layer 2 Semantic Conflict Verification:
 * Runs a single batched AI call over Layer-1 candidate conflicts to eliminate any remaining
 * complementary / parallel / elaboration / distinct-condition false positives.
 * Supports both Google AI Studio (creator or personal key) and Custom OpenAI-compatible providers.
 */
async function verifyConflictsWithAi(
  provider: ResolvedServerAiProvider | null,
  candidates: DedupPipelineOutput['conflicts'],
  preferredGoogleModel = 'gemini-4-hydrogen',
  options?: {
    optimizationMode?: TokenOptimizationMode;
    enablePromptCaching?: boolean;
    enableResponseCache?: boolean;
  }
): Promise<{
  verified: DedupPipelineOutput['conflicts'];
  aiVerified: boolean;
  usageDelta: AiUsageDelta | null;
}> {
  if (!provider || candidates.length === 0) {
    return { verified: candidates, aiVerified: false, usageDelta: null };
  }
  if (provider.validationError || !provider.apiKey) {
    return { verified: candidates, aiVerified: false, usageDelta: null };
  }

  const optMode = options?.optimizationMode || 'balanced_pro';
  const wire = buildCompactConflictBatchWire(
    candidates.map((c) => ({
      id: c.id,
      topic: c.topic,
      excerptA: c.excerptA,
      excerptB: c.excerptB,
    })),
    optMode
  );

  const systemInstruction = [
    'شما ممیز ارشد دقیق اسناد فنی ریمپ و کالیبراسیون ECU هستید.',
    'برای هر نامزد با سخت‌گیری کامل بررسی کن آیا دو متن واقعاً **تضاد منطقی یا عددی ناسازگار درباره دقیقاً یک موضوع و یک شرط یکسان** دارند (isRealConflict: true) یا فقط **مکمل، ردیف‌های موازی، مثال متفاوت یا دو شرط مختلف** هستند (isRealConflict: false).',
    'خروجی حتماً JSON معتبر با کلید results (آرایه‌ای از {id, isRealConflict, shortReason}) باشد.',
  ].join('\n');

  const prompt = `نامزدهای احتمالی تناقض:\n${wire.wireText}`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            isRealConflict: { type: Type.BOOLEAN },
            shortReason: { type: Type.STRING },
          },
          required: ['id', 'isRealConflict'],
        },
      },
    },
    required: ['results'],
  };

  const activeModelId = isNonGoogleProvider(provider)
    ? provider.customModelId
    : normalizeGoogleModelId(preferredGoogleModel);

  // Deterministic prompt-hash LRU cache -> 0 tokens on repeated runs!
  const cacheKey = buildAiTaskCacheKey(['conflict_triage', activeModelId, wire.wireText]);
  if (options?.enableResponseCache !== false) {
    const cached = getCachedAiTaskResult(cacheKey);
    if (cached) {
      const parsedCached = safeParseGeminiJson<{
        results?: Array<{ id?: string; isRealConflict?: boolean; shortReason?: string }>;
      }>(cached.text, {});
      if (Array.isArray(parsedCached.results) && parsedCached.results.length > 0) {
        const verdictById = new Map(parsedCached.results.map((r) => [String(r.id || ''), r]));
        const verified = candidates.filter((c) => {
          const v = verdictById.get(c.id);
          return v ? v.isRealConflict === true : true;
        });
        return {
          verified,
          aiVerified: true,
          usageDelta: {
            promptTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            requestCount: 0,
            savedTokensByOptimization: cached.savedPromptTokens + wire.estimatedTokensSaved,
            cachedCallHit: true,
            modelUsed: cached.modelUsed,
          },
        };
      }
    }
  }

  const attempts: Array<{ model: string; level: ThinkingLevel }> =
    isNonGoogleProvider(provider)
      ? [{ model: provider.customModelId, level: ThinkingLevel.LOW }]
      : [
          { model: normalizeGoogleModelId(preferredGoogleModel), level: ThinkingLevel.LOW },
          {
            model:
              normalizeGoogleModelId(preferredGoogleModel) === 'gemini-4-hydrogen'
                ? 'gemini-3.8-flash'
                : 'gemini-4-hydrogen',
            level: ThinkingLevel.LOW,
          },
        ];

  for (const attempt of attempts) {
    try {
      const res = await generateUnifiedTextOrJson({
        provider,
        googleModel: attempt.model,
        thinkingLevel: attempt.level,
        systemInstruction,
        prompt,
        expectJson: true,
        googleResponseSchema: schema,
        enablePromptCaching: options?.enablePromptCaching !== false,
        savedTokensByOptimization: wire.estimatedTokensSaved,
      });
      const parsed = safeParseGeminiJson<{
        results?: Array<{ id?: string; isRealConflict?: boolean; shortReason?: string }>;
      }>(res.text, {});

      if (Array.isArray(parsed.results) && parsed.results.length > 0) {
        if (options?.enableResponseCache !== false) {
          setCachedAiTaskResult(cacheKey, {
            text: res.text,
            modelUsed: res.modelUsed,
            savedPromptTokens: res.usageDelta.promptTokens || wire.estimatedCompactTokens,
          });
        }
        const verdictById = new Map(parsed.results.map((r) => [String(r.id || ''), r]));
        const verified = candidates.filter((c) => {
          const v = verdictById.get(c.id);
          return v ? v.isRealConflict === true : true;
        });
        return { verified, aiVerified: true, usageDelta: res.usageDelta };
      }
    } catch (err) {
      console.warn(`AI conflict verification attempt (${attempt.model}) skipped:`, err);
    }
  }

  return { verified: candidates, aiVerified: false, usageDelta: null };
}

function buildChapterExcerpt(
  units: Array<{ outlineNodeId: string | null; status: string; rawText: string }>,
  nodeId: string,
  maxChars = 2200
): string {
  return extractEntityPreservingExcerpt(units, nodeId, maxChars);
}

function formatBundleForClient(bundle: NonNullable<Awaited<ReturnType<typeof getProjectBundle>>>) {
  const unitCountsByFile = new Map<string, number>();
  for (const u of bundle.contentUnits) {
    unitCountsByFile.set(u.sourceFileId, (unitCountsByFile.get(u.sourceFileId) || 0) + 1);
  }

  return {
    project: {
      ...bundle.project,
      createdAt: bundle.project.createdAt.toISOString(),
      updatedAt: bundle.project.updatedAt.toISOString(),
    },
    sourceFiles: bundle.sourceFiles.map((f) => {
      const meta = (f.metadataJson || {}) as Record<string, unknown>;
      return {
        ...f,
        fileRole: f.role,
        checksum: f.fileHash,
        unitCount: Number(meta.unitCount ?? unitCountsByFile.get(f.id) ?? 0),
        uploadedAt: f.uploadedAt.toISOString(),
      };
    }),
    contentUnits: bundle.contentUnits.map((u) => {
      const payload = (u.payloadJson || {}) as Record<string, unknown>;
      return {
        ...u,
        headingPath: String(payload.headingPath ?? ''),
        normalizedHash: u.contentHash,
        metadataJson: payload,
      };
    }),
    dedupClusters: bundle.dedupClusters.map((c) => {
      const details = (c.preservedDetailsJson || {}) as Record<string, unknown>;
      const mergedUnitIds = Array.isArray(details.mergedUnitIds)
        ? details.mergedUnitIds.map(String)
        : [c.mergedUnitId];
      return {
        ...c,
        mergedUnitIds,
        losslessSummary: c.mergeRationale ?? null,
      };
    }),
    conflicts: bundle.conflicts.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    outlineNodes: bundle.outlineNodes,
    auditReport: bundle.auditReport
      ? {
          ...bundle.auditReport,
          uniqueUnitsPreserved: bundle.auditReport.uniqueUnitsCount,
          duplicatesMerged: bundle.auditReport.mergedDuplicatesCount,
          conflictsDetected: bundle.auditReport.conflictsCount,
          conflictsResolved: Number(
            ((bundle.auditReport.sourceTraceJson || {}) as Record<string, unknown>).conflictsResolved ?? 0
          ),
          detailsJson: bundle.auditReport.sourceTraceJson ?? null,
          generatedAt: bundle.auditReport.generatedAt.toISOString(),
        }
      : null,
  };
}

const CHAT_EDITOR_TOOLS_SPEC: ProviderToolDefinition[] = [
  {
    name: 'rename_chapter',
    description: 'تغییر عنوان یکی از فصل‌های سند در ساختار فصل‌بندی.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'شناسه دقیق فصل (مثلاً node_...)' },
        newTitle: { type: 'string', description: 'عنوان جدید فارسی فصل' },
      },
      required: ['nodeId', 'newTitle'],
    },
  },
  {
    name: 'move_chapter',
    description: 'جابه‌جایی ترتیب یک فصل به موقعیت جدید (شروع از ۱).',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'شناسه فصل' },
        targetOrder: { type: 'integer', description: 'شماره ترتیب جدید از ۱ تا تعداد فصل‌ها' },
      },
      required: ['nodeId', 'targetOrder'],
    },
  },
  {
    name: 'split_chapter',
    description: 'تقسیم یک فصل شلوغ به دو فصل مجزا بدون حذف هیچ محتوایی.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'شناسه فصل مبدأ' },
        newChapterTitle: { type: 'string', description: 'عنوان فصل دوم جدید' },
      },
      required: ['nodeId', 'newChapterTitle'],
    },
  },
  {
    name: 'add_callout_box',
    description: 'افزودن یک باکس نکته، هشدار، جمع‌بندی یا نکته مهندسی به یک فصل مشخص.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'شناسه فصل مقصد' },
        variant: {
          type: 'string',
          description: 'یکی از: concept | warning | engineering | project | qa',
        },
        title: { type: 'string', description: 'عنوان باکس نکته' },
        body: { type: 'string', description: 'متن فارسی داخل باکس' },
      },
      required: ['nodeId', 'title', 'body'],
    },
  },
  {
    name: 'add_comparison_table',
    description: 'ایجاد و درج یک جدول مقایسه‌ای ساختاریافته در فصل انتخاب‌شده.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'شناسه فصل مقصد' },
        caption: { type: 'string', description: 'عنوان جدول' },
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: 'عناوین ستون‌ها',
        },
        rows: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
          description: 'ردیف‌های جدول',
        },
      },
      required: ['nodeId', 'caption', 'headers', 'rows'],
    },
  },
  {
    name: 'insert_dictated_paragraph',
    description: 'افزودن یک پاراگراف یا یادداشت جدید به فصل مشخص‌شده.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'شناسه فصل مقصد' },
        sectionTitle: { type: 'string', description: 'عنوان زیربخش اختیاری' },
        text: { type: 'string', description: 'متن فارسی پاراگراف جدید' },
      },
      required: ['nodeId', 'text'],
    },
  },
];

function buildChatProposalFromToolCall(
  name: ChatProposal['action'],
  args: Record<string, unknown>,
  outlineNodes: Array<{ id: string; title: string }>
): ChatProposal {
  const nodeTitle =
    outlineNodes.find((n) => n.id === args.nodeId)?.title || String(args.nodeId || '');
  let title = 'پیشنهاد ویرایش سند';
  let summary = JSON.stringify(args);
  if (name === 'rename_chapter') {
    title = `تغییر نام فصل به «${String(args.newTitle || '')}»`;
    summary = `عنوان فصل «${nodeTitle}» به «${String(args.newTitle || '')}» تغییر می‌کند.`;
  } else if (name === 'move_chapter') {
    title = `جابه‌جایی فصل «${nodeTitle}» به جایگاه ${toPersianDigits(Number(args.targetOrder || 1))}`;
    summary = `ترتیب فصل «${nodeTitle}» بدون حذف هیچ محتوایی تغییر می‌کند.`;
  } else if (name === 'split_chapter') {
    title = `تقسیم فصل «${nodeTitle}»`;
    summary = `نیمه دوم فصل به فصل جدید «${String(args.newChapterTitle || '')}» منتقل می‌شود.`;
  } else if (name === 'add_callout_box') {
    title = `افزودن باکس نکته: ${String(args.title || '')}`;
    summary = `درج باکس نکته در فصل «${nodeTitle}».`;
  } else if (name === 'add_comparison_table') {
    title = `درج جدول مقایسه‌ای: ${String(args.caption || '')}`;
    summary = `جدول با ${toPersianDigits(Array.isArray(args.rows) ? args.rows.length : 0)} ردیف در فصل «${nodeTitle}» درج می‌شود.`;
  } else if (name === 'insert_dictated_paragraph') {
    title = `درج متن جدید در فصل «${nodeTitle}»`;
    summary = String(args.text || '').slice(0, 140);
  }
  return {
    id: `prop_${crypto.randomBytes(4).toString('hex')}`,
    action: name,
    title,
    summary,
    args,
    applied: false,
  };
}

const CHAT_EDITOR_TOOLS: FunctionDeclaration[] = [
  {
    name: 'rename_chapter',
    description: 'تغییر عنوان یکی از فصل‌های سند در ساختار فصل‌بندی.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه دقیق فصل (مثلاً node_...)' },
        newTitle: { type: Type.STRING, description: 'عنوان جدید فارسی فصل' },
      },
      required: ['nodeId', 'newTitle'],
    },
  },
  {
    name: 'move_chapter',
    description: 'جابه‌جایی ترتیب یک فصل به موقعیت جدید (شروع از ۱).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل' },
        targetOrder: { type: Type.INTEGER, description: 'شماره ترتیب جدید از ۱ تا تعداد فصل‌ها' },
      },
      required: ['nodeId', 'targetOrder'],
    },
  },
  {
    name: 'split_chapter',
    description: 'تقسیم یک فصل شلوغ به دو فصل مجزا بدون حذف هیچ محتوایی.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مبدأ' },
        newChapterTitle: { type: Type.STRING, description: 'عنوان فصل دوم جدید' },
      },
      required: ['nodeId', 'newChapterTitle'],
    },
  },
  {
    name: 'add_callout_box',
    description: 'افزودن یک باکس نکته، هشدار، جمع‌بندی یا نکته مهندسی به یک فصل مشخص.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد' },
        variant: {
          type: Type.STRING,
          description: 'یکی از: concept | warning | engineering | project | qa',
        },
        title: { type: Type.STRING, description: 'عنوان باکس نکته' },
        body: { type: Type.STRING, description: 'متن فارسی داخل باکس' },
      },
      required: ['nodeId', 'title', 'body'],
    },
  },
  {
    name: 'add_comparison_table',
    description: 'ایجاد و درج یک جدول مقایسه‌ای ساختاریافته در فصل انتخاب‌شده.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد' },
        caption: { type: Type.STRING, description: 'عنوان جدول' },
        headers: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'عناوین ستون‌ها',
        },
        rows: {
          type: Type.ARRAY,
          items: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          description: 'ردیف‌های جدول',
        },
      },
      required: ['nodeId', 'caption', 'headers', 'rows'],
    },
  },
  {
    name: 'insert_dictated_paragraph',
    description: 'افزودن یک پاراگراف یا یادداشت جدید به فصل مشخص‌شده.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: { type: Type.STRING, description: 'شناسه فصل مقصد' },
        sectionTitle: { type: Type.STRING, description: 'عنوان زیربخش اختیاری' },
        text: { type: Type.STRING, description: 'متن فارسی پاراگراف جدید' },
      },
      required: ['nodeId', 'text'],
    },
  },
];

async function reassembleAndPersistProject(projectId: string, ownerUid: string) {
  const bundle = await getProjectBundle(projectId, ownerUid);
  if (!bundle) return null;
  const formatted = formatBundleForClient(bundle);
  const rawSettings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
  const config: DocxExportConfig = {
    ...DEFAULT_DOCX_CONFIG,
    ...rawSettings,
    optimization: {
      ...DEFAULT_DOCX_CONFIG.optimization,
      ...(rawSettings.optimization || {}),
    },
  };

  const assembled = assembleFinalBookAndAudit({
    projectId,
    projectTitle: bundle.project.title,
    workflowMode: (bundle.project.workflowMode as WorkflowMode) || 'multi_merge',
    config,
    sourceFiles: formatted.sourceFiles as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['sourceFiles'],
    units: formatted.contentUnits as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['units'],
    clusters: formatted.dedupClusters as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['clusters'],
    conflicts: formatted.conflicts as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['conflicts'],
    outlineNodes: formatted.outlineNodes as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['outlineNodes'],
  });

  const existingMicroRouting = (
    (bundle.auditReport?.sourceTraceJson || {}) as Record<string, unknown>
  ).entityMicroRoutingReport as { totalRoutedExtracts?: number } | undefined;
  const computedMicroRouting = (assembled.audit.detailsJson || {})
    .entityMicroRoutingReport as { totalRoutedExtracts?: number } | undefined;

  await saveAuditReportRecord({
    id: assembled.audit.id,
    projectId: assembled.audit.projectId,
    totalSourceFiles: assembled.audit.totalSourceFiles,
    totalInputUnits: assembled.audit.totalInputUnits,
    uniqueUnitsCount: assembled.audit.uniqueUnitsPreserved,
    mergedDuplicatesCount: assembled.audit.duplicatesMerged,
    conflictsCount: assembled.audit.conflictsDetected,
    coveragePercent: assembled.audit.coveragePercent,
    sourceTraceJson: {
      ...(assembled.audit.detailsJson || {}),
      ...(existingMicroRouting &&
      (existingMicroRouting.totalRoutedExtracts || 0) >=
        (computedMicroRouting?.totalRoutedExtracts || 0)
        ? { entityMicroRoutingReport: existingMicroRouting }
        : {}),
      conflictsResolved: assembled.audit.conflictsResolved,
    },
  });
  await updateProjectRecord(projectId, ownerUid, {
    bookSnapshotJson: assembled.book as unknown as Record<string, unknown>,
    pipelineStage: 5,
    status: 'completed',
  });

  const updated = await getProjectBundle(projectId, ownerUid);
  return updated ? formatBundleForClient(updated) : null;
}

export function createProjectRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(guardPersonalProjectAiRoutes);

  // 0. REAL-TIME LIVE AI QUOTA & PROVIDER AVAILABILITY PROBE
  router.post('/ai-quota-probe', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const body = (req.body || {}) as {
        projectId?: string;
        model?: string;
      };
      const googleModel = normalizeGoogleModelId(body.model);
      const activeProvider = resolveAiProviderFromRequest(req);

      // Run Creator-First live probe with automatic fallback to user's personal key if exhausted/selected
      const [probeOutcome, userProjects] = await Promise.all([
        probeProviderWithCreatorFallback({ provider: activeProvider, googleModel }),
        listUserProjects(user.uid),
      ]);

      let allProjectsTokens = 0;
      let allProjectsRequests = 0;
      let currentProjectTokens = 0;
      let currentProjectRequests = 0;

      for (const proj of userProjects) {
        const usage = extractAiUsageFromCheckpoint(
          (proj.checkpointJson || {}) as Record<string, unknown>
        );
        allProjectsTokens += usage.totalTokens;
        allProjectsRequests += usage.requestCount;
        if (body.projectId && proj.id === body.projectId) {
          currentProjectTokens = usage.totalTokens;
          currentProjectRequests = usage.requestCount;
        }
      }

      const modelMeta = getGoogleModelMeta(googleModel);
      const softBudgetTokens = modelMeta.softBudgetTokens;
      const estimatedRemainingTokens = Math.max(0, softBudgetTokens - currentProjectTokens);
      const estimatedRemainingPercent = Math.max(
        0,
        Math.min(100, Math.round((estimatedRemainingTokens / softBudgetTokens) * 100))
      );

      res.json({
        activeProbe: probeOutcome.activeProbe,
        creatorKeyProbe: probeOutcome.creatorKeyProbe,
        authDecision: probeOutcome.authDecision,
        accountUsage: {
          projectCount: userProjects.length,
          currentProjectTokens,
          currentProjectRequests,
          allProjectsTokens,
          allProjectsRequests,
          estimatedRemainingTokens,
          estimatedRemainingPercent,
          softBudgetTokens,
        },
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در استعلام زنده وضعیت سهمیه هوش مصنوعی.',
      });
    }
  });

  // 0B. LIVE SSRF-SAFE /models DISCOVERY FOR CUSTOM / IRANIAN GATEWAYS & DIRECT PROVIDERS
  router.post('/probe-models', async (req, res) => {
    try {
      const body = (req.body || {}) as {
        provider?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      const provider = normalizeProviderType(body.provider);
      const result = await probeProviderModelsLive({
        provider,
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : 'خطا در دریافت فهرست زنده مدل‌ها از درگاه.',
      });
    }
  });

  // 1. LIST PROJECTS
  router.get('/', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const rows = await listUserProjects(user.uid);
      res.json({
        projects: rows.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در دریافت پروژه‌ها.' });
    }
  });

  // 2. CREATE PROJECT
  router.post('/', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const body = req.body as {
        title?: string;
        workflowMode?: WorkflowMode;
        settingsJson?: Record<string, unknown>;
      };
      const title = (body.title || 'پروژه تدوین و یکپارچه‌سازی جدید').trim().slice(0, 180);
      const validModes = new Set<WorkflowMode>([
        'single_polish',
        'multi_merge',
        'master_update',
        'raw_synthesis',
      ]);
      const workflowMode: WorkflowMode =
        body.workflowMode && validModes.has(body.workflowMode) ? body.workflowMode : 'multi_merge';

      const id = `proj_${crypto.randomBytes(6).toString('hex')}`;
      const created = await createProjectRecord({
        id,
        ownerUid: user.uid,
        title,
        workflowMode,
        settingsJson: {
          ...DEFAULT_DOCX_CONFIG,
          ...(body.settingsJson || {}),
        },
      });

      await recordProjectRevision({
        projectId: created.id,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType: 'project_created',
        title: 'ایجاد پروژه جدید',
        summary: `پروژه «${title}» با حالت پردازش ${workflowMode} ایجاد شد.`,
      });

      const bundle = await getProjectBundle(created.id, user.uid);
      res.status(201).json(bundle ? formatBundleForClient(bundle) : { project: created });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ایجاد پروژه.' });
    }
  });

  // 2B. SEED SAMPLE PROJECT FOR GUEST MODE (Provides immediate Change Log & A4 Print Preview experience)
  router.post('/seed-guest-demo', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      if (!user.isGuest) {
        res.status(403).json({ error: 'این مسیر فقط برای آماده‌سازی میز کار مهمان است.' });
        return;
      }

      const existing = await listUserProjects(user.uid);
      if (existing.length > 0) {
        const existingBundle = await getProjectBundle(existing[0].id, user.uid);
        res.json(existingBundle ? formatBundleForClient(existingBundle) : null);
        return;
      }

      const projectId = `proj_${crypto.randomBytes(6).toString('hex')}`;
      const projectTitle = 'راهنمای جامع کالیبراسیون و عیب‌یابی سیستم سوخت‌رسانی';
      await createProjectRecord({
        id: projectId,
        ownerUid: user.uid,
        title: projectTitle,
        workflowMode: 'multi_merge',
        settingsJson: { ...DEFAULT_DOCX_CONFIG },
      });

      const demoFiles = [
        {
          name: 'فصل_۱_استانداردهای_کالیبراسیون_ME7.4.4.md',
          text: [
            '# فصل ۱: استانداردهای نگهداری سیستم سوخت و کالیبراسیون ME7.4.4',
            '## ۱-۱. فشار ریل، نسبت استوکیومتری و مپ LAMFA',
            'نسبت هوا به سوخت استوکیومتری در موتورهای بنزینی برابر ۱۴.۷ به ۱ (14.7:1) در مپ LAMFA تنظیم می‌شود و در بار کامل (WOT) در دور 3000 تا 6000 RPM برای حفاظت موتور روی 12.5:1 AFR کالیبره می‌گردد.',
            'حداکثر فشار ایمن ریل سوخت در حالت بار کامل برابر ۴ بار اندازه‌گیری شده است.',
            'در ایسیو ME7.4.4 آدرس شروع جدول آوانس جرقه KFZW (ابعاد 12x16) در دامپ استاندارد برابر 0x1A4F0 است و اصلاح ایمن در استیج ۱ در دور 3000 تا 5500 RPM و بار بالای 70% به میزان +2.5° مجاز است.',
            ['|  |', '| --- |', '| **💡 نکته مفهومی و فنی** <br> فیلتر بنزین باید هر ۲۰۰۰۰ کیلومتر تعویض شود تا انژکتورها و پمپ سوخت آسیب نبینند. |'].join('\n'),
            [
              'جدول ۱-۱: پارامترهای مرجع سیستم سوخت‌رسانی و کالیبراسیون',
              '| پارامتر | محدوده استاندارد | واحد |',
              '| --- | --- | --- |',
              '| نسبت استوکیومتری | 14.7:1 | AFR |',
              '| فشار ریل در بار کامل | 4.0 | bar |',
              '| محدوده کات‌آف ME7.4.4 (NMAX) | 6500 | RPM |',
              '| آوانس پایه KFZW در ۳۵۰۰ دور | 18.5 | deg |',
              '| دور آرام گرم | 750 تا 850 | RPM |',
              '| آدرس پایه مپ KFZW | 0x1A4F0 | HEX |',
            ].join('\n'),
            'نمودار منحنی گشتاور موتور TU5 (نسخه مرجع): 2000 RPM = 122 Nm | 3000 RPM = 138 Nm | 4000 RPM = 147 Nm | 5000 RPM = 142 Nm | 6000 RPM = 126 Nm',
            '# فصل ۲: عیب‌یابی سنسور اکسیژن و کدهای خطا',
            'سنسور اکسیژن بالادست وظیفه تنظیم حلقه بسته پاشش سوخت را بر عهده دارد و خطای P0420 به راندمان کاتالیزور مرتبط است.',
            '## ۲-۱. نقشه پین‌اوت سوکت و اتصال Boot-Pin در ایسیو Bosch ME7.4.4',
            'در ایسیو Bosch ME7.4.4 برای خواندن دامپ فلش AM29F400BB با پروگرامر TNM 5000 روی میز کار، ابتدا پین‌اوت تغذیه +12V و GND را طبق نقشه سوکت متصل کرده و پایه ۲۴ آی‌سی فلش (Boot Pin) را با مقاومت ۴.۷ کیلواهم به بدنه وصل کنید تا ارتباط K-Line برقرار شود.',
            '## ۲-۲. مکانیزم شکل‌گیری جبهه شعله و فیزیک ناک در اتاق احتراق',
            'هنگامی که پیش‌رسانی جرقه بیش از حد مجاز افزایش یابد، برخورد جبهه شعله اصلی با کانون‌های خودسوزی در انتهای اتاق احتراق باعث نوسان شدید فشار سیلندر و ایجاد ضربه ناک می‌شود که راندمان حرارتی و گشتاور خروجی موتور را کاهش می‌دهد.',
          ].join('\n\n'),
        },
        {
          name: 'جزوه_کارگاهی_ریمپ_تکمیلی_۲.md',
          text: [
            '# فصل ۱: استانداردهای نگهداری سیستم سوخت و کالیبراسیون ME7.4.4',
            '## ۱-۱. فشار ریل، نسبت استوکیومتری و مپ LAMFA',
            'نسبت هوا به سوخت استوکیومتری در موتورهای بنزینی برابر ۱۴.۷ به ۱ (14.7:1) در مپ LAMFA تنظیم می‌شود.',
            'حداکثر فشار ایمن ریل سوخت در حالت بار کامل برابر ۶ بار توصیه شده است.',
            'در ایسیو SIM2K-241 آدرس مپ گشتاور هدف KFMIRL (ابعاد 16x16) روی 0x1A520 قرار دارد و برای افزایش کشش در دور 2500 تا 5500 RPM و بار 65 تا 100% به میزان +10% اصلاح می‌شود.',
            'محدودکننده دور موتور NMAX در ایسیو ME7.4.4 برای استیج ۱ از 6500 RPM به 6950 RPM قابل افزایش است.',
            'استفاده از سوخت با اکتان استاندارد عمر پمپ سوخت و سوزن انژکتور را دو برابر می‌کند.',
            [
              'جدول ۱-۱: پارامترهای مرجع سیستم سوخت‌رسانی و کالیبراسیون',
              '| پارامتر | محدوده استاندارد | واحد |',
              '| --- | --- | --- |',
              '| نسبت استوکیومتری | 14.7:1 | AFR |',
              '| فشار ریل در بار کامل | 5.2 | bar |',
              '| محدوده کات‌آف ME7.4.4 (NMAX) | 6950 | RPM |',
              '| آوانس پایه KFZW در ۳۵۰۰ دور | 22.0 | deg |',
              '| دور آرام گرم | 800 تا 900 | RPM |',
              '| مپ گشتاور هدف KFMIRL | 0x1A520 | HEX |',
            ].join('\n'),
            'نمودار منحنی گشتاور موتور TU5 (نسخه کارگاهی): 2000 RPM = 131 Nm | 3000 RPM = 152 Nm | 4000 RPM = 168 Nm | 5000 RPM = 161 Nm | 6000 RPM = 149 Nm',
            '# فصل ۲: عیب‌یابی سنسور اکسیژن و کدهای خطا',
            ['|  |', '| --- |', '| **⛔ هشدار بحرانی** <br> در صورت خرابی هیتر سنسور اکسیژن، خطای P0135 در حافظه ECU ثبت می‌شود و مصرف سوخت به‌شدت افزایش می‌یابد. |'].join('\n'),
          ].join('\n\n'),
        },
      ];

      let globalOrder = 0;
      for (const f of demoFiles) {
        const parsedBook = await parseAnySourceFile({ name: f.name, format: 'md', text: f.text });
        const fileId = `sf_${crypto.randomBytes(6).toString('hex')}`;
        const atomicUnits = extractAtomicUnitsFromBook({
          projectId,
          sourceFileId: fileId,
          fileName: f.name,
          fileRole: 'standard',
          book: parsedBook,
          startingOrder: globalOrder,
        });
        globalOrder += atomicUnits.length;
        const wordCount = f.text.trim().split(/\s+/).filter(Boolean).length;

        await insertSourceFileWithUnits({
          file: {
            id: fileId,
            projectId,
            fileName: f.name,
            format: 'md',
            role: 'standard',
            wordCount,
            sizeBytes: Buffer.byteLength(f.text, 'utf8'),
            fileHash: deterministicHash(f.text),
            metadataJson: { unitCount: atomicUnits.length },
          },
          units: atomicUnits.map((u) => ({
            id: u.id,
            projectId: u.projectId,
            sourceFileId: u.sourceFileId,
            unitType: u.unitType,
            unitOrder: u.unitOrder,
            rawText: u.rawText,
            contentHash: u.normalizedHash,
            status: u.status,
            canonicalUnitId: null,
            outlineNodeId: null,
            payloadJson: {
              ...(u.metadataJson || {}),
              headingPath: u.headingPath,
            },
          })),
        });
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 1,
        status: 'draft',
      });
      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: 'کاربر مهمان',
        actionType: 'files_ingested',
        title: 'بارگذاری ۲ فایل نمونه مهندسی',
        summary: 'دو فایل منبع (استاندارد سیستم سوخت و جزوه کارگاهی) استخراج و ثبت شدند.',
      });

      const afterIngest = await getProjectBundle(projectId, user.uid);
      if (afterIngest) {
        const formattedIngest = formatBundleForClient(afterIngest);
        const dedup = runDeterministicLosslessDedup({
          projectId,
          workflowMode: 'multi_merge',
          sourceFiles: formattedIngest.sourceFiles as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['sourceFiles'],
          units: formattedIngest.contentUnits as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['units'],
        });

        await saveDedupResults({
          projectId,
          unitUpdates: dedup.unitUpdates,
          clusters: dedup.clusters.map((c) => ({
            id: c.id,
            projectId: c.projectId,
            canonicalUnitId: c.canonicalUnitId,
            mergedUnitId: c.mergedUnitIds[0] || c.canonicalUnitId,
            matchType: c.matchType,
            similarityScore: c.similarityScore,
            mergeRationale: c.losslessSummary,
            preservedDetailsJson: {
              mergedUnitIds: c.mergedUnitIds,
            },
          })),
          conflictRows: dedup.conflicts,
        });

        const afterDedup = await getProjectBundle(projectId, user.uid);
        if (afterDedup) {
          const formattedAfter = formatBundleForClient(afterDedup);
          const proposed = buildInitialOutline({
            projectId,
            workflowMode: 'multi_merge',
            sourceFiles: formattedAfter.sourceFiles as unknown as Parameters<typeof buildInitialOutline>[0]['sourceFiles'],
            units: formattedAfter.contentUnits as unknown as Parameters<typeof buildInitialOutline>[0]['units'],
          });

          const demoNodesWithWeb = proposed.nodes.map((n, idx) =>
            idx === 0
              ? {
                  ...n,
                  webEnrichmentJson: {
                    title: 'تکمیل مرجع کالیبراسیون LAMFA و KFZW در ایسیو ME7.4.4',
                    summary:
                      'بر اساس مستندات فنی Bosch ME7 Funktionsrahmen، در مپ LAMFA اعمال نسبت 12.5:1 AFR در بار بالای 75% و دور 3500 تا 6000 RPM مانع افزایش دمای اگزوز (EGT) می‌شود. همچنین در مپ آوانس جرقه KFZW (آدرس 0x1A4F0) افزایش حداکثر +2.0° تا +2.5° تنها با بنزین اکتان ۹۵ به بالا و پایش ریتارد ناک مجاز است.',
                    sources: [
                      {
                        title: 'Bosch ME7 Funktionsrahmen — LAMFA & KFZW Calibration Reference',
                        uri: 'https://s4wiki.com/wiki/Tuning',
                      },
                      {
                        title: 'WinOLS Map Calibration Safety Guidelines (AFR & Ignition Advance)',
                        uri: 'https://www.evc.de/en/product/ols/software/',
                      },
                    ],
                    checkedAt: new Date().toISOString(),
                  },
                }
              : n
          );

          await saveOutlineNodesForProject({
            projectId,
            nodes: demoNodesWithWeb,
            unitAssignments: proposed.unitAssignments,
          });
        }

        await updateProjectRecord(projectId, user.uid, {
          pipelineStage: 2,
          status: 'awaiting_outline',
        });

        await recordProjectRevision({
          projectId,
          ownerUid: user.uid,
          actorType: 'system',
          actorName: 'موتور ادغام بدون افت',
          actionType: 'dedup_completed',
          title: 'ادغام بدون افت و شناسایی تناقض عددی',
          summary: `${toPersianDigits(dedup.clusters.length)} خوشه هم‌پوشانی ادغام و ${toPersianDigits(dedup.conflicts.length)} تناقض واقعی (۴ بار در برابر ۶ بار) ثبت شد.`,
        });

        // Finalize compiled book snapshot for immediate Stage 4/5 & A4 Print Preview
        await reassembleAndPersistProject(projectId, user.uid);

        await recordProjectRevision({
          projectId,
          ownerUid: user.uid,
          actorType: 'ai',
          actorName: 'Gemini 4 Hydrogen (نمونه اولیه)',
          actionType: 'document_finalized',
          title: 'صفحه‌آرایی استاندارد و کادربندی نهایی کتاب',
          summary: 'پیش‌نمایش کتاب با کادرهای موضوعی، جدول پارامترها و استاندارد چاپ A4 ساخته شد.',
          extraDetails: { modelUsed: 'gemini-4-hydrogen' },
        });
      }

      const finalBundle = await getProjectBundle(projectId, user.uid);
      res.status(201).json(finalBundle ? formatBundleForClient(finalBundle) : null);
    } catch (err) {
      console.error('Failed to seed guest demo project:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در آماده‌سازی پروژه نمونه مهمان.',
      });
    }
  });

  // 3. GET FULL PROJECT BUNDLE
  router.get('/:id', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const bundle = await getProjectBundle(req.params.id, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      res.json(formatBundleForClient(bundle));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در دریافت جزئیات پروژه.' });
    }
  });

  // 3.1 GET PROJECT QUALITY METRICS (STAGE 5 RECHARTS PIE CHART DATA)
  router.get('/:id/quality-metrics', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const bundle = await getProjectBundle(req.params.id, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      const formatted = formatBundleForClient(bundle);
      const rawSettings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const config: DocxExportConfig = {
        ...DEFAULT_DOCX_CONFIG,
        ...rawSettings,
        optimization: {
          ...DEFAULT_DOCX_CONFIG.optimization,
          ...(rawSettings.optimization || {}),
        },
      };

      const book =
        bundle.project.bookSnapshotJson &&
        typeof bundle.project.bookSnapshotJson === 'object' &&
        Array.isArray((bundle.project.bookSnapshotJson as Record<string, unknown>).chapters)
          ? (bundle.project.bookSnapshotJson as unknown as ParsedBook)
          : assembleFinalBookAndAudit({
              projectId: bundle.project.id,
              projectTitle: bundle.project.title,
              workflowMode: (bundle.project.workflowMode as WorkflowMode) || 'multi_merge',
              config,
              sourceFiles: formatted.sourceFiles as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['sourceFiles'],
              units: formatted.contentUnits as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['units'],
              clusters: formatted.dedupClusters as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['clusters'],
              conflicts: formatted.conflicts as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['conflicts'],
              outlineNodes: formatted.outlineNodes as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['outlineNodes'],
            }).book;

      const winolsGuideReport = extractWinolsMapGuides({
        sourceFiles: (formatted.sourceFiles || []) as unknown as Parameters<typeof extractWinolsMapGuides>[0]['sourceFiles'],
        units: (formatted.contentUnits || []) as unknown as Parameters<typeof extractWinolsMapGuides>[0]['units'],
      });
      const harnessState = extractHarnessStateFromCheckpoint(
        (bundle.project.checkpointJson || {}) as Record<string, unknown>
      );
      const cpObj = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const deepReviewReport = (cpObj.lastDeepReview ?? cpObj.deepReviewReport ?? null) as DeepReviewReportDto | null;
      const validationDomain = (config.validationDomain as ValidationDomain) || 'ecu_winols';

      const metrics = computeStage5QualityMetrics({
        book,
        outlineNodes: formatted.outlineNodes as unknown as OutlineNodeDto[],
        auditReport: formatted.auditReport,
        conflicts: formatted.conflicts as unknown as ConflictDto[],
        winolsGuideReport,
        harnessState,
        deepReviewReport,
        validationDomain,
      });

      const chartData = buildStage5ComparativePieChartData(metrics);

      res.json({
        projectId: bundle.project.id,
        metrics,
        chartData,
        serverGeneratedAt: new Date().toISOString(),
        validationDomain,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ارزیابی و ارسال شاخص‌های کیفیت سرور.',
      });
    }
  });

  // 4. UPDATE PROJECT METADATA / SETTINGS / PAUSE-RESUME
  router.patch('/:id', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const body = req.body as {
        title?: string;
        workflowMode?: WorkflowMode;
        status?: string;
        pipelineStage?: number;
        settingsJson?: Record<string, unknown>;
        checkpointJson?: Record<string, unknown>;
      };

      // Never allow client PATCH to clobber server-managed checkpoint keys (aiUsage, harnessState, lastDeepReview)
      let mergedCheckpoint: Record<string, unknown> | undefined;
      if (body.checkpointJson && typeof body.checkpointJson === 'object' && !Array.isArray(body.checkpointJson)) {
        const owned = await getOwnedProject(req.params.id, user.uid);
        if (!owned) {
          res.status(404).json({ error: 'پروژه یافت نشد.' });
          return;
        }
        const existingCp = (owned.checkpointJson && typeof owned.checkpointJson === 'object'
          ? (owned.checkpointJson as Record<string, unknown>)
          : {}) as Record<string, unknown>;
        const SERVER_OWNED_KEYS = new Set([
          'aiUsage',
          'harnessState',
          'lastDeepReview',
          'deepReviewReport',
          'activeStepLock',
        ]);
        const safeClientPatch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body.checkpointJson)) {
          if (!SERVER_OWNED_KEYS.has(k)) {
            safeClientPatch[k] = v;
          }
        }
        mergedCheckpoint = {
          ...existingCp,
          ...safeClientPatch,
        };
      }

      const updated = await updateProjectRecord(req.params.id, user.uid, {
        ...(body.title !== undefined ? { title: body.title.trim().slice(0, 180) } : {}),
        ...(body.workflowMode !== undefined ? { workflowMode: body.workflowMode } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.pipelineStage !== undefined ? { pipelineStage: body.pipelineStage } : {}),
        ...(body.settingsJson !== undefined ? { settingsJson: body.settingsJson } : {}),
        ...(mergedCheckpoint !== undefined ? { checkpointJson: mergedCheckpoint } : {}),
      });
      if (!updated) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }
      const bundle = await getProjectBundle(req.params.id, user.uid);
      res.json(bundle ? formatBundleForClient(bundle) : { project: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ویرایش پروژه.' });
    }
  });

  // 5. DELETE PROJECT
  router.delete('/:id', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      await deleteProjectRecord(req.params.id, user.uid);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در حذف پروژه.' });
    }
  });

  // 6. STAGE 1: BATCH INGESTION (supports 1 to 100+ files via chunked batches with checkpointing)
  router.post('/:id/ingest', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const existing = await getProjectBundle(projectId, user.uid);
      if (!existing) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = req.body as {
        replaceExisting?: boolean;
        files?: Array<{
          name: string;
          format?: SourceFileFormat;
          role?: FileRole;
          sizeBytes?: number;
          text?: string;
          base64?: string;
        }>;
      };

      const incoming = Array.isArray(body.files) ? body.files : [];
      if (incoming.length === 0) {
        res.status(400).json({ error: 'هیچ فایلی برای استخراج ارسال نشده است.' });
        return;
      }

      // Pre-parse incoming files, apply format-specific preprocessing + hybrid mixed-scope pruning, and Layer 0 Automotive Gatekeeper
      const preparedFiles: Array<{
        raw: (typeof incoming)[number];
        format: SourceFileFormat;
        role: FileRole;
        buffer?: Buffer;
        parsed: ParsedBook;
        combinedExtractedText: string;
        preprocessReport: FilePreprocessReport;
      }> = [];

      for (const f of incoming) {
        const format = f.format ?? detectFileFormat(f.name);
        const role: FileRole = f.role ?? 'standard';
        const buffer = f.base64 ? Buffer.from(f.base64, 'base64') : undefined;

        let initialText = typeof f.text === 'string' ? f.text : '';
        let parsed = await parseAnySourceFile({
          name: f.name,
          format,
          text: f.text,
          buffer: buffer ? new Uint8Array(buffer) : undefined,
        });

        if (!initialText.trim()) {
          initialText = exportBookToMarkdown(parsed);
        }

        const preprocessReport = preprocessIncomingSourceFile({
          fileName: f.name,
          format,
          rawText: initialText,
        });

        // If hybrid pruning removed non-automotive sections from a text/markdown/html/docx/pdf source, re-parse the cleaned automotive markdown
        if (
          preprocessReport.classification === 'mixed_hybrid_pruned' &&
          preprocessReport.cleanedText.trim().length > 0
        ) {
          parsed = await parseAnySourceFile({
            name: f.name,
            format: 'md',
            text: preprocessReport.cleanedText,
          });
        }

        const sampleText =
          preprocessReport.cleanedText.trim().length > 0
            ? preprocessReport.cleanedText
            : initialText;

        if (isMasterEncyclopediaEnabled()) {
          if (preprocessReport.classification === 'rejected_non_automotive') {
            res.status(400).json({
              error: preprocessReport.summaryFa || AUTOMOTIVE_REJECTION_MESSAGE_FA,
              rejectedFileName: f.name,
              preprocessReport,
            });
            return;
          }

          const gate = evaluateAutomotiveGatekeeperLayer0({
            fileName: f.name,
            extractedText: sampleText,
            format,
          });
          if (gate.decision === 'rejected') {
            res.status(400).json({
              error: gate.reasonFa || AUTOMOTIVE_REJECTION_MESSAGE_FA,
              rejectedFileName: f.name,
              preprocessReport,
            });
            return;
          }
        }

        preparedFiles.push({
          raw: f,
          format,
          role,
          buffer,
          parsed,
          combinedExtractedText: sampleText,
          preprocessReport,
        });
      }

      if (body.replaceExisting) {
        await clearProjectPipelineArtifacts(projectId, true);
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 1,
        status: 'ingesting',
      });

      let runningUnitOrder = body.replaceExisting ? 0 : existing.contentUnits.length;
      const ingestedSummaries: Array<{
        fileName: string;
        unitCount: number;
        wordCount: number;
        classification: FilePreprocessReport['classification'];
        prunedOffTopicSegmentsCount: number;
        keptAutomotiveSegmentsCount: number;
        estimatedTokensSaved: number;
        tokenSavingsPercent: number;
        preprocessSummaryFa: string;
      }> = [];

      for (const prep of preparedFiles) {
        const { raw: f, format, role, buffer, parsed, preprocessReport } = prep;

        const fileId = `sf_${deterministicHash(`${projectId}:${f.name}:${f.sizeBytes ?? 0}:${Date.now()}:${Math.random()}`)}`;
        const atomicUnits = extractAtomicUnitsFromBook({
          projectId,
          sourceFileId: fileId,
          fileName: f.name,
          fileRole: role,
          book: parsed,
          startingOrder: runningUnitOrder,
        });
        runningUnitOrder += atomicUnits.length;

        const wordCount = atomicUnits.reduce(
          (sum, u) => sum + u.rawText.split(/\s+/).filter(Boolean).length,
          0
        );
        const checksum = deterministicHash(atomicUnits.map((u) => u.normalizedHash).join('|'));

        await insertSourceFileWithUnits({
          file: {
            id: fileId,
            projectId,
            fileName: f.name,
            format,
            role,
            sizeBytes: f.sizeBytes ?? (buffer?.byteLength ?? (f.text?.length ?? 0)),
            wordCount,
            fileHash: checksum,
            metadataJson: {
              unitCount: atomicUnits.length,
              preprocessClassification: preprocessReport.classification,
              prunedOffTopicSegmentsCount: preprocessReport.prunedOffTopicSegmentsCount,
              keptAutomotiveSegmentsCount: preprocessReport.keptAutomotiveSegmentsCount,
              estimatedTokensSaved: preprocessReport.estimatedTokensSaved,
              tokenSavingsPercent: preprocessReport.tokenSavingsPercent,
              formatNoiseCleanedCount: preprocessReport.formatNoiseCleanedCount,
              zeroTechnicalLossVerified: preprocessReport.zeroTechnicalLossVerified,
              preprocessSummaryFa: preprocessReport.summaryFa,
              prunedOffTopicPreviews: preprocessReport.prunedOffTopicPreviews,
            },
          },
          units: atomicUnits.map((u) => ({
            id: u.id,
            projectId: u.projectId,
            sourceFileId: u.sourceFileId,
            unitType: u.unitType,
            unitOrder: u.unitOrder,
            rawText: u.rawText,
            contentHash: u.normalizedHash,
            status: u.status,
            canonicalUnitId: null,
            outlineNodeId: null,
            payloadJson: {
              ...(u.metadataJson || {}),
              headingPath: u.headingPath,
            },
          })),
        });

        ingestedSummaries.push({
          fileName: f.name,
          unitCount: atomicUnits.length,
          wordCount,
          classification: preprocessReport.classification,
          prunedOffTopicSegmentsCount: preprocessReport.prunedOffTopicSegmentsCount,
          keptAutomotiveSegmentsCount: preprocessReport.keptAutomotiveSegmentsCount,
          estimatedTokensSaved: preprocessReport.estimatedTokensSaved,
          tokenSavingsPercent: preprocessReport.tokenSavingsPercent,
          preprocessSummaryFa: preprocessReport.summaryFa,
        });

        // Fire-and-forget isolated background enqueue into Master Automotive Encyclopedia
        const fullUnitsText = atomicUnits.map((u) => u.rawText).join('\n\n');
        void enqueueAutomotiveDocumentForEncyclopediaIsolated({
          fileName: f.name,
          format,
          rawText: fullUnitsText || prep.combinedExtractedText,
          userUid: user.uid,
          userEmail: user.email,
          isGuest: Boolean(user.isGuest),
        });
      }

      const fresh = await getProjectBundle(projectId, user.uid);
      if (fresh) {
        const autoTitle =
          fresh.project.title === 'پروژه تدوین و یکپارچه‌سازی جدید' && fresh.sourceFiles.length > 0
            ? fresh.sourceFiles[0].fileName.replace(/\.(docx|pdf|md|txt|json|csv|html)$/i, '')
            : fresh.project.title;
        await updateProjectRecord(projectId, user.uid, {
          title: autoTitle,
          pipelineStage: 1,
          status: 'draft',
          checkpointJson: {
            ...((fresh.project.checkpointJson || {}) as Record<string, unknown>),
            stage: 1,
            processedFileCount: fresh.sourceFiles.length,
            totalUnits: fresh.contentUnits.length,
            lastUpdatedAt: new Date().toISOString(),
          },
        });
      }

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType: 'files_ingested',
        title: `بارگذاری و استخراج ${toPersianDigits(ingestedSummaries.length)} فایل منبع`,
        summary: ingestedSummaries
          .slice(0, 3)
          .map((s) => `${s.fileName} (${toPersianDigits(s.unitCount)} واحد)`)
          .join(' · '),
      });

      const finalBundle = await getProjectBundle(projectId, user.uid);
      res.json({
        ingested: ingestedSummaries,
        bundle: finalBundle ? formatBundleForClient(finalBundle) : null,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در مرحله استخراج واحدهای محتوایی.',
      });
    }
  });

  // 7. STAGE 2: TWO-PASS LOSSLESS UNION DEDUP + CONFLICT DETECTION + PROPOSED OUTLINE
  router.post('/:id/dedup', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }
      if (bundle.contentUnits.length === 0) {
        res.status(400).json({ error: 'ابتدا حداقل یک فایل ورودی در پروژه بارگذاری و استخراج کنید.' });
        return;
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 2,
        status: 'deduping',
      });

      const formatted = formatBundleForClient(bundle);
      const workflowMode = (bundle.project.workflowMode as WorkflowMode) || 'multi_merge';

      // Pass 1: Deterministic Exact + Near-Duplicate Lossless Union & Strict Conflict Preservation
      const dedup = runDeterministicLosslessDedup({
        projectId,
        workflowMode,
        sourceFiles: formatted.sourceFiles as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['sourceFiles'],
        units: formatted.contentUnits as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['units'],
      });

      const settings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const useAi = settings.useAiBackend !== false;
      const requestedGoogleModel = normalizeGoogleModelId(settings.aiModel);
      const conflictTaskCtx = useAi
        ? resolveProviderForTaskFromRequest(req, 'conflict_triage', requestedGoogleModel)
        : null;

      // Pass 1B: Optional Batched AI Semantic Conflict Verification (routed to Economy tier by default)
      let finalConflicts = dedup.conflicts;
      let dedupAiUsage = extractAiUsageFromCheckpoint(
        (bundle.project.checkpointJson || {}) as Record<string, unknown>
      );
      const capCheckConflict = conflictTaskCtx
        ? checkHardCostCap(dedupAiUsage, conflictTaskCtx.hardCostCapUsd)
        : { allowed: true, spentUsd: 0 };

      if (
        conflictTaskCtx &&
        capCheckConflict.allowed &&
        !conflictTaskCtx.provider.validationError &&
        conflictTaskCtx.provider.apiKey &&
        dedup.conflicts.length > 0
      ) {
        const verifiedResult = await verifyConflictsWithAi(
          conflictTaskCtx.provider,
          dedup.conflicts,
          conflictTaskCtx.googleModel,
          {
            optimizationMode: conflictTaskCtx.optimizationMode,
            enablePromptCaching: conflictTaskCtx.enablePromptCaching,
            enableResponseCache: conflictTaskCtx.enableResponseCache,
          }
        );
        if (verifiedResult.usageDelta) {
          dedupAiUsage = mergeAiUsageDelta(dedupAiUsage, verifiedResult.usageDelta);
        }
        finalConflicts = verifiedResult.verified;
        if (finalConflicts.length !== dedup.conflicts.length) {
          const genuineConflictUnitIds = new Set(
            finalConflicts.flatMap((c) => [c.unitAId, c.unitBId])
          );
          for (const upd of dedup.unitUpdates) {
            if (upd.status === 'conflict' && !genuineConflictUnitIds.has(upd.id)) {
              upd.status = 'active';
            }
          }
        }
      }

      await saveDedupResults({
        projectId,
        unitUpdates: dedup.unitUpdates,
        clusters: dedup.clusters.map((c) => ({
          id: c.id,
          projectId: c.projectId,
          canonicalUnitId: c.canonicalUnitId,
          mergedUnitId: c.mergedUnitIds[0] || c.canonicalUnitId,
          matchType: c.matchType,
          similarityScore: c.similarityScore,
          mergeRationale: c.losslessSummary,
          preservedDetailsJson: {
            mergedUnitIds: c.mergedUnitIds,
          },
        })),
        conflictRows: finalConflicts,
      });

      // Reload updated units and build Stage 3 proposed outline (with zero-token domain topic clustering!)
      const afterDedup = await getProjectBundle(projectId, user.uid);
      if (!afterDedup) {
        res.status(404).json({ error: 'پروژه پس از ادغام یافت نشد.' });
        return;
      }
      const formattedAfter = formatBundleForClient(afterDedup);

      const proposed = buildInitialOutline({
        projectId,
        workflowMode,
        sourceFiles: formattedAfter.sourceFiles as unknown as Parameters<typeof buildInitialOutline>[0]['sourceFiles'],
        units: formattedAfter.contentUnits as unknown as Parameters<typeof buildInitialOutline>[0]['units'],
      });

      // Optional Pass 2: AI semantic refinement of outline chapter titles & multi-file ordering
      // Routed to `semantic_reorder` (Balanced) for multi-file merges, or `outline_polish` (Economy) otherwise!
      const isMultiFileMerge = workflowMode === 'multi_merge' && formattedAfter.sourceFiles.length >= 2;
      const outlineTaskType = isMultiFileMerge ? 'semantic_reorder' : 'outline_polish';
      const outlineTaskCtx = useAi
        ? resolveProviderForTaskFromRequest(req, outlineTaskType, requestedGoogleModel)
        : null;
      const capCheckOutline = outlineTaskCtx
        ? checkHardCostCap(dedupAiUsage, outlineTaskCtx.hardCostCapUsd)
        : { allowed: true, spentUsd: 0 };

      if (
        outlineTaskCtx &&
        capCheckOutline.allowed &&
        !outlineTaskCtx.provider.validationError &&
        outlineTaskCtx.provider.apiKey &&
        proposed.nodes.length >= 2 &&
        proposed.nodes.length <= 28
      ) {
        try {
          const outlineWire = buildCompactOutlineWire(proposed.nodes);
          const outlineLedger = extractTechnicalFactLedger(
            afterDedup.contentUnits,
            proposed.nodes
          );
          const antiDriftBlock = outlineTaskCtx.enableAntiDriftGuard
            ? buildAntiDriftContract(outlineLedger, outlineTaskType)
            : '';
          const outlineEditorialDirective = buildEditorialSystemDirective(
            bundle.project.settingsJson
          );
          const outlineSystemInstruction = [
            outlineEditorialDirective,
            antiDriftBlock,
            'فقط عناوین و خلاصه فارسی فصل‌ها را یکدست، حرفه‌ای و دقیق کن (بدون حذف یا تغییر id فصل‌ها و بدون حذف کدهای ECU/WinOLS). خروجی صرفاً JSON با کلید refinedNodes باشد.',
          ]
            .filter(Boolean)
            .join('\n\n');
          const outlinePrompt = `حالت پروژه: ${workflowMode}\nفهرست فصل‌های استخراج‌شده:\n${outlineWire.wireText}`;

          const outlineModelKey = isNonGoogleProvider(outlineTaskCtx.provider)
            ? outlineTaskCtx.provider.customModelId
            : outlineTaskCtx.googleModel;
          const outlineCacheKey = buildAiTaskCacheKey([
            outlineTaskType,
            outlineModelKey,
            outlineSystemInstruction,
            outlineWire.wireText,
          ]);

          let outlineJsonText = '';
          const cachedOutline =
            outlineTaskCtx.enableResponseCache
              ? getCachedAiTaskResult(outlineCacheKey)
              : null;

          if (cachedOutline) {
            outlineJsonText = cachedOutline.text;
            dedupAiUsage = mergeAiUsageDelta(dedupAiUsage, {
              promptTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              requestCount: 0,
              savedTokensByOptimization: cachedOutline.savedPromptTokens + outlineWire.estimatedTokensSaved,
              cachedCallHit: true,
              modelUsed: cachedOutline.modelUsed,
            });
          } else {
            const level = resolveThinkingLevel(outlineTaskCtx.googleModel, settings.aiThinkingLevel);
            const aiRes = await generateUnifiedTextOrJson({
              provider: outlineTaskCtx.provider,
              googleModel: outlineTaskCtx.googleModel,
              thinkingLevel: level,
              systemInstruction: outlineSystemInstruction,
              prompt: outlinePrompt,
              expectJson: true,
              enablePromptCaching: outlineTaskCtx.enablePromptCaching,
              savedTokensByOptimization: outlineWire.estimatedTokensSaved,
              googleResponseSchema: {
                type: Type.OBJECT,
                properties: {
                  refinedNodes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        title: { type: Type.STRING },
                        summary: { type: Type.STRING },
                      },
                    },
                  },
                },
              },
            });
            outlineJsonText = aiRes.text;
            dedupAiUsage = mergeAiUsageDelta(dedupAiUsage, aiRes.usageDelta);
            if (outlineTaskCtx.enableResponseCache && outlineJsonText) {
              setCachedAiTaskResult(outlineCacheKey, {
                text: outlineJsonText,
                modelUsed: aiRes.modelUsed,
                savedPromptTokens: aiRes.usageDelta.promptTokens || outlineWire.estimatedCompactTokens,
              });
            }
          }

          const parsedAi = safeParseGeminiJson<{
            refinedNodes?: Array<{ id?: string; title?: string; summary?: string }>;
          }>(outlineJsonText, {});

          if (Array.isArray(parsedAi.refinedNodes)) {
            const validated = outlineTaskCtx.enableAntiDriftGuard
              ? validateOutlineRefinementOutput(parsedAi.refinedNodes, proposed.nodes, outlineLedger)
              : {
                  acceptedById: new Map(
                    parsedAi.refinedNodes
                      .filter((r) => r.id)
                      .map((r) => [String(r.id), { title: r.title?.trim(), summary: r.summary?.trim() }])
                  ),
                };

            for (const node of proposed.nodes) {
              const r = validated.acceptedById.get(node.id);
              if (r?.title && r.title.length >= 3) {
                node.title = r.title;
              }
              if (r?.summary && r.summary.length >= 6) {
                node.summary = r.summary;
              }
            }
          }
        } catch (aiErr) {
          console.warn('Optional Pass 2 AI outline polish skipped:', aiErr);
        }
      }

      await saveOutlineNodesForProject({
        projectId,
        nodes: proposed.nodes,
        unitAssignments: proposed.unitAssignments,
      });

      // Immediately assemble and persist Stage 2 Audit Report (including Entity-Centric Micro-Routing Report)
      const afterOutline = await getProjectBundle(projectId, user.uid);
      if (afterOutline) {
        const formattedAfterOutline = formatBundleForClient(afterOutline);
        const rawSettings = (afterOutline.project.settingsJson || {}) as Partial<DocxExportConfig>;
        const stage2Config: DocxExportConfig = {
          ...DEFAULT_DOCX_CONFIG,
          ...rawSettings,
          optimization: {
            ...DEFAULT_DOCX_CONFIG.optimization,
            ...(rawSettings.optimization || {}),
          },
        };
        const stage2Assembled = assembleFinalBookAndAudit({
          projectId,
          projectTitle: afterOutline.project.title,
          workflowMode,
          config: stage2Config,
          sourceFiles: formattedAfterOutline.sourceFiles as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['sourceFiles'],
          units: formattedAfterOutline.contentUnits as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['units'],
          clusters: formattedAfterOutline.dedupClusters as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['clusters'],
          conflicts: formattedAfterOutline.conflicts as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['conflicts'],
          outlineNodes: formattedAfterOutline.outlineNodes as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['outlineNodes'],
        });
        await saveAuditReportRecord({
          id: stage2Assembled.audit.id,
          projectId: stage2Assembled.audit.projectId,
          totalSourceFiles: stage2Assembled.audit.totalSourceFiles,
          totalInputUnits: stage2Assembled.audit.totalInputUnits,
          uniqueUnitsCount: stage2Assembled.audit.uniqueUnitsPreserved,
          mergedDuplicatesCount: stage2Assembled.audit.duplicatesMerged,
          conflictsCount: stage2Assembled.audit.conflictsDetected,
          coveragePercent: stage2Assembled.audit.coveragePercent,
          sourceTraceJson: {
            ...(stage2Assembled.audit.detailsJson || {}),
            ...(dedup.entityMicroRoutingReport
              ? { entityMicroRoutingReport: dedup.entityMicroRoutingReport }
              : {}),
            conflictsResolved: stage2Assembled.audit.conflictsResolved,
          },
        });
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 3,
        status: 'awaiting_outline',
        checkpointJson: {
          ...((bundle.project.checkpointJson || {}) as Record<string, unknown>),
          stage: 3,
          clustersCount: dedup.clusters.length,
          conflictsCount: finalConflicts.length,
          outlineCount: proposed.nodes.length,
          routedExtractsCount: dedup.entityMicroRoutingReport?.totalRoutedExtracts ?? 0,
          aiUsage: dedupAiUsage,
          lastUpdatedAt: new Date().toISOString(),
        },
      });

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'system',
        actorName: 'موتور خوشه‌بندی و ادغام بدون افت',
        actionType: 'dedup_completed',
        title: 'اجرای مرحله ۲: خوشه‌بندی موضوعی ایسیوها، ادغام تک‌خطی و کشف تناقض',
        summary: `${toPersianDigits(dedup.clusters.length)} خوشه ادغام، ${toPersianDigits(dedup.entityMicroRoutingReport?.totalRoutedExtracts ?? 0)} انتقال تک‌خطی با ارجاع متقابل و ${toPersianDigits(finalConflicts.length)} تناقض واقعی شناسایی شد.`,
      });

      const finalBundle = await getProjectBundle(projectId, user.uid);
      res.json(finalBundle ? formatBundleForClient(finalBundle) : null);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در مرحله حذف تکراری‌ها و تحلیل تناقض.',
      });
    }
  });

  // 7B. ONE-CLICK WORKSPACE QUEUE INGESTION + STAGE 2 ENTITY-CENTRIC CLUSTERING (7 MD FILES + 10 VALEO J34 IMAGES)
  router.post('/:id/ingest-workspace-queue', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const existing = await getProjectBundle(projectId, user.uid);
      if (!existing) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const WORKSPACE_QUEUE_FILES: ReadonlyArray<{
        diskFileName: string;
        displayFileName: string;
        role: FileRole;
      }> = [
        {
          diskFileName: 'BOOK_DAY01_04_Final.docx_07da70df.md',
          displayFileName: 'BOOK_DAY01_04_Final.docx.md',
          role: 'master',
        },
        {
          diskFileName: '____________ab18c9d8.md',
          displayFileName: 'ایسیو زیمنس.md',
          role: 'supplement',
        },
        {
          diskFileName: 'Bakhsh1_Dars_01_ta_08-1_1707ad79.md',
          displayFileName: 'Bakhsh1_Dars_01_ta_08-1.md',
          role: 'supplement',
        },
        {
          diskFileName: 'Bakhsh2_Dars_08-2_ta_09-3_89994058.md',
          displayFileName: 'Bakhsh2_Dars_08-2_ta_09-3.md',
          role: 'supplement',
        },
        {
          diskFileName: 'dyno2_9f9558f8.md',
          displayFileName: 'dyno2.md',
          role: 'supplement',
        },
        {
          diskFileName: 'dyno_b0cdc4f0.md',
          displayFileName: 'dyno.md',
          role: 'supplement',
        },
        {
          diskFileName: 'j34_4e1e0c05.md',
          displayFileName: 'j34.md',
          role: 'supplement',
        },
      ];

      const assetsDir = path.resolve(process.cwd(), 'public/assets/aistudio');
      await clearProjectPipelineArtifacts(projectId, true);

      await updateProjectRecord(projectId, user.uid, {
        title: 'دایرةالمعارف جامع ایسیوهای بازار ایران (زیمنس، بوش، والیو J34، ساژم، دلفی) و تحلیل داینو',
        workflowMode: 'multi_merge',
        pipelineStage: 1,
        status: 'ingesting',
      });

      let runningUnitOrder = 0;
      const ingestedSummaries: Array<{ fileName: string; unitCount: number; wordCount: number }> = [];

      for (const qf of WORKSPACE_QUEUE_FILES) {
        const fullPath = path.join(assetsDir, qf.diskFileName);
        let rawText = '';
        try {
          rawText = await fs.readFile(fullPath, 'utf-8');
        } catch {
          continue;
        }
        if (!rawText.trim()) continue;

        const parsed = await parseAnySourceFile({
          name: qf.displayFileName,
          format: 'md',
          text: rawText,
        });

        const fileId = `sf_${deterministicHash(`${projectId}:${qf.displayFileName}:${rawText.length}`)}`;
        const atomicUnits = extractAtomicUnitsFromBook({
          projectId,
          sourceFileId: fileId,
          fileName: qf.displayFileName,
          fileRole: qf.role,
          book: parsed,
          startingOrder: runningUnitOrder,
        });
        runningUnitOrder += atomicUnits.length;

        const wordCount = atomicUnits.reduce(
          (sum, u) => sum + u.rawText.split(/\s+/).filter(Boolean).length,
          0
        );
        const checksum = deterministicHash(atomicUnits.map((u) => u.normalizedHash).join('|'));

        await insertSourceFileWithUnits({
          file: {
            id: fileId,
            projectId,
            fileName: qf.displayFileName,
            format: 'md',
            role: qf.role,
            sizeBytes: Buffer.byteLength(rawText, 'utf-8'),
            wordCount,
            fileHash: checksum,
            metadataJson: { unitCount: atomicUnits.length },
          },
          units: atomicUnits.map((u) => ({
            id: u.id,
            projectId: u.projectId,
            sourceFileId: u.sourceFileId,
            unitType: u.unitType,
            unitOrder: u.unitOrder,
            rawText: u.rawText,
            contentHash: u.normalizedHash,
            status: u.status,
            canonicalUnitId: null,
            outlineNodeId: null,
            payloadJson: {
              ...(u.metadataJson || {}),
              headingPath: u.headingPath,
            },
          })),
        });

        ingestedSummaries.push({
          fileName: qf.displayFileName,
          unitCount: atomicUnits.length,
          wordCount,
        });
      }

      // Immediately execute Stage 2 Deterministic Entity-Centric Micro-Routing, Table Stitching & Dedup (0 personal quota tokens!)
      const afterIngest = await getProjectBundle(projectId, user.uid);
      if (!afterIngest) {
        res.status(404).json({ error: 'پروژه پس از استخراج یافت نشد.' });
        return;
      }
      const formattedIngest = formatBundleForClient(afterIngest);

      const dedup = runDeterministicLosslessDedup({
        projectId,
        workflowMode: 'multi_merge',
        sourceFiles: formattedIngest.sourceFiles as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['sourceFiles'],
        units: formattedIngest.contentUnits as unknown as Parameters<typeof runDeterministicLosslessDedup>[0]['units'],
      });

      await saveDedupResults({
        projectId,
        unitUpdates: dedup.unitUpdates,
        clusters: dedup.clusters.map((c) => ({
          id: c.id,
          projectId: c.projectId,
          canonicalUnitId: c.canonicalUnitId,
          mergedUnitId: c.mergedUnitIds[0] || c.canonicalUnitId,
          matchType: c.matchType,
          similarityScore: c.similarityScore,
          mergeRationale: c.losslessSummary,
          preservedDetailsJson: {
            mergedUnitIds: c.mergedUnitIds,
          },
        })),
        conflictRows: dedup.conflicts,
      });

      const afterDedup = await getProjectBundle(projectId, user.uid);
      if (afterDedup) {
        const formattedAfterDedup = formatBundleForClient(afterDedup);
        const proposed = buildInitialOutline({
          projectId,
          workflowMode: 'multi_merge',
          sourceFiles: formattedAfterDedup.sourceFiles as unknown as Parameters<typeof buildInitialOutline>[0]['sourceFiles'],
          units: formattedAfterDedup.contentUnits as unknown as Parameters<typeof buildInitialOutline>[0]['units'],
        });

        await saveOutlineNodesForProject({
          projectId,
          nodes: proposed.nodes,
          unitAssignments: proposed.unitAssignments,
        });

        const afterOutline = await getProjectBundle(projectId, user.uid);
        if (afterOutline) {
          const formattedAfterOutline = formatBundleForClient(afterOutline);
          const rawSettings = (afterOutline.project.settingsJson || {}) as Partial<DocxExportConfig>;
          const stage2Config: DocxExportConfig = {
            ...DEFAULT_DOCX_CONFIG,
            ...rawSettings,
            optimization: {
              ...DEFAULT_DOCX_CONFIG.optimization,
              ...(rawSettings.optimization || {}),
            },
          };
          const assembled = assembleFinalBookAndAudit({
            projectId,
            projectTitle: afterOutline.project.title,
            workflowMode: 'multi_merge',
            config: stage2Config,
            sourceFiles: formattedAfterOutline.sourceFiles as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['sourceFiles'],
            units: formattedAfterOutline.contentUnits as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['units'],
            clusters: formattedAfterOutline.dedupClusters as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['clusters'],
            conflicts: formattedAfterOutline.conflicts as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['conflicts'],
            outlineNodes: formattedAfterOutline.outlineNodes as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['outlineNodes'],
          });

          await saveAuditReportRecord({
            id: assembled.audit.id,
            projectId: assembled.audit.projectId,
            totalSourceFiles: assembled.audit.totalSourceFiles,
            totalInputUnits: assembled.audit.totalInputUnits,
            uniqueUnitsCount: assembled.audit.uniqueUnitsPreserved,
            mergedDuplicatesCount: assembled.audit.duplicatesMerged,
            conflictsCount: assembled.audit.conflictsDetected,
            coveragePercent: assembled.audit.coveragePercent,
            sourceTraceJson: {
              ...(assembled.audit.detailsJson || {}),
              ...(dedup.entityMicroRoutingReport
                ? { entityMicroRoutingReport: dedup.entityMicroRoutingReport }
                : {}),
              conflictsResolved: assembled.audit.conflictsResolved,
            },
          });

          await updateProjectRecord(projectId, user.uid, {
            bookSnapshotJson: assembled.book as unknown as Record<string, unknown>,
            pipelineStage: 3,
            status: 'awaiting_outline',
            checkpointJson: {
              ...((afterOutline.project.checkpointJson || {}) as Record<string, unknown>),
              stage: 3,
              processedFileCount: ingestedSummaries.length,
              clustersCount: dedup.clusters.length,
              conflictsCount: dedup.conflicts.length,
              outlineCount: proposed.nodes.length,
              routedExtractsCount: dedup.entityMicroRoutingReport?.totalRoutedExtracts ?? 0,
              lastUpdatedAt: new Date().toISOString(),
            },
          });
        }
      }

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'system',
        actorName: 'موتور خوشه‌بندی موضوعی مرحله ۲',
        actionType: 'dedup_completed',
        title: `تجمیع و خوشه‌بندی هوشمند ${toPersianDigits(ingestedSummaries.length)} فایل صف پروژه و ۱۰ تصویر والیو J34`,
        summary: `${toPersianDigits(dedup.entityMicroRoutingReport?.totalRoutedExtracts ?? 0)} نکته پراکنده ایسیوها با ثبت ارجاع در مبدأ به خوشه مرجع همان ایسیو منتقل شد و جداول ۶ تکه زیمنس و داینو ترمیم گردیدند.`,
      });

      const finalBundle = await getProjectBundle(projectId, user.uid);
      res.json({
        ingested: ingestedSummaries,
        bundle: finalBundle ? formatBundleForClient(finalBundle) : null,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در تجمیع فایل‌های صف پروژه.',
      });
    }
  });

  // 8. STAGE 3: SAVE HUMAN-IN-THE-LOOP OUTLINE EDITS (REORDER / RENAME / SPLIT / MERGE / DELETE / APPROVE)
  router.put('/:id/outline', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = req.body as {
        nodes?: Array<{
          id: string;
          title: string;
          summary?: string | null;
          nodeOrder: number;
          level?: number;
          parentId?: string | null;
          isApproved?: boolean;
          webEnrichmentJson?: Record<string, unknown> | null;
        }>;
        reassignments?: Array<{ fromNodeId: string; toNodeId: string }>;
        validationDomain?: ValidationDomain;
      };

      const nodes = Array.isArray(body.nodes) ? body.nodes : [];
      if (nodes.length === 0) {
        res.status(400).json({ error: 'فهرست فصل‌ها نمی‌تواند خالی باشد.' });
        return;
      }

      const incomingIds = new Set(nodes.map((n) => n.id));
      const explicitFromIds = new Set((body.reassignments || []).map((r) => r.fromNodeId));

      await updateOutlineNodesOrderAndApproval(
        projectId,
        nodes.map((n, idx) => ({
          id: n.id,
          title: n.title.trim() || `فصل ${toPersianDigits(idx + 1)}`,
          summary: n.summary ?? null,
          nodeOrder: idx + 1,
          level: n.level ?? 1,
          parentId: n.parentId ?? null,
          isApproved: Boolean(n.isApproved),
          webEnrichmentJson: n.webEnrichmentJson ?? null,
        }))
      );

      // Reassign units if chapters were merged
      if (Array.isArray(body.reassignments)) {
        for (const r of body.reassignments) {
          await reassignUnitsOutlineNodeByPreviousNode(projectId, r.fromNodeId, r.toNodeId);
        }
      }

      // Bug #27: Zero-loss safeguard for deleted nodes not covered by explicit reassignments
      const fallbackTargetId = nodes[0].id;
      let orphanedReassignedCount = 0;
      for (const prevNode of bundle.outlineNodes) {
        if (!incomingIds.has(prevNode.id) && !explicitFromIds.has(prevNode.id)) {
          await reassignUnitsOutlineNodeByPreviousNode(projectId, prevNode.id, fallbackTargetId);
          orphanedReassignedCount += 1;
        }
      }

      // Sync validationDomain & mark any existing uncompleted harness blueprint dirty if outline mutated
      const existingSettings = (bundle.project.settingsJson || {}) as Record<string, unknown>;
      const existingCheckpoint = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const existingHarness = extractHarnessStateFromCheckpoint(existingCheckpoint);
      const nextSettings: Record<string, unknown> = { ...existingSettings };
      if (
        body.validationDomain === 'ecu_winols' ||
        body.validationDomain === 'general_persian_technical'
      ) {
        nextSettings.validationDomain = body.validationDomain;
      }
      if (existingHarness) {
        if (
          body.validationDomain === 'ecu_winols' ||
          body.validationDomain === 'general_persian_technical'
        ) {
          existingHarness.blueprint.validationDomain = body.validationDomain;
        }
        const outlineSignatureChanged =
          bundle.outlineNodes.length !== nodes.length ||
          bundle.outlineNodes.some(
            (oldN, i) => oldN.id !== nodes[i]?.id || oldN.title !== nodes[i]?.title?.trim()
          );
        if (outlineSignatureChanged) {
          existingHarness.blueprint.approved = false;
        }
      }

      await updateProjectRecord(projectId, user.uid, {
        settingsJson: nextSettings,
        checkpointJson: existingHarness
          ? { ...existingCheckpoint, harnessState: existingHarness }
          : existingCheckpoint,
      });

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType: 'outline_updated',
        title: 'ویرایش ساختار و ترتیب فصل‌ها',
        summary: `فهرست فصل‌بندی با ${toPersianDigits(nodes.length)} فصل ذخیره شد${Array.isArray(body.reassignments) && body.reassignments.length > 0 ? ` (${toPersianDigits(body.reassignments.length)} ادغام فصل)` : ''}${orphanedReassignedCount > 0 ? ` · ${toPersianDigits(orphanedReassignedCount)} فصل حذفی با حفظ محتوا ادغام شد` : ''}.`,
      });

      const updated = await getProjectBundle(projectId, user.uid);
      res.json(updated ? formatBundleForClient(updated) : null);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ذخیره ساختار فصل‌بندی.' });
    }
  });

  // 8.5 STAGE 3: INSTANT QUICK DRAFT (DETERMINISTIC CHAPTER TREE FROM EXTRACTED FILES & HEADINGS — ZERO AI/ENRICHMENT WAIT)
  router.post('/:id/quick-draft', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = (req.body || {}) as {
        strategy?: QuickDraftStrategy;
        openStage4Preview?: boolean;
      };

      const strategy: QuickDraftStrategy =
        body.strategy === 'by_source_file' ? 'by_source_file' : 'heading_tree';
      const openStage4Preview = Boolean(body.openStage4Preview);

      const formatted = formatBundleForClient(bundle);
      if (formatted.sourceFiles.length === 0 && formatted.contentUnits.length === 0) {
        res.status(400).json({
          error: 'ابتدا باید حداقل یک فایل در مرحله ۱ استخراج شده باشد تا پیش‌نویس سریع ساخته شود.',
        });
        return;
      }

      const quickDraft = buildQuickDraftStructure({
        projectId,
        projectTitle: bundle.project.title,
        sourceFiles: formatted.sourceFiles as unknown as Parameters<typeof buildQuickDraftStructure>[0]['sourceFiles'],
        contentUnits: formatted.contentUnits as unknown as Parameters<typeof buildQuickDraftStructure>[0]['contentUnits'],
        strategy,
      });

      await saveOutlineNodesForProject({
        projectId,
        nodes: quickDraft.outlineNodes.map((n) => ({
          id: n.id,
          projectId,
          parentId: n.parentId ?? null,
          level: n.level ?? 1,
          nodeOrder: n.nodeOrder,
          title: n.title,
          summary: n.summary ?? null,
          isApproved: openStage4Preview,
          webEnrichmentJson: null,
        })),
        unitAssignments: quickDraft.unitAssignments,
      });

      // Reset any prior uncompleted harness blueprint approval since outline structure changed
      const existingCheckpoint = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const existingHarness = extractHarnessStateFromCheckpoint(existingCheckpoint);
      if (existingHarness) {
        existingHarness.blueprint.approved = false;
      }

      if (openStage4Preview) {
        // Fast local deterministic assembly into Stage 4 preview — explicitly skipping slow Google Search / Deep Review!
        const refreshed = await getProjectBundle(projectId, user.uid);
        if (!refreshed) {
          res.status(404).json({ error: 'پروژه یافت نشد.' });
          return;
        }
        const refreshedFormatted = formatBundleForClient(refreshed);
        const rawSettings = (refreshed.project.settingsJson || {}) as Partial<DocxExportConfig>;
        const config: DocxExportConfig = {
          ...DEFAULT_DOCX_CONFIG,
          ...rawSettings,
          optimization: {
            ...DEFAULT_DOCX_CONFIG.optimization,
            ...(rawSettings.optimization || {}),
          },
        };

        const assembled = assembleFinalBookAndAudit({
          projectId,
          projectTitle: refreshed.project.title,
          workflowMode: (refreshed.project.workflowMode as WorkflowMode) || 'multi_merge',
          config,
          sourceFiles: refreshedFormatted.sourceFiles as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['sourceFiles'],
          units: refreshedFormatted.contentUnits as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['units'],
          clusters: refreshedFormatted.dedupClusters as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['clusters'],
          conflicts: refreshedFormatted.conflicts as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['conflicts'],
          outlineNodes: refreshedFormatted.outlineNodes as unknown as Parameters<typeof assembleFinalBookAndAudit>[0]['outlineNodes'],
        });

        const existingMicroRouting = (
          (refreshed.auditReport?.sourceTraceJson || {}) as Record<string, unknown>
        ).entityMicroRoutingReport as { totalRoutedExtracts?: number } | undefined;
        const computedMicroRouting = (assembled.audit.detailsJson || {})
          .entityMicroRoutingReport as { totalRoutedExtracts?: number } | undefined;

        await saveAuditReportRecord({
          id: assembled.audit.id,
          projectId: assembled.audit.projectId,
          totalSourceFiles: assembled.audit.totalSourceFiles,
          totalInputUnits: assembled.audit.totalInputUnits,
          uniqueUnitsCount: assembled.audit.uniqueUnitsPreserved,
          mergedDuplicatesCount: assembled.audit.duplicatesMerged,
          conflictsCount: assembled.audit.conflictsDetected,
          coveragePercent: assembled.audit.coveragePercent,
          sourceTraceJson: {
            ...(assembled.audit.detailsJson || {}),
            ...(existingMicroRouting &&
            (existingMicroRouting.totalRoutedExtracts || 0) >=
              (computedMicroRouting?.totalRoutedExtracts || 0)
              ? { entityMicroRoutingReport: existingMicroRouting }
              : {}),
            conflictsResolved: assembled.audit.conflictsResolved,
            quickDraftMode: true,
          },
        });

        await updateProjectRecord(projectId, user.uid, {
          bookSnapshotJson: assembled.book as unknown as Record<string, unknown>,
          pipelineStage: 4,
          status: 'structuring',
          checkpointJson: existingHarness
            ? { ...existingCheckpoint, harnessState: existingHarness, quickDraftStrategy: strategy }
            : { ...existingCheckpoint, quickDraftStrategy: strategy },
        });
      } else {
        await updateProjectRecord(projectId, user.uid, {
          pipelineStage: Math.max(bundle.project.pipelineStage || 3, 3),
          status: 'outlining',
          checkpointJson: existingHarness
            ? { ...existingCheckpoint, harnessState: existingHarness, quickDraftStrategy: strategy }
            : { ...existingCheckpoint, quickDraftStrategy: strategy },
        });
      }

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType: 'outline_updated',
        title: openStage4Preview
          ? 'ایجاد پیش‌نویس سریع و ساخت پیش‌نمایش اولیه (بدون غنی‌سازی)'
          : 'ایجاد پیش‌نویس سریع ساختار فصل‌ها از عناوین درختی',
        summary: `ساختار اولیه با ${toPersianDigits(quickDraft.summary.totalChapters)} فصل و ${toPersianDigits(quickDraft.summary.totalSubsections)} زیربخش درختی از ${toPersianDigits(quickDraft.summary.totalSourceFiles)} فایل استخراج‌شده تولید شد.`,
      });

      const finalBundle = await getProjectBundle(projectId, user.uid);
      res.json(finalBundle ? formatBundleForClient(finalBundle) : null);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ایجاد پیش‌نویس سریع ساختار فصل‌ها.',
      });
    }
  });

  // 9. STAGE 4 & 5: FINALIZE DOCUMENT, VISUAL ENRICHMENT & 100% COVERAGE AUDIT
  router.post('/:id/finalize', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      await updateProjectRecord(projectId, user.uid, {
        pipelineStage: 4,
        status: 'structuring',
      });

      // Mark all outline nodes approved
      if (bundle.outlineNodes.length > 0) {
        await updateOutlineNodesOrderAndApproval(
          projectId,
          bundle.outlineNodes.map((n, idx) => ({
            id: n.id,
            title: n.title,
            summary: n.summary,
            nodeOrder: idx + 1,
            level: n.level,
            parentId: n.parentId,
            isApproved: true,
            webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
          }))
        );
      }

      // Unified Web Search Enrichment across Google / OpenAI / Anthropic / Perplexity / Custom (Bug #26)
      const settings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const searchMode: GoogleSearchMode = settings.googleSearchMode ?? 'conflicts_only';
      const finalizeProvider = resolveAiProviderFromRequest(req);
      const searchRoute = resolveWebSearchRouteFromRequest(req);
      const finalizeModel = normalizeGoogleModelId(settings.aiModel);

      if (
        (searchMode === 'conflicts_and_enrichment' || searchMode === 'full_document_enrichment') &&
        bundle.outlineNodes.length > 0
      ) {
        const unenriched = bundle.outlineNodes.filter((n) => !n.webEnrichmentJson);
        const targetNodes =
          searchMode === 'full_document_enrichment' ? unenriched : unenriched.slice(0, 3);

        for (const node of targetNodes) {
          try {
            const chapterExcerpt = buildChapterExcerpt(bundle.contentUnits, node.id, 1800);
            const prompt = [
              `با استفاده از جستجوی زنده وب، متن فصل «${node.title}» از سند «${bundle.project.title}» را با اطلاعات مستند، استانداردهای به‌روز، نکات کلیدی جامانده و مثال‌های کاربردی تکمیل کن (۱ تا ۲ پاراگراف منسجم بدون تکرار متن موجود).`,
              'لحن نگارش: رسمی اما شیرین، روان، ساده‌خوان و بدون کلمات قلمبه‌سلمبه؛ اصطلاحات جدید را از پایه و ساده توضیح بده و املای لاتین اصطلاحات فنی را دقیق حفظ کن.',
              chapterExcerpt ? `خلاصه محتوای فعلی این فصل:\n${chapterExcerpt}` : '',
            ]
              .filter(Boolean)
              .join('\n\n');

            const searchOut = await executeUnifiedWebSearch({
              primaryProvider: finalizeProvider,
              searchRoute,
              googleModel: finalizeModel,
              prompt,
              thinkingLevel: ThinkingLevel.LOW,
            });
            await recordProjectAiUsage(projectId, user.uid, searchOut.usageDelta);
            if (searchOut.summary) {
              await updateOutlineNodeWebEnrichment(projectId, node.id, {
                title: node.title,
                summary: searchOut.summary,
                sources: searchOut.sources,
                checkedAt: new Date().toISOString(),
                providerLabel: searchOut.providerLabelFa,
              });
            }
          } catch (gErr) {
            console.warn('Optional web enrichment skipped for node:', node.id, gErr);
            const raw = gErr instanceof Error ? gErr.message : String(gErr || '');
            if (raw.includes('429') || raw.toUpperCase().includes('RESOURCE_EXHAUSTED')) {
              break;
            }
          }
        }
      }

      // Bug #26/Workflow unification: if verified Harness sections exist, compile from Harness IR instead of overwriting with raw concat!
      const cp = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const existingHarness = extractHarnessStateFromCheckpoint(cp);
      let finalBundle: ReturnType<typeof formatBundleForClient> | null = null;
      if (existingHarness && Object.keys(existingHarness.sectionsIR).length > 0) {
        const synced = await syncHarnessToBookSnapshot({ projectId, ownerUid: user.uid });
        finalBundle = synced ? formatBundleForClient(synced.rawBundle) : null;
      } else {
        finalBundle = await reassembleAndPersistProject(projectId, user.uid);
      }

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType: 'document_finalized',
        title: 'تأیید فصل‌بندی و ساخت نسخه نهایی کتاب',
        summary: `نسخه صفحه‌آرایی‌شده سند با ${toPersianDigits(bundle.outlineNodes.length)} فصل و گزارش پوشش ۱۰۰٪ تولید شد.`,
      });
      res.json(finalBundle);
    } catch (err) {
      const formattedErr = formatGeminiError(err, 'خطا در تدوین نهایی و تولید گزارش ممیزی.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 10. RESOLVE CONFLICT
  router.post('/:id/conflicts/:conflictId/resolve', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId, conflictId } = req.params;
      const body = req.body as {
        status?: 'open' | 'keep_both' | 'choose_a' | 'choose_b' | 'resolved_web';
        resolutionNote?: string;
      };
      const validStatuses = new Set(['open', 'keep_both', 'choose_a', 'choose_b', 'resolved_web']);
      if (!body.status || !validStatuses.has(body.status)) {
        res.status(400).json({ error: 'وضعیت حل تناقض نامعتبر است.' });
        return;
      }

      const owned = await getOwnedProject(projectId, user.uid);
      if (!owned) {
        res.status(404).json({ error: 'پروژه یافت نشد یا مجوز دسترسی ندارید.' });
        return;
      }

      const updatedConflict = await updateConflictRecord(projectId, conflictId, {
        status: body.status,
        resolutionNote: body.resolutionNote ?? null,
      });
      if (!updatedConflict) {
        res.status(404).json({ error: 'رکورد تناقض یافت نشد.' });
        return;
      }

      // If project already has a final book snapshot, refresh it so resolution reflects immediately
      const bundle = await getProjectBundle(projectId, user.uid);
      if (bundle?.project.bookSnapshotJson) {
        const refreshed = await reassembleAndPersistProject(projectId, user.uid);
        await recordProjectRevision({
          projectId,
          ownerUid: user.uid,
          actorType: 'user',
          actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
          actionType: 'conflict_resolved',
          title: `ثبت تصمیم روی تناقض «${updatedConflict.topic.slice(0, 60)}»`,
          summary: `وضعیت تناقض به «${body.status}» تغییر یافت${body.resolutionNote ? ` — یادداشت: ${body.resolutionNote.slice(0, 80)}` : ''}.`,
        });
        res.json({ conflict: updatedConflict, bundle: refreshed });
        return;
      }

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType: 'conflict_resolved',
        title: `ثبت تصمیم روی تناقض «${updatedConflict.topic.slice(0, 60)}»`,
        summary: `وضعیت تناقض به «${body.status}» تغییر یافت${body.resolutionNote ? ` — یادداشت: ${body.resolutionNote.slice(0, 80)}` : ''}.`,
      });
      res.json({ conflict: updatedConflict, bundle: bundle ? formatBundleForClient(bundle) : null });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ذخیره تصمیم تناقض.' });
    }
  });

  // 10B. RESCAN & CLEAN FALSE-POSITIVE CONFLICTS (Layer 1 Strict Deterministic + Layer 2 AI Verification)
  // Preserves outlineNodes, webEnrichment, and dedupClusters untouched while removing complementary false positives!
  router.post('/:id/rescan-conflicts', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const previousCount = bundle.conflicts.length;
      const formatted = formatBundleForClient(bundle);
      const fileMap = new Map(formatted.sourceFiles.map((f) => [f.id, f.fileName]));

      // Scan all active (non-merged) paragraph/callout/list units across distinct source files with strict Layer 1
      const eligibleUnits = formatted.contentUnits.filter(
        (u) =>
          u.status !== 'merged' &&
          u.status !== 'merged_duplicate' &&
          (u.unitType === 'paragraph' || u.unitType === 'callout' || u.unitType === 'list')
      );
      const tokenCache = new Map(eligibleUnits.map((u) => [u.id, tokenizeContent(u.rawText)]));

      const candidates: DedupPipelineOutput['conflicts'] = [];
      const seenPairs = new Set<string>();

      // Preserve any existing conflict's user resolution/grounding if it still qualifies as a genuine conflict
      const existingByPair = new Map<string, (typeof bundle.conflicts)[number]>();
      for (const oldC of bundle.conflicts) {
        const pk = [oldC.unitAId, oldC.unitBId].sort().join('::');
        existingByPair.set(pk, oldC);
      }

      for (let i = 0; i < eligibleUnits.length; i++) {
        const a = eligibleUnits[i];
        const tokA = tokenCache.get(a.id) || [];
        for (let j = i + 1; j < eligibleUnits.length; j++) {
          const b = eligibleUnits[j];
          if (a.sourceFileId === b.sourceFileId || a.unitType !== b.unitType) continue;
          const tokB = tokenCache.get(b.id) || [];
          const sim = computeJaccardSimilarity(tokA, tokB);
          if (sim < 0.35) continue;

          if (isGenuineNumericConflict(a.rawText, b.rawText)) {
            const pairKey = [a.id, b.id].sort().join('::');
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);
            const topic =
              (b.headingPath || a.headingPath || 'تناقض مقدار عددی در اسناد')
                .split('>')[0]
                .trim();
            candidates.push({
              id: `conf_${deterministicHash(`${projectId}:${pairKey}`)}`,
              projectId,
              topic,
              unitAId: a.id,
              unitBId: b.id,
              fileAName: fileMap.get(a.sourceFileId) || 'فایل ۱',
              fileBName: fileMap.get(b.sourceFileId) || 'فایل ۲',
              excerptA: a.rawText.slice(0, 420),
              excerptB: b.rawText.slice(0, 420),
              status: 'open',
            });
          }
        }
      }

      const settings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const rescanProvider = settings.useAiBackend !== false ? resolveAiProviderFromRequest(req) : null;
      const { verified, aiVerified, usageDelta } = await verifyConflictsWithAi(
        rescanProvider,
        candidates,
        normalizeGoogleModelId(settings.aiModel)
      );

      const conflictRowsToSave = verified.map((c) => {
        const pairKey = [c.unitAId, c.unitBId].sort().join('::');
        const old = existingByPair.get(pairKey);
        return {
          ...c,
          status: old?.status ?? 'open',
          resolutionNote: old?.resolutionNote ?? null,
          webGroundingJson: (old?.webGroundingJson as Record<string, unknown> | null) ?? null,
        };
      });

      await replaceProjectConflicts({
        projectId,
        conflictRows: conflictRowsToSave,
        conflictUnitIds: conflictRowsToSave.flatMap((c) => [c.unitAId, c.unitBId]),
      });

      const prevCp = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const nextAiUsage = usageDelta
        ? mergeAiUsageDelta(extractAiUsageFromCheckpoint(prevCp), usageDelta)
        : extractAiUsageFromCheckpoint(prevCp);

      await updateProjectRecord(projectId, user.uid, {
        checkpointJson: {
          ...prevCp,
          conflictsCount: conflictRowsToSave.length,
          aiUsage: nextAiUsage,
          lastConflictRescanAt: new Date().toISOString(),
        },
      });

      const refreshed = bundle.project.bookSnapshotJson
        ? await reassembleAndPersistProject(projectId, user.uid)
        : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: aiVerified ? 'ai' : 'system',
        actorName: aiVerified ? 'هوش مصنوعی (پالایش تناقض)' : 'موتور پالایش تناقض',
        actionType: 'conflicts_rescanned',
        title: 'پالایش دقیق تناقض‌ها و حذف موارد مکمل',
        summary: `${toPersianDigits(Math.max(0, previousCount - conflictRowsToSave.length))} مورد غیرمتناقض حذف و ${toPersianDigits(conflictRowsToSave.length)} تناقض واقعی حفظ شد.`,
      });

      res.json({
        previousCount,
        currentCount: conflictRowsToSave.length,
        removedCount: Math.max(0, previousCount - conflictRowsToSave.length),
        aiVerified,
        bundle: refreshed,
      });
    } catch (err) {
      console.error('[Rescan conflicts error]:', err);
      const formattedErr = formatGeminiError(err, 'خطا در پالایش مجدد تناقض‌ها.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 11. UNIFIED MULTI-PROVIDER WEB SEARCH GROUNDING (Google Search / Perplexity Sonar / Anthropic Web Search / OpenAI Online)
  router.post('/:id/grounding', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const primaryProvider = resolveAiProviderFromRequest(req);
      const searchRoute = resolveWebSearchRouteFromRequest(req);
      const settings = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const groundingModel = normalizeGoogleModelId(settings.aiModel);

      const body = req.body as {
        targetType: 'conflict' | 'outline_node' | 'full_document';
        targetId?: string;
        customQuery?: string;
      };

      if (body.targetType === 'conflict') {
        const conf = bundle.conflicts.find((c) => c.id === body.targetId);
        if (!conf) {
          res.status(404).json({ error: 'تناقض موردنظر یافت نشد.' });
          return;
        }

        const prompt = [
          'دو فایل مختلف درباره یک موضوع اطلاعات متفاوت یا متناقضی ارائه داده‌اند. با استفاده از جستجوی زنده وب، صحت علمی/فنی هر دو روایت را بررسی کن و به فارسی دقیق و مستند پاسخ بده:',
          `موضوع: ${conf.topic}`,
          `روایت ۱ (${conf.fileAName}): ${conf.excerptA}`,
          `روایت ۲ (${conf.fileBName}): ${conf.excerptB}`,
          body.customQuery ? `پرسش تکمیلی کاربر: ${body.customQuery}` : '',
          'لطفاً در حداکثر یک پاراگراف شفاف توضیح بده کدام مقدار یا شرط از نظر منابع معتبر دقیق‌تر است و در چه شرایطی هرکدام صحیح هستند.',
        ]
          .filter(Boolean)
          .join('\n');

        const searchOut = await executeUnifiedWebSearch({
          primaryProvider,
          searchRoute,
          googleModel: groundingModel,
          prompt,
          thinkingLevel: ThinkingLevel.MEDIUM,
        });

        const webGroundingJson = {
          summary: searchOut.summary,
          sources: searchOut.sources,
          checkedAt: new Date().toISOString(),
          query: body.customQuery || conf.topic,
          providerLabel: searchOut.providerLabelFa,
        };

        await updateConflictRecord(projectId, conf.id, { webGroundingJson });
        await recordProjectAiUsage(projectId, user.uid, searchOut.usageDelta);
        const refreshed = bundle.project.bookSnapshotJson
          ? await reassembleAndPersistProject(projectId, user.uid)
          : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

        res.json({ webGrounding: webGroundingJson, bundle: refreshed });
        return;
      }

      if (body.targetType === 'outline_node') {
        const node = bundle.outlineNodes.find((n) => n.id === body.targetId);
        if (!node) {
          res.status(404).json({ error: 'فصل موردنظر یافت نشد.' });
          return;
        }

        const chapterExcerpt = buildChapterExcerpt(bundle.contentUnits, node.id, 2200);
        const prompt = [
          `با استفاده از جستجوی زنده وب، درباره فصل «${node.title}» در سند «${bundle.project.title}» یک باکس اطلاعات تکمیلی به‌روز، مستند و کاربردی (۱ تا ۲ پاراگراف دقیق) بنویس تا نکات علمی یا عملی جاافتاده از متن فعلی را کامل کند.`,
          'لحن نگارش: رسمی اما شیرین، ساده‌خوان و بدون کلمات قلمبه‌سلمبه؛ مفاهیم جدید را برای خواننده بدون پیش‌زمینه شفاف کن و اصطلاحات لاتین را دقیق نگه دار.',
          chapterExcerpt ? `متن فعلی فصل:\n${chapterExcerpt}` : '',
          body.customQuery ? `تأکید کاربر: ${body.customQuery}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        const searchOut = await executeUnifiedWebSearch({
          primaryProvider,
          searchRoute,
          googleModel: groundingModel,
          prompt,
          thinkingLevel: ThinkingLevel.LOW,
        });

        const webEnrichmentJson = {
          title: node.title,
          summary: searchOut.summary,
          sources: searchOut.sources,
          checkedAt: new Date().toISOString(),
          providerLabel: searchOut.providerLabelFa,
        };

        await updateOutlineNodeWebEnrichment(projectId, node.id, webEnrichmentJson);

        await recordProjectAiUsage(projectId, user.uid, searchOut.usageDelta);

        const refreshed = bundle.project.bookSnapshotJson
          ? await reassembleAndPersistProject(projectId, user.uid)
          : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

        res.json({ webEnrichment: webEnrichmentJson, bundle: refreshed });
        return;
      }

      if (body.targetType === 'full_document') {
        const nodes = [...bundle.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);
        if (nodes.length === 0) {
          res.status(400).json({ error: 'ابتدا مرحله استخراج و فصل‌بندی سند را اجرا کنید.' });
          return;
        }

        let enrichedChaptersCount = 0;
        let failedChaptersCount = 0;
        let quotaError: { statusCode: number; message: string } | null = null;
        let lastSearchProviderLabel = 'جستجوی زنده وب';

        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const chapterExcerpt = buildChapterExcerpt(bundle.contentUnits, node.id, 2400);
          const prompt = [
            `شما پژوهشگر فنی و ویراستار علمی هستید. با استفاده از جستجوی زنده وب، متن فصل «${node.title}» از سند «${bundle.project.title}» را تکمیل و غنی کن.`,
            'قواعد مهم:',
            '۱) مطالب تکراری موجود در متن فعلی را بازنویسی نکن؛ فقط جزئیات تکمیلی، استانداردهای جدید، اعداد مرجع، نکات ایمنی/عملی و مثال‌های مستند جاافتاده را در ۱ تا ۲ پاراگراف فارسی رسمی اما شیرین، ساده‌خوان و بدون کلمات قلمبه‌سلمبه بنویس.',
            '۲) مفاهیم جدید را بدون فرض پیش‌دانش شفاف توضیح بده، اصطلاحات لاتین را دقیق حفظ کن و فقط به منابع معتبر وب استناد کن.',
            chapterExcerpt ? `محتوای فعلی فصل:\n${chapterExcerpt}` : '',
            body.customQuery ? `دستور تکمیلی کاربر: ${body.customQuery}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');

          try {
            const searchOut = await executeUnifiedWebSearch({
              primaryProvider,
              searchRoute,
              googleModel: groundingModel,
              prompt,
              thinkingLevel: ThinkingLevel.LOW,
            });
            lastSearchProviderLabel = searchOut.providerLabelFa;
            await recordProjectAiUsage(projectId, user.uid, searchOut.usageDelta);
            if (searchOut.summary) {
              await updateOutlineNodeWebEnrichment(projectId, node.id, {
                title: `تکمیل جامع از وب (${searchOut.providerLabelFa}) — ${node.title}`,
                summary: searchOut.summary,
                sources: searchOut.sources,
                checkedAt: new Date().toISOString(),
              });
              enrichedChaptersCount += 1;
            }
            if (i < nodes.length - 1) {
              await new Promise((r) => setTimeout(r, 350));
            }
          } catch (chapterErr) {
            failedChaptersCount += 1;
            const parsedErr = formatGeminiError(chapterErr, 'خطا در جستجوی وب برای فصل.');
            if (parsedErr.statusCode === 429) {
              quotaError = parsedErr;
              break;
            }
          }
        }

        if (enrichedChaptersCount === 0 && quotaError) {
          res.status(429).json({ error: quotaError.message });
          return;
        }

        const refreshed = bundle.project.bookSnapshotJson
          ? await reassembleAndPersistProject(projectId, user.uid)
          : await getProjectBundle(projectId, user.uid).then((b) => (b ? formatBundleForClient(b) : null));

        await recordProjectRevision({
          projectId,
          ownerUid: user.uid,
          actorType: 'ai',
          actorName: `هوش مصنوعی + ${lastSearchProviderLabel}`,
          actionType: 'web_grounding',
          title: `تکمیل کل سند با ${lastSearchProviderLabel}`,
          summary: `${toPersianDigits(enrichedChaptersCount)} فصل از ${toPersianDigits(nodes.length)} فصل با منابع معتبر وب تکمیل شد.`,
        });

        res.json({
          enrichedChaptersCount,
          failedChaptersCount,
          totalChapters: nodes.length,
          warning: quotaError?.message,
          bundle: refreshed,
        });
        return;
      }

      res.status(400).json({ error: 'نوع هدف جستجوی وب معتبر نیست.' });
    } catch (err) {
      const formattedErr = formatGeminiError(err, 'خطا در اجرای جستجوی زنده وب.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 11A. AUDIO / VOICE FILE TRANSCRIPTION (Gemini 3.5 Transcribe / OpenAI Whisper / Groq Whisper / Custom Whisper)
  router.post('/:id/transcribe-audio', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = req.body as {
        audioBase64?: string;
        mimeType?: string;
        fileName?: string;
        addAsSourceFile?: boolean;
        role?: FileRole;
      };

      const rawBase64 = String(body.audioBase64 || '').trim();
      if (!rawBase64) {
        res.status(400).json({ error: 'داده فایل صوتی ارسال نشده است.' });
        return;
      }

      // Limit decoded size to ~18MB to protect server memory
      const approxBytes = Math.floor((rawBase64.length * 3) / 4);
      if (approxBytes > 18 * 1024 * 1024) {
        res.status(413).json({
          error: 'حجم فایل صوتی بیش از ۱۸ مگابایت است. لطفاً فایل را کوتاه‌تر یا با فرمت MP3/OGG فشرده‌تر ارسال کنید.',
        });
        return;
      }

      const allowedMimes = new Set([
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/x-wav',
        'audio/wave',
        'audio/mp4',
        'audio/m4a',
        'audio/x-m4a',
        'audio/ogg',
        'audio/webm',
        'audio/flac',
        'audio/aac',
      ]);
      const rawMime = String(body.mimeType || 'audio/mpeg').toLowerCase().split(';')[0].trim();
      const mimeType = allowedMimes.has(rawMime) ? rawMime : 'audio/mpeg';
      const fileName = String(body.fileName || 'voice-note.mp3').trim().slice(0, 120);

      const primaryProvider = resolveAiProviderFromRequest(req);
      const audioRoute = resolveAudioRouteFromRequest(req);

      const sttResult = await transcribeAudioUnified({
        audioRoute,
        primaryProvider,
        audioBase64: rawBase64,
        mimeType,
        fileName,
      });

      // Layer 0 Post-ASR Automotive Glossary Alignment
      const alignedAudio = alignPostAsrAutomotiveTerms(sttResult.transcript);
      sttResult.transcript = alignedAudio.alignedText;

      await recordProjectAiUsage(projectId, user.uid, sttResult.usageDelta);

      // Isolated background enqueue for automotive audio transcripts
      void enqueueAutomotiveDocumentForEncyclopediaIsolated({
        fileName,
        format: 'md',
        rawText: sttResult.transcript,
        userUid: user.uid,
        userEmail: user.email,
        isGuest: Boolean(user.isGuest),
      });

      let sourceFileAdded: { fileName: string; unitCount: number; wordCount: number } | null = null;
      let refreshedBundle: ReturnType<typeof formatBundleForClient> | null = null;

      if (body.addAsSourceFile) {
        const baseLabel = fileName.replace(/\.(mp3|wav|m4a|ogg|webm|flac|aac|mp4)$/i, '');
        const transcriptFileName = `ویس-${baseLabel}.md`;
        const markdownBody = `# رونویسی صوتی: ${baseLabel}\n\n${sttResult.transcript}\n`;

        const parsed = await parseAnySourceFile({
          name: transcriptFileName,
          format: 'md',
          text: markdownBody,
        });

        const fileId = `sf_${deterministicHash(`${projectId}:${transcriptFileName}:${Date.now()}:${Math.random()}`)}`;
        const atomicUnits = extractAtomicUnitsFromBook({
          projectId,
          sourceFileId: fileId,
          fileName: transcriptFileName,
          fileRole: body.role ?? 'supplement',
          book: parsed,
          startingOrder: bundle.contentUnits.length,
        });

        const wordCount = atomicUnits.reduce(
          (sum, u) => sum + u.rawText.split(/\s+/).filter(Boolean).length,
          0
        );
        const checksum = deterministicHash(atomicUnits.map((u) => u.normalizedHash).join('|'));

        await insertSourceFileWithUnits({
          file: {
            id: fileId,
            projectId,
            fileName: transcriptFileName,
            format: 'md',
            role: body.role ?? 'supplement',
            sizeBytes: Buffer.byteLength(markdownBody, 'utf8'),
            wordCount,
            fileHash: checksum,
            metadataJson: {
              unitCount: atomicUnits.length,
              transcribedFromAudio: fileName,
              sttModel: sttResult.modelUsed,
              sttProvider: sttResult.providerLabelFa,
            },
          },
          units: atomicUnits.map((u) => ({
            id: u.id,
            projectId: u.projectId,
            sourceFileId: u.sourceFileId,
            unitType: u.unitType,
            unitOrder: u.unitOrder,
            rawText: u.rawText,
            contentHash: u.normalizedHash,
            status: u.status,
            canonicalUnitId: null,
            outlineNodeId: null,
            payloadJson: {
              ...(u.metadataJson || {}),
              headingPath: u.headingPath,
            },
          })),
        });

        sourceFileAdded = {
          fileName: transcriptFileName,
          unitCount: atomicUnits.length,
          wordCount,
        };

        await recordProjectRevision({
          projectId,
          ownerUid: user.uid,
          actorType: 'ai',
          actorName: `تبدیل صوت به متن (${sttResult.providerLabelFa})`,
          actionType: 'files_ingested',
          title: `افزودن فایل صوتی «${fileName}» به منابع پروژه`,
          summary: `${toPersianDigits(wordCount)} کلمه و ${toPersianDigits(atomicUnits.length)} واحد متنی با مدل ${sttResult.modelUsed} پیاده‌سازی و ثبت شد.`,
        });

        const fresh = await getProjectBundle(projectId, user.uid);
        if (fresh) {
          refreshedBundle = formatBundleForClient(fresh);
        }
      }

      res.json({
        transcript: sttResult.transcript,
        modelUsed: sttResult.modelUsed,
        providerLabelFa: sttResult.providerLabelFa,
        sourceFileAdded,
        bundle: refreshedBundle,
      });
    } catch (err) {
      const formattedErr = formatGeminiError(err, 'خطا در تبدیل فایل صوتی به متن.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 11B. HIGH-REASONING DEEP AI REVIEW & LOSSLESS IMPROVEMENT PASS (Gemini 4 Hydrogen + XHIGH)
  router.post('/:id/deep-review', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }
      if (bundle.outlineNodes.length === 0) {
        res.status(400).json({ error: 'ابتدا مرحله استخراج و فصل‌بندی سند را اجرا کنید.' });
        return;
      }

      const deepSettingsPre = (bundle.project.settingsJson || {}) as Partial<DocxExportConfig>;
      const deepTaskCtx = resolveProviderForTaskFromRequest(
        req,
        'deep_review',
        normalizeGoogleModelId(deepSettingsPre.aiModel)
      );
      const deepProvider = deepTaskCtx.provider;
      if (deepProvider.validationError) {
        res.status(400).json({ error: deepProvider.validationError });
        return;
      }
      if (!deepProvider.apiKey) {
        res.status(503).json({
          error:
            'کلید API هوش مصنوعی فعال نیست. می‌توانید کلید شخصی Google AI Studio یا ارائه‌دهنده سفارشی خود را در بخش تنظیمات وارد کنید.',
        });
        return;
      }

      // Enforce Hard Cost Cap BEFORE invoking expensive Flagship model
      const currentUsageBeforeReview = extractAiUsageFromCheckpoint(
        (bundle.project.checkpointJson || {}) as Record<string, unknown>
      );
      const deepCapCheck = checkHardCostCap(currentUsageBeforeReview, deepTaskCtx.hardCostCapUsd);
      if (!deepCapCheck.allowed) {
        res.status(402).json({ error: deepCapCheck.errorMessageFa });
        return;
      }

      const body = (req.body || {}) as { focusNote?: string; stream?: boolean };
      const wantsStream =
        Boolean(body.stream) ||
        String(req.headers.accept || '')
          .toLowerCase()
          .includes('application/x-ndjson');

      const emitStream = (payload: Record<string, unknown>) => {
        if (!wantsStream || res.writableEnded) return;
        try {
          res.write(`${JSON.stringify(payload)}\n`);
          (res as unknown as { flush?: () => void }).flush?.();
        } catch {
          // Ignore write errors if client disconnected
        }
      };

      if (wantsStream) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }

      const nodes = [...bundle.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);

      emitStream({
        type: 'progress',
        percent: 8,
        stage: `بررسی ساختار ${toPersianDigits(nodes.length)} فصل و فشرده‌سازی هوشمند کانتکست (${deepTaskCtx.tierLabelFa})...`,
      });

      // Entity-preserving extractive compression + compact wire notation (-35% to -55% prompt tokens!)
      const digestWire = buildCompactChapterDigestsWire({
        nodes,
        units: bundle.contentUnits,
        optimizationMode: deepTaskCtx.optimizationMode,
      });
      const detailedNodeLimit = digestWire.detailedNodeCount;

      // Technical Fact Anchor Ledger for Anti-Drift & Anti-Hallucination verification
      const factLedger = extractTechnicalFactLedger(bundle.contentUnits, nodes);
      const antiDriftContract = deepTaskCtx.enableAntiDriftGuard
        ? buildAntiDriftContract(factLedger, 'deep_review')
        : '';

      const editorialDirective = buildEditorialSystemDirective(bundle.project.settingsJson);

      const deepSystemInstruction = [
        'شما سردبیر ارشد فنی و ممیز کیفیت اسناد حرفه‌ای ریمپ و کالیبراسیون ECU به زبان فارسی هستید.',
        editorialDirective,
        antiDriftContract,
        'قانون مطلق عدم افت محتوا (Strict Zero-Loss): هیچ بخشی از متن اصلی کاربر را حذف نکن؛ فقط بهبودهای افزایشی و ساختاری (اصلاح عنوان فصل، افزودن باکس نکته/هشدار/جمع‌بندی، ساخت جدول مقایسه‌ای/راهنمای WinOLS و افزودن پاراگراف پیوندی یا تعریف جامانده) ارائه بده.',
        'نکته فرمت جدول: در addedTables هر ردیف داخل آرایه rows باید یک رشته با جداکننده « | » بین ستون‌ها باشد (مثلاً: "مقدار اول | مقدار دوم | توضیح").',
        'خروجی باید صرفاً یک شیء JSON معتبر مطابق ساختار خواسته‌شده باشد.',
      ]
        .filter(Boolean)
        .join('\n\n');

      const prompt = [
        `سند «${bundle.project.title}» (حالت: ${bundle.project.workflowMode}) را با بالاترین دقت ممیزی کن و هرگونه نقص ساختاری، عنوان مبهم، نبود هشدار کلیدی، داده متراکم قابل تبدیل به جدول WinOLS (شامل نام نقشه، آدرس هگز مستند، ناحیه دور/بار و تغییر)، یا شکاف منطقی بین فصل‌ها را کشف و برطرف کن.`,
        body.focusNote ? `تمرکز ویژه درخواست‌شده توسط کاربر: ${body.focusNote}` : '',
        `چکیده فشرده و با چگالی بالای فنی فصل‌های سند:\n${digestWire.wireText}`,
        bundle.conflicts.length > 0
          ? `تعداد تناقض‌های شناسایی‌شده بین فایل‌ها: ${bundle.conflicts.length}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const deepReviewSchema = {
        type: Type.OBJECT,
        properties: {
          overallScore: { type: Type.INTEGER, description: 'امتیاز کیفیت سند از ۱ تا ۱۰۰' },
          overallAssessment: { type: Type.STRING, description: 'جمع‌بندی کوتاه فارسی وضعیت سند و بهبودها' },
          findings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                severity: { type: Type.STRING, description: 'high | medium | low' },
                category: { type: Type.STRING },
                chapterTitle: { type: Type.STRING },
                issue: { type: Type.STRING },
                fixApplied: { type: Type.STRING },
              },
              required: ['severity', 'category', 'chapterTitle', 'issue', 'fixApplied'],
            },
          },
          titleRefinements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                newTitle: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'newTitle', 'rationale'],
            },
          },
          addedCallouts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                variant: { type: Type.STRING, description: 'concept | warning | engineering | revision | qa' },
                title: { type: Type.STRING },
                body: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'variant', 'title', 'body', 'rationale'],
            },
          },
          addedTables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                caption: { type: Type.STRING },
                headers: { type: Type.ARRAY, items: { type: Type.STRING } },
                rows: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'هر ردیف به‌صورت رشته با جداکننده | بین ستون‌ها',
                },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'caption', 'headers', 'rows', 'rationale'],
            },
          },
          addedParagraphs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodeId: { type: Type.STRING },
                sectionTitle: { type: Type.STRING },
                text: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
              required: ['nodeId', 'sectionTitle', 'text', 'rationale'],
            },
          },
        },
        required: ['overallScore', 'overallAssessment', 'findings'],
      };

      type DeepReviewParsed = {
        overallScore?: number;
        overallAssessment?: string;
        findings?: Array<{
          severity?: string;
          category?: string;
          chapterTitle?: string;
          issue?: string;
          fixApplied?: string;
        }>;
        titleRefinements?: Array<{ nodeId?: string; newTitle?: string; rationale?: string }>;
        addedCallouts?: Array<{
          nodeId?: string;
          variant?: string;
          title?: string;
          body?: string;
          rationale?: string;
        }>;
        addedTables?: Array<{
          nodeId?: string;
          caption?: string;
          headers?: string[];
          rows?: Array<string | string[]>;
          rationale?: string;
        }>;
        addedParagraphs?: Array<{
          nodeId?: string;
          sectionTitle?: string;
          text?: string;
          rationale?: string;
        }>;
      };

      const deepReviewJsonSchema: Record<string, unknown> = {
        type: 'object',
        additionalProperties: false,
        properties: {
          overallScore: { type: 'integer' },
          overallAssessment: { type: 'string' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                severity: { type: 'string' },
                category: { type: 'string' },
                chapterTitle: { type: 'string' },
                issue: { type: 'string' },
                fixApplied: { type: 'string' },
              },
              required: ['severity', 'category', 'chapterTitle', 'issue', 'fixApplied'],
            },
          },
          titleRefinements: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                nodeId: { type: 'string' },
                newTitle: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['nodeId', 'newTitle', 'rationale'],
            },
          },
          addedCallouts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                nodeId: { type: 'string' },
                variant: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['nodeId', 'variant', 'title', 'body', 'rationale'],
            },
          },
          addedTables: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                nodeId: { type: 'string' },
                caption: { type: 'string' },
                headers: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'string' } },
                rationale: { type: 'string' },
              },
              required: ['nodeId', 'caption', 'headers', 'rows', 'rationale'],
            },
          },
          addedParagraphs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                nodeId: { type: 'string' },
                sectionTitle: { type: 'string' },
                text: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['nodeId', 'sectionTitle', 'text', 'rationale'],
            },
          },
        },
        required: ['overallScore', 'overallAssessment', 'findings'],
      };

      const preferredDeepModel = normalizeGoogleModelId(deepTaskCtx.googleModel);
      const deepCapProfile = isNonGoogleProvider(deepProvider)
        ? resolveProviderCapabilityProfile({
            provider: deepProvider.provider,
            baseUrl: deepProvider.baseUrl,
            modelId: deepProvider.customModelId,
            customProfile: deepProvider.customModels?.[deepProvider.customModelId],
          })
        : null;

      // Resilient multi-tier reasoning ladder using configured Flagship/Primary model
      const reviewAttempts: Array<{
        model: string;
        level: ThinkingLevel;
        levelLabel: DeepReviewReportDto['thinkingLevel'];
        useSchema: boolean;
      }> =
        isNonGoogleProvider(deepProvider)
          ? [
              {
                model: deepProvider.customModelId,
                level: ThinkingLevel.HIGH,
                levelLabel: 'HIGH',
                useSchema: Boolean(deepCapProfile?.supportsJsonSchema),
              },
            ]
          : preferredDeepModel === 'gemini-3.8-flash'
            ? [
                { model: 'gemini-3.8-flash', level: ThinkingLevel.HIGH, levelLabel: 'HIGH', useSchema: true },
                { model: 'gemini-4-hydrogen', level: ThinkingLevel.XHIGH, levelLabel: 'XHIGH', useSchema: true },
                { model: 'gemini-4-hydrogen', level: ThinkingLevel.HIGH, levelLabel: 'HIGH', useSchema: false },
              ]
            : [
                { model: 'gemini-4-hydrogen', level: ThinkingLevel.XHIGH, levelLabel: 'XHIGH', useSchema: true },
                { model: 'gemini-4-hydrogen', level: ThinkingLevel.HIGH, levelLabel: 'HIGH', useSchema: true },
                { model: 'gemini-3.8-flash', level: ThinkingLevel.HIGH, levelLabel: 'HIGH', useSchema: true },
                { model: 'gemini-3.8-flash', level: ThinkingLevel.MEDIUM, levelLabel: 'MEDIUM', useSchema: false },
              ];

      emitStream({
        type: 'progress',
        percent: 18,
        stage: `آماده‌سازی چکیده فشرده ${toPersianDigits(detailedNodeLimit)} فصل (صرفه‌جویی ${toPersianDigits(digestWire.savingsPercent)}٪ توکن ورودی) و سپر ضد انحراف...`,
      });

      let parsed: DeepReviewParsed | null = null;
      let modelUsed = reviewAttempts[0].model;
      let thinkingLevelUsed: DeepReviewReportDto['thinkingLevel'] = reviewAttempts[0].levelLabel;
      let deepReviewUsageDelta: AiUsageDelta | null = null;
      let lastAiErr: unknown = null;

      for (let i = 0; i < reviewAttempts.length; i++) {
        const attempt = reviewAttempts[i];
        const basePct = Math.min(62, 24 + i * 10);
        let currentPct = basePct;

        emitStream({
          type: 'progress',
          percent: currentPct,
          stage:
            i === 0
              ? `در حال تحلیل عمیق سند با مدل ${attempt.model} (${deepTaskCtx.tierLabelFa} · ${attempt.levelLabel})...`
              : `تلاش مجدد با مسیر جایگزین ${attempt.model} (سطح ${attempt.levelLabel})...`,
          model: attempt.model,
          thinkingLevel: attempt.levelLabel,
          attempt: i + 1,
          totalAttempts: reviewAttempts.length,
        });

        const heartbeat = wantsStream
          ? setInterval(() => {
              currentPct = Math.min(73, currentPct + 3);
              emitStream({
                type: 'progress',
                percent: currentPct,
                stage: `در حال استدلال عمیق روی ساختار، عناوین، جداول و شکاف‌های منطقی (${attempt.levelLabel})...`,
                model: attempt.model,
                thinkingLevel: attempt.levelLabel,
                attempt: i + 1,
                totalAttempts: reviewAttempts.length,
              });
            }, 2500)
          : null;

        try {
          const aiRes = await generateUnifiedTextOrJson({
            provider: deepProvider,
            googleModel: attempt.model,
            thinkingLevel: attempt.level,
            systemInstruction: deepSystemInstruction,
            prompt,
            expectJson: true,
            googleResponseSchema: attempt.useSchema ? deepReviewSchema : undefined,
            jsonSchema: attempt.useSchema ? deepReviewJsonSchema : undefined,
            enablePromptCaching: deepTaskCtx.enablePromptCaching,
            savedTokensByOptimization: digestWire.estimatedTokensSaved,
            usageFlags: { isDeepReview: true },
          });
          const candidate = safeParseGeminiJson<DeepReviewParsed | null>(aiRes.text, null);
          if (candidate && (candidate.overallAssessment || Array.isArray(candidate.findings))) {
            parsed = candidate;
            modelUsed = aiRes.modelUsed;
            thinkingLevelUsed = attempt.levelLabel;
            deepReviewUsageDelta = aiRes.usageDelta;
            break;
          }
          lastAiErr = new Error('پاسخ JSON ساختاریافته از مدل هوش مصنوعی دریافت نشد.');
        } catch (attemptErr) {
          lastAiErr = attemptErr;
          console.warn(
            `[DeepReview] Attempt ${i + 1}/${reviewAttempts.length} (${attempt.model}/${attempt.levelLabel}) failed:`,
            attemptErr instanceof Error ? attemptErr.message.slice(0, 260) : attemptErr
          );
          const rawMsg = attemptErr instanceof Error ? attemptErr.message.toUpperCase() : '';
          if (
            rawMsg.includes('401') ||
            rawMsg.includes('403') ||
            rawMsg.includes('PERMISSION_DENIED') ||
            rawMsg.includes('API_KEY_INVALID')
          ) {
            break;
          }
          if (i < reviewAttempts.length - 1) {
            await new Promise((r) => setTimeout(r, 800));
          }
        } finally {
          if (heartbeat) clearInterval(heartbeat);
        }
      }

      if (!parsed) {
        throw lastAiErr || new Error('پاسخی از سرویس بازبینی عمیق دریافت نشد.');
      }

      emitStream({
        type: 'progress',
        percent: 78,
        stage: 'اجرای سپر ضد انحراف و ضد توهم هگز روی گزارش هوش مصنوعی...',
        model: modelUsed,
        thinkingLevel: thinkingLevelUsed,
      });

      const antiDriftCheck = deepTaskCtx.enableAntiDriftGuard
        ? validateDeepReviewOutput(parsed, nodes, factLedger)
        : {
            sanitized: parsed,
            droppedInvalidNodes: 0,
            flaggedHallucinatedHex: [] as string[],
            driftWarningsFa: [] as string[],
            integrityScore: 100,
          };
      parsed = antiDriftCheck.sanitized;

      const validNodeIds = new Set(nodes.map((n) => n.id));
      const fallbackNode = nodes[0];
      const defaultSourceFileId = bundle.sourceFiles[0]?.id;

      let titlesRefined = 0;
      let calloutsAdded = 0;
      let tablesAdded = 0;
      let paragraphsAdded = 0;

      // 1. Apply chapter title refinements (if any)
      if (Array.isArray(parsed.titleRefinements) && parsed.titleRefinements.length > 0) {
        const nextNodes = nodes.map((n) => ({ ...n }));
        for (const tr of parsed.titleRefinements) {
          if (!tr.nodeId || !tr.newTitle || tr.newTitle.trim().length < 3) continue;
          const target = nextNodes.find((n) => n.id === tr.nodeId);
          if (target && target.title !== tr.newTitle.trim()) {
            target.title = tr.newTitle.trim();
            titlesRefined += 1;
          }
        }
        if (titlesRefined > 0) {
          await updateOutlineNodesOrderAndApproval(
            projectId,
            nextNodes.map((n, idx) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: idx + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );
        }
      }

      // 2. Insert lossless additive improvements into content_units with explicit AI Review provenance
      let nextOrder =
        bundle.contentUnits.reduce((maxOrd, u) => Math.max(maxOrd, u.unitOrder || 0), 0) + 1;
      const resolveTargetNode = (nid?: string) =>
        (nid && validNodeIds.has(nid) ? nodes.find((n) => n.id === nid) : null) || fallbackNode;

      if (defaultSourceFileId) {
        for (const co of (parsed.addedCallouts || []).slice(0, 6)) {
          const title = String(co.title || '').trim();
          const bodyText = String(co.body || '').trim();
          if (!title || !bodyText) continue;
          const targetNode = resolveTargetNode(co.nodeId);
          const unitId = `u_rev_co_${crypto.randomBytes(4).toString('hex')}`;
          const rawText = `${title}\n${bodyText}`;
          await insertContentUnitRecord({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder++,
            unitType: 'callout',
            rawText,
            contentHash: deterministicHash(`rev_callout::${normalizePersianForComparison(rawText)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode.id,
            payloadJson: {
              headingPath: `${targetNode.title} > نکات تکمیلی بازبینی هوشمند`,
              fileName: `بازبینی عمیق هوش مصنوعی (${thinkingLevelUsed})`,
              fileRole: 'supplement',
              block: {
                type: 'callout',
                id: unitId,
                variant: ['concept', 'warning', 'engineering', 'revision', 'qa', 'project'].includes(
                  String(co.variant || '')
                )
                  ? String(co.variant)
                  : 'concept',
                title,
                paragraphs: bodyText.split(/\n+/).filter(Boolean),
              },
            },
          });
          calloutsAdded += 1;
        }

        for (const tbl of (parsed.addedTables || []).slice(0, 4)) {
          const caption = String(tbl.caption || '').trim();
          const headers = Array.isArray(tbl.headers)
            ? tbl.headers.map((h) => String(h || '').trim()).filter(Boolean)
            : [];
          const rows: string[][] = Array.isArray(tbl.rows)
            ? tbl.rows
                .map((r) => {
                  if (Array.isArray(r)) return r.map((c) => String(c || '').trim());
                  return String(r || '')
                    .split('|')
                    .map((c) => c.trim());
                })
                .filter((cells) => cells.length > 0 && cells.some((c) => c.length > 0))
                .map((cells) => {
                  if (cells.length === headers.length) return cells;
                  if (cells.length > headers.length) return cells.slice(0, headers.length);
                  return [...cells, ...Array(headers.length - cells.length).fill('—')];
                })
            : [];
          if (!caption || headers.length < 2 || rows.length === 0) continue;
          const targetNode = resolveTargetNode(tbl.nodeId);
          const unitId = `u_rev_tbl_${crypto.randomBytes(4).toString('hex')}`;
          const rawText = [
            caption,
            headers.join(' | '),
            ...rows.map((r) => r.join(' | ')),
          ].join('\n');
          await insertContentUnitRecord({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder++,
            unitType: 'table',
            rawText,
            contentHash: deterministicHash(`rev_table::${normalizePersianForComparison(rawText)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode.id,
            payloadJson: {
              headingPath: `${targetNode.title} > جمع‌بندی جدولی بازبینی هوشمند`,
              fileName: `بازبینی عمیق هوش مصنوعی (${thinkingLevelUsed})`,
              fileRole: 'supplement',
              block: {
                type: 'table',
                id: unitId,
                caption,
                headers,
                rows,
                generatedBy: 'ai',
                rationale: tbl.rationale || 'ساخته‌شده در بازبینی عمیق هوش مصنوعی',
              },
            },
          });
          tablesAdded += 1;
        }

        for (const para of (parsed.addedParagraphs || []).slice(0, 5)) {
          const text = String(para.text || '').trim();
          if (text.length < 25) continue;
          const targetNode = resolveTargetNode(para.nodeId);
          const unitId = `u_rev_p_${crypto.randomBytes(4).toString('hex')}`;
          const sectionTitle = String(para.sectionTitle || 'توضیح تکمیلی بازبینی عمیق').trim();
          await insertContentUnitRecord({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder++,
            unitType: 'paragraph',
            rawText: text,
            contentHash: deterministicHash(`rev_para::${normalizePersianForComparison(text)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode.id,
            payloadJson: {
              headingPath: `${targetNode.title} > ${sectionTitle}`,
              fileName: `بازبینی عمیق هوش مصنوعی (${thinkingLevelUsed})`,
              fileRole: 'supplement',
              block: {
                type: 'paragraph',
                id: unitId,
                text,
              },
            },
          });
          paragraphsAdded += 1;
        }
      }

      const findings: DeepReviewFinding[] = (Array.isArray(parsed.findings) ? parsed.findings : [])
        .slice(0, 12)
        .map((f) => ({
          severity: f.severity === 'high' || f.severity === 'low' ? f.severity : 'medium',
          category: String(f.category || 'بهبود ساختاری'),
          chapterTitle: String(f.chapterTitle || 'کل سند'),
          issue: String(f.issue || ''),
          fixApplied: String(f.fixApplied || 'در نسخه جدید سند اعمال شد'),
        }));

      const review: DeepReviewReportDto = {
        reviewedAt: new Date().toISOString(),
        modelUsed,
        thinkingLevel: thinkingLevelUsed,
        overallScore: Math.max(1, Math.min(100, Number(parsed.overallScore || 90))),
        overallAssessment:
          String(parsed.overallAssessment || '').trim() ||
          'بازبینی عمیق سند با موفقیت انجام شد و بهبودهای پیشنهادی بدون حذف هیچ محتوایی در سند اعمال گردید.',
        appliedCounts: {
          titlesRefined,
          calloutsAdded,
          tablesAdded,
          paragraphsAdded,
        },
        findings,
        tierUsed: deepTaskCtx.tierLabelFa,
        tokenSavingsPercent: digestWire.savingsPercent,
        antiDriftIntegrityScore: antiDriftCheck.integrityScore,
        ...(antiDriftCheck.driftWarningsFa.length > 0
          ? { antiDriftWarnings: antiDriftCheck.driftWarningsFa }
          : {}),
      };

      const prevReviewCp = (bundle.project.checkpointJson || {}) as Record<string, unknown>;
      const updatedUsageAfterReview = deepReviewUsageDelta
        ? mergeAiUsageDelta(extractAiUsageFromCheckpoint(prevReviewCp), deepReviewUsageDelta)
        : extractAiUsageFromCheckpoint(prevReviewCp);

      emitStream({
        type: 'progress',
        percent: 90,
        stage: 'ثبت گزارش بازبینی و به‌روزرسانی مصرف توکن پروژه...',
        model: modelUsed,
        thinkingLevel: thinkingLevelUsed,
      });

      await updateProjectRecord(projectId, user.uid, {
        checkpointJson: {
          ...prevReviewCp,
          lastDeepReview: review,
          aiUsage: updatedUsageAfterReview,
        },
      });

      emitStream({
        type: 'progress',
        percent: 96,
        stage: 'بازچینی نهایی کتاب، فهرست مطالب و گزارش ممیزی ۱۰۰٪...',
        model: modelUsed,
        thinkingLevel: thinkingLevelUsed,
      });

      const finalBundle = await reassembleAndPersistProject(projectId, user.uid);

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'ai',
        actorName: modelUsed,
        actionType: 'deep_ai_review',
        title: `بازبینی عمیق هوش مصنوعی (امتیاز ${toPersianDigits(review.overallScore)}/۱۰۰)`,
        summary: review.overallAssessment || 'بهبود عنوان‌ها، افزودن کادرهای آموزشی و جداول بدون افت محتوا.',
        extraDetails: { modelUsed },
      });

      if (wantsStream) {
        emitStream({
          type: 'progress',
          percent: 100,
          stage: 'بازبینی عمیق با موفقیت تکمیل شد.',
          model: modelUsed,
          thinkingLevel: thinkingLevelUsed,
        });
        emitStream({ type: 'complete', review, bundle: finalBundle });
        if (!res.writableEnded) res.end();
      } else {
        res.json({ review, bundle: finalBundle });
      }
    } catch (err) {
      console.error('[DeepReview fatal error]:', err);
      const formattedErr = formatGeminiError(err, 'خطا در اجرای بازبینی عمیق با هوش مصنوعی.');
      if (res.headersSent) {
        try {
          res.write(`${JSON.stringify({ type: 'error', error: formattedErr.message })}\n`);
          res.end();
        } catch {
          // Ignore if already closed
        }
      } else {
        res.status(formattedErr.statusCode).json({ error: formattedErr.message });
      }
    }
  });

  // 12. CONTEXT-AWARE GEMINI EDITOR CHATBOT (with Structured Tool Proposals)
  router.post('/:id/chat', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const body = req.body as {
        message?: string;
        history?: Array<{ role: 'user' | 'model'; text: string }>;
        model?: string;
        enableGoogleSearch?: boolean;
      };
      const message = (body.message || '').trim();
      if (!message) {
        res.status(400).json({ error: 'متن پیام نمی‌تواند خالی باشد.' });
        return;
      }

      // Smart dynamic chat tier routing: short read-only Q&A escalates down to Economy tier
      // when Multi-Tier Routing is enabled, while structural editing requests stay on Balanced tier!
      const isStructuralEditIntent =
        /(?:تغییر\s*نام|جابه‌?جا|انتقال|تقسیم|ادغام|جدول|باکس|کادر|هشدار|اضافه\s*کن|درج\s*کن|فصل|بساز|اصلاح\s*کن|بازنویسی|وینولز|winols|damos|a2l)/i.test(
          message
        ) || Boolean(body.enableGoogleSearch);

      const chatTaskCtx = resolveProviderForTaskFromRequest(
        req,
        'editor_chat',
        normalizeGoogleModelId(body.model),
        !isStructuralEditIntent && message.length < 180 ? 'economy' : undefined
      );
      const chatProvider = chatTaskCtx.provider;
      if (chatProvider.validationError) {
        res.status(400).json({ error: chatProvider.validationError });
        return;
      }
      if (!chatProvider.apiKey) {
        res.status(503).json({
          error:
            'کلید API هوش مصنوعی تنظیم نشده است. می‌توانید در تنظیمات ارائه‌دهنده کلید شخصی خود را وارد کنید.',
        });
        return;
      }

      const currentChatUsage = extractAiUsageFromCheckpoint(
        (bundle.project.checkpointJson || {}) as Record<string, unknown>
      );
      const chatCapCheck = checkHardCostCap(currentChatUsage, chatTaskCtx.hardCostCapUsd);
      if (!chatCapCheck.allowed) {
        res.status(402).json({ error: chatCapCheck.errorMessageFa });
        return;
      }

      const requestedModel = normalizeGoogleModelId(chatTaskCtx.googleModel);
      const chatBudget = getBudgetForOptimizationMode(chatTaskCtx.optimizationMode);

      const chatWire = buildCompactChatContextWire({
        title: bundle.project.title,
        workflowMode: bundle.project.workflowMode,
        pipelineStage: bundle.project.pipelineStage,
        sourceFiles: bundle.sourceFiles.map((f) => ({
          name: f.fileName,
          role: f.role,
          unitCount: Number(((f.metadataJson || {}) as Record<string, unknown>).unitCount ?? 0),
        })),
        outlineNodes: bundle.outlineNodes.map((n) => ({
          id: n.id,
          order: n.nodeOrder,
          title: n.title,
          summary: n.summary,
        })),
        openConflicts: bundle.conflicts.map((c) => ({
          id: c.id,
          topic: c.topic,
          fileA: c.fileAName,
          fileB: c.fileBName,
          status: c.status,
        })),
        coveragePercent: bundle.auditReport?.coveragePercent ?? null,
      });

      const chatEditorialDirective = buildEditorialSystemDirective(bundle.project.settingsJson);

      const systemInstruction = [
        'شما دستیار هوشمند و سردبیر ارشد «استودیو صفحه‌آرایی و ادغام بدون افت اسناد» (متخصص جزوه‌های ریمپ و کالیبراسیون ECU/WinOLS) هستید.',
        'همیشه به زبان فارسی دقیق، محترمانه و مختصر پاسخ دهید و هیچ آدرس هگز یا عدد فنی غیرمستند نسازید.',
        chatEditorialDirective,
        'قانون مطلق: هرگز پیشنهادی ندهید که محتوای یکتایی از فایل‌های کاربر را حذف کند.',
        'اگر کاربر درخواست ویرایش ساختار سند دارد (مثل تغییر نام فصل، جابه‌جایی فصل، تقسیم فصل، افزودن باکس نکته، ساخت جدول مقایسه‌ای/راهنمای WinOLS یا درج متن جدید)، حتماً ابزار متناظر را با nodeId دقیق از کانتکست فراخوانی کنید تا کارت تأیید برای کاربر ساخته شود.',
        `کانتکست فشرده پروژه:\n${chatWire.wireText}`,
      ].join('\n');

      // Non-Google provider chat branch (Anthropic Claude, OpenAI, Custom OpenAI-compatible + full Tool Calling!)
      // Also supports hybrid Web Search when user enables web search in chat!
      if (isNonGoogleProvider(chatProvider)) {
        const searchRoute = resolveWebSearchRouteFromRequest(req);
        let groundingSources: WebGroundingSource[] = [];
        let webContextNote = '';

        if (body.enableGoogleSearch) {
          try {
            const searchOut = await executeUnifiedWebSearch({
              primaryProvider: chatProvider,
              searchRoute,
              googleModel: requestedModel,
              prompt: `پرسش کاربر درباره سند «${bundle.project.title}»:\n${message}\n\nلطفاً اطلاعات دقیق، به‌روز و مستند را به فارسی جمع‌بندی کن.`,
              thinkingLevel: ThinkingLevel.LOW,
            });
            groundingSources = searchOut.sources;
            if (searchOut.summary) {
              webContextNote = `\n\n[نتایج جستجوی زنده وب از ${searchOut.providerLabelFa} برای استناد در پاسخ]:\n${searchOut.summary}`;
            }
            await recordProjectAiUsage(projectId, user.uid, searchOut.usageDelta);
          } catch {
            // Continue answering with primary model even if secondary web search route is unconfigured
          }
        }

        const openAiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
          ...(Array.isArray(body.history) ? body.history.slice(-chatBudget.chatHistoryLimit) : []).map((h) => ({
            role: (h.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
            content: h.text,
          })),
          { role: 'user', content: `${message}${webContextNote}` },
        ];
        const customRes = await callNonGoogleChatWithFallback({
          provider: chatProvider,
          systemInstruction,
          messages: openAiMessages,
          tools: CHAT_EDITOR_TOOLS_SPEC,
          taskRole: 'editor_chat',
          enablePromptCaching: chatTaskCtx.enablePromptCaching,
        });
        const proposals: ChatProposal[] = (customRes.toolCalls || []).map((call) =>
          buildChatProposalFromToolCall(
            call.name as ChatProposal['action'],
            call.args,
            bundle.outlineNodes
          )
        );
        const reply =
          customRes.text ||
          (proposals.length > 0
            ? 'پیشنهاد ویرایش ساختاریافته زیر آماده شد. با زدن دکمه «تأیید و اعمال روی سند» بلافاصله در سند و پایگاه داده ثبت می‌شود.'
            : 'درخواست شما بررسی شد.');
        const fallbackPrompt = Math.ceil((systemInstruction.length + message.length) / 3);
        const fallbackOutput = Math.ceil(reply.length / 3);
        const updatedChatUsage = await recordProjectAiUsage(projectId, user.uid, {
          promptTokens: customRes.usage.promptTokens || fallbackPrompt,
          outputTokens: customRes.usage.outputTokens || fallbackOutput,
          thinkingTokens: 0,
          totalTokens:
            customRes.usage.totalTokens ||
            (customRes.usage.promptTokens || fallbackPrompt) +
              (customRes.usage.outputTokens || fallbackOutput),
          cachedInputTokens: customRes.usage.cachedInputTokens || 0,
          savedTokensByOptimization:
            chatWire.estimatedTokensSaved + (customRes.usage.cachedInputTokens || 0),
          requestCount: 1,
          chatCallCount: 1,
          modelUsed: customRes.modelUsed,
        });

        res.json({
          reply,
          proposals,
          groundingSources,
          modelUsed: customRes.modelUsed,
          tierUsed: chatTaskCtx.tierLabelFa,
          ...(updatedChatUsage ? { aiUsage: updatedChatUsage } : {}),
        });
        return;
      }

      const recentHistory = (
        Array.isArray(body.history) ? body.history.slice(-chatBudget.chatHistoryLimit) : []
      ).map((h) => ({
        role: h.role === 'model' ? 'model' : 'user',
        parts: [{ text: h.text }],
      }));

      const toolsList: Array<Record<string, unknown>> = [
        { functionDeclarations: CHAT_EDITOR_TOOLS },
      ];
      if (body.enableGoogleSearch) {
        toolsList.push({ googleSearch: {} });
      }

      const { result: chatGen } = await executeWithGoogleClientFallback(chatProvider, (aiClient) =>
        generateGoogleContentResilient({
          ai: aiClient,
          model: requestedModel,
          contents: [...recentHistory, { role: 'user', parts: [{ text: message }] }],
          config: {
            systemInstruction,
            tools: toolsList as never,
            ...(body.enableGoogleSearch
              ? { toolConfig: { includeServerSideToolInvocations: true } as never }
              : {}),
            thinkingConfig: {
              thinkingLevel:
                requestedModel === 'gemini-4-hydrogen' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
            },
          },
        })
      );
      const { response, resolvedModel } = chatGen;

      const fnCalls = response.functionCalls || [];
      const proposals: ChatProposal[] = fnCalls.map((call) =>
        buildChatProposalFromToolCall(
          call.name as ChatProposal['action'],
          (call.args || {}) as Record<string, unknown>,
          bundle.outlineNodes
        )
      );

      const groundingSources = extractGroundingSources(response);
      const reply =
        (response.text || '').trim() ||
        (proposals.length > 0
          ? 'پیشنهاد ویرایش ساختاریافته زیر آماده شد. با زدن دکمه «تأیید و اعمال روی سند» بلافاصله در سند و پایگاه داده ثبت می‌شود.'
          : 'درخواست شما بررسی شد.');

      const updatedChatUsage = await recordProjectAiUsage(
        projectId,
        user.uid,
        extractUsageDeltaFromResponse(response, {
          modelUsed: resolvedModel,
          fallbackPromptChars: systemInstruction.length + message.length,
          fallbackOutputChars: reply.length,
          isGrounding: Boolean(body.enableGoogleSearch),
          isChat: true,
        })
      );

      res.json({
        reply,
        proposals,
        groundingSources,
        modelUsed: resolvedModel,
        ...(updatedChatUsage ? { aiUsage: updatedChatUsage } : {}),
      });
    } catch (err) {
      const formattedErr = formatGeminiError(err, 'خطا در پردازش پیام دستیار هوشمند.');
      res.status(formattedErr.statusCode).json({ error: formattedErr.message });
    }
  });

  // 13. APPLY CONFIRMED CHAT OR VOICE PROPOSAL DIRECTLY TO POSTGRESQL & RE-ASSEMBLE BOOK
  router.post('/:id/apply-proposal', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const bundle = await getProjectBundle(projectId, user.uid);
      if (!bundle) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const proposal = req.body as ChatProposal;
      const args = proposal.args || {};
      const nodes = [...bundle.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);

      const defaultSourceFileId = bundle.sourceFiles[0]?.id;
      const findNodeOrFirst = (nodeId: unknown) =>
        nodes.find((n) => n.id === String(nodeId || '')) || nodes[0];

      if (proposal.action === 'rename_chapter') {
        const target = findNodeOrFirst(args.nodeId);
        if (target && args.newTitle) {
          target.title = String(args.newTitle).trim();
          await updateOutlineNodesOrderAndApproval(
            projectId,
            nodes.map((n, idx) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: idx + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );
        }
      } else if (proposal.action === 'move_chapter') {
        const idx = nodes.findIndex((n) => n.id === String(args.nodeId || ''));
        if (idx !== -1) {
          const [moved] = nodes.splice(idx, 1);
          const targetIdx = Math.max(0, Math.min(nodes.length, Number(args.targetOrder || 1) - 1));
          nodes.splice(targetIdx, 0, moved);
          await updateOutlineNodesOrderAndApproval(
            projectId,
            nodes.map((n, i) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: i + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );
        }
      } else if (proposal.action === 'split_chapter') {
        const targetIdx = nodes.findIndex((n) => n.id === String(args.nodeId || ''));
        if (targetIdx !== -1) {
          const sourceNode = nodes[targetIdx];
          const newNodeId = `node_${projectId}_split_${Date.now()}`;
          const newTitle = String(args.newChapterTitle || `${sourceNode.title} (بخش دوم)`).trim();

          nodes.splice(targetIdx + 1, 0, {
            id: newNodeId,
            projectId,
            parentId: null,
            level: 1,
            nodeOrder: targetIdx + 2,
            title: newTitle,
            summary: 'ایجادشده از تقسیم فصل بدون افت محتوا',
            isApproved: sourceNode.isApproved,
            webEnrichmentJson: null,
          });

          await updateOutlineNodesOrderAndApproval(
            projectId,
            nodes.map((n, i) => ({
              id: n.id,
              title: n.title,
              summary: n.summary,
              nodeOrder: i + 1,
              level: n.level,
              parentId: n.parentId,
              isApproved: n.isApproved,
              webEnrichmentJson: (n.webEnrichmentJson as Record<string, unknown> | null) ?? null,
            }))
          );

          // Move second half of sourceNode's active units to the new chapter
          const sourceUnits = bundle.contentUnits.filter(
            (u) => u.outlineNodeId === sourceNode.id && u.status !== 'merged'
          );
          const half = Math.ceil(sourceUnits.length / 2);
          for (const u of sourceUnits.slice(half)) {
            await updateContentUnitOutlineNode(projectId, u.id, newNodeId);
          }
        }
      } else if (
        (proposal.action === 'add_callout_box' ||
          proposal.action === 'add_comparison_table' ||
          proposal.action === 'insert_dictated_paragraph') &&
        defaultSourceFileId
      ) {
        const targetNode = findNodeOrFirst(args.nodeId);
        const nextOrder = bundle.contentUnits.length + 1;
        const unitId = `u_edit_${crypto.randomBytes(4).toString('hex')}`;

        // Build Technical Fact Anchor Ledger from authentic project source units so chat proposals cannot hallucinate hex addresses
        const factLedger = extractTechnicalFactLedger(
          bundle.contentUnits.map((u) => ({
            rawText: u.rawText,
            outlineNodeId: u.outlineNodeId,
          })),
          bundle.outlineNodes.map((n) => ({ id: n.id, title: n.title }))
        );
        const cleanHex = (val: string) => sanitizeInventedHexInText(val, factLedger).cleaned;

        let unitType = 'paragraph';
        let rawText = '';
        let blockPayload: Record<string, unknown> = {};

        if (proposal.action === 'add_callout_box') {
          unitType = 'callout';
          const title = cleanHex(String(args.title || 'نکته تکمیلی'));
          const bodyText = cleanHex(String(args.body || ''));
          rawText = `${title}\n${bodyText}`;
          blockPayload = {
            type: 'callout',
            id: unitId,
            variant: String(args.variant || 'concept'),
            title,
            paragraphs: bodyText.split(/\n+/).filter(Boolean),
          };
        } else if (proposal.action === 'add_comparison_table') {
          unitType = 'table';
          const caption = cleanHex(String(args.caption || 'جدول مقایسه‌ای'));
          const headers = Array.isArray(args.headers)
            ? args.headers.map((h) => cleanHex(String(h)))
            : ['موضوع', 'توضیح'];
          const rows = Array.isArray(args.rows)
            ? args.rows.map((r) =>
                Array.isArray(r) ? r.map((c) => cleanHex(String(c))) : [cleanHex(String(r))]
              )
            : [];
          rawText = [
            caption,
            headers.join(' | '),
            ...rows.map((r) => r.join(' | ')),
          ].join('\n');
          blockPayload = {
            type: 'table',
            id: unitId,
            caption,
            headers,
            rows,
            generatedBy: 'ai',
          };
        } else {
          unitType = 'paragraph';
          rawText = cleanHex(String(args.text || '').trim());
          blockPayload = {
            type: 'paragraph',
            id: unitId,
            text: rawText,
          };
        }

        if (rawText) {
          const sectionSuffix = args.sectionTitle ? ` > ${String(args.sectionTitle)}` : '';
          await insertContentUnitRecord({
            id: unitId,
            projectId,
            sourceFileId: defaultSourceFileId,
            unitOrder: nextOrder,
            unitType,
            rawText,
            contentHash: deterministicHash(`${unitType}::${normalizePersianForComparison(rawText)}:${unitId}`),
            status: 'active',
            canonicalUnitId: null,
            outlineNodeId: targetNode?.id ?? null,
            payloadJson: {
              headingPath: `${targetNode?.title || 'فصل اول'}${sectionSuffix}`,
              fileName: 'دستیار هوشمند / دیکته ویراستار',
              fileRole: 'supplement',
              block: blockPayload,
            },
          });
        }
      }

      const finalBundle = await reassembleAndPersistProject(projectId, user.uid);
      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'ai',
        actorName: 'دستیار هوشمند سردبیر',
        actionType: 'ai_proposal_applied',
        title: `اعمال پیشنهاد دستیار: ${proposal.title || proposal.action}`,
        summary: proposal.summary || 'تغییر پیشنهادی دستیار روی ساختار و متن کتاب اعمال شد.',
      });
      res.json({ ok: true, bundle: finalBundle });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در اعمال تغییر پیشنهادی روی سند.',
      });
    }
  });

  // 14. CHANGE LOG: LIST PROJECT REVISIONS
  router.get('/:id/revisions', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const rows = await listProjectRevisions(req.params.id, user.uid);
      if (rows === null) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      res.json({
        revisions: rows.map(formatRevisionRowForClient),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در دریافت تاریخچه تغییرات پروژه.',
      });
    }
  });

  // 14B. CHANGE LOG: RECORD CLIENT ACTIVITY OR MANUAL CHECKPOINT SNAPSHOT
  router.post('/:id/revisions/log', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const projectId = req.params.id;
      const body = (req.body || {}) as {
        actionType?: RevisionActionType;
        title?: string;
        summary?: string;
        captureSnapshot?: boolean;
        extraDetails?: Record<string, unknown>;
      };

      const allowedClientActions = new Set<RevisionActionType>([
        'manual_checkpoint',
        'winols_map_edited',
        'winols_damos_exported',
        'docx_exported',
        'markdown_exported',
        'print_preview_opened',
        'ai_provider_changed',
        'audio_transcribed',
        'settings_updated',
      ]);

      const actionType: RevisionActionType =
        body.actionType && allowedClientActions.has(body.actionType)
          ? body.actionType
          : 'manual_checkpoint';

      const title =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim().slice(0, 180)
          : 'ثبت نقطه بازیابی دستی';
      const summary =
        typeof body.summary === 'string' && body.summary.trim()
          ? body.summary.trim().slice(0, 500)
          : 'وضعیت فعلی پروژه در تاریخچه تغییرات ثبت شد.';

      const shouldCaptureSnapshot =
        actionType === 'manual_checkpoint' ? true : Boolean(body.captureSnapshot);

      const created = await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType,
        title,
        summary,
        extraDetails:
          body.extraDetails && typeof body.extraDetails === 'object' ? body.extraDetails : undefined,
        captureSnapshot: shouldCaptureSnapshot,
      });

      if (!created) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }

      const updatedRevisions = await listProjectRevisions(projectId, user.uid);
      res.json({
        ok: true,
        revisions: (updatedRevisions || []).map(formatRevisionRowForClient),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در ثبت رویداد تاریخچه پروژه.',
      });
    }
  });

  // 15. CHANGE LOG: ROLLBACK PROJECT TO A PREVIOUS VERSION SNAPSHOT
  router.post('/:id/revisions/:revisionId/rollback', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId, revisionId } = req.params;

      const targetRevision = await getProjectRevisionWithSnapshot(projectId, revisionId, user.uid);
      if (!targetRevision) {
        res.status(404).json({ error: 'نسخه انتخاب‌شده در تاریخچه تغییرات این پروژه یافت نشد.' });
        return;
      }

      if (!isValidRevisionSnapshot(targetRevision.snapshotJson)) {
        res.status(400).json({
          error: 'این رکورد فاقد اسنپ‌شات کامل برای بازگشت خودکار است.',
        });
        return;
      }

      const restoredRaw = await restoreProjectFromRevisionSnapshot(
        projectId,
        user.uid,
        targetRevision.snapshotJson
      );
      if (!restoredRaw) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }

      await recordProjectRevision({
        projectId,
        ownerUid: user.uid,
        actorType: 'user',
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
        actionType: 'rollback_restored',
        title: `بازگشت به نسخه ${toPersianDigits(targetRevision.versionNumber)} (${targetRevision.title})`,
        summary: `وضعیت پروژه، فصل‌بندی و سند با موفقیت به نسخه شماره ${toPersianDigits(targetRevision.versionNumber)} بازگردانده شد.`,
        extraDetails: {
          restoredFromVersion: targetRevision.versionNumber,
          restoredFromRevisionId: targetRevision.id,
        },
      });

      const updatedRevisions = await listProjectRevisions(projectId, user.uid);
      res.json({
        ok: true,
        restoredVersion: targetRevision.versionNumber,
        bundle: formatBundleForClient(restoredRaw),
        revisions: (updatedRevisions || []).map(formatRevisionRowForClient),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در بازگردانی پروژه به نسخه قبلی.',
      });
    }
  });

  // 16. DOMAIN-SPECIFIC AI HARNESS: INIT / REFRESH BLUEPRINT & COST PREVIEW (0 TOKENS)
  router.post('/:id/harness/blueprint/init', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId } = req.params;
      const body = (req.body || {}) as {
        budgetCapUsd?: number;
        forceReset?: boolean;
        validationDomain?: ValidationDomain;
      };
      const result = await initHarnessBlueprintForProject({
        req,
        projectId,
        ownerUid: user.uid,
        budgetCapUsd: typeof body.budgetCapUsd === 'number' ? body.budgetCapUsd : undefined,
        validationDomain:
          body.validationDomain === 'general_persian_technical' ||
          body.validationDomain === 'ecu_winols'
            ? body.validationDomain
            : undefined,
        forceReset: Boolean(body.forceReset),
      });
      if (!result) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      res.json({
        ok: true,
        harnessState: result.harnessState,
        routingInfo: result.routingInfo,
        bundle: formatBundleForClient(result.rawBundle),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در مقداردهی نقشه راه هارنس.',
      });
    }
  });

  // 17. DOMAIN-SPECIFIC AI HARNESS: HITL GATE APPROVAL & GLOSSARY FREEZE
  router.post('/:id/harness/blueprint/approve', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId } = req.params;
      const body = (req.body || {}) as {
        budgetCapUsd?: number;
        glossaryEntries?: unknown[];
        validationDomain?: ValidationDomain;
      };
      const result = await approveHarnessBlueprintForProject({
        req,
        projectId,
        ownerUid: user.uid,
        budgetCapUsd: typeof body.budgetCapUsd === 'number' ? body.budgetCapUsd : undefined,
        glossaryEntries: Array.isArray(body.glossaryEntries)
          ? (body.glossaryEntries as unknown as Parameters<typeof approveHarnessBlueprintForProject>[0]['glossaryEntries'])
          : undefined,
        validationDomain:
          body.validationDomain === 'general_persian_technical' ||
          body.validationDomain === 'ecu_winols'
            ? body.validationDomain
            : undefined,
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
      });
      if (!result) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      const updatedRevisions = await listProjectRevisions(projectId, user.uid);
      res.json({
        ok: true,
        harnessState: result.harnessState,
        routingInfo: result.routingInfo,
        bundle: formatBundleForClient(result.rawBundle),
        revisions: (updatedRevisions || []).map(formatRevisionRowForClient),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در تایید دروازه HITL هارنس.',
      });
    }
  });

  // 18. DOMAIN-SPECIFIC AI HARNESS: STATELESS SINGLE-SUBSECTION STEP
  router.post('/:id/harness/step', async (req, res) => {
    const stepAbortController = new AbortController();
    const onClientDisconnect = () => {
      if (!res.writableEnded) {
        stepAbortController.abort();
      }
    };
    req.on('close', onClientDisconnect);

    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId } = req.params;
      const body = (req.body || {}) as {
        sectionId?: string;
        allowBudgetOverride?: boolean;
      };
      const result = await executeHarnessStepForProject({
        req,
        projectId,
        ownerUid: user.uid,
        sectionId: typeof body.sectionId === 'string' ? body.sectionId : undefined,
        allowBudgetOverride: Boolean(body.allowBudgetOverride),
        abortSignal: stepAbortController.signal,
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
      });
      if (!result) {
        if (!res.writableEnded) {
          res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        }
        return;
      }
      if (!res.writableEnded) {
        res.json({
          ok: true,
          done: result.done,
          pausedByBudgetCap: Boolean(result.pausedByBudgetCap),
          sectionId: result.sectionId,
          outcome: result.outcome,
          layer1: result.layer1,
          layer2: result.layer2,
          harnessState: result.harnessState,
          bundle: formatBundleForClient(result.rawBundle),
        });
      }
    } catch (err) {
      if (res.writableEnded) return;
      if (err instanceof HarnessStepConflictError) {
        res.status(409).json({
          ok: false,
          code: err.code,
          error: err.message,
          activeStepLock: err.existingLock,
        });
        return;
      }
      if (err instanceof HarnessRunAbortedError) {
        res.status(499).json({
          ok: false,
          code: err.code,
          error: err.message,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در اجرای گام هارنس زیربخش.',
      });
    } finally {
      req.off('close', onClientDisconnect);
    }
  });

  // 19. DOMAIN-SPECIFIC AI HARNESS: RESOLVE QUARANTINED SUBSECTION MANUALLY
  router.post('/:id/harness/quarantine/:sectionId/resolve', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId, sectionId } = req.params;
      const body = (req.body || {}) as {
        editedBlocks?: unknown[];
        resolutionNote?: string;
      };
      const result = await resolveHarnessQuarantineItem({
        projectId,
        ownerUid: user.uid,
        sectionId,
        editedBlocks: Array.isArray(body.editedBlocks)
          ? (body.editedBlocks as unknown as Parameters<typeof resolveHarnessQuarantineItem>[0]['editedBlocks'])
          : undefined,
        resolutionNote: typeof body.resolutionNote === 'string' ? body.resolutionNote : undefined,
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
      });
      if (!result) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      const updatedRevisions = await listProjectRevisions(projectId, user.uid);
      res.json({
        ok: true,
        harnessState: result.harnessState,
        bundle: formatBundleForClient(result.rawBundle),
        revisions: (updatedRevisions || []).map(formatRevisionRowForClient),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در تعیین‌تکلیف زیربخش قرنطینه‌شده.',
      });
    }
  });

  // 19B. DOMAIN-SPECIFIC AI HARNESS: RETRY QUARANTINED SUBSECTION WITH FLAGSHIP ESCALATION (GATE 2)
  router.post('/:id/harness/quarantine/:sectionId/retry', async (req, res) => {
    const retryAbortController = new AbortController();
    const onClientDisconnect = () => {
      if (!res.writableEnded) {
        retryAbortController.abort();
      }
    };
    req.on('close', onClientDisconnect);

    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId, sectionId } = req.params;
      const body = (req.body || {}) as { allowBudgetOverride?: boolean };
      const result = await retryQuarantinedSectionForProject({
        req,
        projectId,
        ownerUid: user.uid,
        sectionId,
        allowBudgetOverride: Boolean(body.allowBudgetOverride),
        abortSignal: retryAbortController.signal,
        actorName: user.name || (user.isGuest ? 'کاربر مهمان' : 'کاربر استودیو'),
      });
      if (!result) {
        if (!res.writableEnded) {
          res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        }
        return;
      }
      if (!res.writableEnded) {
        res.json({
          ok: true,
          done: result.done,
          pausedByBudgetCap: Boolean(result.pausedByBudgetCap),
          sectionId: result.sectionId,
          outcome: result.outcome,
          layer1: result.layer1,
          layer2: result.layer2,
          harnessState: result.harnessState,
          bundle: formatBundleForClient(result.rawBundle),
        });
      }
    } catch (err) {
      if (res.writableEnded) return;
      if (err instanceof HarnessStepConflictError) {
        res.status(409).json({
          ok: false,
          code: err.code,
          error: err.message,
          activeStepLock: err.existingLock,
        });
        return;
      }
      if (err instanceof HarnessRunAbortedError) {
        res.status(499).json({
          ok: false,
          code: err.code,
          error: err.message,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در بازنویسی مجدد زیربخش با مدل پرچمدار.',
      });
    } finally {
      req.off('close', onClientDisconnect);
    }
  });

  // 20. DOMAIN-SPECIFIC AI HARNESS: DETERMINISTIC SYNC SEMANTIC IR -> BOOK SNAPSHOT
  router.post('/:id/harness/sync-book', async (req, res) => {
    try {
      const user = (req as AuthRequest).user!;
      const { id: projectId } = req.params;
      const result = await syncHarnessToBookSnapshot({
        projectId,
        ownerUid: user.uid,
      });
      if (!result) {
        res.status(404).json({ error: 'پروژه موردنظر یافت نشد.' });
        return;
      }
      res.json({
        ok: true,
        harnessState: result.harnessState,
        bundle: formatBundleForClient(result.rawBundle),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'خطا در همگام‌سازی Semantic IR با سند نهایی.',
      });
    }
  });

  return router;
}
