import { AiModelId, GoogleSearchMode, ProjectAiUsageLedger } from './bookTypes.ts';
import { getGoogleModelMeta, normalizeGoogleModelId } from './aiProviderConfig.ts';
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

export const TOKENS_PER_PERSIAN_WORD = 2;
export const WORDS_PER_STANDARD_WORD_PAGE = 400;
export const TOKENS_PER_STANDARD_WORD_PAGE =
  TOKENS_PER_PERSIAN_WORD * WORDS_PER_STANDARD_WORD_PAGE; // 800 tokens/page

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
 * Simple, human-friendly rule for Persian text:
 * Every Persian word ≈ 2 tokens, and every standard Word page (~400 words) ≈ 800 tokens.
 */
export function estimatePersianTokensFromWords(wordCount: number): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;
  return Math.round(wordCount * TOKENS_PER_PERSIAN_WORD);
}

export function estimateWordPagesFromWords(wordCount: number): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;
  return Math.max(1, Math.round(wordCount / WORDS_PER_STANDARD_WORD_PAGE));
}

export function estimateWordPagesFromTokens(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.max(1, Math.round(tokens / TOKENS_PER_STANDARD_WORD_PAGE));
}

/**
 * Simple estimate for queued (not-yet-parsed) files from byte size:
 * Roughly 1 KB of mixed docx/md/pdf ≈ 180 tokens.
 */
export function estimateTokensFromQueuedBytes(totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  return Math.round((totalBytes / 1024) * 180);
}

export type QuotaStatusLevel = 'normal' | 'warning' | 'critical';

export interface ProjectQuotaSnapshot {
  consumedTokens: number;
  remainingTokens: number;
  remainingPercent: number;
  estimatedDocumentTokens: number;
  estimatedDocumentPages: number;
  consumedPagesEquivalent: number;
  remainingPagesEquivalent: number;
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
  aiModel: AiModelId | string;
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

  const modelMeta = getGoogleModelMeta(aiModel);
  const softBudgetTokens = modelMeta.softBudgetTokens;
  const softRequestCap = modelMeta.softRequestCap;

  const docWordsTokens = estimatePersianTokensFromWords(ingestedWordCount);
  const queuedTokens = estimateTokensFromQueuedBytes(queuedBytesCount);
  const estimatedDocumentTokens = docWordsTokens + queuedTokens;
  const estimatedDocumentPages =
    ingestedWordCount > 0
      ? estimateWordPagesFromWords(ingestedWordCount)
      : estimateWordPagesFromTokens(queuedTokens);

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
  const remainingTokens = Math.max(0, softBudgetTokens - consumedTokens);
  const consumedPercent = Math.min(100, Math.round((consumedTokens / softBudgetTokens) * 100));
  const remainingPercent = Math.max(0, 100 - consumedPercent);
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

  const estimatedPaidCostUsd =
    (usage.promptTokens / 1_000_000) * modelMeta.inputRatePerMillionUsd +
    ((usage.outputTokens + usage.thinkingTokens) / 1_000_000) *
      modelMeta.outputRatePerMillionUsd;

  const formattedCostUsd =
    estimatedPaidCostUsd === 0
      ? '$0.00'
      : estimatedPaidCostUsd < 0.01
        ? '< $0.01'
        : `$${estimatedPaidCostUsd.toFixed(2)}`;

