import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Activity,
  AlertCircle,
  BookCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  ExternalLink,
  Layers,
  PieChart as PieChartIcon,
  RefreshCw,
  Server,
  ShieldAlert,
} from 'lucide-react';
import type {
  AuditReportDto,
  ConflictDto,
  DeepReviewReportDto,
  OutlineNodeDto,
  ParsedBook,
  ValidationDomain,
} from '../lib/bookTypes';
import type { HarnessState } from '../lib/harness/types';
import type { WinolsExtractionReport } from '../lib/winolsMapGuide';
import {
  buildStage5ComparativePieChartData,
  computeStage5QualityMetrics,
  Stage5ComparativePieItem,
  Stage5QualityMetrics,
} from '../lib/stage5QualityMetrics';
import { toPersianDigits } from '../lib/formatParsers';

interface Stage5QualityDashboardProps {
  book: ParsedBook;
  projectId?: string | null;
  outlineNodes?: OutlineNodeDto[];
  auditReport?: AuditReportDto | null;
  conflicts?: ConflictDto[];
  winolsGuideReport?: WinolsExtractionReport | null;
  harnessState?: HarnessState | null;
  deepReviewReport?: DeepReviewReportDto | null;
  validationDomain?: ValidationDomain;
  onFetchServerMetrics?: (projectId: string) => Promise<{
    metrics: Stage5QualityMetrics;
    chartData?: Stage5ComparativePieItem[];
    serverGeneratedAt?: string;
  }>;
  onGoToStage2Audit?: () => void;
  onGoToStage3Outline?: () => void;
  onGoToStage4Winols?: () => void;
}

interface PieDatum {
  name: string;
  value: number;
  color: string;
}

interface CustomPieTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: PieDatum }>;
}

const QualityPieTooltip: React.FC<CustomPieTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div
      dir="rtl"
      className="rounded-lg border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-right text-[11px] shadow-md whitespace-nowrap z-50"
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-xs shrink-0"
          style={{ backgroundColor: item.color }}
          aria-hidden="true"
        />
        <span className="font-semibold text-[#1A1816]">{item.name}:</span>
        <span className="font-extrabold tabular-nums text-[#1E3A5F]">
          {toPersianDigits(item.value)}٪
        </span>
      </div>
    </div>
  );
};

interface ComparativeTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Stage5ComparativePieItem }>;
}

const ComparativePieTooltip: React.FC<ComparativeTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div
      dir="rtl"
      className="max-w-xs rounded-xl border border-[#D6D0C4] bg-white p-3 text-right text-xs shadow-lg space-y-1.5 z-50"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#EFECE4] pb-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span className="font-extrabold text-[#1A1816]">{item.name}</span>
        </div>
        <span className="font-extrabold tabular-nums text-[#1E3A5F]">
          {toPersianDigits(item.value)}
          {item.unit}
        </span>
      </div>
      <p className="text-[11px] text-[#57534E] leading-5">{item.description}</p>
      <div className="text-[10.5px] font-bold text-[#14532D]">
        وضعیت: {item.statusLabelFa}
      </div>
    </div>
  );
};

interface DonutMetricColumnProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  centerValueText: string;
  centerLabelText: string;
  centerValueColorClass: string;
  data: PieDatum[];
  statusLabelFa: string;
  statusToneClass: string;
  details: Array<{ label: string; value: string }>;
  actionLabel?: string;
  onAction?: () => void;
}

