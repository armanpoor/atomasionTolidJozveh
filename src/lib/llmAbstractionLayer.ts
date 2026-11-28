/**
 * Modular Two-Phase Provider-Agnostic LLM Abstraction Layer
 *
 * Phase 1 (`phase1_stability_lock`, DEFAULT):
 *   - Strictly locks ALL inference calls onto the built-in platform quota (`google_aistudio` + `gemini-4-neon`).
 *   - HARD GUARD: Never forwards or consumes any external Google AI Studio API Key (`personalGoogleApiKey` /
 *     `X-AI-Api-Key`), third-party provider key, or multi-tier external override until the owner confirms
 *     system stability and switches to Phase 2.
 *
 * Phase 2 (`phase2_open_multi_provider`):
 *   - Unlocks the full Provider-Agnostic Adapter Registry so any user can connect ANY AI model, ANY provider
 *     (Google, OpenAI, Anthropic, Iranian/international OpenAI-compatible gateways, or custom HTTPS endpoints),
 *     and ANY custom authentication header/profile without modifying core pipeline logic.
 */

export type AiDeploymentPhase = 'phase1_stability_lock' | 'phase2_open_multi_provider';

export type LlmWireProtocol = 'google_gemini' | 'openai_compatible' | 'anthropic_messages';

export type LlmAuthScheme = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'custom_header';

export interface LlmProviderAdapter {
  readonly id: string;
  readonly displayNameFa: string;
  readonly protocol: LlmWireProtocol;
  readonly defaultBaseUrl: string;
  readonly defaultModelId: string;
  readonly authScheme: LlmAuthScheme;
  readonly customAuthHeaderName?: string;
  readonly supportsLiveModelDiscovery: boolean;
  readonly supportsWebSearch: boolean;
  readonly isBuiltIn: boolean;
  buildAuthHeaders(apiKey: string, extraHeaders?: Record<string, string>): Record<string, string>;
  resolveChatEndpoint(baseUrl?: string): string;
}

export interface RegisterCustomLlmAdapterInput {
  id: string;
  displayNameFa: string;
  protocol?: LlmWireProtocol;
  defaultBaseUrl: string;
  defaultModelId: string;
  authScheme?: LlmAuthScheme;
  customAuthHeaderName?: string;
  supportsLiveModelDiscovery?: boolean;
  supportsWebSearch?: boolean;
}

export const PHASE1_LOCKED_PROVIDER = 'google_aistudio' as const;
export const PHASE1_LOCKED_MODEL = 'gemini-4-neon' as const;
export const PHASE1_LOCKED_BASE_URL = 'https://generativelanguage.googleapis.com' as const;

export function normalizeAiDeploymentPhase(raw?: string | null): AiDeploymentPhase {
  return raw === 'phase2_open_multi_provider'
    ? 'phase2_open_multi_provider'
    : 'phase1_stability_lock';
}

export function isPhase1StabilityLocked(phase?: AiDeploymentPhase | string | null): boolean {
  return normalizeAiDeploymentPhase(phase) === 'phase1_stability_lock';
}

function buildStandardAdapter(input: {
  id: string;
  displayNameFa: string;
  protocol: LlmWireProtocol;
  defaultBaseUrl: string;
  defaultModelId: string;
  authScheme: LlmAuthScheme;
  customAuthHeaderName?: string;
  supportsLiveModelDiscovery: boolean;
  supportsWebSearch: boolean;
  isBuiltIn: boolean;
}): LlmProviderAdapter {
  const cleanDefaultBase = input.defaultBaseUrl.replace(/\/+$/, '');
  return {
    ...input,
    defaultBaseUrl: cleanDefaultBase,
    buildAuthHeaders(apiKey: string, extraHeaders?: Record<string, string>): Record<string, string> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(extraHeaders || {}),
      };
      const trimmedKey = String(apiKey || '').trim();
      if (!trimmedKey) return headers;

      if (input.authScheme === 'x-api-key') {
        headers['x-api-key'] = trimmedKey;
      } else if (input.authScheme === 'x-goog-api-key') {
        headers['x-goog-api-key'] = trimmedKey;
      } else if (input.authScheme === 'custom_header' && input.customAuthHeaderName?.trim()) {
        headers[input.customAuthHeaderName.trim()] = trimmedKey;
      } else {
        headers.Authorization = `Bearer ${trimmedKey}`;
      }
      return headers;
    },
    resolveChatEndpoint(baseUrl?: string): string {
      const base = (baseUrl || cleanDefaultBase).trim().replace(/\/+$/, '');
      if (input.protocol === 'anthropic_messages') {
        return base.endsWith('/messages') ? base : `${base}/messages`;
      }
      if (input.protocol === 'google_gemini') {
        return base;
      }
      return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    },
  };
}

