import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Cpu,
  FileStack,
  FolderKanban,
  Plus,
  Settings2,
} from 'lucide-react';
import type {
  AiModelId,
  ProjectBundleDto,
  ProjectSummaryDto,
  WorkflowMode,
} from '../lib/bookTypes';
import {
  AI_PROVIDER_METADATA,
  AiQuotaProbeResponse,
} from '../lib/aiProviderConfig';
import { formatCompactTokensFa } from '../lib/aiUsageMetrics';
import { BOOK_WORKFLOW_STAGES } from '../lib/bookWorkflow';
import {
  computePortfolioDashboardMetrics,
  PortfolioStatusBucket,
} from '../lib/dashboardMetrics';
import { toPersianDigits } from '../lib/formatParsers';
import { ChapterCoverageChartWidget } from './ChapterCoverageChartWidget';

interface ProjectsDashboardWidgetProps {
  projects: ProjectSummaryDto[];
  activeProjectId: string | null;
  activeBundle?: ProjectBundleDto | null;
  activeAiModel: AiModelId;
  probeData: AiQuotaProbeResponse | null;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (mode: WorkflowMode) => void;
  onOpenProviderSettings: () => void;
}

const BUCKET_META: Record<
  PortfolioStatusBucket,
  { label: string; color: string; textCls: string }
> = {
  completed: { label: 'تکمیل‌شده', color: '#14532D', textCls: 'text-[#14532D]' },
  inProgress: { label: 'در حال تدوین', color: '#1E3A5F', textCls: 'text-[#1E3A5F]' },
  draft: { label: 'پیش‌نویس', color: '#B48A4E', textCls: 'text-[#8C6226]' },
  error: { label: 'نیازمند بررسی', color: '#9A3412', textCls: 'text-[#9A3412]' },
};

