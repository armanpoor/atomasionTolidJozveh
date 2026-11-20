import { AiModelId, GoogleSearchMode, ProjectAiUsageLedger } from './bookTypes.ts';
import { toPersianDigits } from './formatParsers.ts';

export const EMPTY_AI_USAGE: ProjectAiUsageLedger = {
  promptTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  groundingCallCount: 0,
  deepReviewCount: 0,
  chatCallCount: 0,
};

export interface AiUsageDelta {
  promptTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
  requestCount?: number;
  groundingCallCount?: number;
  deepReviewCount?: number;
  chatCallCount?: number;
  modelUsed?: string;
}

function safeNonNegInt(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

export function extractAiUsageFromCheckpoint(
  checkpointJson?: Record<string, unknown> | null
): ProjectAiUsageLedger {
  if (!checkpointJson || typeof checkpointJson !== 'object') {
    return { ...EMPTY_AI_USAGE };
  }
  const raw = checkpointJson.aiUsage as Partial<ProjectAiUsageLedger> | undefined;
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_AI_USAGE };
  }
  const promptTokens = safeNonNegInt(raw.promptTokens);
  const outputTokens = safeNonNegInt(raw.outputTokens);
  const thinkingTokens = safeNonNegInt(raw.thinkingTokens);
  const computedTotal = promptTokens + outputTokens + thinkingTokens;
  const totalTokens = Math.max(safeNonNegInt(raw.totalTokens), computedTotal);

  return {
    promptTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
    requestCount: safeNonNegInt(raw.requestCount),
    groundingCallCount: safeNonNegInt(raw.groundingCallCount),
    deepReviewCount: safeNonNegInt(raw.deepReviewCount),
    chatCallCount: safeNonNegInt(raw.chatCallCount),
    lastModelUsed: typeof raw.lastModelUsed === 'string' ? raw.lastModelUsed : undefined,
    lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : undefined,
  };
}