const BUILT_IN_ADAPTERS: readonly LlmProviderAdapter[] = [
  buildStandardAdapter({
    id: 'google_aistudio',
    displayNameFa: 'Google Gemini (سهمیه داخلی پلتفرم / AI Studio)',
    protocol: 'google_gemini',
    defaultBaseUrl: PHASE1_LOCKED_BASE_URL,
    defaultModelId: PHASE1_LOCKED_MODEL,
    authScheme: 'x-goog-api-key',
    supportsLiveModelDiscovery: true,
    supportsWebSearch: true,
    isBuiltIn: true,
  }),
  buildStandardAdapter({
    id: 'openai',
    displayNameFa: 'OpenAI (سازگار با /v1/chat/completions)',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-6.2-sol',
    authScheme: 'bearer',
    supportsLiveModelDiscovery: true,
    supportsWebSearch: false,
    isBuiltIn: true,
  }),
  buildStandardAdapter({
    id: 'anthropic',
    displayNameFa: 'Anthropic Claude (Messages API)',
    protocol: 'anthropic_messages',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-5-5',
    authScheme: 'x-api-key',
    supportsLiveModelDiscovery: true,
    supportsWebSearch: true,
    isBuiltIn: true,
  }),
  buildStandardAdapter({
    id: 'custom_openai',
    displayNameFa: 'درگاه آزاد ایرانی / بین‌المللی (OpenAI-Compatible)',
    protocol: 'openai_compatible',
    defaultBaseUrl: 'https://api.avalai.ir/v1',
    defaultModelId: 'deepseek-v4-pro',
    authScheme: 'bearer',
    supportsLiveModelDiscovery: true,
    supportsWebSearch: false,
    isBuiltIn: true,
  }),
];

const adapterRegistry = new Map<string, LlmProviderAdapter>();
for (const adapter of BUILT_IN_ADAPTERS) {
  adapterRegistry.set(adapter.id, adapter);
}

/**
 * Registers a custom LLM provider adapter dynamically (Phase 2 extensibility)
 * so new providers, custom proxies, or proprietary auth headers can be plugged in
 * without modifying any pipeline or route code.
 */
