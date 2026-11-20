import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Gauge, Info } from 'lucide-react';
import { AiModelId, GoogleSearchMode, ProjectAiUsageLedger } from '../lib/bookTypes';
import {
  computeProjectQuotaSnapshot,
  formatCompactTokensFa,
  QuotaStatusLevel,
} from '../lib/aiUsageMetrics';
import { toPersianDigits } from '../lib/formatParsers';
import { AiQuotaInfoModal } from './AiQuotaInfoModal';

interface AiQuotaGaugeProps {
  usage: ProjectAiUsageLedger;
  ingestedFilesCount: number;
  queuedFilesCount: number;
  ingestedWordCount: number;
  queuedBytesCount: number;
  chapterCount: number;
  aiModel: AiModelId;
  googleSearchMode: GoogleSearchMode;
  useAiBackend: boolean;
}

const STATUS_STYLE: Record<
  QuotaStatusLevel,
  { stroke: string; text: string; bar: string; track: string }
> = {
  normal: {
    stroke: '#14532D',
    text: 'text-[#14532D]',
    bar: 'bg-[#14532D]',
    track: 'bg-[#E7E3DA]',
  },
  warning: {
    stroke: '#B45309',
    text: 'text-[#B45309]',
    bar: 'bg-[#B45309]',
    track: 'bg-[#EDE3D5]',
  },
  critical: {
    stroke: '#9A3412',
    text: 'text-[#9A3412]',
    bar: 'bg-[#9A3412]',
    track: 'bg-[#F0DDD9]',
  },
};

