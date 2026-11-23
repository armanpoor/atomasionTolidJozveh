import {
  type AiProviderType,
  computeCallCostUsd,
  estimatePersianTokensConservative,
} from '../tokenOptimizer.ts';
import { evaluatePrefixCachePolicy } from './promptBuilder.ts';
import type {
  BlueprintSection,
  BudgetCheckResult,
  CostAuditLedgerEntry,
  HarnessCostEstimate,
  HarnessSourceChunk,
  Layer1Issue,
  Layer2Issue,
  MasterBlueprint,
  QuarantineItem,
  SemanticBlock,
  SemanticSectionIR,
} from './types.ts';

export interface SurgicalPatchPlan {
  action: 'patch' | 'quarantine';
  targetBlockIds: string[];
  faultyBlocks: SemanticBlock[];
  focusedLayer1Issues: Layer1Issue[];
  focusedLayer2Issues: Layer2Issue[];
  minimalSourceChunks: HarnessSourceChunk[];
  requiresFullSectionRewrite: boolean;
  quarantineItem?: QuarantineItem;
}

/**
 * Decides between a minimal surgical patch (targeting ONLY faulty blocks) and moving
 * the subsection to the Quarantine Queue once maxAttempts (default: 2) is reached.
 */
export function buildSurgicalPatchPlan(params: {
  section: BlueprintSection;
  sectionIR: SemanticSectionIR;
  layer1Issues: Layer1Issue[];
  layer2Issues: Layer2Issue[];
  sourceChunks: HarnessSourceChunk[];
  previousAttempts: number;
  maxAttempts?: number;
}): SurgicalPatchPlan {
  const maxAttempts = params.maxAttempts ?? 2;
  const errorL1 = params.layer1Issues.filter((i) => i.severity === 'error');
  const errorL2 = params.layer2Issues.filter((i) => i.severity === 'error');

  if (params.previousAttempts >= maxAttempts) {
    const quarantineItem: QuarantineItem = {
      sectionId: params.section.sectionId,
      chapterId: params.section.chapterId,
      chapterTitle: params.section.chapterTitle,
      sectionTitle: params.section.title,
      attempts: params.previousAttempts,
      maxAttempts,
      draftIR: params.sectionIR,
      layer1Issues: params.layer1Issues,
      layer2Issues: params.layer2Issues,
      sourceChunkIds: [...params.section.sourceChunkIds],
      quarantinedAt: new Date().toISOString(),
      resolved: false,
      resolvedAt: null,
      resolutionNote: null,
    };

    return {
      action: 'quarantine',
      targetBlockIds: [],
      faultyBlocks: [],
      focusedLayer1Issues: errorL1,
      focusedLayer2Issues: errorL2,
      minimalSourceChunks: [],
      requiresFullSectionRewrite: false,
      quarantineItem,
    };
  }

  const blockIds = new Set<string>();
  let requiresFullSectionRewrite = false;

  for (const issue of errorL1) {
    if (issue.blockId) {
      blockIds.add(issue.blockId);
    } else if (
      issue.kind === 'low_word_ratio' ||
      issue.kind === 'missing_source_chunk' ||
      issue.kind === 'missing_technical_anchor' ||
      issue.kind === 'invalid_block_structure' ||
      issue.kind === 'empty_blocks_output' ||
      issue.kind === 'missing_safety_warning' ||
      issue.kind === 'excessive_gap_bailout'
    ) {
      requiresFullSectionRewrite = true;
    }
  }
  for (const issue of errorL2) {
    if (issue.blockId) {
      blockIds.add(issue.blockId);
    } else if (issue.category === 'omission' || issue.category === 'structure') {
      requiresFullSectionRewrite = true;
    }
  }

  const targetBlocks =
    requiresFullSectionRewrite || blockIds.size === 0
      ? [...params.sectionIR.blocks]
      : params.sectionIR.blocks.filter((b) => blockIds.has(b.id));

  // Only inject chunks linked to faulty blocks (or missing chunks) to keep patch tokens minimal
  const neededChunkIds = new Set<string>();
  if (requiresFullSectionRewrite || targetBlocks.length === params.sectionIR.blocks.length) {
    for (const c of params.sourceChunks) neededChunkIds.add(c.id);
  } else {
    for (const b of targetBlocks) {
      for (const cid of b.sourceChunkIds || []) neededChunkIds.add(cid);
    }
    for (const issue of errorL1) {
      if (issue.kind === 'missing_source_chunk' && issue.offendingToken) {
        neededChunkIds.add(issue.offendingToken);
      }
    }
    if (neededChunkIds.size === 0) {
      for (const c of params.sourceChunks) neededChunkIds.add(c.id);
    }
  }

  const minimalSourceChunks = params.sourceChunks.filter((c) => neededChunkIds.has(c.id));

  return {
    action: 'patch',
    targetBlockIds: targetBlocks.map((b) => b.id),
    faultyBlocks: targetBlocks,
    focusedLayer1Issues: errorL1,
    focusedLayer2Issues: errorL2,
    minimalSourceChunks,
    requiresFullSectionRewrite,
  };
}

