import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { Request } from 'express';
import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import {
  AI_PROVIDER_METADATA,
  type AiProviderType,
  type AiTaskType,
  AUDIO_TRANSCRIBE_PROVIDER_METADATA,
  type AudioTranscribeProviderType,
  type AuthStrategyDecision,
  DEFAULT_MULTI_TIER_ROUTING,
  DEFAULT_TASK_TIER_MAP,
  formatFriendlyProviderErrorFa,
  type KeyAuthMode,
  type ModelTierId,
  type MultiTierRoutingConfig,
  normalizeAudioProviderType,
  normalizeGoogleModelId,
  normalizeKeyAuthMode,
  normalizeModelTierId,
  normalizeProviderType,
  normalizeTokenOptimizationMode,
  normalizeWebSearchProviderType,
  type ProviderProbeSnapshot,
  resolveEffectiveAuthStrategy,
  sanitizeCustomModelId,
  type TokenOptimizationMode,
  validateCustomBaseUrl,
  WEB_SEARCH_PROVIDER_METADATA,
  type WebSearchProviderType,
} from '../lib/aiProviderConfig.ts';
import type { AiUsageDelta } from '../lib/aiUsageMetrics.ts';
import type { ProjectAiUsageLedger, WebGroundingSource } from '../lib/bookTypes.ts';
import {
  classifyProviderHttpResponse,
  computeRetryBackoffDelayMs,
  evaluateModelMismatch,
  extractRealCacheTelemetry,
  extractRealReasoningTokens,
  isHtmlErrorPayload,
  type ModelMismatchEvaluation,
  ProviderGatewayError,
  resolveProviderCapabilityProfile,
  resolveRoleReasoningCap,
  sanitizeOpenAiCompatiblePayload,
} from '../lib/harness/providerGuard.ts';
import {
  computeCallCostUsd,
  estimatePersianTokensConservative,
  formatUsdClean,
} from '../lib/tokenOptimizer.ts';

export interface ResolvedServerAiProvider {
  provider: AiProviderType;
  googleKeyMode: KeyAuthMode;
  /** Primary API key to attempt first */
  apiKey: string;
  /** App Owner's server-configured key (process.env) for this provider, if present */
  creatorApiKey: string;
  /** User's own session API key sent via X-AI-Api-Key, if provided */
  personalApiKey: string;
  keySource: 'creator' | 'personal' | 'custom';
  /** Normalized HTTPS Base URL (optional override for Gemini; explicit for OpenAI/Anthropic/Custom) */
  baseUrl: string;
  /** True if user supplied a non-default Base URL for Gemini */
  hasCustomGeminiBaseUrl: boolean;
  customModelId: string;
  validationError?: string;
}

/**
 * Lightweight short-lived cache of App Owner key quota health per provider
 * so we do not waste an extra round-trip on every single chat/chapter call,
 * while immediately invalidating on any 429/401/403 or fresh live probe.
 */
interface CreatorHealthEntry {
  hasQuota: boolean;
  checkedAtMs: number;
}
const CREATOR_HEALTH_TTL_MS = 30_000;
const creatorHealthCache = new Map<AiProviderType, CreatorHealthEntry>();

function markCreatorHealth(provider: AiProviderType, hasQuota: boolean) {
  creatorHealthCache.set(provider, { hasQuota, checkedAtMs: Date.now() });
}

function getCachedCreatorHealth(provider: AiProviderType): boolean | null {
  const entry = creatorHealthCache.get(provider);
  if (!entry) return null;
  if (Date.now() - entry.checkedAtMs > CREATOR_HEALTH_TTL_MS) {
    creatorHealthCache.delete(provider);
    return null;
  }
  return entry.hasQuota;
}

function getCreatorKeyForProvider(provider: AiProviderType): string {
  if (provider === 'google_aistudio') {
    const raw = (process.env.GEMINI_API_KEY || '').trim();
    if (!raw || raw === 'MY_GEMINI_API_KEY') return '';
    return raw;
  }
  if (provider === 'openai') {
    const raw = (process.env.OPENAI_API_KEY || '').trim();
    if (!raw || raw === 'MY_OPENAI_API_KEY') return '';
    return raw;
  }
  if (provider === 'anthropic') {
    const raw = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!raw || raw === 'MY_ANTHROPIC_API_KEY') return '';
    return raw;
  }
  return '';
}

function readHeaderString(req: Request, name: string): string {
  const val = req.headers[name.toLowerCase()];
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return typeof val === 'string' ? val.trim() : '';
}

export function isNonGoogleProvider(provider: ResolvedServerAiProvider): boolean {
  return provider.provider !== 'google_aistudio';
}

export function resolveAiProviderFromRequest(req: Request): ResolvedServerAiProvider {
  const provider = normalizeProviderType(readHeaderString(req, 'x-ai-provider'));
  const keyMode = normalizeKeyAuthMode(readHeaderString(req, 'x-ai-key-mode'));
  const personalApiKey = readHeaderString(req, 'x-ai-api-key');
  const rawBaseUrl = readHeaderString(req, 'x-ai-base-url');
  const rawCustomModel = readHeaderString(req, 'x-ai-custom-model');
  const meta = AI_PROVIDER_METADATA[provider];
  const creatorApiKey = getCreatorKeyForProvider(provider);

  // Validate Base URL (all providers support custom HTTPS Base URL)
  const effectiveRawUrl = rawBaseUrl || meta.defaultBaseUrl;
  const urlCheck = validateCustomBaseUrl(effectiveRawUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    return {
      provider,
      googleKeyMode: keyMode,
      apiKey: '',
      creatorApiKey,
      personalApiKey,
      keySource: keyMode === 'personal' ? 'personal' : 'creator',
      baseUrl: '',
      hasCustomGeminiBaseUrl: false,
      customModelId: sanitizeCustomModelId(rawCustomModel) || meta.defaultModelId,
      validationError: urlCheck.error || 'آدرس Base URL واردشده معتبر نیست.',
    };
  }

  const normalizedBaseUrl = urlCheck.normalizedUrl;
  const defaultNormalized = meta.defaultBaseUrl.replace(/\/+$/, '');
  const hasCustomGeminiBaseUrl =
    provider === 'google_aistudio' && normalizedBaseUrl !== defaultNormalized;

  const customModelId =
    provider === 'google_aistudio'
      ? ''
      : sanitizeCustomModelId(rawCustomModel) || meta.defaultModelId;

  // Explicit personal key mode: always use user's own key (even if App Owner has quota)
  if (keyMode === 'personal') {
    if (!personalApiKey) {
      return {
        provider,
        googleKeyMode: 'personal',
        apiKey: '',
        creatorApiKey,
        personalApiKey: '',
        keySource: provider === 'custom_openai' ? 'custom' : 'personal',
        baseUrl: normalizedBaseUrl,
        hasCustomGeminiBaseUrl,
        customModelId,
        validationError: `حالت «کلید اختصاصی من» برای ${meta.shortName} انتخاب شده اما کلید API وارد نشده است.`,
      };
    }
    return {
      provider,
      googleKeyMode: 'personal',
      apiKey: personalApiKey,
      creatorApiKey,
      personalApiKey,
      keySource: provider === 'custom_openai' ? 'custom' : 'personal',
      baseUrl: normalizedBaseUrl,
      hasCustomGeminiBaseUrl,
      customModelId,
    };
  }

  // auto_creator_first mode: prefer App Owner key if configured & not known exhausted, else user's personal key
  const cachedHealthy = getCachedCreatorHealth(provider);
  const canTryCreatorFirst = Boolean(creatorApiKey) && cachedHealthy !== false;

  if (canTryCreatorFirst) {
    return {
      provider,
      googleKeyMode: 'auto_creator_first',
      apiKey: creatorApiKey,
      creatorApiKey,
      personalApiKey,
      keySource: 'creator',
      baseUrl: normalizedBaseUrl,
      hasCustomGeminiBaseUrl,
      customModelId,
    };
  }

  if (personalApiKey) {
    return {
      provider,
      googleKeyMode: 'auto_creator_first',
      apiKey: personalApiKey,
      creatorApiKey,
      personalApiKey,
      keySource: provider === 'custom_openai' ? 'custom' : 'personal',
      baseUrl: normalizedBaseUrl,
      hasCustomGeminiBaseUrl,
      customModelId,
    };
  }

  return {
    provider,
    googleKeyMode: 'auto_creator_first',
    apiKey: creatorApiKey,
    creatorApiKey,
    personalApiKey: '',
    keySource: 'creator',
    baseUrl: normalizedBaseUrl,
    hasCustomGeminiBaseUrl,
    customModelId,
    ...(creatorApiKey
      ? {}
      : {
          validationError: `سهمیه سازنده برای ${meta.shortName} تنظیم نشده است. لطفاً کلید API اختصاصی خود را در بخش «تنظیمات ارائه‌دهنده» وارد کنید.`,
        }),
  };
}

// ============================================================================
// MULTI-TIER TASK ROUTER, PROMPT-HASH LRU CACHE & HARD COST CAP GUARD
// ============================================================================

export function parseTierRoutingFromRequest(req: Request): MultiTierRoutingConfig {
  const raw = readHeaderString(req, 'x-ai-tier-routing');
  if (!raw || raw.length > 8192) {
    return {
      ...DEFAULT_MULTI_TIER_ROUTING,
      tiers: {
        economy: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.economy },
        balanced: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.balanced },
        flagship: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.flagship },
      },
      taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    };
  }

  try {
    const jsonStr = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr) as Partial<MultiTierRoutingConfig>;
    const normalizeSlot = (tier: ModelTierId) => {
      const slot = parsed.tiers?.[tier];
      const fallback = DEFAULT_MULTI_TIER_ROUTING.tiers[tier];
      const provider = normalizeProviderType(slot?.provider || fallback.provider);
      const meta = AI_PROVIDER_METADATA[provider];
      return {
        provider,
        baseUrl: String(slot?.baseUrl || '').trim() || meta.defaultBaseUrl,
        apiKey: String(slot?.apiKey || '').trim(),
        modelId: sanitizeCustomModelId(String(slot?.modelId || '')) || fallback.modelId || meta.defaultModelId,
      };
    };

    const rawCap = parsed.hardCostCapUsd;
    const hardCostCapUsd =
      rawCap === null
        ? null
        : typeof rawCap === 'number' && Number.isFinite(rawCap) && rawCap > 0
          ? Math.min(500, Math.max(0.05, rawCap))
          : DEFAULT_MULTI_TIER_ROUTING.hardCostCapUsd;

    return {
      enabled: Boolean(parsed.enabled),
      optimizationMode: normalizeTokenOptimizationMode(parsed.optimizationMode),
      hardCostCapUsd,
      enablePromptCaching: parsed.enablePromptCaching !== false,
      enableResponseCache: parsed.enableResponseCache !== false,
      enableAntiDriftGuard: parsed.enableAntiDriftGuard !== false,
      tiers: {
        economy: normalizeSlot('economy'),
        balanced: normalizeSlot('balanced'),
        flagship: normalizeSlot('flagship'),
      },
      taskTierMap: {
        conflict_triage: normalizeModelTierId(parsed.taskTierMap?.conflict_triage || DEFAULT_TASK_TIER_MAP.conflict_triage),
        outline_polish: normalizeModelTierId(parsed.taskTierMap?.outline_polish || DEFAULT_TASK_TIER_MAP.outline_polish),
        semantic_reorder: normalizeModelTierId(parsed.taskTierMap?.semantic_reorder || DEFAULT_TASK_TIER_MAP.semantic_reorder),
        web_grounding: normalizeModelTierId(parsed.taskTierMap?.web_grounding || DEFAULT_TASK_TIER_MAP.web_grounding),
        editor_chat: normalizeModelTierId(parsed.taskTierMap?.editor_chat || DEFAULT_TASK_TIER_MAP.editor_chat),
        deep_review: normalizeModelTierId(parsed.taskTierMap?.deep_review || DEFAULT_TASK_TIER_MAP.deep_review),
        harness_author: normalizeModelTierId(parsed.taskTierMap?.harness_author || DEFAULT_TASK_TIER_MAP.harness_author),
        harness_patch: normalizeModelTierId(parsed.taskTierMap?.harness_patch || DEFAULT_TASK_TIER_MAP.harness_patch),
        harness_utility: normalizeModelTierId(parsed.taskTierMap?.harness_utility || DEFAULT_TASK_TIER_MAP.harness_utility),
        harness_judge: normalizeModelTierId(parsed.taskTierMap?.harness_judge || DEFAULT_TASK_TIER_MAP.harness_judge),
      },
    };
  } catch {
    return {
      ...DEFAULT_MULTI_TIER_ROUTING,
      tiers: {
        economy: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.economy },
        balanced: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.balanced },
        flagship: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.flagship },
      },
      taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    };
  }
}

