import crypto from 'node:crypto';
import type express from 'express';
import { ThinkingLevel } from '@google/genai';
import {
  createProjectRevisionRecord,
  getProjectBundle,
  saveAuditReportRecord,
  updateProjectRecord,
} from '../db/repository.ts';
import type { CustomModelProfile } from '../lib/aiProviderConfig.ts';
import {
  extractAiUsageFromCheckpoint,
  mergeAiUsageDelta,
  type AiUsageDelta,
} from '../lib/aiUsageMetrics.ts';
import type {
  ContentUnitDto,
  DocxExportConfig,
  OutlineNodeDto,
  ParsedBook,
  ProjectBundleDto,
  SourceFileDto,
  ValidationDomain,
} from '../lib/bookTypes.ts';
import {
  buildRevisionSnapshotPayload,
  type RevisionActionType,
} from '../lib/changeLogUtils.ts';
import { toPersianDigits } from '../lib/formatParsers.ts';
import {
  computeCoverageLedgerStats,
  extractHarnessStateFromCheckpoint,
} from '../lib/harness/harnessStore.ts';
import {
  auditMasterBlueprint,
  computeSourceCorpusFingerprint,
  detectSourceCorpusDrift,
} from '../lib/harness/chunkingAndBlueprint.ts';
import {
  buildInitialHarnessState,
  buildSourceChunksMap,
  convertHarnessStateToParsedBook,
} from '../lib/harness/irToBookAdapter.ts';
import { runLayer1DeterministicGuard } from '../lib/harness/layer1Guard.ts';
import {
  applySurgicalPatchBlocksStrict,
  buildSurgicalPatchPlan,
  computeEffectiveTotalSpentUsd,
  estimateHarnessRunCost,
  evaluateBudgetCircuitBreaker,
  markChargeAbortedZeroCost,
  markChargeUnreconciledTimeout,
  recordPendingChargeEntry,
  replaceFullSectionBlocksAtomic,
  settleChargeEntry,
} from '../lib/harness/patchAndBudget.ts';
import {
  acquireStepLock,
  assertNotAborted,
  buildSectionProvenance,
  canMarkSectionVerified,
  DEFAULT_STEP_LOCK_TTL_MS,
  evaluateJudgeAuditRigorous,
  evaluateOutputTruncation,
  HarnessRunAbortedError,
  HarnessStepConflictError,
  releaseStepLock,
  renewStepLockHeartbeat,
  type RawJudgeResponsePayload,
} from '../lib/harness/orchestrationGuard.ts';
import {
  buildImmutableCachedPrefix,
  buildLayer2JudgePrompt,
  buildRollingSummaryUpdatePrompt,
  buildStatelessAuthorPrompt,
  buildSurgicalPatchPrompt,
  compileCompactRollingSummary,
  evaluatePrefixCachePolicy,
  LAYER2_JUDGE_JSON_SCHEMA,
  LAYER2_JUDGE_RESPONSE_SCHEMA,
  mergeDeltaGlossaryAtChapterBoundary,
  ROLLING_SUMMARY_JSON_SCHEMA,
  ROLLING_SUMMARY_RESPONSE_SCHEMA,
  SEMANTIC_SECTION_IR_JSON_SCHEMA,
  SEMANTIC_SECTION_IR_RESPONSE_SCHEMA,
  SURGICAL_PATCH_JSON_SCHEMA,
  SURGICAL_PATCH_RESPONSE_SCHEMA,
} from '../lib/harness/promptBuilder.ts';
import {
  ProviderGatewayError,
  repairMalformedJsonDeterministic,
} from '../lib/harness/providerGuard.ts';
import type {
  BlueprintSection,
  CostAuditLedgerEntry,
  GlossaryTermEntry,
  HarnessSourceChunk,
  HarnessState,
  Layer1AuditResult,
  Layer2AuditResult,
  SemanticBlock,
  SemanticBlockKind,
  SemanticSectionIR,
} from '../lib/harness/types.ts';
import {
  type AiTaskType,
  computeCallCostUsd,
  estimatePersianTokensConservative,
  updateTokenCalibrationFactor,
} from '../lib/tokenOptimizer.ts';
import {
  generateUnifiedTextOrJson,
  resolveProviderForTaskFromRequest,
  type TaskResolvedAiContext,
  type UnifiedGenerationResult,
} from './aiProvider.ts';

const VALID_BLOCK_KINDS = new Set<SemanticBlockKind>([
  'heading',
  'paragraph',
  'callout_warning',
  'callout_tip',
  'table',
  'formula',
  'step_list',
  'source_gap_flag',
  'source_conflict_flag',
  'figure_ref',
]);

function safeParseJsonObject<T>(raw: string): T | null {
  const repaired = repairMalformedJsonDeterministic<T>(raw);
  return repaired.ok ? repaired.value : null;
}

function getEffectiveModelIdFromCtx(ctx: TaskResolvedAiContext): string {
  return ctx.provider.provider === 'google_aistudio'
    ? ctx.googleModel
    : ctx.provider.customModelId || ctx.googleModel;
}

function normalizeSemanticBlocks(
  rawBlocks: unknown,
  fallbackChunkIds: string[]
): SemanticBlock[] {
  if (!Array.isArray(rawBlocks)) return [];
  const normalized: SemanticBlock[] = [];
  rawBlocks.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const rawKind = typeof obj.kind === 'string' ? obj.kind.trim() : 'paragraph';
    const kind: SemanticBlockKind = VALID_BLOCK_KINDS.has(rawKind as SemanticBlockKind)
      ? (rawKind as SemanticBlockKind)
      : 'paragraph';
    const id =
      typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `blk-${idx + 1}`;
    const sourceChunkIds = Array.isArray(obj.sourceChunkIds)
      ? obj.sourceChunkIds.map((x) => String(x || '').trim()).filter(Boolean)
      : [];

    const blk: SemanticBlock = {
      id,
      kind,
      sourceChunkIds: sourceChunkIds.length > 0 ? sourceChunkIds : [...fallbackChunkIds],
    };
    if (typeof obj.title === 'string' && obj.title.trim()) blk.title = obj.title.trim();
    if (typeof obj.text === 'string' && obj.text.trim()) blk.text = obj.text.trim();
    if (Array.isArray(obj.items)) {
      blk.items = obj.items.map((x) => String(x || '').trim()).filter(Boolean);
    }
    if (Array.isArray(obj.headers)) {
      blk.headers = obj.headers.map((x) => String(x || '').trim());
    }
    if (Array.isArray(obj.rows)) {
      blk.rows = obj.rows
        .filter((r): r is unknown[] => Array.isArray(r))
        .map((r) => r.map((cell) => String(cell ?? '').trim()));
    }
    if (typeof obj.latex === 'string' && obj.latex.trim()) blk.latex = obj.latex.trim();
    if (typeof obj.readable === 'string' && obj.readable.trim()) blk.readable = obj.readable.trim();
    if (typeof obj.gapReason === 'string' && obj.gapReason.trim()) {
      blk.gapReason = obj.gapReason.trim();
    }
    if (typeof obj.missingInfo === 'string' && obj.missingInfo.trim()) {
      blk.missingInfo = obj.missingInfo.trim();
    }
    if (typeof obj.conflictTopic === 'string' && obj.conflictTopic.trim()) {
      blk.conflictTopic = obj.conflictTopic.trim();
    }
    if (typeof obj.conflictSourceA === 'string' && obj.conflictSourceA.trim()) {
      blk.conflictSourceA = obj.conflictSourceA.trim();
    }
    if (typeof obj.conflictSourceB === 'string' && obj.conflictSourceB.trim()) {
      blk.conflictSourceB = obj.conflictSourceB.trim();
    }
    if (typeof obj.assetId === 'string' && obj.assetId.trim()) {
      blk.assetId = obj.assetId.trim();
    }
    if (typeof obj.caption === 'string' && obj.caption.trim()) {
      blk.caption = obj.caption.trim();
    }
    normalized.push(blk);
  });
  return normalized;
}

function accumulateTelemetry(
  state: HarnessState,
  res: Pick<
    UnifiedGenerationResult,
    | 'usageDelta'
    | 'modelUsed'
    | 'requestedModel'
    | 'modelMismatch'
    | 'cacheTelemetryReported'
    | 'cacheCreationInputTokens'
    | 'reasoningTokens'
  >,
  meta?: {
    role?: string;
    estimatedPromptTokens?: number;
    usedLockedPrefix?: boolean;
    customProfiles?: Record<string, CustomModelProfile>;
  }
): number {
  const delta = res.usageDelta;
  const promptTokens = delta.promptTokens || 0;
  const outputTokens = delta.outputTokens || 0;
  const reasoningTokens = res.reasoningTokens ?? delta.thinkingTokens ?? 0;
  const cacheReported = Boolean(res.cacheTelemetryReported);
  const cachedTokens = cacheReported ? delta.cachedInputTokens || 0 : 0;
  const cacheCreationTokens = res.cacheCreationInputTokens || 0;

  // Always compute cost against the ACTUAL model returned by the upstream API / 9Router
  const pricingModelId = res.modelMismatch?.pricingModelId || res.modelUsed;
  const callCost = computeCallCostUsd({
    modelId: pricingModelId,
    promptTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens: cachedTokens,
    cacheCreationInputTokens: cacheCreationTokens,
    customProfiles: meta?.customProfiles,
  });

  state.telemetry.totalPromptTokens += promptTokens;
  state.telemetry.cachedInputTokens += cachedTokens;
  state.telemetry.totalOutputTokens += outputTokens;
  state.telemetry.totalReasoningTokens = (state.telemetry.totalReasoningTokens || 0) + reasoningTokens;
  state.telemetry.totalCalls += 1;

  if (cacheReported) {
    state.telemetry.cacheTelemetryReportedCalls =
      (state.telemetry.cacheTelemetryReportedCalls || 0) + 1;
    if (cachedTokens > 0) {
      state.telemetry.cacheHits += 1;
    }
  } else {
    state.telemetry.cacheTelemetryUnreportedCalls =
      (state.telemetry.cacheTelemetryUnreportedCalls || 0) + 1;
  }

  if (meta?.estimatedPromptTokens && promptTokens > 0) {
    state.telemetry.tokenCalibrationFactor = updateTokenCalibrationFactor({
      previousFactor: state.telemetry.tokenCalibrationFactor,
      estimatedTokens: meta.estimatedPromptTokens,
      actualTokens: promptTokens,
    });
  }

  if (meta?.usedLockedPrefix) {
    state.telemetry.lastPrefixUsedAt = new Date().toISOString();
  }

  if (res.modelMismatch?.mismatch) {
    const warnings = state.telemetry.modelMismatchWarnings || [];
    warnings.push({
      at: new Date().toISOString(),
      role: meta?.role || 'unknown',
      requestedModel: res.modelMismatch.requestedModel,
      actualModel: res.modelMismatch.actualModel,
      isDowngrade: res.modelMismatch.isDowngrade,
      messageFa:
        res.modelMismatch.warningFa ||
        `مغایرت مدل: ${res.modelMismatch.requestedModel} -> ${res.modelMismatch.actualModel}`,
    });
    state.telemetry.modelMismatchWarnings = warnings.slice(-20);
  }

  const effectiveSpend = computeEffectiveTotalSpentUsd(
    state.telemetry.costAuditLedger,
    Number((state.telemetry.estimatedCostUsd + callCost).toFixed(5))
  );
  state.telemetry.estimatedCostUsd = Number(effectiveSpend.totalSpentUsd.toFixed(5));
  state.telemetry.unreconciledCostUsd = Number(effectiveSpend.unreconciledUsd.toFixed(5));
  state.telemetry.lastModelUsed = res.modelUsed;
  state.telemetry.lastUpdatedAt = new Date().toISOString();
  return callCost;
}