export function mergeAiUsageDelta(
  existing: ProjectAiUsageLedger,
  delta: AiUsageDelta
): ProjectAiUsageLedger {
  const addPrompt = safeNonNegInt(delta.promptTokens);
  const addOutput = safeNonNegInt(delta.outputTokens);
  const addThinking = safeNonNegInt(delta.thinkingTokens);
  const addTotal = Math.max(safeNonNegInt(delta.totalTokens), addPrompt + addOutput + addThinking);

  return {
    promptTokens: existing.promptTokens + addPrompt,
    outputTokens: existing.outputTokens + addOutput,
    thinkingTokens: existing.thinkingTokens + addThinking,
    totalTokens: existing.totalTokens + addTotal,
    requestCount: existing.requestCount + Math.max(0, safeNonNegInt(delta.requestCount ?? 1)),
    groundingCallCount: existing.groundingCallCount + safeNonNegInt(delta.groundingCallCount),
    deepReviewCount: existing.deepReviewCount + safeNonNegInt(delta.deepReviewCount),
    chatCallCount: existing.chatCallCount + safeNonNegInt(delta.chatCallCount),
    lastModelUsed: delta.modelUsed || existing.lastModelUsed,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Estimates Gemini token count for Persian/bilingual technical prose.
 * Persian UTF-8 words average ~2.1–2.4 tokens (subword pieces + spaces/punctuation).
 */
export function estimatePersianTokensFromWords(wordCount: number): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;
  return Math.round(wordCount * 2.2);
}

/**
 * Estimates token footprint of queued (not-yet-parsed) files from byte size.
 * Compressed .docx/.pdf carry overhead; plain text/md are ~2 bytes/char (~0.5 tokens/char).
 */
export function estimateTokensFromQueuedBytes(totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  // Conservative estimate: ~0.18 tokens per byte across mixed docx/md/pdf uploads
  return Math.round(totalBytes * 0.18);
}

export type QuotaStatusLevel = 'normal' | 'warning' | 'critical';

export interface ProjectQuotaSnapshot {
  consumedTokens: number;
  estimatedDocumentTokens: number;
  softBudgetTokens: number;
  consumedPercent: number;
  projectedPercent: number;
  requestCount: number;
  softRequestCap: number;
  statusLevel: QuotaStatusLevel;
  statusLabel: string;
  estimatedPaidCostUsd: number;
  formattedCostUsd: string;
  modelDisplayName: string;
  aiEnabled: boolean;
}

export function computeProjectQuotaSnapshot(params: {
  usage: ProjectAiUsageLedger;
  ingestedWordCount: number;
  queuedBytesCount: number;
  chapterCount: number;
  aiModel: AiModelId;
  googleSearchMode: GoogleSearchMode;
  useAiBackend: boolean;
}): ProjectQuotaSnapshot {
  const {
    usage,
    ingestedWordCount,
    queuedBytesCount,
    chapterCount,
    aiModel,
    googleSearchMode,
    useAiBackend,
  } = params;

  const isLite = aiModel === 'gemini-3.1-flash-lite';
  // Soft per-project reference budget aligned with free-tier rate/token comfort zone
  const softBudgetTokens = isLite ? 400_000 : 250_000;
  const softRequestCap = isLite ? 40 : 25;

  const docWordsTokens = estimatePersianTokensFromWords(ingestedWordCount);
  const queuedTokens = estimateTokensFromQueuedBytes(queuedBytesCount);
  const estimatedDocumentTokens = docWordsTokens + queuedTokens;

  // Estimate overhead of an upcoming pipeline pass (summary digests, not raw full corpus)
  const groundingExtra =
    googleSearchMode === 'full_document_enrichment'
      ? Math.max(1, chapterCount) * 1800
      : googleSearchMode === 'conflicts_and_enrichment'
        ? Math.min(3, Math.max(1, chapterCount)) * 1800
        : 0;
  const estimatedNextPassTokens = useAiBackend
    ? Math.min(28_000, Math.round(estimatedDocumentTokens * 0.35)) + groundingExtra
    : 0;

  const consumedTokens = usage.totalTokens;
  const consumedPercent = Math.min(100, Math.round((consumedTokens / softBudgetTokens) * 100));
  const projectedTotal = consumedTokens + (consumedTokens === 0 ? estimatedNextPassTokens : 0);
  const projectedPercent = Math.min(100, Math.round((projectedTotal / softBudgetTokens) * 100));

  const requestRatio = usage.requestCount / softRequestCap;
  const peakRatio = Math.max(consumedPercent / 100, requestRatio);

  let statusLevel: QuotaStatusLevel = 'normal';
  let statusLabel = consumedTokens === 0 ? 'آماده پردازش' : 'مصرف بهینه';
  if (!useAiBackend) {
    statusLevel = 'normal';
    statusLabel = 'حالت پردازش محلی';
  } else if (peakRatio >= 0.85) {
    statusLevel = 'critical';
    statusLabel = 'نزدیک سقف سهمیه';
  } else if (peakRatio >= 0.6) {
    statusLevel = 'warning';
    statusLabel = 'مصرف متوسط رو به بالا';
  }

  // Approximate reference equivalent cost on paid API tier (USD per 1M tokens)
  const inputRatePerM = isLite ? 0.1 : 0.3;
  const outputRatePerM = isLite ? 0.4 : 2.5;
  const estimatedPaidCostUsd =
    (usage.promptTokens / 1_000_000) * inputRatePerM +
    ((usage.outputTokens + usage.thinkingTokens) / 1_000_000) * outputRatePerM;

  const formattedCostUsd =
    estimatedPaidCostUsd === 0
      ? '$0.00'
      : estimatedPaidCostUsd < 0.01
        ? '< $0.01'
        : `$${estimatedPaidCostUsd.toFixed(2)}`;

  return {
    consumedTokens,
    estimatedDocumentTokens,
    softBudgetTokens,
    consumedPercent,
    projectedPercent,
    requestCount: usage.requestCount,
    softRequestCap,
    statusLevel,
    statusLabel,
    estimatedPaidCostUsd,
    formattedCostUsd,
    modelDisplayName: isLite ? 'Flash Lite' : 'Hydrogen',
    aiEnabled: useAiBackend,
  };
}

export function formatCompactTokensFa(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  if (n < 1000) return toPersianDigits(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    const formatted = k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '');
    return `${toPersianDigits(formatted)} هزار`;
  }
  const m = n / 1_000_000;
  return `${toPersianDigits(m.toFixed(2).replace(/\.00$/, ''))} میلیون`;
}

