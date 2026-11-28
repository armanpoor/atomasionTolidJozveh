import { ChevronDown, ChevronUp, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { AdaptiveProjectProfile } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';

interface AdaptiveProjectProfileBannerProps {
  profile: AdaptiveProjectProfile | null | undefined;
  generatingVisuals?: boolean;
  canGenerateVisuals?: boolean;
  onGenerateAdaptiveVisuals?: () => void;
}

export function AdaptiveProjectProfileBanner({
  profile,
  generatingVisuals = false,
  canGenerateVisuals = false,
  onGenerateAdaptiveVisuals,
}: AdaptiveProjectProfileBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!profile) return null;

  return (
    <section
      data-testid="adaptive-project-profile-banner"
      aria-label="تطبیق هوشمند پروژه بر اساس ماهیت فایل‌های ورودی"
      className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-bold text-[#1E3A5F]">تطبیق خودکار پروژه با ماهیت فایل‌ها</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-800">{profile.dominantLabelFa}</span>
            <span aria-hidden="true">·</span>
            <span>قالب فعال: {profile.visualStyleLabelFa}</span>
            {profile.pythonChartingRecommended && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-emerald-700">
                  ویژوالساز پایتون فعال
                  {profile.numericChartReport?.keywordHits?.length
                    ? ` (${profile.numericChartReport.keywordHits
                        .slice(0, 4)
                        .map((k) => k.keywordToken)
                        .join('، ')})`
                    : ''}
                </span>
              </>
            )}
            {(profile.numericChartReport?.totalWinolsTablesDetected ?? 0) > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-amber-800 tabular-nums">
                  {toPersianDigits(profile.numericChartReport!.totalWinolsTablesDetected)} جدول WinOLS گرافیکی
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-5">
            {profile.numericChartReport?.shouldActivatePythonVisualizer
              ? profile.numericChartReport.summaryFa
              : profile.summaryFa}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canGenerateVisuals && onGenerateAdaptiveVisuals && (
            <button
              type="button"
              data-testid="run-adaptive-visuals-btn"
              onClick={onGenerateAdaptiveVisuals}
              disabled={generatingVisuals}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#162C49] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              {generatingVisuals ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>
                {generatingVisuals
                  ? 'در حال رسم نمودارهای پایتون و گرافیک...'
                  : 'ساخت و بروزرسانی نمودارهای پایتون و بصری'}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>جزئیات تحلیل و تغییرات ({toPersianDigits(profile.autoAppliedChanges.length)})</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-slate-200 pt-4">
          {/* Detected Content Nature Composition & Numeric Keywords */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-900">
              ترکیب موضوعی و کلیدواژه‌های نموداری تشخیص‌داده‌شده
            </h4>
            {profile.numericChartReport && profile.numericChartReport.keywordHits.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-1.5">
                <div className="text-[11px] font-bold text-[#1E3A5F]">
                  ماژول تحلیل داده عددی (محرک فعال‌سازی خودکار پایتون در مرحله ۴)
                </div>
                <div className="space-y-1 text-[11.5px] text-slate-700">
                  {profile.numericChartReport.keywordHits.map((hit) => (
                    <div key={hit.category} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{hit.labelFa}</span>
                      <span className="font-mono text-[11px] text-slate-600 tabular-nums" dir="ltr">
                        {hit.occurrences}× {hit.sampleValues.length > 0 ? `· ${hit.sampleValues.slice(0, 2).join(', ')}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              {profile.archetypes.map((arch) => (
                <div key={arch.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">{arch.labelFa}</span>
                    <span className="font-mono font-bold text-[#1E3A5F] tabular-nums">
                      {toPersianDigits(arch.sharePercent)}٪
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[#1E3A5F]"
                      style={{ width: `${Math.max(4, arch.sharePercent)}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    خلاقیت بصری پیشنهادی: {arch.recommendedVisualFa}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Automatic Changes Applied to Project */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-slate-900">
              تغییرات خودکار اعمال‌شده روی تنظیمات پروژه
            </h4>
            {profile.autoAppliedChanges.length === 0 ? (
              <p className="text-xs text-slate-500">
                تنظیمات پروژه از قبل با ماهیت فایل‌های فعلی هماهنگ بود.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {profile.autoAppliedChanges.map((ch, idx) => (
                  <li
                    key={`${ch.field}_${idx}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="font-semibold text-slate-900">{ch.labelFa}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-slate-600">{ch.detailFa}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
