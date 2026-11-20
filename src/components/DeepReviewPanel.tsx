import React, { useEffect, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { DeepReviewReportDto } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';

export interface DeepReviewProgressState {
  percent: number;
  stage: string;
  model?: string;
  thinkingLevel?: string;
  attempt?: number;
  totalAttempts?: number;
  startedAt: number;
}

export const DeepReviewProgressBanner: React.FC<{
  progress: DeepReviewProgressState;
  variant?: 'bar' | 'card';
}> = ({ progress, variant = 'bar' }) => {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const update = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - progress.startedAt) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [progress.startedAt]);

  const clampedPercent = Math.max(0, Math.min(100, Math.round(progress.percent)));

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        variant === 'card'
          ? 'rounded-xl border border-[#C6D5E6] bg-[#F2F6FB] p-4 space-y-2.5'
          : 'border-b border-[#C6D5E6] bg-[#F2F6FB] px-4 py-3'
      }
    >
      <div className={variant === 'bar' ? 'mx-auto max-w-5xl space-y-2' : 'space-y-2'}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 className="h-4 w-4 animate-spin text-[#1E3A5F] shrink-0" />
            <span className="text-xs font-extrabold text-[#1E3A5F] truncate">
              {progress.stage}
            </span>
          </div>
          <span className="shrink-0 text-sm font-extrabold text-[#1E3A5F] tabular-nums">
            {toPersianDigits(clampedPercent)}٪
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-[#DAE4F0]">
          <div
            className="h-full rounded-full bg-[#1E3A5F] transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(4, clampedPercent)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#475569] tabular-nums">
          <span>زمان سپری‌شده: {toPersianDigits(elapsedSec)} ثانیه</span>
          {progress.model && (
            <>
              <span aria-hidden="true" className="text-[#B6C5D8]">·</span>
              <span className="font-mono text-[10.5px]" dir="ltr">
                {progress.model}
              </span>
            </>
          )}
          {progress.thinkingLevel && (
            <>
              <span aria-hidden="true" className="text-[#B6C5D8]">·</span>
              <span>سطح استدلال {progress.thinkingLevel}</span>
            </>
          )}
          {progress.attempt && progress.totalAttempts && progress.attempt > 1 && (
            <>
              <span aria-hidden="true" className="text-[#B6C5D8]">·</span>
              <span>
                مسیر جایگزین ({toPersianDigits(progress.attempt)} از {toPersianDigits(progress.totalAttempts)})
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface DeepReviewPanelProps {
  report: DeepReviewReportDto;
  running: boolean;
  onRerun: () => Promise<void>;
}

const SEVERITY_META: Record<
  'high' | 'medium' | 'low',
  { label: string; className: string }
> = {
  high: {
    label: 'مهم',
    className: 'bg-[#FDF2F0] text-[#9A3412] border-[#E6BFB7]',
  },
  medium: {
    label: 'متوسط',
    className: 'bg-[#FEF9EE] text-[#92400E] border-[#EBD5A7]',
  },
  low: {
    label: 'تکمیلی',
    className: 'bg-[#EEF3F8] text-[#1E3A5F] border-[#C6D5E6]',
  },
};

export const DeepReviewPanel: React.FC<DeepReviewPanelProps> = ({
  report,
  running,
  onRerun,
}) => {
  const [expanded, setExpanded] = useState(true);
  const appliedCounts = report?.appliedCounts ?? {
    titlesRefined: 0,
    calloutsAdded: 0,
    tablesAdded: 0,
    paragraphsAdded: 0,
  };
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const totalApplied =
    appliedCounts.titlesRefined +
    appliedCounts.calloutsAdded +
    appliedCounts.tablesAdded +
    appliedCounts.paragraphsAdded;

  return (
    <section className="border-b border-[#D8E2EE] bg-[#F5F8FC] px-4 py-3 text-xs">
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] text-white">
              <Brain className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-[#1E3A5F] text-xs sm:text-sm">
                  گزارش بازبینی عمیق هوش مصنوعی ({report.thinkingLevel})
                </span>
                <span className="rounded-md border border-[#C7DDD0] bg-[#F2F7F4] px-2 py-0.5 text-[11px] font-bold text-[#14532D] tabular-nums">
                  امتیاز کیفیت سند: {toPersianDigits(report.overallScore)} از ۱۰۰
                </span>
                <span className="rounded-md border border-[#C6D5E6] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1E3A5F]">
                  {toPersianDigits(totalApplied)} بهبود بدون افت اعمال شد
                </span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-[#3B5578] leading-5">
                {report.overallAssessment}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRerun}
              disabled={running}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-white px-3 py-1 text-[11.5px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>بازبینی مجدد</span>
            </button>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'بستن جزئیات بازبینی' : 'نمایش جزئیات بازبینی'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#C6D5E6] bg-white text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="space-y-3 pt-1">
            {/* Applied Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg border border-[#DDE6F0] bg-white px-3 py-2">
                <div className="text-[10.5px] text-[#64748B]">اصلاح عنوان فصل‌ها</div>
                <div className="text-sm font-extrabold text-[#1E3A5F] tabular-nums">
                  {toPersianDigits(appliedCounts.titlesRefined)} مورد
                </div>
              </div>
              <div className="rounded-lg border border-[#DDE6F0] bg-white px-3 py-2">
                <div className="text-[10.5px] text-[#64748B]">باکس‌های نکته/هشدار افزوده‌شده</div>
                <div className="text-sm font-extrabold text-[#1E3A5F] tabular-nums">
                  {toPersianDigits(appliedCounts.calloutsAdded)} مورد
                </div>
              </div>
              <div className="rounded-lg border border-[#DDE6F0] bg-white px-3 py-2">
                <div className="text-[10.5px] text-[#64748B]">جداول ساختاریافته جدید</div>
                <div className="text-sm font-extrabold text-[#1E3A5F] tabular-nums">
                  {toPersianDigits(appliedCounts.tablesAdded)} مورد
                </div>
              </div>
              <div className="rounded-lg border border-[#DDE6F0] bg-white px-3 py-2">
                <div className="text-[10.5px] text-[#64748B]">توضیحات تکمیلی و پیوندی</div>
                <div className="text-sm font-extrabold text-[#1E3A5F] tabular-nums">
                  {toPersianDigits(appliedCounts.paragraphsAdded)} مورد
                </div>
              </div>
            </div>

            {/* Findings List */}
            {findings.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-[#1A1816] text-[11.5px]">
                  <Sparkles className="h-3.5 w-3.5 text-[#1E3A5F]" />
                  <span>نقص‌ها و بهبودهای شناسایی‌شده ({toPersianDigits(findings.length)} مورد):</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {findings.map((f, idx) => {
                    const sev = SEVERITY_META[f.severity] || SEVERITY_META.medium;
                    return (
                      <div
                        key={idx}
                        className="rounded-lg border border-[#E2DDD3] bg-white p-2.5 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#1A1816] truncate">
                            {f.chapterTitle || f.category}
                          </span>
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${sev.className}`}
                          >
                            {sev.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#57534E] leading-5">
                          <strong>یافته:</strong> {f.issue}
                        </p>
                        <p className="flex items-start gap-1 text-[11px] text-[#14532D] leading-5">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>
                            <strong>بهبود اعمال‌شده:</strong> {f.fixApplied}
                          </span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
