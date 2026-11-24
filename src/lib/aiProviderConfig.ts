import type { AiModelId, DeepReviewReportDto } from './bookTypes.ts';
import type {
  AiTaskType,
  ModelTierId,
  TokenOptimizationMode,
} from './tokenOptimizer.ts';

export type { AiTaskType, ModelTierId, TokenOptimizationMode };

export type AiProviderType = 'google_aistudio' | 'openai' | 'anthropic' | 'custom_openai';

/**
 * Auth key strategy:
 * - 'auto_creator_first': Probe App Owner's quota first; use it if available,
 *   and automatically switch to the user's personal API key if exhausted/unconfigured.
 * - 'personal': Always use the user's own API key (even if App Owner still has quota).
 * Note: 'creator' is accepted as a legacy alias of 'auto_creator_first'.
 */
export type KeyAuthMode = 'auto_creator_first' | 'personal';
export type GoogleKeyMode = KeyAuthMode | 'creator';

export type WebSearchProviderType =
  | 'same_as_primary'
  | 'google_gemini_search'
  | 'perplexity_sonar'
  | 'anthropic_web_search'
  | 'openai_web_search';

export type AudioTranscribeProviderType =
  | 'google_gemini_audio'
  | 'openai_whisper'
  | 'groq_whisper'
  | 'custom_whisper';

export interface ProviderCredentials {
  /** Editable Base URL (HTTPS only) — applies to Gemini, OpenAI, Anthropic, and Custom providers */
  baseUrl: string;
  /** Held strictly in browser session memory; never written to localStorage or database. */
  apiKey: string;
  /** Model ID for non-Gemini providers (or custom overrides) */
  modelId: string;
}

export interface WebSearchRouteConfig {
  provider: WebSearchProviderType;
  baseUrl: string;
  /** Held strictly in browser session memory; never persisted */
  apiKey: string;
  modelId: string;
}

export interface AudioTranscribeRouteConfig {
  provider: AudioTranscribeProviderType;
  baseUrl: string;
  /** Held strictly in browser session memory; never persisted */
  apiKey: string;
  modelId: string;
}

export interface TierModelSlotConfig {
  provider: AiProviderType;
  baseUrl: string;
  /** Optional session-only key override. When blank, inherits the main key configured for `provider`. */
  apiKey: string;
  modelId: string;
}

export interface MultiTierRoutingConfig {
  /** When true, pipeline tasks automatically route across Economy / Balanced / Flagship tiers */
  enabled: boolean;
  /** Context wire compression intensity */
  optimizationMode: TokenOptimizationMode;
  /** Optional hard safety ceiling in USD per project (null = unlimited) */
  hardCostCapUsd: number | null;
  /** Enable native Anthropic ephemeral prompt caching on system blocks (-90% cached input cost) */
  enablePromptCaching: boolean;
  /** Enable deterministic server-side prompt-hash response cache (0 tokens on repeated checks) */
  enableResponseCache: boolean;
  /** Enable Anti-Drift & Anti-Hallucination technical fact ledger verification */
  enableAntiDriftGuard: boolean;
  /** 3-tier model definitions: Economy (fast/cheap), Balanced (workhorse), Flagship (expert) */
  tiers: Record<ModelTierId, TierModelSlotConfig>;
  /** Editable mapping of each pipeline task to its assigned tier */
  taskTierMap: Record<AiTaskType, ModelTierId>;
}

export interface CustomModelProfile {
  modelId: string;
  displayName?: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  contextWindow?: number;
  supportsJsonSchema?: boolean;
  supportsPromptCaching?: boolean;
  supportsTools?: boolean;
}

export interface AiProviderConfig {
  provider: AiProviderType;
  /**
   * Authentication strategy:
   * - 'auto_creator_first' (or legacy 'creator'): Check App Owner quota first -> auto-fallback to user's key
   * - 'personal': Always use user's personal API key
   */
  googleKeyMode: GoogleKeyMode;
  /** Per-provider editable Base URL, API Key (session-only), and Model ID */
  providers: Record<AiProviderType, ProviderCredentials>;
  /** Slot 2: Independent Web Search / Grounding provider (works even when primary is Claude Opus or OpenAI) */
  webSearchRoute?: WebSearchRouteConfig;
  /** Slot 3: Independent Audio/Voice-to-Text Transcription provider (Gemini Transcribe, OpenAI Whisper, Groq Whisper, Custom) */
  audioRoute?: AudioTranscribeRouteConfig;
  /** Multi-Tier Cost-Smart Routing (Economy / Balanced / Flagship) + Anti-Drift & Token Optimization */
  tierRouting?: MultiTierRoutingConfig;
  /** User-defined pricing & capability overrides for custom / Iranian / local models */
  customModels?: Record<string, CustomModelProfile>;
  /** Legacy mirrors kept synced for backwards compatibility */
  personalGoogleApiKey: string;
  customBaseUrl: string;
  customApiKey: string;
  customModelId: string;
}

export interface DiscoveredProviderModel {
  id: string;
  name?: string;
  ownedBy?: string;
  contextLength?: number | null;
  inputPerMillionUsd?: number | null;
  outputPerMillionUsd?: number | null;
}

export interface ProviderModelsDiscoveryResponse {
  provider: AiProviderType;
  baseUrlUsed: string;
  models: DiscoveredProviderModel[];
  fetchedAt: string;
}

export interface BaseUrlGatewayTemplate {
  label: string;
  baseUrl: string;
}

export interface ProviderMetadata {
  id: AiProviderType;
  nameFa: string;
  shortName: string;
  defaultBaseUrl: string;
  defaultModelId: string;
  apiKeyPlaceholder: string;
  descriptionFa: string;
  supportsGoogleSearch: boolean;
  supportsLiveModelDiscovery: boolean;
  /** Optional quick Base URL templates (NEVER hardcodes a modelId) */
  baseUrlTemplates?: readonly BaseUrlGatewayTemplate[];
  presets?: Array<{ label: string; baseUrl: string; modelId: string }>;
}

export interface WebSearchProviderMetadata {
  id: WebSearchProviderType;
  nameFa: string;
  shortName: string;
  defaultBaseUrl: string;
  defaultModelId: string;
  apiKeyPlaceholder: string;
  descriptionFa: string;
  needsOwnApiKey: boolean;
  supportsLiveModelDiscovery?: boolean;
  baseUrlTemplates?: readonly BaseUrlGatewayTemplate[];
  presets?: Array<{ label: string; baseUrl: string; modelId: string }>;
}

export interface AudioProviderMetadata {
  id: AudioTranscribeProviderType;
  nameFa: string;
  shortName: string;
  defaultBaseUrl: string;
  defaultModelId: string;
  apiKeyPlaceholder: string;
  descriptionFa: string;
  needsOwnApiKey: boolean;
  supportsLiveModelDiscovery?: boolean;
  baseUrlTemplates?: readonly BaseUrlGatewayTemplate[];
  presets?: Array<{ label: string; baseUrl: string; modelId: string }>;
}

