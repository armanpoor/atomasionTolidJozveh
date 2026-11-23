import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coins,
  Cpu,
  Eye,
  EyeOff,
  Layers,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  Zap,
} from 'lucide-react';
import {
  AI_PROVIDER_LIST,
  AI_PROVIDER_METADATA,
  AI_TASK_METADATA,
  AiProviderConfig,
  AiProviderType,
  AiTaskType,
  applyMultiTierRecipe,
  getEffectiveTierRouting,
  MODEL_TIER_METADATA,
  ModelTierId,
  MULTI_TIER_RECIPES,
  MultiTierRoutingConfig,
  TierModelSlotConfig,
  TokenOptimizationMode,
} from '../lib/aiProviderConfig';
import {
  estimateMultiTierPipelineCost,
  formatUsdClean,
  lookupModelPricing,
} from '../lib/tokenOptimizer';
import { toPersianDigits } from '../lib/formatParsers';

interface MultiTierRoutingPanelProps {
  draft: AiProviderConfig;
  onChangeDraft: (updater: (prev: AiProviderConfig) => AiProviderConfig) => void;
}

const TIER_ORDER: readonly ModelTierId[] = ['economy', 'balanced', 'flagship'] as const;

const COST_CAP_PRESETS: Array<{ value: number | null; labelFa: string }> = [
  { value: 0.5, labelFa: '$0.50' },
  { value: 2.0, labelFa: '$2.00' },
  { value: 5.0, labelFa: '$5.00' },
  { value: 15.0, labelFa: '$15.00' },
  { value: null, labelFa: 'نامحدود' },
];

const OPT_MODES: Array<{
  id: TokenOptimizationMode;
  titleFa: string;
  descFa: string;
}> = [
  {
    id: 'aggressive_saver',
    titleFa: 'صرفه‌جویی حداکثری',
    descFa: 'فشرده‌سازی قوی (حدود ۵۲٪ کاهش توکن ورودی) — عالی برای Opus و کلیدهای پولی',
  },
  {
    id: 'balanced_pro',
    titleFa: 'متعادل حرفه‌ای (پیشنهادی)',
    descFa: 'حفظ ۱۰۰٪ آدرس‌های هگز و جداول WinOLS با حدود ۴۰٪ کاهش توکن ورودی',
  },
  {
    id: 'max_quality',
    titleFa: 'حداکثر جزئیات',
    descFa: 'ارسال چکیده گسترده‌تر از فصل‌ها با حدود ۲۲٪ کاهش توکن (فقط با فشرده‌سازی سیم‌بندی)',
  },
];

