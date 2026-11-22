import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Globe,
  Grid2x2,
  Loader2,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';
import type { AuditReportDto, OutlineNodeDto, ParsedBook } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';
import {
  analyzeWinolsGoogleEnrichment,
  buildWinolsGuideCsv,
  WinolsExtractionReport,
  WinolsGoogleCoverageSummary,
  WinolsMapActionEntry,
} from '../lib/winolsMapGuide';
import { WinolsRpmLoadScatterPlot } from './WinolsRpmLoadScatterPlot';

interface WinolsMapWorkbenchProps {
  report: WinolsExtractionReport;
  auditReport?: AuditReportDto | null;
  book?: ParsedBook | null;
  outlineNodes?: OutlineNodeDto[];
  enrichingGoogle?: boolean;
  onEnrichAllWithGoogle?: () => Promise<void> | void;
  onClose?: () => void;
  onJumpToWinolsAppendix?: () => void;
  hasWinolsAppendixChapter?: boolean;
}

export const WinolsMapWorkbench: React.FC<WinolsMapWorkbenchProps> = ({
  report,
  auditReport,
  book,
  outlineNodes,
  enrichingGoogle = false,
  onEnrichAllWithGoogle,
  onClose,
  onJumpToWinolsAppendix,
  hasWinolsAppendixChapter = false,
}) => {
  const [selectedMapId, setSelectedMapId] = useState<string>(report.entries[0]?.id ?? '');
  const [copiedTable, setCopiedTable] = useState(false);

  const activeEntry: WinolsMapActionEntry | null = useMemo(() => {
    if (report.entries.length === 0) return null;
    return report.entries.find((e) => e.id === selectedMapId) || report.entries[0];
  }, [report.entries, selectedMapId]);

  const googleCoverage: WinolsGoogleCoverageSummary = useMemo(() => {
    const saved = (
      auditReport?.detailsJson as Record<string, unknown> | undefined
    )?.winolsGoogleCoverage as WinolsGoogleCoverageSummary | undefined;

    const savedCoversAll =
      saved &&
      saved.byMapId &&
      typeof saved.byMapId === 'object' &&
      report.entries.every((entry) => Boolean(saved.byMapId[entry.id]));

    if (savedCoversAll) {
      return saved;
    }

    return analyzeWinolsGoogleEnrichment({
      entries: report.entries,
      book,
      outlineNodes,
    });
  }, [auditReport?.detailsJson, report.entries, book, outlineNodes]);

  const activeCoverage = activeEntry ? googleCoverage.byMapId[activeEntry.id] ?? null : null;

  const handleDownloadCsv = () => {
    if (report.entries.length === 0) return;
    const csv = buildWinolsGuideCsv(report.entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'winols-map-guide.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdownTable = async () => {
    if (!report.summaryTable) return;
    const headerRow = `| ${report.summaryTable.headers.join(' | ')} |`;
    const sepRow = `| ${report.summaryTable.headers.map(() => '---').join(' | ')} |`;
    const bodyRows = report.summaryTable.rows.map((r) => `| ${r.join(' | ')} |`);
    const md = [headerRow, sepRow, ...bodyRows].join('\n');
    try {
      await navigator.clipboard.writeText(md);
      setCopiedTable(true);
      setTimeout(() => setCopiedTable(false), 2200);
    } catch {
      // Clipboard may be blocked in restricted iframe contexts
    }
  };

  if (report.mapsDetected === 0 || !activeEntry) {
    return (
      <section
        aria-label="میز کار راهنمای نقشه‌های WinOLS"
        className="border-b border-[#E2DDD3] bg-[#FBF9F4] px-4 py-4 sm:px-6"
      >
        <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Cpu className="h-4 w-4 text-[#1E3A5F]" />
            <div>
              <h3 className="text-xs font-extrabold text-[#1A1816]">
                میز کار راهنمای تغییرات WinOLS
              </h3>
              <p className="text-[11px] text-[#57534E]">
                در متن فایل‌های فعلی پروژه، نام نقشه استاندارد WinOLS (مانند KFZW، LAMFA، KFMIRL، LDRXN یا NMAX) یافت نشد.
              </p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن میز کار WinOLS"
              className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-[#D6D0C4] bg-white px-2.5 text-xs font-bold text-[#44403C] hover:bg-[#F3F0E8] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              بستن
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="میز کار راهنمای نقشه‌های WinOLS"
      className="border-b border-[#D8D2C5] bg-[#F8F6F1] px-4 py-4 sm:px-6 max-h-[68vh] overflow-y-auto"
    >
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Header & Export Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2DDD3] pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#1E3A5F] text-white">
              <Grid2x2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-[#1A1816]">
                میز کار نقشه WinOLS و راهنمای انتخاب سلول‌ها
              </h3>
              <p className="text-[11px] text-[#57534E] tabular-nums">
                {toPersianDigits(report.mapsDetected)} نقشه کالیبراسیون به‌صورت قطعی از جزوه‌ها استخراج شد · بدون تغییر یا حدس اعداد فنی
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasWinolsAppendixChapter && onJumpToWinolsAppendix && (
              <button
                type="button"
                onClick={onJumpToWinolsAppendix}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-[#1E3A5F]/30 bg-white px-2.5 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                مشاهده پیوست جدول در کتاب
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyMarkdownTable}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-[#C8C1B4] bg-white px-2.5 text-[11px] font-bold text-[#1A1816] hover:bg-[#FAF9F6] cursor-pointer"
            >
              {copiedTable ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#14532D]" />
                  کپی شد
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-[#57534E]" />
                  کپی جدول WinOLS
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-[#1E3A5F] bg-[#1E3A5F] px-3 text-[11px] font-bold text-white hover:bg-[#162C49] cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              دانلود CSV جدول
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="بستن میز کار WinOLS"
                className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-[#C8C1B4] bg-white px-2.5 text-[11px] font-bold text-[#44403C] hover:bg-[#EFECE4] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                بستن
              </button>
            )}
          </div>
        </div>

        {/* Map Selector Tabs with Google Enrichment Indicator */}
        <div
          role="tablist"
          aria-label="انتخاب نقشه WinOLS"
          className="flex flex-wrap gap-2"
        >
          {report.entries.map((entry) => {
            const selected = entry.id === activeEntry.id;
            const cov = googleCoverage.byMapId[entry.id];
            const isGoogleEnriched = Boolean(cov?.hasGoogleEnrichment);
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedMapId(entry.id)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-right transition-colors cursor-pointer ${
                  selected
                    ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                    : 'border-[#D6D0C4] bg-white text-[#1A1816] hover:bg-[#FAF9F6]'
                }`}
              >
                <span
                  dir="ltr"
                  className="font-mono text-xs font-extrabold tracking-tight"
                >
                  {entry.mapCode}
                </span>
                <span
                  className={`text-[11px] font-medium ${
                    selected ? 'text-[#DCE6F2]' : 'text-[#57534E]'
                  }`}
                >
                  {entry.categoryLabelFa}
                </span>
                {entry.hexAddresses[0] && (
                  <span
                    dir="ltr"
                    className={`font-mono text-[10px] tabular-nums ${
                      selected ? 'text-[#BFDBFE]' : 'text-[#1E3A5F]'
                    }`}
                  >
                    {entry.hexAddresses[0]}
                  </span>
                )}
                {isGoogleEnriched ? (
                  <span
                    title="دارای توضیحات تکمیل‌شده با جستجوی گوگل در فایل ورد نهایی"
                    className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${
                      selected
                        ? 'bg-[#14532D] text-[#DCFCE7]'
                        : 'bg-[#DCFCE7] text-[#14532D] border border-[#BBF7D0]'
                    }`}
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    تکمیل گوگل
                  </span>
                ) : (
                  <span
                    title="فقط برگرفته از فایل‌های ورودی (بدون توضیح گوگل)"
                    className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
                      selected
                        ? 'bg-white/15 text-[#DCE6F2]'
                        : 'bg-[#F3F0E8] text-[#78716C]'
                    }`}
                  >
                    منبع فایل
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* D3 RPM × Load Scatter Plot & Google Search Enrichment Coverage Overview */}
        <div className="rounded-lg border border-[#D8D2C5] bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE4] pb-2.5">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-[#15803D]" />
              <div>
                <h4 className="text-xs font-extrabold text-[#1A1816]">
                  نمودار پراکندگی RPM / بار (D3) و وضعیت تکمیل نقشه‌ها با جستجوی گوگل در فایل ورد نهایی
                </h4>
                <p className="text-[11px] text-[#57534E]">
                  مقایسه موقعیت کاری هر نقشه (محور X: دور موتور RPM · محور Y: بار موتور) به تفکیک نقشه‌های دارای توضیحات تکمیل‌شده با گوگل
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] tabular-nums">
              <span className="inline-flex items-center gap-1 rounded-md border border-[#BBF7D0] bg-[#ECFDF5] px-2.5 py-1 font-bold text-[#14532D]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {toPersianDigits(googleCoverage.enrichedCount)} از {toPersianDigits(googleCoverage.totalMaps)} نقشه ({toPersianDigits(googleCoverage.coveragePercent)}٪) تکمیل‌شده با گوگل
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
            {/* D3 Scatter Plot (7 cols) */}
            <div className="lg:col-span-7">
              <WinolsRpmLoadScatterPlot
                entries={report.entries}
                coverageByMapId={googleCoverage.byMapId}
                selectedMapId={activeEntry.id}
                onSelectMap={setSelectedMapId}
              />
            </div>

            {/* Selected Map Google Coverage & Quick Action (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-2.5">
              {/* Coverage Bar */}
              <div className="rounded-md border border-[#E2DDD3] bg-[#FAF9F6] p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-[#1A1816]">پوشش تکمیل با جستجوی گوگل</span>
                  <span className="font-extrabold text-[#14532D] tabular-nums">
                    {toPersianDigits(googleCoverage.coveragePercent)}٪
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#E5E0D6]">
                  <div
                    className="h-full rounded-full bg-[#15803D] transition-all duration-300"
                    style={{ width: `${googleCoverage.coveragePercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10.5px] text-[#57534E] tabular-nums">
                  <span>تکمیل‌شده با گوگل: {toPersianDigits(googleCoverage.enrichedCount)} نقشه</span>
                  <span>فقط فایل ورودی: {toPersianDigits(googleCoverage.localOnlyCount)} نقشه</span>
                </div>
              </div>

              {/* Active Map Google Enrichment Detail Card */}
              {activeCoverage && (
                <div
                  className={`rounded-md border p-3 space-y-2 text-[11.5px] ${
                    activeCoverage.hasGoogleEnrichment
                      ? 'border-[#BBF7D0] bg-[#F2FBF5]'
                      : 'border-[#E2DDD3] bg-[#FAF9F6]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-extrabold">
                      <span dir="ltr" className="font-mono text-[#1E3A5F]">
                        {activeEntry.mapCode}
                      </span>
                      <span className="text-[#44403C]">— وضعیت در ورد نهایی:</span>
                    </div>
                    {activeCoverage.hasGoogleEnrichment ? (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-[#15803D] px-2 py-0.5 text-[10px] font-bold text-white">
                        <CheckCircle2 className="h-3 w-3" />
                        تکمیل‌شده با جستجوی گوگل
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-sm bg-[#E5E0D6] px-2 py-0.5 text-[10px] font-bold text-[#44403C]">
                        بدون توضیح گوگل
                      </span>
                    )}
                  </div>

                  {activeCoverage.hasGoogleEnrichment ? (
                    <div className="space-y-2">
                      <div className="text-[10.5px] font-semibold text-[#14532D] tabular-nums">
                        {activeCoverage.matchReason === 'direct_map_mention'
                          ? 'تطبیق مستقیم نام/آدرس نقشه در کادر جستجوی گوگل'
                          : 'پوشش سطح فصل در کادر جستجوی گوگل'}
                        {activeCoverage.matchedChapterNumbers.length > 0 &&
                          ` · فصل ${activeCoverage.matchedChapterNumbers.map(toPersianDigits).join('، ')}`}
                      </div>
                      {activeCoverage.summaryExcerpt && (
                        <p className="leading-5 text-[#1A1816] text-[11px]">
                          {activeCoverage.summaryExcerpt}
                        </p>
                      )}
                      {activeCoverage.webSources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {activeCoverage.webSources.slice(0, 3).map((src, idx) => (
                            <a
                              key={idx}
                              href={src.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-[#BBF7D0] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#14532D] hover:bg-[#DCFCE7] max-w-full truncate"
                            >
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{src.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] leading-5 text-[#57534E]">
                        برای نقشه <strong dir="ltr" className="font-mono text-[#1A1816]">{activeEntry.mapCode}</strong> هنوز توضیحات «تکمیل‌شده با جستجوی گوگل» در فایل ورد نهایی ثبت نشده و فعلاً صرفاً بر اساس متن جزوه‌های ورودی ارائه می‌شود.
                      </p>
                      {onEnrichAllWithGoogle && (
                        <button
                          type="button"
                          disabled={enrichingGoogle}
                          onClick={() => void onEnrichAllWithGoogle()}
                          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-[#15803D] bg-[#15803D] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#166534] disabled:opacity-50 cursor-pointer"
                        >
                          {enrichingGoogle ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Globe className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {enrichingGoogle
                              ? 'در حال تکمیل با جستجوی گوگل...'
                              : 'تکمیل فصل‌ها با جستجوی گوگل'}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Active Map Split View: Left/Right = 2D Cell-Zone Matrix + Action Checklist */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 2D WinOLS Cell-Zone Visualizer (7 cols) */}
          <div className="lg:col-span-7 rounded-lg border border-[#D8D2C5] bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#EFECE4] pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span dir="ltr" className="font-mono text-sm font-extrabold text-[#1E3A5F]">
                    {activeEntry.mapCode}
                  </span>
                  <span className="text-xs font-bold text-[#1A1816]">
                    {activeEntry.mapNameFa}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#57534E] tabular-nums">
                  <span>
                    ایسیو:{' '}
                    <strong dir="ltr" className="font-mono text-[#1A1816]">
                      {activeEntry.ecuModels.length > 0 ? activeEntry.ecuModels.join(', ') : 'عمومی / مطابق دامپ'}
                    </strong>
                  </span>
                  <span>
                    آدرس هگز:{' '}
                    <strong dir="ltr" className="font-mono text-[#1E3A5F]">
                      {activeEntry.hexAddresses.length > 0 ? activeEntry.hexAddresses.join(', ') : 'جستجو با Damos'}
                    </strong>
                  </span>
                  <span>
                    ابعاد:{' '}
                    <strong dir="ltr" className="font-mono text-[#1A1816]">
                      {activeEntry.dimensions}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="text-left">
                <div className="text-[10px] font-semibold text-[#78716C]">تغییر پیشنهادی</div>
                <div
                  dir="ltr"
                  className="font-mono text-sm font-extrabold text-[#14532D] tabular-nums"
                >
                  {activeEntry.recommendedDeltaLabel}
                </div>
              </div>
            </div>

            {activeEntry.zoneMatrix ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-[#1A1816]">
                    نمای شماتیک ناحیه اصلاح سلول‌ها در جدول WinOLS (محور RPM × بار موتور)
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-[#57534E]">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 border border-[#14532D]/40 bg-[#DCFCE7]" />
                      ناحیه هدف تغییر
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 border border-[#B45309]/40 bg-[#FEF3C7]" />
                      شیب نرم (Interpolate)
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 border border-[#D6D0C4] bg-[#FAF9F6]" />
                      استوک (دست‌نخورده)
                    </span>
                  </div>
                </div>

                <div dir="ltr" className="overflow-x-auto border border-[#D8D2C5] rounded-md">
                  <table className="w-full border-collapse text-center font-mono text-[11px] tabular-nums">
                    <thead>
                      <tr className="bg-[#1E3A5F] text-white">
                        <th className="border-r border-[#2F527F] px-2 py-1.5 text-left font-bold">
                          Load \ RPM
                        </th>
                        {activeEntry.zoneMatrix.rpmAxis.map((rpm) => (
                          <th
                            key={rpm}
                            className="border-r border-[#2F527F] px-2 py-1.5 font-bold last:border-r-0"
                          >
                            {rpm}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeEntry.zoneMatrix.cells.map((row, rIdx) => {
                        const loadPct = activeEntry.zoneMatrix!.loadAxis[rIdx];
                        return (
                          <tr key={loadPct} className="border-t border-[#E2DDD3]">
                            <th className="border-r border-[#E2DDD3] bg-[#F3F0E8] px-2 py-1.5 text-left font-bold text-[#1E3A5F]">
                              {loadPct}%
                            </th>
                            {row.map((cell) => {
                              const cellClass =
                                cell.zone === 'modify'
                                  ? 'bg-[#DCFCE7] text-[#14532D] font-extrabold'
                                  : cell.zone === 'ramp'
                                    ? 'bg-[#FEF3C7] text-[#92400E] font-semibold'
                                    : 'bg-[#FAF9F6] text-[#8C857B]';
                              return (
                                <td
                                  key={`${cell.loadPercent}_${cell.rpm}`}
                                  title={`Load ${cell.loadPercent}% | ${cell.rpm} RPM -> ${cell.deltaLabel}`}
                                  className={`border-r border-[#E2DDD3] px-2 py-1.5 last:border-r-0 ${cellClass}`}
                                >
                                  {cell.deltaLabel}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="rounded-md border border-[#E2DDD3] bg-[#FAF9F6] px-3 py-2 text-[11.5px] leading-6 text-[#292524]">
                  {activeEntry.zoneMatrix.selectionInstructionFa}
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-[#D8D2C5] bg-[#FAF9F6] p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[#1E3A5F]">
                  <Sliders className="h-4 w-4" />
                  نقشه تک‌مقداری (Single Value / 1x1 Scalar)
                </div>
                <p className="text-xs leading-6 text-[#292524]">
                  این پارامتر یک عدد منفرد (Scalar) در دامپ ایسیو است و محور ۲بعدی RPM × Load ندارد.
                  کافی است در WinOLS مقدار آن را مطابق فایل‌های مرجع اصلاح کنید.
                </p>
                {activeEntry.numericValuesDetected.length > 0 && (
                  <div className="pt-1 text-xs text-[#1A1816]">
                    مقادیر استخراج‌شده از جزوه‌ها:{' '}
                    <strong dir="ltr" className="font-mono text-[#14532D]">
                      {activeEntry.numericValuesDetected.join('  →  ')}
                    </strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step-by-Step WinOLS Instructions + Safety Checklist (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="rounded-lg border border-[#D8D2C5] bg-white p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1E3A5F]">
                <ShieldCheck className="h-4 w-4" />
                گام‌به‌گام اعمال تغییر در WinOLS
              </div>
              <ol className="space-y-1.5 pr-4 list-decimal text-[12px] leading-6 text-[#292524]">
                {activeEntry.winolsStepsFa.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>

            <div className="rounded-lg border border-[#E8C5B8] bg-[#FFF8F6] p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#9A3412]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                چک‌لیست ایمنی موتور پیش از تست جاده
              </div>
              <p className="text-[12px] leading-6 text-[#431407]">
                {activeEntry.safetyChecklistFa}
              </p>
            </div>

            {activeEntry.evidenceSnippets.length > 0 && (
              <div className="rounded-lg border border-[#E2DDD3] bg-white p-3.5 space-y-1.5">
                <div className="text-[11px] font-bold text-[#57534E]">
                  متن مرجع استخراج‌شده ({activeEntry.sourceFiles.join('، ')})
                </div>
                <ul className="space-y-1 text-[11px] leading-5 text-[#44403C]">
                  {activeEntry.evidenceSnippets.map((snip, i) => (
                    <li key={i} className="border-t border-[#F3F0E8] pt-1 first:border-t-0 first:pt-0">
                      {snip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Full Export-Ready WinOLS Action Summary Table */}
        {report.summaryTable && (
          <div className="rounded-lg border border-[#D8D2C5] bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E2DDD3] bg-[#FAF9F6] px-4 py-2">
              <span className="text-xs font-extrabold text-[#1E3A5F]">
                جدول جمع‌بندی خودکار تغییرات WinOLS (درج خودکار در فایل ورد نهایی)
              </span>
              <span className="text-[11px] text-[#57534E] tabular-nums">
                {toPersianDigits(report.summaryTable.rows.length)} ردیف آماده چاپ
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-[11.5px]">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    {report.summaryTable.headers.map((h, i) => (
                      <th
                        key={i}
                        className="border-l border-[#2F527F] px-3 py-2 font-bold"
                      >
                        {h}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      تکمیل با گوگل (ورد)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.summaryTable.rows.map((row, rIdx) => {
                    const rowEntry = report.entries[rIdx];
                    const isActive = rowEntry?.id === activeEntry.id;
                    const rowCov = rowEntry ? googleCoverage.byMapId[rowEntry.id] : null;
                    return (
                      <tr
                        key={rIdx}
                        onClick={() => rowEntry && setSelectedMapId(rowEntry.id)}
                        className={`border-t border-[#E2DDD3] cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-[#EEF3F8]'
                            : rIdx % 2 === 1
                              ? 'bg-[#FAF9F6] hover:bg-[#F3F0E8]'
                              : 'bg-white hover:bg-[#F3F0E8]'
                        }`}
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="border-l border-[#E2DDD3] px-3 py-2 leading-5 text-[#292524]"
                          >
                            {cell}
                          </td>
                        ))}
                        <td className="px-3 py-2 whitespace-nowrap">
                          {rowCov?.hasGoogleEnrichment ? (
                            <span className="inline-flex items-center gap-1 rounded-sm bg-[#DCFCE7] border border-[#BBF7D0] px-2 py-0.5 text-[10.5px] font-bold text-[#14532D]">
                              <CheckCircle2 className="h-3 w-3 shrink-0" />
                              تکمیل‌شده با گوگل
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-sm bg-[#F3F0E8] px-2 py-0.5 text-[10.5px] font-semibold text-[#78716C]">
                              فقط منبع فایل
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
