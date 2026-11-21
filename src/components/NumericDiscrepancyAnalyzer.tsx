import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Search,
  Table2,
} from 'lucide-react';
import type {
  DatasetStatisticalComparison,
  DiscrepancySeverity,
  DiscrepancySourceKind,
  NumericDiscrepancyItem,
  NumericDiscrepancyReport,
} from '../lib/numericDiscrepancyAnalyzer';
import { toPersianDigits } from '../lib/formatParsers';

interface NumericDiscrepancyAnalyzerProps {
  report: NumericDiscrepancyReport | null | undefined;
}

const SEVERITY_META: Record<
  DiscrepancySeverity,
  { label: string; textCls: string; dotSymbol: string }
> = {
  critical: { label: 'بحرانی', textCls: 'text-[#9A3412] font-bold', dotSymbol: '▲' },
  warning: { label: 'هشدار', textCls: 'text-[#92400E] font-bold', dotSymbol: '●' },
  info: { label: 'جزئی', textCls: 'text-[#1E3A5F] font-semibold', dotSymbol: '○' },
};

function formatNumFa(val: number, decimals = 2): string {
  const rounded = Number.isInteger(val) ? String(val) : Number(val.toFixed(decimals)).toString();
  return toPersianDigits(rounded);
}

function escapeCsv(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const DatasetComparisonVisual: React.FC<{ dataset: DatasetStatisticalComparison }> = ({
  dataset,
}) => {
  const pts = dataset.points.slice(0, 12);
  if (pts.length === 0) return null;

  if (dataset.sourceKind === 'chart' && pts.length >= 2) {
    const width = 680;
    const height = 228;
    const padL = 56;
    const padR = 26;
    const padT = 26;
    const padB = 42;
    const plotPadX = 32;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const allVals = pts.flatMap((p) => [p.valueA, p.valueB]);
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const span = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.15, 1);
    const yMin = Math.max(0, rawMin - span * 0.18);
    const yMax = rawMax + span * 0.22;

    const usableW = Math.max(plotW - plotPadX * 2, 100);
    const xFor = (idx: number) =>
      pts.length === 1
        ? padL + plotW / 2
        : padL + plotPadX + (idx / (pts.length - 1)) * usableW;
    const yFor = (v: number) => padT + plotH - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * plotH;

    const pathA = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.valueA).toFixed(1)}`)
      .join(' ');
    const pathB = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.valueB).toFixed(1)}`)
      .join(' ');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * (yMax - yMin));

    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#1E3A5F]">
              <span className="inline-block h-0.5 w-4 bg-[#1E3A5F]" aria-hidden="true" />
              <span dir="auto">نسخه ۱: {dataset.fileAName}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#9A3412]">
              <span
                className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#9A3412]"
                aria-hidden="true"
              />
              <span dir="auto">نسخه ۲: {dataset.fileBName}</span>
            </span>
          </div>
          <span className="font-mono tabular-nums text-[#78716C]">
            واحد: <span dir="ltr">{dataset.unitDisplay}</span>
          </span>
        </div>

        <div className="w-full overflow-x-auto" dir="ltr">
          <svg
            direction="ltr"
            viewBox={`0 0 ${width} ${height}`}
            className="w-full min-w-[480px] max-h-[236px]"
            style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
            role="img"
            aria-label={`مقایسه گرافیکی ${dataset.title}`}
          >
            {/* Horizontal grid lines */}
            {yTicks.map((tick, i) => {
              const y = yFor(tick);
              return (
                <g key={i}>
                  <line
                    x1={padL}
                    x2={width - padR}
                    y1={y}
                    y2={y}
                    stroke="#EFECE4"
                    strokeWidth="1"
                  />
                  <text
                    x={padL - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-[#78716C] text-[10px] font-mono"
                  >
                    {Number(tick.toFixed(1))}
                  </text>
                </g>
              );
            })}

            {/* Vertical delta connectors between Version A & Version B */}
            {pts.map((p, i) => (
              <line
                key={`delta-${i}`}
                x1={xFor(i)}
                x2={xFor(i)}
                y1={yFor(p.valueA)}
                y2={yFor(p.valueB)}
                stroke={p.severity === 'critical' ? '#DC2626' : '#D97706'}
                strokeWidth="2"
                strokeOpacity="0.35"
              />
            ))}

            {/* Series A (Reference) */}
            <path d={pathA} fill="none" stroke="#1E3A5F" strokeWidth="2.4" />
            {/* Series B (Comparison) */}
            <path
              d={pathB}
              fill="none"
              stroke="#9A3412"
              strokeWidth="2.4"
              strokeDasharray="6 4"
            />

            {/* Points & labels */}
            {pts.map((p, i) => {
              const cx = xFor(i);
              const cyA = yFor(p.valueA);
              const cyB = yFor(p.valueB);
              return (
                <g key={`pt-${i}`}>
                  <circle cx={cx} cy={cyA} r="4" fill="#1E3A5F" stroke="#FFFFFF" strokeWidth="1.5" />
                  <circle cx={cx} cy={cyB} r="4" fill="#9A3412" stroke="#FFFFFF" strokeWidth="1.5" />
                  <text
                    x={cx}
                    y={Math.min(cyA, cyB) - 8}
                    textAnchor="middle"
                    className="fill-[#9A3412] text-[9.5px] font-mono font-bold"
                  >
                    {p.percentDiff > 0 ? `+${p.percentDiff.toFixed(0)}%` : '0%'}
                  </text>
                  <text
                    x={cx}
                    y={height - 16}
                    textAnchor="middle"
                    className="fill-[#57534E] text-[10px] font-mono"
                  >
                    {p.label.length > 12 ? `${p.label.slice(0, 12)}…` : p.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  }

  // Table horizontal normalized comparison bars
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#1E3A5F]">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#1E3A5F]" aria-hidden="true" />
            <span dir="auto">نسخه ۱: {dataset.fileAName}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#9A3412]">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#9A3412]" aria-hidden="true" />
            <span dir="auto">نسخه ۲: {dataset.fileBName}</span>
          </span>
        </div>
        <span className="text-[#78716C]">مقیاس نسبی هر پارامتر بر پایه بیشینه دو نسخه</span>
      </div>

      <div className="space-y-2.5">
        {pts.map((p, idx) => {
          const maxPair = Math.max(Math.abs(p.valueA), Math.abs(p.valueB), 1e-6);
          const pctA = Math.min(100, Math.max(4, (Math.abs(p.valueA) / maxPair) * 100));
          const pctB = Math.min(100, Math.max(4, (Math.abs(p.valueB) / maxPair) * 100));
          return (
            <div key={`${p.label}-${idx}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#1A1816] truncate">{p.label}</span>
                <span
                  className={`font-mono tabular-nums text-[11px] shrink-0 ${
                    p.severity === 'critical'
                      ? 'text-[#9A3412] font-bold'
                      : p.severity === 'warning'
                        ? 'text-[#92400E] font-bold'
                        : p.severity === 'match'
                          ? 'text-[#14532D]'
                          : 'text-[#1E3A5F]'
                  }`}
                >
                  {p.severity === 'match'
                    ? 'مطابق (۰٪)'
                    : `اختلاف ${toPersianDigits(p.percentDiff.toFixed(1))}٪`}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-xs bg-[#F5F3EE] overflow-hidden" dir="ltr">
                    <div className="h-full bg-[#1E3A5F]" style={{ width: `${pctA}%` }} />
                  </div>
                  <span className="w-24 text-left text-[#1E3A5F]" dir="ltr">
                    {p.rawA} {p.unit && !p.rawA.includes(p.unit) ? p.unit : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-xs bg-[#F5F3EE] overflow-hidden" dir="ltr">
                    <div className="h-full bg-[#9A3412]" style={{ width: `${pctB}%` }} />
                  </div>
                  <span className="w-24 text-left text-[#9A3412]" dir="ltr">
                    {p.rawB} {p.unit && !p.rawB.includes(p.unit) ? p.unit : ''}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const NumericDiscrepancyAnalyzer: React.FC<NumericDiscrepancyAnalyzerProps> = ({
  report,
}) => {
  const [sourceFilter, setSourceFilter] = useState<'all' | DiscrepancySourceKind>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | DiscrepancySeverity>('all');
  const [query, setQuery] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const filteredDiscrepancies = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    return report.discrepancies.filter((item) => {
      if (sourceFilter !== 'all' && item.sourceKind !== sourceFilter) return false;
      if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
      if (q) {
        const hay = [
          item.datasetTitle,
          item.parameterLabel,
          item.columnOrAxisLabel,
          item.unitDisplay,
          item.severityReason,
          ...item.versions.map((v) => `${v.fileName} ${v.rawDisplay}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [report, sourceFilter, severityFilter, query]);

  const activeDataset = useMemo(() => {
    if (!report || report.datasetComparisons.length === 0) return null;
    if (selectedDatasetId) {
      const found = report.datasetComparisons.find((d) => d.id === selectedDatasetId);
      if (found) return found;
    }
    // Prefer chart comparison by default if present, otherwise first dataset
    return (
      report.datasetComparisons.find((d) => d.sourceKind === 'chart') ||
      report.datasetComparisons[0]
    );
  }, [report, selectedDatasetId]);

  if (!report) return null;

  const hasAnalyzableData =
    report.analyzedTablesCount > 0 ||
    report.analyzedChartsCount > 0 ||
    report.discrepancies.length > 0;

  if (!hasAnalyzableData) return null;

  const handleExportCsv = () => {
    const headers = [
      'نوع منبع',
      'عنوان جدول یا نمودار',
      'پارامتر / نقطه محور',
      'واحد',
      'سطح شدت',
      'فایل نسخه ۱',
      'مقدار نسخه ۱',
      'فایل نسخه ۲',
      'مقدار نسخه ۲',
      'اختلاف مطلق (Delta)',
      'درصد انحراف (%)',
      'میانگین',
      'انحراف معیار (Sigma)',
      'ضریب تغییرات (CV%)',
      'توصیه ایمنی ریمپ',
    ];
    const rows = filteredDiscrepancies.map((d: NumericDiscrepancyItem) => [
      d.sourceKind === 'chart' ? 'نمودار' : 'جدول داده',
      d.datasetTitle,
      d.parameterLabel,
      d.unitDisplay,
      SEVERITY_META[d.severity].label,
      d.versions[0]?.fileName || '',
      d.versions[0]?.rawDisplay || '',
      d.versions[1]?.fileName || '',
      d.versions[1]?.rawDisplay || '',
      d.stats.absDelta,
      d.stats.percentDiff,
      d.stats.mean,
      d.stats.stdDev,
      d.stats.cvPercent,
      d.safetyGuidance,
    ]);
    const csvBody = [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecu-numeric-discrepancies-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section
      data-testid="ecu-numeric-discrepancy-module"
      className="rounded-xl border border-[#E2DDD3] bg-white p-5 sm:p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EFECE4] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-[#57534E]">
            <Activity className="h-4 w-4 text-[#1E3A5F] shrink-0" />
            <span>تحلیل آماری قطعی · مقایسه نسخه به نسخه جداول داده و نمودارها</span>
          </div>
          <h3 className="text-base sm:text-lg font-extrabold text-[#1A1816]">
            شناسایی داده‌های عددی ناسازگار در ریمپ خودرو
          </h3>
          <p className="text-xs text-[#57534E] max-w-2xl leading-6">
            مقایسه خودکار ردیف‌های عددی جداول کالیبراسیون و نقاط منحنی‌های نمودار بین نسخه‌های مختلف فایل‌ها با محاسبه انحراف درصدی، انحراف معیار (σ)، RMSE و ارزیابی ریسک ایمنی موتور.
          </p>
        </div>

        {filteredDiscrepancies.length > 0 && (
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3.5 py-2 text-xs font-bold text-[#1E3A5F] hover:bg-[#EFECE4] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span>خروجی اکسل (CSV)</span>
          </button>
        )}
      </div>

      {/* 4-Column Unboxed Statistical KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 divide-x divide-x-reverse divide-[#EFECE4]">
        <div className="pr-0 lg:pr-2 first:pr-0">
          <div className="text-[11px] font-semibold text-[#57534E]">ناسازگاری‌های عددی</div>
          <div
            className={`mt-1 text-2xl font-extrabold tabular-nums font-mono ${
              report.criticalCount > 0
                ? 'text-[#9A3412]'
                : report.inconsistentCount > 0
                  ? 'text-[#92400E]'
                  : 'text-[#14532D]'
            }`}
          >
            {toPersianDigits(report.inconsistentCount)}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C] tabular-nums">
            {toPersianDigits(report.criticalCount)} بحرانی · {toPersianDigits(report.warningCount)}{' '}
            هشدار
            {report.infoCount > 0 ? ` · ${toPersianDigits(report.infoCount)} جزئی` : ''}
          </div>
        </div>

        <div className="pr-3">
          <div className="text-[11px] font-semibold text-[#57534E]">جداول و نمودارهای بررسی‌شده</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums font-mono text-[#1E3A5F]">
            {toPersianDigits(report.analyzedTablesCount + report.analyzedChartsCount)}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C] tabular-nums">
            {toPersianDigits(report.analyzedTablesCount)} جدول ·{' '}
            {toPersianDigits(report.analyzedChartsCount)} نمودار ({toPersianDigits(report.totalMatchedPoints)} نقطه)
          </div>
        </div>

        <div className="pr-3">
          <div className="text-[11px] font-semibold text-[#57534E]">بیشینه درصد انحراف (Max Δ%)</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums font-mono text-[#9A3412]">
            {toPersianDigits(report.maxPercentDiff.toFixed(1))}٪
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C]">
            بالاترین شکاف عددی ثبت‌شده بین نسخه‌ها
          </div>
        </div>

        <div className="pr-3">
          <div className="text-[11px] font-semibold text-[#57534E]">میانگین انحراف آماری</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums font-mono text-[#1E3A5F]">
            {toPersianDigits(report.meanPercentDiff.toFixed(1))}٪
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C] tabular-nums">
            میان {toPersianDigits(report.comparedFilesCount)} فایل منبع
          </div>
        </div>
      </div>

      {/* Dataset-Level Visual & Statistical Comparison (Tables & Charts) */}
      {activeDataset && (
        <div className="border-t border-[#EFECE4] pt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-[#1A1816]">
              {activeDataset.sourceKind === 'chart' ? (
                <BarChart3 className="h-4 w-4 text-[#1E3A5F]" />
              ) : (
                <Table2 className="h-4 w-4 text-[#1E3A5F]" />
              )}
              <span>مقایسه آماری بصری: {activeDataset.title}</span>
            </div>

            {report.datasetComparisons.length > 1 && (
              <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#F5F3EE]">
                {report.datasetComparisons.map((ds) => {
                  const active = ds.id === activeDataset.id;
                  return (
                    <button
                      key={ds.id}
                      type="button"
                      onClick={() => setSelectedDatasetId(ds.id)}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? 'bg-white text-[#1E3A5F] shadow-xs'
                          : 'text-[#57534E] hover:text-[#1A1816]'
                      }`}
                    >
                      {ds.sourceKind === 'chart' ? 'نمودار: ' : 'جدول: '}
                      {ds.title.length > 26 ? `${ds.title.slice(0, 26)}…` : ds.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Unboxed Dataset Statistical Telemetry */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#57534E] border-y border-[#EFECE4] py-2.5">
            <span>
              نقاط ناسازگار:{' '}
              <strong className="font-mono tabular-nums text-[#9A3412]">
                {toPersianDigits(activeDataset.inconsistentPointsCount)} از{' '}
                {toPersianDigits(activeDataset.matchedPointsCount)}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              میانگین انحراف:{' '}
              <strong className="font-mono tabular-nums text-[#1A1816]">
                {toPersianDigits(activeDataset.meanPercentDiff.toFixed(1))}٪
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              خطای ریشه میانگین مربعات (RMSE):{' '}
              <strong className="font-mono tabular-nums text-[#1E3A5F]">
                {formatNumFa(activeDataset.rmse, 2)}
              </strong>
            </span>
            {activeDataset.pearsonR !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  همبستگی منحنی (Pearson r):{' '}
                  <strong className="font-mono tabular-nums text-[#14532D]" dir="ltr">
                    {activeDataset.pearsonR.toFixed(3)}
                  </strong>
                </span>
              </>
            )}
          </div>

          <DatasetComparisonVisual dataset={activeDataset} />
        </div>
      )}

      {/* Interactive Filter & Search Controls */}
      {report.discrepancies.length === 0 ? (
        <div className="border-t border-[#EFECE4] pt-4 flex items-center gap-2.5 text-xs text-[#14532D]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            تمام مقادیر عددی در جداول و نمودارهای مقایسه‌شده بین نسخه‌های فایل‌ها کاملاً هم‌خوان و سازگار هستند.
          </span>
        </div>
      ) : (
        <div className="border-t border-[#EFECE4] pt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Source Kind Filter */}
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex items-center gap-1 p-1 rounded-lg bg-[#F5F3EE]"
                role="group"
                aria-label="فیلتر نوع منبع عددی"
              >
                {(
                  [
                    { id: 'all', label: `همه (${toPersianDigits(report.inconsistentCount)})` },
                    {
                      id: 'table',
                      label: `جداول داده (${toPersianDigits(report.discrepancies.filter((d) => d.sourceKind === 'table').length)})`,
                    },
                    {
                      id: 'chart',
                      label: `نمودارها (${toPersianDigits(report.discrepancies.filter((d) => d.sourceKind === 'chart').length)})`,
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSourceFilter(opt.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      sourceFilter === opt.id
                        ? 'bg-white text-[#1E3A5F] shadow-xs'
                        : 'text-[#57534E] hover:text-[#1A1816]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Severity Filter */}
              <div
                className="flex items-center gap-1 p-1 rounded-lg bg-[#F5F3EE]"
                role="group"
                aria-label="فیلتر شدت ناسازگاری"
              >
                {(
                  [
                    { id: 'all', label: 'همه سطوح' },
                    { id: 'critical', label: `بحرانی (${toPersianDigits(report.criticalCount)})` },
                    { id: 'warning', label: `هشدار (${toPersianDigits(report.warningCount)})` },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSeverityFilter(opt.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      severityFilter === opt.id
                        ? 'bg-white text-[#9A3412] shadow-xs'
                        : 'text-[#57534E] hover:text-[#1A1816]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#78716C]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجو در پارامتر، جدول، نمودار..."
                aria-label="جستجو در داده‌های عددی ناسازگار"
                className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] pr-9 pl-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {/* High-Density Statistical Data Grid */}
          {filteredDiscrepancies.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#78716C]">
              هیچ ناسازگاری عددی با فیلتر انتخاب‌شده یافت نشد.
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#EFECE4] rounded-lg">
              <table className="w-full border-collapse text-right text-xs">
                <thead>
                  <tr className="bg-[#FAF9F6] text-[#57534E] border-b border-[#E2DDD3]">
                    <th className="px-3 py-2.5 font-bold">پارامتر / نقطه</th>
                    <th className="px-3 py-2.5 font-bold">منبع</th>
                    <th className="px-3 py-2.5 font-bold">نسخه ۱</th>
                    <th className="px-3 py-2.5 font-bold">نسخه ۲</th>
                    <th className="px-3 py-2.5 font-bold">اختلاف (Δ)</th>
                    <th className="px-3 py-2.5 font-bold">انحراف (٪)</th>
                    <th className="px-3 py-2.5 font-bold">میانگین ± σ</th>
                    <th className="px-3 py-2.5 font-bold">شدت</th>
                    <th className="px-2 py-2.5 font-bold w-10 text-center">جزئیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFECE4]">
                  {filteredDiscrepancies.map((item) => {
                    const isExpanded = expandedRowId === item.id;
                    const sev = SEVERITY_META[item.severity];
                    const v1 = item.versions[0];
                    const v2 = item.versions[1];

                    return (
                      <React.Fragment key={item.id}>
                        <tr
                          className={`hover:bg-[#FAF9F6] transition-colors ${
                            isExpanded ? 'bg-[#FAF9F6]' : 'bg-white'
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <div
                              className="font-bold text-[#1A1816]"
                              dir={/^[\x00-\x7F]+$/.test(item.parameterLabel) ? 'ltr' : 'rtl'}
                              style={{ textAlign: 'right' }}
                            >
                              {item.parameterLabel}
                            </div>
                            <div className="text-[11px] text-[#78716C] truncate max-w-[230px]">
                              {item.datasetTitle}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[#57534E] whitespace-nowrap">
                            {item.sourceKind === 'chart' ? 'نمودار' : 'جدول داده'}
                          </td>
                          <td
                            className="px-3 py-2.5 font-mono tabular-nums text-[#1E3A5F] whitespace-nowrap"
                            dir={v1 && /[\u0600-\u06FF]/.test(v1.rawDisplay) ? 'rtl' : 'ltr'}
                          >
                            {v1?.rawDisplay || '—'}
                            {v1 && item.unitDisplay && !v1.rawDisplay.includes(item.unitDisplay)
                              ? ` ${item.unitDisplay}`
                              : ''}
                          </td>
                          <td
                            className="px-3 py-2.5 font-mono tabular-nums text-[#9A3412] whitespace-nowrap"
                            dir={v2 && /[\u0600-\u06FF]/.test(v2.rawDisplay) ? 'rtl' : 'ltr'}
                          >
                            {v2?.rawDisplay || '—'}
                            {v2 && item.unitDisplay && !v2.rawDisplay.includes(item.unitDisplay)
                              ? ` ${item.unitDisplay}`
                              : ''}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums font-bold text-[#1A1816]" dir="ltr">
                            Δ {item.stats.absDelta}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-mono tabular-nums font-bold ${
                              item.severity === 'critical'
                                ? 'text-[#9A3412]'
                                : item.severity === 'warning'
                                  ? 'text-[#92400E]'
                                  : 'text-[#1E3A5F]'
                            }`}
                          >
                            {toPersianDigits(item.stats.percentDiff.toFixed(1))}٪
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-[#57534E]" dir="ltr">
                            {item.stats.mean} ± {item.stats.stdDev}
                          </td>
                          <td className={`px-3 py-2.5 whitespace-nowrap ${sev.textCls}`}>
                            <span aria-hidden="true" className="ml-1">
                              {sev.dotSymbol}
                            </span>
                            {sev.label}
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => setExpandedRowId(isExpanded ? null : item.id)}
                              aria-expanded={isExpanded}
                              aria-label={`مشاهده تحلیل آماری ${item.parameterLabel}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#57534E] hover:bg-[#EFECE4] hover:text-[#1A1816] cursor-pointer"
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-[#FAF9F6]">
                            <td colSpan={9} className="px-4 py-3.5 space-y-2.5 border-t border-[#EFECE4]">
                              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-[#57534E]">
                                <span>
                                  دلیل طبقه‌بندی:{' '}
                                  <strong className="text-[#1A1816]">{item.severityReason}</strong>
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  میانه (Median): {formatNumFa(item.stats.median, 2)}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  ضریب تغییرات (CV): {toPersianDigits(item.stats.cvPercent.toFixed(1))}٪
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  بازه: {formatNumFa(item.stats.min, 2)} تا {formatNumFa(item.stats.max, 2)}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                                {item.versions.map((ver, vi) => (
                                  <div
                                    key={`${item.id}-v-${vi}`}
                                    className="flex items-center justify-between gap-2 rounded-md border border-[#E2DDD3] bg-white px-3 py-2"
                                  >
                                    <span className="text-[#57534E] truncate" dir="auto">
                                      نسخه {toPersianDigits(vi + 1)}: {ver.fileName}
                                    </span>
                                    <span
                                      className="font-mono tabular-nums font-bold text-[#1E3A5F] shrink-0"
                                      dir="ltr"
                                    >
                                      {ver.rawDisplay}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <div className="flex items-start gap-2 text-xs text-[#9A3412] leading-6 pt-0.5">
                                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>
                                  <strong>ارزیابی ایمنی کالیبراسیون ECU:</strong>{' '}
                                  {item.safetyGuidance}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
