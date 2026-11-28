import {
  BarChart3,
  Check,
  Copy,
  Download,
  Grid2x2,
  Search,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toPersianDigits } from '../lib/formatParsers';
import type { DetectedWinolsTable } from '../lib/winolsTableDetector';

interface WinolsGraphicalTableCardProps {
  table: DetectedWinolsTable;
}

function thermalCellColor(ratio: number): { backgroundColor: string; color: string } {
  const t = Math.max(0, Math.min(1, ratio));
  if (t < 0.35) {
    const u = t / 0.35;
    const r = Math.round(30 + u * 24);
    const g = Math.round(58 + u * 116);
    const b = Math.round(138 + u * 72);
    return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: '#FFFFFF' };
  }
  if (t < 0.68) {
    const u = (t - 0.35) / 0.33;
    const r = Math.round(54 + u * 184);
    const g = Math.round(174 - u * 28);
    const b = Math.round(210 - u * 165);
    return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: '#0F172A' };
  }
  const u = (t - 0.68) / 0.32;
  const r = Math.round(238 - u * 30);
  const g = Math.round(146 - u * 102);
  const b = Math.round(45 - u * 11);
  return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: '#FFFFFF' };
}

function exportTableAsCsv(table: DetectedWinolsTable) {
  const lines = [
    table.headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
    ...table.rows.map((row) =>
      row.map((c) => `"${(c || '').replace(/"/g, '""')}"`).join(',')
    ),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(table.mapCode || table.id || 'winols_table').toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function WinolsMatrixGraphicalView({ table }: { table: DetectedWinolsTable }) {
  const [viewMode, setViewMode] = useState<'heatmap' | 'curve' | 'profile'>('heatmap');
  const [highlightPeaks, setHighlightPeaks] = useState(true);
  const [copiedCsv, setCopiedCsv] = useState(false);

  const matrix = table.numericMatrix || [];
  const xLabels = table.xAxisLabels || table.headers.slice(1);
  const yLabels = table.yAxisLabels || table.rows.map((r) => r[0] || '');

  const initialRow = table.peakCell?.rowIndex ?? Math.max(0, matrix.length - 1);
  const initialCol = table.peakCell?.colIndex ?? Math.min(2, Math.max(0, xLabels.length - 1));
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number }>({
    r: initialRow,
    c: initialCol,
  });

  const minVal = table.minValue ?? 0;
  const maxVal = table.maxValue ?? 1;
  const span = Math.max(0.0001, maxVal - minVal);
  const peakThreshold = minVal + span * 0.82;

  const activeValue = matrix[selectedCell.r]?.[selectedCell.c] ?? null;
  const activeRaw = table.rows[selectedCell.r]?.[selectedCell.c + 1] || '—';

  const rowStats = useMemo(() => {
    return matrix.map((row, rIdx) => {
      const nums = row.filter((v): v is number => v !== null && Number.isFinite(v));
      const rowMin = nums.length ? Math.min(...nums) : 0;
      const rowMax = nums.length ? Math.max(...nums) : 0;
      const rowMean = nums.length
        ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
        : 0;
      return {
        rowIndex: rIdx,
        yLabel: yLabels[rIdx] || `R${rIdx + 1}`,
        min: rowMin,
        max: rowMax,
        mean: rowMean,
      };
    });
  }, [matrix, yLabels]);

  const activeRowStat = rowStats[selectedCell.r];
  const deltaFromRowMean =
    activeValue !== null && activeRowStat
      ? Math.round((activeValue - activeRowStat.mean) * 100) / 100
      : null;
  const pctOfPeak =
    activeValue !== null && maxVal !== 0
      ? Math.round((activeValue / Math.abs(maxVal)) * 100)
      : null;

  const curveData = useMemo(() => {
    const row = matrix[selectedCell.r] || [];
    return xLabels.map((xLab, cIdx) => ({
      x: xLab,
      value: row[cIdx] ?? 0,
      rowMean: activeRowStat?.mean ?? 0,
    }));
  }, [matrix, selectedCell.r, xLabels, activeRowStat]);

  const handleCopyTsv = async () => {
    const tsv = [
      table.headers.join('\t'),
      ...table.rows.map((r) => r.join('\t')),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopiedCsv(true);
      setTimeout(() => setCopiedCsv(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <section
      data-testid="winols-graphical-table"
      data-winols-kind={table.kind}
      aria-label={table.title}
      className="my-6 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="font-bold text-[#1E3A5F]">
              {table.kind === 'hex_dump' ? 'هگزدامپ گرافیکی WinOLS' : 'ماتریس کالیبراسیون WinOLS'}
            </span>
            {table.mapCode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-bold text-slate-800" dir="ltr">
                  {table.mapCode}
                </span>
              </>
            )}
            {table.hexAddress && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-semibold text-amber-800" dir="ltr">
                  {table.hexAddress}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums" dir="ltr">
              {table.dimensionsLabel}
            </span>
            {table.unit && table.unit !== 'raw' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono" dir="ltr">
                  {table.unit}
                </span>
              </>
            )}
          </div>
          <h5 className="text-[14px] font-extrabold leading-snug text-slate-900">
            {table.title}
          </h5>
        </div>

        {/* Interactive View Mode Switcher & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="حالت نمایش جدول وینولز"
            className="flex items-center gap-1 rounded-lg bg-slate-200/75 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'heatmap'}
              onClick={() => setViewMode('heatmap')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                viewMode === 'heatmap'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Grid2x2 className="h-3.5 w-3.5" />
              <span>ماتریس حرارتی</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'curve'}
              onClick={() => setViewMode('curve')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                viewMode === 'curve'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span>برش ۲بعدی</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'profile'}
              onClick={() => setViewMode('profile')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                viewMode === 'profile'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>پروفیل ردیف‌ها</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyTsv}
            title="کپی جدول برای جای‌گذاری مستقیم در WinOLS یا Excel"
            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedCsv ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedCsv ? 'کپی شد' : 'کپی WinOLS'}</span>
          </button>

          <button
            type="button"
            onClick={() => exportTableAsCsv(table)}
            title="دانلود جدول به فرمت CSV"
            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Telemetry Summary & Active Cell Inspector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
        <div>
          <div className="text-[11px] text-slate-500">سلول انتخاب‌شده</div>
          <div className="mt-0.5 font-mono text-xs font-bold text-[#1E3A5F] tabular-nums" dir="ltr">
            {yLabels[selectedCell.r] || '—'} × {xLabels[selectedCell.c] || '—'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">مقدار سلول</div>
          <div className="mt-0.5 font-mono text-sm font-extrabold text-slate-900 tabular-nums" dir="ltr">
            {activeRaw} {table.unit !== 'raw' ? table.unit : ''}
            {pctOfPeak !== null && (
              <span className="mr-1.5 text-[11px] font-medium text-slate-500">
                ({pctOfPeak}%)
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">اختلاف از میانگین ردیف</div>
          <div
            className={`mt-0.5 font-mono text-xs font-bold tabular-nums ${
              deltaFromRowMean !== null && deltaFromRowMean > 0
                ? 'text-emerald-700'
                : deltaFromRowMean !== null && deltaFromRowMean < 0
                  ? 'text-amber-700'
                  : 'text-slate-600'
            }`}
            dir="ltr"
          >
            {deltaFromRowMean !== null
              ? `${deltaFromRowMean > 0 ? '+' : ''}${deltaFromRowMean}`
              : '—'}{' '}
            <span className="font-normal text-slate-500">
              (Avg {activeRowStat?.mean ?? '—'})
            </span>
          </div>
        </div>
        <div className="flex flex-col justify-between">
          <div className="text-[11px] text-slate-500">بازه کل نقشه (Min / Max)</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-bold text-slate-800 tabular-nums" dir="ltr">
              {minVal} — {maxVal}
            </span>
            {viewMode === 'heatmap' && (
              <button
                type="button"
                onClick={() => setHighlightPeaks((v) => !v)}
                className={`rounded border px-2 py-0.5 text-[10.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  highlightPeaks
                    ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                نقاط اوج
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Graphical Body */}
      <div className="p-4 sm:p-5">
        {viewMode === 'heatmap' && (
          <div className="space-y-3">
            <div className="overflow-x-auto pb-1" dir="ltr">
              <table className="w-full border-separate border-spacing-[2px] text-center font-mono text-xs tabular-nums">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[78px] rounded bg-slate-100 px-2.5 py-2 text-[10.5px] font-bold text-slate-600">
                      {table.headers[0] || `${table.yAxisLabel} \\ ${table.xAxisLabel}`}
                    </th>
                    {xLabels.map((xLab, cIdx) => (
                      <th
                        key={`${xLab}_${cIdx}`}
                        className={`min-w-[56px] rounded px-2 py-2 text-[11px] font-bold transition-colors ${
                          selectedCell.c === cIdx
                            ? 'bg-[#1E3A5F] text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {xLab}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rIdx) => (
                    <tr key={`row_${rIdx}`}>
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 rounded px-2.5 py-2 text-[11px] font-bold transition-colors ${
                          selectedCell.r === rIdx
                            ? 'bg-[#1E3A5F] text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {yLabels[rIdx] || `R${rIdx + 1}`}
                      </th>
                      {xLabels.map((xLab, cIdx) => {
                        const rawVal = row[cIdx + 1] ?? '—';
                        const numVal = matrix[rIdx]?.[cIdx] ?? null;
                        const ratio = numVal !== null ? (numVal - minVal) / span : 0.1;
                        const cellStyle =
                          numVal !== null
                            ? thermalCellColor(ratio)
                            : { backgroundColor: '#F1F5F9', color: '#475569' };
                        const isSelected = selectedCell.r === rIdx && selectedCell.c === cIdx;
                        const isPeak =
                          highlightPeaks && numVal !== null && numVal >= peakThreshold;

                        return (
                          <td key={`${rIdx}_${cIdx}_${xLab}`} className="p-0">
                            <button
                              type="button"
                              onClick={() => setSelectedCell({ r: rIdx, c: cIdx })}
                              style={cellStyle}
                              aria-label={`ردیف ${yLabels[rIdx]} ستون ${xLab} مقدار ${rawVal}`}
                              className={`w-full min-h-[38px] rounded px-1.5 py-1.5 font-bold transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-950 ${
                                isSelected
                                  ? 'ring-2 ring-slate-950 scale-[1.03]'
                                  : isPeak
                                    ? 'ring-1 ring-amber-300/90 hover:opacity-95'
                                    : 'hover:opacity-90'
                              }`}
                            >
                              {rawVal}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Scientific Color Scale Legend */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">طیف مقادیر:</span>
                <span className="font-mono tabular-nums" dir="ltr">
                  {minVal}
                </span>
                <div
                  className="h-2.5 w-32 rounded-sm"
                  style={{
                    background:
                      'linear-gradient(to left, rgb(208,44,34), rgb(238,146,45), rgb(54,174,210), rgb(30,58,138))',
                  }}
                />
                <span className="font-mono tabular-nums" dir="ltr">
                  {maxVal} {table.unit !== 'raw' ? table.unit : ''}
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                برای بازرسی دقیق یا رسم برش ۲بعدی روی هر سلول کلیک کنید
              </span>
            </div>
          </div>
        )}

        {viewMode === 'curve' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#1E3A5F]">
                برش ۲بعدی ردیف «{yLabels[selectedCell.r]}» در طول {table.xAxisLabel}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {yLabels.map((yLab, rIdx) => (
                  <button
                    key={`${yLab}_${rIdx}`}
                    type="button"
                    onClick={() => setSelectedCell((prev) => ({ ...prev, r: rIdx }))}
                    className={`rounded border px-2 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      selectedCell.r === rIdx
                        ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {yLab}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[235px] w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={curveData} margin={{ top: 10, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="x"
                    tick={{ fontSize: 11, fill: '#475569', fontFamily: 'monospace' }}
                    stroke="#94A3B8"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#1E3A5F', fontFamily: 'monospace' }}
                    stroke="#1E3A5F"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#F8FAFC',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name={`${yLabels[selectedCell.r]} (${table.unit})`}
                    stroke="#1E3A5F"
                    strokeWidth={2.8}
                    fill="#2563EB"
                    fillOpacity={0.12}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rowMean"
                    name="میانگین ردیف"
                    stroke="#D97706"
                    strokeWidth={1.6}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {viewMode === 'profile' && (
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-slate-600">
              توزیع کمینه، میانگین و بیشینه هر ردیف از نقشه ({toPersianDigits(rowStats.length)} ردیف)
            </div>
            <div className="space-y-2">
              {rowStats.map((rs) => {
                const meanPct = Math.max(4, Math.min(100, ((rs.mean - minVal) / span) * 100));
                const maxPct = Math.max(6, Math.min(100, ((rs.max - minVal) / span) * 100));
                const isActive = rs.rowIndex === selectedCell.r;
                return (
                  <button
                    key={rs.rowIndex}
                    type="button"
                    onClick={() => setSelectedCell((prev) => ({ ...prev, r: rs.rowIndex }))}
                    className={`w-full rounded-lg border px-3 py-2 text-right transition-colors cursor-pointer ${
                      isActive
                        ? 'border-[#1E3A5F] bg-[#EEF3F8]/60'
                        : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-bold text-[#1E3A5F]" dir="ltr">
                        {rs.yLabel}
                      </span>
                      <span className="font-mono text-[11px] text-slate-600 tabular-nums" dir="ltr">
                        Min {rs.min} · Avg {rs.mean} · Max {rs.max} {table.unit !== 'raw' ? table.unit : ''}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="relative h-full rounded-full bg-amber-500/75"
                        style={{ width: `${maxPct}%` }}
                      >
                        <div
                          className="h-full rounded-full bg-[#1E3A5F]"
                          style={{ width: `${Math.min(100, (meanPct / Math.max(1, maxPct)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Metadata Strip */}
      {table.factorOffset && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-600 sm:px-5">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#1E3A5F]" />
            <span>تنظیمات ضریب WinOLS</span>
          </span>
          <span className="font-mono tabular-nums" dir="ltr">
            {table.factorOffset}
          </span>
        </div>
      )}
    </section>
  );
}

function WinolsDamosDirectoryGraphicalView({ table }: { table: DetectedWinolsTable }) {
  const [query, setQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return table.rows;
    return table.rows.filter((row) => row.join(' ').toLowerCase().includes(q));
  }, [table.rows, query]);

  const handleCopyCell = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <section
      data-testid="winols-graphical-table"
      data-winols-kind="damos_directory"
      aria-label={table.title}
      className="my-6 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="font-bold text-[#1E3A5F]">دایرکتوری گرافیکی نقشه‌های WinOLS / Damos</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{toPersianDigits(table.rows.length)} نقشه شناسایی‌شده</span>
          </div>
          <h5 className="text-[14px] font-extrabold leading-snug text-slate-900">
            {table.title}
          </h5>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="فیلتر مپ یا آدرس..."
              aria-label="فیلتر در جدول نقشه‌های وینولز"
              className="h-8 w-44 rounded-md border border-slate-300 bg-white pr-8 pl-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1E3A5F] focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => exportTableAsCsv(table)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Desktop Precision Grid */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full border-collapse text-right text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100/80 text-slate-700">
              {table.headers.map((h, hIdx) => (
                <th key={hIdx} className="px-3.5 py-2.5 font-bold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredRows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-slate-50/90 transition-colors">
                {row.map((cell, cIdx) => {
                  const isHexOrCode = /^(?:0x[0-9a-f]{4,8}|[A-Z][A-Z0-9_]{2,14})$/i.test(cell.trim());
                  const cellKey = `${rIdx}_${cIdx}`;
                  return (
                    <td
                      key={cIdx}
                      className={`px-3.5 py-2.5 leading-relaxed ${
                        isHexOrCode
                          ? 'font-mono font-bold text-[#1E3A5F] tabular-nums'
                          : 'text-slate-800'
                      }`}
                    >
                      {isHexOrCode ? (
                        <button
                          type="button"
                          onClick={() => handleCopyCell(cell.trim(), cellKey)}
                          title="کپی شناسه یا آدرس"
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] hover:border-[#1E3A5F] cursor-pointer"
                          dir="ltr"
                        >
                          <span>{cell.trim()}</span>
                          {copiedKey === cellKey ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3 text-slate-400" />
                          )}
                        </button>
                      ) : (
                        cell || '—'
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Responsive Stacked Specification Rows */}
      <div className="divide-y divide-slate-200 sm:hidden">
        {filteredRows.map((row, rIdx) => (
          <div key={rIdx} className="space-y-1.5 px-4 py-3 text-xs">
            {row.map((cell, cIdx) => (
              <div key={cIdx} className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 font-semibold text-slate-500">
                  {table.headers[cIdx] || `ستون ${toPersianDigits(cIdx + 1)}`}:
                </span>
                <span className="font-medium text-slate-900 text-left break-words font-mono tabular-nums">
                  {cell || '—'}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {filteredRows.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-slate-500">
          ردیفی مطابق با «{query}» یافت نشد.
        </div>
      )}
    </section>
  );
}

export function WinolsGraphicalTableCard({ table }: WinolsGraphicalTableCardProps) {
  if (table.kind === 'damos_directory') {
    return <WinolsDamosDirectoryGraphicalView table={table} />;
  }
  return <WinolsMatrixGraphicalView table={table} />;
}