export interface TaskResolvedAiContext {
  provider: ResolvedServerAiProvider;
  googleModel: string;
  tierUsed: ModelTierId | 'primary';
  tierLabelFa: string;
  optimizationMode: TokenOptimizationMode;
  hardCostCapUsd: number | null;
  enablePromptCaching: boolean;
  enableResponseCache: boolean;
  enableAntiDriftGuard: boolean;
}

const TIER_LABELS_FA: Record<ModelTierId | 'primary', string> = {
  economy: 'سطح اقتصادی (Economy)',
  balanced: 'سطح متعادل (Balanced)',
  flagship: 'سطح پرچمدار (Flagship)',
  primary: 'مدل اصلی',
};

/**
 * Resolves the exact provider + model for a pipeline task using the user's Multi-Tier Routing
 * configuration when enabled, or falling back seamlessly to the primary provider while preserving
 * all token optimization, prompt caching, response caching, and anti-drift settings.
 */
export function resolveProviderForTaskFromRequest(
  req: Request,
  taskType: AiTaskType,
  fallbackGoogleModel = 'gemini-4-hydrogen',
  overrideTier?: ModelTierId
): TaskResolvedAiContext {
  const primary = resolveAiProviderFromRequest(req);
  const routing = parseTierRoutingFromRequest(req);

  if (!routing.enabled) {
    return {
      provider: primary,
      googleModel: normalizeGoogleModelId(fallbackGoogleModel),
      tierUsed: 'primary',
      tierLabelFa: TIER_LABELS_FA.primary,
      optimizationMode: routing.optimizationMode,
      hardCostCapUsd: routing.hardCostCapUsd,
      enablePromptCaching: routing.enablePromptCaching,
      enableResponseCache: routing.enableResponseCache,
      enableAntiDriftGuard: routing.enableAntiDriftGuard,
    };
  }

  const tierId: ModelTierId = overrideTier || routing.taskTierMap[taskType] || DEFAULT_TASK_TIER_MAP[taskType];
  const slot = routing.tiers[tierId];
  const meta = AI_PROVIDER_METADATA[slot.provider];
  const keyMode = primary.googleKeyMode;
  const creatorApiKey = getCreatorKeyForProvider(slot.provider);
  const personalApiKey =
    slot.apiKey.trim() ||
    (slot.provider === primary.provider ? primary.personalApiKey : '');

  const urlCheck = validateCustomBaseUrl(slot.baseUrl || meta.defaultBaseUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    return {
      provider: {
        provider: slot.provider,
        googleKeyMode: keyMode,
        apiKey: '',
        creatorApiKey,
        personalApiKey,
        keySource: keyMode === 'personal' ? 'personal' : 'creator',
        baseUrl: '',
        hasCustomGeminiBaseUrl: false,
        customModelId: slot.modelId || meta.defaultModelId,
        validationError: `آدرس Base URL برای ${TIER_LABELS_FA[tierId]} نامعتبر است: ${urlCheck.error}`,
      },
      googleModel: slot.provider === 'google_aistudio' ? slot.modelId : normalizeGoogleModelId(fallbackGoogleModel),
      tierUsed: tierId,
      tierLabelFa: TIER_LABELS_FA[tierId],
      optimizationMode: routing.optimizationMode,
      hardCostCapUsd: routing.hardCostCapUsd,
      enablePromptCaching: routing.enablePromptCaching,
      enableResponseCache: routing.enableResponseCache,
      enableAntiDriftGuard: routing.enableAntiDriftGuard,
    };
  }

  const normalizedBaseUrl = urlCheck.normalizedUrl;
  const defaultNorm = meta.defaultBaseUrl.replace(/\/+$/, '');
  const hasCustomGeminiBaseUrl =
    slot.provider === 'google_aistudio' && normalizedBaseUrl !== defaultNorm;

  const resolvedGoogleModel =
    slot.provider === 'google_aistudio'
      ? (slot.modelId || normalizeGoogleModelId(fallbackGoogleModel))
      : normalizeGoogleModelId(fallbackGoogleModel);

  const customModelId =
    slot.provider === 'google_aistudio' ? '' : (slot.modelId || meta.defaultModelId);

  let effectiveKey = '';
  let keySource: 'creator' | 'personal' | 'custom' = 'creator';
  let validationError: string | undefined;

  if (keyMode === 'personal') {
    if (personalApiKey) {
      effectiveKey = personalApiKey;
      keySource = slot.provider === 'custom_openai' ? 'custom' : 'personal';
    } else {
      keySource = slot.provider === 'custom_openai' ? 'custom' : 'personal';
      validationError = `کلید API برای ${TIER_LABELS_FA[tierId]} (${meta.shortName}) وارد نشده است.`;
    }
  } else {
    const cachedHealthy = getCachedCreatorHealth(slot.provider);
    if (creatorApiKey && cachedHealthy !== false) {
      effectiveKey = creatorApiKey;
      keySource = 'creator';
    } else if (personalApiKey) {
      effectiveKey = personalApiKey;
      keySource = slot.provider === 'custom_openai' ? 'custom' : 'personal';
    } else if (creatorApiKey) {
      effectiveKey = creatorApiKey;
      keySource = 'creator';
    } else {
      validationError = `کلید API برای ${TIER_LABELS_FA[tierId]} (${meta.shortName}) تنظیم نشده است. لطفاً کلید ${meta.shortName} را در تنظیمات وارد کنید.`;
    }
  }

  return {
    provider: {
      provider: slot.provider,
      googleKeyMode: keyMode,
      apiKey: effectiveKey,
      creatorApiKey,
      personalApiKey,
      keySource,
      baseUrl: normalizedBaseUrl,
      hasCustomGeminiBaseUrl,
      customModelId,
      ...(validationError ? { validationError } : {}),
    },
    googleModel: resolvedGoogleModel,
    tierUsed: tierId,
    tierLabelFa: TIER_LABELS_FA[tierId],
    optimizationMode: routing.optimizationMode,
    hardCostCapUsd: routing.hardCostCapUsd,
    enablePromptCaching: routing.enablePromptCaching,
    enableResponseCache: routing.enableResponseCache,
    enableAntiDriftGuard: routing.enableAntiDriftGuard,
  };
}

/**
 * Hard Cost Cap safety gate: prevents expensive paid API keys from exceeding
 * the user's configured per-project USD ceiling.
 */
export function checkHardCostCap(
  usage: ProjectAiUsageLedger,
  hardCostCapUsd: number | null
): { allowed: boolean; spentUsd: number; errorMessageFa?: string } {
  const spentUsd =
    typeof usage.estimatedCostUsdAccumulated === 'number' &&
    Number.isFinite(usage.estimatedCostUsdAccumulated)
      ? usage.estimatedCostUsdAccumulated
      : computeCallCostUsd({
          modelId: usage.lastModelUsed || 'gemini-4-hydrogen',
          promptTokens: usage.promptTokens,
          outputTokens: usage.outputTokens,
          thinkingTokens: usage.thinkingTokens,
        });

  if (hardCostCapUsd === null || !Number.isFinite(hardCostCapUsd) || hardCostCapUsd <= 0) {
    return { allowed: true, spentUsd };
  }

  if (spentUsd >= hardCostCapUsd) {
    return {
      allowed: false,
      spentUsd,
      errorMessageFa: `سقف ایمنی هزینه این پروژه (${formatUsdClean(hardCostCapUsd)}) با مصرف تخمینی فعلی (${formatUsdClean(spentUsd)}) پر شده است. برای ادامه می‌توانید از «تنظیمات ارائه‌دهنده ← سطوح مدل و توکن» سقف هزینه را افزایش دهید یا از پردازش محلی (۰ توکن) استفاده کنید.`,
    };
  }

  return { allowed: true, spentUsd };
}

// Bounded in-memory Prompt-Hash LRU Cache (128 entries, 30 min TTL) for idempotent tasks
interface CachedTaskEntry {
  text: string;
  modelUsed: string;
  savedPromptTokens: number;
  expiresAtMs: number;
}
const AI_TASK_CACHE_MAX = 128;
const AI_TASK_CACHE_TTL_MS = 30 * 60 * 1000;
const aiTaskResponseCache = new Map<string, CachedTaskEntry>();

export function buildAiTaskCacheKey(parts: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const p of parts) {
    hash.update(p);
    hash.update('\x1f');
  }
  return hash.digest('hex');
}

export function getCachedAiTaskResult(key: string): CachedTaskEntry | null {
  const entry = aiTaskResponseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAtMs) {
    aiTaskResponseCache.delete(key);
    return null;
  }
  // Refresh LRU recency
  aiTaskResponseCache.delete(key);
  aiTaskResponseCache.set(key, entry);
  return entry;
}

export function setCachedAiTaskResult(
  key: string,
  entry: Omit<CachedTaskEntry, 'expiresAtMs'>
): void {
  if (aiTaskResponseCache.size >= AI_TASK_CACHE_MAX) {
    const oldestKey = aiTaskResponseCache.keys().next().value;
    if (oldestKey) aiTaskResponseCache.delete(oldestKey);
  }
  aiTaskResponseCache.set(key, {
    ...entry,
    expiresAtMs: Date.now() + AI_TASK_CACHE_TTL_MS,
  });
}

export function createCreatorProviderFor(provider: AiProviderType): ResolvedServerAiProvider {
  const meta = AI_PROVIDER_METADATA[provider];
  const creatorKey = getCreatorKeyForProvider(provider);
  return {
    provider,
    googleKeyMode: 'auto_creator_first',
    apiKey: creatorKey,
    creatorApiKey: creatorKey,
    personalApiKey: '',
    keySource: 'creator',
    baseUrl: meta.defaultBaseUrl,
    hasCustomGeminiBaseUrl: false,
    customModelId: provider === 'google_aistudio' ? '' : meta.defaultModelId,
  };
}

export function createCreatorGoogleProvider(): ResolvedServerAiProvider {
  return createCreatorProviderFor('google_aistudio');
}