class HarnessBudgetPausedSignal extends Error {
  public readonly reasonFa: string;
  public readonly subcallRole: string;
  constructor(reasonFa: string, subcallRole: string) {
    super(reasonFa);
    this.name = 'HarnessBudgetPausedSignal';
    this.reasonFa = reasonFa;
    this.subcallRole = subcallRole;
  }
}

function isTimeoutOrAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name || '';
  const msg = ((err as { message?: string }).message || '').toLowerCase();
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout')
  );
}

/**
 * Package B Guarded Subcall Wrapper:
 * 1. Checks Budget Circuit Breaker BEFORE EVERY SINGLE subcall (author, judge, patch #1, patch #2, utility)
 *    using effective spend (settled + unreconciled_estimated_cost).
 * 2. Records `pending_charge` in `costAuditLedger` BEFORE `fetch`.
 * 3. Settles with real API usage on success, or converts unanswered Timeouts into `unreconciled_estimated_cost`.
 */
async function invokeTrackedHarnessSubcall(params: {
  harnessState: HarnessState;
  sectionId: string;
  ledgerRole: CostAuditLedgerEntry['role'];
  taskRole: AiTaskType;
  ctx: TaskResolvedAiContext;
  thinkingLevel: ThinkingLevel;
  systemInstruction: string;
  prompt: string;
  expectJson: boolean;
  googleResponseSchema?: unknown;
  jsonSchema?: Record<string, unknown> | null;
  enablePromptCaching: boolean;
  usedLockedPrefix?: boolean;
  allowBudgetOverride?: boolean;
  haltOnAuthorDowngrade?: boolean;
  abortSignal?: AbortSignal;
}): Promise<UnifiedGenerationResult> {
  assertNotAborted(params.abortSignal, params.ledgerRole);
  const { harnessState } = params;
  const calibration = harnessState.telemetry.tokenCalibrationFactor ?? 1.0;
  const estPromptTokens = estimatePersianTokensConservative(
    `${params.systemInstruction}\n${params.prompt}`,
    calibration
  );
  const estOutputTokens =
    params.ledgerRole === 'harness_author'
      ? Math.max(400, Math.round(estPromptTokens * 0.45))
      : params.ledgerRole === 'harness_utility'
        ? 220
        : 360;
  const requestedModel = getEffectiveModelIdFromCtx(params.ctx);
  const customProfiles = params.ctx.provider.customModels;
  const estCostUsd = computeCallCostUsd({
    modelId: requestedModel,
    promptTokens: estPromptTokens,
    outputTokens: estOutputTokens,
    customProfiles,
  });

  if (!harnessState.telemetry.costAuditLedger) {
    harnessState.telemetry.costAuditLedger = [];
  }
  const effectiveSpend = computeEffectiveTotalSpentUsd(
    harnessState.telemetry.costAuditLedger,
    harnessState.telemetry.estimatedCostUsd
  );

  const budgetCheck = evaluateBudgetCircuitBreaker({
    currentSpentUsd: effectiveSpend.settledUsd,
    unreconciledCostUsd: effectiveSpend.unreconciledUsd,
    estimatedNextCallUsd: Math.max(0.0005, estCostUsd),
    budgetCapUsd: harnessState.blueprint.budgetCapUsd,
    subcallRole: params.ledgerRole,
    overrideApproved: Boolean(params.allowBudgetOverride),
  });

  if (!budgetCheck.allowed) {
    throw new HarnessBudgetPausedSignal(
      budgetCheck.reasonFa || `سقف بودجه هارنس پیش از زیرفراخوانی ${params.ledgerRole} تکمیل شد.`,
      params.ledgerRole
    );
  }

  const chargeId = `chg-${crypto.randomUUID().slice(0, 10)}`;
  recordPendingChargeEntry(harnessState.telemetry.costAuditLedger, {
    id: chargeId,
    sectionId: params.sectionId,
    role: params.ledgerRole,
    requestedModel,
    estimatedCostUsd: estCostUsd,
  });

  try {
    const res = await generateUnifiedTextOrJson({
      provider: params.ctx.provider,
      googleModel: params.ctx.googleModel,
      thinkingLevel: params.thinkingLevel,
      taskRole: params.taskRole,
      haltOnAuthorDowngrade: params.haltOnAuthorDowngrade,
      systemInstruction: params.systemInstruction,
      prompt: params.prompt,
      expectJson: params.expectJson,
      googleResponseSchema: params.googleResponseSchema,
      jsonSchema: params.jsonSchema,
      enablePromptCaching: params.enablePromptCaching,
      abortSignal: params.abortSignal,
    });

    settleChargeEntry(harnessState.telemetry.costAuditLedger, chargeId, {
      actualModel: res.modelUsed,
      promptTokens: res.usageDelta.promptTokens ?? 0,
      outputTokens: res.usageDelta.outputTokens ?? 0,
      reasoningTokens: res.reasoningTokens ?? res.usageDelta.thinkingTokens ?? 0,
      cachedInputTokens: res.cacheTelemetryReported ? res.usageDelta.cachedInputTokens || 0 : 0,
      cacheCreationInputTokens: res.cacheCreationInputTokens || 0,
      cacheTelemetryReported: Boolean(res.cacheTelemetryReported),
      modelMismatch: Boolean(res.modelMismatch?.mismatch),
      noteFa: res.modelMismatch?.warningFa,
    });

    accumulateTelemetry(harnessState, res, {
      role: params.ledgerRole,
      estimatedPromptTokens: estPromptTokens,
      usedLockedPrefix: params.usedLockedPrefix,
      customProfiles,
    });

    return res;
  } catch (err) {
    if (params.abortSignal?.aborted) {
      markChargeUnreconciledTimeout(
        harnessState.telemetry.costAuditLedger,
        chargeId,
        'توقف فوری درخواست توسط کاربر (Abort) حین پردازش مدل — هزینه تخمینی محافظت شد.'
      );
      const recomputed = computeEffectiveTotalSpentUsd(
        harnessState.telemetry.costAuditLedger,
        harnessState.telemetry.estimatedCostUsd
      );
      harnessState.telemetry.estimatedCostUsd = Number(recomputed.totalSpentUsd.toFixed(5));
      harnessState.telemetry.unreconciledCostUsd = Number(recomputed.unreconciledUsd.toFixed(5));
      throw new HarnessRunAbortedError(params.ledgerRole);
    }
    if (isTimeoutOrAbortError(err)) {
      markChargeUnreconciledTimeout(harnessState.telemetry.costAuditLedger, chargeId);
      const recomputed = computeEffectiveTotalSpentUsd(
        harnessState.telemetry.costAuditLedger,
        harnessState.telemetry.estimatedCostUsd
      );
      harnessState.telemetry.estimatedCostUsd = Number(recomputed.totalSpentUsd.toFixed(5));
      harnessState.telemetry.unreconciledCostUsd = Number(recomputed.unreconciledUsd.toFixed(5));
    } else if (err instanceof ProviderGatewayError && err.status >= 400 && err.status < 500) {
      markChargeAbortedZeroCost(harnessState.telemetry.costAuditLedger, chargeId, err.message);
    } else {
      markChargeUnreconciledTimeout(
        harnessState.telemetry.costAuditLedger,
        chargeId,
        'خطای غیرمنتظره شبکه پس از ارسال درخواست — هزینه تخمینی در سقف بودجه محافظت شد.'
      );
      const recomputed = computeEffectiveTotalSpentUsd(
        harnessState.telemetry.costAuditLedger,
        harnessState.telemetry.estimatedCostUsd
      );
      harnessState.telemetry.estimatedCostUsd = Number(recomputed.totalSpentUsd.toFixed(5));
      harnessState.telemetry.unreconciledCostUsd = Number(recomputed.unreconciledUsd.toFixed(5));
    }
    throw err;
  }
}

function toDtoShapes(raw: NonNullable<Awaited<ReturnType<typeof getProjectBundle>>>): {
  sourceFiles: SourceFileDto[];
  contentUnits: ContentUnitDto[];
  outlineNodes: OutlineNodeDto[];
  existingBook: ParsedBook | null;
} {
  const unitCountsByFile = new Map<string, number>();
  for (const u of raw.contentUnits) {
    unitCountsByFile.set(u.sourceFileId, (unitCountsByFile.get(u.sourceFileId) || 0) + 1);
  }
  return {
    sourceFiles: raw.sourceFiles.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      fileName: f.fileName,
      format: f.format as SourceFileDto['format'],
      fileRole: (f.role || 'standard') as SourceFileDto['fileRole'],
      sizeBytes: f.sizeBytes,
      wordCount: f.wordCount,
      unitCount: unitCountsByFile.get(f.id) || 0,
      checksum: f.fileHash,
      uploadedAt: f.uploadedAt.toISOString(),
    })),
    contentUnits: raw.contentUnits.map((u) => {
      const payload = (u.payloadJson as Record<string, unknown> | null) || null;
      const headingPath =
        payload && typeof payload.headingPath === 'string' ? payload.headingPath : null;
      return {
        id: u.id,
        projectId: u.projectId,
        sourceFileId: u.sourceFileId,
        unitOrder: u.unitOrder,
        unitType: u.unitType,
        headingPath,
        rawText: u.rawText,
        normalizedHash: u.contentHash,
        status: u.status,
        canonicalUnitId: u.canonicalUnitId,
        outlineNodeId: u.outlineNodeId,
        metadataJson: payload,
      };
    }),
    outlineNodes: raw.outlineNodes.map((n) => ({
      id: n.id,
      projectId: n.projectId,
      parentId: n.parentId,
      level: n.level,
      nodeOrder: n.nodeOrder,
      title: n.title,
      summary: n.summary,
      isApproved: n.isApproved,
      webEnrichmentJson: (n.webEnrichmentJson as OutlineNodeDto['webEnrichmentJson']) || null,
    })),
    existingBook: (raw.project.bookSnapshotJson as unknown as ParsedBook | null) || null,
  };
}