export const OPENAI_COMPATIBLE_GATEWAY_TEMPLATES: readonly BaseUrlGatewayTemplate[] = [
  { label: 'AvalAI (آوال‌ای‌آی)', baseUrl: 'https://api.avalai.ir/v1' },
  { label: 'GapGPT (گپ‌جی‌پی‌تی)', baseUrl: 'https://api.gapgpt.app/v1' },
  { label: 'MetisAI (متیس)', baseUrl: 'https://api.metisai.ir/openai/v1' },
  { label: 'TalkBot (تاک‌بات)', baseUrl: 'https://api.talkbot.ir/v1' },
  { label: 'Liara AI (لیارا)', baseUrl: 'https://ai.liara.ir/api/v1' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1' },
  { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' },
  { label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  { label: 'SambaNova', baseUrl: 'https://api.sambanova.ai/v1' },
  { label: 'Perplexity', baseUrl: 'https://api.perplexity.ai' },
] as const;

export const AI_PROVIDER_METADATA: Record<AiProviderType, ProviderMetadata> = {
  google_aistudio: {
    id: 'google_aistudio',
    nameFa: 'Google Gemini (AI Studio / پروکسی)',
    shortName: 'Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-4-hydrogen',
    apiKeyPlaceholder: 'AIzaSy...',
    descriptionFa:
      'پشتیبانی کامل از تمام مدل‌های Gemini (از جمله سری ۴ Carbon/Argon/Neon/Hydrogen و 3.8 Flash) + انتخاب آزاد شناسه مدل، جستجوی زنده گوگل، تبدیل صوت و سهمیه سازنده',
    supportsGoogleSearch: true,
    supportsLiveModelDiscovery: true,
    baseUrlTemplates: [
      { label: 'Google Official', baseUrl: 'https://generativelanguage.googleapis.com' },
      { label: 'AvalAI Gemini Proxy', baseUrl: 'https://api.avalai.ir/v1' },
      { label: 'GapGPT Proxy', baseUrl: 'https://api.gapgpt.app/v1' },
    ],
    presets: [
      {
        label: 'Gemini 4 Carbon (پرچمدار ۲۰۲۶)',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-carbon',
      },
      {
        label: 'Gemini 4 Argon (مهندسی دقیق)',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-argon',
      },
      {
        label: 'Gemini 4 Neon (تعمق بالا)',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-neon',
      },
      {
        label: 'Gemini 4 Hydrogen (هیدروژن ۴ — پیش‌فرض)',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-hydrogen',
      },
      {
        label: 'Gemini 3.8 Flash (فلش ۳.۸ — سریع و اقتصادی)',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-3.8-flash',
      },
      {
        label: 'Gemini 3.1 Pro',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-3.1-pro',
      },
    ],
  },
  openai: {
    id: 'openai',
    nameFa: 'OpenAI (سازگار با /v1/models)',
    shortName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-6.2-sol',
    apiKeyPlaceholder: 'sk-proj-...',
    descriptionFa:
      'اتصال مستقیم به OpenAI یا هر درگاه ایرانی/بین‌المللی سازگار با دریافت زنده لیست مدل‌ها از /models یا ورود آزاد هر شناسه مدل دلخواه',
    supportsGoogleSearch: false,
    supportsLiveModelDiscovery: true,
    baseUrlTemplates: [
      { label: 'OpenAI Official', baseUrl: 'https://api.openai.com/v1' },
      ...OPENAI_COMPATIBLE_GATEWAY_TEMPLATES,
    ],
    presets: [
      { label: 'GPT-6.2 Astra (پرچمدار استدلالی)', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-6.2-astra' },
      { label: 'GPT-6.2 Sol (متعادل مهندسی)', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-6.2-sol' },
      { label: 'GPT-6 Luna (سریع و اقتصادی)', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-6-luna' },
      { label: 'GPT-5', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-5' },
      { label: 'GPT-5 Mini', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-5-mini' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    nameFa: 'Anthropic Claude (Messages API + /v1/models)',
    shortName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-5-5',
    apiKeyPlaceholder: 'sk-ant-...',
    descriptionFa:
      'اتصال به Anthropic (مستقیم یا پروکسی) با پشتیبانی از Prompt Caching و Tool Use، دریافت زنده مدل‌ها از /v1/models یا ورود آزاد هر شناسه مدل دلخواه',
    supportsGoogleSearch: false,
    supportsLiveModelDiscovery: true,
    baseUrlTemplates: [
      { label: 'Anthropic Official', baseUrl: 'https://api.anthropic.com/v1' },
      { label: 'AvalAI Anthropic Proxy', baseUrl: 'https://api.avalai.ir/v1' },
    ],
    presets: [
      { label: 'Claude Opus 5.5 (پرچمدار ۲۰۲۶)', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-opus-5-5' },
      { label: 'Claude Sonnet 5.5 (بهترین تعادل فارسی و فنی)', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-sonnet-5-5' },
      { label: 'Claude Haiku 5.5 (فوق‌سریع و اقتصادی)', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-haiku-5-5' },
      { label: 'Claude Fable 5.2 (مستندسازی عمیق)', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-fable-5-2' },
      { label: 'Claude Opus 4.1', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-opus-4-1-20250805' },
      { label: 'Claude Opus 4', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-opus-4-20250514' },
      { label: 'Claude Sonnet 4', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-sonnet-4-20250514' },
    ],
  },
  custom_openai: {
    id: 'custom_openai',
    nameFa: 'درگاه‌های ایرانی و بین‌المللی (OpenAI-Compatible)',
    shortName: 'OpenAI-Compatible',
    defaultBaseUrl: 'https://api.avalai.ir/v1',
    defaultModelId: 'deepseek-v4-pro',
    apiKeyPlaceholder: 'aa-... / sk-or-... / Bearer token',
    descriptionFa:
      'پشتیبانی کامل از تمام درگاه‌های ایرانی (AvalAI، GapGPT، MetisAI، TalkBot، Liara AI)، OpenRouter، DeepSeek، Groq، vLLM و سرور اختصاصی با کشف زنده مدل‌ها از /models و انتخاب آزاد هر مدل دلخواه',
    supportsGoogleSearch: false,
    supportsLiveModelDiscovery: true,
    baseUrlTemplates: OPENAI_COMPATIBLE_GATEWAY_TEMPLATES,
    presets: [
      { label: 'DeepSeek V4 Pro', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-v4-pro' },
      { label: 'DeepSeek Flash', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-flash' },
      { label: 'Qwen 4 Max', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'qwen/qwen4-max' },
      { label: 'Grok 4.7', baseUrl: 'https://api.x.ai/v1', modelId: 'grok-4.7' },
    ],
  },
};

export const AI_PROVIDER_LIST: readonly ProviderMetadata[] = [
  AI_PROVIDER_METADATA.google_aistudio,
  AI_PROVIDER_METADATA.custom_openai,
  AI_PROVIDER_METADATA.openai,
  AI_PROVIDER_METADATA.anthropic,
] as const;

export const WEB_SEARCH_PROVIDER_METADATA: Record<WebSearchProviderType, WebSearchProviderMetadata> = {
  same_as_primary: {
    id: 'same_as_primary',
    nameFa: 'هوشمند / هم‌مسیر با مدل اصلی',
    shortName: 'خودکار',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-4-hydrogen',
    apiKeyPlaceholder: '',
    descriptionFa:
      'اگر مدل اصلی Gemini باشد از Google Search، اگر Anthropic باشد از جستجوی بومی Claude Web Search، و در غیر این صورت در صورت موجود بودن از سهمیه جستجوی Gemini استفاده می‌کند.',
    needsOwnApiKey: false,
  },
  google_gemini_search: {
    id: 'google_gemini_search',
    nameFa: 'Google Gemini Search (جستجوی زنده گوگل)',
    shortName: 'Google Search',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-4-hydrogen',
    apiKeyPlaceholder: 'AIzaSy... (اختیاری در صورت فعال بودن سهمیه سازنده)',
    descriptionFa:
      'نگارش و تحلیل با مدل اصلی شما انجام می‌شود، اما راستی‌آزمایی اینترنتی با Google Search Grounding (مدل‌های Gemini 4 Hydrogen یا Gemini 3.8 Flash) اجرا می‌گردد.',
    needsOwnApiKey: false,
    presets: [
      { label: 'Gemini 4 Hydrogen + Google Search', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-4-hydrogen' },
      { label: 'Gemini 3.8 Flash + Google Search', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-3.8-flash' },
    ],
  },
  perplexity_sonar: {
    id: 'perplexity_sonar',
    nameFa: 'Perplexity / درگاه جستجوی OpenAI-Compatible',
    shortName: 'Perplexity',
    defaultBaseUrl: 'https://api.perplexity.ai',
    defaultModelId: '',
    apiKeyPlaceholder: 'pplx-...',
    descriptionFa:
      'جستجوی عمیق وب با استخراج خودکار لینک منابع معتبر (Citations) — شناسه مدل روز را از سرور دریافت یا دستی وارد کنید.',
    needsOwnApiKey: true,
    supportsLiveModelDiscovery: true,
    baseUrlTemplates: [
      { label: 'Perplexity API', baseUrl: 'https://api.perplexity.ai' },
      { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
    ],
  },
  anthropic_web_search: {
    id: 'anthropic_web_search',
    nameFa: 'Anthropic Web Search (ابزار بومی جستجو)',
    shortName: 'Anthropic Search',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-5-5',
    apiKeyPlaceholder: 'sk-ant-... (در صورت خالی بودن از کلید Anthropic اصلی استفاده می‌شود)',
    descriptionFa:
      'استفاده مستقیم از ابزار بومی web_search در API رسمی Anthropic همراه با ارجاع منابع — شناسه مدل را از /v1/models دریافت یا وارد کنید.',
    needsOwnApiKey: true,
    supportsLiveModelDiscovery: true,
  },
  openai_web_search: {
    id: 'openai_web_search',
    nameFa: 'OpenAI / OpenRouter Online Search (سازگار با OpenAI)',
    shortName: 'OpenAI-Compatible Search',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModelId: 'gpt-6.2-sol',
    apiKeyPlaceholder: 'sk-... یا sk-or-...',
    descriptionFa:
      'پشتیبانی از هر مدل جستجوگر آنلاین در OpenAI، OpenRouter یا درگاه‌های OpenAI-Compatible.',
    needsOwnApiKey: true,
    supportsLiveModelDiscovery: true,
    baseUrlTemplates: [
      { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
      { label: 'OpenAI Official', baseUrl: 'https://api.openai.com/v1' },
      ...OPENAI_COMPATIBLE_GATEWAY_TEMPLATES.filter((t) => t.label !== 'OpenRouter'),
    ],
  },
};

export const WEB_SEARCH_PROVIDER_LIST: readonly WebSearchProviderMetadata[] = [
  WEB_SEARCH_PROVIDER_METADATA.same_as_primary,
  WEB_SEARCH_PROVIDER_METADATA.google_gemini_search,
  WEB_SEARCH_PROVIDER_METADATA.perplexity_sonar,
  WEB_SEARCH_PROVIDER_METADATA.anthropic_web_search,
  WEB_SEARCH_PROVIDER_METADATA.openai_web_search,
] as const;

export const AUDIO_TRANSCRIBE_PROVIDER_METADATA: Record<
  AudioTranscribeProviderType,
  AudioProviderMetadata
> = {
  google_gemini_audio: {
    id: 'google_gemini_audio',
    nameFa: 'Google Gemini Audio (تبدیل ویس فارسی)',
    shortName: 'Gemini Audio',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-4-hydrogen',
    apiKeyPlaceholder: 'AIzaSy... (اختیاری در صورت فعال بودن سهمیه سازنده)',
    descriptionFa:
      'تبدیل دقیق فایل‌های صوتی کارگاهی فارسی (MP3/WAV/M4A/OGG/WEBM) به متن با مدل‌های Gemini — بدون نیاز به کلید اضافه هنگام فعال بودن سهمیه سازنده.',
    needsOwnApiKey: false,
    presets: [
      { label: 'Gemini 4 Hydrogen (هیدروژن ۴)', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-4-hydrogen' },
      { label: 'Gemini 3.8 Flash (فلش ۳.۸)', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-3.8-flash' },
    ],
  },
  openai_whisper: {
    id: 'openai_whisper',
    nameFa: 'OpenAI Audio Transcriptions (/audio/transcriptions)',
    shortName: 'OpenAI STT',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'whisper-1',
    apiKeyPlaceholder: 'sk-proj-... (در صورت خالی بودن از کلید OpenAI اصلی استفاده می‌شود)',
    descriptionFa:
      'ارسال مستقیم فایل صوتی به استاندارد /audio/transcriptions با شناسه مدل دلخواه شما.',
    needsOwnApiKey: true,
    supportsLiveModelDiscovery: true,
  },
  groq_whisper: {
    id: 'groq_whisper',
    nameFa: 'Groq Audio (/openai/v1/audio/transcriptions)',
    shortName: 'Groq Whisper',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModelId: 'whisper-large-v3-turbo',
    apiKeyPlaceholder: 'gsk_...',
    descriptionFa:
      'تبدیل فوق‌سریع ویس‌های کارگاهی از طریق درگاه OpenAI-Compatible سرویس Groq — شناسه مدل صوتی روز را از لیست مدل‌ها دریافت یا وارد کنید.',
    needsOwnApiKey: true,
    supportsLiveModelDiscovery: true,
  },
  custom_whisper: {
    id: 'custom_whisper',
    nameFa: 'درگاه صوتی OpenAI-Compatible سفارشی (HTTPS)',
    shortName: 'STT سفارشی',
    defaultBaseUrl: 'https://api.avalai.ir/v1',
    defaultModelId: 'whisper-1',
    apiKeyPlaceholder: 'کلید API درگاه صوتی شما...',
    descriptionFa:
      'هر سرویس یا پروکسی HTTPS سازگار با استاندارد OpenAI /audio/transcriptions — با قابلیت استعلام لیست مدل‌ها و ورود آزاد Model ID.',
    needsOwnApiKey: true,
    supportsLiveModelDiscovery: true,
    baseUrlTemplates: OPENAI_COMPATIBLE_GATEWAY_TEMPLATES,
  },
};

export const AUDIO_TRANSCRIBE_PROVIDER_LIST: readonly AudioProviderMetadata[] = [
  AUDIO_TRANSCRIBE_PROVIDER_METADATA.google_gemini_audio,
  AUDIO_TRANSCRIBE_PROVIDER_METADATA.groq_whisper,
  AUDIO_TRANSCRIBE_PROVIDER_METADATA.openai_whisper,
  AUDIO_TRANSCRIBE_PROVIDER_METADATA.custom_whisper,
] as const;

export const DEFAULT_WEB_SEARCH_ROUTE: WebSearchRouteConfig = {
  provider: 'same_as_primary',
  baseUrl: WEB_SEARCH_PROVIDER_METADATA.same_as_primary.defaultBaseUrl,
  apiKey: '',
  modelId: WEB_SEARCH_PROVIDER_METADATA.same_as_primary.defaultModelId,
};

export const DEFAULT_AUDIO_ROUTE: AudioTranscribeRouteConfig = {
  provider: 'google_gemini_audio',
  baseUrl: AUDIO_TRANSCRIBE_PROVIDER_METADATA.google_gemini_audio.defaultBaseUrl,
  apiKey: '',
  modelId: AUDIO_TRANSCRIBE_PROVIDER_METADATA.google_gemini_audio.defaultModelId,
};

export interface ModelTierMetadata {
  id: ModelTierId;
  titleFa: string;
  badgeFa: string;
  descriptionFa: string;
  accentHex: string;
  recommendedModels: Array<{ provider: AiProviderType; modelId: string; baseUrl: string; label: string }>;
}

/**
 * Only Gemini 4 Hydrogen and Gemini 3.8 Flash are provided as built-in model presets.
 * For any OpenAI-compatible or Anthropic provider, users fetch live models from /models or type any current model ID.
 */
export const MODEL_TIER_METADATA: Record<ModelTierId, ModelTierMetadata> = {
  economy: {
    id: 'economy',
    titleFa: 'سطح ۱ · اقتصادی و سریع (Economy)',
    badgeFa: 'اقتصادی',
    descriptionFa: 'برای غربالگری تناقض‌ها، خلاصه غلتان، داور لایه ۲ و پرسش‌های کوتاه — کمترین مصرف توکن و هزینه',
    accentHex: '#14532D',
    recommendedModels: [
      { provider: 'google_aistudio', modelId: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com', label: 'Gemini 3.8 Flash' },
      { provider: 'anthropic', modelId: 'claude-haiku-5-5', baseUrl: 'https://api.anthropic.com/v1', label: 'Claude Haiku 5.5' },
      { provider: 'openai', modelId: 'gpt-6-luna', baseUrl: 'https://api.openai.com/v1', label: 'GPT-6 Luna' },
      { provider: 'custom_openai', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', label: 'DeepSeek Flash' },
    ],
  },
  balanced: {
    id: 'balanced',
    titleFa: 'سطح ۲ · متعادل و مهندسی (Balanced)',
    badgeFa: 'متعادل',
    descriptionFa: 'برای ترمیم جراحی (Patch)، ادغام معنایی چندفایلی، جستجوی وب و چت سردبیر — بهترین تعادل دقت و هزینه',
    accentHex: '#1E3A5F',
    recommendedModels: [
      { provider: 'anthropic', modelId: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', label: 'Claude Sonnet 5.5' },
      { provider: 'google_aistudio', modelId: 'gemini-4-argon', baseUrl: 'https://generativelanguage.googleapis.com', label: 'Gemini 4 Argon' },
      { provider: 'google_aistudio', modelId: 'gemini-4-hydrogen', baseUrl: 'https://generativelanguage.googleapis.com', label: 'Gemini 4 Hydrogen' },
      { provider: 'openai', modelId: 'gpt-6.2-sol', baseUrl: 'https://api.openai.com/v1', label: 'GPT-6.2 Sol' },
      { provider: 'custom_openai', modelId: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/v1', label: 'DeepSeek V4 Pro' },
    ],
  },
  flagship: {
    id: 'flagship',
    titleFa: 'سطح ۳ · پرچمدار و استدلال عمیق (Flagship)',
    badgeFa: 'پرچمدار',
    descriptionFa: 'برای نگارش زیربخش‌های هارنس، بازبینی عمیق و نجات بخش‌های قرنطینه — حداکثر دقت علمی و فارسی',
    accentHex: '#7C2D12',
    recommendedModels: [
      { provider: 'anthropic', modelId: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1', label: 'Claude Opus 5.5' },
      { provider: 'google_aistudio', modelId: 'gemini-4-carbon', baseUrl: 'https://generativelanguage.googleapis.com', label: 'Gemini 4 Carbon' },
      { provider: 'openai', modelId: 'gpt-6.2-astra', baseUrl: 'https://api.openai.com/v1', label: 'GPT-6.2 Astra' },
      { provider: 'google_aistudio', modelId: 'gemini-4-neon', baseUrl: 'https://generativelanguage.googleapis.com', label: 'Gemini 4 Neon' },
    ],
  },
};

export interface AiTaskMetadata {
  id: AiTaskType;
  titleFa: string;
  descriptionFa: string;
  defaultTier: ModelTierId;
  tokenWeightFa: string;
}

export const AI_TASK_METADATA: readonly AiTaskMetadata[] = [
  {
    id: 'conflict_triage',
    titleFa: 'غربالگری تناقض‌های بین فایل‌ها',
    descriptionFa: 'تشخیص تناقض واقعی در برابر جملات مکمل/موازی',
    defaultTier: 'economy',
    tokenWeightFa: 'کم‌مصرف + کش ۰ توکن',
  },
  {
    id: 'outline_polish',
    titleFa: 'یکدست‌سازی عناوین فهرست فصل‌ها',
    descriptionFa: 'اصلاح نگارشی عناوین با حفظ کدهای ECU و WinOLS',
    defaultTier: 'economy',
    tokenWeightFa: 'بسیار کم‌مصرف',
  },
  {
    id: 'semantic_reorder',
    titleFa: 'چیدمان و ادغام معنایی چند فایل',
    descriptionFa: 'ترکیب منطقی چند جزوه نامنظم به یک ساختار منسجم',
    defaultTier: 'balanced',
    tokenWeightFa: 'متوسط',
  },
  {
    id: 'web_grounding',
    titleFa: 'راستی‌آزمایی و جستجوی زنده وب',
    descriptionFa: 'تکمیل پارامترهای فنی و رفع تناقض با منابع آنلاین',
    defaultTier: 'balanced',
    tokenWeightFa: 'متوسط',
  },
  {
    id: 'editor_chat',
    titleFa: 'چت‌بات سردبیر و پیشنهاد ویرایش',
    descriptionFa: 'پرسش‌های کوتاه روی اقتصادی و ویرایش ساختار روی متعادل',
    defaultTier: 'balanced',
    tokenWeightFa: 'پویا',
  },
  {
    id: 'deep_review',
    titleFa: 'بازبینی عمیق نهایی و تولید جدول WinOLS',
    descriptionFa: 'ممیزی جامع سند، کشف شکاف‌ها، ساخت جدول و کادر هشدار',
    defaultTier: 'flagship',
    tokenWeightFa: 'حساس (پرمصرف)',
  },
  {
    id: 'harness_author',
    titleFa: 'نگارش ساختاری زیربخش (هارنس Author)',
    descriptionFa: 'تولید Semantic IR ایزوله با پیشوند کش‌شده و بدون توهم فنی',
    defaultTier: 'flagship',
    tokenWeightFa: 'مرجع (کش‌پذیر)',
  },
  {
    id: 'harness_patch',
    titleFa: 'ترمیم جراحی بلوک معیوب (هارنس Patch)',
    descriptionFa: 'اصلاح دقیق فقط بلوک‌های ردشده بدون بازتولید کل فصل',
    defaultTier: 'balanced',
    tokenWeightFa: 'متوسط (محدود)',
  },
  {
    id: 'harness_utility',
    titleFa: 'خلاصه غلتان و واژه‌نامه زنده (هارنس Utility)',
    descriptionFa: 'فشرده‌سازی RollingSummary و یکدست‌سازی اصطلاحات ECU',
    defaultTier: 'economy',
    tokenWeightFa: 'بسیار کم‌مصرف',
  },
  {
    id: 'harness_judge',
    titleFa: 'ممیز معنایی مستقل لایه ۲ (هارنس Judge)',
    descriptionFa: 'بررسی بی‌حافظه توهم معنایی و افت مفهوم پس از گارد لایه ۱',
    defaultTier: 'economy',
    tokenWeightFa: 'کم‌مصرف',
  },
] as const;

export const DEFAULT_TASK_TIER_MAP: Record<AiTaskType, ModelTierId> = {
  conflict_triage: 'economy',
  outline_polish: 'economy',
  semantic_reorder: 'balanced',
  web_grounding: 'balanced',
  editor_chat: 'balanced',
  deep_review: 'flagship',
  harness_author: 'flagship',
  harness_patch: 'balanced',
  harness_utility: 'economy',
  harness_judge: 'economy',
};

export interface MultiTierRecipe {
  id: string;
  titleFa: string;
  subtitleFa: string;
  badgeFa: string;
  primaryProvider: AiProviderType;
  tiers: Record<ModelTierId, Omit<TierModelSlotConfig, 'apiKey'>>;
  taskTierMap: Record<AiTaskType, ModelTierId>;
  optimizationMode: TokenOptimizationMode;
  enablePromptCaching: boolean;
}

/**
 * Only Gemini 4 Hydrogen + Gemini 3.8 Flash has pre-filled default model IDs.
 * All other recipes set up the provider + Base URL without hardcoding any non-Gemini model names.
 */
export const MULTI_TIER_RECIPES: readonly MultiTierRecipe[] = [
  {
    id: 'nov2026_optimal_hybrid',
    titleFa: 'پیشنهاد طلایی ۲۰۲۶: Claude Sonnet 5.5 + Gemini 3.8 Flash + Claude Opus 5.5',
    subtitleFa: 'بهترین تعادل نثر فارسی، دقت فنی صفر-توهم، Prompt Caching (-۹۰٪) و هزینه بهینه برای تولید کتاب کامل',
    badgeFa: 'بهترین عملکرد ۲۰۲۶',
    primaryProvider: 'anthropic',
    tiers: {
      economy: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-3.8-flash',
      },
      balanced: {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-sonnet-5-5',
      },
      flagship: {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-opus-5-5',
      },
    },
    taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    optimizationMode: 'balanced_pro',
    enablePromptCaching: true,
  },
  {
    id: 'gemini_4_flagship_trio',
    titleFa: 'ترکیب تمام‌گوگل ۲۰۲۶ (Gemini 4 Carbon / Argon + Flash 3.8)',
    subtitleFa: 'مناسب برای بهره‌گیری کامل از کانتکست میلیونی گوگل، JSON Schema سخت‌گیرانه و جستجوی زنده بومی',
    badgeFa: 'کانتکست میلیونی',
    primaryProvider: 'google_aistudio',
    tiers: {
      economy: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-3.8-flash',
      },
      balanced: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-argon',
      },
      flagship: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-carbon',
      },
    },
    taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    optimizationMode: 'balanced_pro',
    enablePromptCaching: true,
  },
  {
    id: 'gemini_optimal_duo',
    titleFa: 'ترکیب پیش‌فرض سهمیه سازنده Gemini (Hydrogen 4 + Flash 3.8)',
    subtitleFa: 'سازگار با سهمیه پیش‌فرض (App Owner): کارهای سریع با Flash 3.8 و بازبینی عمیق با Hydrogen 4',
    badgeFa: 'سهمیه سازنده',
    primaryProvider: 'google_aistudio',
    tiers: {
      economy: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-3.8-flash',
      },
      balanced: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-hydrogen',
      },
      flagship: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-hydrogen',
      },
    },
    taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    optimizationMode: 'balanced_pro',
    enablePromptCaching: false,
  },
  {
    id: 'anthropic_golden_trio',
    titleFa: 'ترکیب ۳ سطحی Anthropic Claude (Haiku + Sonnet + Opus)',
    subtitleFa: 'کارهای سبک روی Haiku، ممیزی/چت روی Sonnet و بازبینی عمیق روی Opus با فعال‌سازی کامل Prompt Caching',
    badgeFa: 'تمام‌کلود',
    primaryProvider: 'anthropic',
    tiers: {
      economy: {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-3-5-haiku-20241022',
      },
      balanced: {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-sonnet-4-20250514',
      },
      flagship: {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-opus-4-1-20250805',
      },
    },
    taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    optimizationMode: 'balanced_pro',
    enablePromptCaching: true,
  },
  {
    id: 'custom_openai_flexible',
    titleFa: 'الگوی ۳ سطحی درگاه ایرانی / OpenAI-Compatible (انتخاب آزاد)',
    subtitleFa: 'هر ۳ سطح را به درگاه AvalAI / GapGPT / OpenRouter / سرور اختصاصی شما متصل می‌کند با انتخاب آزاد هر مدل',
    badgeFa: 'درگاه آزاد / ایرانی',
    primaryProvider: 'custom_openai',
    tiers: {
      economy: {
        provider: 'custom_openai',
        baseUrl: 'https://api.avalai.ir/v1',
        modelId: 'deepseek-flash',
      },
      balanced: {
        provider: 'custom_openai',
        baseUrl: 'https://api.avalai.ir/v1',
        modelId: 'deepseek-v4-pro',
      },
      flagship: {
        provider: 'custom_openai',
        baseUrl: 'https://api.avalai.ir/v1',
        modelId: 'claude-opus-5-5',
      },
    },
    taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    optimizationMode: 'balanced_pro',
    enablePromptCaching: true,
  },
  {
    id: 'hybrid_gemini_and_custom',
    titleFa: 'ترکیب هیبریدی: کارهای سبک با Gemini Flash 3.8 + پرچمدار سفارشی شما',
    subtitleFa: 'مراحل سبک روی Gemini 3.8 Flash و مرحله نگارش/بازبینی نهایی روی مدل دلخواه شما در تب ۱',
    badgeFa: 'هیبریدی اقتصادی',
    primaryProvider: 'custom_openai',
    tiers: {
      economy: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-3.8-flash',
      },
      balanced: {
        provider: 'google_aistudio',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-hydrogen',
      },
      flagship: {
        provider: 'custom_openai',
        baseUrl: 'https://api.avalai.ir/v1',
        modelId: '',
      },
    },
    taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
    optimizationMode: 'balanced_pro',
    enablePromptCaching: true,
  },
] as const;

export const DEFAULT_MULTI_TIER_ROUTING: MultiTierRoutingConfig = {
  enabled: false,
  optimizationMode: 'balanced_pro',
  hardCostCapUsd: 2.0,
  enablePromptCaching: true,
  enableResponseCache: true,
  enableAntiDriftGuard: true,
  tiers: {
    economy: {
      provider: 'google_aistudio',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: '',
      modelId: 'gemini-3.8-flash',
    },
    balanced: {
      provider: 'google_aistudio',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: '',
      modelId: 'gemini-4-hydrogen',
    },
    flagship: {
      provider: 'google_aistudio',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: '',
      modelId: 'gemini-4-hydrogen',
    },
  },
  taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
};

export const DEFAULT_AI_PROVIDER_CONFIG: AiProviderConfig = {
  provider: 'google_aistudio',
  googleKeyMode: 'auto_creator_first',
  providers: {
    google_aistudio: {
      baseUrl: AI_PROVIDER_METADATA.google_aistudio.defaultBaseUrl,
      apiKey: '',
      modelId: 'gemini-4-hydrogen',
    },
    openai: {
      baseUrl: AI_PROVIDER_METADATA.openai.defaultBaseUrl,
      apiKey: '',
      modelId: '',
    },
    anthropic: {
      baseUrl: AI_PROVIDER_METADATA.anthropic.defaultBaseUrl,
      apiKey: '',
      modelId: '',
    },
    custom_openai: {
      baseUrl: AI_PROVIDER_METADATA.custom_openai.defaultBaseUrl,
      apiKey: '',
      modelId: '',
    },
  },
  webSearchRoute: { ...DEFAULT_WEB_SEARCH_ROUTE },
  audioRoute: { ...DEFAULT_AUDIO_ROUTE },
  tierRouting: {
    ...DEFAULT_MULTI_TIER_ROUTING,
    tiers: {
      economy: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.economy },
      balanced: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.balanced },
      flagship: { ...DEFAULT_MULTI_TIER_ROUTING.tiers.flagship },
    },
    taskTierMap: { ...DEFAULT_TASK_TIER_MAP },
  },
  personalGoogleApiKey: '',
  customBaseUrl: AI_PROVIDER_METADATA.custom_openai.defaultBaseUrl,
  customApiKey: '',
  customModelId: '',
};

export function normalizeKeyAuthMode(mode?: string | null): KeyAuthMode {
  return mode === 'personal' ? 'personal' : 'auto_creator_first';
}

export function normalizeProviderType(raw?: string | null): AiProviderType {
  if (raw === 'openai' || raw === 'anthropic' || raw === 'custom_openai') {
    return raw;
  }
  return 'google_aistudio';
}

export function normalizeWebSearchProviderType(raw?: string | null): WebSearchProviderType {
  if (
    raw === 'google_gemini_search' ||
    raw === 'perplexity_sonar' ||
    raw === 'anthropic_web_search' ||
    raw === 'openai_web_search'
  ) {
    return raw;
  }
  return 'same_as_primary';
}

export function normalizeAudioProviderType(raw?: string | null): AudioTranscribeProviderType {
  if (raw === 'openai_whisper' || raw === 'groq_whisper' || raw === 'custom_whisper') {
    return raw;
  }
  return 'google_gemini_audio';
}

export function getEffectiveWebSearchRoute(config: AiProviderConfig): WebSearchRouteConfig {
  const route = config.webSearchRoute;
  const provider = normalizeWebSearchProviderType(route?.provider);
  const meta = WEB_SEARCH_PROVIDER_METADATA[provider];
  return {
    provider,
    baseUrl: (route?.baseUrl || '').trim() || meta.defaultBaseUrl,
    apiKey: (route?.apiKey || '').trim(),
    modelId: (route?.modelId || '').trim() || meta.defaultModelId,
  };
}

export function getEffectiveAudioRoute(config: AiProviderConfig): AudioTranscribeRouteConfig {
  const route = config.audioRoute;
  const provider = normalizeAudioProviderType(route?.provider);
  const meta = AUDIO_TRANSCRIBE_PROVIDER_METADATA[provider];
  return {
    provider,
    baseUrl: (route?.baseUrl || '').trim() || meta.defaultBaseUrl,
    apiKey: (route?.apiKey || '').trim(),
    modelId: (route?.modelId || '').trim() || meta.defaultModelId,
  };
}

export function normalizeTokenOptimizationMode(raw?: string | null): TokenOptimizationMode {
  if (raw === 'aggressive_saver' || raw === 'max_quality') return raw;
  return 'balanced_pro';
}

export function normalizeModelTierId(raw?: string | null): ModelTierId {
  if (raw === 'economy' || raw === 'flagship') return raw;
  return 'balanced';
}

export function getEffectiveTierRouting(config: AiProviderConfig): MultiTierRoutingConfig {
  const tr = config.tierRouting;
  const normalizeSlot = (tier: ModelTierId): TierModelSlotConfig => {
    const rawSlot = tr?.tiers?.[tier];
    const fallbackSlot = DEFAULT_MULTI_TIER_ROUTING.tiers[tier];
    const provider = normalizeProviderType(rawSlot?.provider || fallbackSlot.provider);
    const meta = AI_PROVIDER_METADATA[provider];
    const defaultModelForProvider =
      provider === 'google_aistudio' ? fallbackSlot.modelId || meta.defaultModelId : '';
    return {
      provider,
      baseUrl: (rawSlot?.baseUrl || '').trim() || meta.defaultBaseUrl,
      apiKey: (rawSlot?.apiKey || '').trim(),
      modelId: (rawSlot?.modelId || '').trim() || defaultModelForProvider,
    };
  };

  const hardCapRaw = tr?.hardCostCapUsd;
  const hardCostCapUsd =
    hardCapRaw === null
      ? null
      : typeof hardCapRaw === 'number' && Number.isFinite(hardCapRaw) && hardCapRaw > 0
        ? Math.min(500, Math.max(0.05, hardCapRaw))
        : DEFAULT_MULTI_TIER_ROUTING.hardCostCapUsd;

  return {
    enabled: Boolean(tr?.enabled),
    optimizationMode: normalizeTokenOptimizationMode(tr?.optimizationMode),
    hardCostCapUsd,
    enablePromptCaching: tr?.enablePromptCaching !== false,
    enableResponseCache: tr?.enableResponseCache !== false,
    enableAntiDriftGuard: tr?.enableAntiDriftGuard !== false,
    tiers: {
      economy: normalizeSlot('economy'),
      balanced: normalizeSlot('balanced'),
      flagship: normalizeSlot('flagship'),
    },
    taskTierMap: {
      conflict_triage: normalizeModelTierId(tr?.taskTierMap?.conflict_triage || DEFAULT_TASK_TIER_MAP.conflict_triage),
      outline_polish: normalizeModelTierId(tr?.taskTierMap?.outline_polish || DEFAULT_TASK_TIER_MAP.outline_polish),
      semantic_reorder: normalizeModelTierId(tr?.taskTierMap?.semantic_reorder || DEFAULT_TASK_TIER_MAP.semantic_reorder),
      web_grounding: normalizeModelTierId(tr?.taskTierMap?.web_grounding || DEFAULT_TASK_TIER_MAP.web_grounding),
      editor_chat: normalizeModelTierId(tr?.taskTierMap?.editor_chat || DEFAULT_TASK_TIER_MAP.editor_chat),
      deep_review: normalizeModelTierId(tr?.taskTierMap?.deep_review || DEFAULT_TASK_TIER_MAP.deep_review),
      harness_author: normalizeModelTierId(tr?.taskTierMap?.harness_author || DEFAULT_TASK_TIER_MAP.harness_author),
      harness_patch: normalizeModelTierId(tr?.taskTierMap?.harness_patch || DEFAULT_TASK_TIER_MAP.harness_patch),
      harness_utility: normalizeModelTierId(tr?.taskTierMap?.harness_utility || DEFAULT_TASK_TIER_MAP.harness_utility),
      harness_judge: normalizeModelTierId(tr?.taskTierMap?.harness_judge || DEFAULT_TASK_TIER_MAP.harness_judge),
    },
  };
}

export function applyMultiTierRecipe(
  config: AiProviderConfig,
  recipeId: string
): AiProviderConfig {
  const recipe = MULTI_TIER_RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return config;
  const prev = getEffectiveTierRouting(config);
  const mkSlot = (tier: ModelTierId): TierModelSlotConfig => {
    const target = recipe.tiers[tier];
    const existingSameProviderKey =
      prev.tiers[tier].provider === target.provider ? prev.tiers[tier].apiKey : '';
    const inheritedTab1Url = config.providers?.[target.provider]?.baseUrl?.trim() || '';
    const inheritedTab1Model = config.providers?.[target.provider]?.modelId?.trim() || '';
    return {
      provider: target.provider,
      baseUrl:
        target.provider !== 'google_aistudio' && inheritedTab1Url
          ? inheritedTab1Url
          : target.baseUrl,
      apiKey: existingSameProviderKey,
      modelId: target.modelId || inheritedTab1Model,
    };
  };
  return {
    ...config,
    tierRouting: {
      ...prev,
      enabled: true,
      optimizationMode: recipe.optimizationMode,
      enablePromptCaching: recipe.enablePromptCaching,
      tiers: {
        economy: mkSlot('economy'),
        balanced: mkSlot('balanced'),
        flagship: mkSlot('flagship'),
      },
      taskTierMap: { ...recipe.taskTierMap },
    },
  };
}

export interface ResolvedTaskTierTarget {
  tierUsed: ModelTierId | 'primary';
  provider: AiProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

/**
 * Resolves the concrete provider/model/key for a given pipeline task.
 * If Multi-Tier Routing is disabled, returns the primary provider configuration.
 * When a tier's own `apiKey` is left blank, seamlessly inherits `config.providers[tier.provider].apiKey`
 * so the user never has to paste the same API key three times.
 */
export function resolveTierSlotForTask(
  config: AiProviderConfig,
  taskType: AiTaskType,
  fallbackGoogleModel: AiModelId = 'gemini-4-hydrogen'
): ResolvedTaskTierTarget {
  const tr = getEffectiveTierRouting(config);
  if (!tr.enabled) {
    const active = getActiveProviderCredentials(config);
    const activeGoogleModel =
      config.providers?.google_aistudio?.modelId?.trim() || fallbackGoogleModel;
    return {
      tierUsed: 'primary',
      provider: config.provider,
      baseUrl: active.baseUrl,
      apiKey: active.apiKey,
      modelId: config.provider === 'google_aistudio' ? activeGoogleModel : active.modelId,
    };
  }

  const tierId = tr.taskTierMap[taskType] || DEFAULT_TASK_TIER_MAP[taskType];
  const slot = tr.tiers[tierId];
  const inheritedKey = config.providers?.[slot.provider]?.apiKey?.trim() || '';
  const inheritedBaseUrl = config.providers?.[slot.provider]?.baseUrl?.trim() || '';
  const inheritedModelId = config.providers?.[slot.provider]?.modelId?.trim() || '';
  const meta = AI_PROVIDER_METADATA[slot.provider];

  return {
    tierUsed: tierId,
    provider: slot.provider,
    baseUrl: slot.baseUrl.trim() || inheritedBaseUrl || meta.defaultBaseUrl,
    apiKey: slot.apiKey.trim() || inheritedKey,
    modelId:
      slot.modelId.trim() ||
      inheritedModelId ||
      (slot.provider === 'google_aistudio' ? meta.defaultModelId : ''),
  };
}

export interface CapabilityRoutingPlan {
  primaryLabelFa: string;
  webSearchLabelFa: string;
  audioLabelFa: string;
  isHybrid: boolean;
  tierRoutingEnabled: boolean;
  tierSummaryFa: string;
}

export function resolveCapabilityRoutingPlan(
  config: AiProviderConfig,
  googleModelId: AiModelId
): CapabilityRoutingPlan {
  const primary = getProviderDisplaySummary(config, googleModelId);
  const searchRoute = getEffectiveWebSearchRoute(config);
  const audioRoute = getEffectiveAudioRoute(config);
  const tr = getEffectiveTierRouting(config);

  let webSearchLabelFa: string;
  if (searchRoute.provider === 'same_as_primary') {
    if (config.provider === 'anthropic') {
      webSearchLabelFa = 'Anthropic Web Search (بومی)';
    } else if (config.provider === 'google_aistudio') {
      webSearchLabelFa = 'Google Search (Gemini)';
    } else {
      webSearchLabelFa = 'Google Search (پشتیبان خودکار)';
    }
  } else {
    const sm = WEB_SEARCH_PROVIDER_METADATA[searchRoute.provider];
    webSearchLabelFa = searchRoute.modelId
      ? `${sm.shortName} (${searchRoute.modelId})`
      : `${sm.shortName} (مدل انتخاب نشده)`;
  }

  const am = AUDIO_TRANSCRIBE_PROVIDER_METADATA[audioRoute.provider];
  const audioLabelFa = audioRoute.modelId
    ? `${am.shortName} (${audioRoute.modelId})`
    : `${am.shortName} (مدل انتخاب نشده)`;

  const isHybrid =
    tr.enabled ||
    config.provider !== 'google_aistudio' ||
    (searchRoute.provider !== 'same_as_primary' && searchRoute.provider !== 'google_gemini_search') ||
    audioRoute.provider !== 'google_gemini_audio';

  const fmtTierModel = (m: string) => m.trim() || 'انتخاب نشده';
  const tierSummaryFa = tr.enabled
    ? `اقتصادی: ${fmtTierModel(tr.tiers.economy.modelId)} · متعادل: ${fmtTierModel(tr.tiers.balanced.modelId)} · پرچمدار: ${fmtTierModel(tr.tiers.flagship.modelId)}`
    : 'تک‌مدله (همه مراحل روی مدل اصلی)';

  return {
    primaryLabelFa: `${primary.providerLabel} · ${primary.modelLabel}`,
    webSearchLabelFa,
    audioLabelFa,
    isHybrid,
    tierRoutingEnabled: tr.enabled,
    tierSummaryFa,
  };
}

export function getActiveProviderCredentials(config: AiProviderConfig): ProviderCredentials {
  const provider = normalizeProviderType(config.provider);
  const entry = config.providers?.[provider];
  const meta = AI_PROVIDER_METADATA[provider];
  if (entry) {
    return {
      baseUrl: entry.baseUrl ?? meta.defaultBaseUrl,
      apiKey: entry.apiKey ?? '',
      modelId: entry.modelId || meta.defaultModelId,
    };
  }
  if (provider === 'google_aistudio') {
    return {
      baseUrl: meta.defaultBaseUrl,
      apiKey: config.personalGoogleApiKey || '',
      modelId: 'gemini-4-hydrogen',
    };
  }
  return {
    baseUrl: config.customBaseUrl || meta.defaultBaseUrl,
    apiKey: config.customApiKey || '',
    modelId: config.customModelId || meta.defaultModelId,
  };
}

export function getProviderDisplaySummary(
  config: AiProviderConfig,
  googleModelId: AiModelId
): { providerLabel: string; modelLabel: string; keySourceLabel: string } {
  const provider = normalizeProviderType(config.provider);
  const meta = AI_PROVIDER_METADATA[provider];
  const creds = getActiveProviderCredentials(config);
  const mode = normalizeKeyAuthMode(config.googleKeyMode);

  const modelLabel =
    provider === 'google_aistudio'
      ? getGoogleModelMeta(googleModelId).displayName
      : creds.modelId.trim() || 'مدل انتخاب نشده';

  const keySourceLabel =
    mode === 'personal'
      ? 'کلید اختصاصی شما'
      : creds.apiKey.trim()
        ? 'سهمیه سازنده ← سوئیچ خودکار به کلید شما'
        : 'سهمیه سازنده (App Owner)';

  return {
    providerLabel: meta.shortName,
    modelLabel,
    keySourceLabel,
  };
}

export interface AuthStrategyDecision {
  selectedKeySource: 'creator' | 'personal' | 'none';
  switchedFromCreator: boolean;
  needsPersonalKey: boolean;
  reasonFa: string;
}

/**
 * Pure authentication decision logic:
 * 1. If user explicitly chose 'personal', always use their personal key (never consume App Owner quota).
 * 2. If user chose 'auto_creator_first' (default):
 *    - If App Owner quota is configured AND available -> use 'creator'.
 *    - Otherwise, if user entered their own personal API key -> seamlessly auto-switch to 'personal'.
 *    - Otherwise -> report needsPersonalKey = true so UI prompts for personal key.
 */
export function resolveEffectiveAuthStrategy(params: {
  keyMode: GoogleKeyMode;
  creatorKeyConfigured: boolean;
  creatorHasQuota: boolean;
  personalKeyProvided: boolean;
}): AuthStrategyDecision {
  const mode = normalizeKeyAuthMode(params.keyMode);

  if (mode === 'personal') {
    if (params.personalKeyProvided) {
      return {
        selectedKeySource: 'personal',
        switchedFromCreator: false,
        needsPersonalKey: false,
        reasonFa: 'طبق انتخاب شما، درخواست‌ها مستقیماً با کلید اختصاصی خودتان ارسال می‌شوند.',
      };
    }
    return {
      selectedKeySource: 'none',
      switchedFromCreator: false,
      needsPersonalKey: true,
      reasonFa: 'حالت «کلید اختصاصی من» انتخاب شده است؛ لطفاً کلید API خود را وارد کنید.',
    };
  }

  // auto_creator_first
  if (params.creatorKeyConfigured && params.creatorHasQuota) {
    return {
      selectedKeySource: 'creator',
      switchedFromCreator: false,
      needsPersonalKey: false,
      reasonFa: 'سهمیه سازنده برنامه (App Owner) در استعلام زنده فعال است و در حال استفاده می‌باشد.',
    };
  }

  if (params.personalKeyProvided) {
    return {
      selectedKeySource: 'personal',
      switchedFromCreator: true,
      needsPersonalKey: false,
      reasonFa: params.creatorKeyConfigured
        ? 'سهمیه سازنده برنامه در این لحظه در دسترس نیست؛ سیستم به‌صورت خودکار روی کلید اختصاصی شما سوئیچ کرد.'
        : 'سهمیه سازنده برای این ارائه‌دهنده تنظیم نشده است؛ سیستم به‌صورت خودکار از کلید اختصاصی شما استفاده می‌کند.',
    };
  }

  return {
    selectedKeySource: 'none',
    switchedFromCreator: false,
    needsPersonalKey: true,
    reasonFa: params.creatorKeyConfigured
      ? 'سهمیه سازنده برنامه (App Owner) در این لحظه در دسترس نیست. می‌توانید چند ثانیه دیگر دوباره امتحان کنید یا کلید اختصاصی خود را وارد نمایید.'
      : 'سهمیه سازنده برای این ارائه‌دهنده تنظیم نشده است. لطفاً کلید API اختصاصی خود را وارد کنید.',
  };
}

export interface GoogleModelOption {
  id: AiModelId;
  shortName: string;
  displayName: string;
  labelFa: string;
  descriptionFa: string;
  supportsXHigh: boolean;
  softBudgetTokens: number;
  softRequestCap: number;
  inputRatePerMillionUsd: number;
  outputRatePerMillionUsd: number;
}

/**
 * Strictly the two selectable Google AI Studio models requested by the user:
 * Gemini 4 Hydrogen and Gemini 3.8 Flash.
 */
export const GOOGLE_MODEL_OPTIONS: readonly GoogleModelOption[] = [
  {
    id: 'gemini-4-carbon',
    shortName: 'Carbon 4',
    displayName: 'Gemini 4 Carbon',
    labelFa: 'Gemini 4 Carbon (کربن ۴ — پرچمدار ۲۰۲۶)',
    descriptionFa: 'قدرتمندترین مدل گوگل در سال ۲۰۲۶ برای فصل‌بندی، ممیزی فنی عمیق و نجات بخش‌های پیچیده',
    supportsXHigh: true,
    softBudgetTokens: 250_000,
    softRequestCap: 25,
    inputRatePerMillionUsd: 1.5,
    outputRatePerMillionUsd: 12.0,
  },
  {
    id: 'gemini-4-argon',
    shortName: 'Argon 4',
    displayName: 'Gemini 4 Argon',
    labelFa: 'Gemini 4 Argon (آرگون ۴ — مهندسی دقیق)',
    descriptionFa: 'تعادل عالی بین استدلال عمیق، پیروی از Schema و هزینه مناسب برای کتاب‌سازی طولانی',
    supportsXHigh: true,
    softBudgetTokens: 300_000,
    softRequestCap: 30,
    inputRatePerMillionUsd: 0.5,
    outputRatePerMillionUsd: 3.5,
  },
  {
    id: 'gemini-4-neon',
    shortName: 'Neon 4',
    displayName: 'Gemini 4 Neon',
    labelFa: 'Gemini 4 Neon (نئون ۴ — پرظرفیت)',
    descriptionFa: 'مناسب تحلیل جداول WinOLS، مراجع سنگین و استدلال چندمرحله‌ای',
    supportsXHigh: true,
    softBudgetTokens: 250_000,
    softRequestCap: 25,
    inputRatePerMillionUsd: 1.25,
    outputRatePerMillionUsd: 10.0,
  },
  {
    id: 'gemini-4-hydrogen',
    shortName: 'Hydrogen 4',
    displayName: 'Gemini 4 Hydrogen',
    labelFa: 'Gemini 4 Hydrogen (هیدروژن ۴ — پیش‌فرض)',
    descriptionFa: 'دقت و استدلال بالا برای فصل‌بندی، کشف تناقض و بازبینی عمیق',
    supportsXHigh: true,
    softBudgetTokens: 250_000,
    softRequestCap: 25,
    inputRatePerMillionUsd: 0.3,
    outputRatePerMillionUsd: 2.5,
  },
  {
    id: 'gemini-3.8-flash',
    shortName: 'Flash 3.8',
    displayName: 'Gemini 3.8 Flash',
    labelFa: 'Gemini 3.8 Flash (فلش ۳.۸ — سریع و بهینه)',
    descriptionFa: 'سرعت بالا و مصرف بهینه برای پردازش فایل‌های متعدد و پاسخ سریع',
    supportsXHigh: false,
    softBudgetTokens: 350_000,
    softRequestCap: 35,
    inputRatePerMillionUsd: 0.15,
    outputRatePerMillionUsd: 0.6,
  },
] as const;

export const ALLOWED_GOOGLE_MODEL_IDS = new Set<string>(
  GOOGLE_MODEL_OPTIONS.map((m) => m.id)
);

export function normalizeGoogleModelId(raw?: string | null): AiModelId {
  const cleaned = sanitizeCustomModelId(raw || '');
  if (!cleaned) return 'gemini-4-hydrogen';
  if (cleaned === 'gemini-3.1-flash-lite') return 'gemini-3.8-flash';
  return cleaned;
}

export function getGoogleModelMeta(modelId?: string | null): GoogleModelOption {
  const normalized = normalizeGoogleModelId(modelId);
  const found = GOOGLE_MODEL_OPTIONS.find((m) => m.id === normalized);
  if (found) return found;
  return {
    id: normalized,
    shortName: normalized,
    displayName: normalized,
    labelFa: `${normalized} (مدل سفارشی)`,
    descriptionFa: 'مدل اختصاصی یا جدید انتخاب‌شده توسط کاربر',
    supportsXHigh: true,
    softBudgetTokens: 300_000,
    softRequestCap: 35,
    inputRatePerMillionUsd: 0.5,
    outputRatePerMillionUsd: 2.5,
  };
}

export type LiveQuotaHealth =
  | 'available'
  | 'busy'
  | 'exhausted'
  | 'invalid_key'
  | 'unconfigured'
  | 'error';

export interface FriendlyProviderError {
  status: LiveQuotaHealth;
  statusLabelFa: string;
  detailFa: string;
  isTransientBusy: boolean;
}

/**
 * Cleanly parses any raw provider/SDK error (including nested JSON like
 * `{"error":{"code":503,"message":"This model is currently experiencing high demand...","status":"UNAVAILABLE"}}`)
 * into crisp, human-readable Persian text so raw JSON is NEVER leaked into RTL UI.
 */
export function formatFriendlyProviderErrorFa(
  rawError: unknown,
  providerLabel: string,
  keySource: 'creator' | 'personal' | 'custom' = 'personal'
): FriendlyProviderError {
  const rawMessage =
    rawError instanceof Error
      ? rawError.message
      : typeof rawError === 'string'
        ? rawError
        : String(rawError || '');

  let numericCode: number | undefined = (rawError as { status?: number; code?: number })?.status ??
    (rawError as { code?: number })?.code;
  let statusToken = '';
  let extractedMessage = rawMessage;

  // Attempt to unwrap JSON payloads embedded inside Error.message
  const jsonStart = rawMessage.indexOf('{');
  const jsonEnd = rawMessage.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1)) as {
        error?: { code?: number; status?: string; message?: string } | string;
        code?: number;
        status?: string;
        message?: string;
      };
      const inner = typeof parsed.error === 'object' && parsed.error ? parsed.error : parsed;
      if (typeof inner.code === 'number') numericCode = inner.code;
      if (typeof inner.status === 'string') statusToken = inner.status;
      if (typeof inner.message === 'string' && inner.message.trim()) {
        extractedMessage = inner.message.trim();
      } else if (typeof parsed.error === 'string' && parsed.error.trim()) {
        extractedMessage = parsed.error.trim();
      }
    } catch {
      // Keep original text for regex classification
    }
  }

  const upper = `${rawMessage} ${statusToken} ${extractedMessage}`.toUpperCase();

  if (
    numericCode === 503 ||
    numericCode === 529 ||
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('TEMPORARILY')
  ) {
    return {
      status: 'busy',
      isTransientBusy: true,
      statusLabelFa: 'شلوغی موقت سرور (503)',
      detailFa:
        providerLabel === 'Gemini'
          ? 'سرور مدل انتخابی در این لحظه با ترافیک بالا مواجه است (خطای موقت ۵۰۳). چند ثانیه دیگر دوباره امتحان کنید، مدل را به فلش ۳.۸ تغییر دهید یا از ارائه‌دهنده جایگزین (مانند Anthropic/OpenAI) استفاده کنید.'
          : `سرور ${providerLabel} در این لحظه شلوغ است (خطای موقت ۵۰۳). لطفاً چند ثانیه دیگر دوباره تلاش کنید.`,
    };
  }

  if (
    numericCode === 429 ||
    upper.includes('429') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('QUOTA') ||
    upper.includes('RATE_LIMIT')
  ) {
    return {
      status: 'exhausted',
      isTransientBusy: false,
      statusLabelFa: 'سهمیه تمام شده (429)',
      detailFa:
        keySource === 'creator'
          ? `سهمیه کلید سازنده برای ${providerLabel} در این لحظه تکمیل شده است. با ثبت کلید اختصاصی خود می‌توانید بدون وقفه ادامه دهید.`
          : `سهمیه یا اعتبار کلید ${providerLabel} شما در این لحظه پر شده است (کد ۴۲۹).`,
    };
  }

  if (
    numericCode === 401 ||
    numericCode === 403 ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('INVALID_API_KEY') ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('UNAUTHORIZED') ||
    upper.includes('AUTHENTICATION_ERROR')
  ) {
    return {
      status: 'invalid_key',
      isTransientBusy: false,
      statusLabelFa: 'کلید نامعتبر (401/403)',
      detailFa:
        keySource === 'creator'
          ? `کلید سازنده برای ${providerLabel} معتبر نیست یا دسترسی لازم ندارد. لطفاً کلید اختصاصی خود را وارد کنید.`
          : `کلید API واردشده توسط ${providerLabel} پذیرفته نشد. صحت کلید و دسترسی مدل را بررسی کنید.`,
    };
  }

  if (numericCode === 404 || upper.includes('404') || upper.includes('NOT_FOUND')) {
    return {
      status: 'error',
      isTransientBusy: false,
      statusLabelFa: 'مدل یا مسیر یافت نشد (404)',
      detailFa: `نام مدل یا آدرس Base URL واردشده برای ${providerLabel} یافت نشد. شناسه مدل (Model ID) و آدرس سرور را بررسی کنید.`,
    };
  }

  if (upper.includes('ABORT') || upper.includes('TIMEOUT') || upper.includes('ETIMEDOUT')) {
    return {
      status: 'error',
      isTransientBusy: true,
      statusLabelFa: 'پاسخ‌گویی زمان‌بر شد (Timeout)',
      detailFa: `سرور ${providerLabel} در زمان مجاز پاسخ نداد. وضعیت اتصال اینترنت یا آدرس Base URL را بررسی کرده و دوباره تلاش کنید.`,
    };
  }

  const sanitizedFallback = extractedMessage
    .replace(/[{}[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

  return {
    status: 'error',
    isTransientBusy: false,
    statusLabelFa: 'خطا در اتصال زنده',
    detailFa: sanitizedFallback
      ? `اتصال به ${providerLabel} ناموفق بود: ${sanitizedFallback}`
      : `اتصال به سرور ${providerLabel} برقرار نشد.`,
  };
}

export interface ProviderProbeSnapshot {
  status: LiveQuotaHealth;
  hasQuota: boolean;
  checkedAt: string;
  latencyMs: number;
  provider: AiProviderType;
  keySource: 'creator' | 'personal' | 'custom';
  switchedFromCreator?: boolean;
  modelChecked: string;
  resolvedApiModel?: string;
  baseUrlUsed?: string;
  statusLabelFa: string;
  detailFa: string;
  rateLimitRemainingRequests?: number | null;
  rateLimitRemainingTokens?: number | null;
  rateLimitResetHint?: string | null;
}

export interface AiQuotaProbeResponse {
  activeProbe: ProviderProbeSnapshot;
  creatorKeyProbe: ProviderProbeSnapshot;
  authDecision?: AuthStrategyDecision;
  accountUsage: {
    projectCount: number;
    currentProjectTokens: number;
    currentProjectRequests: number;
    allProjectsTokens: number;
    allProjectsRequests: number;
    estimatedRemainingTokens: number;
    estimatedRemainingPercent: number;
    softBudgetTokens: number;
  };
}

/**
 * Validates any provider Base URL (Gemini, OpenAI, Anthropic, Custom) against unsafe schemes
 * and internal/private/metadata network targets.
 */
export function validateCustomBaseUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'آدرس Base URL نمی‌تواند خالی باشد.' };
  }
  if (trimmed.length > 300) {
    return { valid: false, error: 'آدرس Base URL بیش از حد طولانی است.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: 'فرمت Base URL نامعتبر است. نمونه صحیح: https://api.openai.com/v1',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'برای امنیت کلید API شما، آدرس Base URL باید حتماً با https:// شروع شود.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'آدرس Base URL نباید شامل نام کاربری یا رمز عبور باشد.',
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { valid: false, error: 'دامنه (Host) در Base URL معتبر نیست.' };
  }

  // Block localhost, internal/local suffixes, and cloud metadata hostnames
  if (
    host === 'localhost' ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return {
      valid: false,
      error: 'آدرس‌های داخلی یا محلی (localhost / internal) به‌دلیل ملاحظات امنیتی مجاز نیستند.',
    };
  }

  // Block IPv6 loopback, unique-local (fc00::/7), link-local (fe80::/10), unspecified (::)
  if (host.includes(':')) {
    const normalizedIpv6 = host.toLowerCase();
    if (
      normalizedIpv6 === '::1' ||
      normalizedIpv6 === '::' ||
      normalizedIpv6.startsWith('fc') ||
      normalizedIpv6.startsWith('fd') ||
      normalizedIpv6.startsWith('fe8') ||
      normalizedIpv6.startsWith('fe9') ||
      normalizedIpv6.startsWith('fea') ||
      normalizedIpv6.startsWith('feb') ||
      normalizedIpv6.startsWith('::ffff:')
    ) {
      return {
        valid: false,
        error: 'آدرس‌های IPv6 محلی یا خصوصی مجاز نیستند.',
      };
    }
  }

  // Block IPv4 loopback, private RFC1918, link-local/metadata, CGNAT, 0.0.0.0/8
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((n) => Number(n));
    if (octets.some((n) => n < 0 || n > 255)) {
      return { valid: false, error: 'نشانی IP واردشده نامعتبر است.' };
    }
    const [a, b] = octets;
    const isPrivateOrReserved =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    if (isPrivateOrReserved) {
      return {
        valid: false,
        error: 'آدرس‌های IP خصوصی، محلی یا سرویس متادیتا مجاز نیستند.',
      };
    }
  }

  // Strip trailing slashes for consistent endpoint joining
  const normalizedUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  return { valid: true, normalizedUrl };
}

export function sanitizeCustomModelId(raw: string): string {
  const cleaned = String(raw || '').trim();
  if (!cleaned || cleaned.length > 120) return '';
  if (!/^[a-zA-Z0-9._:/-]+$/.test(cleaned)) return '';
  return cleaned;
}

export interface SafeDeepReviewPanelState {
  hasStarted: boolean;
  progressPercent: number;
  appliedCounts: {
    titlesRefined: number;
    calloutsAdded: number;
    tablesAdded: number;
    paragraphsAdded: number;
  };
  totalApplied: number;
  findings: DeepReviewReportDto['findings'];
  overallScore: number;
  thinkingLevel: string;
  overallAssessment: string;
}

/**
 * Pure safe-accessor for DeepReviewPanel so accessing appliedCounts or progress
 * NEVER throws Cannot read properties of undefined, and defaults to 0% / 0 counts
 * whenever review has not started yet.
 */
export function computeDeepReviewPanelState(params: {
  report?: Partial<DeepReviewReportDto> | null;
  running?: boolean;
  progressPercent?: number | null;
}): SafeDeepReviewPanelState {
  const { report, running = false, progressPercent } = params;

  const rawCounts =
    report && typeof report === 'object' && report.appliedCounts && typeof report.appliedCounts === 'object'
      ? report.appliedCounts
      : null;

  const safeNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };

  const appliedCounts = {
    titlesRefined: safeNum(rawCounts?.titlesRefined),
    calloutsAdded: safeNum(rawCounts?.calloutsAdded),
    tablesAdded: safeNum(rawCounts?.tablesAdded),
    paragraphsAdded: safeNum(rawCounts?.paragraphsAdded),
  };

  const totalApplied =
    appliedCounts.titlesRefined +
    appliedCounts.calloutsAdded +
    appliedCounts.tablesAdded +
    appliedCounts.paragraphsAdded;

  const hasReport = Boolean(report && typeof report === 'object' && rawCounts !== null);
  const hasStarted = running || hasReport;

  let computedPercent = 0;
  if (running) {
    const p = Number(progressPercent);
    computedPercent = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0;
  } else if (hasReport) {
    computedPercent = 100;
  } else {
    computedPercent = 0;
  }

  return {
    hasStarted,
    progressPercent: computedPercent,
    appliedCounts,
    totalApplied,
    findings: Array.isArray(report?.findings) ? report.findings : [],
    overallScore:
      typeof report?.overallScore === 'number' && Number.isFinite(report.overallScore)
        ? Math.max(0, Math.min(100, Math.round(report.overallScore)))
        : 0,
    thinkingLevel: typeof report?.thinkingLevel === 'string' ? report.thinkingLevel : 'XHIGH',
    overallAssessment:
      typeof report?.overallAssessment === 'string' && report.overallAssessment.trim()
        ? report.overallAssessment.trim()
        : 'بازبینی عمیق هنوز اجرا نشده است. برای بررسی ساختار، کشف شکاف‌ها و ارتقای سند روی دکمه «شروع بازبینی عمیق» کلیک کنید.',
  };
}