export function createGoogleGenAiClient(
  apiKey: string,
  customBaseUrl?: string
): GoogleGenAI | null {
  const key = (apiKey || '').trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;

  const httpOptions: { baseUrl?: string; headers: Record<string, string> } = {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  };

  const trimmedUrl = (customBaseUrl || '').trim();
  const defaultGeminiBase = AI_PROVIDER_METADATA.google_aistudio.defaultBaseUrl;
  if (trimmedUrl && trimmedUrl.replace(/\/+$/, '') !== defaultGeminiBase) {
    const check = validateCustomBaseUrl(trimmedUrl);
    if (check.valid && check.normalizedUrl) {
      httpOptions.baseUrl = check.normalizedUrl;
    }
  }

  return new GoogleGenAI({
    apiKey: key,
    httpOptions,
  });
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return (
      low === '::1' ||
      low === '::' ||
      low.startsWith('fc') ||
      low.startsWith('fd') ||
      low.startsWith('fe8') ||
      low.startsWith('fe9') ||
      low.startsWith('fea') ||
      low.startsWith('feb') ||
      low.startsWith('::ffff:')
    );
  }
  return true;
}

/**
 * Resolves the hostname of a validated HTTPS Base URL via DNS and ensures
 * none of the resolved addresses point to loopback, private, or link-local ranges.
 */
async function assertPublicDestinationHost(baseUrl: string): Promise<void> {
  const parsed = new URL(baseUrl);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('دسترسی به نشانی‌های IP داخلی یا خصوصی مسدود است.');
    }
    return;
  }
  const records = await dns.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error('دامنه واردشده در Base URL قابل شناسایی نیست.');
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error('دامنه Base URL به نشانی داخلی یا خصوصی متصل است و مجاز نیست.');
    }
  }
}

function isNotFoundError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toUpperCase();
  const status = (err as { status?: number })?.status;
  return status === 404 || msg.includes('404') || msg.includes('NOT_FOUND');
}

function isQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toUpperCase();
  const status = (err as { status?: number })?.status;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('EXCEEDED YOUR CURRENT QUOTA') ||
    msg.includes('INSUFFICIENT_QUOTA') ||
    msg.includes('RATE_LIMIT') ||
    msg.includes('OVERLOADED')
  );
}

function isAuthKeyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toUpperCase();
  const status = (err as { status?: number })?.status;
  return (
    status === 401 ||
    status === 403 ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('INVALID_API_KEY') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('UNAUTHORIZED') ||
    msg.includes('INVALID AUTHENTICATION') ||
    msg.includes('AUTHENTICATION_ERROR')
  );
}

export function resolveThinkingLevelForGoogleModel(
  model: string,
  levelRaw?: string
): ThinkingLevel {
  const upper = (levelRaw || 'HIGH').toUpperCase();
  const map: Record<string, ThinkingLevel> = {
    LOW: ThinkingLevel.LOW,
    MEDIUM: ThinkingLevel.MEDIUM,
    HIGH: ThinkingLevel.HIGH,
    XHIGH: ThinkingLevel.XHIGH,
    MINIMAL: ThinkingLevel.MINIMAL,
  };
  let resolved = map[upper] ?? ThinkingLevel.HIGH;
  if (model === 'gemini-4-hydrogen' && resolved === ThinkingLevel.MINIMAL) {
    resolved = ThinkingLevel.LOW;
  }
  if (model === 'gemini-3.8-flash' && resolved === ThinkingLevel.XHIGH) {
    resolved = ThinkingLevel.HIGH;
  }
  return resolved;
}

function isTransientBusyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toUpperCase();
  const status = (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
  return (
    status === 503 ||
    status === 529 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('HIGH DEMAND') ||
    msg.includes('OVERLOADED')
  );
}

/**
 * Calls Google AI Studio generateContent on gemini-4-hydrogen or gemini-3.8-flash.
 * - If gemini-3.8-flash returns 404 NOT_FOUND on a given API key, seamlessly resolves to gemini-4-hydrogen.
 * - If gemini-4-hydrogen hits transient 503 UNAVAILABLE (high demand), automatically retries once on gemini-3.8-flash.
 */
export async function generateGoogleContentResilient(params: {
  ai: GoogleGenAI;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}): Promise<{ response: GenerateContentResponse; resolvedModel: string }> {
  const normalized = normalizeGoogleModelId(params.model);
  try {
    const response = await params.ai.models.generateContent({
      model: normalized,
      contents: params.contents as never,
      config: params.config as never,
    });
    return { response, resolvedModel: normalized };
  } catch (err) {
    if (normalized === 'gemini-3.8-flash' && isNotFoundError(err)) {
      const nextConfig = { ...(params.config || {}) };
      const tc = nextConfig.thinkingConfig as { thinkingLevel?: ThinkingLevel } | undefined;
      if (tc?.thinkingLevel === ThinkingLevel.MINIMAL) {
        nextConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }
      const response = await params.ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: params.contents as never,
        config: nextConfig as never,
      });
      return { response, resolvedModel: 'gemini-4-hydrogen' };
    }
    if (normalized === 'gemini-4-hydrogen' && isTransientBusyError(err)) {
      try {
        const nextConfig = { ...(params.config || {}) };
        const tc = nextConfig.thinkingConfig as { thinkingLevel?: ThinkingLevel } | undefined;
        if (tc?.thinkingLevel === ThinkingLevel.XHIGH) {
          nextConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
        }
        const response = await params.ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: params.contents as never,
          config: nextConfig as never,
        });
        return { response, resolvedModel: 'gemini-3.8-flash' };
      } catch {
        // Re-throw original busy error for clean Persian formatting
      }
    }
    throw err;
  }
}

export interface UnifiedGenerationResult {
  text: string;
  modelUsed: string;
  requestedModel?: string;
  finishReason?: string | null;
  isTruncated?: boolean;
  modelMismatch?: ModelMismatchEvaluation;
  cacheTelemetryReported?: boolean;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  usageDelta: AiUsageDelta;
  rawGoogleResponse?: GenerateContentResponse;
  keySourceUsed?: 'creator' | 'personal' | 'custom';
}

interface DirectChatResponse {
  text: string;
  modelUsed: string;
  requestedModel: string;
  finishReason: string | null;
  isTruncated: boolean;
  modelMismatch?: ModelMismatchEvaluation;
  cacheTelemetryReported: boolean;
  cacheCreationInputTokens: number;
  reasoningTokens: number;
  usage: {
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
  };
  headers: Headers;
}

function isTruncatedFinishReason(reason?: string | null): boolean {
  const norm = String(reason || '').trim().toLowerCase();
  return (
    norm === 'length' ||
    norm === 'max_tokens' ||
    norm === 'max_output_tokens' ||
    norm === 'model_context_window_exceeded'
  );
}

