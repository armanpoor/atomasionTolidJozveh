import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  Gauge,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AiModelId, GoogleSearchMode, ProjectAiUsageLedger } from '../lib/bookTypes';
import {
  AiProviderConfig,
  AiQuotaProbeResponse,
  getProviderDisplaySummary,
} from '../lib/aiProviderConfig';
import {
  buildProjectQuotaTechnicalSpec,
  formatCompactTokensFa,
  ProjectQuotaSnapshot,
  QuotaStatusLevel,
} from '../lib/aiUsageMetrics';
import { toPersianDigits } from '../lib/formatParsers';

interface AiQuotaInfoModalProps {
  open: boolean;
  onClose: () => void;
  usage: ProjectAiUsageLedger;
  snapshot: ProjectQuotaSnapshot;
  ingestedFilesCount: number;
  queuedFilesCount: number;
  ingestedWordCount: number;
  queuedBytesCount: number;
  chapterCount: number;
  aiModel: AiModelId;
  googleSearchMode: GoogleSearchMode;
  useAiBackend: boolean;
  providerConfig: AiProviderConfig;
  probeData: AiQuotaProbeResponse | null;
  probing: boolean;
  onRunLiveProbe: () => Promise<void>;
  onOpenProviderSettings: () => void;
}

type ModalTab = 'limits' | 'calculation' | 'quota_model';

const STATUS_TEXT_COLOR: Record<QuotaStatusLevel, string> = {
  normal: 'text-[#14532D]',
  warning: 'text-[#B45309]',
  critical: 'text-[#9A3412]',
};

const STATUS_BAR_COLOR: Record<QuotaStatusLevel, string> = {
  normal: 'bg-[#14532D]',
  warning: 'bg-[#B45309]',
  critical: 'bg-[#9A3412]',
};

