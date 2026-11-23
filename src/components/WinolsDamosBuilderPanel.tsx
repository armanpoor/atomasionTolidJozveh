import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Calculator,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  Info,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { toPersianDigits } from '../lib/formatParsers';
import type { WinolsExtractionReport } from '../lib/winolsMapGuide';
import {
  buildDefaultDamosConfigsFromReport,
  computeFce6PointerAddress,
  detectDefaultBaseAddressFromReport,
  generateWinols224A2l,
  generateWinols224CsvMapPack,
  generateWinols224DamosBundleZip,
  normalizeHexAddress,
  SIEMENS_WORKING_AREA_PRESETS,
  WinolsByteOrder,
  WinolsDataOrg,
  WinolsDamosMapConfig,
} from '../lib/winolsDamosExporter';
import type { ProjectRevisionDto } from '../lib/changeLogUtils';

interface WinolsDamosBuilderPanelProps {
  projectTitle: string;
  report: WinolsExtractionReport;
  onLogActivity?: (payload: {
    actionType: ProjectRevisionDto['actionType'];
    title: string;
    summary: string;
    extraDetails?: Record<string, unknown>;
  }) => void;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const WinolsDamosBuilderPanel: React.FC<WinolsDamosBuilderPanelProps> = ({
  projectTitle,
  report,
  onLogActivity,
}) => {
  const initialBase = useMemo(() => detectDefaultBaseAddressFromReport(report), [report]);
  const [baseAddressHex, setBaseAddressHex] = useState<string>(initialBase);
  const [byteOrder, setByteOrder] = useState<WinolsByteOrder>(
    initialBase === '0x68000' ? 'LoHi' : 'HiLo'
  );
  const [maps, setMaps] = useState<WinolsDamosMapConfig[]>(() =>
    buildDefaultDamosConfigsFromReport(report)
  );
  const [selectedConfigId, setSelectedConfigId] = useState<string>(
    () => report.entries[0]?.id ?? ''
  );

  // Sync if report changes drastically (new project loaded)
  const reportFingerprint = useMemo(
    () => report.entries.map((e) => e.id).join('|'),
    [report.entries]
  );
  useEffect(() => {
    const fresh = buildDefaultDamosConfigsFromReport(report);
    const freshBase = detectDefaultBaseAddressFromReport(report);
    setMaps(fresh);
    setBaseAddressHex(freshBase);
    setByteOrder(freshBase === '0x68000' ? 'LoHi' : 'HiLo');
    setSelectedConfigId(fresh[0]?.id ?? '');
  }, [reportFingerprint, report]);

  // Built-in Siemens FCE6 Pointer / Hex Axis Calculator state
  const [calcBaseInput, setCalcBaseInput] = useState<string>(initialBase.replace(/^0x/i, ''));
  const [calcOffsetInput, setCalcOffsetInput] = useState<string>('FDA');
  const [showA2lPreview, setShowA2lPreview] = useState<boolean>(false);
  const [copiedA2l, setCopiedA2l] = useState<boolean>(false);
  const [exportingZip, setExportingZip] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    setCalcBaseInput(baseAddressHex.replace(/^0x/i, ''));
  }, [baseAddressHex]);

  const fce6Result = useMemo(
    () => computeFce6PointerAddress(calcBaseInput, calcOffsetInput),
    [calcBaseInput, calcOffsetInput]
  );

  const ecuFamilySummary = useMemo(() => {
    const uniqueEcus = Array.from(
      new Set(
        report.entries
          .flatMap((e) => e.ecuModels)
          .filter(Boolean)
      )
    );
    return uniqueEcus.length > 0 ? uniqueEcus.slice(0, 4).join(' / ') : 'Siemens / Bosch ECU';
  }, [report.entries]);

  const a2lPreviewBuild = useMemo(
    () =>
      generateWinols224A2l({
        projectName: projectTitle || 'Remap_Project',
        ecuFamily: ecuFamilySummary,
        byteOrder,
        baseAddressHex,
        maps,
      }),
    [projectTitle, ecuFamilySummary, byteOrder, baseAddressHex, maps]
  );

  const updateMapField = <K extends keyof WinolsDamosMapConfig>(
    id: string,
    field: K,
    value: WinolsDamosMapConfig[K]
  ) => {
    setMaps((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const next: WinolsDamosMapConfig = { ...m, [field]: value };
        if (field === 'startAddressHex') {
          next.addressVerified = Boolean(normalizeHexAddress(String(value || ''), 4));
        }
        if (field === 'columns' || field === 'rows') {
          const cols = Math.max(1, Number(next.columns) || 1);
          const rows = Math.max(1, Number(next.rows) || 1);
          next.type = cols === 1 && rows === 1 ? 'VALUE' : cols === 1 || rows === 1 ? 'CURVE' : 'MAP';
          if (next.axisX) next.axisX = { ...next.axisX, count: Math.max(cols, rows === 1 ? cols : cols) };
          if (next.axisY && next.type === 'MAP') next.axisY = { ...next.axisY, count: rows };
        }
        return next;
      })
    );
  };

  const updateAxisHex = (id: string, axis: 'axisX' | 'axisY', hexVal: string) => {
    setMaps((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const existing = m[axis];
        if (!existing) {
          return {
            ...m,
            [axis]: {
              label: axis === 'axisX' ? 'RPM' : 'Load / MAP',
              addressHex: hexVal,
              count: axis === 'axisX' ? m.columns : m.rows,
              dataOrg: '16bit',
              signed: false,
              factor: 1,
              offset: 0,
              unit: axis === 'axisX' ? 'RPM' : '%',
              minValue: 0,
              maxValue: axis === 'axisX' ? 6500 : 100,
            },
          };
        }
        return {
          ...m,
          [axis]: { ...existing, addressHex: hexVal },
        };
      })
    );
  };

  const handleApplyCalcToSelected = (target: 'map' | 'axisX' | 'axisY') => {
    if (!fce6Result.valid || !selectedConfigId) return;
    if (target === 'map') {
      updateMapField(selectedConfigId, 'startAddressHex', fce6Result.finalAddressHex);
      setStatusNotice(`آدرس ${fce6Result.finalAddressHex} روی نقشه انتخاب‌شده ثبت شد.`);
    } else {
      updateAxisHex(selectedConfigId, target, fce6Result.finalAddressHex);
      setStatusNotice(
        `آدرس ${fce6Result.finalAddressHex} روی محور ${target === 'axisX' ? 'X' : 'Y'} نقشه انتخاب‌شده ثبت شد.`
      );
    }
    const targetMap = maps.find((m) => m.id === selectedConfigId);
    onLogActivity?.({
      actionType: 'winols_map_edited',
      title: `تنظیم آدرس هگز ${targetMap?.mapCode || 'نقشه'} (${fce6Result.finalAddressHex})`,
      summary: `آدرس ${fce6Result.formulaText} از طریق ماشین‌حساب FCE6 برای ${target === 'map' ? 'شروع نقشه' : target} ثبت شد.`,
      extraDetails: { note: fce6Result.formulaText },
    });
  };

  const handleAddCustomMap = () => {
    const newId = `custom_map_${Date.now()}`;
    const nextItem: WinolsDamosMapConfig = {
      id: newId,
      mapCode: `MAP_${maps.length + 1}`,
      nameFa: 'نقشه سفارشی جدید',
      folder: 'Custom_Maps',
      description: 'Custom calibration map added in WinOLS 2.24 DAMOS Builder',
      startAddressHex: fce6Result.valid ? fce6Result.finalAddressHex : baseAddressHex,
      baseAddressHex,
      columns: 12,
      rows: 16,
      type: 'MAP',
      dataOrg: '8bit',
      signed: false,
      byteOrder,
      factor: 1,
      offset: 0,
      precision: 2,
      unit: '%',
      axisX: {
        label: 'RPM',
        addressHex: '',
        count: 12,
        dataOrg: '16bit',
        signed: false,
        factor: 1,
        offset: 0,
        unit: 'RPM',
        minValue: 600,
        maxValue: 6500,
      },
      axisY: {
        label: 'Load / MAP',
        addressHex: '',
        count: 16,
        dataOrg: '16bit',
        signed: false,
        factor: 1,
        offset: 0,
        unit: '%',
        minValue: 10,
        maxValue: 100,
      },
      ecuFamily: ecuFamilySummary,
      lineSwappingRequired: baseAddressHex !== '0x68000',
      checksumExternal: true,
      addressVerified: true,
      safetyNote: 'پیش از اعمال تغییر، دامپ اصلی و Checksum بررسی شود.',
    };
    setMaps((prev) => [...prev, nextItem]);
    setSelectedConfigId(newId);
    setStatusNotice(`نقشه جدید ${nextItem.mapCode} به لیست داموس افزوده شد.`);
  };

  const handleRemoveMap = (id: string) => {
    setMaps((prev) => {
      const next = prev.filter((m) => m.id !== id);
      if (selectedConfigId === id) {
        setSelectedConfigId(next[0]?.id ?? '');
      }
      return next;
    });
  };

  const handleDownloadA2l = () => {
    if (maps.length === 0) return;
    const blob = new Blob([a2lPreviewBuild.a2lContent], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, a2lPreviewBuild.fileName);
    setStatusNotice(
      `فایل DAMOS استاندارد WinOLS 2.24 (${a2lPreviewBuild.fileName}) با ${toPersianDigits(maps.length)} نقشه دانلود شد.`
    );
    onLogActivity?.({
      actionType: 'winols_damos_exported',
      title: `خروجی فایل DAMOS (.a2l) برای WinOLS 2.24`,
      summary: `فایل ${a2lPreviewBuild.fileName} شامل ${toPersianDigits(maps.length)} نقشه (${toPersianDigits(a2lPreviewBuild.validation.readyWithAddressCount)} هگز تاییدشده · مبنای ${baseAddressHex} · ${byteOrder}) تولید و دانلود شد.`,
      extraDetails: {
        exportFormat: 'ASAP2 (.a2l)',
        mapsExported: maps.length,
        fileName: a2lPreviewBuild.fileName,
      },
    });
  };

  const handleDownloadCsvMapPack = () => {
    if (maps.length === 0) return;
    const csv = generateWinols224CsvMapPack(maps);
    const fileName = a2lPreviewBuild.fileName.replace(/\.a2l$/i, '_MapPack.csv');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, fileName);
    setStatusNotice(`فایل CSV Map Pack (${fileName}) دانلود شد.`);
    onLogActivity?.({
      actionType: 'winols_damos_exported',
      title: `خروجی WinOLS 2.24 CSV Map Pack`,
      summary: `فایل ${fileName} با ${toPersianDigits(maps.length)} نقشه کالیبراسیون دانلود شد.`,
      extraDetails: {
        exportFormat: 'WinOLS CSV Map Pack',
        mapsExported: maps.length,
        fileName,
      },
    });
  };

  const handleDownloadZipBundle = async () => {
    if (maps.length === 0) return;
    setExportingZip(true);
    try {
      const bundle = await generateWinols224DamosBundleZip({
        projectName: projectTitle || 'Remap_Project',
        ecuFamily: ecuFamilySummary,
        byteOrder,
        baseAddressHex,
        maps,
      });
      const blob = new Blob([new Uint8Array(bundle.zipBytes)], { type: 'application/zip' });
      triggerDownload(blob, bundle.fileName);
      setStatusNotice(
        `پکیج کامل کارگاهی WinOLS 2.24 (${bundle.fileName}) شامل .a2l + .csv + راهنما دانلود شد.`
      );
      onLogActivity?.({
        actionType: 'winols_damos_exported',
        title: `خروجی پکیج کامل کارگاه WinOLS 2.24 (.zip)`,
        summary: `پکیج ${bundle.fileName} شامل فایل DAMOS (.a2l)، جدول CSV، فایل manifest و راهنمای ایمپورت WinOLS 2.24 دانلود شد.`,
        extraDetails: {
          exportFormat: 'WinOLS 2.24 Workshop Bundle (.zip)',
          mapsExported: maps.length,
          fileName: bundle.fileName,
        },
      });
    } finally {
      setExportingZip(false);
    }
  };

  const handleCopyA2l = async () => {
    try {
      await navigator.clipboard.writeText(a2lPreviewBuild.a2lContent);
      setCopiedA2l(true);
      setTimeout(() => setCopiedA2l(false), 2000);
    } catch {
      // Clipboard may be blocked in restricted contexts
    }
  };

  const activeSelectedMap = maps.find((m) => m.id === selectedConfigId) || maps[0] || null;

  return (
    <div className="space-y-4">
      {/* Top Bar: ECU Base Preset + Byte Order + Export Controls */}
      <div className="rounded-lg border border-[#D8D2C5] bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EFECE4] pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-[#1E3A5F]" />
              <h4 className="text-xs sm:text-sm font-extrabold text-[#1A1816]">
                خروجی استاندارد DAMOS / ASAP2 (.a2l) سازگار با WinOLS 2.24
              </h4>
            </div>
            <p className="text-[11px] text-[#57534E] leading-5">
              WinOLS 2.24 فایل‌های <span dir="ltr" className="font-mono font-bold text-[#1E3A5F]">ASAP2 v1.51 (.a2l)</span> را به‌صورت بومی ایمپورت می‌کند و سپس با دو کلیک می‌توانید در خود WinOLS خروجی <span dir="ltr" className="font-mono font-bold">.kp</span> بگیرید.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadA2l}
              disabled={maps.length === 0}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#1E3A5F] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              دانلود DAMOS (.a2l)
            </button>
            <button
              type="button"
              onClick={handleDownloadCsvMapPack}
              disabled={maps.length === 0}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#C8C1B4] bg-white px-3 py-1.5 text-xs font-bold text-[#1A1816] hover:bg-[#FAF9F6] disabled:opacity-50 cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#14532D]" />
              دانلود CSV Map Pack
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadZipBundle()}
              disabled={maps.length === 0 || exportingZip}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#14532D] bg-[#ECFDF5] px-3 py-1.5 text-xs font-bold text-[#14532D] hover:bg-[#DCFCE7] disabled:opacity-50 cursor-pointer"
            >
              {exportingZip ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
              پکیج کامل کارگاه (.zip)
            </button>
          </div>
        </div>

        {/* ECU Working Area Base + Byte Order + Validation Metrics */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-5 space-y-1">
            <label className="block text-[11px] font-bold text-[#44403C]">
              ناحیه کاری پایه ایسیو (Working Area Base)
            </label>
            <select
              aria-label="ناحیه کاری پایه ایسیو"
              value={baseAddressHex}
              onChange={(e) => {
                const nextBase = e.target.value;
                setBaseAddressHex(nextBase);
                const preset = SIEMENS_WORKING_AREA_PRESETS.find((p) => p.baseHex === nextBase);
                if (preset) setByteOrder(preset.defaultByteOrder);
              }}
              className="w-full rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-2 text-xs font-semibold text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
            >
              {SIEMENS_WORKING_AREA_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.baseHex}>
                  {preset.labelFa}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 space-y-1">
            <label className="block text-[11px] font-bold text-[#44403C]">
              ترتیب بایت (Byte Order)
            </label>
            <div className="flex rounded-md border border-[#D6D0C4] bg-[#FAF9F6] p-0.5">
              {(['HiLo', 'LoHi'] as const).map((ord) => (
                <button
                  key={ord}
                  type="button"
                  onClick={() => setByteOrder(ord)}
                  className={`flex-1 rounded py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                    byteOrder === ord
                      ? 'bg-[#1E3A5F] text-white'
                      : 'text-[#57534E] hover:text-[#1A1816]'
                  }`}
                >
                  {ord === 'HiLo' ? 'HiLo (25504)' : 'LoHi (Intel)'}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-4 flex flex-wrap items-center justify-end gap-2 text-[11px] tabular-nums">
            <span className="inline-flex items-center gap-1 rounded border border-[#BBF7D0] bg-[#ECFDF5] px-2.5 py-1.5 font-bold text-[#14532D]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {toPersianDigits(a2lPreviewBuild.validation.readyWithAddressCount)} هگز تاییدشده
            </span>
            {a2lPreviewBuild.validation.placeholderAddressCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded border border-[#FCD34D] bg-[#FFFBEB] px-2.5 py-1.5 font-bold text-[#92400E]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {toPersianDigits(a2lPreviewBuild.validation.placeholderAddressCount)} نیازمند آدرس
              </span>
            )}
          </div>
        </div>

        {statusNotice && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-[#BBF7D0] bg-[#F2FBF5] px-3 py-2 text-[11.5px] font-semibold text-[#14532D]">
            <span>{statusNotice}</span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-[11px] underline cursor-pointer"
            >
              بستن
            </button>
          </div>
        )}
      </div>

      {/* Siemens FCE6 Pointer / Hex Axis Calculator */}
      <div className="rounded-lg border border-[#D8D2C5] bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE4] pb-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-[#1E3A5F]" />
            <div>
              <h5 className="text-xs font-extrabold text-[#1A1816]">
                ماشین‌حساب محوریابی هگزادسیمال زیمنس (الگوریتم FCE6 / FC66)
              </h5>
              <p className="text-[11px] text-[#57534E]">
                محاسبه سریع آدرس نهایی محورها (مثلاً <span dir="ltr" className="font-mono">14000 + FDA = 0x14FDA</span>) و تولید ۴ الگوی جستجوی اشاره‌گر در بافر WinOLS
              </p>
            </div>
          </div>
          {activeSelectedMap && (
            <span className="text-[11px] text-[#57534E]">
              نقشه فعال:{' '}
              <strong dir="ltr" className="font-mono text-[#1E3A5F]">
                {activeSelectedMap.mapCode}
              </strong>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-2 space-y-1">
            <label className="block text-[11px] font-bold text-[#44403C]">پایه (Base Hex)</label>
            <input
              type="text"
              dir="ltr"
              aria-label="پایه هگز ماشین حساب FCE6"
              value={calcBaseInput}
              onChange={(e) => setCalcBaseInput(e.target.value)}
              placeholder="14000"
              className="w-full rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 font-mono text-xs font-bold text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2 space-y-1">
            <label className="block text-[11px] font-bold text-[#44403C]">افست (Offset Hex)</label>
            <input
              type="text"
              dir="ltr"
              aria-label="افست هگز ماشین حساب FCE6"
              value={calcOffsetInput}
              onChange={(e) => setCalcOffsetInput(e.target.value)}
              placeholder="FDA"
              className="w-full rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 font-mono text-xs font-bold text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
            />
          </div>

          <div className="md:col-span-4 rounded-md border border-[#E2DDD3] bg-[#FAF9F6] px-3 py-2 space-y-1">
            {fce6Result.valid ? (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#57534E]">آدرس نهایی (Ctrl+G):</span>
                  <span dir="ltr" className="font-mono text-xs font-extrabold text-[#1E3A5F] tabular-nums">
                    {fce6Result.finalAddressHex}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10.5px]">
                  <span className="text-[#57534E]">الگوهای جستجوی FCE6:</span>
                  <span dir="ltr" className="font-mono font-bold text-[#14532D] tabular-nums">
                    {fce6Result.searchPatterns.join(' · ')}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-[#9A2E1A]">{fce6Result.formulaText}</p>
            )}
          </div>

          <div className="md:col-span-4 flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              disabled={!fce6Result.valid || !selectedConfigId}
              onClick={() => handleApplyCalcToSelected('map')}
              className="rounded-md border border-[#1E3A5F]/40 bg-[#F5F8FC] px-2.5 py-1.5 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#E5EFF9] disabled:opacity-40 cursor-pointer"
            >
              ثبت روی شروع نقشه
            </button>
            <button
              type="button"
              disabled={!fce6Result.valid || !selectedConfigId}
              onClick={() => handleApplyCalcToSelected('axisX')}
              className="rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#44403C] hover:bg-[#FAF9F6] disabled:opacity-40 cursor-pointer"
            >
              محور X
            </button>
            <button
              type="button"
              disabled={!fce6Result.valid || !selectedConfigId}
              onClick={() => handleApplyCalcToSelected('axisY')}
              className="rounded-md border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#44403C] hover:bg-[#FAF9F6] disabled:opacity-40 cursor-pointer"
            >
              محور Y
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Editable DAMOS Map Table */}
      <div className="rounded-lg border border-[#D8D2C5] bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DDD3] bg-[#FAF9F6] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-[#1E3A5F]">
              جدول مشخصات فنی نقشه‌ها برای خروجی A2L (قابل ویرایش مستقیم)
            </span>
            <span className="text-[11px] text-[#57534E] tabular-nums">
              ({toPersianDigits(maps.length)} نقشه)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowA2lPreview((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-[#C8C1B4] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1A1816] hover:bg-[#F3F0E8] cursor-pointer"
            >
              <Code2 className="h-3.5 w-3.5 text-[#1E3A5F]" />
              {showA2lPreview ? 'بستن پیش‌نمایش A2L' : 'پیش‌نمایش کد A2L'}
            </button>
            <button
              type="button"
              onClick={handleAddCustomMap}
              className="inline-flex items-center gap-1 rounded-md border border-[#1E3A5F] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              افزودن نقشه سفارشی
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-[11px]">
            <thead>
              <tr className="bg-[#1E3A5F] text-white">
                <th className="px-2.5 py-2 font-bold">کد نقشه</th>
                <th className="px-2.5 py-2 font-bold">آدرس هگز (Start)</th>
                <th className="px-2.5 py-2 font-bold">ابعاد (C×R)</th>
                <th className="px-2.5 py-2 font-bold">داده</th>
                <th className="px-2.5 py-2 font-bold">Sign</th>
                <th className="px-2.5 py-2 font-bold">Factor</th>
                <th className="px-2.5 py-2 font-bold">Offset</th>
                <th className="px-2.5 py-2 font-bold">محور X هگز</th>
                <th className="px-2.5 py-2 font-bold">محور Y هگز</th>
                <th className="px-2 py-2 font-bold text-center">حذف</th>
              </tr>
            </thead>
            <tbody>
              {maps.map((m, idx) => {
                const isSelected = m.id === selectedConfigId;
                return (
                  <tr
                    key={m.id}
                    onClick={() => setSelectedConfigId(m.id)}
                    className={`border-t border-[#E2DDD3] transition-colors ${
                      isSelected
                        ? 'bg-[#EEF3F8]'
                        : idx % 2 === 1
                          ? 'bg-[#FAF9F6]'
                          : 'bg-white'
                    }`}
                  >
                    <td className="px-2.5 py-1.5">
                      <input
                        type="text"
                        dir="ltr"
                        value={m.mapCode}
                        onChange={(e) => updateMapField(m.id, 'mapCode', e.target.value)}
                        className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] font-bold text-[#1E3A5F] hover:border-[#D6D0C4] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                      />
                      <div dir="rtl" className="truncate max-w-[155px] text-[10px] text-[#57534E] text-right">
                        {m.nameFa}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        dir="ltr"
                        value={m.startAddressHex}
                        onChange={(e) => updateMapField(m.id, 'startAddressHex', e.target.value)}
                        placeholder="0x1A9EE"
                        className={`w-24 rounded border px-1.5 py-1 font-mono text-[11px] font-bold focus:outline-none ${
                          m.addressVerified
                            ? 'border-[#BBF7D0] bg-[#F2FBF5] text-[#14532D]'
                            : 'border-[#FCD34D] bg-[#FFFBEB] text-[#92400E]'
                        }`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div dir="ltr" className="flex items-center gap-1 font-mono">
                        <input
                          type="number"
                          min={1}
                          max={64}
                          value={m.columns}
                          onChange={(e) => updateMapField(m.id, 'columns', Number(e.target.value) || 1)}
                          className="w-11 rounded border border-[#D6D0C4] bg-white px-1 py-0.5 text-center text-[11px]"
                        />
                        <span>×</span>
                        <input
                          type="number"
                          min={1}
                          max={64}
                          value={m.rows}
                          onChange={(e) => updateMapField(m.id, 'rows', Number(e.target.value) || 1)}
                          className="w-11 rounded border border-[#D6D0C4] bg-white px-1 py-0.5 text-center text-[11px]"
                        />
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        dir="ltr"
                        value={m.dataOrg}
                        onChange={(e) => updateMapField(m.id, 'dataOrg', e.target.value as WinolsDataOrg)}
                        className="rounded border border-[#D6D0C4] bg-white px-1.5 py-1 font-mono text-[11px]"
                      >
                        <option value="8bit">8-bit</option>
                        <option value="16bit">16-bit</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={m.signed}
                        onChange={(e) => updateMapField(m.id, 'signed', e.target.checked)}
                        aria-label={`علامت‌دار برای ${m.mapCode}`}
                        className="h-3.5 w-3.5 accent-[#1E3A5F] cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        dir="ltr"
                        value={m.factor}
                        onChange={(e) => updateMapField(m.id, 'factor', Number(e.target.value) || 1)}
                        className="w-24 rounded border border-[#D6D0C4] bg-white px-1.5 py-1 font-mono text-[11px]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        dir="ltr"
                        value={m.offset}
                        onChange={(e) => updateMapField(m.id, 'offset', Number(e.target.value) || 0)}
                        className="w-18 rounded border border-[#D6D0C4] bg-white px-1.5 py-1 font-mono text-[11px]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        dir="ltr"
                        disabled={m.type === 'VALUE'}
                        value={m.axisX?.addressHex || ''}
                        onChange={(e) => updateAxisHex(m.id, 'axisX', e.target.value)}
                        placeholder="0x14FDA"
                        className="w-20 rounded border border-[#D6D0C4] bg-white px-1.5 py-1 font-mono text-[11px] disabled:bg-[#F3F0E8] disabled:text-[#A8A29E]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        dir="ltr"
                        disabled={m.type !== 'MAP'}
                        value={m.axisY?.addressHex || ''}
                        onChange={(e) => updateAxisHex(m.id, 'axisY', e.target.value)}
                        placeholder="0x14078"
                        className="w-20 rounded border border-[#D6D0C4] bg-white px-1.5 py-1 font-mono text-[11px] disabled:bg-[#F3F0E8] disabled:text-[#A8A29E]"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveMap(m.id);
                        }}
                        aria-label={`حذف ${m.mapCode}`}
                        className="p-1 text-[#78716C] hover:text-[#9A2E1A] cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collapsible Live ASAP2 (.a2l) Code Preview */}
      {showA2lPreview && (
        <div className="rounded-lg border border-[#D8D2C5] bg-[#1A1D21] text-[#E6EDF3] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px]">
            <span dir="ltr" className="font-mono font-bold text-[#93C5FD]">
              {a2lPreviewBuild.fileName} (ASAP2_VERSION 1 51)
            </span>
            <button
              type="button"
              onClick={() => void handleCopyA2l()}
              className="inline-flex items-center gap-1 rounded bg-white/10 px-2.5 py-1 font-bold text-white hover:bg-white/20 cursor-pointer"
            >
              {copiedA2l ? <Check className="h-3 w-3 text-[#86EFAC]" /> : <Copy className="h-3 w-3" />}
              {copiedA2l ? 'کپی شد' : 'کپی کد A2L'}
            </button>
          </div>
          <pre
            dir="ltr"
            className="max-h-64 overflow-auto p-3.5 font-mono text-[11px] leading-5 text-[#D1D5DB]"
          >
            {a2lPreviewBuild.a2lContent}
          </pre>
        </div>
      )}

      {/* WinOLS 2.24 Import Instructions & Safety Warnings */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-lg border border-[#D8D2C5] bg-white p-3.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1E3A5F]">
            <Info className="h-4 w-4" />
            راهنمای ۴ مرحله‌ای ایمپورت در WinOLS 2.24 و خروجی گرفتن .kp
          </div>
          <ol className="list-decimal pr-4 space-y-1 text-[11.5px] leading-5 text-[#292524]">
            <li>
              دامپ اورجینال (<span dir="ltr" className="font-mono">.bin</span>) را در WinOLS 2.24 باز کنید (در بردهای فلش‌دار <span dir="ltr" className="font-mono">Line Swapping = Yes</span>؛ در بردهای No-Flash مبنای <span dir="ltr" className="font-mono">0x68000</span> بدون Line Swapping).
            </li>
            <li>
              از منوی بالا مسیر <strong dir="ltr" className="font-mono text-[#1E3A5F]">Project → Ex- &amp; Import → Import DAMOS / A2L</strong> را انتخاب و فایل <span dir="ltr" className="font-mono">.a2l</span> دانلودشده را وارد کنید.
            </li>
            <li>
              آدرس‌ها، فاکتورها و محورها به‌صورت خودکار در پنجره <strong>My Maps</strong> چیده می‌شوند.
            </li>
            <li>
              برای ذخیره به فرمت اختصاصی Map Pack (<span dir="ltr" className="font-mono">.kp</span>)، در خود WinOLS 2.24 مسیر <strong dir="ltr" className="font-mono text-[#1E3A5F]">Project → Ex- &amp; Import → Export Map Pack</strong> را اجرا کنید.
            </li>
          </ol>
        </div>

        <div className="lg:col-span-5 rounded-lg border border-[#E8C5B8] bg-[#FFF8F6] p-3.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#9A3412]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            هشدارهای ممیزی داموس و چک‌سام
          </div>
          <ul className="space-y-1 text-[11.5px] leading-5 text-[#431407] list-disc pr-4">
            {a2lPreviewBuild.validation.warningsFa.length > 0 ? (
              a2lPreviewBuild.validation.warningsFa.map((w, i) => <li key={i}>{w}</li>)
            ) : (
              <li>تمام نقشه‌ها دارای آدرس هگز تاییدشده هستند و برای ایمپورت در WinOLS 2.24 آماده‌اند.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};
