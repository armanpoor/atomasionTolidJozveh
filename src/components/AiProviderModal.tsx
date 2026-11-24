import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Mic,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { AiModelId } from '../lib/bookTypes';
import {
  AI_PROVIDER_LIST,
  AI_PROVIDER_METADATA,
  AiProviderConfig,
  AiProviderType,
  AiQuotaProbeResponse,
  AUDIO_TRANSCRIBE_PROVIDER_LIST,
  AUDIO_TRANSCRIBE_PROVIDER_METADATA,
  AudioTranscribeProviderType,
  CustomModelProfile,
  DiscoveredProviderModel,
  getActiveProviderCredentials,
  getEffectiveAudioRoute,
  getEffectiveTierRouting,
  getEffectiveWebSearchRoute,
  GOOGLE_MODEL_OPTIONS,
  normalizeKeyAuthMode,
  OPENAI_COMPATIBLE_GATEWAY_TEMPLATES,
  resolveCapabilityRoutingPlan,
  sanitizeCustomModelId,
  validateCustomBaseUrl,
  WEB_SEARCH_PROVIDER_LIST,
  WEB_SEARCH_PROVIDER_METADATA,
  WebSearchProviderType,
} from '../lib/aiProviderConfig';
import { toPersianDigits } from '../lib/formatParsers';
import { MultiTierRoutingPanel } from './MultiTierRoutingPanel';

interface AiProviderModalProps {
  open: boolean;
  onClose: () => void;
  providerConfig: AiProviderConfig;
  aiModel: AiModelId;
  probeData: AiQuotaProbeResponse | null;
  probing: boolean;
  onSaveProviderConfig: (next: AiProviderConfig, nextGoogleModel?: AiModelId) => void;
  onRunLiveProbe: (overrideConfig?: AiProviderConfig, overrideModel?: AiModelId) => Promise<void>;
  onProbeModels?: (payload: {
    provider: AiProviderType;
    baseUrl?: string;
    apiKey?: string;
  }) => Promise<{
    ok: boolean;
    models: DiscoveredProviderModel[];
    baseUrlUsed?: string;
    error?: string;
  }>;
}

type ModalCapabilityTab = 'primary' | 'tiers' | 'search' | 'audio';

function syncLegacyConfigFields(cfg: AiProviderConfig): AiProviderConfig {
  const active = cfg.providers[cfg.provider];
  return {
    ...cfg,
    personalGoogleApiKey: cfg.providers.google_aistudio.apiKey,
    customBaseUrl: active.baseUrl,
    customApiKey: active.apiKey,
    customModelId: active.modelId,
  };
}