export const MultiTierRoutingPanel: React.FC<MultiTierRoutingPanelProps> = ({
  draft,
  onChangeDraft,
}) => {
  const [visibleKeys, setVisibleKeys] = useState<Record<ModelTierId, boolean>>({
    economy: false,
    balanced: false,
    flagship: false,
  });

  const tr = getEffectiveTierRouting(draft);

  const updateTierRouting = (patch: Partial<MultiTierRoutingConfig>) => {
    onChangeDraft((prev) => {
      const current = getEffectiveTierRouting(prev);
      return {
        ...prev,
        tierRouting: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const updateTierSlot = (tierId: ModelTierId, patch: Partial<TierModelSlotConfig>) => {
    onChangeDraft((prev) => {
      const current = getEffectiveTierRouting(prev);
      const oldSlot = current.tiers[tierId];
      const nextProvider = patch.provider ?? oldSlot.provider;
      const switchedProvider = patch.provider && patch.provider !== oldSlot.provider;
      const nextMeta = AI_PROVIDER_METADATA[nextProvider];
      const defaultForTier =
        MODEL_TIER_METADATA[tierId].recommendedModels.find((m) => m.provider === nextProvider) ||
        null;

      return {
        ...prev,
        tierRouting: {
          ...current,
          tiers: {
            ...current.tiers,
            [tierId]: {
              provider: nextProvider,
              baseUrl: switchedProvider
                ? defaultForTier?.baseUrl || nextMeta.defaultBaseUrl
                : (patch.baseUrl ?? oldSlot.baseUrl),
              apiKey: patch.apiKey ?? (switchedProvider ? '' : oldSlot.apiKey),
              modelId: switchedProvider
                ? defaultForTier?.modelId || nextMeta.defaultModelId
                : (patch.modelId ?? oldSlot.modelId),
            },
          },
        },
      };
    });
  };

  const updateTaskTier = (taskId: AiTaskType, tierId: ModelTierId) => {
    onChangeDraft((prev) => {
      const current = getEffectiveTierRouting(prev);
      return {
        ...prev,
        tierRouting: {
          ...current,
          taskTierMap: {
            ...current.taskTierMap,
            [taskId]: tierId,
          },
        },
      };
    });
  };

  const handleApplyRecipe = (recipeId: string) => {
    onChangeDraft((prev) => applyMultiTierRecipe(prev, recipeId));
  };

  const costEstimate = useMemo(
    () =>
      estimateMultiTierPipelineCost({
        documentWords: 4500,
        chapterCount: 10,
        conflictCount: 8,
        optimizationMode: tr.optimizationMode,
        enablePromptCaching: tr.enablePromptCaching,
        tierModels: {
          economy: tr.tiers.economy.modelId,
          balanced: tr.tiers.balanced.modelId,
          flagship: tr.tiers.flagship.modelId,
        },
        taskTierMap: tr.taskTierMap,
      }),
    [tr]
  );

  return (
    <div className="space-y-4">
      {/* Layer 0 + Master Switch Banner */}
      <div className="rounded-xl border border-[#DCE5F0] bg-[#F4F7FB] p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1E3A5F]">
              <Layers className="h-4 w-4 shrink-0" />
              <span>مسیریابی هوشمند ۳ سطحی (قوی / متوسط / اقتصادی) + لایه ۰ محلی</span>
            </div>
            <p className="text-[11px] leading-5 text-[#475569]">
              لایه ۰ (ادغام بدون افت، استخراج هگز/WinOLS و خوشه‌بندی موضوعی) با <strong>۰ توکن</strong> اجرا می‌شود. با فعال‌سازی این بخش، مدل‌های گران (مثل Claude Opus 4.1) فقط در بازبینی نهایی به کار می‌روند و کارهای سبک به مدل اقتصادی سپرده می‌شوند.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={tr.enabled}
            aria-label="فعال‌سازی مسیریابی هوشمند ۳ سطحی"
            onClick={() => updateTierRouting({ enabled: !tr.enabled })}
            className={`inline-flex min-h-[36px] shrink-0 items-center gap-2 rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              tr.enabled
                ? 'border-[#14532D] bg-[#14532D] text-white'
                : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{tr.enabled ? 'مسیریابی ۳ سطحی فعال است' : 'فعال‌سازی مسیریابی ۳ سطحی'}</span>
          </button>
        </div>
      </div>

      {/* 1-Click Curated Recipes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-[#1A1816]">
            الگوهای آماده تک‌کلیکی (مناسب کلیدهای پولی و سهمیه سازنده)
          </span>
          <span className="text-[10.5px] text-[#78716C]">با یک کلیک هر ۳ سطح تنظیم و فعال می‌شوند</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MULTI_TIER_RECIPES.map((recipe) => {
            const isMatched =
              tr.enabled &&
              tr.tiers.economy.modelId === recipe.tiers.economy.modelId &&
              tr.tiers.balanced.modelId === recipe.tiers.balanced.modelId &&
              tr.tiers.flagship.modelId === recipe.tiers.flagship.modelId;
            return (
              <button
                key={recipe.id}
                type="button"
                onClick={() => handleApplyRecipe(recipe.id)}
                className={`rounded-xl border p-3 text-right transition-colors cursor-pointer space-y-1 ${
                  isMatched
                    ? 'border-[#1E3A5F] bg-[#EEF3F8] ring-1 ring-[#1E3A5F]'
                    : 'border-[#E2DDD3] bg-white hover:bg-[#FAF9F6]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-extrabold text-[#1A1816]">
                    {recipe.titleFa}
                  </span>
                  <span className="shrink-0 rounded border border-[#D8E2EE] bg-[#F4F7FB] px-1.5 py-0.5 text-[9.5px] font-bold text-[#1E3A5F]">
                    {recipe.badgeFa}
                  </span>
                </div>
                <p className="text-[10.5px] leading-4.5 text-[#57534E]">{recipe.subtitleFa}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Cost & Token Savings Simulator */}
      <div className="rounded-xl border border-[#CBE0D2] bg-[#F2F7F4] p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#14532D]">
            <TrendingDown className="h-4 w-4 shrink-0" />
            <span>شبیه‌ساز زنده هزینه دلاری (پروژه ۱۰ فصلی · ۴٬۵۰۰ کلمه + بازبینی عمیق + ۳ گفتگو)</span>
          </div>
          <span className="rounded-md bg-[#14532D] px-2 py-0.5 text-[10.5px] font-extrabold text-white tabular-nums">
            {toPersianDigits(costEstimate.savingsPercent)}٪ صرفه‌جویی هزینه
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 tabular-nums">
          <div className="rounded-lg border border-[#D6E6DC] bg-white px-3 py-2">
            <div className="text-[10px] text-[#57534E]">اگر کل پروژه با مدل پرچمدار اجرا شود:</div>
            <div className="mt-0.5 font-mono text-sm font-extrabold text-[#9A3412]" dir="ltr">
              <span className="block text-right">{formatUsdClean(costEstimate.flagshipOnlyCostUsd)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-[#A7D3B8] bg-white px-3 py-2">
            <div className="text-[10px] text-[#57534E]">با مسیریابی ۳ سطحی + فشرده‌سازی:</div>
            <div className="mt-0.5 font-mono text-sm font-extrabold text-[#14532D]" dir="ltr">
              <span className="block text-right">{formatUsdClean(costEstimate.routedOptimizedCostUsd)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-[#D6E6DC] bg-white px-3 py-2">
            <div className="text-[10px] text-[#57534E]">کاهش توکن سیم‌بندی کانتکست:</div>
            <div className="mt-0.5 text-sm font-extrabold text-[#1E3A5F]">
              {toPersianDigits(costEstimate.compressionSavingsPercent)}٪ سبک‌تر
            </div>
          </div>
        </div>
      </div>

      {/* 3 Tier Cards: Economy / Balanced / Flagship */}
      <div className="space-y-2.5">
        <div className="font-bold text-[#1A1816]">
          پیکربندی ۳ سطح مدل (در صورت خالی بودن کلید API، کلید همان ارائه‌دهنده از تب ۱ به‌صورت خودکار استفاده می‌شود)
        </div>

        <div className="space-y-2.5">
          {TIER_ORDER.map((tierId) => {
            const meta = MODEL_TIER_METADATA[tierId];
            const slot = tr.tiers[tierId];
            const pricing = lookupModelPricing(slot.modelId);
            const inheritedKeyPresent = Boolean(draft.providers?.[slot.provider]?.apiKey?.trim());
            const showTierKey = visibleKeys[tierId];

            return (
              <div
                key={tierId}
                className="rounded-xl border border-[#E2DDD3] bg-white p-3.5 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1A1816]">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: meta.accentHex }}
                        aria-hidden="true"
                      />
                      <span>{meta.titleFa}</span>
                    </div>
                    <p className="text-[10.5px] text-[#57534E]">{meta.descriptionFa}</p>
                  </div>
                  <div
                    className="rounded-md border border-[#E7E2D8] bg-[#FAF9F6] px-2 py-0.5 font-mono text-[10px] text-[#44403C] tabular-nums"
                    dir="ltr"
                  >
                    ${pricing.inputPerMillionUsd}/M in · ${pricing.outputPerMillionUsd}/M out
                  </div>
                </div>

                {/* Quick model presets for this tier */}
                <div className="flex flex-wrap gap-1.5">
                  {meta.recommendedModels.map((preset) => {
                    const activePreset =
                      slot.provider === preset.provider && slot.modelId === preset.modelId;
                    return (
                      <button
                        key={`${tierId}-${preset.provider}-${preset.modelId}`}
                        type="button"
                        onClick={() =>
                          updateTierSlot(tierId, {
                            provider: preset.provider,
                            baseUrl: preset.baseUrl,
                            modelId: preset.modelId,
                          })
                        }
                        className={`rounded-lg border px-2 py-1 text-[10.5px] font-semibold transition-colors cursor-pointer ${
                          activePreset
                            ? 'border-[#1E3A5F] bg-[#EEF3F8] text-[#1E3A5F]'
                            : 'border-[#E2DDD3] bg-[#FAF9F6] text-[#44403C] hover:bg-[#F3EFE7]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label
                      htmlFor={`tier-${tierId}-provider`}
                      className="block text-[10.5px] font-bold text-[#44403C]"
                    >
                      ارائه‌دهنده
                    </label>
                    <select
                      id={`tier-${tierId}-provider`}
                      value={slot.provider}
                      onChange={(e) =>
                        updateTierSlot(tierId, { provider: e.target.value as AiProviderType })
                      }
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-[11px] font-semibold text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                    >
                      {AI_PROVIDER_LIST.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.shortName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor={`tier-${tierId}-model`}
                      className="block text-[10.5px] font-bold text-[#44403C]"
                    >
                      شناسه مدل (Model ID)
                    </label>
                    <input
                      id={`tier-${tierId}-model`}
                      type="text"
                      dir="ltr"
                      value={slot.modelId}
                      onChange={(e) => updateTierSlot(tierId, { modelId: e.target.value })}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 font-mono text-[11px] text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor={`tier-${tierId}-key`}
                      className="block text-[10.5px] font-bold text-[#44403C]"
                    >
                      کلید اختصاصی این سطح (اختیاری)
                    </label>
                    <div className="relative">
                      <input
                        id={`tier-${tierId}-key`}
                        type={showTierKey ? 'text' : 'password'}
                        dir="ltr"
                        autoComplete="off"
                        placeholder={
                          inheritedKeyPresent
                            ? 'ارث‌بری از تب ۱ فعال است'
                            : AI_PROVIDER_METADATA[slot.provider].apiKeyPlaceholder
                        }
                        value={slot.apiKey}
                        onChange={(e) => updateTierSlot(tierId, { apiKey: e.target.value })}
                        className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 pl-8 font-mono text-[11px] text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleKeys((prev) => ({ ...prev, [tierId]: !prev[tierId] }))
                        }
                        aria-label={showTierKey ? 'مخفی کردن کلید سطح' : 'نمایش کلید سطح'}
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 text-[#57534E] hover:text-[#1A1816] cursor-pointer"
                      >
                        {showTierKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task -> Tier Assignment Matrix */}
      <div className="rounded-xl border border-[#E2DDD3] bg-white p-3.5 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1A1816]">
          <Cpu className="h-4 w-4 text-[#1E3A5F]" />
          <span>ماتریس تخصیص وظایف به سطوح مدل (۶ مرحله خط تولید)</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {AI_TASK_METADATA.map((task) => {
            const assigned = tr.taskTierMap[task.id] || task.defaultTier;
            return (
              <div
                key={task.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[#EFECE4] bg-[#FAF9F6] px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-[#1A1816] truncate">{task.titleFa}</div>
                  <div className="text-[10px] text-[#78716C] truncate">{task.tokenWeightFa}</div>
                </div>
                <select
                  aria-label={`سطح مدل برای ${task.titleFa}`}
                  value={assigned}
                  onChange={(e) => updateTaskTier(task.id, e.target.value as ModelTierId)}
                  className="shrink-0 rounded-md border border-[#D6D0C4] bg-white px-2 py-1 text-[11px] font-bold text-[#1E3A5F] focus:border-[#1E3A5F] focus:outline-none"
                >
                  <option value="economy">اقتصادی</option>
                  <option value="balanced">متعادل</option>
                  <option value="flagship">پرچمدار</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Token Engineering, Anti-Drift Guard & Hard Cost Cap */}
      <div className="rounded-xl border border-[#E2DDD3] bg-white p-3.5 space-y-3.5">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1A1816]">
          <Zap className="h-4 w-4 text-[#1E3A5F]" />
          <span>مهندسی مصرف توکن، سپر ضد انحراف و سقف ایمنی هزینه</span>
        </div>

        {/* Optimization Mode */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-[#44403C]">
            سطح فشرده‌سازی کانتکست (Compact Wire + استخراج هوشمند آدرس‌های هگز)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {OPT_MODES.map((m) => {
              const selected = tr.optimizationMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => updateTierRouting({ optimizationMode: m.id })}
                  className={`rounded-lg border p-2.5 text-right transition-colors cursor-pointer space-y-0.5 ${
                    selected
                      ? 'border-[#1E3A5F] bg-[#EEF3F8]'
                      : 'border-[#E2DDD3] bg-[#FAF9F6] hover:bg-[#F3EFE7]'
                  }`}
                >
                  <div className="text-[11px] font-extrabold text-[#1A1816]">{m.titleFa}</div>
                  <div className="text-[10px] leading-4 text-[#57534E]">{m.descFa}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3 Protection Switches */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="flex items-start gap-2 rounded-lg border border-[#E5E0D6] bg-[#FAF9F6] p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={tr.enablePromptCaching}
              onChange={(e) => updateTierRouting({ enablePromptCaching: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-[#1E3A5F]"
            />
            <span className="text-[10.5px] leading-4.5 text-[#334155]">
              <strong className="block text-[#1A1816]">کش پرامپت Anthropic</strong>
              تخفیف تا ۹۰٪ روی دستورالعمل سیستم
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-lg border border-[#E5E0D6] bg-[#FAF9F6] p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={tr.enableResponseCache}
              onChange={(e) => updateTierRouting({ enableResponseCache: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-[#1E3A5F]"
            />
            <span className="text-[10.5px] leading-4.5 text-[#334155]">
              <strong className="block text-[#1A1816]">کش پاسخ‌های تکراری</strong>
              ۰ توکن در اجرای مجدد مراحل یکسان
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-lg border border-[#E5E0D6] bg-[#FAF9F6] p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={tr.enableAntiDriftGuard}
              onChange={(e) => updateTierRouting({ enableAntiDriftGuard: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-[#1E3A5F]"
            />
            <span className="text-[10.5px] leading-4.5 text-[#334155]">
              <strong className="block text-[#1A1816] inline-flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 text-[#14532D]" />
                سپر ضد انحراف و توهم
              </strong>
              مسدودسازی آدرس هگز اختراعی و حذف کد ECU
            </span>
          </label>
        </div>

        {/* Hard Cost Cap USD */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EFECE4] pt-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#1A1816]">
            <Coins className="h-3.5 w-3.5 text-[#7C2D12]" />
            <span>سقف ایمنی هزینه هر پروژه (Hard Cost Cap):</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
            {COST_CAP_PRESETS.map((cap) => {
              const selected = tr.hardCostCapUsd === cap.value;
              return (
                <button
                  key={String(cap.value)}
                  type="button"
                  onClick={() => updateTierRouting({ hardCostCapUsd: cap.value })}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors cursor-pointer ${
                    selected
                      ? 'border-[#7C2D12] bg-[#FEF3EC] text-[#7C2D12]'
                      : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#44403C] hover:bg-[#EFECE4]'
                  }`}
                >
                  {cap.labelFa}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Zero-Token Layer Info Footer */}
      <div className="flex items-start gap-2 rounded-lg border border-[#D8E2EE] bg-[#F8FAFC] px-3 py-2 text-[10.5px] text-[#475569] leading-5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[#1E3A5F]" />
        <span>
          در حالت چندفایلی (Multi-Merge)، موتور محلی پیش از ارسال به هوش مصنوعی، جزوه‌های نامنظم را بر اساس ترتیب آموزشی ریمپ (مبانی ← WinOLS/FCE6 ← هوا و بار ← سوخت و لامبدا ← جرقه ← VVT ← کات‌آف و عیب‌یابی) خوشه‌بندی و مرتب می‌کند تا مدل پولی فقط روی کیفیت و دقت تمرکز کند.
        </span>
      </div>
    </div>
  );
};