function sleepMs(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Executes an OpenAI-compatible /chat/completions request against OpenAI, OpenRouter, 9Router, or Custom providers.
 * Package B Hardening:
 * - ProviderCapabilityProfile sanitization & safe json_schema -> json_object fallback
 * - HTML/Cloudflare upstream_gateway_error detection
 * - Retryable (429/502/503/529 + Retry-After + Exponential Backoff + Jitter) vs Fatal (400/401/402/403)
 * - Silent model_mismatch detection & factual cache/reasoning token extraction
 */
export async function callCustomOpenAiChat(params: {
  provider: ResolvedServerAiProvider;
  apiKeyOverride?: string;
  baseUrlOverride?: string;
  systemInstruction?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectJson?: boolean;
  jsonSchema?: Record<string, unknown> | null;
  taskRole?: AiTaskType;
  temperature?: number;
  haltOnAuthorDowngrade?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}): Promise<DirectChatResponse> {
  const effectiveApiKey = (params.apiKeyOverride ?? params.provider.apiKey).trim();
  const effectiveBaseUrl = (params.baseUrlOverride ?? params.provider.baseUrl).trim();

  if (!effectiveBaseUrl || !effectiveApiKey) {
    throw new Error(
      params.provider.validationError || 'تنظیمات ارائه‌دهنده (Base URL یا API Key) کامل نیست.'
    );
  }

  const urlCheck = validateCustomBaseUrl(effectiveBaseUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    throw new Error(urlCheck.error || 'آدرس Base URL نامعتبر است.');
  }

  await assertPublicDestinationHost(urlCheck.normalizedUrl);

  const endpoint = urlCheck.normalizedUrl.endsWith('/chat/completions')
    ? urlCheck.normalizedUrl
    : `${urlCheck.normalizedUrl}/chat/completions`;

  const requestedModel = params.provider.customModelId || 'gpt-4o-mini';
  const profile = resolveProviderCapabilityProfile({
    provider: params.provider.provider,
    baseUrl: urlCheck.normalizedUrl,
    modelId: requestedModel,
  });

  const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (params.systemInstruction) {
    chatMessages.push({ role: 'system', content: params.systemInstruction });
  }
  for (const m of params.messages) {
    chatMessages.push({ role: m.role, content: m.content });
  }

  const maxRetries = Math.max(0, Math.min(3, params.maxRetries ?? 2));
  const providerLabelFa =
    profile.flavor === '9router'
      ? '9Router'
      : profile.flavor === 'openrouter'
        ? 'OpenRouter'
        : AI_PROVIDER_METADATA[params.provider.provider].shortName;

  const executeAttempt = async (forceDowngradeJsonFormat: boolean) => {
    const rawPayload: Record<string, unknown> = {
      model: requestedModel,
      messages: chatMessages,
    };
    if (typeof params.temperature === 'number') {
      rawPayload.temperature = params.temperature;
    }
    if (typeof params.maxTokens === 'number' && params.maxTokens > 0) {
      if (profile.isReasoningModel && profile.flavor === 'openai') {
        rawPayload.max_completion_tokens = params.maxTokens;
      } else {
        rawPayload.max_tokens = params.maxTokens;
      }
    }

    const sanitized = sanitizeOpenAiCompatiblePayload({
      profile,
      rawPayload,
      expectJson: params.expectJson,
      jsonSchema: params.jsonSchema,
      taskRole: params.taskRole,
      forceDowngradeJsonFormat,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);
    const onExternalAbort = () => controller.abort();
    if (params.abortSignal?.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    params.abortSignal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveApiKey}`,
        },
        body: JSON.stringify(sanitized.payload),
      });
      const rawText = await res.text();
      const contentType = res.headers.get('content-type') || '';
      const retryAfterHeader = res.headers.get('retry-after');
      return { res, rawText, contentType, retryAfterHeader, responseFormatMode: sanitized.responseFormatMode };
    } finally {
      clearTimeout(timer);
      params.abortSignal?.removeEventListener('abort', onExternalAbort);
    }
  };

  let downgradeJsonFormat = false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (params.abortSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const { res, rawText, contentType, retryAfterHeader, responseFormatMode } =
        await executeAttempt(downgradeJsonFormat);

      // HTML gateway page detection (even if status is 200 or 502/504 Cloudflare error page)
      if (isHtmlErrorPayload(contentType, rawText)) {
        const classified = classifyProviderHttpResponse({
          status: res.ok ? 502 : res.status,
          contentType,
          bodyText: rawText,
          retryAfterHeader,
          providerLabelFa,
        });
        const gwErr = new ProviderGatewayError(classified);
        if (classified.retryable && attempt < maxRetries) {
          await sleepMs(
            computeRetryBackoffDelayMs({
              attempt,
              retryAfterMs: classified.retryAfterMs,
            }),
            params.abortSignal
          );
          lastError = gwErr;
          continue;
        }
        throw gwErr;
      }

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        // Automatic safe fallback if custom router (9Router/OpenRouter) rejects response_format with 400
        if (
          res.status === 400 &&
          params.expectJson &&
          responseFormatMode !== 'none' &&
          !downgradeJsonFormat &&
          /response_format|json_schema|json_object|unsupported/i.test(rawText)
        ) {
          downgradeJsonFormat = true;
          continue;
        }

        const classified = classifyProviderHttpResponse({
          status: res.status,
          contentType,
          bodyText: rawText,
          retryAfterHeader,
          providerLabelFa,
        });
        const gwErr = new ProviderGatewayError(classified);
        if (classified.retryable && attempt < maxRetries) {
          await sleepMs(
            computeRetryBackoffDelayMs({
              attempt,
              retryAfterMs: classified.retryAfterMs,
            }),
            params.abortSignal
          );
          lastError = gwErr;
          continue;
        }
        throw gwErr;
      }

      if (!parsed) {
        throw new ProviderGatewayError({
          category: 'upstream_gateway_error',
          code: 'upstream_gateway_error',
          status: 502,
          retryable: false,
          retryAfterMs: null,
          neverEnterPatchLoop: true,
          messageFa: `[upstream_gateway_error] پاسخ درگاه ${providerLabelFa} قالب JSON معتبر نداشت و متوقف شد.`,
        });
      }

      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const firstChoice = choices[0] as
        | { finish_reason?: string | null; message?: { content?: string | Array<{ text?: string }> } }
        | undefined;
      const finishReason =
        typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : null;
      const rawContent = firstChoice?.message?.content;
      const text =
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.map((p) => p?.text || '').join('')
            : '';

      const usageObj = (parsed.usage || {}) as Record<string, unknown>;
      const promptTokens = Number(usageObj.prompt_tokens) || 0;
      const outputTokens = Number(usageObj.completion_tokens) || 0;
      const totalTokens = Number(usageObj.total_tokens) || promptTokens + outputTokens;

      const cacheTelemetry = extractRealCacheTelemetry(usageObj);
      const reasoningTokens = extractRealReasoningTokens(usageObj);
      const actualModel = String(parsed.model || requestedModel).trim() || requestedModel;

      const modelMismatch = evaluateModelMismatch({
        requestedModel,
        actualModel,
        taskRole: params.taskRole,
        haltOnAuthorDowngrade: params.haltOnAuthorDowngrade,
      });

      if (modelMismatch.shouldHalt) {
        throw new ProviderGatewayError({
          category: 'fatal',
          code: 'model_mismatch_downgrade',
          status: 409,
          retryable: false,
          retryAfterMs: null,
          neverEnterPatchLoop: true,
          messageFa:
            modelMismatch.warningFa ||
            `[model_mismatch] افت رده غیرمجاز مدل در نقش harness_author (${requestedModel} -> ${actualModel}).`,
        });
      }

      return {
        text: text.trim(),
        modelUsed: actualModel,
        requestedModel,
        finishReason,
        isTruncated: isTruncatedFinishReason(finishReason),
        modelMismatch,
        cacheTelemetryReported: cacheTelemetry.cacheTelemetryReported,
        cacheCreationInputTokens: cacheTelemetry.cacheCreationInputTokens,
        reasoningTokens,
        usage: {
          promptTokens,
          outputTokens,
          totalTokens,
          cachedInputTokens: cacheTelemetry.cachedInputTokens,
          reasoningTokens,
        },
        headers: res.headers,
      };
    } catch (err) {
      if (params.abortSignal?.aborted) {
        throw err;
      }
      if (err instanceof ProviderGatewayError && !err.retryable) {
        throw err;
      }
      lastError = err;
      if (attempt >= maxRetries) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('خطا در ارتباط با ارائه‌دهنده OpenAI/سفارشی.');
}

/**
 * Executes a native Anthropic Claude Messages API request (/messages) with editable HTTPS Base URL.
 * Package B Hardening:
 * - Honors ProviderCapabilityProfile minCachePrefixTokens (1024 / 2048) before sending cache_control
 * - HTML/Cloudflare upstream_gateway_error detection & Retryable vs Fatal classification
 * - Silent model_mismatch detection & factual cache/reasoning telemetry
 */
export async function callAnthropicMessages(params: {
  provider: ResolvedServerAiProvider;
  apiKeyOverride?: string;
  baseUrlOverride?: string;
  systemInstruction?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectJson?: boolean;
  taskRole?: AiTaskType;
  haltOnAuthorDowngrade?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  enablePromptCaching?: boolean;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}): Promise<DirectChatResponse> {
  const effectiveApiKey = (params.apiKeyOverride ?? params.provider.apiKey).trim();
  const effectiveBaseUrl = (params.baseUrlOverride ?? params.provider.baseUrl).trim();

  if (!effectiveBaseUrl || !effectiveApiKey) {
    throw new Error(
      params.provider.validationError || 'تنظیمات Anthropic (Base URL یا API Key) کامل نیست.'
    );
  }

  const urlCheck = validateCustomBaseUrl(effectiveBaseUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    throw new Error(urlCheck.error || 'آدرس Base URL Anthropic نامعتبر است.');
  }

  await assertPublicDestinationHost(urlCheck.normalizedUrl);

  const endpoint = urlCheck.normalizedUrl.endsWith('/messages')
    ? urlCheck.normalizedUrl
    : `${urlCheck.normalizedUrl}/messages`;

  const requestedModel =
    params.provider.customModelId || AI_PROVIDER_METADATA.anthropic.defaultModelId;
  const profile = resolveProviderCapabilityProfile({
    provider: params.provider.provider,
    baseUrl: urlCheck.normalizedUrl,
    modelId: requestedModel,
  });

  const systemParts: string[] = [];
  if (params.systemInstruction) systemParts.push(params.systemInstruction);
  if (params.expectJson) {
    systemParts.push('پاسخ را منحصراً به صورت JSON معتبر بدون توضیح اضافه برگردان.');
  }
  const combinedSystem = systemParts.join('\n\n');
  const estimatedSystemTokens = estimatePersianTokensConservative(combinedSystem);
  const shouldUseCacheControl =
    params.enablePromptCaching !== false &&
    profile.supportsAnthropicCacheControl &&
    estimatedSystemTokens >= profile.minCachePrefixTokens;

  const maxRetries = Math.max(0, Math.min(3, params.maxRetries ?? 2));
  let useStructuredCacheSystem = shouldUseCacheControl;
  let lastError: unknown = null;

  const sendRequest = async (withCacheControl: boolean) => {
    const bodyPayload: Record<string, unknown> = {
      model: requestedModel,
      max_tokens: params.maxTokens && params.maxTokens > 0 ? params.maxTokens : 4096,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    if (combinedSystem) {
      bodyPayload.system = withCacheControl
        ? [{ type: 'text', text: combinedSystem, cache_control: { type: 'ephemeral' } }]
        : combinedSystem;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);
    const onExternalAbort = () => controller.abort();
    if (params.abortSignal?.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    params.abortSignal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': effectiveApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(bodyPayload),
      });

      const rawText = await res.text();
      const contentType = res.headers.get('content-type') || '';
      const retryAfterHeader = res.headers.get('retry-after');
      return { res, rawText, contentType, retryAfterHeader };
    } finally {
      clearTimeout(timer);
      params.abortSignal?.removeEventListener('abort', onExternalAbort);
    }
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (params.abortSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const { res, rawText, contentType, retryAfterHeader } = await sendRequest(
        useStructuredCacheSystem
      );

      if (isHtmlErrorPayload(contentType, rawText)) {
        const classified = classifyProviderHttpResponse({
          status: res.ok ? 502 : res.status,
          contentType,
          bodyText: rawText,
          retryAfterHeader,
          providerLabelFa: 'Anthropic Claude',
        });
        const gwErr = new ProviderGatewayError(classified);
        if (classified.retryable && attempt < maxRetries) {
          await sleepMs(
            computeRetryBackoffDelayMs({ attempt, retryAfterMs: classified.retryAfterMs }),
            params.abortSignal
          );
          lastError = gwErr;
          continue;
        }
        throw gwErr;
      }

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        parsed = null;
      }

      // Graceful automatic fallback if a third-party Anthropic proxy rejects array system blocks
      if (!res.ok && res.status === 400 && useStructuredCacheSystem) {
        useStructuredCacheSystem = false;
        continue;
      }

      if (!res.ok) {
        const classified = classifyProviderHttpResponse({
          status: res.status,
          contentType,
          bodyText: rawText,
          retryAfterHeader,
          providerLabelFa: 'Anthropic Claude',
        });
        const gwErr = new ProviderGatewayError(classified);
        if (classified.retryable && attempt < maxRetries) {
          await sleepMs(
            computeRetryBackoffDelayMs({ attempt, retryAfterMs: classified.retryAfterMs }),
            params.abortSignal
          );
          lastError = gwErr;
          continue;
        }
        throw gwErr;
      }

      if (!parsed) {
        throw new ProviderGatewayError({
          category: 'upstream_gateway_error',
          code: 'upstream_gateway_error',
          status: 502,
          retryable: false,
          retryAfterMs: null,
          neverEnterPatchLoop: true,
          messageFa: '[upstream_gateway_error] پاسخ درگاه Anthropic قالب JSON معتبر نداشت.',
        });
      }

      const contentBlocks = Array.isArray(parsed.content)
        ? (parsed.content as Array<{ type?: string; text?: string }>)
        : [];
      const text = contentBlocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');

      const usageObj = (parsed.usage || {}) as Record<string, unknown>;
      const cacheTelemetry = extractRealCacheTelemetry(usageObj);
      const reasoningTokens = extractRealReasoningTokens(usageObj);
      const promptTokens =
        (Number(usageObj.input_tokens) || 0) +
        cacheTelemetry.cachedInputTokens +
        cacheTelemetry.cacheCreationInputTokens;
      const outputTokens = Number(usageObj.output_tokens) || 0;
      const actualModel = String(parsed.model || requestedModel).trim() || requestedModel;

      const modelMismatch = evaluateModelMismatch({
        requestedModel,
        actualModel,
        taskRole: params.taskRole,
        haltOnAuthorDowngrade: params.haltOnAuthorDowngrade,
      });

      if (modelMismatch.shouldHalt) {
        throw new ProviderGatewayError({
          category: 'fatal',
          code: 'model_mismatch_downgrade',
          status: 409,
          retryable: false,
          retryAfterMs: null,
          neverEnterPatchLoop: true,
          messageFa:
            modelMismatch.warningFa ||
            `[model_mismatch] افت رده غیرمجاز مدل در نقش harness_author (${requestedModel} -> ${actualModel}).`,
        });
      }

      const finishReason =
        typeof parsed.stop_reason === 'string' ? parsed.stop_reason : null;

      return {
        text: text.trim(),
        modelUsed: actualModel,
        requestedModel,
        finishReason,
        isTruncated: isTruncatedFinishReason(finishReason),
        modelMismatch,
        cacheTelemetryReported: cacheTelemetry.cacheTelemetryReported,
        cacheCreationInputTokens: cacheTelemetry.cacheCreationInputTokens,
        reasoningTokens,
        usage: {
          promptTokens,
          outputTokens,
          totalTokens: promptTokens + outputTokens,
          cachedInputTokens: cacheTelemetry.cachedInputTokens,
          reasoningTokens,
        },
        headers: res.headers,
      };
    } catch (err) {
      if (params.abortSignal?.aborted) {
        throw err;
      }
      if (err instanceof ProviderGatewayError && !err.retryable) {
        throw err;
      }
      lastError = err;
      if (attempt >= maxRetries) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('خطا در ارتباط با سرویس Anthropic.');
}

/**
 * Dispatches chat calls for OpenAI, Anthropic, or Custom OpenAI-compatible providers,
 * with automatic App Owner -> Personal key fallback when googleKeyMode === 'auto_creator_first'.
 */
export async function callNonGoogleChatWithFallback(params: {
  provider: ResolvedServerAiProvider;
  systemInstruction?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectJson?: boolean;
  jsonSchema?: Record<string, unknown> | null;
  taskRole?: AiTaskType;
  temperature?: number;
  haltOnAuthorDowngrade?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  enablePromptCaching?: boolean;
  abortSignal?: AbortSignal;
}): Promise<DirectChatResponse & { keySourceUsed: 'creator' | 'personal' | 'custom' }> {
  const invoke = (apiKeyOverride?: string, baseUrlOverride?: string) =>
    params.provider.provider === 'anthropic'
      ? callAnthropicMessages({
          provider: params.provider,
          apiKeyOverride,
          baseUrlOverride,
          systemInstruction: params.systemInstruction,
          messages: params.messages,
          expectJson: params.expectJson,
          taskRole: params.taskRole,
          haltOnAuthorDowngrade: params.haltOnAuthorDowngrade,
          maxTokens: params.maxTokens,
          timeoutMs: params.timeoutMs,
          enablePromptCaching: params.enablePromptCaching,
          abortSignal: params.abortSignal,
        })
      : callCustomOpenAiChat({
          provider: params.provider,
          apiKeyOverride,
          baseUrlOverride,
          systemInstruction: params.systemInstruction,
          messages: params.messages,
          expectJson: params.expectJson,
          jsonSchema: params.jsonSchema,
          taskRole: params.taskRole,
          temperature: params.temperature,
          haltOnAuthorDowngrade: params.haltOnAuthorDowngrade,
          maxTokens: params.maxTokens,
          timeoutMs: params.timeoutMs,
          abortSignal: params.abortSignal,
        });

  if (
    params.provider.googleKeyMode === 'auto_creator_first' &&
    params.provider.keySource === 'creator' &&
    params.provider.creatorApiKey
  ) {
    try {
      const out = await invoke(
        params.provider.creatorApiKey,
        AI_PROVIDER_METADATA[params.provider.provider].defaultBaseUrl
      );
      markCreatorHealth(params.provider.provider, true);
      return { ...out, keySourceUsed: 'creator' };
    } catch (err) {
      if (isQuotaError(err) || isAuthKeyError(err)) {
        markCreatorHealth(params.provider.provider, false);
        if (params.provider.personalApiKey) {
          const fallback = await invoke(params.provider.personalApiKey, params.provider.baseUrl);
          return {
            ...fallback,
            keySourceUsed: params.provider.provider === 'custom_openai' ? 'custom' : 'personal',
          };
        }
      }
      throw err;
    }
  }

  const out = await invoke();
  return { ...out, keySourceUsed: params.provider.keySource };
}

/**
 * Helper to create an active GoogleGenAI client with Creator-First -> Personal fallback
 * for features like Google Search Grounding and Gemini Tool Calling.
 */
export async function executeWithGoogleClientFallback<T>(
  provider: ResolvedServerAiProvider,
  fn: (ai: GoogleGenAI, keySource: 'creator' | 'personal') => Promise<T>
): Promise<{ result: T; keySourceUsed: 'creator' | 'personal' }> {
  if (provider.validationError) {
    throw new Error(provider.validationError);
  }

  // Validate custom Gemini baseUrl host if provided
  if (provider.hasCustomGeminiBaseUrl && provider.baseUrl) {
    await assertPublicDestinationHost(provider.baseUrl);
  }

  // Try App Owner first if auto_creator_first & configured & not known exhausted
  if (
    provider.googleKeyMode === 'auto_creator_first' &&
    provider.keySource === 'creator' &&
    provider.creatorApiKey
  ) {
    const creatorClient = createGoogleGenAiClient(provider.creatorApiKey);
    if (creatorClient) {
      try {
        const result = await fn(creatorClient, 'creator');
        markCreatorHealth('google_aistudio', true);
        return { result, keySourceUsed: 'creator' };
      } catch (err) {
        if (isQuotaError(err) || isAuthKeyError(err)) {
          markCreatorHealth('google_aistudio', false);
          if (provider.personalApiKey) {
            const personalClient = createGoogleGenAiClient(
              provider.personalApiKey,
              provider.hasCustomGeminiBaseUrl ? provider.baseUrl : undefined
            );
            if (personalClient) {
              const result = await fn(personalClient, 'personal');
              return { result, keySourceUsed: 'personal' };
            }
          }
        }
        throw err;
      }
    }
  }

  const activeClient = createGoogleGenAiClient(
    provider.apiKey,
    provider.hasCustomGeminiBaseUrl ? provider.baseUrl : undefined
  );
  if (!activeClient) {
    throw new Error(
      'کلید API گوگل تنظیم نشده یا سهمیه سازنده در دسترس نیست. لطفاً در بخش «تنظیمات ارائه‌دهنده» کلید اختصاصی خود را وارد کنید.'
    );
  }
  const result = await fn(
    activeClient,
    provider.keySource === 'creator' ? 'creator' : 'personal'
  );
  if (provider.keySource === 'creator') {
    markCreatorHealth('google_aistudio', true);
  }
  return {
    result,
    keySourceUsed: provider.keySource === 'creator' ? 'creator' : 'personal',
  };
}

/**
 * Unified text/JSON generator across Gemini, OpenAI, Anthropic, and Custom providers
 * with automatic App Owner -> Personal key fallback.
 */
export async function generateUnifiedTextOrJson(params: {
  provider: ResolvedServerAiProvider;
  googleModel: string;
  thinkingLevel?: ThinkingLevel;
  taskRole?: AiTaskType;
  haltOnAuthorDowngrade?: boolean;
  systemInstruction?: string;
  prompt: string;
  expectJson?: boolean;
  googleResponseSchema?: unknown;
  jsonSchema?: Record<string, unknown> | null;
  enablePromptCaching?: boolean;
  abortSignal?: AbortSignal;
  savedTokensByOptimization?: number;
  usageFlags?: { isGrounding?: boolean; isDeepReview?: boolean; isChat?: boolean };
}): Promise<UnifiedGenerationResult> {
  if (params.abortSignal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (isNonGoogleProvider(params.provider)) {
    const out = await callNonGoogleChatWithFallback({
      provider: params.provider,
      systemInstruction: params.systemInstruction,
      messages: [{ role: 'user', content: params.prompt }],
      expectJson: params.expectJson,
      jsonSchema: params.jsonSchema,
      taskRole: params.taskRole,
      haltOnAuthorDowngrade: params.haltOnAuthorDowngrade,
      enablePromptCaching: params.enablePromptCaching,
      abortSignal: params.abortSignal,
    });
    const fallbackPrompt = estimatePersianTokensConservative(
      `${params.systemInstruction || ''}\n${params.prompt}`
    );
    const fallbackOutput = estimatePersianTokensConservative(out.text);
    const promptTokens = out.usage.promptTokens > 0 ? out.usage.promptTokens : fallbackPrompt;
    const outputTokens = out.usage.outputTokens > 0 ? out.usage.outputTokens : fallbackOutput;
    const reasoningTokens = out.reasoningTokens || 0;
    const cachedTokens = out.cacheTelemetryReported ? out.usage.cachedInputTokens || 0 : 0;
    return {
      text: out.text,
      modelUsed: out.modelUsed,
      requestedModel: out.requestedModel,
      finishReason: out.finishReason,
      isTruncated: out.isTruncated,
      modelMismatch: out.modelMismatch,
      cacheTelemetryReported: out.cacheTelemetryReported,
      cacheCreationInputTokens: out.cacheCreationInputTokens,
      reasoningTokens,
      keySourceUsed: out.keySourceUsed,
      usageDelta: {
        promptTokens,
        outputTokens,
        thinkingTokens: reasoningTokens,
        totalTokens: out.usage.totalTokens > 0 ? out.usage.totalTokens : promptTokens + outputTokens,
        cachedInputTokens: cachedTokens,
        savedTokensByOptimization: (params.savedTokensByOptimization || 0) + cachedTokens,
        requestCount: 1,
        groundingCallCount: params.usageFlags?.isGrounding ? 1 : 0,
        deepReviewCount: params.usageFlags?.isDeepReview ? 1 : 0,
        chatCallCount: params.usageFlags?.isChat ? 1 : 0,
        modelUsed: out.modelUsed,
      },
    };
  }

  const config: Record<string, unknown> = {};
  if (params.systemInstruction) config.systemInstruction = params.systemInstruction;
  if (params.expectJson) config.responseMimeType = 'application/json';
  if (params.googleResponseSchema) config.responseSchema = params.googleResponseSchema;

  // Enforce per-role thinking cap so utility/judge never burn excessive reasoning tokens
  const roleCap = resolveRoleReasoningCap(params.taskRole);
  const requestedLevel = params.taskRole
    ? roleCap.googleThinkingLevel
    : params.thinkingLevel;
  if (requestedLevel) {
    config.thinkingConfig = {
      thinkingLevel: resolveThinkingLevelForGoogleModel(params.googleModel, requestedLevel),
    };
  }

  const requestedGoogleModel = normalizeGoogleModelId(params.googleModel);
  const { result, keySourceUsed } = await executeWithGoogleClientFallback(
    params.provider,
    async (ai) =>
      generateGoogleContentResilient({
        ai,
        model: requestedGoogleModel,
        contents: params.prompt,
        config,
      })
  );

  const { response, resolvedModel } = result;
  const text = (response.text || '').trim();
  const googleFinishReason =
    typeof response.candidates?.[0]?.finishReason === 'string'
      ? response.candidates[0].finishReason
      : null;
  const meta = (response.usageMetadata || {}) as Record<string, unknown>;
  const cacheTelemetry = extractRealCacheTelemetry(meta);
  const reasoningTokens = extractRealReasoningTokens(meta);

  const promptTokens =
    typeof meta.promptTokenCount === 'number' && meta.promptTokenCount > 0
      ? meta.promptTokenCount
      : estimatePersianTokensConservative(`${params.systemInstruction || ''}\n${params.prompt}`);
  const outputTokens =
    typeof meta.candidatesTokenCount === 'number' && meta.candidatesTokenCount > 0
      ? meta.candidatesTokenCount
      : estimatePersianTokensConservative(text);
  const cachedInputTokens = cacheTelemetry.cacheTelemetryReported
    ? cacheTelemetry.cachedInputTokens
    : 0;
  const totalTokens =
    typeof meta.totalTokenCount === 'number' && meta.totalTokenCount > 0
      ? meta.totalTokenCount
      : promptTokens + outputTokens + reasoningTokens;

  const modelMismatch = evaluateModelMismatch({
    requestedModel: requestedGoogleModel,
    actualModel: resolvedModel,
    taskRole: params.taskRole,
    haltOnAuthorDowngrade: params.haltOnAuthorDowngrade,
  });

  return {
    text,
    modelUsed: resolvedModel,
    requestedModel: requestedGoogleModel,
    finishReason: googleFinishReason,
    isTruncated: isTruncatedFinishReason(googleFinishReason),
    modelMismatch,
    cacheTelemetryReported: cacheTelemetry.cacheTelemetryReported,
    cacheCreationInputTokens: 0,
    reasoningTokens,
    rawGoogleResponse: response,
    keySourceUsed,
    usageDelta: {
      promptTokens,
      outputTokens,
      thinkingTokens: reasoningTokens,
      totalTokens,
      cachedInputTokens,
      savedTokensByOptimization: (params.savedTokensByOptimization || 0) + cachedInputTokens,
      requestCount: 1,
      groundingCallCount: params.usageFlags?.isGrounding ? 1 : 0,
      deepReviewCount: params.usageFlags?.isDeepReview ? 1 : 0,
      chatCallCount: params.usageFlags?.isChat ? 1 : 0,
      modelUsed: resolvedModel,
    },
  };
}

function parseOptionalHeaderInt(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const val = headers.get(name);
    if (val !== null) {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) return Math.round(n);
    }
  }
  return null;
}

/**
 * Probes a single concrete key/provider pair in real time.
 */
export async function probeProviderQuotaLive(params: {
  provider: ResolvedServerAiProvider;
  googleModel: string;
}): Promise<ProviderProbeSnapshot> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const meta = AI_PROVIDER_METADATA[params.provider.provider];

  if (params.provider.validationError) {
    return {
      status: 'unconfigured',
      hasQuota: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      provider: params.provider.provider,
      keySource: params.provider.keySource,
      modelChecked:
        params.provider.provider === 'google_aistudio'
          ? normalizeGoogleModelId(params.googleModel)
          : params.provider.customModelId || meta.defaultModelId,
      baseUrlUsed: params.provider.baseUrl || meta.defaultBaseUrl,
      statusLabelFa: 'تنظیمات ناقص',
      detailFa: params.provider.validationError,
    };
  }

  // Non-Google providers: OpenAI, Anthropic, Custom OpenAI-compatible
  if (isNonGoogleProvider(params.provider)) {
    if (!params.provider.apiKey) {
      return {
        status: 'unconfigured',
        hasQuota: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        provider: params.provider.provider,
        keySource: params.provider.keySource,
        modelChecked: params.provider.customModelId || meta.defaultModelId,
        baseUrlUsed: params.provider.baseUrl,
        statusLabelFa:
          params.provider.keySource === 'creator'
            ? `سهمیه سازنده برای ${meta.shortName} تنظیم نشده`
            : 'کلید شخصی وارد نشده',
        detailFa:
          params.provider.keySource === 'creator'
            ? `کلید سازنده برای ${meta.shortName} فعال نیست؛ کلید اختصاصی خود را وارد کنید تا اتصال برقرار شود.`
            : `لطفاً کلید API اختصاصی ${meta.shortName} را وارد کنید.`,
      };
    }

    try {
      const res =
        params.provider.provider === 'anthropic'
          ? await callAnthropicMessages({
              provider: params.provider,
              messages: [{ role: 'user', content: 'ok' }],
              maxTokens: 8,
              timeoutMs: 15_000,
            })
          : await callCustomOpenAiChat({
              provider: params.provider,
              messages: [{ role: 'user', content: 'ok' }],
              maxTokens: 4,
              timeoutMs: 15_000,
            });

      const remReq = parseOptionalHeaderInt(res.headers, [
        'x-ratelimit-remaining-requests',
        'anthropic-ratelimit-requests-remaining',
        'ratelimit-remaining',
      ]);
      const remTok = parseOptionalHeaderInt(res.headers, [
        'x-ratelimit-remaining-tokens',
        'anthropic-ratelimit-tokens-remaining',
      ]);
      const resetHint =
        res.headers.get('x-ratelimit-reset-requests') ||
        res.headers.get('anthropic-ratelimit-requests-reset') ||
        res.headers.get('x-ratelimit-reset-tokens') ||
        null;

      if (params.provider.keySource === 'creator') {
        markCreatorHealth(params.provider.provider, true);
      }

      return {
        status: 'available',
        hasQuota: true,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        provider: params.provider.provider,
        keySource: params.provider.keySource,
        modelChecked: params.provider.customModelId || meta.defaultModelId,
        resolvedApiModel: res.modelUsed,
        baseUrlUsed: params.provider.baseUrl,
        statusLabelFa: 'متصل و دارای سهمیه فعال',
        detailFa: `استعلام زنده از ${meta.shortName} موفقیت‌آمیز بود (${Date.now() - startedAt} میلی‌ثانیه).`,
        rateLimitRemainingRequests: remReq,
        rateLimitRemainingTokens: remTok,
        rateLimitResetHint: resetHint,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const friendly = formatFriendlyProviderErrorFa(err, meta.shortName, params.provider.keySource);
      if (params.provider.keySource === 'creator' && !friendly.isTransientBusy) {
        markCreatorHealth(params.provider.provider, false);
      }
      return {
        status: friendly.status,
        hasQuota: false,
        checkedAt,
        latencyMs,
        provider: params.provider.provider,
        keySource: params.provider.keySource,
        modelChecked: params.provider.customModelId || meta.defaultModelId,
        baseUrlUsed: params.provider.baseUrl,
        statusLabelFa: friendly.statusLabelFa,
        detailFa: friendly.detailFa,
      };
    }
  }

  // Google AI Studio live probe (supports optional custom HTTPS Base URL)
  const requestedModel = normalizeGoogleModelId(params.googleModel);
  if (params.provider.hasCustomGeminiBaseUrl && params.provider.baseUrl) {
    try {
      await assertPublicDestinationHost(params.provider.baseUrl);
    } catch (err) {
      return {
        status: 'error',
        hasQuota: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        provider: 'google_aistudio',
        keySource: params.provider.keySource,
        modelChecked: requestedModel,
        baseUrlUsed: params.provider.baseUrl,
        statusLabelFa: 'آدرس Base URL نامعتبر',
        detailFa: err instanceof Error ? err.message : 'آدرس Base URL معتبر نیست.',
      };
    }
  }

  const ai = createGoogleGenAiClient(
    params.provider.apiKey,
    params.provider.hasCustomGeminiBaseUrl ? params.provider.baseUrl : undefined
  );
  if (!ai) {
    return {
      status: 'unconfigured',
      hasQuota: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      provider: 'google_aistudio',
      keySource: params.provider.keySource,
      modelChecked: requestedModel,
      baseUrlUsed: params.provider.baseUrl,
      statusLabelFa:
        params.provider.keySource === 'creator'
          ? 'کلید سازنده تنظیم نشده'
          : 'کلید شخصی وارد نشده',
      detailFa:
        params.provider.keySource === 'creator'
          ? 'سهمیه سازنده اپلیکیشن در سرور فعال نیست. با وارد کردن کلید شخصی خود می‌توانید فوراً ادامه دهید.'
          : 'لطفاً کلید شخصی Google AI Studio خود را وارد کنید.',
    };
  }

  try {
    const probeTimeoutMs = 10_000;
    const { resolvedModel } = await Promise.race([
      generateGoogleContentResilient({
        ai,
        model: requestedModel,
        contents: 'ok',
        config: {
          maxOutputTokens: 4,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('503 UNAVAILABLE: This model is currently experiencing high demand.')),
          probeTimeoutMs
        )
      ),
    ]);

    const latencyMs = Date.now() - startedAt;
    if (params.provider.keySource === 'creator') {
      markCreatorHealth('google_aistudio', true);
    }
    const keyDesc =
      params.provider.keySource === 'creator' ? 'کلید سازنده اپلیکیشن' : 'کلید اختصاصی شما';
    const fellBackToFlash =
      requestedModel === 'gemini-4-hydrogen' && resolvedModel === 'gemini-3.8-flash';

    return {
      status: 'available',
      hasQuota: true,
      checkedAt,
      latencyMs,
      provider: 'google_aistudio',
      keySource: params.provider.keySource,
      modelChecked: requestedModel,
      resolvedApiModel: resolvedModel,
      baseUrlUsed: params.provider.baseUrl,
      statusLabelFa: 'فعال و دارای سهمیه آماده',
      detailFa: fellBackToFlash
        ? `مدل هیدروژن ۴ در این لحظه شلوغ بود؛ اتصال زنده ${keyDesc} روی فلش ۳.۸ با موفقیت تأیید شد (${latencyMs} میلی‌ثانیه).`
        : `استعلام زنده ${keyDesc} موفقیت‌آمیز بود و آماده پردازش است (${latencyMs} میلی‌ثانیه).`,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const friendly = formatFriendlyProviderErrorFa(err, 'Gemini', params.provider.keySource);
    if (params.provider.keySource === 'creator' && !friendly.isTransientBusy) {
      markCreatorHealth('google_aistudio', false);
    }
    return {
      status: friendly.status,
      hasQuota: false,
      checkedAt,
      latencyMs,
      provider: 'google_aistudio',
      keySource: params.provider.keySource,
      modelChecked: requestedModel,
      baseUrlUsed: params.provider.baseUrl,
      statusLabelFa: friendly.statusLabelFa,
      detailFa: friendly.detailFa,
    };
  }
}

/**
 * Full Creator-First -> Automatic Personal Fallback live probe flow:
 * 1. Probes App Owner's quota for the requested provider (always reports real owner status).
 * 2. Evaluates resolveEffectiveAuthStrategy(keyMode, creatorConfigured, creatorHasQuota, personalProvided).
 * 3. If decision selects 'personal' (either user explicitly selected personal OR App Owner is exhausted/unconfigured and user provided a personal key),
 *    runs live probe against user's personal key + Base URL and marks switchedFromCreator accurately.
 */
export async function probeProviderWithCreatorFallback(params: {
  provider: ResolvedServerAiProvider;
  googleModel: string;
}): Promise<{
  activeProbe: ProviderProbeSnapshot;
  creatorKeyProbe: ProviderProbeSnapshot;
  authDecision: AuthStrategyDecision;
}> {
  const creatorCandidate = createCreatorProviderFor(params.provider.provider);
  const creatorKeyProbe = await probeProviderQuotaLive({
    provider: creatorCandidate,
    googleModel: params.googleModel,
  });

  const decision = resolveEffectiveAuthStrategy({
    keyMode: params.provider.googleKeyMode,
    creatorKeyConfigured: Boolean(creatorCandidate.creatorApiKey),
    creatorHasQuota: creatorKeyProbe.hasQuota,
    personalKeyProvided: Boolean(params.provider.personalApiKey),
  });

  if (decision.selectedKeySource === 'creator') {
    return {
      activeProbe: {
        ...creatorKeyProbe,
        switchedFromCreator: false,
      },
      creatorKeyProbe,
      authDecision: decision,
    };
  }

  if (decision.selectedKeySource === 'personal') {
    const personalCandidate: ResolvedServerAiProvider = {
      ...params.provider,
      apiKey: params.provider.personalApiKey,
      keySource: params.provider.provider === 'custom_openai' ? 'custom' : 'personal',
      validationError: undefined,
    };
    const personalProbe = await probeProviderQuotaLive({
      provider: personalCandidate,
      googleModel: params.googleModel,
    });
    return {
      activeProbe: {
        ...personalProbe,
        switchedFromCreator: decision.switchedFromCreator,
        detailFa: decision.switchedFromCreator
          ? `سوئیچ خودکار از سهمیه سازنده به کلید اختصاصی شما انجام شد · ${personalProbe.detailFa}`
          : personalProbe.detailFa,
      },
      creatorKeyProbe,
      authDecision: decision,
    };
  }

  // Neither App Owner nor personal key is usable
  const unreadyProbe: ProviderProbeSnapshot = {
    ...creatorKeyProbe,
    hasQuota: false,
    switchedFromCreator: false,
    detailFa: creatorKeyProbe.status === 'busy' ? creatorKeyProbe.detailFa : decision.reasonFa,
  };
  return {
    activeProbe: unreadyProbe,
    creatorKeyProbe,
    authDecision: decision,
  };
}

// =============================================================================
// SLOT 2: UNIFIED MULTI-PROVIDER WEB SEARCH (Gemini / Perplexity / Anthropic / OpenAI)
// =============================================================================

export interface ResolvedWebSearchRoute {
  provider: WebSearchProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export function resolveWebSearchRouteFromRequest(req: Request): ResolvedWebSearchRoute {
  const provider = normalizeWebSearchProviderType(readHeaderString(req, 'x-ai-search-provider'));
  const meta = WEB_SEARCH_PROVIDER_METADATA[provider];
  const rawBaseUrl = readHeaderString(req, 'x-ai-search-base-url') || meta.defaultBaseUrl;
  const apiKey = readHeaderString(req, 'x-ai-search-api-key');
  const rawModel = readHeaderString(req, 'x-ai-search-model');
  return {
    provider,
    baseUrl: rawBaseUrl.replace(/\/+$/, ''),
    apiKey,
    modelId: sanitizeCustomModelId(rawModel) || meta.defaultModelId,
  };
}

export interface UnifiedWebSearchResult {
  summary: string;
  sources: WebGroundingSource[];
  modelUsed: string;
  providerLabelFa: string;
  usageDelta: AiUsageDelta;
}

function extractGoogleGroundingSources(response: unknown): WebGroundingSource[] {
  const sources: WebGroundingSource[] = [];
  const seen = new Set<string>();
  const resp = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
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

function extractUrlsFallbackFromText(text: string): WebGroundingSource[] {
  const matches = text.match(/https:\/\/[^\s)\]>"]+/g) || [];
  const seen = new Set<string>();
  const out: WebGroundingSource[] = [];
  for (const raw of matches) {
    const uri = raw.replace(/[.,;،]+$/, '');
    if (seen.has(uri)) continue;
    seen.add(uri);
    try {
      const host = new URL(uri).hostname.replace(/^www\./, '');
      out.push({ title: host, uri });
    } catch {
      // skip malformed URL
    }
    if (out.length >= 8) break;
  }
  return out;
}

export async function executeUnifiedWebSearch(params: {
  primaryProvider: ResolvedServerAiProvider;
  searchRoute: ResolvedWebSearchRoute;
  googleModel: string;
  prompt: string;
  systemInstruction?: string;
  thinkingLevel?: ThinkingLevel;
}): Promise<UnifiedWebSearchResult> {
  let effectiveProvider: Exclude<WebSearchProviderType, 'same_as_primary'>;
  if (params.searchRoute.provider === 'same_as_primary') {
    if (params.primaryProvider.provider === 'anthropic') {
      effectiveProvider = 'anthropic_web_search';
    } else {
      effectiveProvider = 'google_gemini_search';
    }
  } else {
    effectiveProvider = params.searchRoute.provider;
  }

  // 1. GOOGLE GEMINI SEARCH (works even when primary model is Claude Opus or OpenAI!)
  if (effectiveProvider === 'google_gemini_search') {
    const creatorGeminiKey = getCreatorKeyForProvider('google_aistudio');
    const explicitKey =
      params.searchRoute.apiKey ||
      (params.primaryProvider.provider === 'google_aistudio'
        ? params.primaryProvider.personalApiKey
        : '');
    const geminiBaseUrl =
      params.searchRoute.provider === 'google_gemini_search' && params.searchRoute.baseUrl
        ? params.searchRoute.baseUrl
        : params.primaryProvider.provider === 'google_aistudio'
          ? params.primaryProvider.baseUrl
          : AI_PROVIDER_METADATA.google_aistudio.defaultBaseUrl;
    const defaultGeminiBase = AI_PROVIDER_METADATA.google_aistudio.defaultBaseUrl;

    const searchGeminiProvider: ResolvedServerAiProvider = {
      provider: 'google_aistudio',
      googleKeyMode:
        params.searchRoute.apiKey && params.searchRoute.provider === 'google_gemini_search'
          ? 'personal'
          : params.primaryProvider.provider === 'google_aistudio'
            ? params.primaryProvider.googleKeyMode
            : 'auto_creator_first',
      apiKey:
        params.searchRoute.apiKey ||
        (params.primaryProvider.provider === 'google_aistudio'
          ? params.primaryProvider.apiKey
          : creatorGeminiKey),
      creatorApiKey: creatorGeminiKey,
      personalApiKey: explicitKey,
      keySource:
        params.searchRoute.apiKey && params.searchRoute.provider === 'google_gemini_search'
          ? 'personal'
          : creatorGeminiKey
            ? 'creator'
            : 'personal',
      baseUrl: geminiBaseUrl,
      hasCustomGeminiBaseUrl: geminiBaseUrl.replace(/\/+$/, '') !== defaultGeminiBase,
      customModelId: '',
    };

    const targetGoogleModel = normalizeGoogleModelId(
      params.searchRoute.provider === 'google_gemini_search'
        ? params.searchRoute.modelId
        : params.googleModel
    );

    const { result } = await executeWithGoogleClientFallback(searchGeminiProvider, (ai) =>
      generateGoogleContentResilient({
        ai,
        model: targetGoogleModel,
        contents: params.prompt,
        config: {
          ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
          tools: [{ googleSearch: {} }],
          thinkingConfig: {
            thinkingLevel: resolveThinkingLevelForGoogleModel(
              targetGoogleModel,
              params.thinkingLevel ?? ThinkingLevel.LOW
            ),
          },
        },
      })
    );

    const summary = (result.response.text || '').trim();
    const sources = extractGoogleGroundingSources(result.response);
    const meta = result.response.usageMetadata;
    const promptTokens = meta?.promptTokenCount || Math.ceil(params.prompt.length / 3);
    const outputTokens = meta?.candidatesTokenCount || Math.ceil(summary.length / 3);
    const thinkingTokens = meta?.thoughtsTokenCount || 0;

    return {
      summary: summary || 'نتیجه‌ای از جستجوی وب دریافت نشد.',
      sources,
      modelUsed: result.resolvedModel,
      providerLabelFa: 'Google Gemini Search',
      usageDelta: {
        promptTokens,
        outputTokens,
        thinkingTokens,
        totalTokens: meta?.totalTokenCount || promptTokens + outputTokens + thinkingTokens,
        requestCount: 1,
        groundingCallCount: 1,
        deepReviewCount: 0,
        chatCallCount: 0,
        modelUsed: result.resolvedModel,
      },
    };
  }

  // 2. ANTHROPIC NATIVE WEB SEARCH (web_search_20250305)
  if (effectiveProvider === 'anthropic_web_search') {
    const apiKey =
      params.searchRoute.apiKey ||
      (params.primaryProvider.provider === 'anthropic' ? params.primaryProvider.apiKey : '') ||
      getCreatorKeyForProvider('anthropic');
    const baseUrl =
      (params.searchRoute.provider === 'anthropic_web_search' && params.searchRoute.baseUrl) ||
      (params.primaryProvider.provider === 'anthropic' && params.primaryProvider.baseUrl) ||
      WEB_SEARCH_PROVIDER_METADATA.anthropic_web_search.defaultBaseUrl;
    const modelId =
      (params.searchRoute.provider === 'anthropic_web_search' && params.searchRoute.modelId) ||
      (params.primaryProvider.provider === 'anthropic' && params.primaryProvider.customModelId) ||
      WEB_SEARCH_PROVIDER_METADATA.anthropic_web_search.defaultModelId;

    if (!apiKey) {
      throw new Error(
        'برای جستجوی بومی Anthropic Web Search، لطفاً کلید API کلاد (Anthropic) را در تب «جستجوی زنده اینترنت» یا تب «مدل اصلی» وارد کنید.'
      );
    }

    const urlCheck = validateCustomBaseUrl(baseUrl);
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      throw new Error(urlCheck.error || 'آدرس Base URL برای Anthropic Web Search نامعتبر است.');
    }
    await assertPublicDestinationHost(urlCheck.normalizedUrl);

    const endpoint = urlCheck.normalizedUrl.endsWith('/messages')
      ? urlCheck.normalizedUrl
      : `${urlCheck.normalizedUrl}/messages`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 2048,
          ...(params.systemInstruction ? { system: params.systemInstruction } : {}),
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 5,
            },
          ],
          messages: [{ role: 'user', content: params.prompt }],
        }),
      });

      const rawText = await res.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        const friendly = formatFriendlyProviderErrorFa(rawText || res.statusText, 'Anthropic Search');
        const err = new Error(friendly.detailFa) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const blocks = Array.isArray(parsed?.content)
        ? (parsed.content as Array<Record<string, unknown>>)
        : [];
      const textParts: string[] = [];
      const sources: WebGroundingSource[] = [];
      const seen = new Set<string>();

      for (const blk of blocks) {
        if (blk.type === 'text' && typeof blk.text === 'string') {
          textParts.push(blk.text);
          const citations = Array.isArray(blk.citations)
            ? (blk.citations as Array<{ url?: string; title?: string }>)
            : [];
          for (const c of citations) {
            const uri = (c?.url || '').trim();
            if (uri && !seen.has(uri)) {
              seen.add(uri);
              sources.push({ title: (c?.title || uri).trim(), uri });
            }
          }
        } else if (blk.type === 'web_search_tool_result' && Array.isArray(blk.content)) {
          for (const item of blk.content as Array<{ url?: string; title?: string }>) {
            const uri = (item?.url || '').trim();
            if (uri && !seen.has(uri)) {
              seen.add(uri);
              sources.push({ title: (item?.title || uri).trim(), uri });
            }
          }
        }
      }

      const summary = textParts.join('\n').trim();
      const usageObj = (parsed?.usage || {}) as { input_tokens?: number; output_tokens?: number };
      const promptTokens = Number(usageObj.input_tokens) || Math.ceil(params.prompt.length / 3);
      const outputTokens = Number(usageObj.output_tokens) || Math.ceil(summary.length / 3);

      return {
        summary: summary || 'نتیجه‌ای از جستجوی کلاد دریافت نشد.',
        sources: sources.length > 0 ? sources : extractUrlsFallbackFromText(summary),
        modelUsed: String(parsed?.model || modelId),
        providerLabelFa: 'Anthropic Claude Web Search',
        usageDelta: {
          promptTokens,
          outputTokens,
          thinkingTokens: 0,
          totalTokens: promptTokens + outputTokens,
          requestCount: 1,
          groundingCallCount: 1,
          deepReviewCount: 0,
          chatCallCount: 0,
          modelUsed: String(parsed?.model || modelId),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // 3. PERPLEXITY SONAR OR OPENAI / OPENROUTER ONLINE SEARCH
  const isPerplexity = effectiveProvider === 'perplexity_sonar';
  const meta = WEB_SEARCH_PROVIDER_METADATA[effectiveProvider];
  const apiKey =
    params.searchRoute.apiKey ||
    (!isPerplexity &&
    (params.primaryProvider.provider === 'openai' ||
      params.primaryProvider.provider === 'custom_openai')
      ? params.primaryProvider.apiKey
      : '');
  const baseUrl = params.searchRoute.baseUrl || meta.defaultBaseUrl;
  const modelId = params.searchRoute.modelId || meta.defaultModelId;

  if (!apiKey) {
    throw new Error(
      `برای اجرای جستجوی وب با ${meta.shortName}، لطفاً کلید API آن را در تب «جستجوی زنده اینترنت» وارد کنید.`
    );
  }

  const urlCheck = validateCustomBaseUrl(baseUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    throw new Error(urlCheck.error || `آدرس Base URL برای ${meta.shortName} نامعتبر است.`);
  }
  await assertPublicDestinationHost(urlCheck.normalizedUrl);

  const endpoint = urlCheck.normalizedUrl.endsWith('/chat/completions')
    ? urlCheck.normalizedUrl
    : `${urlCheck.normalizedUrl}/chat/completions`;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (params.systemInstruction) {
    messages.push({ role: 'system', content: params.systemInstruction });
  }
  messages.push({ role: 'user', content: params.prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
      }),
    });

    const rawText = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const friendly = formatFriendlyProviderErrorFa(rawText || res.statusText, meta.shortName);
      const err = new Error(friendly.detailFa) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
    const first = choices[0] as
      | {
          message?: {
            content?: string;
            annotations?: Array<{
              type?: string;
              url_citation?: { url?: string; title?: string };
              url?: string;
              title?: string;
            }>;
          };
        }
      | undefined;
    const summary = String(first?.message?.content || '').trim();

    const sources: WebGroundingSource[] = [];
    const seen = new Set<string>();
    const pushSource = (uri?: string, title?: string) => {
      const cleanUri = String(uri || '').trim();
      if (!cleanUri || seen.has(cleanUri)) return;
      seen.add(cleanUri);
      let label = String(title || '').trim();
      if (!label) {
        try {
          label = new URL(cleanUri).hostname.replace(/^www\./, '');
        } catch {
          label = cleanUri;
        }
      }
      sources.push({ title: label, uri: cleanUri });
    };

    // Perplexity returns top-level `citations: string[]` and optional `search_results`
    if (Array.isArray(parsed?.search_results)) {
      for (const item of parsed.search_results as Array<{ url?: string; title?: string }>) {
        pushSource(item?.url, item?.title);
      }
    }
    if (Array.isArray(parsed?.citations)) {
      for (const c of parsed.citations) {
        if (typeof c === 'string') pushSource(c);
        else if (c && typeof c === 'object') {
          const obj = c as { url?: string; title?: string };
          pushSource(obj.url, obj.title);
        }
      }
    }
    // OpenAI Search & OpenRouter Online return `message.annotations`
    if (Array.isArray(first?.message?.annotations)) {
      for (const ann of first.message.annotations) {
        pushSource(ann?.url_citation?.url || ann?.url, ann?.url_citation?.title || ann?.title);
      }
    }

    const usageObj = (parsed?.usage || {}) as {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    const promptTokens = Number(usageObj.prompt_tokens) || Math.ceil(params.prompt.length / 3);
    const outputTokens = Number(usageObj.completion_tokens) || Math.ceil(summary.length / 3);

    return {
      summary: summary || `نتیجه‌ای از ${meta.shortName} دریافت نشد.`,
      sources: sources.length > 0 ? sources : extractUrlsFallbackFromText(summary),
      modelUsed: String(parsed?.model || modelId),
      providerLabelFa: meta.shortName,
      usageDelta: {
        promptTokens,
        outputTokens,
        thinkingTokens: 0,
        totalTokens: Number(usageObj.total_tokens) || promptTokens + outputTokens,
        requestCount: 1,
        groundingCallCount: 1,
        deepReviewCount: 0,
        chatCallCount: 0,
        modelUsed: String(parsed?.model || modelId),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// SLOT 3: UNIFIED AUDIO/VOICE-TO-TEXT TRANSCRIPTION (Gemini / OpenAI / Groq / Custom Whisper)
// =============================================================================

export interface ResolvedAudioRoute {
  provider: AudioTranscribeProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export function resolveAudioRouteFromRequest(req: Request): ResolvedAudioRoute {
  const provider = normalizeAudioProviderType(readHeaderString(req, 'x-ai-audio-provider'));
  const meta = AUDIO_TRANSCRIBE_PROVIDER_METADATA[provider];
  const rawBaseUrl = readHeaderString(req, 'x-ai-audio-base-url') || meta.defaultBaseUrl;
  const apiKey = readHeaderString(req, 'x-ai-audio-api-key');
  const rawModel = readHeaderString(req, 'x-ai-audio-model');
  return {
    provider,
    baseUrl: rawBaseUrl.replace(/\/+$/, ''),
    apiKey,
    modelId: sanitizeCustomModelId(rawModel) || meta.defaultModelId,
  };
}

export interface UnifiedAudioTranscriptionResult {
  transcript: string;
  modelUsed: string;
  providerLabelFa: string;
  usageDelta: AiUsageDelta;
}

const PERSIAN_ECU_STT_PROMPT =
  'این فایل صوتی آموزشی/کارگاهی به زبان فارسی درباره کالیبراسیون و ریمپ ایسیو (ECU) خودرو و نرم‌افزار WinOLS است. متن کامل گفتار را با دقت بالا، نگارش صحیح فارسی، حفظ دقیق اعداد و اصطلاحات فنی انگلیسی (مانند WinOLS، ECU، Bosch ME7.4.4، Siemens، Sagem، KFZW، LAMFA، AFR، Lambda، RPM، Load، Hex، DTC، Checksum، DamOS، A2L) بدون حذف هیچ نکته‌ای پیاده‌سازی کن. فقط متن پیاده‌سازی‌شده و خوانا را بنویس.';

const WHISPER_GLOSSARY_HINT =
  'ریمپ ایسیو، WinOLS، ECU، Bosch ME7.4.4، Siemens، LAMFA، KFZW، AFR، RPM، Lambda، Checksum، DamOS، ناک، آوانس جرقه، کالیبراسیون';

export async function transcribeAudioUnified(params: {
  audioRoute: ResolvedAudioRoute;
  primaryProvider: ResolvedServerAiProvider;
  audioBase64: string;
  mimeType: string;
  fileName: string;
}): Promise<UnifiedAudioTranscriptionResult> {
  const meta = AUDIO_TRANSCRIBE_PROVIDER_METADATA[params.audioRoute.provider];

  // 1. GOOGLE GEMINI AUDIO TRANSCRIPTION (gemini-3.5-transcribe with fallback to gemini-4-hydrogen / gemini-3.8-flash)
  if (params.audioRoute.provider === 'google_gemini_audio') {
    const creatorGeminiKey = getCreatorKeyForProvider('google_aistudio');
    const explicitKey =
      params.audioRoute.apiKey ||
      (params.primaryProvider.provider === 'google_aistudio'
        ? params.primaryProvider.personalApiKey
        : '');
    const defaultGeminiBase = AI_PROVIDER_METADATA.google_aistudio.defaultBaseUrl;
    const baseUrl = params.audioRoute.baseUrl || defaultGeminiBase;

    const audioGeminiProvider: ResolvedServerAiProvider = {
      provider: 'google_aistudio',
      googleKeyMode: params.audioRoute.apiKey ? 'personal' : 'auto_creator_first',
      apiKey:
        params.audioRoute.apiKey ||
        (params.primaryProvider.provider === 'google_aistudio'
          ? params.primaryProvider.apiKey
          : creatorGeminiKey),
      creatorApiKey: creatorGeminiKey,
      personalApiKey: explicitKey,
      keySource: params.audioRoute.apiKey ? 'personal' : creatorGeminiKey ? 'creator' : 'personal',
      baseUrl,
      hasCustomGeminiBaseUrl: baseUrl.replace(/\/+$/, '') !== defaultGeminiBase,
      customModelId: '',
    };

    const preferredModel = params.audioRoute.modelId || 'gemini-3.5-transcribe';
    const candidateModels = Array.from(
      new Set([preferredModel, 'gemini-3.5-transcribe', 'gemini-4-hydrogen', 'gemini-3.8-flash'])
    );

    const { result } = await executeWithGoogleClientFallback(audioGeminiProvider, async (ai) => {
      let lastErr: unknown = null;
      for (const candidate of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: candidate,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: params.mimeType,
                      data: params.audioBase64,
                    },
                  },
                  { text: PERSIAN_ECU_STT_PROMPT },
                ],
              },
            ] as never,
          });
          return { response, resolvedModel: candidate };
        } catch (err) {
          lastErr = err;
          if (isNotFoundError(err) || isTransientBusyError(err)) {
            continue;
          }
          throw err;
        }
      }
      throw lastErr || new Error('تبدیل فایل صوتی با Gemini ناموفق بود.');
    });

    const transcript = (result.response.text || '').trim();
    if (!transcript) {
      throw new Error('متنی در فایل صوتی تشخیص داده نشد. لطفاً کیفیت صدا را بررسی کنید.');
    }

    const usageMeta = result.response.usageMetadata;
    const promptTokens = usageMeta?.promptTokenCount || 500;
    const outputTokens = usageMeta?.candidatesTokenCount || Math.ceil(transcript.length / 3);

    return {
      transcript,
      modelUsed: result.resolvedModel,
      providerLabelFa: meta.shortName,
      usageDelta: {
        promptTokens,
        outputTokens,
        thinkingTokens: 0,
        totalTokens: usageMeta?.totalTokenCount || promptTokens + outputTokens,
        requestCount: 1,
        groundingCallCount: 0,
        deepReviewCount: 0,
        chatCallCount: 0,
        modelUsed: result.resolvedModel,
      },
    };
  }

  // 2. OPENAI WHISPER / GROQ WHISPER / CUSTOM WHISPER (/audio/transcriptions multipart/form-data)
  const apiKey =
    params.audioRoute.apiKey ||
    (params.audioRoute.provider === 'openai_whisper' &&
    params.primaryProvider.provider === 'openai'
      ? params.primaryProvider.apiKey
      : '') ||
    (params.audioRoute.provider === 'openai_whisper' ? getCreatorKeyForProvider('openai') : '');

  if (!apiKey) {
    throw new Error(
      `برای تبدیل ویس با ${meta.shortName}، لطفاً کلید API آن را در تب «تبدیل ویس به متن» داخل تنظیمات ارائه‌دهنده وارد کنید.`
    );
  }

  const baseUrl = params.audioRoute.baseUrl || meta.defaultBaseUrl;
  const urlCheck = validateCustomBaseUrl(baseUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    throw new Error(urlCheck.error || `آدرس Base URL برای ${meta.shortName} نامعتبر است.`);
  }
  await assertPublicDestinationHost(urlCheck.normalizedUrl);

  const endpoint = urlCheck.normalizedUrl.endsWith('/audio/transcriptions')
    ? urlCheck.normalizedUrl
    : `${urlCheck.normalizedUrl}/audio/transcriptions`;

  const audioBuffer = Buffer.from(params.audioBase64, 'base64');
  const form = new FormData();
  const safeName = params.fileName.replace(/[^\w.\-\u0600-\u06FF]/g, '_') || 'voice.mp3';
  form.append('file', new Blob([audioBuffer], { type: params.mimeType }), safeName);
  form.append('model', params.audioRoute.modelId || meta.defaultModelId);
  form.append('language', 'fa');
  form.append('prompt', WHISPER_GLOSSARY_HINT);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const rawText = await res.text();
    if (!res.ok) {
      const friendly = formatFriendlyProviderErrorFa(rawText || res.statusText, meta.shortName);
      const err = new Error(friendly.detailFa) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    let transcript = '';
    try {
      const parsed = JSON.parse(rawText) as { text?: string };
      transcript = String(parsed?.text || '').trim();
    } catch {
      transcript = rawText.trim();
    }

    if (!transcript) {
      throw new Error('متنی از فایل صوتی استخراج نشد.');
    }

    const outputTokens = Math.ceil(transcript.length / 3);
    return {
      transcript,
      modelUsed: params.audioRoute.modelId || meta.defaultModelId,
      providerLabelFa: meta.shortName,
      usageDelta: {
        promptTokens: Math.max(150, Math.round(audioBuffer.byteLength / 1024)),
        outputTokens,
        thinkingTokens: 0,
        totalTokens: Math.max(150, Math.round(audioBuffer.byteLength / 1024)) + outputTokens,
        requestCount: 1,
        groundingCallCount: 0,
        deepReviewCount: 0,
        chatCallCount: 0,
        modelUsed: params.audioRoute.modelId || meta.defaultModelId,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
