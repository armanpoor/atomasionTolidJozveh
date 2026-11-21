import { AiModelId, DeepReviewReportDto } from './bookTypes.ts';

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
  /** Legacy mirrors kept synced for backwards compatibility */
  personalGoogleApiKey: string;
  customBaseUrl: string;
  customApiKey: string;
  customModelId: string;
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
  presets?: Array<{ label: string; baseUrl: string; modelId: string }>;
}

export const AI_PROVIDER_METADATA: Record<AiProviderType, ProviderMetadata> = {
  google_aistudio: {
    id: 'google_aistudio',
    nameFa: 'Google Gemini (AI Studio)',
    shortName: 'Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-4-hydrogen',
    apiKeyPlaceholder: 'AIzaSy...',
    descriptionFa: 'مدل‌های منتخب هیدروژن ۴ و فلش ۳.۸ + پشتیبانی از جستجوی زنده گوگل، تبدیل صوت و سهمیه سازنده',
    supportsGoogleSearch: true,
  },
  openai: {
    id: 'openai',
    nameFa: 'OpenAI (GPT)',
    shortName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-4.1',
    apiKeyPlaceholder: 'sk-proj-...',
    descriptionFa: 'اتصال مستقیم به OpenAI (GPT-4.1 / GPT-4o / o4-mini) یا پروکسی‌های سازگار با Base URL دلخواه',
    supportsGoogleSearch: false,
    presets: [
      { label: 'GPT-4.1 (دقت بالا)', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4.1' },
      { label: 'GPT-4o Mini (اقتصادی)', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini' },
      { label: 'o4-mini (استدلالی)', baseUrl: 'https://api.openai.com/v1', modelId: 'o4-mini' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    nameFa: 'Anthropic (Claude Opus / Sonnet)',
    shortName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-opus-4-1-20250805',
    apiKeyPlaceholder: 'sk-ant-...',
    descriptionFa: 'اتصال مستقیم به Anthropic Claude Opus 4.1، Opus 4 و Sonnet 4 (Messages API) با پشتیبانی از Base URL سفارشی',
    supportsGoogleSearch: false,
    presets: [
      {
        label: 'Claude Opus 4.1 (قدرتمندترین)',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-opus-4-1-20250805',
      },
      {
        label: 'Claude Opus 4',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-opus-4-20250514',
      },
      {
        label: 'Claude Sonnet 4 (متعادل)',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-sonnet-4-20250514',
      },
      {
        label: 'Claude 3.7 Sonnet',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-3-7-sonnet-latest',
      },
      {
        label: 'Claude 3.5 Haiku (سریع)',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'claude-3-5-haiku-latest',
      },
    ],
  },
  custom_openai: {
    id: 'custom_openai',
    nameFa: 'درگاه سفارشی (OpenRouter / DeepSeek / Groq)',
    shortName: 'سفارشی',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModelId: 'anthropic/claude-opus-4',
    apiKeyPlaceholder: 'sk-or-...',
    descriptionFa: 'اتصال به هر مدل دلخواه (از جمله Claude Opus، GPT، DeepSeek و Llama) از طریق OpenRouter، AvalAI، Groq یا سرور HTTPS شما',
    supportsGoogleSearch: false,
    presets: [
      {
        label: 'OpenRouter · Claude Opus 4',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'anthropic/claude-opus-4',
      },
      {
        label: 'OpenRouter · GPT-4.1',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'openai/gpt-4.1',
      },
      {
        label: 'DeepSeek Reasoner (R1)',
        baseUrl: 'https://api.deepseek.com/v1',
        modelId: 'deepseek-reasoner',
      },
      {
        label: 'DeepSeek Chat',
        baseUrl: 'https://api.deepseek.com/v1',
        modelId: 'deepseek-chat',
      },
      {
        label: 'Groq (Llama 3.3 70B)',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelId: 'llama-3.3-70b-versatile',
      },
      {
        label: 'AvalAI (درگاه ایرانی)',
        baseUrl: 'https://api.avalai.ir/v1',
        modelId: 'claude-sonnet-4-20250514',
      },
    ],
  },
};

export const AI_PROVIDER_LIST: readonly ProviderMetadata[] = [
  AI_PROVIDER_METADATA.google_aistudio,
  AI_PROVIDER_METADATA.anthropic,
  AI_PROVIDER_METADATA.openai,
  AI_PROVIDER_METADATA.custom_openai,
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
      'ایده‌آل برای ترکیب با Claude Opus یا GPT: نگارش و تحلیل با مدل اصلی شما انجام می‌شود، اما راستی‌آزمایی اینترنتی با Google Search Grounding (سهمیه سازنده یا کلید Gemini شما) اجرا می‌شود.',
    needsOwnApiKey: false,
    presets: [
      { label: 'Gemini 4 Hydrogen + Google Search', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-4-hydrogen' },
      { label: 'Gemini 3.8 Flash + Google Search', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-3.8-flash' },
    ],
  },
  perplexity_sonar: {
    id: 'perplexity_sonar',
    nameFa: 'Perplexity Sonar (موتور جستجوی تخصصی)',
    shortName: 'Perplexity',
    defaultBaseUrl: 'https://api.perplexity.ai',
    defaultModelId: 'sonar-pro',
    apiKeyPlaceholder: 'pplx-...',
    descriptionFa:
      'جستجوی عمیق وب با استخراج خودکار لینک منابع معتبر (Citations) — بهترین مکمل پژوهشی در کنار Claude Opus.',
    needsOwnApiKey: true,
    presets: [
      { label: 'Sonar Pro (پژوهش دقیق)', baseUrl: 'https://api.perplexity.ai', modelId: 'sonar-pro' },
      { label: 'Sonar (سریع و اقتصادی)', baseUrl: 'https://api.perplexity.ai', modelId: 'sonar' },
      { label: 'Sonar Reasoning Pro', baseUrl: 'https://api.perplexity.ai', modelId: 'sonar-reasoning-pro' },
    ],
  },
  anthropic_web_search: {
    id: 'anthropic_web_search',
    nameFa: 'Anthropic Claude Web Search (بومی کلاد)',
    shortName: 'Claude Search',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-4-20250514',
    apiKeyPlaceholder: 'sk-ant-... (در صورت خالی بودن از کلید Anthropic اصلی استفاده می‌شود)',
    descriptionFa:
      'استفاده مستقیم از ابزار بومی web_search_20250305 در API رسمی Anthropic برای جستجوی آنلاین همراه با ارجاع منابع.',
    needsOwnApiKey: true,
    presets: [
      { label: 'Claude Sonnet 4 + Web Search', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-sonnet-4-20250514' },
      { label: 'Claude Opus 4.1 + Web Search', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-opus-4-1-20250805' },
    ],
  },
  openai_web_search: {
    id: 'openai_web_search',
    nameFa: 'OpenAI / OpenRouter Online Search',
    shortName: 'OpenAI / OR Online',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-4o-search-preview',
    apiKeyPlaceholder: 'sk-... یا sk-or-...',
    descriptionFa:
      'پشتیبانی از مدل‌های جستجوگر OpenAI (gpt-4o-search-preview) یا مدل‌های آنلاین OpenRouter با پسوند :online.',
    needsOwnApiKey: true,
    presets: [
      { label: 'OpenAI GPT-4o Search', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-search-preview' },
      { label: 'OpenAI GPT-4o Mini Search', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini-search-preview' },
      { label: 'OpenRouter Perplexity Online', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'perplexity/sonar-pro' },
      { label: 'OpenRouter GPT-4o :online', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'openai/gpt-4o:online' },
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
    nameFa: 'Google Gemini Transcribe (تبدیل ویس فارسی)',
    shortName: 'Gemini Audio',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-3.5-transcribe',
    apiKeyPlaceholder: 'AIzaSy... (اختیاری در صورت فعال بودن سهمیه سازنده)',
    descriptionFa:
      'تبدیل دقیق فایل‌های صوتی کارگاهی فارسی (MP3/WAV/M4A/OGG/WEBM) به متن همراه با شناخت اصطلاحات ECU و WinOLS — بدون نیاز به کلید اضافه هنگام فعال بودن سهمیه سازنده.',
    needsOwnApiKey: false,
    presets: [
      { label: 'Gemini 3.5 Transcribe (تخصصی صوت)', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-3.5-transcribe' },
      { label: 'Gemini 4 Hydrogen (چندرسانه‌ای)', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-4-hydrogen' },
    ],
  },
  openai_whisper: {
    id: 'openai_whisper',
    nameFa: 'OpenAI Whisper / GPT-4o Transcribe',
    shortName: 'OpenAI STT',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-4o-transcribe',
    apiKeyPlaceholder: 'sk-proj-... (در صورت خالی بودن از کلید OpenAI اصلی استفاده می‌شود)',
    descriptionFa:
      'ارسال مستقیم فایل صوتی به استاندارد /audio/transcriptions (مدل‌های gpt-4o-transcribe و whisper-1) با پرامپت تخصصی ریمپ.',
    needsOwnApiKey: true,
    presets: [
      { label: 'GPT-4o Transcribe (دقت بالا)', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-transcribe' },
      { label: 'Whisper-1 (استاندارد)', baseUrl: 'https://api.openai.com/v1', modelId: 'whisper-1' },
    ],
  },
  groq_whisper: {
    id: 'groq_whisper',
    nameFa: 'Groq Whisper Large v3 Turbo (فوق‌سریع)',
    shortName: 'Groq Whisper',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModelId: 'whisper-large-v3-turbo',
    apiKeyPlaceholder: 'gsk_...',
    descriptionFa:
      'تبدیل ویس‌های طولانی کارگاهی به متن فارسی با سرعت بسیار بالا و دقت عالی در اصطلاحات انگلیسی/فارسی (Whisper Large v3 Turbo).',
    needsOwnApiKey: true,
    presets: [
      { label: 'Whisper Large v3 Turbo (سریع)', baseUrl: 'https://api.groq.com/openai/v1', modelId: 'whisper-large-v3-turbo' },
      { label: 'Whisper Large v3 (حداکثر دقت)', baseUrl: 'https://api.groq.com/openai/v1', modelId: 'whisper-large-v3' },
    ],
  },
  custom_whisper: {
    id: 'custom_whisper',
    nameFa: 'سرور Whisper سفارشی (HTTPS)',
    shortName: 'Whisper سفارشی',
    defaultBaseUrl: 'https://api.avalai.ir/v1',
    defaultModelId: 'whisper-1',
    apiKeyPlaceholder: 'کلید API درگاه صوتی شما...',
    descriptionFa:
      'هر سرویس یا پروکسی HTTPS سازگار با استاندارد OpenAI /audio/transcriptions (مانند AvalAI، Fireworks یا سرور اختصاصی شما).',
    needsOwnApiKey: true,
    presets: [
      { label: 'AvalAI Whisper', baseUrl: 'https://api.avalai.ir/v1', modelId: 'whisper-1' },
      { label: 'Fireworks Whisper v3', baseUrl: 'https://audio-prod.us-virginia-1.direct.fireworks.ai/v1', modelId: 'whisper-v3' },
    ],
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
      modelId: AI_PROVIDER_METADATA.openai.defaultModelId,
    },
    anthropic: {
      baseUrl: AI_PROVIDER_METADATA.anthropic.defaultBaseUrl,
      apiKey: '',
      modelId: AI_PROVIDER_METADATA.anthropic.defaultModelId,
    },
    custom_openai: {
      baseUrl: AI_PROVIDER_METADATA.custom_openai.defaultBaseUrl,
      apiKey: '',
      modelId: AI_PROVIDER_METADATA.custom_openai.defaultModelId,
    },
  },
  webSearchRoute: { ...DEFAULT_WEB_SEARCH_ROUTE },
  audioRoute: { ...DEFAULT_AUDIO_ROUTE },
  personalGoogleApiKey: '',
  customBaseUrl: AI_PROVIDER_METADATA.custom_openai.defaultBaseUrl,
  customApiKey: '',
  customModelId: AI_PROVIDER_METADATA.custom_openai.defaultModelId,
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

export interface CapabilityRoutingPlan {
  primaryLabelFa: string;
  webSearchLabelFa: string;
  audioLabelFa: string;
  isHybrid: boolean;
}

export function resolveCapabilityRoutingPlan(
  config: AiProviderConfig,
  googleModelId: AiModelId
): CapabilityRoutingPlan {
  const primary = getProviderDisplaySummary(config, googleModelId);
  const searchRoute = getEffectiveWebSearchRoute(config);
  const audioRoute = getEffectiveAudioRoute(config);

  let webSearchLabelFa: string;
  if (searchRoute.provider === 'same_as_primary') {
    if (config.provider === 'anthropic') {
      webSearchLabelFa = 'Claude Web Search (بومی)';
    } else if (config.provider === 'google_aistudio') {
      webSearchLabelFa = 'Google Search (Gemini)';
    } else {
      webSearchLabelFa = 'Google Search (پشتیبان خودکار)';
    }
  } else {
    const sm = WEB_SEARCH_PROVIDER_METADATA[searchRoute.provider];
    webSearchLabelFa = `${sm.shortName} (${searchRoute.modelId})`;
  }

  const am = AUDIO_TRANSCRIBE_PROVIDER_METADATA[audioRoute.provider];
  const audioLabelFa = `${am.shortName} (${audioRoute.modelId})`;

  const isHybrid =
    config.provider !== 'google_aistudio' ||
    (searchRoute.provider !== 'same_as_primary' && searchRoute.provider !== 'google_gemini_search') ||
    audioRoute.provider !== 'google_gemini_audio';

  return {
    primaryLabelFa: `${primary.providerLabel} · ${primary.modelLabel}`,
    webSearchLabelFa,
    audioLabelFa,
    isHybrid,
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
      : creds.modelId || meta.defaultModelId;

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
  if (raw === 'gemini-3.8-flash' || raw === 'gemini-3.1-flash-lite') {
    return 'gemini-3.8-flash';
  }
  return 'gemini-4-hydrogen';
}

export function getGoogleModelMeta(modelId?: string | null): GoogleModelOption {
  const normalized = normalizeGoogleModelId(modelId);
  return (
    GOOGLE_MODEL_OPTIONS.find((m) => m.id === normalized) || GOOGLE_MODEL_OPTIONS[0]
  );
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