export const AiQuotaInfoModal: React.FC<AiQuotaInfoModalProps> = ({
  open,
  onClose,
  usage,
  snapshot,
  ingestedFilesCount,
  queuedFilesCount,
  ingestedWordCount,
  queuedBytesCount,
  chapterCount,
  aiModel,
  googleSearchMode,
  useAiBackend,
  providerConfig,
  probeData,
  probing,
  onRunLiveProbe,
  onOpenProviderSettings,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('limits');
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const spec = useMemo(
    () =>
      buildProjectQuotaTechnicalSpec({
        usage,
        ingestedWordCount,
        queuedBytesCount,
        chapterCount,
        aiModel,
        googleSearchMode,
        useAiBackend,
      }),
    [
      usage,
      ingestedWordCount,
      queuedBytesCount,
      chapterCount,
      aiModel,
      googleSearchMode,
      useAiBackend,
    ]
  );

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 10);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const totalFilesCount = ingestedFilesCount + queuedFilesCount;
  const activeProbe = probeData?.activeProbe ?? null;
  const creatorProbe = probeData?.creatorKeyProbe ?? null;
  const accountUsage = probeData?.accountUsage ?? null;

  const providerSummary = getProviderDisplaySummary(providerConfig, aiModel);
  const activeProviderSummary = `${providerSummary.providerLabel} — ${providerSummary.keySourceLabel} (${providerSummary.modelLabel})`;

  const formattedProbeTime = activeProbe?.checkedAt
    ? new Date(activeProbe.checkedAt).toLocaleTimeString('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'هنوز استعلام نشده';

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#1A1816]/45 p-3 sm:p-6 backdrop-blur-[1.5px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      dir="rtl"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#DDD7CB] bg-[#FCFBF8] text-[#1A1816] shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-[#E7E2D8] bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0 space-y-1">
            <h2
              id={titleId}
              className="text-base sm:text-lg font-extrabold tracking-tight text-[#1A1816]"
            >
              استعلام زنده سهمیه، محاسبه ساده توکن و مدیریت کلید هوش مصنوعی
            </h2>
            <p className="text-xs text-[#57534E] leading-5">
              وضعیت لحظه‌ای سهمیه باقی‌مانده، فرمول خیلی ساده تخمین توکن برای همه و تفاوت کلید سازنده با کلید شخصی
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره اطلاعات سهمیه هوش مصنوعی"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E2DDD3] bg-[#FAF8F5] text-[#44403C] hover:bg-[#EFECE4] hover:text-[#1A1816] cursor-pointer"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </header>

        {/* Tab Switcher */}
        <div
          role="tablist"
          aria-label="بخش‌های راهنمای سهمیه هوش مصنوعی"
          className="flex items-center gap-1 overflow-x-auto border-b border-[#E7E2D8] bg-[#F5F2EB] px-4 py-2 sm:px-6"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'limits'}
            onClick={() => setActiveTab('limits')}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'limits'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <Gauge className="h-3.5 w-3.5 shrink-0" />
            <span>استعلام زنده و باقی‌مانده سهمیه</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'calculation'}
            onClick={() => setActiveTab('calculation')}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'calculation'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <Calculator className="h-3.5 w-3.5 shrink-0" />
            <span>محاسبه ساده توکن (قابل فهم)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'quota_model'}
            onClick={() => setActiveTab('quota_model')}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'quota_model'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>کلید سازنده در برابر کلید شخصی</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 space-y-6">
          {/* TAB 1: LIVE PROBE & REMAINING QUOTA */}
          {activeTab === 'limits' && (
            <div role="tabpanel" className="space-y-5">
              {/* Real-Time Live Quota Probe Banner */}
              <section
                aria-label="نتیجه استعلام زنده سهمیه"
                className={`rounded-xl border p-4 space-y-3 ${
                  activeProbe?.hasQuota
                    ? 'border-[#C7DDD0] bg-[#F2F7F4]'
                    : activeProbe
                      ? 'border-[#E6BFB7] bg-[#FDF2F0]'
                      : 'border-[#D4DFEC] bg-[#F3F7FB]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-extrabold">
                      {probing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[#1E3A5F]" />
                      ) : activeProbe?.hasQuota ? (
                        <CheckCircle2 className="h-4 w-4 text-[#14532D]" />
                      ) : activeProbe ? (
                        <AlertCircle className="h-4 w-4 text-[#9A3412]" />
                      ) : (
                        <Gauge className="h-4 w-4 text-[#1E3A5F]" />
                      )}
                      <span
                        className={
                          activeProbe?.hasQuota
                            ? 'text-[#14532D]'
                            : activeProbe
                              ? 'text-[#9A3412]'
                              : 'text-[#1E3A5F]'
                        }
                      >
                        {probing
                          ? 'در حال استعلام زنده از سرویس هوش مصنوعی...'
                          : activeProbe
                            ? `استعلام زنده: ${activeProbe.statusLabelFa}`
                            : 'برای مشاهده وضعیت لحظه‌ای روی «استعلام زنده» بزنید'}
                      </span>
                    </div>
                    <p className="text-xs text-[#292524] leading-5">
                      {activeProbe?.detailFa ||
                        'این استعلام یک بررسی واقعی از سرویس متصل انجام می‌دهد تا از داشتن سهمیه و فعال بودن کلید مطمئن شوید.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#57534E] tabular-nums">
                      <span>مسیر فعال: <strong>{activeProviderSummary}</strong></span>
                      <span aria-hidden="true">·</span>
                      <span>آخرین استعلام: {formattedProbeTime}</span>
                      {activeProbe && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>زمان پاسخ: {toPersianDigits(activeProbe.latencyMs)} میلی‌ثانیه</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void onRunLiveProbe()}
                      disabled={probing}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-white px-3 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
                      <span>استعلام زنده</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenProviderSettings();
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] cursor-pointer"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>تغییر ارائه‌دهنده / کلید</span>
                    </button>
                  </div>
                </div>

                {/* Live provider rate-limit headers (when returned by custom providers) */}
                {activeProbe &&
                  (activeProbe.rateLimitRemainingRequests != null ||
                    activeProbe.rateLimitRemainingTokens != null) && (
                    <div className="border-t border-black/10 pt-2 text-xs font-semibold tabular-nums text-[#14532D]">
                      {activeProbe.rateLimitRemainingRequests != null && (
                        <span className="ml-4">
                          درخواست باقی‌مانده واقعی (اعلام سرویس):{' '}
                          {toPersianDigits(activeProbe.rateLimitRemainingRequests)}
                        </span>
                      )}
                      {activeProbe.rateLimitRemainingTokens != null && (
                        <span>
                          توکن باقی‌مانده واقعی (اعلام سرویس):{' '}
                          {toPersianDigits(activeProbe.rateLimitRemainingTokens)}
                        </span>
                      )}
                    </div>
                  )}

                {creatorProbe && activeProbe?.keySource !== 'creator' && (
                  <div className="border-t border-black/10 pt-2 text-[11px] text-[#44403C]">
                    وضعیت کلید سازنده اپلیکیشن:{' '}
                    <strong className={creatorProbe.hasQuota ? 'text-[#14532D]' : 'text-[#9A3412]'}>
                      {creatorProbe.statusLabelFa}
                    </strong>
                  </div>
                )}
              </section>

              {/* 4-Metric Remaining & Consumed Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-xl border border-[#E2DDD3] bg-[#ECE7DD] tabular-nums">
                <div className="bg-white p-3.5 space-y-1">
                  <div className="text-[11px] text-[#78716C]">سهمیه باقی‌مانده این پروژه</div>
                  <div className="text-base font-extrabold text-[#14532D]">
                    {formatCompactTokensFa(snapshot.remainingTokens)}
                  </div>
                  <div className="text-[11px] text-[#57534E]">
                    {toPersianDigits(snapshot.remainingPercent)}٪ باقی‌مانده (≈{' '}
                    {toPersianDigits(snapshot.remainingPagesEquivalent)} صفحه)
                  </div>
                </div>

                <div className="bg-white p-3.5 space-y-1">
                  <div className="text-[11px] text-[#78716C]">مصرف واقعی ثبت‌شده</div>
                  <div className="text-base font-extrabold text-[#1A1816]">
                    {formatCompactTokensFa(snapshot.consumedTokens)}
                  </div>
                  <div className={`text-[11px] font-semibold ${STATUS_TEXT_COLOR[snapshot.statusLevel]}`}>
                    {toPersianDigits(snapshot.consumedPercent)}٪ از{' '}
                    {formatCompactTokensFa(spec.softBudgetTokens)}
                  </div>
                </div>

                <div className="bg-white p-3.5 space-y-1">
                  <div className="text-[11px] text-[#78716C]">مصرف کل حساب (همه پروژه‌ها)</div>
                  <div className="text-base font-extrabold text-[#1A1816]">
                    {formatCompactTokensFa(accountUsage?.allProjectsTokens ?? snapshot.consumedTokens)}
                  </div>
                  <div className="text-[11px] text-[#57534E]">
                    در {toPersianDigits(accountUsage?.projectCount ?? 1)} پروژه (
                    {toPersianDigits(accountUsage?.allProjectsRequests ?? snapshot.requestCount)} درخواست)
                  </div>
                </div>

                <div className="bg-white p-3.5 space-y-1">
                  <div className="text-[11px] text-[#78716C]">معادل هزینه پلن پولی</div>
                  <div className="text-base font-extrabold text-[#1A1816] font-mono" dir="ltr">
                    <span className="block text-right">{snapshot.formattedCostUsd}</span>
                  </div>
                  <div className="text-[11px] text-[#57534E]">
                    {toPersianDigits(totalFilesCount)} فایل ({toPersianDigits(snapshot.estimatedDocumentPages)} صفحه)
                  </div>
                </div>
              </div>

              {/* Progress Bars */}
              <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3.5 tabular-nums">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#44403C]">
                      سهمیه باقی‌مانده توکن پروژه ({spec.modelDisplayName})
                    </span>
                    <span className="font-bold text-[#14532D]">
                      {toPersianDigits(snapshot.remainingPercent)}٪ باقی‌مانده ·{' '}
                      {formatCompactTokensFa(snapshot.remainingTokens)} از{' '}
                      {formatCompactTokensFa(spec.softBudgetTokens)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#ECE7DD]">
                    <div
                      className={`h-full rounded-full ${STATUS_BAR_COLOR[snapshot.statusLevel]}`}
                      style={{ width: `${snapshot.consumedPercent}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#44403C]">
                      تعداد درخواست‌های باقی‌مانده در سقف نرم
                    </span>
                    <span className="font-bold text-[#1A1816]">
                      {toPersianDigits(spec.remainingSoftRequests)} درخواست باقی‌مانده (مصرف:{' '}
                      {toPersianDigits(snapshot.requestCount)} از {toPersianDigits(spec.softRequestCap)})
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#ECE7DD]">
                    <div
                      className="h-full rounded-full bg-[#1E3A5F]"
                      style={{ width: `${spec.requestPercent}%` }}
                    />
                  </div>
                </div>

                <p className="text-[11px] leading-5 text-[#57534E] border-t border-[#EFECE4] pt-2.5">
                  <strong>شفافیت فنی استعلام:</strong> سرویس Google AI Studio به‌صورت عمومی عدد دقیق «مانده اعتبار کل اکانت» را از طریق API برنمی‌گرداند؛ بنابراین این برنامه هم‌زمان <strong>یک تست زنده واقعی</strong> برای اطمینان از فعال بودن و پر نبودن سهمیه (عدم خطای 429) می‌گیرد و هم میزان مصرف و باقی‌مانده بودجه شما را از روی <strong>توکن‌های واقعی ثبت‌شده در دیتابیس</strong> محاسبه می‌کند.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: SUPER SIMPLE TOKEN CALCULATION */}
          {activeTab === 'calculation' && (
            <div role="tabpanel" className="space-y-5">
              {/* Plain Everyday Formula Card */}
              <section className="rounded-xl border border-[#C6D5E6] bg-[#F3F7FB] p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-[#1E3A5F]">
                  {spec.simpleExplanation.ruleTitle}
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-[#D8E2EE] bg-white p-3 space-y-1">
                    <div className="font-extrabold text-[#1E3A5F]">قانون ۱: بر اساس تعداد کلمات</div>
                    <p className="text-[#292524] leading-5">
                      {spec.simpleExplanation.wordRuleText}
                    </p>
                    <div className="pt-1 font-bold text-[#14532D] tabular-nums">
                      تعداد کلمات × ۲ = توکن تقریبی
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#D8E2EE] bg-white p-3 space-y-1">
                    <div className="font-extrabold text-[#1E3A5F]">قانون ۲: بر اساس تعداد صفحه ورد</div>
                    <p className="text-[#292524] leading-5">
                      {spec.simpleExplanation.pageRuleText}
                    </p>
                    <div className="pt-1 font-bold text-[#14532D] tabular-nums">
                      تعداد صفحه × ۸۰۰ = توکن تقریبی
                    </div>
                  </div>
                </div>

                {/* Live Worked Example on Current Project */}
                <div className="rounded-lg border border-[#C7DDD0] bg-white p-3.5 space-y-1.5 text-xs leading-6 text-[#1A1816] tabular-nums">
                  <div className="font-extrabold text-[#14532D]">محاسبه ساده روی سند فعلی شما:</div>
                  <p>{spec.simpleExplanation.projectWorkedExample}</p>
                  <p className="text-[#44403C]">{spec.simpleExplanation.remainingSimpleText}</p>
                </div>
              </section>

              {/* Simple Breakdown Table of What Uses Tokens vs What Is Free */}
              <section className="space-y-2.5">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  چه کارهایی توکن مصرف می‌کنند و چه کارهایی کاملاً رایگانند؟
                </h3>
                <div className="overflow-x-auto rounded-xl border border-[#E2DDD3] bg-white">
                  <table className="w-full text-right text-xs border-collapse tabular-nums">
                    <thead>
                      <tr className="border-b border-[#E7E2D8] bg-[#F7F4EE] text-[#57534E]">
                        <th className="px-4 py-2.5 font-bold">عملیات در برنامه</th>
                        <th className="px-4 py-2.5 font-bold">مصرف تقریبی</th>
                        <th className="px-4 py-2.5 font-bold">توضیح ساده</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFECE4] text-[#292524]">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold">آپلود، ادغام بدون افت و دانلود ورد (.docx)</td>
                        <td className="px-4 py-2.5 font-bold text-[#14532D]">صفر توکن (رایگان)</td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          حتی ادغام ۵۰ تا ۱۰۰ فایل ورد و ساخت فایل خروجی هیچ توکنی مصرف نمی‌کند.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold">یک پیام به چت‌بات سردبیر</td>
                        <td className="px-4 py-2.5 font-bold">حدود ۱ تا ۳ هزار توکن</td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          معادل حدود ۲ تا ۴ صفحه متن.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold">تکمیل یک فصل با جستجوی گوگل</td>
                        <td className="px-4 py-2.5 font-bold">حدود ۲ هزار توکن</td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          هر فصل یک جستجوی مجزا و مستقل انجام می‌دهد.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold">بازبینی عمیق کل سند با هوش مصنوعی</td>
                        <td className="px-4 py-2.5 font-bold">حدود ۱۰ تا ۲۵ هزار توکن</td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          فقط خلاصه فصل‌ها فرستاده می‌شود (نه کل متن خام) تا مصرف پایین بماند.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Real Recorded Token Split */}
              <section className="space-y-2">
                <h3 className="text-xs font-extrabold text-[#1A1816]">
                  آمار دقیق توکن‌های ثبت‌شده توسط سرور در این پروژه
                </h3>
                <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                  <div className="rounded-lg border border-[#E2DDD3] bg-white p-3">
                    <div className="text-[11px] text-[#78716C]">ورودی (متن ارسالی)</div>
                    <div className="mt-1 font-extrabold text-[#1A1816]">
                      {formatCompactTokensFa(usage.promptTokens)} ({toPersianDigits(spec.promptSharePercent)}٪)
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E2DDD3] bg-white p-3">
                    <div className="text-[11px] text-[#78716C]">خروجی (پاسخ تولیدشده)</div>
                    <div className="mt-1 font-extrabold text-[#1A1816]">
                      {formatCompactTokensFa(usage.outputTokens)} ({toPersianDigits(spec.outputSharePercent)}٪)
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E2DDD3] bg-white p-3">
                    <div className="text-[11px] text-[#78716C]">تفکر و استدلال مدل</div>
                    <div className="mt-1 font-extrabold text-[#1A1816]">
                      {formatCompactTokensFa(usage.thinkingTokens)} ({toPersianDigits(spec.thinkingSharePercent)}٪)
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 3: CREATOR KEY VS PERSONAL KEY & CUSTOM PROVIDER */}
          {activeTab === 'quota_model' && (
            <div role="tabpanel" className="space-y-5">
              <section className="rounded-xl border border-[#D4DFEC] bg-[#F3F7FB] p-4 space-y-2">
                <h3 className="text-sm font-extrabold text-[#1E3A5F]">
                  ۳ روش استفاده از هوش مصنوعی در این اپلیکیشن
                </h3>
                <p className="text-xs leading-6 text-[#292524]">
                  شما آزادید هر زمان که خواستید منبع کلید خود را تغییر دهید: در حالت پیش‌فرض <strong>Google AI Studio</strong>، برنامه در لحظه کلید سازنده اپلیکیشن را استعلام می‌گیرد؛ اگر شارژ و سهمیه داشت می‌توانید رایگان از آن استفاده کنید، و اگر تمام شده بود (یا حتی زمانی که هنوز شارژ دارد) می‌توانید <strong>کلید شخصی خودتان</strong> یا هر <strong>ارائه‌دهنده سفارشی (Base URL + API Key)</strong> را ثبت کنید.
                </p>
              </section>

              <div className="overflow-x-auto rounded-xl border border-[#E2DDD3] bg-white">
                <table className="w-full text-right text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E7E2D8] bg-[#F7F4EE] text-[#57534E]">
                      <th className="px-4 py-2.5 font-bold">حالت استفاده</th>
                      <th className="px-4 py-2.5 font-bold">سهمیه از کجا کم می‌شود؟</th>
                      <th className="px-4 py-2.5 font-bold">ویژگی‌ها و مدل‌ها</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFECE4] text-[#292524]">
                    <tr>
                      <td className="px-4 py-2.5 font-bold text-[#1E3A5F] whitespace-nowrap">
                        ۱. کلید سازنده اپلیکیشن (Google AI Studio)
                      </td>
                      <td className="px-4 py-2.5">
                        از سهمیه پروژه سازنده (رایگان برای شما تا زمان موجود بودن سهمیه).
                      </td>
                      <td className="px-4 py-2.5 text-[#57534E]">
                        استعلام زنده در لحظه · مدل‌های Gemini 4 Hydrogen و Gemini 3.8 Flash + جستجوی گوگل.
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-bold text-[#14532D] whitespace-nowrap">
                        ۲. کلید شخصی شما (Google AI Studio)
                      </td>
                      <td className="px-4 py-2.5">
                        مستقیماً از اکانت Google AI Studio خودتان (کاملاً مستقل از سایر کاربران).
                      </td>
                      <td className="px-4 py-2.5 text-[#57534E]">
                        قابل انتخاب در هر زمان (حتی وقتی کلید سازنده شارژ دارد) · هر دو مدل Hydrogen 4 و Flash 3.8 + جستجوی گوگل.
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-bold text-[#5B21B6] whitespace-nowrap">
                        ۳. ارائه‌دهنده سفارشی (Base URL + API Key)
                      </td>
                      <td className="px-4 py-2.5">
                        از اعتبار سرویس دلخواه شما (OpenRouter، OpenAI، DeepSeek، Groq و...).
                      </td>
                      <td className="px-4 py-2.5 text-[#57534E]">
                        انتخاب آزاد هر مدل دلخواه · فقط از مسیر امن HTTPS سرور ارسال می‌شود.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProviderSettings();
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-4 py-2 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>باز کردن تنظیمات ارائه‌دهنده و کلید API</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-[#E7E2D8] bg-white px-5 py-3 sm:px-6">
          <div className="text-[11px] text-[#78716C] tabular-nums truncate">
            مدل فعال:{' '}
            <strong className="text-[#44403C]">
              {providerSummary.modelLabel}
            </strong>{' '}
            · باقی‌مانده:{' '}
            <strong className="text-[#14532D]">
              {toPersianDigits(snapshot.remainingPercent)}٪
            </strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[38px] shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] px-5 py-2 text-xs font-bold text-white hover:bg-[#162C49] cursor-pointer"
          >
            متوجه شدم
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
};