export interface SurgicalPatchSpliceResult {
  mergedIR: SemanticSectionIR;
  appliedBlockIds: string[];
  rejectedHealthyOverwriteIds: string[];
  missingTargetBlockIds: string[];
  addedBlockIds: string[];
  validSplice: boolean;
  warningsFa: string[];
}

/**
 * Package C Hardened Surgical Patch Splice:
 * - Preserves exact block ordering and keeps every untouched healthy block byte-identical.
 * - Replaces ONLY targeted faulty blocks by matching `id` when `targetFaultyBlockIds` is supplied.
 * - Rejects unauthorized overwrites of healthy blocks and flags missing target blocks.
 */
export function applySurgicalPatchBlocksStrict(params: {
  originalIR: SemanticSectionIR;
  patchedBlocks: SemanticBlock[];
  targetFaultyBlockIds?: string[];
  allowAppendingNewBlocks?: boolean;
  meta?: { modelUsed?: string; tierUsed?: SemanticSectionIR['tierUsed'] };
}): SurgicalPatchSpliceResult {
  const { originalIR, patchedBlocks, meta } = params;
  const targetSet =
    Array.isArray(params.targetFaultyBlockIds) && params.targetFaultyBlockIds.length > 0
      ? new Set(params.targetFaultyBlockIds)
      : null;

  const byId = new Map<string, SemanticBlock>();
  for (const blk of patchedBlocks) {
    if (blk?.id && !byId.has(blk.id)) {
      byId.set(blk.id, blk);
    }
  }

  const appliedBlockIds: string[] = [];
  const rejectedHealthyOverwriteIds: string[] = [];
  const addedBlockIds: string[] = [];
  const warningsFa: string[] = [];
  const consumedIds = new Set<string>();

  const mergedBlocks = originalIR.blocks.map((orig) => {
    const replacement = byId.get(orig.id);
    if (!replacement) return orig;

    consumedIds.add(orig.id);
    if (targetSet && !targetSet.has(orig.id)) {
      // Unauthorized modification attempt on a healthy block -> keep original healthy block intact!
      const origSerialized = JSON.stringify(orig);
      const replSerialized = JSON.stringify(replacement);
      if (origSerialized !== replSerialized) {
        rejectedHealthyOverwriteIds.push(orig.id);
        warningsFa.push(
          `تلاش غیرمجاز ترمیم برای تغییر بلوک سالم «${orig.id}» مسدود شد و نسخه سالم اصلی حفظ گردید.`
        );
      }
      return orig;
    }

    appliedBlockIds.push(orig.id);
    return replacement;
  });

  // Only append genuinely new blocks (e.g. a missing callout_warning or missing source chunk coverage) when allowed
  const allowAppend = params.allowAppendingNewBlocks !== false;
  for (const blk of patchedBlocks) {
    if (!blk?.id || consumedIds.has(blk.id)) continue;
    if (allowAppend) {
      mergedBlocks.push(blk);
      addedBlockIds.push(blk.id);
    }
  }

  const missingTargetBlockIds: string[] = [];
  if (targetSet) {
    const origIds = new Set(originalIR.blocks.map((b) => b.id));
    for (const targetId of targetSet) {
      if (origIds.has(targetId) && !appliedBlockIds.includes(targetId)) {
        missingTargetBlockIds.push(targetId);
        warningsFa.push(
          `بلوک معیوب هدف «${targetId}» در خروجی ترمیم جراحی بازگردانده نشد و نسخه معیوب قبلی باقی ماند.`
        );
      }
    }
  }

  const validSplice =
    mergedBlocks.length > 0 &&
    rejectedHealthyOverwriteIds.length === 0 &&
    missingTargetBlockIds.length === 0 &&
    (appliedBlockIds.length > 0 || addedBlockIds.length > 0);

  return {
    mergedIR: {
      ...originalIR,
      blocks: mergedBlocks,
      generatedAt: new Date().toISOString(),
      modelUsed: meta?.modelUsed || originalIR.modelUsed,
      tierUsed: meta?.tierUsed || originalIR.tierUsed,
    },
    appliedBlockIds,
    rejectedHealthyOverwriteIds,
    missingTargetBlockIds,
    addedBlockIds,
    validSplice,
    warningsFa,
  };
}

