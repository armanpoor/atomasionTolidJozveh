import {
  Check,
  Code2,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  Sliders,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AdaptiveVisualBlock,
  AfrIgnitionPayload,
  DiagnosticWaveformPayload,
  DynoVisualPayload,
  EcuPinoutPayload,
  EcuPinSpec,
  NumericTelemetryPayload,
  WinolsHeatmapPayload,
} from '../lib/bookTypes';
import { rasterizeSvgToPng, sanitizeSvgMarkup } from '../lib/diagramRenderer';
import { toPersianDigits } from '../lib/formatParsers';

interface AdaptiveVisualExhibitProps {
  block: AdaptiveVisualBlock;
}

function heatBgForRatio(ratio: number): { backgroundColor: string; color: string } {
  const t = Math.max(0, Math.min(1, ratio));
  if (t < 0.33) {
    const u = t / 0.33;
    const r = Math.round(30 + u * 26);
    const g = Math.round(64 + u * 114);
    const b = Math.round(145 + u * 65);
    return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: '#FFFFFF' };
  }
  if (t < 0.66) {
    const u = (t - 0.33) / 0.33;
    const r = Math.round(56 + u * 182);
    const g = Math.round(178 - u * 30);
    const b = Math.round(210 - u * 165);
    return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: '#0F172A' };
  }
  const u = (t - 0.66) / 0.34;
  const r = Math.round(238 - u * 26);
  const g = Math.round(148 - u * 102);
  const b = Math.round(45 - u * 9);
  return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: '#FFFFFF' };
}

function triggerFileDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ----------------------------------------------------------------------------
// 1. DYNO INTERACTIVE STUDIO
// ----------------------------------------------------------------------------
function DynoInteractiveView({ payload }: { payload: DynoVisualPayload }) {
  const [showStock, setShowStock] = useState(true);
  const [showAfr, setShowAfr] = useState(true);

  const hpGain = Math.round((payload.peakTunedHp - payload.peakStockHp) * 10) / 10;
  const tqGain = Math.round((payload.peakTunedTorqueNm - payload.peakStockTorqueNm) * 10) / 10;
  const hpGainPct = Math.round((hpGain / Math.max(1, payload.peakStockHp)) * 100);
  const tqGainPct = Math.round((tqGain / Math.max(1, payload.peakStockTorqueNm)) * 100);

  return (
    <div className="space-y-4">
      {/* Precision Telemetry Readout Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-200 pb-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">اوج توان (ریمپ / فابریک)</div>
          <div className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums" dir="ltr">
            <span className="text-lg font-bold text-[#1E3A5F]">{payload.peakTunedHp}</span>
            <span className="text-xs text-slate-500">HP</span>
            <span className="text-[11px] font-semibold text-emerald-700">
              +{hpGain} ({hpGainPct}%)
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">اوج گشتاور (ریمپ / فابریک)</div>
          <div className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums" dir="ltr">
            <span className="text-lg font-bold text-amber-700">{payload.peakTunedTorqueNm}</span>
            <span className="text-xs text-slate-500">Nm</span>
            <span className="text-[11px] font-semibold text-emerald-700">
              +{tqGain} ({tqGainPct}%)
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">قانون فیزیکی داینو</div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-800 tabular-nums" dir="ltr">
            HP = (Nm × RPM) / 7127
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 flex flex-col justify-between">
          <div className="text-[11px] text-slate-500">لایه‌های فعال نمودار</div>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowStock((v) => !v)}
              className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                showStock
                  ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:text-slate-900'
              }`}
            >
              مقایسه فابریک
            </button>
            <button
              type="button"
              onClick={() => setShowAfr((v) => !v)}
              className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                showAfr
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:text-slate-900'
              }`}
            >
              گراف AFR
            </button>
          </div>
        </div>
      </div>

      {/* Main Dual-Axis HP/Torque Dyno Plot */}
      <div className="w-full h-[290px]" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={payload.points} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis
              dataKey="rpm"
              tick={{ fontSize: 11, fill: '#475569', fontFamily: 'monospace' }}
              stroke="#94A3B8"
            />
            <YAxis
              yAxisId="hp"
              tick={{ fontSize: 11, fill: '#1E3A5F', fontFamily: 'monospace' }}
              stroke="#1E3A5F"
              label={{ value: 'HP', angle: -90, position: 'insideLeft', fill: '#1E3A5F', fontSize: 11 }}
            />
            <YAxis
              yAxisId="tq"
              orientation="right"
              tick={{ fontSize: 11, fill: '#B45309', fontFamily: 'monospace' }}
              stroke="#B45309"
              label={{ value: 'Nm', angle: 90, position: 'insideRight', fill: '#B45309', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                color: '#0F172A',
                fontSize: '12px',
                fontFamily: 'monospace',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
              }}
              labelStyle={{ color: '#0F172A', fontWeight: 700, marginBottom: '2px' }}
              labelFormatter={(rpm) => `RPM: ${rpm}`}
            />
            {payload.points[payload.points.length - 1]?.rpm >= 5252 && (
              <ReferenceLine
                x={5252}
                yAxisId="hp"
                stroke="#DC2626"
                strokeDasharray="5 4"
                label={{ value: '5252 RPM', position: 'top', fill: '#DC2626', fontSize: 10 }}
              />
            )}
            <Area
              yAxisId="hp"
              type="monotone"
              dataKey="tunedHp"
              name={`${payload.stageLabel} HP`}
              stroke="#1E3A5F"
              strokeWidth={2.8}
              fill="#2563EB"
              fillOpacity={0.1}
              activeDot={{ r: 5 }}
            />
            {showStock && (
              <Line
                yAxisId="hp"
                type="monotone"
                dataKey="stockHp"
                name="Stock HP"
                stroke="#64748B"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            )}
            <Line
              yAxisId="tq"
              type="monotone"
              dataKey="tunedTorqueNm"
              name={`${payload.stageLabel} Torque (Nm)`}
              stroke="#D97706"
              strokeWidth={2.6}
              dot={{ r: 3, fill: '#D97706' }}
            />
            {showStock && (
              <Line
                yAxisId="tq"
                type="monotone"
                dataKey="stockTorqueNm"
                name="Stock Torque (Nm)"
                stroke="#D97706"
                strokeOpacity={0.55}
                strokeWidth={1.8}
                strokeDasharray="3 3"
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* AFR Sub-Chart */}
      {showAfr && (
        <div className="border-t border-slate-200 pt-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
            <span className="font-semibold text-emerald-800">
              زیرنمودار نسبت سوخت به هوا (Wideband AFR)
            </span>
            <span className="font-mono tabular-nums" dir="ltr">
              Stoich 14.7:1 · Safe WOT 12.2–12.8:1
            </span>
          </div>
          <div className="w-full h-[115px]" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={payload.points} margin={{ top: 6, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="rpm"
                  tick={{ fontSize: 10, fill: '#64748B', fontFamily: 'monospace' }}
                />
                <YAxis
                  domain={[11, 15.5]}
                  tick={{ fontSize: 10, fill: '#059669', fontFamily: 'monospace' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    color: '#0F172A',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
                  }}
                  labelStyle={{ color: '#0F172A', fontWeight: 700 }}
                />
                <ReferenceLine y={14.7} stroke="#64748B" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="tunedAfr"
                  name="Tuned AFR"
                  stroke="#059669"
                  strokeWidth={2.4}
                  dot={{ r: 2.5 }}
                />
                {showStock && (
                  <Line
                    type="monotone"
                    dataKey="stockAfr"
                    name="Stock AFR"
                    stroke="#94A3B8"
                    strokeWidth={1.6}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// 2. WINOLS CREATIVE THERMAL HEATMAP + 2D SLICE STUDIO
// ----------------------------------------------------------------------------
function WinolsInteractiveView({ payload }: { payload: WinolsHeatmapPayload }) {
  const [matrixMode, setMatrixMode] = useState<'tuned' | 'stock' | 'delta'>('tuned');
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number }>({
    r: Math.max(0, payload.loadAxis.length - 2),
    c: Math.min(3, payload.rpmAxis.length - 1),
  });
  const [show2DSlice, setShow2DSlice] = useState(false);

  const flatVals = useMemo(() => payload.tunedMatrix.flat(), [payload.tunedMatrix]);
  const minVal = Math.min(...flatVals);
  const maxVal = Math.max(...flatVals);
  const span = Math.max(0.001, maxVal - minVal);

  const selStock = payload.stockMatrix[selectedCell.r]?.[selectedCell.c] ?? 0;
  const selTuned = payload.tunedMatrix[selectedCell.r]?.[selectedCell.c] ?? 0;
  const selDelta = Math.round((selTuned - selStock) * 100) / 100;
  const selDeltaPct =
    selStock !== 0 ? Math.round(((selTuned - selStock) / Math.abs(selStock)) * 1000) / 10 : 0;

  const sliceData = useMemo(
    () =>
      payload.rpmAxis.map((rpm, cIdx) => ({
        rpm,
        stock: payload.stockMatrix[selectedCell.r]?.[cIdx] ?? 0,
        tuned: payload.tunedMatrix[selectedCell.r]?.[cIdx] ?? 0,
      })),
    [payload, selectedCell.r]
  );

  return (
    <div className="space-y-4">
      {/* WinOLS Telemetry Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-mono tabular-nums" dir="ltr">
          <span className="font-bold text-[#1E3A5F]">{payload.mapCode}</span>
          <span aria-hidden="true">·</span>
          <span className="font-bold text-amber-700">{payload.hexAddress}</span>
          <span aria-hidden="true">·</span>
          <span>{payload.factorOffset}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                ['tuned', 'نسخه ریمپ'],
                ['stock', 'فابریک (Ori)'],
                ['delta', 'اختلاف Delta'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMatrixMode(m)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  matrixMode === m
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShow2DSlice((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
              show2DSlice
                ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>برش ۲بعدی</span>
          </button>
        </div>
      </div>

      {/* Selected Cell Precision Inspector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-slate-700">
          <span className="font-semibold text-slate-900">سلول انتخاب‌شده:</span>
          <span className="font-mono tabular-nums" dir="ltr">
            RPM = <strong>{payload.rpmAxis[selectedCell.c]}</strong> · Load ={' '}
            <strong>{payload.loadAxis[selectedCell.r]}%</strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums" dir="ltr">
          <span className="text-slate-600">
            Ori: <strong>{selStock}</strong>
          </span>
          <span className="text-[#1E3A5F]">
            Mod: <strong>{selTuned}</strong> {payload.unit}
          </span>
          <span
            className={`font-bold ${
              selDelta > 0
                ? 'text-emerald-700'
                : selDelta < 0
                  ? 'text-rose-700'
                  : 'text-slate-500'
            }`}
          >
            Δ {selDelta > 0 ? `+${selDelta}` : selDelta} ({selDeltaPct > 0 ? `+${selDeltaPct}` : selDeltaPct}%)
          </span>
        </div>
      </div>

      {/* Interactive Thermal Matrix */}
      <div className="overflow-x-auto" dir="ltr">
        <table className="w-full border-separate border-spacing-[2px] text-center font-mono text-xs tabular-nums">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-[10.5px] font-bold text-slate-500 bg-slate-100 rounded">
                Load \ RPM
              </th>
              {payload.rpmAxis.map((rpm, cIdx) => (
                <th
                  key={rpm}
                  className={`px-2 py-1.5 text-[11px] font-bold rounded ${
                    selectedCell.c === cIdx
                      ? 'bg-[#1E3A5F] text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {rpm}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...payload.loadAxis].reverse().map((loadVal, revIdx) => {
              const rIdx = payload.loadAxis.length - 1 - revIdx;
              return (
                <tr key={loadVal}>
                  <td
                    className={`px-2 py-2 text-[11px] font-bold rounded ${
                      selectedCell.r === rIdx
                        ? 'bg-[#1E3A5F] text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {loadVal}%
                  </td>
                  {payload.rpmAxis.map((rpm, cIdx) => {
                    const st = payload.stockMatrix[rIdx]?.[cIdx] ?? 0;
                    const tu = payload.tunedMatrix[rIdx]?.[cIdx] ?? 0;
                    const delta = Math.round((tu - st) * 100) / 100;
                    const displayVal =
                      matrixMode === 'stock'
                        ? st
                        : matrixMode === 'delta'
                          ? `${delta > 0 ? '+' : ''}${delta}`
                          : tu;
                    const ratio =
                      matrixMode === 'delta'
                        ? delta === 0
                          ? 0.1
                          : Math.min(1, 0.45 + Math.abs(delta) / Math.max(0.5, span * 0.25))
                        : ((matrixMode === 'stock' ? st : tu) - minVal) / span;
                    const style = heatBgForRatio(ratio);
                    const isSelected = selectedCell.r === rIdx && selectedCell.c === cIdx;

                    return (
                      <td key={`${loadVal}_${rpm}`} className="p-0">
                        <button
                          type="button"
                          onClick={() => setSelectedCell({ r: rIdx, c: cIdx })}
                          style={style}
                          className={`w-full min-h-[38px] rounded px-1.5 py-1 font-bold transition-transform cursor-pointer ${
                            isSelected ? 'ring-2 ring-slate-950 scale-[1.03]' : 'hover:opacity-90'
                          }`}
                        >
                          <div>{displayVal}</div>
                          {matrixMode === 'tuned' && delta !== 0 && (
                            <div className="text-[9.5px] opacity-90">
                              {delta > 0 ? `+${delta}` : delta}
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Optional Interactive 2D Profile Slice for Selected Load Row */}
      {show2DSlice && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-700">
            <span className="font-bold text-[#1E3A5F]">
              برش ۲بعدی WinOLS در بار {toPersianDigits(payload.loadAxis[selectedCell.r])}٪
            </span>
            <span className="text-[11px] text-slate-500">
              برای تغییر ردیف بار، روی هر سلول جدول بالا کلیک کنید
            </span>
          </div>
          <div className="h-[180px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={sliceData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="rpm" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                <YAxis tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="stock"
                  name="Stock (Ori)"
                  stroke="#64748B"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
                <Line
                  type="monotone"
                  dataKey="tuned"
                  name={`Tuned (${payload.unit})`}
                  stroke="#D97706"
                  strokeWidth={2.6}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// 3. ECU PINOUT SCHEMATIC STUDIO
// ----------------------------------------------------------------------------
function EcuPinoutInteractiveView({ payload }: { payload: EcuPinoutPayload }) {
  const [railFilter, setRailFilter] = useState<'all' | EcuPinSpec['rail']>('all');
  const [selectedPin, setSelectedPin] = useState<EcuPinSpec>(payload.pins[0]);

  const railMeta: Record<EcuPinSpec['rail'], { labelFa: string; border: string; bg: string; badge: string }> = {
    power: { labelFa: 'تغذیه +12V', border: 'border-rose-300', bg: 'bg-rose-50/70', badge: 'bg-rose-700 text-white' },
    ground: { labelFa: 'بدنه GND', border: 'border-slate-400', bg: 'bg-slate-100', badge: 'bg-slate-800 text-white' },
    can_comm: { labelFa: 'شبکه CAN/K-Line', border: 'border-blue-300', bg: 'bg-blue-50/70', badge: 'bg-blue-700 text-white' },
    sensor: { labelFa: 'سنسور ورودی', border: 'border-emerald-300', bg: 'bg-emerald-50/70', badge: 'bg-emerald-700 text-white' },
    actuator: { labelFa: 'عملگر خروجی', border: 'border-amber-300', bg: 'bg-amber-50/70', badge: 'bg-amber-700 text-white' },
  };

  const visiblePins =
    railFilter === 'all' ? payload.pins : payload.pins.filter((p) => p.rail === railFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div className="text-xs font-mono font-bold text-[#1E3A5F]" dir="ltr">
          {payload.ecuName}
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setRailFilter('all')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer whitespace-nowrap ${
              railFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            همه پایه‌ها
          </button>
          {(Object.keys(railMeta) as Array<EcuPinSpec['rail']>).map((rail) => (
            <button
              key={rail}
              type="button"
              onClick={() => setRailFilter(rail)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                railFilter === rail ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {railMeta[rail].labelFa}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {visiblePins.map((p) => {
          const st = railMeta[p.rail];
          const active = selectedPin?.pin === p.pin;
          return (
            <button
              key={p.pin}
              type="button"
              onClick={() => setSelectedPin(p)}
              className={`text-right rounded-lg border p-3 transition-colors cursor-pointer ${st.border} ${st.bg} ${
                active ? 'ring-2 ring-[#1E3A5F]' : 'hover:bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">{p.label}</span>
                <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${st.badge}`} dir="ltr">
                  {p.pin}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-600 font-mono tabular-nums" dir="ltr">
                <span>{p.voltageRange}</span>
                <span className="truncate max-w-[140px]">{p.signalSpec}</span>
              </div>
            </button>
          );
        })}
      </div>

      {selectedPin && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-bold text-[#1E3A5F]">پایه {selectedPin.pin}:</span>{' '}
            <span className="text-slate-800">{selectedPin.label}</span>{' '}
            <span className="text-slate-500">({railMeta[selectedPin.rail].labelFa})</span>
          </div>
          <div className="font-mono text-slate-700 tabular-nums" dir="ltr">
            {selectedPin.voltageRange} · {selectedPin.signalSpec}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// 4. DIAGNOSTIC WAVEFORM LAB
// ----------------------------------------------------------------------------
function DiagnosticWaveformInteractiveView({
  payload,
}: {
  payload: DiagnosticWaveformPayload;
}) {
  const [traceMode, setTraceMode] = useState<'both' | 'nominal' | 'faulty'>('both');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div className="text-xs text-slate-700">
          <span className="font-bold text-slate-900">{payload.sensorName}</span>
          <span className="mx-2 text-slate-400">·</span>
          <span className="font-mono font-bold text-rose-700" dir="ltr">
            DTC: {payload.dtcCodes.join(' / ')}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              ['both', 'مقایسه هم‌زمان'],
              ['nominal', 'فقط موج سالم'],
              ['faulty', 'فقط موج معیوب'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setTraceMode(m)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                traceMode === m ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-[#0B1220] p-3 h-[250px]" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={payload.samples} margin={{ top: 12, right: 16, left: 0, bottom: 6 }}>
            <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
            <XAxis
              dataKey="tMs"
              tick={{ fontSize: 10.5, fill: '#94A3B8', fontFamily: 'monospace' }}
              unit="ms"
            />
            <YAxis
              tick={{ fontSize: 10.5, fill: '#94A3B8', fontFamily: 'monospace' }}
              unit={payload.unit}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#F8FAFC',
                fontSize: '11.5px',
                fontFamily: 'monospace',
              }}
            />
            <ReferenceLine
              y={payload.thresholdValue}
              stroke="#F59E0B"
              strokeDasharray="6 4"
              label={{
                value: `${payload.thresholdValue}${payload.unit}`,
                position: 'right',
                fill: '#FCD34D',
                fontSize: 10,
              }}
            />
            {traceMode !== 'faulty' && (
              <Line
                type="monotone"
                dataKey="nominal"
                name="Nominal Signal"
                stroke="#10B981"
                strokeWidth={2.6}
                dot={false}
              />
            )}
            {traceMode !== 'nominal' && (
              <Line
                type="monotone"
                dataKey="faulty"
                name="Faulty Trace"
                stroke="#EF4444"
                strokeWidth={2.4}
                strokeDasharray="6 4"
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ol className="space-y-1.5 pr-4 text-xs text-slate-700 list-decimal">
        {payload.diagnosticSteps.map((step, idx) => (
          <li key={idx} className="leading-6">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 5. AFR & IGNITION COMBUSTION LAB
// ----------------------------------------------------------------------------
function AfrIgnitionInteractiveView({ payload }: { payload: AfrIgnitionPayload }) {
  const [selectedIdx, setSelectedIdx] = useState(Math.min(3, payload.points.length - 1));
  const currentPt = payload.points[selectedIdx] ?? payload.points[0];
  const knockMargin =
    Math.round((currentPt.knockLimitDeg - currentPt.tunedAdvanceDeg) * 10) / 10;

  const afrStateLabel =
    currentPt.afr < 12.1
      ? 'غنی (خنک‌کاری احتراق)'
      : currentPt.afr <= 13.1
        ? 'بازه حداکثر توان (Best Power)'
        : currentPt.afr <= 15.0
          ? 'استوکیومتری (اقتصادی)'
          : 'مخلوط فقیر (خطر ناک)';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-slate-200 pb-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] text-slate-500">دور موتور انتخاب‌شده</div>
          <div className="mt-1 font-mono text-base font-bold text-[#1E3A5F] tabular-nums" dir="ltr">
            {currentPt.rpm} RPM
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] text-slate-500">آوانس ریمپ / حاشیه امن ناک</div>
          <div className="mt-1 font-mono text-base font-bold text-emerald-700 tabular-nums" dir="ltr">
            {currentPt.tunedAdvanceDeg}° BTDC · Margin {knockMargin}°
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] text-slate-500">وضعیت مخلوط سوخت (AFR)</div>
          <div className="mt-1 text-xs font-bold text-slate-800">
            <span className="font-mono tabular-nums" dir="ltr">
              {currentPt.afr}:1
            </span>{' '}
            — {afrStateLabel}
          </div>
        </div>
      </div>

      {/* Interactive RPM Scrubber */}
      <div className="flex items-center gap-3 text-xs">
        <label htmlFor="afr-rpm-slider" className="shrink-0 font-semibold text-slate-700">
          بررسی نقطه کاری (RPM):
        </label>
        <input
          id="afr-rpm-slider"
          type="range"
          min={0}
          max={Math.max(0, payload.points.length - 1)}
          value={selectedIdx}
          onChange={(e) => setSelectedIdx(Number(e.target.value))}
          className="flex-1 accent-[#1E3A5F] cursor-pointer"
        />
        <span className="font-mono font-bold text-slate-700 tabular-nums" dir="ltr">
          {currentPt.rpm}
        </span>
      </div>

      <div className="w-full h-[230px]" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={payload.points} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="rpm" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
            <YAxis tick={{ fontSize: 11, fontFamily: 'monospace' }} unit="°" />
            <Tooltip />
            <ReferenceLine x={currentPt.rpm} stroke="#1E3A5F" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="knockLimitDeg"
              name="Knock Boundary (°)"
              stroke="#DC2626"
              strokeDasharray="5 4"
              strokeWidth={2}
              fill="#F59E0B"
              fillOpacity={0.12}
            />
            <Line
              type="monotone"
              dataKey="stockAdvanceDeg"
              name="Stock Advance (°)"
              stroke="#64748B"
              strokeDasharray="4 4"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="tunedAdvanceDeg"
              name="Tuned MBT Advance (°)"
              stroke="#1E3A5F"
              strokeWidth={2.8}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 6. AUTO-ACTIVATED PYTHON NUMERIC TELEMETRY (TEMPERATURE / PRESSURE / TORQUE)
// ----------------------------------------------------------------------------
function NumericTelemetryInteractiveView({
  payload,
}: {
  payload: NumericTelemetryPayload;
}) {
  const hasSecondary = payload.points.some((p) => p.secondaryValue !== undefined);
  const [showSecondary, setShowSecondary] = useState(true);
  const [showLimit, setShowLimit] = useState(true);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-200 pb-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">بیشینه ({payload.primarySeriesLabel})</div>
          <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums" dir="ltr">
            <span className="text-lg font-bold text-[#1E3A5F]">{payload.peakPrimary}</span>
            <span className="text-xs text-slate-500">{payload.primaryUnit}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">میانگین / کمینه</div>
          <div className="mt-1 font-mono text-sm font-bold text-slate-800 tabular-nums" dir="ltr">
            {payload.avgPrimary} <span className="text-xs font-normal text-slate-500">/ {payload.minPrimary} {payload.primaryUnit}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-500">کلیدواژه‌های محرک پایتون</div>
          <div className="mt-1 text-xs font-bold text-emerald-800 truncate">
            {payload.matchedKeywords.join(' · ')}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 flex flex-col justify-between">
          <div className="text-[11px] text-slate-500">لایه‌های نمودار</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {payload.safeLimitValue !== undefined && (
              <button
                type="button"
                onClick={() => setShowLimit((v) => !v)}
                className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                  showLimit
                    ? 'border-rose-700 bg-rose-700 text-white'
                    : 'border-slate-300 bg-white text-slate-600'
                }`}
              >
                حد ایمن
              </button>
            )}
            {hasSecondary && (
              <button
                type="button"
                onClick={() => setShowSecondary((v) => !v)}
                className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                  showSecondary
                    ? 'border-amber-700 bg-amber-700 text-white'
                    : 'border-slate-300 bg-white text-slate-600'
                }`}
              >
                سری دوم
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="w-full h-[270px]" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={payload.points} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis
              dataKey="xLabel"
              tick={{ fontSize: 11, fill: '#475569', fontFamily: 'monospace' }}
              stroke="#94A3B8"
            />
            <YAxis
              yAxisId="primary"
              tick={{ fontSize: 11, fill: '#1E3A5F', fontFamily: 'monospace' }}
              stroke="#1E3A5F"
              label={{
                value: payload.primaryUnit,
                angle: -90,
                position: 'insideLeft',
                fill: '#1E3A5F',
                fontSize: 11,
              }}
            />
            {hasSecondary && showSecondary && (
              <YAxis
                yAxisId="secondary"
                orientation="right"
                tick={{ fontSize: 11, fill: '#B45309', fontFamily: 'monospace' }}
                stroke="#B45309"
                label={{
                  value: payload.secondaryUnit || '',
                  angle: 90,
                  position: 'insideRight',
                  fill: '#B45309',
                  fontSize: 11,
                }}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                color: '#0F172A',
                fontSize: '12px',
                fontFamily: 'monospace',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
              }}
              labelStyle={{ color: '#0F172A', fontWeight: 700, marginBottom: '2px' }}
            />
            {showLimit && payload.safeLimitValue !== undefined && (
              <ReferenceLine
                y={payload.safeLimitValue}
                yAxisId="primary"
                stroke="#DC2626"
                strokeDasharray="6 4"
                label={{
                  value: `${payload.safeLimitValue} ${payload.primaryUnit}`,
                  position: 'insideTopRight',
                  fill: '#DC2626',
                  fontSize: 10.5,
                }}
              />
            )}
            <Area
              yAxisId="primary"
              type="monotone"
              dataKey="primaryValue"
              name={`${payload.primarySeriesLabel} (${payload.primaryUnit})`}
              stroke="#1E3A5F"
              strokeWidth={2.8}
              fill="#2563EB"
              fillOpacity={0.11}
              activeDot={{ r: 5 }}
            />
            {hasSecondary && showSecondary && (
              <Line
                yAxisId="secondary"
                type="monotone"
                dataKey="secondaryValue"
                name={`${payload.secondarySeriesLabel || 'Secondary'} (${payload.secondaryUnit || ''})`}
                stroke="#D97706"
                strokeWidth={2.4}
                strokeDasharray="5 3"
                dot={{ r: 3, fill: '#D97706' }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// MAIN EXPORTED EXHIBIT WRAPPER
// ----------------------------------------------------------------------------
export function AdaptiveVisualExhibit({ block }: AdaptiveVisualExhibitProps) {
  const [viewTab, setViewTab] = useState<'interactive' | 'python_svg' | 'python_code'>('interactive');
  const [copied, setCopied] = useState(false);
  const [downloadingPng, setDownloadingPng] = useState(false);

  const kindLabelFa: Record<AdaptiveVisualBlock['visualKind'], string> = {
    dyno_chart: 'نمودار تعاملی داینو و پایتون',
    winols_heatmap: 'ماتریس حرارتی و سطح ۳بعدی WinOLS',
    ecu_pinout: 'نقشه تعاملی پین‌اوت ECU',
    diagnostic_waveform: 'آزمایشگاه اسیلوسکوپ و عیب‌یابی',
    afr_ignition_curve: 'آزمایشگاه احتراق، AFR و آوانس جرقه',
    numeric_telemetry_chart: 'ویژوالساز پایتون داده‌های عددی (دما / فشار / گشتاور)',
  };

  const activeSvg = block.pythonRenderedSvg || block.svgMarkup;

  const handleCopyCode = async () => {
    if (!block.pythonScript) return;
    try {
      await navigator.clipboard.writeText(block.pythonScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownloadPython = () => {
    if (!block.pythonScript) return;
    triggerFileDownload(
      block.pythonScript,
      `${block.id}.py`,
      'text/x-python;charset=utf-8'
    );
  };

  const handleDownloadPng = async () => {
    setDownloadingPng(true);
    try {
      const res = await rasterizeSvgToPng(activeSvg, block.widthPx, block.heightPx);
      if (res.pngDataUrl) {
        const a = document.createElement('a');
        a.href = res.pngDataUrl;
        a.download = `${block.id}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      setDownloadingPng(false);
    }
  };

  return (
    <figure
      data-testid={`adaptive-visual-exhibit-${block.visualKind}`}
      className="my-7 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
    >
      {/* Top Instrument Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="font-semibold text-[#1E3A5F]">{kindLabelFa[block.visualKind]}</span>
            <span aria-hidden="true">·</span>
            <span>
              {block.renderedByPython
                ? block.pythonEngineLabel || 'رسم‌شده با موتور Python 3'
                : 'موتور گرافیکی هوشمند'}
            </span>
            {block.groundedFromText && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-700 font-medium">مبتنی بر ارقام متن فصل</span>
              </>
            )}
          </div>
          <h5 className="mt-0.5 text-[14px] font-extrabold text-slate-900 leading-snug">
            {block.title}
          </h5>
        </div>

        {/* Segmented Mode Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
            <button
              type="button"
              onClick={() => setViewTab('interactive')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                viewTab === 'interactive'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>نمای تعاملی</span>
            </button>
            <button
              type="button"
              onClick={() => setViewTab('python_svg')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                viewTab === 'python_svg'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>{block.renderedByPython ? 'خروجی پایتون' : 'گراف برداری'}</span>
            </button>
            {block.pythonScript && (
              <button
                type="button"
                onClick={() => setViewTab('python_code')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  viewTab === 'python_code'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>کد Matplotlib</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={downloadingPng}
            title="دانلود تصویر باکیفیت PNG از این نمودار"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>PNG</span>
          </button>
        </div>
      </div>

      {/* Main Stage Canvas */}
      <div className="p-4 sm:p-5 bg-white">
        {viewTab === 'interactive' && (
          <>
            {block.payload.kind === 'dyno_chart' && (
              <DynoInteractiveView payload={block.payload} />
            )}
            {block.payload.kind === 'winols_heatmap' && (
              <WinolsInteractiveView payload={block.payload} />
            )}
            {block.payload.kind === 'ecu_pinout' && (
              <EcuPinoutInteractiveView payload={block.payload} />
            )}
            {block.payload.kind === 'diagnostic_waveform' && (
              <DiagnosticWaveformInteractiveView payload={block.payload} />
            )}
            {block.payload.kind === 'afr_ignition_curve' && (
              <AfrIgnitionInteractiveView payload={block.payload} />
            )}
            {block.payload.kind === 'numeric_telemetry_chart' && (
              <NumericTelemetryInteractiveView payload={block.payload} />
            )}
          </>
        )}

        {viewTab === 'python_svg' && (
          <div className="space-y-2">
            <div
              className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2 [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(activeSvg) }}
            />
          </div>
        )}

        {viewTab === 'python_code' && block.pythonScript && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>اسکریپت آماده اجرای پایتون (Matplotlib + NumPy)</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? 'کپی شد' : 'کپی کد'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPython}
                  className="inline-flex items-center gap-1 rounded-md border border-[#1E3A5F] bg-[#1E3A5F] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#162C49] cursor-pointer whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>دانلود فایل .py</span>
                </button>
              </div>
            </div>
            <pre
              dir="ltr"
              className="max-h-[340px] overflow-auto rounded-lg bg-[#0F172A] p-4 text-left font-mono text-[11.5px] leading-relaxed text-slate-100"
            >
              <code>{block.pythonScript}</code>
            </pre>
          </div>
        )}
      </div>

      {/* Pedagogical Footer & Caption */}
      <figcaption className="border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5 space-y-1.5">
        <div className="text-xs font-bold text-[#1E3A5F]">{block.caption}</div>
        <p className="text-xs leading-6 text-slate-600">{block.pedagogicalTakeaway}</p>
        {block.extractedMetrics && block.extractedMetrics.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">داده‌های استخراج‌شده از متن:</span>
            {block.extractedMetrics.map((m, idx) => (
              <span key={idx} className="inline-flex items-center gap-2">
                {idx > 0 && <span aria-hidden="true">·</span>}
                <span>{m}</span>
              </span>
            ))}
          </div>
        )}
      </figcaption>
    </figure>
  );
}