export interface ProjectQuotaTechnicalSpec {
  modelId: AiModelId;
  modelDisplayName: string;
  inputRatePerMillionUsd: number;
  outputRatePerMillionUsd: number;
  softBudgetTokens: number;
  remainingBudgetTokens: number;
  softRequestCap: number;
  remainingSoftRequests: number;
  requestPercent: number;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  estimatedNextPassTokens: number;
  persianWordTokenMultiplier: number;
  queuedByteTokenMultiplier: number;
  fallbackCharsPerToken: number;
  httpPayloadLimitMb: number;
  groundingModeLabel: string;
  promptSharePercent: number;
  outputSharePercent: number;
  thinkingSharePercent: number;
}

export function buildProjectQuotaTechnicalSpec(params: {
  usage: ProjectAiUsageLedger;
  ingestedWordCount: number;
  queuedBytesCount: number;
  chapterCount: number;
  aiModel: AiModelId;
  googleSearchMode: GoogleSearchMode;
  useAiBackend: boolean;
}): ProjectQuotaTechnicalSpec {
  const {
    usage,
    ingestedWordCount,
    queuedBytesCount,
    chapterCount,
    aiModel,
    googleSearchMode,
    useAiBackend,
  } = params;

  const isLite = aiModel === 'gemini-3.1-flash-lite';
  const softBudgetTokens = isLite ? 400_000 : 250_000;
  const softRequestCap = isLite ? 40 : 25;
  const inputRatePerMillionUsd = isLite ? 0.1 : 0.3;
  const outputRatePerMillionUsd = isLite ? 0.4 : 2.5;

  const estimatedDocumentTokens =
    estimatePersianTokensFromWords(ingestedWordCount) +
    estimateTokensFromQueuedBytes(queuedBytesCount);

  const groundingExtra =
    googleSearchMode === 'full_document_enrichment'
      ? Math.max(1, chapterCount) * 1800
      : googleSearchMode === 'conflicts_and_enrichment'
        ? Math.min(3, Math.max(1, chapterCount)) * 1800
        : 0;
  const estimatedNextPassTokens = useAiBackend
    ? Math.min(28_000, Math.round(estimatedDocumentTokens * 0.35)) + groundingExtra
    : 0;

  const remainingBudgetTokens = Math.max(0, softBudgetTokens - usage.totalTokens);
  const remainingSoftRequests = Math.max(0, softRequestCap - usage.requestCount);
  const requestPercent = Math.min(100, Math.round((usage.requestCount / softRequestCap) * 100));

  const tokenSum = usage.promptTokens + usage.outputTokens + usage.thinkingTokens;
  let promptSharePercent = 0;
  let outputSharePercent = 0;
  let thinkingSharePercent = 0;
  if (tokenSum > 0) {
    promptSharePercent = Math.round((usage.promptTokens / tokenSum) * 100);
    thinkingSharePercent = Math.round((usage.thinkingTokens / tokenSum) * 100);
    outputSharePercent = Math.max(0, 100 - promptSharePercent - thinkingSharePercent);
  }

  const groundingModeLabel =
    googleSearchMode === 'full_document_enrichment'
      ? 'تکمیل کل سند با گوگل (همه فصل‌ها)'
      : googleSearchMode === 'conflicts_and_enrichment'
        ? 'تناقض‌ها + تکمیل حداکثر ۳ فصل'
        : 'فقط بررسی تناقض‌ها (بهینه‌ترین مصرف)';

  return {
    modelId: aiModel,
    modelDisplayName: isLite ? 'Gemini 3.1 Flash Lite' : 'Gemini 4 Hydrogen',
    inputRatePerMillionUsd,
    outputRatePerMillionUsd,
    softBudgetTokens,
    remainingBudgetTokens,
    softRequestCap,
    remainingSoftRequests,
    requestPercent,
    warningThresholdPercent: 60,
    criticalThresholdPercent: 85,
    estimatedNextPassTokens,
    persianWordTokenMultiplier: 2.2,
    queuedByteTokenMultiplier: 0.18,
    fallbackCharsPerToken: 3,
    httpPayloadLimitMb: 30,
    groundingModeLabel,
    promptSharePercent,
    outputSharePercent,
    thinkingSharePercent,
  };
}