export function registerCustomLlmAdapter(input: RegisterCustomLlmAdapterInput): LlmProviderAdapter {
  const cleanId = String(input.id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (!cleanId) {
    throw new Error('شناسه ارائه‌دهنده سفارشی معتبر نیست.');
  }
  const adapter = buildStandardAdapter({
    id: cleanId,
    displayNameFa: input.displayNameFa.trim() || cleanId,
    protocol: input.protocol ?? 'openai_compatible',
    defaultBaseUrl: input.defaultBaseUrl.trim(),
    defaultModelId: input.defaultModelId.trim(),
    authScheme: input.authScheme ?? 'bearer',
    customAuthHeaderName: input.customAuthHeaderName?.trim(),
    supportsLiveModelDiscovery: input.supportsLiveModelDiscovery ?? true,
    supportsWebSearch: input.supportsWebSearch ?? false,
    isBuiltIn: false,
  });
  adapterRegistry.set(cleanId, adapter);
  return adapter;
}

export function unregisterCustomLlmAdapter(adapterId: string): boolean {
  const existing = adapterRegistry.get(adapterId);
  if (!existing || existing.isBuiltIn) return false;
  return adapterRegistry.delete(adapterId);
}

export function getLlmProviderAdapter(providerId?: string | null): LlmProviderAdapter {
  const key = String(providerId || '').trim().toLowerCase();
  return adapterRegistry.get(key) ?? adapterRegistry.get('custom_openai') ?? BUILT_IN_ADAPTERS[0];
}

export function listLlmProviderAdapters(): LlmProviderAdapter[] {
  return Array.from(adapterRegistry.values());
}

export interface PhaseEnforcedLlmRoute {
  deploymentPhase: AiDeploymentPhase;
  phaseLocked: boolean;
  providerId: string;
  adapter: LlmProviderAdapter;
  modelId: string;
  baseUrl: string;
  keyMode: 'auto_creator_first' | 'personal';
  /** In Phase 1, ALWAYS empty string so external Google AI Studio / third-party keys are NEVER used */
  externalApiKey: string;
  allowExternalKeyFallback: boolean;
  allowMultiTierExternalRouting: boolean;
  policySummaryFa: string;
}

/**
 * Core Two-Phase Enforcement Gate:
 * - In `phase1_stability_lock`: strips ALL external API keys, blocks personal Google AI Studio API-key
 *   usage, blocks external providers, and locks routing strictly onto built-in `gemini-4-neon` platform quota.
 * - In `phase2_open_multi_provider`: routes cleanly through the requested adapter, Base URL, Model ID,
 *   and user credentials with zero restrictions.
 */
export function resolvePhaseAwareLlmRoute(params: {
  deploymentPhase?: AiDeploymentPhase | string | null;
  requestedProviderId?: string | null;
  requestedModelId?: string | null;
  requestedBaseUrl?: string | null;
  requestedKeyMode?: string | null;
  externalApiKey?: string | null;
}): PhaseEnforcedLlmRoute {
  const phase = normalizeAiDeploymentPhase(params.deploymentPhase);

  if (phase === 'phase1_stability_lock') {
    const builtInAdapter = getLlmProviderAdapter(PHASE1_LOCKED_PROVIDER);
    return {
      deploymentPhase: 'phase1_stability_lock',
      phaseLocked: true,
      providerId: PHASE1_LOCKED_PROVIDER,
      adapter: builtInAdapter,
      modelId: PHASE1_LOCKED_MODEL,
      baseUrl: PHASE1_LOCKED_BASE_URL,
      keyMode: 'auto_creator_first',
      externalApiKey: '',
      allowExternalKeyFallback: false,
      allowMultiTierExternalRouting: false,
      policySummaryFa:
        'فاز ۱ (قفل پایداری فعال): کلیه درخواست‌ها منحصراً روی سهمیه داخلی پلتفرم و مدل Gemini 4 Neon اجرا می‌شوند و هیچ استفاده‌ای از کلید API گوگل AI Studio یا کلیدهای خارجی صورت نمی‌گیرد.',
    };
  }

  const adapter = getLlmProviderAdapter(params.requestedProviderId || PHASE1_LOCKED_PROVIDER);
  const resolvedBaseUrl = (params.requestedBaseUrl || '').trim() || adapter.defaultBaseUrl;
  const resolvedModelId = (params.requestedModelId || '').trim() || adapter.defaultModelId;
  const resolvedKeyMode = params.requestedKeyMode === 'personal' ? 'personal' : 'auto_creator_first';

  return {
    deploymentPhase: 'phase2_open_multi_provider',
    phaseLocked: false,
    providerId: adapter.id,
    adapter,
    modelId: resolvedModelId,
    baseUrl: resolvedBaseUrl.replace(/\/+$/, ''),
    keyMode: resolvedKeyMode,
    externalApiKey: String(params.externalApiKey || '').trim(),
    allowExternalKeyFallback: true,
    allowMultiTierExternalRouting: true,
    policySummaryFa:
      `فاز ۲ (حالت آزاد چندارائه‌دهنده‌ای): اتصال مستقیم به ${adapter.displayNameFa} با مدل ${resolvedModelId} بدون محدودیت ارائه‌دهنده یا API.`,
  };
}
