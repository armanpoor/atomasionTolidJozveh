import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart2, BookOpenCheck, Layers } from 'lucide-react';
import type { ProjectBundleDto } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import {
  ChapterVolumeDatum,
  computeChapterVolumeAndCoverage,
} from '../lib/workspaceInsights';
import {
  computeCoverageLedgerStats,
  extractHarnessStateFromCheckpoint,
} from '../lib/harness/harnessStore';
import type { HarnessState } from '../lib/harness/types';

interface ChapterCoverageChartWidgetProps {
  bundle: ProjectBundleDto | null;
  harnessState?: HarnessState | null;
}

type ChartViewMode = 'composed' | 'horizontal_share';

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChapterVolumeDatum }>;
}

const ChapterChartTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div
      dir="rtl"
      className="rounded-lg border border-[#D6D0C4] bg-white px-3 py-2.5 text-right text-[11.5px] shadow-md max-w-[260px] space-y-1.5"
    >
      <div className="font-extrabold text-[#1A1816] leading-5 border-b border-[#EFECE4] pb-1">
        {toPersianDigits(item.order)}. {item.title}
      </div>
      <dl className="space-y-1 text-[11px] tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#57534E]">کلمات یکتای حفظ‌شده:</dt>
          <dd className="font-bold text-[#1E3A5F]">
            {toPersianDigits(item.uniqueWords.toLocaleString('en-US'))} کلمه
          </dd>
        </div>
        {item.mergedWords > 0 && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#57534E]">کلمات ادغام‌شده بدون افت:</dt>
            <dd className="font-bold text-[#8C6226]">
              {toPersianDigits(item.mergedWords.toLocaleString('en-US'))} کلمه
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#57534E]">سهم از حجم کل سند:</dt>
          <dd className="font-bold text-[#1A1816]">
            {toPersianDigits(item.sharePercent)}٪
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[#57534E]">پوشش کلمات فصل:</dt>
          <dd className="font-bold text-[#14532D]">
            {toPersianDigits(item.coveragePercent)}٪
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 text-[#78716C]">
          <dt>تعداد واحد محتوایی:</dt>
          <dd className="font-semibold">{toPersianDigits(item.unitCount)} واحد</dd>
        </div>
      </dl>
    </div>
  );
};

export const ChapterCoverageChartWidget: React.FC<ChapterCoverageChartWidgetProps> = ({
  bundle,
  harnessState: explicitHarnessState = null,
}) => {
  const [viewMode, setViewMode] = useState<ChartViewMode>('composed');

  const summary = useMemo(() => computeChapterVolumeAndCoverage(bundle), [bundle]);

  const effectiveHarnessState = useMemo(
    () =>
      explicitHarnessState ||
      extractHarnessStateFromCheckpoint(bundle?.project?.checkpointJson),
    [explicitHarnessState, bundle?.project?.checkpointJson]
  );

  const ledgerStats = useMemo(
    () =>
      effectiveHarnessState
        ? computeCoverageLedgerStats(effectiveHarnessState.coverageLedger)
        : null,
    [effectiveHarnessState]
  );

  const modeSubtitle =
    summary.sourceMode === 'outline'
      ? 'بر اساس فصل‌بندی فعال و واحدهای متنی پروژه'
      : summary.sourceMode === 'book_snapshot'
        ? 'بر اساس سند نهایی صفحه‌آرایی‌شده'
        : summary.sourceMode === 'extracted_units'
          ? 'توزیع اولیه بر اساس سرفصل‌های استخراج‌شده مرحله ۱'
          : 'پس از استخراج فایل‌ها در مرحله ۱ فعال می‌شود';

  const horizontalHeight = Math.max(220, Math.min(420, summary.chapters.length * 40 + 48));

  return (
    <div
      data-testid="chapter-coverage-recharts-widget"
      className="p-4 sm:p-5 space-y-4 bg-white"
    >
      {/* Header & View Mode Switch */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-extrabold text-[#1A1816]">
            <BarChart2 className="h-4 w-4 text-[#1E3A5F] shrink-0" />
            <span>توزیع حجمی فصل‌ها و میزان پوشش مطالب (بر حسب کلمات)</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#57534E] tabular-nums">
            <span>{modeSubtitle}</span>
            {summary.chapterCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{toPersianDigits(summary.chapterCount)} فصل</span>
                <span aria-hidden="true">·</span>
                <span>
                  پوشش کل کلمات:{' '}
                  <strong className="text-[#14532D]">
                    {toPersianDigits(summary.overallWordCoveragePercent)}٪
                  </strong>
                </span>
              </>
            )}
          </div>
        </div>

        {summary.chapters.length > 0 && (
          <div
            role="group"
            aria-label="حالت نمایش نمودار فصل‌ها"
            className="inline-flex items-center gap-1 rounded-lg bg-[#F4F1EA] p-1 shrink-0"
          >
            <button
              type="button"
              onClick={() => setViewMode('composed')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'composed'
                  ? 'bg-white text-[#1E3A5F] shadow-xs'
                  : 'text-[#57534E] hover:text-[#1A1816]'
              }`}
            >
              حجم کلمات و پوشش
            </button>
            <button
              type="button"
              onClick={() => setViewMode('horizontal_share')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'horizontal_share'
                  ? 'bg-white text-[#1E3A5F] shadow-xs'
                  : 'text-[#57534E] hover:text-[#1A1816]'
              }`}
            >
              سهم درصدی فصل‌ها
            </button>
          </div>
        )}
      </div>

      {/* Empty State */}
      {summary.chapters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FCFBF8] px-4 py-6 text-center space-y-1.5">
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF3F8] text-[#1E3A5F]">
            <Layers className="h-4 w-4" />
          </div>
          <p className="text-xs font-bold text-[#1A1816]">
            هنوز داده‌ای برای ترسیم نمودار توزیع فصل‌ها ثبت نشده است
          </p>
          <p className="text-[11px] text-[#57534E] max-w-md mx-auto leading-5">
            با بارگذاری و استخراج فایل‌ها در مرحله ۱، نمودار حجم کلمات هر فصل، سهم درصدی و میزان پوشش مطالب به‌صورت خودکار نمایش داده می‌شود.
          </p>
        </div>
      ) : (
        <>
          {/* Clean Unboxed KPI Strip (Tabular Numerals, Hairline Dividers) */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-y border-[#EFECE4] py-3 text-xs tabular-nums">
            <div className="space-y-0.5">
              <dt className="text-[11px] text-[#78716C]">کل کلمات ورودی</dt>
              <dd className="text-sm font-extrabold text-[#1A1816]">
                {toPersianDigits(summary.totalInputWords.toLocaleString('en-US'))}{' '}
                <span className="text-[10.5px] font-normal text-[#78716C]">کلمه</span>
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-[11px] text-[#78716C]">کلمات یکتای حفظ‌شده</dt>
              <dd className="text-sm font-extrabold text-[#1E3A5F]">
                {toPersianDigits(summary.preservedUniqueWords.toLocaleString('en-US'))}{' '}
                <span className="text-[10.5px] font-normal text-[#78716C]">کلمه</span>
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-[11px] text-[#78716C]">ادغام‌شده بدون افت</dt>
              <dd className="text-sm font-extrabold text-[#8C6226]">
                {toPersianDigits(summary.losslessMergedWords.toLocaleString('en-US'))}{' '}
                <span className="text-[10.5px] font-normal text-[#78716C]">کلمه</span>
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-[11px] text-[#78716C] inline-flex items-center gap-1">
                <BookOpenCheck className="h-3 w-3 text-[#14532D]" />
                <span>پوشش کلمات</span>
              </dt>
              <dd className="text-sm font-extrabold text-[#14532D]">
                {toPersianDigits(summary.overallWordCoveragePercent)}٪
                <span className="text-[10.5px] font-normal text-[#78716C] mr-1">
                  (میانگین {toPersianDigits(summary.averageWordsPerChapter)} کلمه/فصل)
                </span>
              </dd>
            </div>
          </dl>

          {/* Connected Harness CoverageLedger Strip (when Harness is active) */}
          {ledgerStats && ledgerStats.totalChunks > 0 && (
            <div
              data-testid="chapter-coverage-harness-ledger"
              className="rounded-lg border border-[#EAE5DA] bg-[#FCFBF8] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums"
            >
              <div className="font-bold text-[#1E3A5F]">
                دفتر کل پوشش هارنس (CoverageLedger):{' '}
                <span>{toPersianDigits(ledgerStats.verifiedPercent)}٪ تأیید دولایه</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[#44403C]">
                <span className="font-bold text-[#14532D]">
                  تأییدشده: {toPersianDigits(ledgerStats.verifiedChunks)} قطعه
                </span>
                <span className="font-semibold text-[#1E3A5F]">
                  پیش‌نویس: {toPersianDigits(ledgerStats.draftedChunks)}
                </span>
                <span className="text-[#78716C]">
                  در انتظار: {toPersianDigits(ledgerStats.pendingChunks)}
                </span>
                {ledgerStats.quarantinedChunks > 0 && (
                  <span className="font-bold text-[#9A3412]">
                    قرنطینه: {toPersianDigits(ledgerStats.quarantinedChunks)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Recharts Visualization */}
          <div className="w-full" dir="ltr">
            {viewMode === 'composed' ? (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={summary.chapters}
                    margin={{ top: 12, right: 16, left: 4, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#EFECE4" vertical={false} />
                    <XAxis
                      dataKey="shortLabel"
                      tick={{ fontSize: 11, fill: '#44403C' }}
                      tickLine={false}
                      axisLine={{ stroke: '#E2DDD3' }}
                      interval={0}
                      angle={summary.chapters.length > 6 ? -18 : 0}
                      textAnchor={summary.chapters.length > 6 ? 'end' : 'middle'}
                      height={summary.chapters.length > 6 ? 52 : 30}
                    />
                    <YAxis
                      yAxisId="words"
                      tick={{ fontSize: 11, fill: '#57534E' }}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                      tickFormatter={(v: number) => toPersianDigits(v)}
                    />
                    <YAxis
                      yAxisId="coverage"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#14532D' }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      tickFormatter={(v: number) => `${toPersianDigits(v)}٪`}
                    />
                    <Tooltip content={<ChapterChartTooltip />} />
                    <Bar
                      yAxisId="words"
                      dataKey="uniqueWords"
                      name="کلمات یکتای حفظ‌شده"
                      stackId="words"
                      fill="#1E3A5F"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                    <Bar
                      yAxisId="words"
                      dataKey="mergedWords"
                      name="ادغام‌شده بدون افت"
                      stackId="words"
                      fill="#B48A4E"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                    <Line
                      yAxisId="coverage"
                      type="monotone"
                      dataKey="coveragePercent"
                      name="پوشش کلمات (٪)"
                      stroke="#14532D"
                      strokeWidth={2.2}
                      dot={{ r: 3.5, fill: '#14532D', stroke: '#ffffff', strokeWidth: 1.5 }}
                      activeDot={{ r: 5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: `${horizontalHeight}px` }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={summary.chapters}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 16, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#EFECE4" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#57534E' }}
                      tickLine={false}
                      axisLine={{ stroke: '#E2DDD3' }}
                      tickFormatter={(v: number) => `${toPersianDigits(v)}٪`}
                    />
                    <YAxis
                      type="category"
                      dataKey="shortLabel"
                      width={130}
                      tick={{ fontSize: 11, fill: '#1A1816' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<ChapterChartTooltip />} />
                    <Bar
                      dataKey="sharePercent"
                      name="سهم درصدی از کل کلمات"
                      radius={[0, 4, 4, 0]}
                      barSize={20}
                    >
                      {summary.chapters.map((entry, index) => (
                        <Cell
                          key={entry.id}
                          fill={index % 2 === 0 ? '#1E3A5F' : '#3B6496'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Clean Unboxed Legend & Largest Chapter Note */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#1E3A5F]" aria-hidden="true" />
                <span>کلمات یکتای حفظ‌شده</span>
              </span>
              {viewMode === 'composed' && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-[#B48A4E]" aria-hidden="true" />
                    <span>ادغام‌شده بدون افت</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 bg-[#14532D]" aria-hidden="true" />
                    <span>درصد پوشش مطالب</span>
                  </span>
                </>
              )}
            </div>

            {summary.largestChapterTitle && (
              <span className="text-[11px] text-[#78716C] truncate max-w-[300px]">
                حجیم‌ترین فصل: <strong className="text-[#1A1816]">{summary.largestChapterTitle}</strong>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
};
