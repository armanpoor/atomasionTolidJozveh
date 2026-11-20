import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calculator, Gauge, ShieldCheck, X } from 'lucide-react';
import { AiModelId, GoogleSearchMode, ProjectAiUsageLedger } from '../lib/bookTypes';
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

  // Lock background scroll, close on Escape, move initial focus into dialog, and restore focus on close
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
  const formattedLastUpdated = usage.lastUpdatedAt
    ? new Date(usage.lastUpdatedAt).toLocaleString('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      })
    : 'هنوز فراخوانی ثبت نشده';

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
        {/* Modal Header */}
        <header className="flex items-start justify-between gap-4 border-b border-[#E7E2D8] bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0 space-y-1">
            <h2
              id={titleId}
              className="text-base sm:text-lg font-extrabold tracking-tight text-[#1A1816]"
            >
              راهنمای فنی محاسبه مصرف، لیمیت‌ها و سهمیه هوش مصنوعی
            </h2>
            <p className="text-xs text-[#57534E] leading-5">
              شفاف‌سازی نحوه ثبت واقعی توکن‌ها، محدودیت‌های فنی پروژه جاری و تفاوت سهمیه پروژه با سهمیه شخصی کاربر
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره اطلاعات سهمیه هوش مصنوعی"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E2DDD3] bg-[#FAF8F5] text-[#44403C] hover:bg-[#EFECE4] hover:text-[#1A1816] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F] transition-colors cursor-pointer"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </header>

        {/* Segmented Tab Switcher */}
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
            <span>وضعیت و لیمیت‌های پروژه</span>
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
            <span>نحوه محاسبه توکن و هزینه</span>
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
            <span>سهمیه پروژه در برابر شخصی</span>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 space-y-6">
          {/* TAB 1: LIVE PROJECT LIMITS & TELEMETRY */}
          {activeTab === 'limits' && (
            <div role="tabpanel" className="space-y-6">
              {/* Top Live Summary Grid (single flat bordered strip with hairline dividers) */}
              <section aria-label="خلاصه وضعیت لحظه‌ای پروژه جاری" className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-[#1A1816]">
                    وضعیت لحظه‌ای سهمیه پروژه جاری
                  </h3>
                  <span className="text-[11px] text-[#78716C] tabular-nums">
                    آخرین ثبت سرور: {formattedLastUpdated}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-xl border border-[#E2DDD3] bg-[#ECE7DD] tabular-nums">
                  <div className="bg-white p-3.5 space-y-1">
                    <div className="text-[11px] text-[#78716C]">مصرف ثبت‌شده توکن</div>
                    <div className="text-base font-extrabold text-[#1A1816]">
                      {formatCompactTokensFa(snapshot.consumedTokens)}
                    </div>
                    <div className={`text-[11px] font-semibold ${STATUS_TEXT_COLOR[snapshot.statusLevel]}`}>
                      {snapshot.statusLabel} · {toPersianDigits(snapshot.consumedPercent)}٪
                    </div>
                  </div>

                  <div className="bg-white p-3.5 space-y-1">
                    <div className="text-[11px] text-[#78716C]">مانده تا سقف مرجع</div>
                    <div className="text-base font-extrabold text-[#1A1816]">
                      {formatCompactTokensFa(spec.remainingBudgetTokens)}
                    </div>
                    <div className="text-[11px] text-[#57534E]">
                      سقف مدل: {formatCompactTokensFa(spec.softBudgetTokens)}
                    </div>
                  </div>

                  <div className="bg-white p-3.5 space-y-1">
                    <div className="text-[11px] text-[#78716C]">درخواست‌های AI ثبت‌شده</div>
                    <div className="text-base font-extrabold text-[#1A1816]">
                      {toPersianDigits(snapshot.requestCount)} از {toPersianDigits(spec.softRequestCap)}
                    </div>
                    <div className="text-[11px] text-[#57534E]">
                      گوگل {toPersianDigits(usage.groundingCallCount)} · بازبینی{' '}
                      {toPersianDigits(usage.deepReviewCount)} · چت{' '}
                      {toPersianDigits(usage.chatCallCount)}
                    </div>
                  </div>

                  <div className="bg-white p-3.5 space-y-1">
                    <div className="text-[11px] text-[#78716C]">معادل هزینه پلن پولی</div>
                    <div className="text-base font-extrabold text-[#1A1816] font-mono" dir="ltr">
                      <span className="block text-right">{snapshot.formattedCostUsd}</span>
                    </div>
                    <div className="text-[11px] text-[#57534E]">
                      تخمین فایل‌ها: ~{formatCompactTokensFa(snapshot.estimatedDocumentTokens)}
                    </div>
                  </div>
                </div>

                {/* Progress Bars for Token Budget & Request Cap */}
                <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3.5 tabular-nums">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#44403C]">
                        سهمیه مرجع توکن پروژه ({spec.modelDisplayName})
                      </span>
                      <span className="font-bold text-[#1A1816]">
                        {formatCompactTokensFa(snapshot.consumedTokens)} /{' '}
                        {formatCompactTokensFa(spec.softBudgetTokens)} ({toPersianDigits(snapshot.consumedPercent)}٪)
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
                        سهمیه نرم تعداد درخواست‌ها (جلوگیری از خطای نرخ درخواست 429)
                      </span>
                      <span className="font-bold text-[#1A1816]">
                        {toPersianDigits(snapshot.requestCount)} / {toPersianDigits(spec.softRequestCap)} درخواست (
                        {toPersianDigits(spec.requestPercent)}٪)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#ECE7DD]">
                      <div
                        className="h-full rounded-full bg-[#1E3A5F]"
                        style={{ width: `${spec.requestPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Technical Limits Matrix */}
              <section aria-label="جدول محدودیت‌های فنی پروژه" className="space-y-2.5">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  محدودیت‌های فنی و ظرفیت پردازش پروژه
                </h3>

                <div className="overflow-x-auto rounded-xl border border-[#E2DDD3] bg-white">
                  <table className="w-full text-right text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#E7E2D8] bg-[#F7F4EE] text-[#57534E]">
                        <th className="px-4 py-2.5 font-bold">پارامتر فنی</th>
                        <th className="px-4 py-2.5 font-bold">مقدار / وضعیت فعلی</th>
                        <th className="px-4 py-2.5 font-bold">اثر عملی بر پروژه</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFECE4] text-[#292524] tabular-nums">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">مدل و مسیر جایگزین</td>
                        <td className="px-4 py-2.5 font-mono text-[11px]" dir="ltr">
                          <span className="block text-right">{spec.modelId}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          در صورت خطای سهمیه (429) به‌طور خودکار به <span className="font-mono" dir="ltr">gemini-3.1-flash-lite</span> سوییچ می‌شود.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">حالت جستجوی گوگل</td>
                        <td className="px-4 py-2.5 font-medium">{spec.groundingModeLabel}</td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          هر فصل در تکمیل گوگل یک درخواست جداگانه (~۱.۸ هزار توکن) مصرف می‌کند.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">تعداد فایل‌های پروژه</td>
                        <td className="px-4 py-2.5 font-medium">
                          {toPersianDigits(totalFilesCount)} فایل ({toPersianDigits(ingestedFilesCount)} پردازش‌شده · {toPersianDigits(queuedFilesCount)} در صف)
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          استخراج، حذف تکراری‌های بدون افت و ساخت ورد تماماً محلی است؛ ادغام ۵۰ تا ۱۰۰+ فایل به سقف توکن هوش مصنوعی نمی‌خورد.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">سقف هر بسته ارسال به سرور</td>
                        <td className="px-4 py-2.5 font-medium">
                          {toPersianDigits(spec.httpPayloadLimitMb)} مگابایت در هر درخواست
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          برای فایل‌های بسیار حجیم، بارگذاری در چند نوبت متوالی بدون از دست رفتن فایل‌های قبلی انجام می‌شود.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">عملیات رایگان بدون توکن</td>
                        <td className="px-4 py-2.5 font-medium text-[#14532D]">نامحدود (سمت سرور / مرورگر)</td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          تجزیه Word/PDF/Markdown، ادغام ۱۰۰٪ بدون افت، ویرایش دستی فصل‌ها، نمودارهای SVG داخلی و خروجی نهایی <span className="font-mono">.docx</span> هیچ توکنی مصرف نمی‌کنند.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* TAB 2: EXACT CALCULATION METHODOLOGY */}
          {activeTab === 'calculation' && (
            <div role="tabpanel" className="space-y-6">
              {/* 1. Real server-side metering */}
              <section className="space-y-2.5">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  ۱. ثبت واقعی مصرف پس از هر فراخوانی (Server-Side Metering)
                </h3>
                <p className="text-xs leading-6 text-[#44403C]">
                  پس از پایان هر فراخوانی به Gemini (پالایش فهرست فصل‌ها، پالایش هوشمند تناقض‌ها، بررسی و تکمیل با جستجوی گوگل، بازبینی عمیق و پیام‌های چتبات)، سرور چهار شمارنده رسمی برگشتی در آبجکت{' '}
                  <code className="rounded bg-[#EFECE4] px-1.5 py-0.5 font-mono text-[11px] text-[#1E3A5F]" dir="ltr">
                    usageMetadata
                  </code>{' '}
                  را می‌خواند و به‌صورت تجمعی در فیلد{' '}
                  <code className="rounded bg-[#EFECE4] px-1.5 py-0.5 font-mono text-[11px] text-[#1E3A5F]" dir="ltr">
                    checkpointJson.aiUsage
                  </code>{' '}
                  در دیتابیس PostgreSQL همین پروژه ذخیره می‌کند:
                </p>

                <div className="overflow-x-auto rounded-xl border border-[#E2DDD3] bg-white">
                  <table className="w-full text-right text-xs border-collapse tabular-nums">
                    <thead>
                      <tr className="border-b border-[#E7E2D8] bg-[#F7F4EE] text-[#57534E]">
                        <th className="px-4 py-2.5 font-bold">بخش توکن</th>
                        <th className="px-4 py-2.5 font-bold">کلید API</th>
                        <th className="px-4 py-2.5 font-bold">ثبت‌شده در این پروژه</th>
                        <th className="px-4 py-2.5 font-bold">شامل چه مواردی است؟</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFECE4]">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">توکن ورودی</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#1E3A5F]" dir="ltr">
                          <span className="block text-right">promptTokenCount</span>
                        </td>
                        <td className="px-4 py-2.5 font-bold">
                          {formatCompactTokensFa(usage.promptTokens)} ({toPersianDigits(spec.promptSharePercent)}٪)
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          دستور سیستمی، چکیده فشرده فصل‌ها (نه متن خام همه فایل‌ها) و سوال یا درخواست شما.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">توکن خروجی</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#1E3A5F]" dir="ltr">
                          <span className="block text-right">candidatesTokenCount</span>
                        </td>
                        <td className="px-4 py-2.5 font-bold">
                          {formatCompactTokensFa(usage.outputTokens)} ({toPersianDigits(spec.outputSharePercent)}٪)
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          متن فارسی تولیدشده، جداول، گزارش بازبینی عمیق یا ساختار JSON خروجی مدل.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">توکن استدلال</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#1E3A5F]" dir="ltr">
                          <span className="block text-right">thoughtsTokenCount</span>
                        </td>
                        <td className="px-4 py-2.5 font-bold">
                          {formatCompactTokensFa(usage.thinkingTokens)} ({toPersianDigits(spec.thinkingSharePercent)}٪)
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          استدلال داخلی مدل در سطوح <span className="font-mono">MEDIUM / HIGH / XHIGH</span> (مثلاً در بازبینی با قدرت بیشتر). در محاسبه سهمیه هم‌ردیف خروجی است.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[11.5px] leading-5 text-[#57534E]">
                  در موارد نادری که پاسخ API فاقد <code className="font-mono" dir="ltr">usageMetadata</code> باشد، سیستم از فرمول پشتیبان{' '}
                  <code className="rounded bg-[#EFECE4] px-1.5 py-0.5 font-mono text-[11px]" dir="ltr">
                    ceil(characters / {spec.fallbackCharsPerToken})
                  </code>{' '}
                  استفاده می‌کند تا هیچ فراخوانی بدون ثبت باقی نماند.
                </p>
              </section>

              {/* 2. Pre-run estimation & cost formula */}
              <section className="space-y-3 border-t border-[#E7E2D8] pt-5">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  ۲. فرمول تخمین پیش از اجرا، آستانه‌های هشدار و معادل هزینه
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-2">
                    <div className="text-xs font-bold text-[#1E3A5F]">تخمین حجم پیکره فارسی</div>
                    <ul className="space-y-1.5 text-xs leading-5.5 text-[#44403C] tabular-nums">
                      <li>
                        • فایل‌های پردازش‌شده:{' '}
                        <span className="font-mono text-[11px] text-[#1A1816]" dir="ltr">
                          words × {spec.persianWordTokenMultiplier}
                        </span>{' '}
                        (هر کلمه فارسی/فنی به‌طور میانگین ۲٫۱ تا ۲٫۴ توکن UTF-8 است).
                      </li>
                      <li>
                        • فایل‌های در صف پیش از پردازش:{' '}
                        <span className="font-mono text-[11px] text-[#1A1816]" dir="ltr">
                          bytes × {spec.queuedByteTokenMultiplier}
                        </span>{' '}
                        (با احتساب فشرده‌سازی <span className="font-mono">.docx</span> و <span className="font-mono">.pdf</span>).
                      </li>
                      <li>
                        • برآورد نوبت بعدی این پروژه:{' '}
                        <strong className="text-[#1A1816]">
                          ~{formatCompactTokensFa(spec.estimatedNextPassTokens)} توکن
                        </strong>{' '}
                        (چکیده حداکثر ۲۸ هزار توکن + سهم تکمیل گوگل).
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-2">
                    <div className="text-xs font-bold text-[#1E3A5F]">
                      آستانه‌های نشانگر و معادل هزینه پلن پولی
                    </div>
                    <ul className="space-y-1.5 text-xs leading-5.5 text-[#44403C] tabular-nums">
                      <li>
                        • <strong className="text-[#14532D]">مصرف بهینه:</strong> کمتر از {toPersianDigits(spec.warningThresholdPercent)}٪ سقف مرجع توکن و تعداد درخواست.
                      </li>
                      <li>
                        • <strong className="text-[#B45309]">متوسط رو به بالا:</strong> بین {toPersianDigits(spec.warningThresholdPercent)}٪ تا {toPersianDigits(spec.criticalThresholdPercent - 1)}٪ (بیشینه نسبت توکن یا درخواست).
                      </li>
                      <li>
                        • <strong className="text-[#9A3412]">نزدیک سقف سهمیه:</strong> از {toPersianDigits(spec.criticalThresholdPercent)}٪ به بالا (توصیه به سوییچ به Flash Lite).
                      </li>
                      <li>
                        • نرخ مرجع مدل فعال (<span className="font-mono text-[11px]">{spec.modelId}</span>):{' '}
                        <span className="font-mono text-[11px] text-[#1A1816]" dir="ltr">
                          ${spec.inputRatePerMillionUsd.toFixed(2)}/1M in · ${spec.outputRatePerMillionUsd.toFixed(2)}/1M out
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 3: PROJECT QUOTA VS PERSONAL USER QUOTA */}
          {activeTab === 'quota_model' && (
            <div role="tabpanel" className="space-y-6">
              {/* Direct Executive Answer */}
              <section className="rounded-xl border border-[#D4DFEC] bg-[#F3F7FB] p-4 space-y-2">
                <h3 className="text-sm font-extrabold text-[#1E3A5F]">
                  معماری فعلی این اپلیکیشن: استفاده از سهمیه متمرکز پروژه (سرور)
                </h3>
                <p className="text-xs leading-6 text-[#292524]">
                  در این پلتفرم، <strong>ورود با حساب گوگل (Google Sign-In)</strong> صرفاً برای احراز هویت، جدا کردن فضای کاری هر کاربر در دیتابیس و حفظ امنیت اسناد شماست. تمامی درخواست‌های هوش مصنوعی از سمت سرور و با کلید API متصل به پروژه (<code className="font-mono text-[11px]" dir="ltr">GEMINI_API_KEY</code>) اجرا می‌شوند؛ بنابراین <strong>هیچ سهمیه‌ای از اکانت شخصی یا پلن گوگل کاربران کسر نمی‌شود</strong> و کاربران نیازی به ساخت پروژه Cloud یا دریافت کلید API شخصی ندارند.
                </p>
              </section>

              {/* Detailed Side-by-Side Comparison Table */}
              <section aria-label="جدول مقایسه سهمیه پروژه و سهمیه شخصی" className="space-y-2.5">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  مقایسه دقیق: سهمیه پروژه (مدل فعلی) در برابر سهمیه شخصی کاربر (BYOK / OAuth)
                </h3>

                <div className="overflow-x-auto rounded-xl border border-[#E2DDD3] bg-white">
                  <table className="w-full text-right text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#E7E2D8] bg-[#F7F4EE] text-[#57534E]">
                        <th className="px-4 py-2.5 font-bold">معیار مقایسه</th>
                        <th className="px-4 py-2.5 font-bold text-[#1E3A5F]">
                          سهمیه پروژه / سرور (فعال در این اپ)
                        </th>
                        <th className="px-4 py-2.5 font-bold">سهمیه شخصی هر کاربر (اکانت خود کاربر)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFECE4] text-[#292524]">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">منبع کسر توکن و هزینه</td>
                        <td className="px-4 py-2.5">
                          از کلید API و سهمیه پروژه مالک اپلیکیشن (سرور) کسر می‌شود.
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          از کلید API شخصی یا پروژه Google Cloud خود کاربر کسر می‌شود.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">نیاز کاربر به پلن پولی یا Cloud</td>
                        <td className="px-4 py-2.5 font-medium text-[#14532D]">
                          ندارد — هر کاربر بلافاصله پس از ورود با جیمیل می‌تواند کار کند.
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          نیاز دارد کاربر کلید AI Studio بسازد یا صورت‌حساب ابری فعال کند.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">رفتار در استفاده چندکاربره هم‌زمان</td>
                        <td className="px-4 py-2.5">
                          سقف درخواست در دقیقه (RPM) و روز (RPD) بین همه کاربران مشترک است؛ بنابراین در ترافیک بالا ممکن است خطای <span className="font-mono">429</span> رخ دهد.
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          سقف هر کاربر مستقل است و مصرف یک کاربر روی سهمیه کاربر دیگر اثر نمی‌گذارد.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">امنیت کلید و کنترل دسترسی</td>
                        <td className="px-4 py-2.5">
                          کلید API هرگز به مرورگر ارسال نمی‌شود و فقط در محیط ایزوله سرور نگهداری می‌شود.
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          نیازمند مدیریت امن ذخیره/رمزنگاری کلید کاربر یا نشست‌های مجاز اختصاصی است.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">تأثیر روی پردازش فایل‌ها</td>
                        <td className="px-4 py-2.5">
                          کاربر حتی در صورت پر شدن سهمیه AI پروژه، همچنان می‌تواند فایل‌ها را به‌صورت محلی ادغام و خروجی <span className="font-mono">.docx</span> دریافت کند.
                        </td>
                        <td className="px-4 py-2.5 text-[#57534E]">
                          در صورت اتمام سهمیه شخصی، همان کاربر باید پلن خود را ارتقا دهد یا صبر کند.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Practical Optimization Checklist */}
              <section className="space-y-2 border-t border-[#E7E2D8] pt-4">
                <h3 className="text-xs font-extrabold text-[#1A1816]">
                  راهکارهای عملی مدیریت سهمیه در پروژه‌های حجیم
                </h3>
                <ul className="space-y-1.5 text-xs leading-6 text-[#44403C]">
                  <li>
                    ۱. برای ادغام ۵۰ تا ۱۰۰+ فایل ورد بدون نیاز به هوش مصنوعی، تیک <strong>«تحلیل با هوش مصنوعی»</strong> را خاموش بگذارید تا موتور محلی با پوشش ۱۰۰٪ و بدون مصرف حتی یک توکن سند را بسازد.
                  </li>
                  <li>
                    ۲. در پروژه‌های پرفصل، مدل را از <strong>Hydrogen</strong> به <strong>Flash Lite</strong> تغییر دهید تا سقف مرجع پروژه از ۲۵۰ هزار به ۴۰۰ هزار توکن افزایش یابد و معادل هزینه تا ۷۰٪ کاهش پیدا کند.
                  </li>
                  <li>
                    ۳. گزینه <strong>«تکمیل کل سند با گوگل»</strong> را تنها پس از تأیید نهایی فهرست فصل‌ها اجرا کنید تا از تکرار درخواست جستجو جلوگیری شود.
                  </li>
                </ul>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-[#E7E2D8] bg-white px-5 py-3 sm:px-6">
          <div className="text-[11px] text-[#78716C] tabular-nums truncate">
            مدل فعال: <strong className="text-[#44403C]">{spec.modelDisplayName}</strong> · وضعیت:{' '}
            <strong className={STATUS_TEXT_COLOR[snapshot.statusLevel]}>{snapshot.statusLabel}</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[38px] shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] px-5 py-2 text-xs font-bold text-white hover:bg-[#162C49] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F] transition-colors cursor-pointer"
          >
            متوجه شدم
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
};