export const AiQuotaGauge: React.FC<AiQuotaGaugeProps> = ({
  usage,
  ingestedFilesCount,
  queuedFilesCount,
  ingestedWordCount,
  queuedBytesCount,
  chapterCount,
  aiModel,
  googleSearchMode,
  useAiBackend,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const snapshot = useMemo(
    () =>
      computeProjectQuotaSnapshot({
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

  const palette = STATUS_STYLE[snapshot.statusLevel];

  // Semi-circular arc geometry (radius = 22, circumference of half-circle = PI * 22 ≈ 69.115)
  const radius = 22;
  const arcLength = Math.PI * radius;
  const activePct =
    snapshot.consumedTokens > 0 ? Math.max(4, snapshot.consumedPercent) : 0;
  const projectedPct =
    snapshot.consumedTokens === 0 && snapshot.projectedPercent > 0
      ? Math.max(4, snapshot.projectedPercent)
      : 0;
  const activeOffset = arcLength * (1 - activePct / 100);
  const projectedOffset = arcLength * (1 - projectedPct / 100);

  return (
    <section
      aria-label="نشانگر مصرف توکن و سهمیه هوش مصنوعی پروژه"
      className="rounded-xl border border-[#E2DDD3] bg-white p-3.5"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Compact Semi-Circular Arc Gauge */}
        <div className="relative flex h-[38px] w-[58px] shrink-0 items-end justify-center">
          <svg
            viewBox="0 0 56 34"
            className="h-[34px] w-[56px] overflow-visible"
            aria-hidden="true"
          >
            {/* Background track arc */}
            <path
              d="M 6 29 A 22 22 0 0 1 50 29"
              fill="none"
              stroke="#E7E3DA"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            {/* Projected load arc (shown subtly before first AI call) */}
            {projectedPct > 0 && (
              <path
                d="M 6 29 A 22 22 0 0 1 50 29"
                fill="none"
                stroke="#94A3B8"
                strokeOpacity="0.45"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeDasharray={arcLength}
                strokeDashoffset={projectedOffset}
              />
            )}
            {/* Active consumed arc */}
            {activePct > 0 && (
              <path
                d="M 6 29 A 22 22 0 0 1 50 29"
                fill="none"
                stroke={palette.stroke}
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeDasharray={arcLength}
                strokeDashoffset={activeOffset}
              />
            )}
          </svg>
          <span
            className={`absolute bottom-0 text-[11px] font-extrabold tabular-nums leading-none ${palette.text}`}
          >
            {toPersianDigits(snapshot.consumedPercent)}٪
          </span>
        </div>

        {/* Summary Readout */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1 text-[11.5px] font-bold text-[#1A1816] truncate">
              <Gauge className="h-3.5 w-3.5 text-[#1E3A5F] shrink-0" />
              <span className="truncate">مصرف هوش مصنوعی پروژه</span>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                aria-label="راهنمای فنی محاسبه مصرف و سهمیه هوش مصنوعی"
                title="راهنمای فنی محاسبه مصرف، لیمیت‌ها و سهمیه"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#57534E] hover:bg-[#EEF3F8] hover:text-[#1E3A5F] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E3A5F] transition-colors cursor-pointer"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="inline-flex min-h-[28px] shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-[#1E3A5F] hover:bg-[#EEF3F8] transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>{expanded ? 'بستن' : 'جزئیات'}</span>
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[#57534E] tabular-nums">
            <span className={`font-semibold ${palette.text}`}>{snapshot.statusLabel}</span>
            <span aria-hidden="true" className="text-[#CFC8B9]">·</span>
            <span>
              {formatCompactTokensFa(snapshot.consumedTokens)} از{' '}
              {formatCompactTokensFa(snapshot.softBudgetTokens)} توکن
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-[#78716C] tabular-nums">
            <span>{toPersianDigits(snapshot.requestCount)} درخواست</span>
            <span aria-hidden="true" className="text-[#CFC8B9]">·</span>
            <span>مدل {snapshot.modelDisplayName}</span>
            {snapshot.consumedTokens > 0 && (
              <>
                <span aria-hidden="true" className="text-[#CFC8B9]">·</span>
                <span dir="ltr" className="font-mono text-[10px]">
                  {snapshot.formattedCostUsd}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expandable Transparent Breakdown (flat hairline grid, no nested cards) */}
      {expanded && (
        <div className="mt-3 border-t border-[#EFECE4] pt-2.5 space-y-2.5 text-[11px]">
          {/* Dual-segment slim reference bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10.5px] text-[#57534E] tabular-nums">
              <span>نسبت مصرف به سقف پیشنهادی پروژه</span>
              <span className="font-bold text-[#1A1816]">
                {toPersianDigits(snapshot.consumedPercent)}٪
              </span>
            </div>
            <div className={`h-1.5 w-full overflow-hidden rounded-full ${palette.track} relative`}>
              {snapshot.consumedTokens === 0 && snapshot.projectedPercent > 0 && (
                <div
                  className="absolute inset-y-0 right-0 rounded-full bg-[#94A3B8]/40"
                  style={{ width: `${snapshot.projectedPercent}%` }}
                />
              )}
              <div
                className={`h-full rounded-full ${palette.bar}`}
                style={{ width: `${snapshot.consumedPercent}%` }}
              />
            </div>
          </div>

          {/* 2x2 Flat Metric Grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#F2EFE8] pt-2 tabular-nums">
            <div>
              <div className="text-[10px] text-[#78716C]">توکن ورودی / خروجی</div>
              <div className="font-bold text-[#1A1816] mt-0.5">
                {formatCompactTokensFa(usage.promptTokens)} /{' '}
                {formatCompactTokensFa(usage.outputTokens + usage.thinkingTokens)}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#78716C]">تخمین حجم فایل‌های پروژه</div>
              <div className="font-bold text-[#1A1816] mt-0.5">
                ~{formatCompactTokensFa(snapshot.estimatedDocumentTokens)} توکن
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#78716C]">تفکیک عملیات هوش مصنوعی</div>
              <div className="font-semibold text-[#44403C] mt-0.5">
                گوگل {toPersianDigits(usage.groundingCallCount)} · بازبینی{' '}
                {toPersianDigits(usage.deepReviewCount)} · چت{' '}
                {toPersianDigits(usage.chatCallCount)}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#78716C]">معادل هزینه پلن پولی</div>
              <div className="mt-0.5 flex items-baseline gap-1 text-[11px] font-bold text-[#1A1816]">
                <span dir="ltr" className="font-mono">
                  {snapshot.formattedCostUsd}
                </span>
                <span className="text-[10px] font-normal text-[#78716C]">
                  (تقریبی)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[#F2EFE8] pt-2">
            <span className="text-[10px] text-[#78716C]">
              مبنای سهمیه: کلید Gemini سرور پروژه
            </span>
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Info className="h-3 w-3" />
              <span>راهنمای فنی و مقایسه سهمیه</span>
            </button>
          </div>
        </div>
      )}

      {/* Technical Quota & Calculation Info Modal */}
      <AiQuotaInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        usage={usage}
        snapshot={snapshot}
        ingestedFilesCount={ingestedFilesCount}
        queuedFilesCount={queuedFilesCount}
        ingestedWordCount={ingestedWordCount}
        queuedBytesCount={queuedBytesCount}
        chapterCount={chapterCount}
        aiModel={aiModel}
        googleSearchMode={googleSearchMode}
        useAiBackend={useAiBackend}
      />
    </section>
  );
};