async function logHarnessRevision(params: {
  projectId: string;
  ownerUid: string;
  actorType: 'user' | 'ai' | 'system';
  actorName: string;
  actionType: RevisionActionType;
  title: string;
  summary: string;
  extraDetails?: Record<string, unknown>;
}): Promise<void> {
  try {
    const raw = await getProjectBundle(params.projectId, params.ownerUid);
    if (!raw) return;
    const snapshot = buildRevisionSnapshotPayload({
      project: raw.project,
      outlineNodes: raw.outlineNodes,
      contentUnits: raw.contentUnits,
      conflicts: raw.conflicts,
    });
    await createProjectRevisionRecord({
      id: `rev-${crypto.randomUUID().slice(0, 12)}`,
      projectId: params.projectId,
      actorType: params.actorType,
      actorName: params.actorName,
      actionType: params.actionType,
      title: params.title,
      summary: params.summary,
      detailsJson: {
        pipelineStage: raw.project.pipelineStage,
        chaptersCount: raw.outlineNodes.filter((n) => n.level === 1).length,
        unitsCount: raw.contentUnits.length,
        hasBookSnapshot: Boolean(raw.project.bookSnapshotJson),
        ...(params.extraDetails || {}),
      },
      snapshotJson: snapshot as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.warn('[Harness] Failed to log revision:', err);
  }
}

export async function initHarnessBlueprintForProject(params: {
  req: express.Request;
  projectId: string;
  ownerUid: string;
  budgetCapUsd?: number;
  validationDomain?: ValidationDomain;
  forceReset?: boolean;
}) {
  const raw = await getProjectBundle(params.projectId, params.ownerUid);
  if (!raw) return null;

  const existingCheckpoint =
    (raw.project.checkpointJson as Record<string, unknown> | null) || {};
  const existingHarness = extractHarnessStateFromCheckpoint(existingCheckpoint);

  const projectSettings = (raw.project.settingsJson as Partial<DocxExportConfig> | null) || {};
  const resolvedDomain: ValidationDomain =
    params.validationDomain === 'general_persian_technical' || params.validationDomain === 'ecu_winols'
      ? params.validationDomain
      : existingHarness?.blueprint.validationDomain === 'general_persian_technical'
        ? 'general_persian_technical'
        : projectSettings.validationDomain === 'general_persian_technical'
          ? 'general_persian_technical'
          : 'ecu_winols';

  const authorCtx = resolveProviderForTaskFromRequest(
    params.req,
    'harness_author',
    'gemini-4-hydrogen'
  );
  const utilityCtx = resolveProviderForTaskFromRequest(
    params.req,
    'harness_utility',
    'gemini-3.8-flash'
  );
  const patchCtx = resolveProviderForTaskFromRequest(
    params.req,
    'harness_patch',
    'gemini-4-hydrogen'
  );
  const authorModelId = getEffectiveModelIdFromCtx(authorCtx);
  const utilityModelId = getEffectiveModelIdFromCtx(utilityCtx);
  const patchModelId = getEffectiveModelIdFromCtx(patchCtx);

  if (existingHarness && !params.forceReset) {
    existingHarness.blueprint.validationDomain = resolvedDomain;
    const costEst = estimateHarnessRunCost({
      blueprint: existingHarness.blueprint,
      authorModelId,
      utilityModelId,
      immutablePrefixText: buildImmutableCachedPrefix(existingHarness.glossary, { validationDomain: resolvedDomain }),
      enablePromptCaching: authorCtx.enablePromptCaching,
      authorProvider: authorCtx.provider.provider,
      authorBaseUrl: authorCtx.provider.baseUrl,
      calibrationFactor: existingHarness.telemetry.tokenCalibrationFactor ?? 1.0,
    });
    existingHarness.blueprint.estimatedTotalCostUsd = costEst.estimatedCostWithCacheUsd;
    existingHarness.blueprint.estimatedSavingsPercent = costEst.savingsPercent;
    existingHarness.telemetry.prefixHash = costEst.prefixHash || existingHarness.telemetry.prefixHash || null;
    existingHarness.telemetry.prefixCacheWarningFa = costEst.cacheThresholdWarningFa || null;
    if (typeof params.budgetCapUsd === 'number' && params.budgetCapUsd > 0) {
      existingHarness.blueprint.budgetCapUsd = params.budgetCapUsd;
    }
    return {
      harnessState: existingHarness,
      routingInfo: {
        authorModelId,
        patchModelId,
        utilityModelId,
        enablePromptCaching: authorCtx.enablePromptCaching,
      },
      rawBundle: raw,
    };
  }

  const dto = toDtoShapes(raw);
  const budgetCap =
    typeof params.budgetCapUsd === 'number' && params.budgetCapUsd > 0
      ? params.budgetCapUsd
      : authorCtx.hardCostCapUsd ?? 2.0;

  const harnessState = buildInitialHarnessState({
    projectId: params.projectId,
    outlineNodes: dto.outlineNodes,
    contentUnits: dto.contentUnits,
    sourceFiles: dto.sourceFiles,
    budgetCapUsd: budgetCap,
    authorModelId,
    utilityModelId,
    enablePromptCaching: authorCtx.enablePromptCaching,
    existingVersion: existingHarness?.blueprint.version || 0,
    validationDomain: resolvedDomain,
  });

  // Evaluate honest provider-aware cache threshold & prefixHash immediately for HITL transparency
  const initialCostEst = estimateHarnessRunCost({
    blueprint: harnessState.blueprint,
    authorModelId,
    utilityModelId,
    immutablePrefixText: buildImmutableCachedPrefix(harnessState.glossary, { validationDomain: resolvedDomain }),
    enablePromptCaching: authorCtx.enablePromptCaching,
    authorProvider: authorCtx.provider.provider,
    authorBaseUrl: authorCtx.provider.baseUrl,
    calibrationFactor: harnessState.telemetry.tokenCalibrationFactor ?? 1.0,
  });
  harnessState.blueprint.estimatedTotalCostUsd = initialCostEst.estimatedCostWithCacheUsd;
  harnessState.blueprint.estimatedSavingsPercent = initialCostEst.savingsPercent;
  harnessState.telemetry.prefixHash = initialCostEst.prefixHash || null;
  harnessState.telemetry.prefixCacheWarningFa = initialCostEst.cacheThresholdWarningFa || null;

  await updateProjectRecord(params.projectId, params.ownerUid, {
    checkpointJson: {
      ...existingCheckpoint,
      harnessState,
    },
  });

  const refreshed = (await getProjectBundle(params.projectId, params.ownerUid)) || raw;
  return {
    harnessState,
    routingInfo: {
      authorModelId,
      patchModelId,
      utilityModelId,
      enablePromptCaching: authorCtx.enablePromptCaching,
    },
    rawBundle: refreshed,
  };
}

export async function approveHarnessBlueprintForProject(params: {
  req: express.Request;
  projectId: string;
  ownerUid: string;
  budgetCapUsd?: number;
  glossaryEntries?: GlossaryTermEntry[];
  validationDomain?: ValidationDomain;
  actorName: string;
}) {
  const initRes = await initHarnessBlueprintForProject({
    req: params.req,
    projectId: params.projectId,
    ownerUid: params.ownerUid,
    budgetCapUsd: params.budgetCapUsd,
    validationDomain: params.validationDomain,
    forceReset: false,
  });
  if (!initRes) return null;

  const { harnessState, routingInfo, rawBundle } = initRes;
  const now = new Date().toISOString();

  if (typeof params.budgetCapUsd === 'number' && params.budgetCapUsd > 0) {
    harnessState.blueprint.budgetCapUsd = params.budgetCapUsd;
  }
  if (
    params.validationDomain === 'general_persian_technical' ||
    params.validationDomain === 'ecu_winols'
  ) {
    harnessState.blueprint.validationDomain = params.validationDomain;
  }
  const activeDomain: ValidationDomain = harnessState.blueprint.validationDomain || 'ecu_winols';
  if (Array.isArray(params.glossaryEntries)) {
    harnessState.glossary.entries = params.glossaryEntries;
  }
  harnessState.glossary.frozen = true;
  harnessState.glossary.updatedAt = now;
  harnessState.blueprint.approved = true;
  harnessState.blueprint.approvedAt = now;
  harnessState.blueprint.frozenGlossaryVersion = harnessState.glossary.version;

  // Lock source corpus & per-chunk hashes at HITL approval time (Source Mutation Drift Guard)
  const approvalDto = toDtoShapes(rawBundle);
  const approvalChunksMap = buildSourceChunksMap(
    approvalDto.contentUnits,
    approvalDto.sourceFiles
  );
  const approvalChunks = Array.from(approvalChunksMap.values());
  const corpusFingerprint = computeSourceCorpusFingerprint(approvalChunks);
  harnessState.blueprint.sourceCorpusHash = corpusFingerprint.sourceCorpusHash;
  harnessState.blueprint.chunkContentHashes = corpusFingerprint.chunkContentHashes;
  harnessState.blueprint.blueprintAudit = auditMasterBlueprint({
    sections: harnessState.blueprint.sections,
    allChunks: approvalChunks,
  });

  harnessState.status = 'running';
  harnessState.telemetry.pausedByBudgetCap = false;
  harnessState.telemetry.budgetCapMessage = null;
  harnessState.updatedAt = now;

  // Recalculate cost estimate against frozen glossary + lock prefixHash & cache threshold warning
  const authorCtxForEstimate = resolveProviderForTaskFromRequest(
    params.req,
    'harness_author',
    'gemini-4-hydrogen'
  );
  const costEst = estimateHarnessRunCost({
    blueprint: harnessState.blueprint,
    authorModelId: routingInfo.authorModelId,
    utilityModelId: routingInfo.utilityModelId,
    immutablePrefixText: buildImmutableCachedPrefix(harnessState.glossary, { validationDomain: activeDomain }),
    enablePromptCaching: routingInfo.enablePromptCaching,
    authorProvider: authorCtxForEstimate.provider.provider,
    authorBaseUrl: authorCtxForEstimate.provider.baseUrl,
    calibrationFactor: harnessState.telemetry.tokenCalibrationFactor ?? 1.0,
  });
  harnessState.blueprint.estimatedTotalCostUsd = costEst.estimatedCostWithCacheUsd;
  harnessState.blueprint.estimatedSavingsPercent = costEst.savingsPercent;
  harnessState.telemetry.prefixHash = costEst.prefixHash || null;
  harnessState.telemetry.prefixCacheWarningFa = costEst.cacheThresholdWarningFa || null;

  const existingCheckpoint =
    (rawBundle.project.checkpointJson as Record<string, unknown> | null) || {};
  const existingSettings = (rawBundle.project.settingsJson as Record<string, unknown> | null) || {};
  await updateProjectRecord(params.projectId, params.ownerUid, {
    settingsJson: {
      ...existingSettings,
      validationDomain: activeDomain,
    },
    checkpointJson: {
      ...existingCheckpoint,
      harnessState,
    },
  });

  await logHarnessRevision({
    projectId: params.projectId,
    ownerUid: params.ownerUid,
    actorType: 'user',
    actorName: params.actorName,
    actionType: 'harness_blueprint_approved',
    title: `تأیید نقشه راه هارنس (نسخه ${toPersianDigits(harnessState.blueprint.version)})`,
    summary: `نقشه ${toPersianDigits(harnessState.blueprint.totalSections)} زیربخش و واژه‌نامه زنده (${toPersianDigits(harnessState.glossary.entries.length)} اصطلاح) با سقف بودجه $${harnessState.blueprint.budgetCapUsd.toFixed(2)} تایید و فریز شد.`,
  });

  const refreshed = (await getProjectBundle(params.projectId, params.ownerUid)) || rawBundle;
  return {
    harnessState,
    routingInfo,
    rawBundle: refreshed,
  };
}

async function runLayer2SemanticJudge(params: {
  judgeCtx: TaskResolvedAiContext;
  section: BlueprintSection;
  sectionIR: SemanticSectionIR;
  sourceChunks: HarnessSourceChunk[];
  harnessState: HarnessState;
  allowBudgetOverride?: boolean;
  abortSignal?: AbortSignal;
}): Promise<{ audit: Layer2AuditResult; usageDelta: AiUsageDelta; modelUsed: string }> {
  const promptPayload = buildLayer2JudgePrompt({
    section: params.section,
    sectionIR: params.sectionIR,
    sourceChunks: params.sourceChunks,
    glossary: params.harnessState.glossary,
    validationDomain: params.harnessState.blueprint.validationDomain,
  });

  const judgeRes = await invokeTrackedHarnessSubcall({
    harnessState: params.harnessState,
    sectionId: params.section.sectionId,
    ledgerRole: 'harness_judge',
    taskRole: 'harness_judge',
    ctx: params.judgeCtx,
    thinkingLevel: ThinkingLevel.LOW,
    systemInstruction: promptPayload.immutableCachedPrefix,
    prompt: promptPayload.dynamicSuffix,
    expectJson: true,
    googleResponseSchema: LAYER2_JUDGE_RESPONSE_SCHEMA,
    jsonSchema: LAYER2_JUDGE_JSON_SCHEMA,
    enablePromptCaching: false,
    allowBudgetOverride: params.allowBudgetOverride,
    abortSignal: params.abortSignal,
  });

  const parsed = safeParseJsonObject<RawJudgeResponsePayload>(judgeRes.text);
  const audit = evaluateJudgeAuditRigorous({
    parsed,
    sectionIR: params.sectionIR,
    sourceChunks: params.sourceChunks,
    modelUsed: judgeRes.modelUsed,
  });

  return {
    audit,
    usageDelta: judgeRes.usageDelta,
    modelUsed: judgeRes.modelUsed,
  };
}

/**
 * Executes ONE strictly stateless subsection step:
 * Concurrency Lease Lock -> Budget Circuit Breaker -> Author (Flagship + Cached Prefix)
 * -> Immediate drafted_unverified persistence -> Output Truncation Guard -> Layer 1 Guard (0 tokens)
 * -> Claim-by-Claim Layer 2 Judge (Fail-Closed Anti-Rubber-Stamp) -> Up to 2 Strict Surgical Patches + Mandatory L1/L2 Re-Audit
 * -> Verify (with full SectionProvenance) OR Quarantine -> Append-Only RollingSummary -> Release Lock -> Persist to Cloud SQL.
 */
export async function executeHarnessStepForProject(params: {
  req: express.Request;
  projectId: string;
  ownerUid: string;
  sectionId?: string;
  allowBudgetOverride?: boolean;
  forceFlagshipForAuthor?: boolean;
  abortSignal?: AbortSignal;
  actorName: string;
}): Promise<{
  done: boolean;
  pausedByBudgetCap?: boolean;
  sectionId?: string;
  outcome?: 'verified' | 'quarantined' | 'budget_paused' | 'completed';
  layer1?: Layer1AuditResult;
  layer2?: Layer2AuditResult;
  harnessState: HarnessState;
  rawBundle: NonNullable<Awaited<ReturnType<typeof getProjectBundle>>>;
} | null> {
  const raw = await getProjectBundle(params.projectId, params.ownerUid);
  if (!raw) return null;

  const existingCheckpoint =
    (raw.project.checkpointJson as Record<string, unknown> | null) || {};
  let harnessState = extractHarnessStateFromCheckpoint(existingCheckpoint);

  if (!harnessState) {
    const init = await initHarnessBlueprintForProject({
      req: params.req,
      projectId: params.projectId,
      ownerUid: params.ownerUid,
    });
    if (!init) return null;
    harnessState = init.harnessState;
  }

  if (!harnessState.blueprint.approved) {
    throw new Error('پیش از اجرای هارنس، ابتدا باید نقشه راه (MasterBlueprint) را در دروازه تأیید (HITL Gate) تایید کنید.');
  }

  const dto = toDtoShapes(raw);
  const chunksMap = buildSourceChunksMap(dto.contentUnits, dto.sourceFiles);
  const allActiveChunks = Array.from(chunksMap.values());

  // Package A Red-Team Guard: Halt immediately if Stage 1 source chunks mutated after HITL approval
  const driftCheck = detectSourceCorpusDrift(harnessState.blueprint, allActiveChunks);
  if (driftCheck.drifted) {
    throw new Error(
      `[source_drift_detected] ${driftCheck.messageFa || 'منابع مرحله ۱ پس از تأیید نقشه راه تغییر کرده‌اند؛ ابتدا نقشه راه را بازسازی و مجدداً تأیید کنید.'}`
    );
  }

  // Pick explicit sectionId or next pending/drafted/drafted_unverified subsection
  const targetSection = params.sectionId
    ? harnessState.blueprint.sections.find((s) => s.sectionId === params.sectionId)
    : harnessState.blueprint.sections.find((s) => {
        const st = harnessState!.coverageLedger.bySectionId[s.sectionId]?.status || 'pending';
        return st === 'pending' || st === 'drafted' || st === 'drafted_unverified';
      });

  if (!targetSection) {
    const now = new Date().toISOString();
    harnessState.status = 'completed';
    harnessState.activeStepLock = null;
    harnessState.updatedAt = now;
    const compiledBook = convertHarnessStateToParsedBook({
      harnessState,
      projectTitle: raw.project.title,
      sourceFiles: dto.sourceFiles,
      contentUnits: dto.contentUnits,
      existingBook: dto.existingBook,
    });
    await updateProjectRecord(params.projectId, params.ownerUid, {
      checkpointJson: { ...existingCheckpoint, harnessState },
      bookSnapshotJson: compiledBook as unknown as Record<string, unknown>,
    });
    const refreshed = (await getProjectBundle(params.projectId, params.ownerUid)) || raw;
    return {
      done: true,
      outcome: 'completed',
      harnessState,
      rawBundle: refreshed,
    };
  }

  let projectUsage = extractAiUsageFromCheckpoint(existingCheckpoint);

  // Package C: Acquire concurrency lease lock (stepRunId + 180s Lease TTL) -> 409 Conflict if active
  const stepRunId = `run-${crypto.randomUUID().slice(0, 12)}`;
  const lockAttempt = acquireStepLock({
    existingLock: harnessState.activeStepLock,
    stepRunId,
    sectionId: targetSection.sectionId,
    ttlMs: DEFAULT_STEP_LOCK_TTL_MS,
  });
  if (!lockAttempt.acquired) {
    throw new HarnessStepConflictError(lockAttempt.lock, lockAttempt.messageFa);
  }
  harnessState.activeStepLock = lockAttempt.lock;
  harnessState.updatedAt = lockAttempt.lock.acquiredAt;
  await updateProjectRecord(params.projectId, params.ownerUid, {
    checkpointJson: { ...existingCheckpoint, aiUsage: projectUsage, harnessState },
  });

  const renewOwnLock = async (persistToDb = false) => {
    const renewed = renewStepLockHeartbeat({
      existingLock: harnessState!.activeStepLock,
      stepRunId,
      ttlMs: DEFAULT_STEP_LOCK_TTL_MS,
    });
    if (renewed.renewed) {
      harnessState!.activeStepLock = renewed.lock;
      if (persistToDb) {
        try {
          await updateProjectRecord(params.projectId, params.ownerUid, {
            checkpointJson: { ...existingCheckpoint, aiUsage: projectUsage, harnessState },
          });
        } catch {
          // Best-effort heartbeat write
        }
      }
    }
  };

  let lockReleased = false;
  const releaseOwnLockInMemory = () => {
    const rel = releaseStepLock({
      existingLock: harnessState!.activeStepLock,
      stepRunId,
    });
    harnessState!.activeStepLock = rel.nextLock;
    if (rel.released) lockReleased = true;
  };

  const persistBudgetPause = async (reasonFa: string) => {
    const now = new Date().toISOString();
    harnessState!.status = 'budget_paused';
    harnessState!.telemetry.pausedByBudgetCap = true;
    harnessState!.telemetry.budgetCapMessage = reasonFa;
    releaseOwnLockInMemory();
    harnessState!.updatedAt = now;

    await updateProjectRecord(params.projectId, params.ownerUid, {
      checkpointJson: { ...existingCheckpoint, aiUsage: projectUsage, harnessState },
    });
    const refreshed = (await getProjectBundle(params.projectId, params.ownerUid)) || raw;
    return {
      done: false,
      pausedByBudgetCap: true,
      sectionId: targetSection.sectionId,
      outcome: 'budget_paused' as const,
      harnessState: harnessState!,
      rawBundle: refreshed,
    };
  };

  try {
    assertNotAborted(params.abortSignal, 'pre_step');

    // Pre-step Budget Circuit Breaker check (counting settled + unreconciled timeout charges)
    const preStepSpend = computeEffectiveTotalSpentUsd(
      harnessState.telemetry.costAuditLedger,
      harnessState.telemetry.estimatedCostUsd
    );
    const budgetCheck = evaluateBudgetCircuitBreaker({
      currentSpentUsd: preStepSpend.settledUsd,
      unreconciledCostUsd: preStepSpend.unreconciledUsd,
      estimatedNextCallUsd: Math.max(0.001, targetSection.estimatedCostUsd || 0.01),
      budgetCapUsd: harnessState.blueprint.budgetCapUsd,
      subcallRole: 'harness_author',
      overrideApproved: Boolean(params.allowBudgetOverride),
    });

    if (!budgetCheck.allowed) {
      return await persistBudgetPause(budgetCheck.reasonFa || 'سقف بودجه هارنس تکمیل شد.');
    }

    // Resolve 3-Tier providers from request headers (with optional Flagship escalation for Gate 2 retry)
    const authorCtx = resolveProviderForTaskFromRequest(
      params.req,
      'harness_author',
      'gemini-4-hydrogen',
      params.forceFlagshipForAuthor ? 'flagship' : undefined
    );
    const patchCtx = resolveProviderForTaskFromRequest(
      params.req,
      'harness_patch',
      'gemini-4-hydrogen',
      params.forceFlagshipForAuthor ? 'flagship' : undefined
    );
    const rawJudgeCtx = resolveProviderForTaskFromRequest(
      params.req,
      'harness_judge',
      'gemini-3.8-flash'
    );
    const judgeCtx = rawJudgeCtx.provider.validationError ? authorCtx : rawJudgeCtx;
    const utilityCtx = resolveProviderForTaskFromRequest(
      params.req,
      'harness_utility',
      'gemini-3.8-flash'
    );

    if (authorCtx.provider.validationError) {
      throw new Error(authorCtx.provider.validationError);
    }

    const activeValidationDomain: ValidationDomain =
      harnessState.blueprint.validationDomain ||
      ((raw.project.settingsJson as Partial<DocxExportConfig> | null)?.validationDomain ===
      'general_persian_technical'
        ? 'general_persian_technical'
        : 'ecu_winols');

    const sourceChunks: HarnessSourceChunk[] = targetSection.sourceChunkIds
      .map((id) => chunksMap.get(id))
      .filter((c): c is HarnessSourceChunk => Boolean(c));

    const remainingSectionsCount = harnessState.blueprint.sections.filter((s) => {
      const st = harnessState!.coverageLedger.bySectionId[s.sectionId]?.status || 'pending';
      return st === 'pending' || st === 'drafted' || st === 'drafted_unverified';
    }).length;

    // 1. STATELESS AUTHOR CALL (Immutable Cached Prefix + Isolated Dynamic Suffix + Strict Schema on Google & Custom)
    const authorPrompt = buildStatelessAuthorPrompt({
      glossary: harnessState.glossary,
      section: targetSection,
      sourceChunks,
      rollingSummary: harnessState.rollingSummary,
      validationDomain: activeValidationDomain,
    });

    const prefixPolicy = evaluatePrefixCachePolicy({
      prefixText: authorPrompt.immutableCachedPrefix,
      provider: authorCtx.provider.provider,
      baseUrl: authorCtx.provider.baseUrl,
      modelId: getEffectiveModelIdFromCtx(authorCtx),
      lastPrefixUsedAt: harnessState.telemetry.lastPrefixUsedAt,
      remainingSections: Math.max(1, remainingSectionsCount),
      calibrationFactor: harnessState.telemetry.tokenCalibrationFactor ?? 1.0,
    });
    const enableCacheForRun = authorCtx.enablePromptCaching && prefixPolicy.shouldEnableCacheWrite;
    harnessState.telemetry.prefixHash = prefixPolicy.prefixHash;
    harnessState.telemetry.prefixCacheWarningFa = prefixPolicy.thresholdWarningFa;

    let authorRes: Awaited<ReturnType<typeof invokeTrackedHarnessSubcall>>;
    try {
      authorRes = await invokeTrackedHarnessSubcall({
        harnessState,
        sectionId: targetSection.sectionId,
        ledgerRole: 'harness_author',
        taskRole: 'harness_author',
        ctx: authorCtx,
        thinkingLevel: ThinkingLevel.MEDIUM,
        systemInstruction: authorPrompt.immutableCachedPrefix,
        prompt: authorPrompt.dynamicSuffix,
        expectJson: true,
        googleResponseSchema: SEMANTIC_SECTION_IR_RESPONSE_SCHEMA,
        jsonSchema: SEMANTIC_SECTION_IR_JSON_SCHEMA,
        enablePromptCaching: enableCacheForRun,
        usedLockedPrefix: enableCacheForRun,
        haltOnAuthorDowngrade: true,
        allowBudgetOverride: params.allowBudgetOverride,
        abortSignal: params.abortSignal,
      });
    } catch (err) {
      if (err instanceof HarnessBudgetPausedSignal) {
        return await persistBudgetPause(err.message);
      }
      throw err;
    }

    projectUsage = mergeAiUsageDelta(projectUsage, authorRes.usageDelta);
    await renewOwnLock(false);

    const parsedAuthor = safeParseJsonObject<{
      sectionId?: string;
      title?: string;
      blocks?: unknown;
      newGlossaryTerms?: Array<{ term?: string; canonicalForm?: string; unit?: string; notes?: string }>;
    }>(authorRes.text);

    // Record newly discovered terms safely in deltaEntries (never mutating frozen prefix mid-chapter)
    if (Array.isArray(parsedAuthor?.newGlossaryTerms) && parsedAuthor.newGlossaryTerms.length > 0) {
      const existingBaseTerms = new Set(
        harnessState.glossary.entries.map((g) => g.canonicalTerm.toLowerCase())
      );
      const existingDeltaTerms = new Set(
        (harnessState.glossary.deltaEntries || []).map((g) => g.canonicalTerm.toLowerCase())
      );
      const deltaList = [...(harnessState.glossary.deltaEntries || [])];
      for (const item of parsedAuthor.newGlossaryTerms.slice(0, 6)) {
        const term = String(item?.term || '').trim();
        const canonicalForm = String(item?.canonicalForm || term).trim();
        if (!term || term.length < 2) continue;
        const low = term.toLowerCase();
        if (existingBaseTerms.has(low) || existingDeltaTerms.has(low)) continue;
        existingDeltaTerms.add(low);
        deltaList.push({
          id: `gl-delta-${deltaList.length + 1}-${low.replace(/[^a-z0-9_-]+/gi, '').slice(0, 12) || 'term'}`,
          canonicalTerm: canonicalForm || term,
          enEquivalents: [term],
          faEquivalents: item.notes ? [item.notes.trim()] : [term],
          forbiddenVariants: [],
          category: 'general',
          definitionFa:
            [item.notes?.trim(), item.unit?.trim() ? `واحد: ${item.unit.trim()}` : '']
              .filter(Boolean)
              .join(' — ') || canonicalForm,
          sourceChunkIds: targetSection.sourceChunkIds.slice(0, 2),
        });
      }
      harnessState.glossary.deltaEntries = deltaList;
    }

    const resolvedTier: SemanticSectionIR['tierUsed'] =
      authorCtx.tierUsed === 'economy' ||
      authorCtx.tierUsed === 'balanced' ||
      authorCtx.tierUsed === 'flagship'
        ? authorCtx.tierUsed
        : 'flagship';

    let lastFinishReason: string | null = authorRes.finishReason ?? null;
    let outputTruncatedEval = evaluateOutputTruncation({
      finishReason: lastFinishReason,
      sectionId: targetSection.sectionId,
    });

    let currentIR: SemanticSectionIR = {
      sectionId: targetSection.sectionId,
      chapterId: targetSection.chapterId,
      title: parsedAuthor?.title?.trim() || targetSection.title,
      sourceChunkIds: [...targetSection.sourceChunkIds],
      generatedAt: new Date().toISOString(),
      modelUsed: authorRes.modelUsed,
      tierUsed: resolvedTier,
      blocks: normalizeSemanticBlocks(parsedAuthor?.blocks, targetSection.sourceChunkIds),
      provenance: buildSectionProvenance({
        prefixHash: prefixPolicy.prefixHash,
        authorModelUsed: authorRes.modelUsed,
        judgeModelUsed: null,
        patchAttempts: 0,
        finishReason: lastFinishReason,
        outputTruncated: outputTruncatedEval.truncated,
        sourceChunks,
      }),
    };

    // Package C: Immediately persist `drafted_unverified` BEFORE Judge/Patch so pause/abort never wastes draft!
    const draftTs = new Date().toISOString();
    harnessState.sectionsIR[targetSection.sectionId] = currentIR;
    harnessState.coverageLedger.bySectionId[targetSection.sectionId] = {
      sectionId: targetSection.sectionId,
      chapterId: targetSection.chapterId,
      status: 'drafted_unverified',
      attempts: 0,
      layer1Passed: false,
      layer2Passed: false,
      lastError: outputTruncatedEval.issue?.messageFa || null,
      lastUpdatedAt: draftTs,
    };
    for (const cid of targetSection.sourceChunkIds) {
      if (harnessState.coverageLedger.byChunkId[cid]) {
        harnessState.coverageLedger.byChunkId[cid].status = 'drafted_unverified';
        harnessState.coverageLedger.byChunkId[cid].updatedAt = draftTs;
      }
    }
    harnessState.updatedAt = draftTs;
    await updateProjectRecord(params.projectId, params.ownerUid, {
      checkpointJson: { ...existingCheckpoint, aiUsage: projectUsage, harnessState },
    });

    assertNotAborted(params.abortSignal, 'layer1_and_judge');

    // 2. LAYER 1 DETERMINISTIC GUARD (0 TOKENS) + OUTPUT TRUNCATION + FAIL-CLOSED LAYER 2 JUDGE + STRICT SURGICAL PATCH (MAX 2)
    const MAX_PATCH_ATTEMPTS = 2;
    let attempts = 0;
    let reAuditedAfterLastPatch = true;
    const knownSectionIds = harnessState.blueprint.sections.map((s) => s.sectionId);
    const previousChapterSectionsIR = harnessState.blueprint.sections
      .filter(
        (s) =>
          s.chapterId === targetSection.chapterId &&
          s.sectionOrder < targetSection.sectionOrder
      )
      .sort((a, b) => a.sectionOrder - b.sectionOrder)
      .slice(-5)
      .map((s) => harnessState!.sectionsIR[s.sectionId])
      .filter((ir): ir is SemanticSectionIR => Boolean(ir));

    const layer1Options = {
      previousChapterSectionsIR,
      knownSectionIds,
      allowedEcuPlatformTags: targetSection.ecuPlatformTags,
      validationDomain: activeValidationDomain,
    };

    const runLayer1WithTruncation = (ir: SemanticSectionIR, truncEval: typeof outputTruncatedEval) => {
      const baseAudit = runLayer1DeterministicGuard(
        ir,
        sourceChunks,
        harnessState!.glossary,
        layer1Options
      );
      if (truncEval.truncated && truncEval.issue) {
        return {
          ...baseAudit,
          passed: false,
          issues: [truncEval.issue, ...baseAudit.issues],
        };
      }
      return baseAudit;
    };

    let l1Audit = runLayer1WithTruncation(currentIR, outputTruncatedEval);
    let l2Audit: Layer2AuditResult = {
      passed: false,
      score: 0,
      summaryFa: 'در انتظار عبور از گارد قطعی لایه ۱.',
      issues: [],
      invalidBlockIds: [],
      modelUsed: getEffectiveModelIdFromCtx(judgeCtx),
    };
    let judgeModelActuallyUsed: string | null = null;

    if (l1Audit.passed && !judgeCtx.provider.validationError) {
      let judgeSuccess = false;
      let lastJudgeErr: unknown = null;
      for (let jTry = 0; jTry < 2 && !judgeSuccess; jTry++) {
        try {
          const judgeOut = await runLayer2SemanticJudge({
            judgeCtx,
            section: targetSection,
            sectionIR: currentIR,
            sourceChunks,
            harnessState,
            allowBudgetOverride: params.allowBudgetOverride,
            abortSignal: params.abortSignal,
          });
          l2Audit = judgeOut.audit;
          judgeModelActuallyUsed = judgeOut.modelUsed;
          projectUsage = mergeAiUsageDelta(projectUsage, judgeOut.usageDelta);
          await renewOwnLock(true);
          judgeSuccess = true;
        } catch (err) {
          if (err instanceof HarnessBudgetPausedSignal) {
            return await persistBudgetPause(err.message);
          }
          if (err instanceof HarnessRunAbortedError) {
            throw err;
          }
          if (err instanceof ProviderGatewayError && err.neverEnterPatchLoop) {
            throw err;
          }
          lastJudgeErr = err;
        }
      }
      // Fail-Closed Judge: never rubber-stamp passed:true if Layer 2 Judge failed both attempts!
      if (!judgeSuccess) {
        const errMsg = lastJudgeErr instanceof Error ? lastJudgeErr.message : 'خطای ارتباط با مدل داور';
        l2Audit = {
          passed: false,
          score: 0,
          summaryFa: `داوری لایه ۲ ناموفق ماند (${errMsg.slice(0, 120)})؛ برای جلوگیری از تأیید کاذب Fail-Closed متوقف شد.`,
          issues: [
            {
              id: 'l2-fail-closed',
              category: 'structure',
              severity: 'error',
              messageFa: `ممیزی لایه ۲ تکمیل نشد (${errMsg.slice(0, 100)}).`,
            },
          ],
          invalidBlockIds: [],
          modelUsed: getEffectiveModelIdFromCtx(judgeCtx),
        };
      }
    } else if (l1Audit.passed) {
      // Only reached if no AI provider key is usable at all for Judge
      l2Audit = {
        passed: false,
        score: 0,
        summaryFa: 'داور لایه ۲ به دلیل نبود کلید معتبر در دسترس نیست (Fail-Closed).',
        issues: [
          {
            id: 'l2-no-key-fail-closed',
            category: 'structure',
            severity: 'error',
            messageFa: 'کلید API برای داور لایه ۲ در دسترس نیست.',
          },
        ],
        invalidBlockIds: [],
        modelUsed: getEffectiveModelIdFromCtx(judgeCtx),
      };
    }

    while ((!l1Audit.passed || !l2Audit.passed) && attempts < MAX_PATCH_ATTEMPTS) {
      assertNotAborted(params.abortSignal, `harness_patch_${attempts + 1}`);
      const plan = buildSurgicalPatchPlan({
        section: targetSection,
        sectionIR: currentIR,
        layer1Issues: l1Audit.issues,
        layer2Issues: l2Audit.issues,
        sourceChunks,
        previousAttempts: attempts,
        maxAttempts: MAX_PATCH_ATTEMPTS,
      });

      if (plan.action === 'quarantine') break;

      const patchPrompt = buildSurgicalPatchPrompt({
        glossary: harnessState.glossary,
        section: targetSection,
        faultyBlocks: plan.faultyBlocks,
        layer1Issues: plan.focusedLayer1Issues,
        layer2Issues: plan.focusedLayer2Issues,
        minimalSourceChunks: plan.minimalSourceChunks,
        validationDomain: activeValidationDomain,
      });

      const effectivePatchCtx = patchCtx.provider.validationError ? authorCtx : patchCtx;
      const patchLedgerRole = attempts === 0 ? 'harness_patch_1' : 'harness_patch_2';

      let patchRes: Awaited<ReturnType<typeof invokeTrackedHarnessSubcall>>;
      try {
        patchRes = await invokeTrackedHarnessSubcall({
          harnessState,
          sectionId: targetSection.sectionId,
          ledgerRole: patchLedgerRole,
          taskRole: 'harness_patch',
          ctx: effectivePatchCtx,
          thinkingLevel: ThinkingLevel.LOW,
          systemInstruction: patchPrompt.immutableCachedPrefix,
          prompt: patchPrompt.dynamicSuffix,
          expectJson: true,
          googleResponseSchema: SURGICAL_PATCH_RESPONSE_SCHEMA,
          jsonSchema: SURGICAL_PATCH_JSON_SCHEMA,
          enablePromptCaching: enableCacheForRun,
          usedLockedPrefix: enableCacheForRun,
          allowBudgetOverride: params.allowBudgetOverride,
          abortSignal: params.abortSignal,
        });
      } catch (err) {
        if (err instanceof HarnessBudgetPausedSignal) {
          return await persistBudgetPause(err.message);
        }
        throw err;
      }

      projectUsage = mergeAiUsageDelta(projectUsage, patchRes.usageDelta);
      await renewOwnLock(true);

      lastFinishReason = patchRes.finishReason ?? lastFinishReason;
      const patchTruncEval = evaluateOutputTruncation({
        finishReason: patchRes.finishReason,
        sectionId: targetSection.sectionId,
      });
      const wasPreviouslyTruncated = outputTruncatedEval.truncated;
      outputTruncatedEval = patchTruncEval;

      const parsedPatch = safeParseJsonObject<{
        patchedBlocks?: unknown;
        blocks?: unknown;
      }>(patchRes.text);

      // Bug #6: Prefer focused faulty blocks' sourceChunkIds as fallback instead of blasting ALL section chunks
      const focusedChunkIds = Array.from(
        new Set(plan.faultyBlocks.flatMap((b) => b.sourceChunkIds || []))
      );
      const patchFallbackChunkIds =
        focusedChunkIds.length > 0 && !plan.requiresFullSectionRewrite
          ? focusedChunkIds
          : targetSection.sourceChunkIds;

      const patchedBlocks = normalizeSemanticBlocks(
        parsedPatch?.patchedBlocks || parsedPatch?.blocks,
        patchFallbackChunkIds
      );

      attempts += 1;
      reAuditedAfterLastPatch = false;

      if (patchedBlocks.length > 0) {
        const patchMeta = {
          modelUsed: patchRes.modelUsed,
          tierUsed: (
            effectivePatchCtx.tierUsed === 'economy' ||
            effectivePatchCtx.tierUsed === 'balanced' ||
            effectivePatchCtx.tierUsed === 'flagship'
              ? effectivePatchCtx.tierUsed
              : 'balanced'
          ) as SemanticSectionIR['tierUsed'],
        };
        currentIR = plan.requiresFullSectionRewrite
          ? replaceFullSectionBlocksAtomic({
              originalIR: currentIR,
              rewrittenBlocks: patchedBlocks,
              meta: patchMeta,
            })
          : applySurgicalPatchBlocksStrict({
              originalIR: currentIR,
              patchedBlocks,
              targetFaultyBlockIds: plan.faultyBlocks.map((b) => b.id),
              meta: patchMeta,
            }).mergedIR;
        harnessState.sectionsIR[targetSection.sectionId] = currentIR;
      }

      // Bug #4: If author truncated previously and patch didn't verify all chunks, keep truncated signal until L1 proves 100% chunk coverage
      if (wasPreviouslyTruncated && !patchTruncEval.truncated) {
        const citedIds = new Set(currentIR.blocks.flatMap((b) => b.sourceChunkIds || []));
        const missingChunks = targetSection.sourceChunkIds.filter((cid) => !citedIds.has(cid));
        if (missingChunks.length > 0) {
          outputTruncatedEval = {
            truncated: true,
            code: 'output_truncated',
            rawFinishReason: lastFinishReason,
            normalizedFinishReason: 'length',
            issue: {
              id: `trunc-uncovered-${targetSection.sectionId}`,
              kind: 'missing_source_chunk',
              severity: 'error',
              messageFa: `پاسخ برش‌خورده بود و هنوز ${toPersianDigits(missingChunks.length)} قطعه منبع در بلوک‌های بازنویسی‌شده پوشش داده نشده است.`,
            },
          };
        }
      }

      // Mandatory post-patch Dual-Layer Re-Audit (L1 + L2)
      l1Audit = runLayer1WithTruncation(currentIR, outputTruncatedEval);
      if (l1Audit.passed && !judgeCtx.provider.validationError) {
        try {
          const judgeOut = await runLayer2SemanticJudge({
            judgeCtx,
            section: targetSection,
            sectionIR: currentIR,
            sourceChunks,
            harnessState,
            allowBudgetOverride: params.allowBudgetOverride,
            abortSignal: params.abortSignal,
          });
          l2Audit = judgeOut.audit;
          judgeModelActuallyUsed = judgeOut.modelUsed;
          projectUsage = mergeAiUsageDelta(projectUsage, judgeOut.usageDelta);
          reAuditedAfterLastPatch = true;
          await renewOwnLock(true);
        } catch (err) {
          if (err instanceof HarnessBudgetPausedSignal) {
            return await persistBudgetPause(err.message);
          }
          if (err instanceof HarnessRunAbortedError) {
            throw err;
          }
          if (err instanceof ProviderGatewayError && err.neverEnterPatchLoop) {
            throw err;
          }
          l2Audit = {
            passed: false,
            score: 0,
            summaryFa: 'بازممیزی لایه ۲ پس از ترمیم جراحی با خطا مواجه شد؛ برای جلوگیری از تأیید کاذب متوقف شد.',
            issues: [
              {
                id: 'l2-reaudit-failed',
                category: 'structure',
                severity: 'error',
                messageFa: 'بازممیزی اجباری لایه ۲ پس از ترمیم جراحی کامل نشد.',
              },
            ],
            invalidBlockIds: [],
            modelUsed: getEffectiveModelIdFromCtx(judgeCtx),
          };
          reAuditedAfterLastPatch = false;
        }
      } else {
        l2Audit.passed = false;
        reAuditedAfterLastPatch = true;
      }
    }

    const finishTs = new Date().toISOString();
    // Attach full SectionProvenance on SemanticSectionIR before verification/quarantine persistence
    currentIR = {
      ...currentIR,
      provenance: buildSectionProvenance({
        prefixHash: prefixPolicy.prefixHash,
        authorModelUsed: authorRes.modelUsed,
        judgeModelUsed: judgeModelActuallyUsed,
        patchAttempts: attempts,
        finishReason: lastFinishReason,
        outputTruncated: outputTruncatedEval.truncated,
        lowEffortJudgeFlagged: Boolean(l2Audit.lowEffortJudgeAudit),
        sourceChunks,
        auditedAt: finishTs,
      }),
    };
    harnessState.sectionsIR[targetSection.sectionId] = currentIR;

    const verifyGate = canMarkSectionVerified({
      layer1Passed: l1Audit.passed,
      layer2Passed: l2Audit.passed,
      outputTruncated: outputTruncatedEval.truncated,
      patchAttempts: attempts,
      reAuditedAfterLastPatch,
    });
    const finalPassed = verifyGate.allowed;
    let outcome: 'verified' | 'quarantined' = 'verified';

    if (finalPassed) {
      harnessState.coverageLedger.bySectionId[targetSection.sectionId] = {
        sectionId: targetSection.sectionId,
        chapterId: targetSection.chapterId,
        status: 'verified',
        attempts,
        layer1Passed: true,
        layer2Passed: true,
        lastError: null,
        lastUpdatedAt: finishTs,
      };
      for (const cid of targetSection.sourceChunkIds) {
        if (harnessState.coverageLedger.byChunkId[cid]) {
          harnessState.coverageLedger.byChunkId[cid].status = 'verified';
          harnessState.coverageLedger.byChunkId[cid].updatedAt = finishTs;
        }
      }

      // Remove any previous unresolved quarantine record for this section
      harnessState.quarantineQueue = harnessState.quarantineQueue.filter(
        (q) => q.sectionId !== targetSection.sectionId
      );

      // Append-Only RollingSummary update (Economy tier, strict JSON schema, budget-checked + abort-checked)
      let summaryText = `${targetSection.title} بر اساس ${toPersianDigits(targetSection.sourceChunkIds.length)} قطعه منبع تدوین و تایید شد.`;
      let keyConcepts: string[] = [];

      if (!utilityCtx.provider.validationError && !params.abortSignal?.aborted) {
        try {
          const sumPrompt = buildRollingSummaryUpdatePrompt({
            section: targetSection,
            sectionIR: currentIR,
          });
          const sumRes = await invokeTrackedHarnessSubcall({
            harnessState,
            sectionId: targetSection.sectionId,
            ledgerRole: 'harness_utility',
            taskRole: 'harness_utility',
            ctx: utilityCtx,
            thinkingLevel: ThinkingLevel.MINIMAL,
            systemInstruction: sumPrompt.immutableCachedPrefix,
            prompt: sumPrompt.dynamicSuffix,
            expectJson: true,
            googleResponseSchema: ROLLING_SUMMARY_RESPONSE_SCHEMA,
            jsonSchema: ROLLING_SUMMARY_JSON_SCHEMA,
            enablePromptCaching: false,
            allowBudgetOverride: params.allowBudgetOverride,
            abortSignal: params.abortSignal,
          });
          projectUsage = mergeAiUsageDelta(projectUsage, sumRes.usageDelta);
          const parsedSum = safeParseJsonObject<{ summaryText?: string; keyConcepts?: string[] }>(
            sumRes.text
          );
          if (parsedSum?.summaryText?.trim()) {
            summaryText = parsedSum.summaryText.trim();
          }
          if (Array.isArray(parsedSum?.keyConcepts)) {
            keyConcepts = parsedSum.keyConcepts
              .map((k) => String(k).trim())
              .filter(Boolean)
              .slice(0, 5);
          }
        } catch {
          // Keep deterministic fallback summary (protects verified section if utility hits budget cap or abort)
        }
      }

      const filteredEntries = harnessState.rollingSummary.entries.filter(
        (e) => e.sectionId !== targetSection.sectionId
      );
      filteredEntries.push({
        sectionId: targetSection.sectionId,
        chapterTitle: targetSection.chapterTitle,
        sectionTitle: targetSection.title,
        chapterOrder: targetSection.chapterOrder,
        sectionOrder: targetSection.sectionOrder,
        summaryText,
        keyConcepts,
        updatedAt: finishTs,
      });
      harnessState.rollingSummary = compileCompactRollingSummary(
        filteredEntries,
        harnessState.rollingSummary.maxTokensBudget
      );

      // Two-layer Glossary: merge deltaEntries into base glossary ONLY at chapter boundary
      const hasMoreInSameChapter = harnessState.blueprint.sections.some((s) => {
        if (s.chapterId !== targetSection.chapterId) return false;
        const st = harnessState!.coverageLedger.bySectionId[s.sectionId]?.status || 'pending';
        return st === 'pending' || st === 'drafted' || st === 'drafted_unverified';
      });
      if (
        !hasMoreInSameChapter &&
        Array.isArray(harnessState.glossary.deltaEntries) &&
        harnessState.glossary.deltaEntries.length > 0
      ) {
        harnessState.glossary = mergeDeltaGlossaryAtChapterBoundary(harnessState.glossary);
      }
    } else {
      outcome = 'quarantined';
      const quarantinePlan = buildSurgicalPatchPlan({
        section: targetSection,
        sectionIR: currentIR,
        layer1Issues: l1Audit.issues,
        layer2Issues: l2Audit.issues,
        sourceChunks,
        previousAttempts: MAX_PATCH_ATTEMPTS,
        maxAttempts: MAX_PATCH_ATTEMPTS,
      });

      harnessState.coverageLedger.bySectionId[targetSection.sectionId] = {
        sectionId: targetSection.sectionId,
        chapterId: targetSection.chapterId,
        status: 'quarantined',
        attempts,
        layer1Passed: l1Audit.passed,
        layer2Passed: l2Audit.passed,
        lastError:
          verifyGate.reasonFa ||
          l1Audit.issues[0]?.messageFa ||
          l2Audit.issues[0]?.messageFa ||
          'نیازمند بررسی انسانی در صف قرنطینه',
        lastUpdatedAt: finishTs,
      };
      for (const cid of targetSection.sourceChunkIds) {
        if (harnessState.coverageLedger.byChunkId[cid]) {
          harnessState.coverageLedger.byChunkId[cid].status = 'quarantined';
          harnessState.coverageLedger.byChunkId[cid].updatedAt = finishTs;
        }
      }
      if (quarantinePlan.quarantineItem) {
        harnessState.quarantineQueue = [
          ...harnessState.quarantineQueue.filter((q) => q.sectionId !== targetSection.sectionId),
          quarantinePlan.quarantineItem,
        ];
      }
    }

    // Update telemetry counters, release lock owned by this stepRunId, & check if all sections finished
    const stats = computeCoverageLedgerStats(harnessState.coverageLedger);
    harnessState.telemetry.completedSections = stats.verifiedSections;
    harnessState.telemetry.quarantinedSections = stats.quarantinedSections;
    harnessState.telemetry.pausedByBudgetCap = false;
    harnessState.telemetry.budgetCapMessage = null;
    releaseOwnLockInMemory();
    harnessState.updatedAt = finishTs;

    const hasMorePending = harnessState.blueprint.sections.some((s) => {
      const st = harnessState!.coverageLedger.bySectionId[s.sectionId]?.status || 'pending';
      return st === 'pending' || st === 'drafted' || st === 'drafted_unverified';
    });

    harnessState.status = hasMorePending ? 'running' : 'completed';

    // Always compile fresh bookSnapshotJson & advance Stage/Status + AuditReport when run completes (Bug #9)
    const updatePayload: Parameters<typeof updateProjectRecord>[2] = {
      checkpointJson: {
        ...existingCheckpoint,
        aiUsage: projectUsage,
        harnessState,
      },
    };

    if (!hasMorePending || dto.existingBook) {
      const compiledBook = convertHarnessStateToParsedBook({
        harnessState,
        projectTitle: raw.project.title,
        sourceFiles: dto.sourceFiles,
        contentUnits: dto.contentUnits,
        existingBook: dto.existingBook,
      });
      updatePayload.bookSnapshotJson = compiledBook as unknown as Record<string, unknown>;
    }

    if (!hasMorePending) {
      const fullyVerified = stats.quarantinedSections === 0;
      updatePayload.pipelineStage = fullyVerified ? 5 : 4;
      updatePayload.status = fullyVerified ? 'completed' : 'structuring';

      const uniqueUnitsCount = dto.contentUnits.filter(
        (u) => u.status !== 'merged' && u.status !== 'merged_duplicate'
      ).length;
      const mergedDuplicatesCount = dto.contentUnits.length - uniqueUnitsCount;
      const openOrAllConflicts = raw.conflicts.length;
      const coveragePct =
        stats.totalChunks > 0
          ? Number(((stats.verifiedChunks / stats.totalChunks) * 100).toFixed(1))
          : 100;

      await saveAuditReportRecord({
        id: `audit_${params.projectId}_harness`,
        projectId: params.projectId,
        totalSourceFiles: dto.sourceFiles.length,
        totalInputUnits: dto.contentUnits.length,
        uniqueUnitsCount,
        mergedDuplicatesCount,
        conflictsCount: openOrAllConflicts,
        coveragePercent: coveragePct,
        sourceTraceJson: {
          mode: 'harness_verified',
          verifiedSections: stats.verifiedSections,
          quarantinedSections: stats.quarantinedSections,
          totalSections: stats.totalSections,
          totalChunks: stats.totalChunks,
          verifiedChunks: stats.verifiedChunks,
          conflictsResolved: raw.conflicts.filter((c) => c.status !== 'open').length,
        },
      });
    }

    await updateProjectRecord(params.projectId, params.ownerUid, updatePayload);

    if (outcome === 'verified') {
      await logHarnessRevision({
        projectId: params.projectId,
        ownerUid: params.ownerUid,
        actorType: 'ai',
        actorName: authorRes.modelUsed,
        actionType: 'harness_section_verified',
        title: `تأیید زیربخش «${targetSection.title}»`,
        summary: `تایید دولایه (لایه ۱ قطعی + لایه ۲ ادعا-به-ادعا) با ${toPersianDigits(attempts)} ترمیم جراحی.`,
        extraDetails: {
          modelUsed: authorRes.modelUsed,
        },
      });
    }

    const refreshed = (await getProjectBundle(params.projectId, params.ownerUid)) || raw;
    return {
      done: !hasMorePending,
      sectionId: targetSection.sectionId,
      outcome,
      layer1: l1Audit,
      layer2: l2Audit,
      harnessState,
      rawBundle: refreshed,
    };
  } catch (err) {
    // Always release own lock & persist any drafted_unverified / costAuditLedger updates on abort or error
    if (!lockReleased) {
      releaseOwnLockInMemory();
    }
    if (err instanceof HarnessRunAbortedError) {
      harnessState.status = 'paused';
    }
    harnessState.updatedAt = new Date().toISOString();
    await updateProjectRecord(params.projectId, params.ownerUid, {
      checkpointJson: { ...existingCheckpoint, aiUsage: projectUsage, harnessState },
    });
    throw err;
  }
}

export async function resolveHarnessQuarantineItem(params: {
  projectId: string;
  ownerUid: string;
  sectionId: string;
  editedBlocks?: SemanticBlock[];
  resolutionNote?: string;
  actorName: string;
}) {
  const raw = await getProjectBundle(params.projectId, params.ownerUid);
  if (!raw) return null;

  const existingCheckpoint =
    (raw.project.checkpointJson as Record<string, unknown> | null) || {};
  const harnessState = extractHarnessStateFromCheckpoint(existingCheckpoint);
  if (!harnessState) {
    throw new Error('وضعیت هارنس برای این پروژه یافت نشد.');
  }

  const qIndex = harnessState.quarantineQueue.findIndex(
    (q) => q.sectionId === params.sectionId
  );
  if (qIndex < 0) {
    throw new Error('زیربخش موردنظر در صف قرنطینه یافت نشد.');
  }

  const now = new Date().toISOString();
  const qItem = harnessState.quarantineQueue[qIndex];
  const updatedIR: SemanticSectionIR = {
    ...qItem.draftIR,
    blocks:
      Array.isArray(params.editedBlocks) && params.editedBlocks.length > 0
        ? params.editedBlocks
        : qItem.draftIR.blocks,
    generatedAt: now,
    tierUsed: 'manual',
  };

  harnessState.sectionsIR[params.sectionId] = updatedIR;
  harnessState.quarantineQueue[qIndex] = {
    ...qItem,
    draftIR: updatedIR,
    resolved: true,
    resolvedAt: now,
    resolutionNote: params.resolutionNote?.trim() || 'تأیید و ویرایش دستی توسط کاربر',
  };

  harnessState.coverageLedger.bySectionId[params.sectionId] = {
    sectionId: params.sectionId,
    chapterId: qItem.chapterId,
    status: 'verified',
    attempts: qItem.attempts,
    layer1Passed: true,
    layer2Passed: true,
    lastError: null,
    lastUpdatedAt: now,
  };

  for (const cid of qItem.sourceChunkIds) {
    if (harnessState.coverageLedger.byChunkId[cid]) {
      harnessState.coverageLedger.byChunkId[cid].status = 'verified';
      harnessState.coverageLedger.byChunkId[cid].updatedAt = now;
    }
  }

  const stats = computeCoverageLedgerStats(harnessState.coverageLedger);
  harnessState.telemetry.completedSections = stats.verifiedSections;
  harnessState.telemetry.quarantinedSections = stats.quarantinedSections;
  harnessState.updatedAt = now;

  const hasMorePending = harnessState.blueprint.sections.some((s) => {
    const st = harnessState.coverageLedger.bySectionId[s.sectionId]?.status || 'pending';
    return st === 'pending' || st === 'drafted' || st === 'drafted_unverified';
  });
  const fullyCompleted = !hasMorePending && stats.quarantinedSections === 0;
  if (!hasMorePending) {
    harnessState.status = 'completed';
  }

  const dto = toDtoShapes(raw);
  const compiledBook = convertHarnessStateToParsedBook({
    harnessState,
    projectTitle: raw.project.title,
    sourceFiles: dto.sourceFiles,
    contentUnits: dto.contentUnits,
    existingBook: dto.existingBook,
  });

  const uniqueUnitsCount = dto.contentUnits.filter(
    (u) => u.status !== 'merged' && u.status !== 'merged_duplicate'
  ).length;
  await saveAuditReportRecord({
    id: `audit_${params.projectId}_harness`,
    projectId: params.projectId,
    totalSourceFiles: dto.sourceFiles.length,
    totalInputUnits: dto.contentUnits.length,
    uniqueUnitsCount,
    mergedDuplicatesCount: dto.contentUnits.length - uniqueUnitsCount,
    conflictsCount: raw.conflicts.length,
    coveragePercent:
      stats.totalChunks > 0
        ? Number(((stats.verifiedChunks / stats.totalChunks) * 100).toFixed(1))
        : 100,
    sourceTraceJson: {
      mode: 'harness_verified',
      verifiedSections: stats.verifiedSections,
      quarantinedSections: stats.quarantinedSections,
      totalSections: stats.totalSections,
      totalChunks: stats.totalChunks,
      verifiedChunks: stats.verifiedChunks,
      conflictsResolved: raw.conflicts.filter((c) => c.status !== 'open').length,
    },
  });

  await updateProjectRecord(params.projectId, params.ownerUid, {
    ...(fullyCompleted
      ? { pipelineStage: 5, status: 'completed' }
      : { pipelineStage: Math.max(raw.project.pipelineStage || 4, 4) }),
    checkpointJson: {
      ...existingCheckpoint,
      harnessState,
    },
    bookSnapshotJson: compiledBook as unknown as Record<string, unknown>,
  });

  await logHarnessRevision({
    projectId: params.projectId,
    ownerUid: params.ownerUid,
    actorType: 'user',
    actorName: params.actorName,
    actionType: 'harness_quarantine_resolved',
    title: `تأیید دستی زیربخش قرنطینه‌شده «${qItem.sectionTitle}»`,
    summary:
      params.resolutionNote?.trim() ||
      'زیربخش پس از بازبینی دستی کاربر از صف قرنطینه خارج و به سند نهایی اضافه شد.',
  });

  const refreshed = (await getProjectBundle(params.projectId, params.ownerUid)) || raw;
  return {
    harnessState,
    rawBundle: refreshed,
  };
}

export async function syncHarnessToBookSnapshot(params: {
  projectId: string;
  ownerUid: string;
}) {
  const raw = await getProjectBundle(params.projectId, params.ownerUid);
  if (!raw) return null;

  const existingCheckpoint =
    (raw.project.checkpointJson as Record<string, unknown> | null) || {};
  const harnessState = extractHarnessStateFromCheckpoint(existingCheckpoint);
  if (!harnessState) {
    throw new Error('ابتدا نقشه راه هارنس را مقداردهی کنید.');
  }

  const dto = toDtoShapes(raw);
  const compiledBook = convertHarnessStateToParsedBook({
    harnessState,
    projectTitle: raw.project.title,
    sourceFiles: dto.sourceFiles,
    contentUnits: dto.contentUnits,
    existingBook: dto.existingBook,
  });

  const stats = computeCoverageLedgerStats(harnessState.coverageLedger);
  const uniqueUnitsCount = dto.contentUnits.filter(
    (u) => u.status !== 'merged' && u.status !== 'merged_duplicate'
  ).length;

  await saveAuditReportRecord({
    id: `audit_${params.projectId}_harness`,
    projectId: params.projectId,
    totalSourceFiles: dto.sourceFiles.length,
    totalInputUnits: dto.contentUnits.length,
    uniqueUnitsCount,
    mergedDuplicatesCount: dto.contentUnits.length - uniqueUnitsCount,
    conflictsCount: raw.conflicts.length,
    coveragePercent:
      stats.totalChunks > 0
        ? Number(((stats.verifiedChunks / stats.totalChunks) * 100).toFixed(1))
        : 100,
    sourceTraceJson: {
      mode: 'harness_verified',
      verifiedSections: stats.verifiedSections,
      quarantinedSections: stats.quarantinedSections,
      totalSections: stats.totalSections,
      totalChunks: stats.totalChunks,
      verifiedChunks: stats.verifiedChunks,
      conflictsResolved: raw.conflicts.filter((c) => c.status !== 'open').length,
    },
  });

  await updateProjectRecord(params.projectId, params.ownerUid, {
    pipelineStage: stats.quarantinedSections === 0 ? 5 : Math.max(raw.project.pipelineStage || 3, 4),
    status: stats.quarantinedSections === 0 ? 'completed' : 'structuring',
    bookSnapshotJson: compiledBook as unknown as Record<string, unknown>,
  });

  const refreshed = (await getProjectBundle(params.projectId, params.ownerUid)) || raw;
  return {
    harnessState,
    rawBundle: refreshed,
  };
}

/**
 * Re-runs a single quarantined subsection directly with Flagship-tier escalation (HITL Gate 2 retry).
 */
export async function retryQuarantinedSectionForProject(params: {
  req: express.Request;
  projectId: string;
  ownerUid: string;
  sectionId: string;
  allowBudgetOverride?: boolean;
  abortSignal?: AbortSignal;
  actorName: string;
}) {
  const raw = await getProjectBundle(params.projectId, params.ownerUid);
  if (!raw) return null;

  const existingCheckpoint =
    (raw.project.checkpointJson as Record<string, unknown> | null) || {};
  const harnessState = extractHarnessStateFromCheckpoint(existingCheckpoint);
  if (!harnessState) {
    throw new Error('وضعیت هارنس برای این پروژه یافت نشد.');
  }

  const targetSection = harnessState.blueprint.sections.find(
    (s) => s.sectionId === params.sectionId
  );
  if (!targetSection) {
    throw new Error('زیربخش موردنظر در نقشه راه هارنس یافت نشد.');
  }

  // Temporarily mark section pending so executeHarnessStepForProject processes it cleanly
  const now = new Date().toISOString();
  harnessState.coverageLedger.bySectionId[params.sectionId] = {
    sectionId: params.sectionId,
    chapterId: targetSection.chapterId,
    status: 'pending',
    attempts: 0,
    layer1Passed: false,
    layer2Passed: false,
    lastError: null,
    lastUpdatedAt: now,
  };
  harnessState.status = 'running';
  harnessState.updatedAt = now;

  await updateProjectRecord(params.projectId, params.ownerUid, {
    checkpointJson: {
      ...existingCheckpoint,
      harnessState,
    },
  });

  return await executeHarnessStepForProject({
    req: params.req,
    projectId: params.projectId,
    ownerUid: params.ownerUid,
    sectionId: params.sectionId,
    allowBudgetOverride: params.allowBudgetOverride,
    forceFlagshipForAuthor: true,
    abortSignal: params.abortSignal,
    actorName: params.actorName,
  });
}

export type HarnessStepApiResponse = {
  ok: boolean;
  done: boolean;
  pausedByBudgetCap?: boolean;
  sectionId?: string;
  outcome?: 'verified' | 'quarantined' | 'budget_paused' | 'completed';
  layer1?: Layer1AuditResult;
  layer2?: Layer2AuditResult;
  harnessState: HarnessState;
  bundle: ProjectBundleDto;
};