  return {
    consumedTokens,
    remainingTokens,
    remainingPercent,
    estimatedDocumentTokens,
    estimatedDocumentPages,
    consumedPagesEquivalent: estimateWordPagesFromTokens(consumedTokens),
    remainingPagesEquivalent: estimateWordPagesFromTokens(remainingTokens),
    softBudgetTokens,
    consumedPercent,
    projectedPercent,
    requestCount: usage.requestCount,
    softRequestCap,
    statusLevel,
    statusLabel,
    estimatedPaidCostUsd,
    formattedCostUsd,
    modelDisplayName: modelMeta.shortName,
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

export interface SimpleTokenExplanation {
  ruleTitle: string;
  wordRuleText: string;
  pageRuleText: string;
  projectWorkedExample: string;
  remainingSimpleText: string;
}

/**
 * Produces a crystal-clear, everyday Persian explanation of token calculation
 * using concrete numbers from the user's current project.
 */
export function buildSimpleTokenExplanation(params: {
  ingestedWordCount: number;
  consumedTokens: number;
  softBudgetTokens: number;
}): SimpleTokenExplanation {
  const words = Math.max(0, Math.round(params.ingestedWordCount));
  const estimatedDocTokens = estimatePersianTokensFromWords(words);
  const approxPages = estimateWordPagesFromWords(words);
  const remainingTokens = Math.max(0, params.softBudgetTokens - params.consumedTokens);
  const remainingPages = Math.floor(remainingTokens / TOKENS_PER_STANDARD_WORD_PAGE);

  const projectWorkedExample =
    words > 0
      ? `سند فعلی شما ${toPersianDigits(words.toLocaleString('en-US'))} کلمه دارد ← ${toPersianDigits(words.toLocaleString('en-US'))} × ۲ = حدود ${formatCompactTokensFa(estimatedDocTokens)} توکن (معادل حدود ${toPersianDigits(approxPages)} صفحه ورد).`
      : 'مثال ساده: اگر یک فایل ۱۰ صفحه‌ای (حدود ۴٬۰۰۰ کلمه) بارگذاری کنید ← ۴٬۰۰۰ × ۲ = حدود ۸ هزار توکن می‌شود.';

  const remainingSimpleText = `از سقف مرجع ${formatCompactTokensFa(params.softBudgetTokens)} توکن این پروژه، هنوز حدود ${formatCompactTokensFa(remainingTokens)} توکن (معادل تقریباً ${toPersianDigits(remainingPages)} صفحه متن) باقی مانده است.`;

  return {
    ruleTitle: 'فرمول خیلی ساده محاسبه توکن (برای همه قابل فهم)',
    wordRuleText: 'هر ۱ کلمه فارسی ≈ ۲ توکن است (کافی است تعداد کلمات را ضربدر ۲ کنید).',
    pageRuleText: 'هر ۱ صفحه استاندارد ورد (حدود ۴۰۰ کلمه) ≈ ۸۰۰ توکن است.',
    projectWorkedExample,
    remainingSimpleText,
  };
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
  tokensPerWordPage: number;
  fallbackCharsPerToken: number;
  httpPayloadLimitMb: number;
  groundingModeLabel: string;
  promptSharePercent: number;
  outputSharePercent: number;
  thinkingSharePercent: number;
  simpleExplanation: SimpleTokenExplanation;
}

export function buildProjectQuotaTechnicalSpec(params: {
  usage: ProjectAiUsageLedger;
  ingestedWordCount: number;
  queuedBytesCount: number;
  chapterCount: number;
  aiModel: AiModelId | string;
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

  const normalizedModel = normalizeGoogleModelId(aiModel);
  const modelMeta = getGoogleModelMeta(normalizedModel);
  const softBudgetTokens = modelMeta.softBudgetTokens;
  const softRequestCap = modelMeta.softRequestCap;
  const inputRatePerMillionUsd = modelMeta.inputRatePerMillionUsd;
  const outputRatePerMillionUsd = modelMeta.outputRatePerMillionUsd;

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

  const simpleExplanation = buildSimpleTokenExplanation({
    ingestedWordCount,
    consumedTokens: usage.totalTokens,
    softBudgetTokens,
  });

  return {
    modelId: normalizedModel,
    modelDisplayName: modelMeta.displayName,
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
    persianWordTokenMultiplier: TOKENS_PER_PERSIAN_WORD,
    tokensPerWordPage: TOKENS_PER_STANDARD_WORD_PAGE,
    fallbackCharsPerToken: 3,
    httpPayloadLimitMb: 30,
    groundingModeLabel,
    promptSharePercent,
    outputSharePercent,
    thinkingSharePercent,
    simpleExplanation,
  };
}