const DONUT_RADIUS = 34;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export const ProjectsDashboardWidget: React.FC<ProjectsDashboardWidgetProps> = ({
  projects,
  activeProjectId,
  activeBundle = null,
  activeAiModel,
  probeData,
  onSelectProject,
  onCreateProject,
  onOpenProviderSettings,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const metrics = useMemo(
    () => computePortfolioDashboardMetrics(projects, activeAiModel),
    [projects, activeAiModel]
  );

  // Build SVG donut segments cleanly
  const donutSegments = useMemo(() => {
    const total = metrics.totalProjects;
    if (total === 0) return [];
    const order: PortfolioStatusBucket[] = ['completed', 'inProgress', 'draft', 'error'];
    let accumulatedRatio = 0;
    const segments: Array<{
      key: PortfolioStatusBucket;
      color: string;
      dashLength: number;
      dashOffset: number;
      count: number;
    }> = [];

    for (const key of order) {
      const count = metrics.statusCounts[key];
      if (count <= 0) continue;
      const ratio = count / total;
      const dashLength = ratio * DONUT_CIRCUMFERENCE;
      const dashOffset = -accumulatedRatio * DONUT_CIRCUMFERENCE;
      segments.push({
        key,
        color: BUCKET_META[key].color,
        dashLength,
        dashOffset,
        count,
      });
      accumulatedRatio += ratio;
    }
    return segments;
  }, [metrics.statusCounts, metrics.totalProjects]);

  const maxStageCount = useMemo(() => {
    const vals = Object.values(metrics.stageCounts);
    return Math.max(1, ...vals);
  }, [metrics.stageCounts]);

  const quotaBarColor =
    metrics.overallQuotaLevel === 'critical'
      ? '#9A3412'
      : metrics.overallQuotaLevel === 'warning'
        ? '#B45309'
        : '#14532D';

  const quotaTextCls =
    metrics.overallQuotaLevel === 'critical'
      ? 'text-[#9A3412]'
      : metrics.overallQuotaLevel === 'warning'
        ? 'text-[#92400E]'
        : 'text-[#14532D]';

  const liveProbe = probeData?.activeProbe ?? null;

  return (
    <section
      aria-label="داشبورد خلاصه پروژه‌ها و سهمیه هوش مصنوعی"
      className="rounded-xl border border-[#E2DDD3] bg-white overflow-hidden"
    >
      {/* Top Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFECE4] bg-[#FCFBF8] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EEF3F8] text-[#1E3A5F]">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-[#1A1816] truncate">
              داشبورد کلی پروژه‌ها و مصرف سهمیه هوش مصنوعی
            </h3>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#57534E] tabular-nums">
              <span>{toPersianDigits(metrics.totalProjects)} پروژه</span>
              <span aria-hidden="true">·</span>
              <span>{toPersianDigits(metrics.totalProcessedFiles)} فایل پردازش‌شده</span>
              <span aria-hidden="true">·</span>
              <span>
                {formatCompactTokensFa(metrics.totalTokensConsumed)} توکن مصرفی (
                {toPersianDigits(metrics.overallRemainingPercent)}٪ باقی‌مانده)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onCreateProject('multi_merge')}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-3 py-1 text-xs font-bold text-[#1E3A5F] hover:bg-[#F5F3EE] cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>پروژه جدید</span>
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-transparent px-2.5 py-1 text-xs font-semibold text-[#57534E] hover:bg-[#EFECE4] hover:text-[#1A1816] cursor-pointer whitespace-nowrap"
          >
            <span>{collapsed ? 'نمایش نمودارها' : 'جمع کردن'}</span>
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="divide-y divide-[#EFECE4]">
          {/* 3-Column Graphical Telemetry Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-[#EFECE4]">
            {/* Panel 1: All Projects Status Donut Chart */}
            <div className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#1A1816] inline-flex items-center gap-1.5">
                  <FolderKanban className="h-3.5 w-3.5 text-[#1E3A5F]" />
                  وضعیت تمام پروژه‌ها
                </span>
                <span className="text-[11px] text-[#78716C] tabular-nums">
                  کل: {toPersianDigits(metrics.totalProjects)}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="relative h-24 w-24 shrink-0">
                  <svg
                    viewBox="0 0 88 88"
                    className="h-24 w-24 -rotate-90"
                    role="img"
                    aria-label={`نمودار دایره‌ای وضعیت ${toPersianDigits(metrics.totalProjects)} پروژه`}
                  >
                    <circle
                      cx="44"
                      cy="44"
                      r={DONUT_RADIUS}
                      fill="none"
                      stroke="#EFECE4"
                      strokeWidth="10"
                    />
                    {donutSegments.map((seg) => (
                      <circle
                        key={seg.key}
                        cx="44"
                        cy="44"
                        r={DONUT_RADIUS}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="10"
                        strokeDasharray={`${seg.dashLength} ${DONUT_CIRCUMFERENCE}`}
                        strokeDashoffset={seg.dashOffset}
                        strokeLinecap="butt"
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-lg font-extrabold tabular-nums text-[#1A1816] leading-none">
                      {toPersianDigits(metrics.totalProjects)}
                    </span>
                    <span className="text-[10px] text-[#78716C] mt-0.5">پروژه</span>
                  </div>
                </div>

                <dl className="flex-1 space-y-1.5 text-xs">
                  {(['completed', 'inProgress', 'draft', 'error'] as PortfolioStatusBucket[]).map(
                    (key) => {
                      const count = metrics.statusCounts[key];
                      const pct =
                        metrics.totalProjects > 0
                          ? Math.round((count / metrics.totalProjects) * 100)
                          : 0;
                      return (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <dt className="flex items-center gap-2 text-[#44403C]">
                            <span
                              className="h-2.5 w-2.5 rounded-xs shrink-0"
                              style={{ backgroundColor: BUCKET_META[key].color }}
                              aria-hidden="true"
                            />
                            <span>{BUCKET_META[key].label}</span>
                          </dt>
                          <dd className="font-bold tabular-nums text-[#1A1816]">
                            {toPersianDigits(count)}
                            <span className="text-[10.5px] font-normal text-[#78716C] mr-1">
                              ({toPersianDigits(pct)}٪)
                            </span>
                          </dd>
                        </div>
                      );
                    }
                  )}
                </dl>
              </div>
            </div>

            {/* Panel 2: Total Processed Files & 5-Stage Bar Distribution */}
            <div className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#1A1816] inline-flex items-center gap-1.5">
                  <FileStack className="h-3.5 w-3.5 text-[#1E3A5F]" />
                  فایل‌های پردازش‌شده و مراحل
                </span>
                <span className="text-[11px] text-[#78716C] tabular-nums">
                  {toPersianDigits(metrics.totalProcessedWords.toLocaleString('en-US'))} کلمه
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-2xl font-extrabold tabular-nums text-[#1E3A5F]">
                    {toPersianDigits(metrics.totalProcessedFiles)}
                  </span>
                  <span className="text-xs text-[#57534E] mr-1.5">فایل ثبت و پردازش‌شده</span>
                </div>
                <span className="text-[11px] text-[#78716C] tabular-nums">
                  {toPersianDigits(metrics.totalAiRequests)} درخواست هوش مصنوعی
                </span>
              </div>

              {/* 5-Stage Mini Bar Chart */}
              <div
                className="grid grid-cols-5 gap-2 items-end pt-1"
                role="img"
                aria-label="نمودار میله‌ای پراکندگی پروژه‌ها در ۵ مرحله تدوین"
              >
                {BOOK_WORKFLOW_STAGES.map((st) => {
                  const count = metrics.stageCounts[st.stage];
                  const heightPct =
                    count === 0 ? 10 : Math.max(24, Math.round((count / maxStageCount) * 100));
                  return (
                    <div key={st.stage} className="flex flex-col items-center gap-1">
                      <span className="text-[10.5px] font-bold tabular-nums text-[#1E3A5F]">
                        {toPersianDigits(count)}
                      </span>
                      <div className="w-full h-12 rounded-md bg-[#F4F1EA] flex items-end overflow-hidden p-0.5">
                        <div
                          className="w-full rounded-xs transition-all"
                          style={{
                            height: `${heightPct}%`,
                            backgroundColor:
                              count === 0
                                ? '#E2DDD3'
                                : st.stage === 5
                                  ? '#14532D'
                                  : '#1E3A5F',
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-[#57534E] truncate max-w-full">
                        {st.shortTitleFa.replace(/^[۱۲۳۴۵]\.\s*/, '')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Panel 3: Overall AI Quota Gauge & Token Breakdown */}
            <div className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#1A1816] inline-flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-[#1E3A5F]" />
                  مصرف سهمیه کلی هوش مصنوعی
                </span>
                <button
                  type="button"
                  onClick={onOpenProviderSettings}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                >
                  <Settings2 className="h-3 w-3" />
                  <span>تنظیمات کلید</span>
                </button>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-2xl font-extrabold tabular-nums text-[#1A1816]">
                    {toPersianDigits(metrics.overallConsumedPercent)}٪
                  </span>
                  <span className={`text-[11px] font-bold mr-1.5 ${quotaTextCls}`}>
                    {metrics.overallQuotaLabel}
                  </span>
                </div>
                <span className="text-[11px] text-[#57534E] tabular-nums">
                  {formatCompactTokensFa(metrics.totalTokensConsumed)} /{' '}
                  {formatCompactTokensFa(metrics.overallBudgetTokens)}
                </span>
              </div>

              {/* Overall Quota Graphical Bar */}
              <div className="space-y-1.5">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EFECE4]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(metrics.totalTokensConsumed > 0 ? 3 : 0, metrics.overallConsumedPercent)}%`,
                      backgroundColor: quotaBarColor,
                    }}
                  />
                </div>

                {/* Multi-segment Token Composition Bar */}
                {metrics.totalTokensConsumed > 0 ? (
                  <div className="space-y-1">
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#F4F1EA]">
                      <div
                        style={{ width: `${metrics.tokenShareBreakdown.promptPercent}%` }}
                        className="bg-[#1E3A5F]"
                        title="توکن ورودی (متن‌ها)"
                      />
                      <div
                        style={{ width: `${metrics.tokenShareBreakdown.outputPercent}%` }}
                        className="bg-[#14532D]"
                        title="توکن خروجی (پاسخ‌ها)"
                      />
                      <div
                        style={{ width: `${metrics.tokenShareBreakdown.thinkingPercent}%` }}
                        className="bg-[#6B33B8]"
                        title="توکن استدلال عمیق"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10.5px] text-[#57534E] tabular-nums">
                      <span>ورودی {toPersianDigits(metrics.tokenShareBreakdown.promptPercent)}٪</span>
                      <span>خروجی {toPersianDigits(metrics.tokenShareBreakdown.outputPercent)}٪</span>
                      <span>استدلال {toPersianDigits(metrics.tokenShareBreakdown.thinkingPercent)}٪</span>
                      <span>≈ {toPersianDigits(metrics.consumedPagesEquivalent)} صفحه</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[11px] text-[#78716C] tabular-nums">
                    <span>هنوز توکنی در پروژه‌ها مصرف نشده است</span>
                    <span>
                      باقی‌مانده: {formatCompactTokensFa(metrics.overallRemainingTokens)}
                    </span>
                  </div>
                )}

                {liveProbe && (
                  <div className="pt-0.5 text-[10.5px] text-[#57534E] truncate">
                    ارائه‌دهنده فعال:{' '}
                    <strong className="text-[#1A1816]">
                      {AI_PROVIDER_METADATA[liveProbe.provider]?.shortName || liveProbe.provider}
                    </strong>{' '}
                    · {liveProbe.statusLabelFa}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active Project Recharts Chapter Volume & Word Coverage Analytics */}
          <ChapterCoverageChartWidget bundle={activeBundle} />

          {/* Compact Recent/Active Projects Quick Jump Strip */}
          {metrics.topProjects.length > 0 && (
            <div className="bg-[#FAF9F6] px-4 py-2.5 sm:px-5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[#57534E] shrink-0">
                دسترسی سریع به پروژه‌ها:
              </span>
              <div className="flex flex-wrap items-center gap-1.5 flex-1 justify-start">
                {metrics.topProjects.map((row) => {
                  const isCurrent = row.id === activeProjectId;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onSelectProject(row.id)}
                      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] transition-colors cursor-pointer max-w-[240px] ${
                        isCurrent
                          ? 'border-[#1E3A5F] bg-[#EEF3F8] font-bold text-[#1E3A5F]'
                          : 'border-[#E2DDD3] bg-white text-[#44403C] hover:border-[#1E3A5F]/50 hover:text-[#1E3A5F]'
                      }`}
                    >
                      <span className="truncate">{row.title}</span>
                      <span className="text-[10px] text-[#78716C] tabular-nums shrink-0">
                        {toPersianDigits(row.fileCount)} فایل · م{toPersianDigits(row.stage)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