/**
 * Deterministically merges surgically patched blocks back into the original SemanticSectionIR
 * without altering unaffected passing blocks.
 */
export function applySurgicalPatchBlocks(
  originalIR: SemanticSectionIR,
  patchedBlocks: SemanticBlock[],
  meta?: { modelUsed?: string; tierUsed?: SemanticSectionIR['tierUsed'] }
): SemanticSectionIR {
  return applySurgicalPatchBlocksStrict({
    originalIR,
    patchedBlocks,
    meta,
  }).mergedIR;
}

/**
 * Cost Audit Ledger helpers (Package B — Vampire Cost Protection):
 * Records `pending_charge` BEFORE fetch, settles with real API usage on success,
 * and converts unanswered timeouts into `unreconciled_estimated_cost` (counted in budget cap!).
 */
export function recordPendingChargeEntry(
  ledger: CostAuditLedgerEntry[],
  params: {
    id: string;
    sectionId: string;
    role: CostAuditLedgerEntry['role'];
    requestedModel: string;
    estimatedCostUsd: number;
  }
): CostAuditLedgerEntry {
  const entry: CostAuditLedgerEntry = {
    id: params.id,
    sectionId: params.sectionId,
    role: params.role,
    requestedModel: params.requestedModel,
    actualModel: params.requestedModel,
    status: 'pending_charge',
    estimatedCostUsd: Number(Math.max(0, params.estimatedCostUsd).toFixed(6)),
    actualCostUsd: null,
    promptTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    cacheTelemetryReported: false,
    modelMismatch: false,
    createdAt: new Date().toISOString(),
    settledAt: null,
  };
  ledger.push(entry);
  return entry;
}

export function settleChargeEntry(
  ledger: CostAuditLedgerEntry[],
  entryId: string,
  params: {
    actualModel: string;
    promptTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    cacheCreationInputTokens?: number;
    cacheTelemetryReported: boolean;
    modelMismatch: boolean;
    noteFa?: string;
  }
): CostAuditLedgerEntry | null {
  const entry = ledger.find((e) => e.id === entryId);
  if (!entry) return null;

  const actualCostUsd = computeCallCostUsd({
    modelId: params.actualModel,
    promptTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    reasoningTokens: params.reasoningTokens,
    cachedInputTokens: params.cachedInputTokens,
    cacheCreationInputTokens: params.cacheCreationInputTokens,
  });

  entry.status = 'settled';
  entry.actualModel = params.actualModel;
  entry.actualCostUsd = Number(actualCostUsd.toFixed(6));
  entry.promptTokens = params.promptTokens;
  entry.outputTokens = params.outputTokens;
  entry.reasoningTokens = params.reasoningTokens;
  entry.cachedInputTokens = params.cachedInputTokens;
  entry.cacheTelemetryReported = params.cacheTelemetryReported;
  entry.modelMismatch = params.modelMismatch;
  entry.settledAt = new Date().toISOString();
  if (params.noteFa) entry.noteFa = params.noteFa;
  return entry;
}

export function markChargeUnreconciledTimeout(
  ledger: CostAuditLedgerEntry[],
  entryId: string,
  reasonFa = 'وقفه زمانی (Timeout) پیش از دریافت پاسخ نهایی — هزینه تخمینی جهت محافظت از سقف بودجه لحاظ شد.'
): CostAuditLedgerEntry | null {
  const entry = ledger.find((e) => e.id === entryId);
  if (!entry) return null;
  entry.status = 'unreconciled_estimated_cost';
  entry.settledAt = new Date().toISOString();
  entry.noteFa = reasonFa;
  return entry;
}

export function markChargeAbortedZeroCost(
  ledger: CostAuditLedgerEntry[],
  entryId: string,
  reasonFa?: string
): CostAuditLedgerEntry | null {
  const entry = ledger.find((e) => e.id === entryId);
  if (!entry) return null;
  entry.status = 'aborted';
  entry.actualCostUsd = 0;
  entry.settledAt = new Date().toISOString();
  if (reasonFa) entry.noteFa = reasonFa;
  return entry;
}

/**
 * Computes effective total USD spend including settled actual costs AND
 * unreconciled timeout / pending vampire charges.
 */
