import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Gauge,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { AiModelId, GoogleSearchMode, ProjectAiUsageLedger } from '../lib/bookTypes';
import {
  AiProviderConfig,
  AiQuotaProbeResponse,
  getProviderDisplaySummary,
} from '../lib/aiProviderConfig';
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
  providerConfig: AiProviderConfig;
  probeData: AiQuotaProbeResponse | null;
  probing: boolean;
  onRunLiveProbe: () => Promise<void>;
  onOpenProviderSettings: () => void;
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
  providerConfig,
  probeData,
  probing,
  onRunLiveProbe,
  onOpenProviderSettings,
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

  const activeProbe = probeData?.activeProbe ?? null;
  const effectiveStatusLevel: QuotaStatusLevel =
    activeProbe && !activeProbe.hasQuota ? 'critical' : snapshot.statusLevel;
  const palette = STATUS_STYLE[effectiveStatusLevel];

  // Semi-circular arc geometry showing REMAINING quota intuitively (or consumed fill)
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

  const providerSummary = getProviderDisplaySummary(providerConfig, aiModel);
  const activeModelLabel = providerSummary.modelLabel;

  const keySourceBadge =
    activeProbe?.switchedFromCreator
      ? `${providerSummary.providerLabel} · سوئیچ به کلید شما`
      : activeProbe?.keySource === 'creator'
        ? `${providerSummary.providerLabel} · سهمیه سازنده`
        : `${providerSummary.providerLabel} · ${providerSummary.keySourceLabel}`;

  return (
    <section
      aria-label="نشانگر مصرف توکن و استعلام زنده سهمیه هوش مصنوعی"
      className="rounded-xl border border-[#E2DDD3] bg-white p-3.5 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Compact Semi-Circular Arc Gauge */}
        <div className="relative flex h-[38px] w-[58px] shrink-0 items-end justify-center">
          <svg
            viewBox="0 0 56 34"
            className="h-[34px] w-[56px] overflow-visible"
            aria-hidden="true"
          >
            <path
              d="M 6 29 A 22 22 0 0 1 50 29"
              fill="none"
              stroke="#E7E3DA"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
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
            className={`absolute bottom-0 text-[10.5px] font-extrabold tabular-nums leading-none ${palette.text}`}
          >
            {toPersianDigits(snapshot.remainingPercent)}٪
          </span>
        </div>

        {/* Summary Readout */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 text-[11.5px] font-bold text-[#1A1816] truncate">
              <Gauge className="h-3.5 w-3.5 text-[#1E3A5F] shrink-0" />
              <span className="truncate">سهمیه هوش مصنوعی</span>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => void onRunLiveProbe()}
                disabled={probing}
                aria-label="استعلام زنده باقی‌مانده سهمیه"
                title="استعلام زنده سهمیه از سرور"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#57534E] hover:bg-[#EEF3F8] hover:text-[#1E3A5F] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                aria-label="راهنمای محاسبه ساده توکن و سهمیه"
                title="محاسبه ساده توکن و راهنمای سهمیه"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#57534E] hover:bg-[#EEF3F8] hover:text-[#1E3A5F] cursor-pointer"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="inline-flex min-h-[28px] shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer whitespace-nowrap"
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
            <span className="font-bold text-[#14532D]">
              مانده: {formatCompactTokensFa(snapshot.remainingTokens)}
            </span>
            <span aria-hidden="true" className="text-[#CFC8B9]">·</span>
            <span>مصرف: {formatCompactTokensFa(snapshot.consumedTokens)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-[#78716C] tabular-nums">
            <span>{activeModelLabel}</span>
            <span aria-hidden="true" className="text-[#CFC8B9]">·</span>
            <span>{keySourceBadge}</span>
          </div>
        </div>
      </div>

      {/* Live Probe Status Strip + Quick Provider Button */}
      <div className="flex items-center justify-between gap-2 border-t border-[#EFECE4] pt-2 text-[10.5px]">
        <div className="flex items-center gap-1.5 min-w-0">
          {probing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E3A5F] shrink-0" />
              <span className="text-[#57534E] truncate">در حال استعلام زنده سهمیه...</span>
            </>
          ) : activeProbe ? (
            <>
              {activeProbe.hasQuota ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-[#9A3412] shrink-0" />
              )}
              <span
                className={`font-semibold truncate ${
                  activeProbe.hasQuota ? 'text-[#14532D]' : 'text-[#9A3412]'
                }`}
              >
                {activeProbe.statusLabelFa}
              </span>
            </>
          ) : (
            <span className="text-[#78716C] truncate">
              هر کلمه ≈ ۲ توکن · هر صفحه ≈ ۸۰۰ توکن
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenProviderSettings}
          className="inline-flex min-h-[26px] shrink-0 items-center gap-1 rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-0.5 text-[10.5px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer whitespace-nowrap"
        >
          <KeyRound className="h-3 w-3" />
          <span>ارائه‌دهنده / کلید</span>
        </button>
      </div>

      {/* Expandable Simple Breakdown */}
      {expanded && (
        <div className="border-t border-[#EFECE4] pt-2.5 space-y-2.5 text-[11px]">
          <div className="rounded-lg border border-[#E5E0D6] bg-[#FAF9F6] px-2.5 py-2 text-[10.5px] leading-5 text-[#44403C] tabular-nums">
            <strong>فرمول ساده:</strong> هر کلمه فارسی ≈ <strong>۲ توکن</strong> و هر صفحه ورد ≈{' '}
            <strong>۸۰۰ توکن</strong>. سند فعلی شما حدود{' '}
            <strong>{formatCompactTokensFa(snapshot.estimatedDocumentTokens)} توکن</strong> (≈{' '}
            {toPersianDigits(snapshot.estimatedDocumentPages)} صفحه) است.
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 tabular-nums">
            <div>
              <div className="text-[10px] text-[#78716C]">باقی‌مانده این پروژه</div>
              <div className="font-bold text-[#14532D] mt-0.5">
                {formatCompactTokensFa(snapshot.remainingTokens)} (≈{' '}
                {toPersianDigits(snapshot.remainingPagesEquivalent)} صفحه)
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#78716C]">درخواست‌های ثبت‌شده</div>
              <div className="font-bold text-[#1A1816] mt-0.5">
                {toPersianDigits(snapshot.requestCount)} از {toPersianDigits(snapshot.softRequestCap)}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#78716C]">ورودی / خروجی</div>
              <div className="font-semibold text-[#44403C] mt-0.5">
                {formatCompactTokensFa(usage.promptTokens)} /{' '}
                {formatCompactTokensFa(usage.outputTokens + usage.thinkingTokens)}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#78716C]">معادل هزینه پلن پولی</div>
              <div className="font-bold text-[#1A1816] mt-0.5 font-mono" dir="ltr">
                <span className="block text-right">{snapshot.formattedCostUsd}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[#F2EFE8] pt-2">
            <button
              type="button"
              onClick={() => void onRunLiveProbe()}
              disabled={probing}
              className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold text-[#14532D] hover:bg-[#F2F7F4] cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${probing ? 'animate-spin' : ''}`} />
              <span>استعلام زنده مجدد</span>
            </button>
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer whitespace-nowrap"
            >
              <Info className="h-3 w-3" />
              <span>محاسبه ساده و جزئیات</span>
            </button>
          </div>
        </div>
      )}

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
        providerConfig={providerConfig}
        probeData={probeData}
        probing={probing}
        onRunLiveProbe={onRunLiveProbe}
        onOpenProviderSettings={onOpenProviderSettings}
      />
    </section>
  );
};