export const AiProviderModal: React.FC<AiProviderModalProps> = ({
  open,
  onClose,
  providerConfig,
  aiModel,
  probeData,
  probing,
  onSaveProviderConfig,
  onRunLiveProbe,
  onProbeModels,
}) => {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const [activeTab, setActiveTab] = useState<ModalCapabilityTab>('primary');
  const [draft, setDraft] = useState<AiProviderConfig>(providerConfig);
  const [draftModel, setDraftModel] = useState<AiModelId>(aiModel);
  const [showKey, setShowKey] = useState(false);
  const [showSearchKey, setShowSearchKey] = useState(false);
  const [showAudioKey, setShowAudioKey] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [probingModels, setProbingModels] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredProviderModel[]>([]);
  const [discoveryStatusMsg, setDiscoveryStatusMsg] = useState<string | null>(null);
  const [modelFilterQuery, setModelFilterQuery] = useState('');
  const [showCustomProfileForm, setShowCustomProfileForm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(providerConfig);
    setDraftModel(aiModel);
    setFormError(null);
    setDiscoveredModels([]);
    setDiscoveryStatusMsg(null);
    setModelFilterQuery('');
  }, [open, providerConfig, aiModel]);

  useEffect(() => {
    if (!open) return;
    const prevFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeBtnRef.current?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const activeMeta = AI_PROVIDER_METADATA[draft.provider];
  const activeCreds = getActiveProviderCredentials(draft);
  const authMode = normalizeKeyAuthMode(draft.googleKeyMode);
  const searchRoute = getEffectiveWebSearchRoute(draft);
  const searchMeta = WEB_SEARCH_PROVIDER_METADATA[searchRoute.provider];
  const audioRoute = getEffectiveAudioRoute(draft);
  const audioMeta = AUDIO_TRANSCRIBE_PROVIDER_METADATA[audioRoute.provider];
  const routingPlan = resolveCapabilityRoutingPlan(draft, draftModel);

  const creatorProbe =
    probeData?.creatorKeyProbe?.provider === draft.provider ? probeData.creatorKeyProbe : null;
  const activeProbe =
    probeData?.activeProbe?.provider === draft.provider ? probeData.activeProbe : null;
  const authDecision =
    probeData?.activeProbe?.provider === draft.provider ? probeData.authDecision : null;
  const creatorHasQuota = creatorProbe ? creatorProbe.hasQuota : null;
  const creatorIsBusy = creatorProbe?.status === 'busy';

  const updateProviderField = (
    providerId: AiProviderType,
    patch: Partial<{ baseUrl: string; apiKey: string; modelId: string }>
  ) => {
    setDraft((prev) =>
      syncLegacyConfigFields({
        ...prev,
        providers: {
          ...prev.providers,
          [providerId]: {
            ...prev.providers[providerId],
            ...patch,
          },
        },
      })
    );
    setFormError(null);
  };

  const selectProvider = (providerId: AiProviderType) => {
    setDraft((prev) =>
      syncLegacyConfigFields({
        ...prev,
        provider: providerId,
      })
    );
    setDiscoveredModels([]);
    setDiscoveryStatusMsg(null);
    setFormError(null);
  };

  const activeModelIdValue =
    draft.provider === 'google_aistudio'
      ? draftModel || activeCreds.modelId || activeMeta.defaultModelId
      : activeCreds.modelId;

  const activeCustomProfile: CustomModelProfile = draft.customModels?.[activeModelIdValue] || {
    modelId: activeModelIdValue,
    inputPerMillionUsd: 0.5,
    outputPerMillionUsd: 2.0,
    contextWindow: 128000,
    supportsJsonSchema: true,
    supportsPromptCaching: false,
    supportsTools: true,
  };

  const upsertCustomModelProfile = (patch: Partial<CustomModelProfile>) => {
    const cleanId = activeModelIdValue.trim();
    if (!cleanId) return;
    setDraft((prev) => ({
      ...prev,
      customModels: {
        ...(prev.customModels || {}),
        [cleanId]: {
          ...activeCustomProfile,
          ...patch,
          modelId: cleanId,
        },
      },
    }));
  };

  const handleDiscoverModels = async () => {
    if (!onProbeModels) return;
    const effectiveUrl = (activeCreds.baseUrl.trim() || activeMeta.defaultBaseUrl).replace(/\/+$/, '');
    const urlCheck = validateCustomBaseUrl(effectiveUrl);
    if (!urlCheck.valid) {
      setFormError(urlCheck.error || 'آدرس Base URL برای کشف مدل‌ها معتبر نیست.');
      return;
    }
    setFormError(null);
    setDiscoveryStatusMsg(null);
    setProbingModels(true);
    try {
      const res = await onProbeModels({
        provider: draft.provider,
        baseUrl: effectiveUrl,
        apiKey: activeCreds.apiKey.trim() || undefined,
      });
      if (!res.ok) {
        setDiscoveredModels([]);
        setDiscoveryStatusMsg(res.error || 'دریافت فهرست مدل‌ها از درگاه ناموفق بود.');
      } else {
        setDiscoveredModels(res.models || []);
        setDiscoveryStatusMsg(
          res.models.length > 0
            ? `${toPersianDigits(res.models.length)} مدل زنده از درگاه کشف شد. روی هر مدل کلیک کنید تا جایگزین شود.`
            : res.error || 'هیچ مدلی از درگاه برنگشت.'
        );
      }
    } catch (err) {
      setDiscoveryStatusMsg(
        err instanceof Error ? err.message : 'خطا در استعلام زنده /models از درگاه.'
      );
    } finally {
      setProbingModels(false);
    }
  };

  const updateSearchRoute = (
    patch: Partial<{
      provider: WebSearchProviderType;
      baseUrl: string;
      apiKey: string;
      modelId: string;
    }>
  ) => {
    setDraft((prev) => {
      const current = getEffectiveWebSearchRoute(prev);
      const nextProvider = patch.provider ?? current.provider;
      const switched = patch.provider && patch.provider !== current.provider;
      const nextMeta = WEB_SEARCH_PROVIDER_METADATA[nextProvider];
      return {
        ...prev,
        webSearchRoute: {
          provider: nextProvider,
          baseUrl: switched ? nextMeta.defaultBaseUrl : (patch.baseUrl ?? current.baseUrl),
          apiKey: patch.apiKey ?? current.apiKey,
          modelId: switched ? nextMeta.defaultModelId : (patch.modelId ?? current.modelId),
        },
      };
    });
    setFormError(null);
  };

  const updateAudioRoute = (
    patch: Partial<{
      provider: AudioTranscribeProviderType;
      baseUrl: string;
      apiKey: string;
      modelId: string;
    }>
  ) => {
    setDraft((prev) => {
      const current = getEffectiveAudioRoute(prev);
      const nextProvider = patch.provider ?? current.provider;
      const switched = patch.provider && patch.provider !== current.provider;
      const nextMeta = AUDIO_TRANSCRIBE_PROVIDER_METADATA[nextProvider];
      return {
        ...prev,
        audioRoute: {
          provider: nextProvider,
          baseUrl: switched ? nextMeta.defaultBaseUrl : (patch.baseUrl ?? current.baseUrl),
          apiKey: patch.apiKey ?? current.apiKey,
          modelId: switched ? nextMeta.defaultModelId : (patch.modelId ?? current.modelId),
        },
      };
    });
    setFormError(null);
  };

  const validateDraft = (): string | null => {
    const creds = getActiveProviderCredentials(draft);
    const effectiveUrl = creds.baseUrl.trim() || activeMeta.defaultBaseUrl;
    const urlCheck = validateCustomBaseUrl(effectiveUrl);
    if (!urlCheck.valid) {
      return urlCheck.error || 'آدرس Base URL مدل اصلی معتبر نیست.';
    }

    if (authMode === 'personal' && !creds.apiKey.trim()) {
      return `حالت «کلید اختصاصی من» برای ${activeMeta.shortName} انتخاب شده است. لطفاً API Key خود را وارد کنید یا حالت «ابتدا سهمیه سازنده» را برگزینید.`;
    }

    const activeChosenModel =
      draft.provider === 'google_aistudio' ? draftModel || creds.modelId : creds.modelId;
    if (!sanitizeCustomModelId(activeChosenModel)) {
      return `لطفاً شناسه مدل (Model ID) معتبر برای ${activeMeta.shortName} وارد کنید (حروف انگلیسی، اعداد و ./_:-).`;
    }

    // Validate Web Search custom Base URL if non-default selected
    if (searchRoute.provider !== 'same_as_primary') {
      const searchUrlCheck = validateCustomBaseUrl(searchRoute.baseUrl || searchMeta.defaultBaseUrl);
      if (!searchUrlCheck.valid) {
        return `آدرس Base URL جستجوی وب نامعتبر است: ${searchUrlCheck.error}`;
      }
      if (!sanitizeCustomModelId(searchRoute.modelId)) {
        return 'شناسه مدل انتخابی در تب جستجوی وب معتبر نیست.';
      }
    }

    // Validate Audio STT Base URL
    const audioUrlCheck = validateCustomBaseUrl(audioRoute.baseUrl || audioMeta.defaultBaseUrl);
    if (!audioUrlCheck.valid) {
      return `آدرس Base URL تبدیل ویس نامعتبر است: ${audioUrlCheck.error}`;
    }
    if (!sanitizeCustomModelId(audioRoute.modelId)) {
      return 'شناسه مدل انتخابی در تب تبدیل ویس به متن معتبر نیست.';
    }

    // Validate Multi-Tier Routing slots when enabled
    const tierRouting = getEffectiveTierRouting(draft);
    if (tierRouting.enabled) {
      for (const tierKey of ['economy', 'balanced', 'flagship'] as const) {
        const slot = tierRouting.tiers[tierKey];
        const slotMeta = AI_PROVIDER_METADATA[slot.provider];
        const slotUrlCheck = validateCustomBaseUrl(slot.baseUrl || slotMeta.defaultBaseUrl);
        if (!slotUrlCheck.valid) {
          return `آدرس Base URL سطح ${tierKey} نامعتبر است: ${slotUrlCheck.error}`;
        }
        if (!sanitizeCustomModelId(slot.modelId)) {
          return `شناسه مدل در سطح ${tierKey} معتبر نیست.`;
        }
      }
    }

    return null;
  };

  const buildNormalizedDraft = (): AiProviderConfig => {
    const creds = getActiveProviderCredentials(draft);
    const cleanedUrl = (creds.baseUrl.trim() || activeMeta.defaultBaseUrl).replace(/\/+$/, '');
    const tierRouting = getEffectiveTierRouting(draft);
    return syncLegacyConfigFields({
      ...draft,
      googleKeyMode: authMode,
      providers: {
        ...draft.providers,
        [draft.provider]: {
          baseUrl: cleanedUrl,
          apiKey: creds.apiKey.trim(),
          modelId:
            draft.provider === 'google_aistudio'
              ? draftModel.trim() || activeMeta.defaultModelId
              : creds.modelId.trim() || activeMeta.defaultModelId,
        },
      },
      webSearchRoute: {
        provider: searchRoute.provider,
        baseUrl: (searchRoute.baseUrl.trim() || searchMeta.defaultBaseUrl).replace(/\/+$/, ''),
        apiKey: searchRoute.apiKey.trim(),
        modelId: searchRoute.modelId.trim() || searchMeta.defaultModelId,
      },
      audioRoute: {
        provider: audioRoute.provider,
        baseUrl: (audioRoute.baseUrl.trim() || audioMeta.defaultBaseUrl).replace(/\/+$/, ''),
        apiKey: audioRoute.apiKey.trim(),
        modelId: audioRoute.modelId.trim() || audioMeta.defaultModelId,
      },
      tierRouting,
    });
  };

  const handleTestLive = async () => {
    const err = validateDraft();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    await onRunLiveProbe(buildNormalizedDraft(), draftModel);
  };

  const handleSave = async () => {
    const err = validateDraft();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const normalized = buildNormalizedDraft();
    onSaveProviderConfig(normalized, draftModel);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-[#1A1816]/50 p-3 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      dir="rtl"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#DDD7CB] bg-[#FCFBF8] text-[#1A1816] shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-[#E7E2D8] bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0 space-y-1">
            <h2
              id={titleId}
              className="text-base sm:text-lg font-extrabold tracking-tight text-[#1A1816]"
            >
              مسیریابی چندارائه‌دهنده‌ای هوش مصنوعی (مدل اصلی · جستجوی وب · تبدیل ویس)
            </h2>
            <p className="text-xs text-[#57534E] leading-5">
              می‌توانید برای هر وظیفه ارائه‌دهنده جداگانه وصل کنید؛ مثلاً نگارش با Claude Opus 4.1، جستجوی اینترنت با Perplexity یا Google Search، و تبدیل ویس با Groq Whisper یا Gemini Audio.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره تنظیمات ارائه‌دهنده"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E2DDD3] bg-[#FAF8F5] text-[#44403C] hover:bg-[#EFECE4] cursor-pointer"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </header>

        {/* 4-Slot Capability Navigation Tabs */}
        <nav
          aria-label="مسیریابی بر اساس وظیفه هوش مصنوعی"
          className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 border-b border-[#E7E2D8] bg-[#F5F2EB] px-5 py-2.5 sm:px-6"
        >
          <button
            type="button"
            onClick={() => setActiveTab('primary')}
            className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'primary'
                ? 'border-[#1E3A5F] bg-white text-[#1E3A5F] shadow-xs'
                : 'border-transparent text-[#57534E] hover:bg-white/60 hover:text-[#1A1816]'
            }`}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">۱. مدل اصلی</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tiers')}
            className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'tiers'
                ? 'border-[#1E3A5F] bg-white text-[#1E3A5F] shadow-xs'
                : 'border-transparent text-[#57534E] hover:bg-white/60 hover:text-[#1A1816]'
            }`}
          >
            <Layers className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">۲. سطوح مدل و توکن</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'search'
                ? 'border-[#1E3A5F] bg-white text-[#1E3A5F] shadow-xs'
                : 'border-transparent text-[#57534E] hover:bg-white/60 hover:text-[#1A1816]'
            }`}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">۳. جستجوی وب</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audio')}
            className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'audio'
                ? 'border-[#1E3A5F] bg-white text-[#1E3A5F] shadow-xs'
                : 'border-transparent text-[#57534E] hover:bg-white/60 hover:text-[#1A1816]'
            }`}
          >
            <Mic className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">۴. تبدیل ویس</span>
          </button>
        </nav>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 space-y-5 text-xs">
          {/* =============================================================== */}
          {/* TAB 2: MULTI-TIER MODEL ROUTING & TOKEN OPTIMIZATION ENGINE     */}
          {/* =============================================================== */}
          {activeTab === 'tiers' && (
            <MultiTierRoutingPanel
              draft={draft}
              onChangeDraft={(updater) => {
                setDraft((prev) => syncLegacyConfigFields(updater(prev)));
                setFormError(null);
              }}
            />
          )}

          {/* =============================================================== */}
          {/* TAB 1: PRIMARY REASONING / WRITING / DEEP REVIEW / CHAT ENGINE  */}
          {/* =============================================================== */}
          {activeTab === 'primary' && (
            <>
              <div className="space-y-2">
                <div className="font-bold text-[#1A1816]">
                  انتخاب ارائه‌دهنده اصلی (نگارش، بازبینی عمیق و چت‌بات سردبیر)
                </div>
                <div
                  className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                  role="tablist"
                  aria-label="ارائه‌دهندگان مدل اصلی"
                >
                  {AI_PROVIDER_LIST.map((p) => {
                    const selected = draft.provider === p.id;
                    const hasPersonalKey = Boolean(draft.providers[p.id]?.apiKey?.trim());
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => selectProvider(p.id)}
                        className={`rounded-xl border px-3 py-2.5 text-right transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                            : 'border-[#E2DDD3] bg-white text-[#1A1816] hover:border-[#CFC8B9]'
                        }`}
                      >
                        <div className="font-extrabold text-xs truncate">{p.shortName}</div>
                        <div className="mt-0.5 text-[10.5px] text-[#57534E] truncate">
                          {hasPersonalKey
                            ? 'کلید شخصی ثبت شده'
                            : p.id === 'anthropic'
                              ? 'Claude Opus 4.1'
                              : p.id === 'google_aistudio'
                                ? 'پیش‌فرض'
                                : 'قابل تنظیم'}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[#57534E] leading-5">{activeMeta.descriptionFa}</p>
              </div>

              <div className="space-y-4 rounded-xl border border-[#E2DDD3] bg-white p-4">
                {/* Live App Owner Status — Friendly Persian Messages Only (No Raw JSON!) */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 ${
                    creatorIsBusy
                      ? 'border-[#E8D5B0] bg-[#FDF8EC]'
                      : 'border-[#E5E0D6] bg-[#FAF9F6]'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5 flex-1">
                    <div className="flex items-center gap-1.5 font-bold text-[#1A1816]">
                      {probing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E3A5F]" />
                      ) : creatorHasQuota === true ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#14532D]" />
                      ) : creatorIsBusy ? (
                        <AlertCircle className="h-3.5 w-3.5 text-[#92400E]" />
                      ) : creatorHasQuota === false ? (
                        <AlertCircle className="h-3.5 w-3.5 text-[#9A3412]" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-[#1E3A5F]" />
                      )}
                      <span>
                        استعلام لحظه‌ای سهمیه سازنده ({activeMeta.shortName}):{' '}
                        <span
                          className={
                            creatorHasQuota === true
                              ? 'text-[#14532D]'
                              : creatorIsBusy
                                ? 'text-[#92400E]'
                                : creatorHasQuota === false
                                  ? 'text-[#9A3412]'
                                  : 'text-[#57534E]'
                          }
                        >
                          {probing
                            ? 'در حال استعلام...'
                            : creatorProbe?.statusLabelFa || 'برای بررسی دکمه استعلام را بزنید'}
                        </span>
                      </span>
                    </div>
                    {creatorProbe?.detailFa && (
                      <p className="text-[11px] text-[#57534E] leading-5">{creatorProbe.detailFa}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleTestLive()}
                    disabled={probing}
                    className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-white px-3 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
                    <span>استعلام زنده</span>
                  </button>
                </div>

                {/* Auth Mode */}
                <div className="space-y-2">
                  <div className="font-bold text-[#1A1816]">منطق احراز هویت و اولویت کلید</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer ${
                        authMode === 'auto_creator_first'
                          ? 'border-[#1E3A5F] bg-[#F4F7FB]'
                          : 'border-[#E5E0D6] bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="providerAuthMode"
                        checked={authMode === 'auto_creator_first'}
                        onChange={() => {
                          setDraft((p) => ({ ...p, googleKeyMode: 'auto_creator_first' }));
                          setFormError(null);
                        }}
                        className="mt-0.5 h-4 w-4 accent-[#1E3A5F]"
                      />
                      <div className="space-y-0.5">
                        <div className="font-bold text-[#1A1816]">
                          هوشمند: سهمیه سازنده ← کلید من
                        </div>
                        <p className="text-[10.5px] text-[#57534E] leading-4">
                          ابتدا سهمیه سازنده بررسی می‌شود و در صورت اتمام یا عدم تنظیم، خودکار روی کلید شما سوئیچ می‌کند.
                        </p>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer ${
                        authMode === 'personal'
                          ? 'border-[#1E3A5F] bg-[#F4F7FB]'
                          : 'border-[#E5E0D6] bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="providerAuthMode"
                        checked={authMode === 'personal'}
                        onChange={() => {
                          setDraft((p) => ({ ...p, googleKeyMode: 'personal' }));
                          setFormError(null);
                        }}
                        className="mt-0.5 h-4 w-4 accent-[#1E3A5F]"
                      />
                      <div className="space-y-0.5">
                        <div className="font-bold text-[#1A1816]">
                          انحصاری با کلید اختصاصی من
                        </div>
                        <p className="text-[10.5px] text-[#57534E] leading-4">
                          همه درخواست‌ها مستقیماً از طریق Base URL و API Key اختصاصی خودتان ارسال شوند.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Gateway Base URL Templates (Iranian & Global Proxies — preserves chosen Model ID) */}
                {(activeMeta.baseUrlTemplates?.length ||
                  draft.provider === 'openai' ||
                  draft.provider === 'custom_openai') && (
                  <div className="space-y-1.5 border-t border-[#EFECE4] pt-3">
                    <div className="text-[11px] font-bold text-[#57534E]">
                      درگاه‌های آماده (ایرانی و بین‌المللی — تغییر Base URL بدون حذف مدل):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(activeMeta.baseUrlTemplates && activeMeta.baseUrlTemplates.length > 0
                        ? activeMeta.baseUrlTemplates
                        : OPENAI_COMPATIBLE_GATEWAY_TEMPLATES
                      ).map((gw) => {
                        const isPicked =
                          activeCreds.baseUrl.replace(/\/+$/, '') === gw.baseUrl.replace(/\/+$/, '');
                        return (
                          <button
                            key={gw.label}
                            type="button"
                            onClick={() =>
                              updateProviderField(draft.provider, { baseUrl: gw.baseUrl })
                            }
                            className={`rounded-md border px-2.5 py-1 text-[10.5px] font-semibold transition-colors cursor-pointer ${
                              isPicked
                                ? 'border-[#14532D] bg-[#14532D] text-white'
                                : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#1A1816] hover:bg-[#EEF3F8]'
                            }`}
                          >
                            {gw.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quick Presets */}
                {activeMeta.presets && activeMeta.presets.length > 0 && (
                  <div className="space-y-1.5 border-t border-[#EFECE4] pt-3">
                    <div className="text-[11px] font-bold text-[#57534E]">
                      پیش‌تنظیم سریع مدل برای {activeMeta.shortName}:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeMeta.presets.map((preset) => {
                        const currentSelectedModel =
                          draft.provider === 'google_aistudio' ? draftModel : activeCreds.modelId;
                        const isPicked = currentSelectedModel === preset.modelId;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              if (draft.provider === 'google_aistudio') {
                                setDraftModel(preset.modelId);
                              }
                              updateProviderField(draft.provider, {
                                modelId: preset.modelId,
                                ...(preset.baseUrl &&
                                (!activeCreds.baseUrl.trim() ||
                                  activeCreds.baseUrl.trim() === activeMeta.defaultBaseUrl)
                                  ? { baseUrl: preset.baseUrl }
                                  : {}),
                              });
                            }}
                            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                              isPicked
                                ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                                : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#1E3A5F] hover:bg-[#EEF3F8]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Base URL */}
                <div className="space-y-1.5 border-t border-[#EFECE4] pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="provider-base-url" className="font-bold text-[#1A1816]">
                      آدرس سرور (Base URL — فقط HTTPS)
                    </label>
                    {activeCreds.baseUrl.trim() !== activeMeta.defaultBaseUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          updateProviderField(draft.provider, { baseUrl: activeMeta.defaultBaseUrl })
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        بازنشانی پیش‌فرض
                      </button>
                    )}
                  </div>
                  <input
                    id="provider-base-url"
                    type="url"
                    dir="ltr"
                    placeholder={activeMeta.defaultBaseUrl}
                    value={activeCreds.baseUrl}
                    onChange={(e) =>
                      updateProviderField(draft.provider, { baseUrl: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                  />
                </div>

                {/* API Key */}
                <div className="space-y-1.5">
                  <label htmlFor="provider-api-key" className="block font-bold text-[#1A1816]">
                    کلید اختصاصی شما (API Key — {activeMeta.shortName})
                  </label>
                  <div className="relative">
                    <input
                      id="provider-api-key"
                      type={showKey ? 'text' : 'password'}
                      dir="ltr"
                      autoComplete="off"
                      placeholder={activeMeta.apiKeyPlaceholder}
                      value={activeCreds.apiKey}
                      onChange={(e) =>
                        updateProviderField(draft.provider, { apiKey: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 pl-10 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? 'مخفی کردن کلید' : 'نمایش کلید'}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-[#57534E] hover:text-[#1A1816] cursor-pointer"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Open Free-Text Model ID Input + Live /models Discovery + Custom Profile */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor={draft.provider === 'google_aistudio' ? 'modal-google-model' : 'provider-model-id'}
                      className="font-bold text-[#1A1816]"
                    >
                      شناسه مدل (Model ID — انتخاب آزاد هر مدل جدید یا ایرانی)
                    </label>
                    {onProbeModels && (
                      <button
                        type="button"
                        disabled={probingModels}
                        onClick={() => void handleDiscoverModels()}
                        className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-[#1E3A5F]/40 bg-[#EEF3F8] px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] disabled:opacity-50 cursor-pointer"
                      >
                        {probingModels ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Search className="h-3 w-3" />
                        )}
                        <span>کشف زنده مدل‌ها (/models)</span>
                      </button>
                    )}
                  </div>

                  {draft.provider === 'google_aistudio' && (
                    <div className="flex flex-wrap gap-1.5">
                      {GOOGLE_MODEL_OPTIONS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setDraftModel(m.id);
                            updateProviderField('google_aistudio', { modelId: m.id });
                          }}
                          className={`rounded-md border px-2 py-1 text-[10.5px] font-semibold cursor-pointer ${
                            draftModel === m.id
                              ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                              : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#44403C] hover:bg-[#EEF3F8]'
                          }`}
                        >
                          {m.labelFa}
                        </button>
                      ))}
                    </div>
                  )}

                  <input
                    id={draft.provider === 'google_aistudio' ? 'modal-google-model' : 'provider-model-id'}
                    type="text"
                    dir="ltr"
                    placeholder={activeMeta.defaultModelId}
                    value={activeModelIdValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (draft.provider === 'google_aistudio') {
                        setDraftModel(val);
                      }
                      updateProviderField(draft.provider, { modelId: val });
                    }}
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                  />

                  {/* Live Discovered Models Drawer */}
                  {(discoveryStatusMsg || discoveredModels.length > 0) && (
                    <div className="rounded-lg border border-[#DCE5F0] bg-[#F8FAFC] p-2.5 space-y-2">
                      {discoveryStatusMsg && (
                        <div className="text-[11px] font-semibold text-[#1E3A5F]">
                          {discoveryStatusMsg}
                        </div>
                      )}
                      {discoveredModels.length > 0 && (
                        <>
                          <input
                            type="text"
                            dir="ltr"
                            value={modelFilterQuery}
                            onChange={(e) => setModelFilterQuery(e.target.value)}
                            placeholder="Filter discovered models (e.g. claude, gpt, gemini, deepseek)..."
                            className="w-full rounded border border-[#CBD5E1] bg-white px-2.5 py-1 font-mono text-[11px] text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                          />
                          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto" dir="ltr">
                            {discoveredModels
                              .filter(
                                (m) =>
                                  !modelFilterQuery.trim() ||
                                  m.id.toLowerCase().includes(modelFilterQuery.trim().toLowerCase()) ||
                                  (m.name || '').toLowerCase().includes(modelFilterQuery.trim().toLowerCase())
                              )
                              .slice(0, 80)
                              .map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    if (draft.provider === 'google_aistudio') {
                                      setDraftModel(m.id);
                                    }
                                    updateProviderField(draft.provider, { modelId: m.id });
                                  }}
                                  className={`rounded border px-2 py-0.5 font-mono text-[10.5px] cursor-pointer ${
                                    activeModelIdValue === m.id
                                      ? 'border-[#14532D] bg-[#14532D] text-white'
                                      : 'border-[#CBD5E1] bg-white text-[#1E3A5F] hover:bg-[#EEF3F8]'
                                  }`}
                                >
                                  {m.id}
                                  {m.contextLength ? ` (${Math.round(m.contextLength / 1000)}k)` : ''}
                                </button>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Collapsible Custom Pricing & Capabilities Form */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCustomProfileForm((v) => !v)}
                      className="text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                    >
                      {showCustomProfileForm
                        ? 'بستن تنظیمات نرخ و قابلیت مدل سفارشی ▲'
                        : 'تنظیم نرخ دلاری ($/1M) و قابلیت‌های این مدل (JSON Schema / Caching / Tools) ▼'}
                    </button>

                    {showCustomProfileForm && (
                      <div className="mt-2 rounded-lg border border-[#E2DDD3] bg-[#FAF9F6] p-3 space-y-2.5">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="space-y-1 text-[10.5px] font-bold text-[#44403C]">
                            <span>نرخ ورودی ($ / 1M توکن)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.05"
                              dir="ltr"
                              value={activeCustomProfile.inputPerMillionUsd}
                              onChange={(e) =>
                                upsertCustomModelProfile({
                                  inputPerMillionUsd: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="w-full rounded border border-[#D6D0C4] bg-white px-2 py-1 font-mono text-xs"
                            />
                          </label>
                          <label className="space-y-1 text-[10.5px] font-bold text-[#44403C]">
                            <span>نرخ خروجی ($ / 1M توکن)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.05"
                              dir="ltr"
                              value={activeCustomProfile.outputPerMillionUsd}
                              onChange={(e) =>
                                upsertCustomModelProfile({
                                  outputPerMillionUsd: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="w-full rounded border border-[#D6D0C4] bg-white px-2 py-1 font-mono text-xs"
                            />
                          </label>
                          <label className="space-y-1 text-[10.5px] font-bold text-[#44403C]">
                            <span>پنجره کانتکست (Context)</span>
                            <input
                              type="number"
                              min="4096"
                              step="4096"
                              dir="ltr"
                              value={activeCustomProfile.contextWindow ?? 128000}
                              onChange={(e) =>
                                upsertCustomModelProfile({
                                  contextWindow: Math.max(4096, Number(e.target.value) || 128000),
                                })
                              }
                              className="w-full rounded border border-[#D6D0C4] bg-white px-2 py-1 font-mono text-xs"
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-3 text-[11px] text-[#334155]">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={activeCustomProfile.supportsJsonSchema !== false}
                              onChange={(e) =>
                                upsertCustomModelProfile({ supportsJsonSchema: e.target.checked })
                              }
                              className="h-3.5 w-3.5 accent-[#1E3A5F]"
                            />
                            <span>پشتیبانی از Structured JSON Schema</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(activeCustomProfile.supportsPromptCaching)}
                              onChange={(e) =>
                                upsertCustomModelProfile({ supportsPromptCaching: e.target.checked })
                              }
                              className="h-3.5 w-3.5 accent-[#1E3A5F]"
                            />
                            <span>پشتیبانی از Prompt Caching</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={activeCustomProfile.supportsTools !== false}
                              onChange={(e) =>
                                upsertCustomModelProfile({ supportsTools: e.target.checked })
                              }
                              className="h-3.5 w-3.5 accent-[#1E3A5F]"
                            />
                            <span>پشتیبانی از Tool Calling (چت سردبیر)</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] leading-5 text-[#57534E]">
                    می‌توانید هر شناسه مدلی را مستقیماً تایپ کنید و در تب‌های «جستجوی وب» و «تبدیل ویس» موتورهای جداگانه تنظیم نمایید.
                  </p>
                </div>
              </div>

              {/* Auth Decision & Active Live Probe Result */}
              {authDecision && (
                <div
                  className={`rounded-xl border p-3.5 space-y-1.5 text-xs ${
                    activeProbe?.hasQuota
                      ? 'border-[#C7DDD0] bg-[#F2F7F4] text-[#14532D]'
                      : activeProbe?.status === 'busy'
                        ? 'border-[#E8D5B0] bg-[#FDF8EC] text-[#92400E]'
                        : 'border-[#E6BFB7] bg-[#FDF2F0] text-[#9A3412]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-bold">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        مسیر فعال فعلی:{' '}
                        {activeProbe?.keySource === 'creator'
                          ? 'سهمیه سازنده (App Owner)'
                          : activeProbe?.switchedFromCreator
                            ? 'سوئیچ خودکار به کلید اختصاصی شما'
                            : authDecision.selectedKeySource === 'personal'
                              ? 'کلید اختصاصی شما'
                              : activeProbe?.status === 'busy'
                                ? 'شلوغی موقت سرور (پیشنهاد: تلاش مجدد یا فلش ۳.۸)'
                                : 'نیازمند ثبت کلید اختصاصی'}
                      </span>
                    </span>
                    {activeProbe && (
                      <span className="tabular-nums text-[11px]">
                        {toPersianDigits(activeProbe.latencyMs)} میلی‌ثانیه
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-5">{authDecision.reasonFa}</p>
                  {activeProbe?.detailFa && (
                    <p className="text-[11px] leading-5 opacity-95">{activeProbe.detailFa}</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* =============================================================== */}
          {/* TAB 2: DEDICATED WEB SEARCH / GROUNDING PROVIDER                */}
          {/* =============================================================== */}
          {activeTab === 'search' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="font-bold text-[#1A1816]">
                  موتور اختصاصی جستجوی زنده اینترنت و راستی‌آزمایی منابع (Web Grounding)
                </div>
                <p className="text-[11px] text-[#57534E] leading-5">
                  حتی اگر مدل اصلی شما Claude Opus یا GPT باشد، می‌توانید جستجوی زنده اینترنت (راستی‌آزمایی تناقض‌ها، غنی‌سازی فصل‌ها و جستجو در چت) را به Perplexity Sonar، Google Search، Claude Web Search یا OpenRouter Online بسپارید.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {WEB_SEARCH_PROVIDER_LIST.map((sp) => {
                    const selected = searchRoute.provider === sp.id;
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => updateSearchRoute({ provider: sp.id })}
                        className={`rounded-xl border px-3 py-2.5 text-right transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                            : 'border-[#E2DDD3] bg-white text-[#1A1816] hover:border-[#CFC8B9]'
                        }`}
                      >
                        <div className="font-extrabold text-xs">{sp.shortName}</div>
                        <div className="mt-0.5 text-[10.5px] text-[#57534E] line-clamp-1">
                          {sp.id === 'same_as_primary'
                            ? 'تشخیص هوشمند'
                            : sp.id === 'perplexity_sonar'
                              ? 'sonar-pro + Citations'
                              : sp.id === 'anthropic_web_search'
                                ? 'web_search_20250305'
                                : sp.defaultModelId}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-[#E2DDD3] bg-white p-4">
                <p className="text-[11.5px] text-[#44403C] leading-6 bg-[#FAF9F6] rounded-lg border border-[#ECE7DD] p-3">
                  {searchMeta.descriptionFa}
                </p>

                {searchRoute.provider !== 'same_as_primary' && (
                  <>
                    {searchMeta.presets && searchMeta.presets.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-[#57534E]">
                          پیش‌تنظیم سریع برای {searchMeta.shortName}:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {searchMeta.presets.map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() =>
                                updateSearchRoute({
                                  baseUrl: preset.baseUrl,
                                  modelId: preset.modelId,
                                })
                              }
                              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                                searchRoute.modelId === preset.modelId
                                  ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                                  : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#1E3A5F] hover:bg-[#EEF3F8]'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label htmlFor="search-base-url" className="block font-bold text-[#1A1816]">
                        آدرس سرور جستجو (Base URL — HTTPS)
                      </label>
                      <input
                        id="search-base-url"
                        type="url"
                        dir="ltr"
                        placeholder={searchMeta.defaultBaseUrl}
                        value={searchRoute.baseUrl}
                        onChange={(e) => updateSearchRoute({ baseUrl: e.target.value })}
                        className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="search-api-key" className="block font-bold text-[#1A1816]">
                        کلید API جستجو ({searchMeta.shortName})
                      </label>
                      <div className="relative">
                        <input
                          id="search-api-key"
                          type={showSearchKey ? 'text' : 'password'}
                          dir="ltr"
                          autoComplete="off"
                          placeholder={searchMeta.apiKeyPlaceholder}
                          value={searchRoute.apiKey}
                          onChange={(e) => updateSearchRoute({ apiKey: e.target.value })}
                          className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 pl-10 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSearchKey((v) => !v)}
                          aria-label={showSearchKey ? 'مخفی کردن کلید جستجو' : 'نمایش کلید جستجو'}
                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-[#57534E] hover:text-[#1A1816] cursor-pointer"
                        >
                          {showSearchKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="search-model-id" className="block font-bold text-[#1A1816]">
                        شناسه مدل جستجو (Model ID)
                      </label>
                      <input
                        id="search-model-id"
                        type="text"
                        dir="ltr"
                        placeholder={searchMeta.defaultModelId}
                        value={searchRoute.modelId}
                        onChange={(e) => updateSearchRoute({ modelId: e.target.value })}
                        className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 3: DEDICATED AUDIO / VOICE-TO-TEXT TRANSCRIPTION PROVIDER   */}
          {/* =============================================================== */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="font-bold text-[#1A1816]">
                  موتور اختصاصی آپلود ویس و تبدیل صوت کارگاهی به متن (Speech-to-Text)
                </div>
                <p className="text-[11px] text-[#57534E] leading-5">
                  برای تبدیل ویس‌های آموزشی و کارگاهی (فرمت‌های MP3، WAV، M4A، OGG، WEBM و FLAC) به متن جزوه در مرحله ۱ یا ارسال ویس در چت‌بات، می‌توانید از Gemini Audio، Groq Whisper Turbo، OpenAI Whisper یا سرور Whisper سفارشی استفاده کنید.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {AUDIO_TRANSCRIBE_PROVIDER_LIST.map((ap) => {
                    const selected = audioRoute.provider === ap.id;
                    return (
                      <button
                        key={ap.id}
                        type="button"
                        onClick={() => updateAudioRoute({ provider: ap.id })}
                        className={`rounded-xl border px-3 py-2.5 text-right transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                            : 'border-[#E2DDD3] bg-white text-[#1A1816] hover:border-[#CFC8B9]'
                        }`}
                      >
                        <div className="font-extrabold text-xs truncate">{ap.shortName}</div>
                        <div className="mt-0.5 text-[10.5px] text-[#57534E] truncate">
                          {ap.defaultModelId}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-[#E2DDD3] bg-white p-4">
                <p className="text-[11.5px] text-[#44403C] leading-6 bg-[#FAF9F6] rounded-lg border border-[#ECE7DD] p-3">
                  {audioMeta.descriptionFa}
                </p>

                {audioMeta.presets && audioMeta.presets.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold text-[#57534E]">
                      پیش‌تنظیم سریع برای {audioMeta.shortName}:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {audioMeta.presets.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            updateAudioRoute({
                              baseUrl: preset.baseUrl,
                              modelId: preset.modelId,
                            })
                          }
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                            audioRoute.modelId === preset.modelId
                              ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                              : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#1E3A5F] hover:bg-[#EEF3F8]'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="audio-base-url" className="block font-bold text-[#1A1816]">
                    آدرس سرور تبدیل صوت (Base URL — HTTPS)
                  </label>
                  <input
                    id="audio-base-url"
                    type="url"
                    dir="ltr"
                    placeholder={audioMeta.defaultBaseUrl}
                    value={audioRoute.baseUrl}
                    onChange={(e) => updateAudioRoute({ baseUrl: e.target.value })}
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="audio-api-key" className="block font-bold text-[#1A1816]">
                    کلید API تبدیل صوت ({audioMeta.shortName})
                  </label>
                  <div className="relative">
                    <input
                      id="audio-api-key"
                      type={showAudioKey ? 'text' : 'password'}
                      dir="ltr"
                      autoComplete="off"
                      placeholder={audioMeta.apiKeyPlaceholder}
                      value={audioRoute.apiKey}
                      onChange={(e) => updateAudioRoute({ apiKey: e.target.value })}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 pl-10 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAudioKey((v) => !v)}
                      aria-label={showAudioKey ? 'مخفی کردن کلید صوت' : 'نمایش کلید صوت'}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-[#57534E] hover:text-[#1A1816] cursor-pointer"
                    >
                      {showAudioKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="audio-model-id" className="block font-bold text-[#1A1816]">
                    شناسه مدل تبدیل ویس (Model ID)
                  </label>
                  <input
                    id="audio-model-id"
                    type="text"
                    dir="ltr"
                    placeholder={audioMeta.defaultModelId}
                    value={audioRoute.modelId}
                    onChange={(e) => updateAudioRoute({ modelId: e.target.value })}
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                  />
                  <p className="text-[10.5px] text-[#78716C]">
                    واژگان تخصصی ریمپ (WinOLS، LAMFA، KFZW، ME7.4.4، AFR، RPM، Checksum) به‌طور خودکار به عنوان راهنمای دیکته به مدل ارسال می‌شوند.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Active Multi-Route Capability Summary Strip */}
          <div className="rounded-xl border border-[#D8E2EE] bg-[#F4F7FB] px-3.5 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold text-[#1E3A5F]">
              <span>خلاصه معماری فعال هوش مصنوعی شما</span>
              {routingPlan.tierRoutingEnabled ? (
                <span className="text-[10.5px] font-bold text-[#14532D]">
                  مسیریابی هوشمند ۳ سطحی فعال
                </span>
              ) : routingPlan.isHybrid ? (
                <span className="text-[10.5px] font-bold text-[#14532D]">
                  ترکیبی چندارائه‌دهنده‌ای (Hybrid)
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-[#334155]">
              <div className="rounded-lg border border-[#DCE5F0] bg-white px-2.5 py-1.5">
                <div className="text-[10px] text-[#64748B]">نگارش و تحلیل:</div>
                <div className="font-bold text-[#1A1816] truncate" dir="ltr">
                  {routingPlan.primaryLabelFa}
                </div>
              </div>
              <div className="rounded-lg border border-[#DCE5F0] bg-white px-2.5 py-1.5">
                <div className="text-[10px] text-[#64748B]">جستجوی زنده وب:</div>
                <div className="font-bold text-[#1A1816] truncate" dir="ltr">
                  {routingPlan.webSearchLabelFa}
                </div>
              </div>
              <div className="rounded-lg border border-[#DCE5F0] bg-white px-2.5 py-1.5">
                <div className="text-[10px] text-[#64748B]">تبدیل ویس به متن:</div>
                <div className="font-bold text-[#1A1816] truncate" dir="ltr">
                  {routingPlan.audioLabelFa}
                </div>
              </div>
            </div>
            {routingPlan.tierRoutingEnabled && (
              <div className="rounded-lg border border-[#CBE0D2] bg-[#F2F7F4] px-2.5 py-1.5 text-[10.5px] font-semibold text-[#14532D] truncate">
                {routingPlan.tierSummaryFa}
              </div>
            )}
          </div>

          {/* Security Reassurance */}
          <div className="flex items-start gap-2 rounded-lg border border-[#E2DDD3] bg-white px-3.5 py-2.5 text-[11px] text-[#57534E] leading-5">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-[#1E3A5F]" />
            <span>
              تمامی کلیدهای API اختصاصی (مدل اصلی، جستجوی وب و تبدیل ویس) فقط در حافظه موقت همین نشست مرورگر نگهداری می‌شوند، هرگز در پایگاه داده یا localStorage ذخیره نمی‌گردند و صرفاً به سرورهای عمومی HTTPS ارسال می‌شوند.
            </span>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg border border-[#E6BFB7] bg-[#FDF2F0] px-3.5 py-2.5 text-xs text-[#9A3412]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E7E2D8] bg-white px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => void handleTestLive()}
            disabled={probing}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-white px-3.5 py-2 text-xs font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer"
          >
            {probing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            <span>تست اتصال مدل اصلی</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-[#D6D0C4] bg-white px-4 py-2 text-xs font-semibold text-[#44403C] hover:bg-[#FAF9F6] cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-[#1E3A5F] px-5 py-2 text-xs font-bold text-white hover:bg-[#162C49] cursor-pointer"
            >
              ذخیره و فعال‌سازی مسیرها
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
};