export function computeEffectiveTotalSpentUsd(
  ledger?: CostAuditLedgerEntry[] | null,
  fallbackSpentUsd = 0
): { totalSpentUsd: number; settledUsd: number; unreconciledUsd: number } {
  if (!ledger || ledger.length === 0) {
    const clean = Math.max(0, Number(fallbackSpentUsd) || 0);
    return { totalSpentUsd: clean, settledUsd: clean, unreconciledUsd: 0 };
  }

  let settledUsd = 0;
  let unreconciledUsd = 0;

  for (const e of ledger) {
    if (e.status === 'settled') {
      settledUsd += Math.max(0, Number(e.actualCostUsd ?? e.estimatedCostUsd) || 0);
    } else if (e.status === 'unreconciled_estimated_cost' || e.status === 'pending_charge') {
      unreconciledUsd += Math.max(0, Number(e.estimatedCostUsd) || 0);
    }
  }

  const ledgerTotal = settledUsd + unreconciledUsd;
  const effectiveTotal = Math.max(ledgerTotal, Math.max(0, Number(fallbackSpentUsd) || 0));

  return {
    totalSpentUsd: Number(effectiveTotal.toFixed(6)),
    settledUsd: Number(settledUsd.toFixed(6)),
    unreconciledUsd: Number(unreconciledUsd.toFixed(6)),
  };
}

/**
 * Real-Time Per-Subcall Budget Circuit Breaker (Package B):
 * Evaluates BEFORE EVERY SINGLE subcall (author, judge, patch #1, patch #2, utility)
 * against real settled spend + unreconciled vampire costs.
 */
export function evaluateBudgetCircuitBreaker(params: {
  currentSpentUsd: number;
  unreconciledCostUsd?: number;
  estimatedNextCallUsd: number;
  budgetCapUsd: number;
  subcallRole?: CostAuditLedgerEntry['role'] | string;
  overrideApproved?: boolean;
}): BudgetCheckResult {
  const cap = Number(params.budgetCapUsd) || 0;
  const settled = Math.max(0, Number(params.currentSpentUsd) || 0);
  const unreconciled = Math.max(0, Number(params.unreconciledCostUsd) || 0);
  const effectiveSpentUsd = Number((settled + unreconciled).toFixed(6));
  const next = Math.max(0, Number(params.estimatedNextCallUsd) || 0);
  const projectedTotalUsd = Number((effectiveSpentUsd + next).toFixed(5));
  const remainingUsd = Number(Math.max(0, cap - effectiveSpentUsd).toFixed(5));

  if (cap <= 0 || params.overrideApproved) {
    return {
      allowed: true,
      projectedTotalUsd,
      remainingUsd,
      effectiveSpentUsd,
      unreconciledCostUsd: unreconciled,
      subcallRole: params.subcallRole,
    };
  }

  if (projectedTotalUsd > cap) {
    const roleHint = params.subcallRole ? ` (پیش از زیرفراخوانی ${params.subcallRole})` : '';
    const unreconciledHint =
      unreconciled > 0 ? ` [شامل $${unreconciled.toFixed(4)} هزینه تسویه‌نشده Timeout]` : '';
    return {
      allowed: false,
      projectedTotalUsd,
      remainingUsd,
      effectiveSpentUsd,
      unreconciledCostUsd: unreconciled,
      subcallRole: params.subcallRole,
      reasonFa: `مدار شکن بودجه فعال شد${roleHint}: هزینه تجمعی پیش‌بینی‌شده ($${projectedTotalUsd.toFixed(4)})${unreconciledHint} از سقف مجاز ($${cap.toFixed(2)}) عبور می‌کند. برای ادامه باید تأیید دستی بدهید.`,
    };
  }

  return {
    allowed: true,
    projectedTotalUsd,
    remainingUsd,
    effectiveSpentUsd,
    unreconciledCostUsd: unreconciled,
    subcallRole: params.subcallRole,
  };
}

/**
 * Pre-run transparent cost estimator for the Stage 3 HITL Gate.
 * Uses conservative Persian token estimation (`chars / 1.6` * calibrationFactor),
 * verifies provider minimum cache threshold (1024/2048 tokens), and never exaggerates cache savings
 * when the prefix is below threshold.
 */