const DonutMetricColumn: React.FC<DonutMetricColumnProps> = ({
  title,
  subtitle,
  icon,
  centerValueText,
  centerLabelText,
  centerValueColorClass,
  data,
  statusLabelFa,
  statusToneClass,
  details,
  actionLabel,
  onAction,
}) => {
  const safeData = useMemo(() => {
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total <= 0) {
      return [{ name: 'بدون داده', value: 100, color: '#EFECE4' }];
    }
    return data.filter((d) => d.value > 0);
  }, [data]);

  return (
    <div className="p-4 flex flex-col justify-between gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1A1816]">
            {icon}
            <span className="truncate">{title}</span>
          </div>
          <p className="text-[11px] text-[#78716C]">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div
          className="relative flex h-[116px] w-[116px] shrink-0 items-center justify-center"
          dir="ltr"
        >
          <PieChart width={116} height={116}>
            <Pie
              data={safeData}
              dataKey="value"
              nameKey="name"
              cx={58}
              cy={58}
              innerRadius={37}
              outerRadius={52}
              startAngle={90}
              endAngle={-270}
              paddingAngle={safeData.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {safeData.map((entry, idx) => (
                <Cell key={`${entry.name}_${idx}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<QualityPieTooltip />} />
          </PieChart>
          <div
            dir="rtl"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
          >
            <span
              className={`text-base font-extrabold leading-none tabular-nums ${centerValueColorClass}`}
            >
              {centerValueText}
            </span>
            <span className="mt-1 text-[10px] font-medium text-[#78716C]">
              {centerLabelText}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className={`text-[11.5px] font-bold leading-5 ${statusToneClass}`}>
            {statusLabelFa}
          </div>
          <dl className="space-y-1 border-t border-[#F0EDE6] pt-1.5 text-[11px] tabular-nums">
            {details.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-2 text-[#57534E]"
              >
                <dt className="truncate">{row.label}</dt>
                <dd className="font-bold text-[#1A1816] shrink-0">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {actionLabel && onAction && (
        <div className="border-t border-[#F0EDE6] pt-2">
          <button
            type="button"
            onClick={onAction}
            className="text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
};

export const Stage5QualityDashboard: React.FC<Stage5QualityDashboardProps> = ({
  book,
  projectId = null,
  outlineNodes = [],
  auditReport = null,
  conflicts = [],
  winolsGuideReport = null,
  harnessState = null,
  deepReviewReport = null,
  validationDomain = 'ecu_winols',
  onFetchServerMetrics,
  onGoToStage2Audit,
  onGoToStage3Outline,
  onGoToStage4Winols,
}) => {
  const localMetrics = useMemo(
    () =>
      computeStage5QualityMetrics({
        book,
        outlineNodes,
        auditReport,
        conflicts,
        winolsGuideReport,
        harnessState,
        deepReviewReport,
        validationDomain,
      }),
    [
      book,
      outlineNodes,
      auditReport,
      conflicts,
      winolsGuideReport,
      harnessState,
      deepReviewReport,
      validationDomain,
    ]
  );

  const [serverMetrics, setServerMetrics] = useState<Stage5QualityMetrics | null>(null);
  const [serverSyncTime, setServerSyncTime] = useState<string | null>(null);
  const [fetchingServer, setFetchingServer] = useState(false);
  const [chartViewMode, setChartViewMode] = useState<'comparative_pie' | 'donuts'>('comparative_pie');
  const [rulesGuideOpen, setRulesGuideOpen] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);

  const activeMetrics = serverMetrics || localMetrics;

  const handleRefreshServerMetrics = useCallback(async () => {
    if (!projectId || !onFetchServerMetrics) return;
    setFetchingServer(true);
    try {
      const res = await onFetchServerMetrics(projectId);
      if (res?.metrics) {
        setServerMetrics(res.metrics);
        setServerSyncTime(res.serverGeneratedAt || new Date().toISOString());
      }
    } catch (err) {
      console.warn('Could not refresh server quality metrics:', err);
    } finally {
      setFetchingServer(false);
    }
  }, [projectId, onFetchServerMetrics]);

  useEffect(() => {
    if (projectId && onFetchServerMetrics && !serverMetrics) {
      void handleRefreshServerMetrics();
    }
  }, [projectId, onFetchServerMetrics, serverMetrics, handleRefreshServerMetrics]);

  // Comparative 3-metric Pie Chart Data (Server Data: Text Error Rate, Heading Cohesion, WinOLS Compliance)
  const comparativePieData = useMemo(
    () => buildStage5ComparativePieChartData(activeMetrics),
    [activeMetrics]
  );

  // Individual chart data slices for Donut view
  const errorColor =
    activeMetrics.textErrorRatePercent <= 2
      ? '#16A34A'
      : activeMetrics.textErrorRatePercent <= 10
        ? '#D97706'
        : '#DC2626';

  const errorPieData: PieDatum[] = [
    {
      name: 'نرخ خطای متنی / موارد باز',
      value: activeMetrics.textErrorRatePercent,
      color: errorColor,
    },
    {
      name: 'متن سالم و تأییدشده',
      value: activeMetrics.cleanTextPercent,
      color: activeMetrics.textErrorRatePercent === 0 ? '#14532D' : '#E2EFE6',
    },
  ];

  const cohesionColor =
    activeMetrics.headingCohesionPercent >= 85
      ? '#1E3A5F'
      : activeMetrics.headingCohesionPercent >= 65
        ? '#D97706'
        : '#DC2626';

  const cohesionPieData: PieDatum[] = [
    {
      name: 'انسجام سرفصل‌ها',
      value: activeMetrics.headingCohesionPercent,
      color: cohesionColor,
    },
    {
      name: 'شکاف ساختاری سرفصل',
      value: activeMetrics.headingGapPercent,
      color: '#EFECE4',
    },
  ];

  const winolsColor =
    activeMetrics.winolsMode === 'general_domain_not_applicable'
      ? '#64748B'
      : activeMetrics.winolsCompliancePercent >= 85
        ? '#14532D'
        : activeMetrics.winolsCompliancePercent >= 60
          ? '#D97706'
          : '#DC2626';

  const winolsPieData: PieDatum[] =
    activeMetrics.winolsMode === 'general_domain_not_applicable'
      ? [
          {
            name: 'دامنه عمومی فارسی (معاف از WinOLS)',
            value: 100,
            color: '#64748B',
          },
        ]
      : [
          {
            name: 'تطبیق با استاندارد WinOLS',
            value: activeMetrics.winolsCompliancePercent,
            color: winolsColor,
          },
          {
            name: 'نیازمند تکمیل مشخصات WinOLS',
            value: activeMetrics.winolsGapPercent,
            color: '#EFECE4',
          },
        ];

  const handleCopyRules = async () => {
    const rulesSnippet = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isValidId(id) {
      return id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$');
    }

    match /users/{userId} {
      allow get: if isValidId(userId) && isOwner(userId);
      allow list: if false;
      allow create, update: if isValidId(userId) && isOwner(userId);
      allow delete: if false;

      match /projectStates/{projectId} {
        allow get, list: if isValidId(userId) && isValidId(projectId) && isOwner(userId);
        allow create, update, delete: if isValidId(userId) && isValidId(projectId) && isOwner(userId);

        match /chatMessages/{messageId} {
          allow get, list: if isValidId(userId) && isValidId(projectId) && isValidId(messageId) && isOwner(userId);
          allow create, update, delete: if isValidId(userId) && isValidId(projectId) && isValidId(messageId) && isOwner(userId);
        }
      }
    }
  }
}`;
    try {
      await navigator.clipboard.writeText(rulesSnippet);
      setCopiedRules(true);
      setTimeout(() => setCopiedRules(false), 3000);
    } catch {
      // fallback
    }
  };

  return (
    <section
      data-testid="stage5-quality-dashboard"
      aria-label="داشبورد ممیزی کیفیت نهایی کتاب"
      className="rounded-xl border border-[#E2DDD3] bg-white overflow-hidden space-y-0"
    >
      {/* Compact Header Strip with Server-Sync Indicator and View Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFECE4] bg-[#FAF9F6] px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#1E3A5F] shrink-0" />
          <h3 className="text-xs sm:text-sm font-extrabold text-[#1A1816]">
            داشبورد ممیزی کیفیت نهایی و استاندارد WinOLS
          </h3>
          {serverMetrics ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5E9] px-2 py-0.5 text-[10px] font-bold text-[#14532D]">
              <Server className="h-3 w-3" />
              داده‌های ارسالی سرور
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF3F8] px-2 py-0.5 text-[10px] font-bold text-[#1E3A5F]">
              ارزیابی محلی کلاینت
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {projectId && onFetchServerMetrics && (
            <button
              type="button"
              disabled={fetchingServer}
              onClick={() => void handleRefreshServerMetrics()}
              title="بروزرسانی ممیزی کیفیت از سمت سرور"
              className="inline-flex items-center gap-1 rounded-lg border border-[#D6D0C4] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${fetchingServer ? 'animate-spin' : ''}`} />
              <span>{fetchingServer ? 'در حال استعلام سرور...' : 'بروزرسانی سرور'}</span>
            </button>
          )}

          <div className="inline-flex rounded-lg border border-[#D6D0C4] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setChartViewMode('comparative_pie')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                chartViewMode === 'comparative_pie'
                  ? 'bg-[#1E3A5F] text-white shadow-2xs'
                  : 'text-[#57534E] hover:text-[#1A1816]'
              }`}
            >
              <PieChartIcon className="h-3 w-3" />
              <span>نمودار دایره‌ای Recharts</span>
            </button>
            <button
              type="button"
              onClick={() => setChartViewMode('donuts')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                chartViewMode === 'donuts'
                  ? 'bg-[#1E3A5F] text-white shadow-2xs'
                  : 'text-[#57534E] hover:text-[#1A1816]'
              }`}
            >
              <Layers className="h-3 w-3" />
              <span>شاخص‌های تفکیکی دونات</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main View Mode: Recharts Pie Chart (Comparative 3-Metric Distribution) */}
      {chartViewMode === 'comparative_pie' ? (
        <div className="p-4 sm:p-6 space-y-5">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            {/* Left: Recharts Pie Chart Canvas */}
            <div className="w-full lg:w-1/2 flex flex-col items-center justify-center space-y-2">
              <div className="w-full max-w-[280px] h-[220px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={comparativePieData}
                      dataKey="value"
                      nameKey="shortLabel"
                      cx="50%"
                      cy="50%"
                      outerRadius={85}
                      innerRadius={48}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={3}
                      stroke="#ffffff"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {comparativePieData.map((entry) => (
                        <Cell key={entry.id} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ComparativePieTooltip />} />
                    <Legend
                      wrapperStyle={{
                        fontSize: '11px',
                        paddingTop: '8px',
                        direction: 'rtl',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center text-[11px] text-[#78716C] tabular-nums">
                {serverSyncTime ? (
                  <>
                    محاسبه‌شده بر پایه داده‌های سرور در تاریخ{' '}
                    <span dir="ltr" className="font-mono">
                      {new Date(serverSyncTime).toLocaleTimeString('fa-IR')}
                    </span>
                  </>
                ) : (
                  'ارزیابی و ترسیم زنده داده‌های ممیزی'
                )}
              </div>
            </div>

            {/* Right: 3 Metric Detail Cards with direct actions */}
            <div className="w-full lg:w-1/2 space-y-2.5">
              {comparativePieData.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-[#EBE7DF] bg-[#FAF9F6] p-3.5 space-y-1.5 transition-colors hover:bg-white hover:border-[#D6D0C4]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-extrabold text-[#1A1816]">
                        {item.name}
                      </span>
                    </div>
                    <span
                      className="text-sm font-extrabold tabular-nums"
                      style={{ color: item.color }}
                    >
                      {toPersianDigits(item.value)}
                      {item.unit}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#57534E] leading-5">
                    {item.description}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-[#EFECE4] text-[10.5px]">
                    <span className="font-bold text-[#44403C]">
                      {item.statusLabelFa}
                    </span>
                    {item.id === 'text_errors' && activeMetrics.openConflictsCount > 0 && onGoToStage2Audit && (
                      <button
                        type="button"
                        onClick={onGoToStage2Audit}
                        className="font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                      >
                        رفع تناقض‌ها در مرحله ۲ ←
                      </button>
                    )}
                    {item.id === 'heading_cohesion' && activeMetrics.headingCohesionPercent < 85 && onGoToStage3Outline && (
                      <button
                        type="button"
                        onClick={onGoToStage3Outline}
                        className="font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                      >
                        اصلاح سرفصل‌ها در مرحله ۳ ←
                      </button>
                    )}
                    {item.id === 'winols_compliance' && activeMetrics.mapsDetected > 0 && onGoToStage4Winols && (
                      <button
                        type="button"
                        onClick={onGoToStage4Winols}
                        className="font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                      >
                        مشاهده میز کار WinOLS در مرحله ۴ ←
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Secondary View Mode: 3-Column Donut Gauges with deep drill-down */
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-[#EFECE4]">
          <DonutMetricColumn
            title="نرخ خطاهای متنی"
            subtitle="تناقض‌های باز، قرنطینه و افت پوشش"
            icon={<AlertCircle className="h-3.5 w-3.5 text-[#9A2E1A] shrink-0" />}
            centerValueText={`${toPersianDigits(activeMetrics.textErrorRatePercent)}٪`}
            centerLabelText="نرخ خطا"
            centerValueColorClass={
              activeMetrics.textErrorRatePercent <= 2
                ? 'text-[#14532D]'
                : activeMetrics.textErrorRatePercent <= 10
                  ? 'text-[#B45309]'
                  : 'text-[#9A2E1A]'
            }
            data={errorPieData}
            statusLabelFa={activeMetrics.textErrorStatusLabelFa}
            statusToneClass={
              activeMetrics.textErrorRatePercent <= 2
                ? 'text-[#14532D]'
                : activeMetrics.textErrorRatePercent <= 10
                  ? 'text-[#B45309]'
                  : 'text-[#9A2E1A]'
            }
            details={[
              {
                label: 'سلامت متنی:',
                value: `${toPersianDigits(activeMetrics.cleanTextPercent)}٪`,
              },
              {
                label: 'تناقض باز / قرنطینه:',
                value: `${toPersianDigits(activeMetrics.openConflictsCount)} / ${toPersianDigits(activeMetrics.unresolvedQuarantineCount)}`,
              },
              {
                label: 'بخش خالی یا نقص:',
                value: toPersianDigits(
                  activeMetrics.emptySectionsCount + activeMetrics.gapFlagCount
                ),
              },
            ]}
            actionLabel={
              activeMetrics.openConflictsCount > 0 && onGoToStage2Audit
                ? 'رفع تناقض‌ها در مرحله ۲ ←'
                : activeMetrics.unresolvedQuarantineCount > 0 && onGoToStage3Outline
                  ? 'بررسی بخش‌های قرنطینه در مرحله ۳ ←'
                  : undefined
            }
            onAction={
              activeMetrics.openConflictsCount > 0
                ? onGoToStage2Audit
                : onGoToStage3Outline
            }
          />

          <DonutMetricColumn
            title="انسجام سرفصل‌ها"
            subtitle="تطابق ساختار فهرست و فصل‌بندی نهایی"
            icon={<BookCheck className="h-3.5 w-3.5 text-[#1E3A5F] shrink-0" />}
            centerValueText={`${toPersianDigits(activeMetrics.headingCohesionPercent)}٪`}
            centerLabelText="انسجام"
            centerValueColorClass={
              activeMetrics.headingCohesionPercent >= 85
                ? 'text-[#1E3A5F]'
                : activeMetrics.headingCohesionPercent >= 65
                  ? 'text-[#B45309]'
                  : 'text-[#9A2E1A]'
            }
            data={cohesionPieData}
            statusLabelFa={activeMetrics.headingCohesionStatusLabelFa}
            statusToneClass={
              activeMetrics.headingCohesionPercent >= 85
                ? 'text-[#1E3A5F]'
                : activeMetrics.headingCohesionPercent >= 65
                  ? 'text-[#B45309]'
                  : 'text-[#9A2E1A]'
            }
            details={[
              {
                label: 'فصل‌ها و زیربخش‌ها:',
                value: `${toPersianDigits(activeMetrics.totalChapters)} فصل · ${toPersianDigits(activeMetrics.totalSections)} بخش`,
              },
              {
                label: 'انطباق با فهرست مصوب:',
                value:
                  activeMetrics.outlineNodesCount > 0
                    ? `${toPersianDigits(activeMetrics.matchedChaptersCount)} از ${toPersianDigits(activeMetrics.outlineNodesCount)}`
                    : 'ساختار مستقیم',
              },
              {
                label: 'قطعات خارج از سرفصل:',
                value: toPersianDigits(activeMetrics.unassignedChunksCount),
              },
            ]}
            actionLabel={
              activeMetrics.headingCohesionPercent < 85 && onGoToStage3Outline
                ? 'بازبینی سرفصل‌ها در مرحله ۳ ←'
                : undefined
            }
            onAction={onGoToStage3Outline}
          />

          <DonutMetricColumn
            title="تطبیق با استانداردهای WinOLS"
            subtitle="آدرس هگز، ماتریس RPM×بار و DAMOS"
            icon={<Cpu className="h-3.5 w-3.5 text-[#14532D] shrink-0" />}
            centerValueText={
              activeMetrics.winolsMode === 'general_domain_not_applicable'
                ? 'عمومی'
                : `${toPersianDigits(activeMetrics.winolsCompliancePercent)}٪`
            }
            centerLabelText={
              activeMetrics.winolsMode === 'general_domain_not_applicable'
                ? 'معاف'
                : 'تطبیق'
            }
            centerValueColorClass={
              activeMetrics.winolsMode === 'general_domain_not_applicable'
                ? 'text-[#475569]'
                : activeMetrics.winolsCompliancePercent >= 85
                  ? 'text-[#14532D]'
                  : activeMetrics.winolsCompliancePercent >= 60
                    ? 'text-[#B45309]'
                    : 'text-[#9A2E1A]'
            }
            data={winolsPieData}
            statusLabelFa={activeMetrics.winolsStatusLabelFa}
            statusToneClass={
              activeMetrics.winolsMode === 'general_domain_not_applicable'
                ? 'text-[#475569]'
                : activeMetrics.winolsCompliancePercent >= 85
                  ? 'text-[#14532D]'
                  : activeMetrics.winolsCompliancePercent >= 60
                    ? 'text-[#B45309]'
                    : 'text-[#9A2E1A]'
            }
            details={[
              {
                label: 'نقشه‌های شناسایی‌شده:',
                value: `${toPersianDigits(activeMetrics.mapsDetected)} نقشه`,
              },
              {
                label: 'دارای آدرس هگز / محور:',
                value: `${toPersianDigits(activeMetrics.mapsWithHexCount)} / ${toPersianDigits(activeMetrics.mapsWithZoneMatrixCount)}`,
              },
              {
                label: 'ضریب DAMOS / خطای ECU:',
                value: `${toPersianDigits(activeMetrics.mapsWithDamosMetaCount)} / ${toPersianDigits(activeMetrics.ecuIssueCount)}`,
              },
            ]}
            actionLabel={
              activeMetrics.mapsDetected > 0 && onGoToStage4Winols
                ? 'مشاهده میز کار WinOLS در مرحله ۴ ←'
                : undefined
            }
            onAction={onGoToStage4Winols}
          />
        </div>
      )}

      {/* Collapsible Step-by-Step Firestore Rules Deployment Guide */}
      <div className="border-t border-[#EFECE4] bg-[#FAF9F6]">
        <button
          type="button"
          onClick={() => setRulesGuideOpen((v) => !v)}
          className="w-full flex items-center justify-between p-3.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#F3F0E8] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#854D0E]" />
            <span>راهنمای گام‌به‌گام رفع «محدودیت دسترسی» و انتشار قوانین Firestore</span>
          </div>
          {rulesGuideOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {rulesGuideOpen && (
          <div className="p-4 sm:p-5 border-t border-[#EAE6DE] bg-white text-xs text-[#44403C] space-y-4 leading-6">
            <div className="rounded-lg bg-[#FEF3F2] border border-[#F5C6CB] p-3 text-[#9A2E1A]">
              <strong>چرا حساب فعلی محدودیت داشت؟</strong> هنگام ایمپورت یک پروژه از گیت‌هاب، شناسه پروژه فایربیس سازنده قبلی در تنظیمات باقی می‌ماند و توکن‌های خودکار سیستم به دلیل نداشتن دسترسی IAM Owner روی پروژه قبلی، با خطای <code>The caller does not have permission</code> مواجه می‌شوند. انتشار قوانین از طریق کنسول رسمی فایربیس با اکانت مالک، دائمی‌ترین و امن‌ترین راهکار است.
            </div>

            <ol className="space-y-2 list-decimal list-inside pr-1">
              <li>
                با حساب مالک (مثلاً <span dir="ltr" className="font-mono font-bold">hossein.armanpoor@gmail.com</span>) وارد کنسول فایربیس به آدرس{' '}
                <a
                  href="https://console.firebase.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-[#1E3A5F] underline inline-flex items-center gap-0.5"
                >
                  console.firebase.google.com <ExternalLink className="h-3 w-3" />
                </a>{' '}
                شوید.
              </li>
              <li>
                پروژه خود را باز کنید (مثلاً <span className="font-mono font-bold">my-course-transcriber</span>).
              </li>
              <li>
                از منوی کناری سمت چپ، زیر بخش <strong>Build (ساخت)</strong> روی <strong>Firestore Database</strong> کلیک کنید.
              </li>
              <li>
                در بالای صفحه دیتابیس، روی تب <strong>Rules (قوانین)</strong> کلیک نمایید.
              </li>
              <li>
                تمام متن موجود در ویرایشگر کنسول را پاک کنید و کد قوانین امنیتی زیر را در آن قرار دهید:
              </li>
            </ol>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] font-bold text-[#57534E]">
                متن استاندارد امنیتی firestore.rules پروژه:
              </span>
              <button
                type="button"
                onClick={() => void handleCopyRules()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFEAF5] cursor-pointer"
              >
                {copiedRules ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#14532D]" />
                    <span className="text-[#14532D]">کپی شد!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>کپی کردن کد قوانین</span>
                  </>
                )}
              </button>
            </div>

            <pre className="max-h-40 overflow-y-auto rounded-lg border border-[#D6D0C4] bg-[#22272E] p-3 text-[11px] font-mono text-[#ADBAC7]" dir="ltr">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
    match /users/{userId} {
      allow get, list, create, update, delete: if request.auth != null && request.auth.uid == userId;
      match /projectStates/{projectId} {
        allow get, list, create, update, delete: if request.auth != null && request.auth.uid == userId;
        match /chatMessages/{messageId} {
          allow get, list, create, update, delete: if request.auth != null && request.auth.uid == userId;
        }
      }
    }
  }
}`}
            </pre>

            <p className="text-[11.5px] text-[#14532D] font-bold">
              ۶. در نهایت، دکمه آبی‌رنگ <strong>Publish (انتشار)</strong> را در بالای صفحه بزنید. پس از نمایش پیام سبز «Rules published successfully»، محدودیت دسترسی به کلی برطرف شده و پایگاه‌داده آماده همگام‌سازی ابری است.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