export function estimateHarnessRunCost(params: {
  blueprint: Pick<MasterBlueprint, 'sections'>;
  authorModelId: string;
  utilityModelId: string;
  immutablePrefixText: string;
  enablePromptCaching: boolean;
  authorProvider?: AiProviderType;
  authorBaseUrl?: string | null;
  calibrationFactor?: number;
}): HarnessCostEstimate {
  const calibration = params.calibrationFactor ?? 1.0;
  const cachePolicy = evaluatePrefixCachePolicy({
    prefixText: params.immutablePrefixText,
    provider: params.authorProvider || 'anthropic',
    baseUrl: params.authorBaseUrl,
    modelId: params.authorModelId,
    remainingSections: params.blueprint.sections.length,
    calibrationFactor: calibration,
  });

  const prefixTokens = Math.max(
    300,
    estimatePersianTokensConservative(params.immutablePrefixText, calibration)
  );
  const rollingSummaryAvgTokens = 280;

  let totalInputTokens = 0;
  let totalCachedPrefixTokens = 0;
  let totalOutputTokens = 0;
  let estimatedCostWithoutCacheUsd = 0;
  let estimatedCostWithCacheUsd = 0;

  const perSectionEstimates: HarnessCostEstimate['perSectionEstimates'] = [];

  // Only model cache hits when caller enabled caching AND provider/prefix actually qualifies
  const canRealizeCacheHits =
    params.enablePromptCaching && !cachePolicy.belowCacheThreshold && cachePolicy.shouldEnableCacheWrite;

  params.blueprint.sections.forEach((sec, idx) => {
    // Conservative Persian ratio (~3.0 tokens/word calibrated)
    const chunkTokens = Math.max(140, Math.round(sec.sourceWordCount * 2.6 * calibration));
    const authorDynamicInput = chunkTokens + rollingSummaryAvgTokens;
    const authorTotalInput = prefixTokens + authorDynamicInput;
    const authorOutput = Math.max(200, Math.round(sec.sourceWordCount * 2.8 * calibration));

    // Utility tier: Layer 2 Semantic Judge + compact Rolling Summary update
    const utilityInput = chunkTokens + authorOutput + 320;
    const utilityOutput = 240;

    const cachedTokensThisCall = canRealizeCacheHits && idx > 0 ? prefixTokens : 0;

    const authorCostNoCache = computeCallCostUsd({
      modelId: params.authorModelId,
      promptTokens: authorTotalInput,
      outputTokens: authorOutput,
      cachedInputTokens: 0,
    });
    const authorCostWithCache = computeCallCostUsd({
      modelId: params.authorModelId,
      promptTokens: authorTotalInput,
      outputTokens: authorOutput,
      cachedInputTokens: cachedTokensThisCall,
    });
    const utilityCost = computeCallCostUsd({
      modelId: params.utilityModelId,
      promptTokens: utilityInput,
      outputTokens: utilityOutput,
      cachedInputTokens: 0,
    });

    const secNoCache = authorCostNoCache + utilityCost;
    const secWithCache = authorCostWithCache + utilityCost;

    totalInputTokens += authorTotalInput + utilityInput;
    totalCachedPrefixTokens += cachedTokensThisCall;
    totalOutputTokens += authorOutput + utilityOutput;
    estimatedCostWithoutCacheUsd += secNoCache;
    estimatedCostWithCacheUsd += secWithCache;

    perSectionEstimates.push({
      sectionId: sec.sectionId,
      estimatedInputTokens: authorTotalInput + utilityInput,
      estimatedOutputTokens: authorOutput + utilityOutput,
      estimatedCostUsd: Number(secWithCache.toFixed(5)),
    });
  });

  const savingsPercent =
    estimatedCostWithoutCacheUsd > 0
      ? Math.max(
          0,
          Math.round(
            ((estimatedCostWithoutCacheUsd - estimatedCostWithCacheUsd) /
              estimatedCostWithoutCacheUsd) *
              100
          )
        )
      : 0;

  return {
    authorModelId: params.authorModelId,
    utilityModelId: params.utilityModelId,
    totalInputTokens,
    totalCachedPrefixTokens,
    totalOutputTokens,
    estimatedCostWithoutCacheUsd: Number(estimatedCostWithoutCacheUsd.toFixed(4)),
    estimatedCostWithCacheUsd: Number(estimatedCostWithCacheUsd.toFixed(4)),
    savingsPercent,
    prefixHash: cachePolicy.prefixHash,
    prefixEstimatedTokens: cachePolicy.prefixEstimatedTokens,
    minCacheThresholdTokens: cachePolicy.minThresholdTokens,
    belowCacheThreshold: cachePolicy.belowCacheThreshold,
    cacheThresholdWarningFa: cachePolicy.thresholdWarningFa,
    perSectionEstimates,
  };
}
