import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileCheck2,
  Globe,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  AuditReportDto,
  ConflictDto,
  DedupClusterDto,
} from '../lib/bookTypes';
import type { TechnicalIntegrityAuditReport } from '../lib/ecuTechnicalIntegrity';
import type { NumericDiscrepancyReport } from '../lib/numericDiscrepancyAnalyzer';
import { toPersianDigits } from '../lib/formatParsers';
import { NumericDiscrepancyAnalyzer } from './NumericDiscrepancyAnalyzer';

interface AuditConflictsViewProps {
  auditReport: AuditReportDto | null;
  clusters: DedupClusterDto[];
  conflicts: ConflictDto[];
  groundingConflictId: string | null;
  resolvingConflictId: string | null;
  rescanningConflicts?: boolean;
  hasIngestedFiles?: boolean;
  hasDedupResults?: boolean;
  hasOutline?: boolean;
  runningDedup?: boolean;
  onRunDedup?: () => Promise<void>;
  onProceedToOutline?: () => void;
  onRescanConflicts?: () => Promise<void>;
  onCheckConflictWithGoogle: (conflictId: string) => Promise<void>;
  onResolveConflict: (
    conflictId: string,
    status: 'keep_both' | 'choose_a' | 'choose_b' | 'resolved_web',
    note: string
  ) => Promise<void>;
}

const STATUS_LABELS: Record<ConflictDto['status'], { label: string; cls: string }> = {
  open: { label: 'در انتظار تصمیم', cls: 'bg-[#FDF2F0] text-[#9A3412] border-[#E6BFB7]' },
  keep_both: { label: 'حفظ هر دو روایت', cls: 'bg-[#EEF3F8] text-[#1E3A5F] border-[#C6D5E6]' },
  choose_a: { label: 'اولویت با روایت ۱', cls: 'bg-[#EEF6F0] text-[#14532D] border-[#C7DDD0]' },
  choose_b: { label: 'اولویت با روایت ۲', cls: 'bg-[#EEF6F0] text-[#14532D] border-[#C7DDD0]' },
  resolved_web: { label: 'تأییدشده با جستجوی گوگل', cls: 'bg-[#F7F4FA] text-[#5B21B6] border-[#D7CBE6]' },
};

export const AuditConflictsView: React.FC<AuditConflictsViewProps> = ({
  auditReport,
  clusters,
  conflicts,
  groundingConflictId,
  resolvingConflictId,
  rescanningConflicts = false,
  hasIngestedFiles = true,
  hasDedupResults = true,
  hasOutline = false,
  runningDedup = false,
  onRunDedup,
  onProceedToOutline,
  onRescanConflicts,
  onCheckConflictWithGoogle,
  onResolveConflict,
}) => {
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  const perFileCoverage =
    (auditReport?.detailsJson?.perFileCoverage as
      | Array<{
          fileId: string;
          fileName: string;
          role: string;
          totalUnits: number;
          coveredUnits: number;
          coveragePercent: number;
        }>
      | undefined) || [];

  const technicalIntegrity = auditReport?.detailsJson?.technicalIntegrity as
    | TechnicalIntegrityAuditReport
    | undefined;

  const numericDiscrepancyReport = auditReport?.detailsJson?.numericDiscrepancyReport as
    | NumericDiscrepancyReport
    | undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 space-y-8">
      {/* Header & KPI Strip */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2.5 text-[#14532D]">
            <ShieldCheck className="h-6 w-6 shrink-0" />
            <div>
              <p className="text-[11px] font-bold text-[#1E3A5F]">
                مرحله ۲ از ۵ · ادغام بدون افت و بررسی تناقض‌ها
              </p>
              <h2 className="text-lg sm:text-xl font-extrabold text-[#1A1816]">
                داشبورد ممیزی پوشش ۱۰۰٪ و مدیریت تناقض‌ها
              </h2>
              <p className="text-xs text-[#57534E]">
                گزارش مستند حفظ تمام نکات یکتا از فایل‌های ورودی، ادغام تکراری‌ها و مقایسه روایت‌های متناقض
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasIngestedFiles && onRunDedup && (
              <button
                type="button"
                disabled={runningDedup}
                onClick={() => void onRunDedup()}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold cursor-pointer disabled:opacity-60 ${
                  !hasDedupResults
                    ? 'bg-[#1E3A5F] text-white hover:bg-[#162C49]'
                    : 'border border-[#C6D5E6] bg-[#EEF3F8] text-[#1E3A5F] hover:bg-[#DFEAF5]'
                }`}
              >
                {runningDedup ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span>
                  {runningDedup
                    ? 'در حال ادغام و کشف تناقض...'
                    : hasDedupResults
                      ? 'اجرای مجدد ادغام و ممیزی'
                      : 'اجرای مرحله ۲: ادغام و کشف تناقض'}
                </span>
              </button>
            )}

            {hasOutline && onProceedToOutline && (
              <button
                type="button"
                onClick={onProceedToOutline}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-4 py-2 text-xs font-bold text-white hover:bg-[#162C49] cursor-pointer shadow-xs"
              >
                <span>ادامه به مرحله ۳: چیدمان فصل‌ها</span>
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {hasIngestedFiles && !hasDedupResults && (
          <div className="rounded-xl border border-[#C6D5E6] bg-[#EEF3F8] p-5 text-xs text-[#1E3A5F] leading-6">
            فایل‌های مرحله ۱ استخراج شده‌اند، اما هنوز ادغام بدون افت و بررسی تناقض اجرا نشده است. دکمه <strong>«اجرای مرحله ۲: ادغام و کشف تناقض»</strong> را بزنید تا فقط همین مرحله اجرا شود و نتایج را بررسی کنید.
          </div>
        )}

        {auditReport && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-[#C7DDD0] bg-[#F2F7F4] p-4">
              <div className="text-xs font-medium text-[#14532D]">نرخ پوشش دانش یکتا</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#14532D]">
                {toPersianDigits(auditReport.coveragePercent)}٪
              </div>
              <div className="mt-0.5 text-[11px] text-[#3F6B50]">
                {toPersianDigits(auditReport.uniqueUnitsPreserved)} از{' '}
                {toPersianDigits(auditReport.totalInputUnits)} واحد ورودی
              </div>
            </div>

            <div className="rounded-xl border border-[#E2DDD3] bg-white p-4">
              <div className="text-xs font-medium text-[#57534E]">فایل‌های منبع تحلیل‌شده</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#1E3A5F]">
                {toPersianDigits(auditReport.totalSourceFiles)}
              </div>
              <div className="mt-0.5 text-[11px] text-[#78716C]">ردیابی کامل منبع هر بلوک</div>
            </div>

            <div className="rounded-xl border border-[#E2DDD3] bg-white p-4">
              <div className="text-xs font-medium text-[#57534E]">تکراری‌های ادغام‌شده (بدون افت)</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#1E3A5F]">
                {toPersianDigits(auditReport.duplicatesMerged)}
              </div>
              <div className="mt-0.5 text-[11px] text-[#78716C]">
                در {toPersianDigits(clusters.length)} خوشه ادغام
              </div>
            </div>

            <div className="rounded-xl border border-[#E6BFB7] bg-[#FDF2F0] p-4">
              <div className="text-xs font-medium text-[#9A3412]">تناقض‌های کشف‌شده</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#9A3412]">
                {toPersianDigits(conflicts.length)}
              </div>
              <div className="mt-0.5 text-[11px] text-[#9A3412]">
                {toPersianDigits(conflicts.filter((c) => c.status !== 'open').length)} مورد تعیین‌تکلیف‌شده
              </div>
            </div>
          </div>
        )}

        {/* Deterministic Technical Entity Integrity Gate (0% AI) */}
        {technicalIntegrity && technicalIntegrity.totalEntitiesInSources > 0 && (() => {
          const passed = technicalIntegrity.missingEntities.length === 0;
          const allSamples = [
            ...(technicalIntegrity.samples?.hexAddresses || []),
            ...(technicalIntegrity.samples?.dtcCodes || []),
            ...(technicalIntegrity.samples?.ecuModels || []),
            ...(technicalIntegrity.samples?.mapIdentifiers || []),
          ].slice(0, 14);
          return (
            <div
              data-testid="ecu-technical-integrity-card"
              className={`rounded-xl border p-4 sm:p-5 space-y-4 ${
                passed ? 'border-[#C7DDD0] bg-white' : 'border-[#E6BFB7] bg-[#FDF2F0]'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EFECE4] pb-3">
                <div className="flex items-start gap-2.5">
                  <Cpu
                    className={`mt-0.5 h-5 w-5 shrink-0 ${
                      passed ? 'text-[#1E3A5F]' : 'text-[#9A3412]'
                    }`}
                  />
                  <div>
                    <h3 className="text-sm font-extrabold text-[#1A1816]">
                      ممیزی قطعی ضدتوهم کدهای فنی و مهندسی (۰٪ هوش مصنوعی)
                    </h3>
                    <p className="text-xs text-[#57534E] mt-0.5">
                      تطبیق خودکار و دقیق تمام آدرس‌های هگز، کدهای خطای OBD-II، مدل‌های ECU و نام مپ‌های کالیبراسیون میان فایل‌های ورودی و خروجی نهایی
                    </p>
                  </div>
                </div>
                <div className="text-left">
                  <div
                    className={`text-lg font-extrabold tabular-nums ${
                      passed ? 'text-[#14532D]' : 'text-[#9A3412]'
                    }`}
                  >
                    {toPersianDigits(technicalIntegrity.retentionPercent)}٪ حفظ کامل
                  </div>
                  <div className="text-[11px] text-[#57534E] tabular-nums">
                    {toPersianDigits(technicalIntegrity.preservedEntitiesCount)} از{' '}
                    {toPersianDigits(technicalIntegrity.totalEntitiesInSources)} شناسه فنی
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 divide-x divide-x-reverse divide-[#EFECE4]">
                <div className="pr-0 sm:pr-2 first:pr-0">
                  <div className="text-[11px] font-semibold text-[#57534E]">آدرس‌های هگز (Hex)</div>
                  <div className="mt-1 text-lg font-extrabold tabular-nums text-[#1E3A5F]">
                    {toPersianDigits(technicalIntegrity.counts.hexAddresses)}
                  </div>
                </div>
                <div className="pr-3">
                  <div className="text-[11px] font-semibold text-[#57534E]">کدهای خطا (DTC)</div>
                  <div className="mt-1 text-lg font-extrabold tabular-nums text-[#1E3A5F]">
                    {toPersianDigits(technicalIntegrity.counts.dtcCodes)}
                  </div>
                </div>
                <div className="pr-3">
                  <div className="text-[11px] font-semibold text-[#57534E]">مدل‌های ایسیو (ECU)</div>
                  <div className="mt-1 text-lg font-extrabold tabular-nums text-[#1E3A5F]">
                    {toPersianDigits(technicalIntegrity.counts.ecuModels)}
                  </div>
                </div>
                <div className="pr-3">
                  <div className="text-[11px] font-semibold text-[#57534E]">نام مپ‌ها (WinOLS)</div>
                  <div className="mt-1 text-lg font-extrabold tabular-nums text-[#1E3A5F]">
                    {toPersianDigits(technicalIntegrity.counts.mapIdentifiers)}
                  </div>
                </div>
              </div>

              {allSamples.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                  <span className="font-semibold text-[#57534E] ml-1">شناسه‌های راستی‌آزمایی‌شده:</span>
                  {allSamples.map((val) => (
                    <code
                      key={val}
                      dir="ltr"
                      className="rounded border border-[#E2DDD3] bg-[#FAF9F6] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#1E3A5F]"
                    >
                      {val}
                    </code>
                  ))}
                </div>
              )}

              {technicalIntegrity.missingEntities.length > 0 && (
                <div className="rounded-lg border border-[#E6BFB7] bg-white p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#9A3412]">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      هشدار امنیتی: {toPersianDigits(technicalIntegrity.missingEntities.length)} شناسه فنی در خروجی نهایی یافت نشد:
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5" dir="ltr">
                    {technicalIntegrity.missingEntities.map((val) => (
                      <code
                        key={`missing-${val}`}
                        className="rounded border border-[#E6BFB7] bg-[#FDF2F0] px-2 py-0.5 font-mono text-[11px] font-bold text-[#9A3412]"
                      >
                        {val}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Deterministic Numeric Discrepancy & Statistical Comparison Module (Tables & Charts) */}
      <NumericDiscrepancyAnalyzer report={numericDiscrepancyReport} />

      {/* Conflicts Section */}
      <section className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#E2DDD3] pb-2.5">
          <div className="flex items-center gap-2 text-sm font-bold text-[#1A1816]">
            <AlertTriangle className="h-4 w-4 text-[#9A3412]" />
            <span>جدول تناقض‌های واقعی میان فایل‌ها (حفظ هر دو روایت)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs text-[#78716C]">
              هیچ روایتی بدون تصمیم شما حذف نمی‌شود
            </span>
            {onRescanConflicts && (
              <button
                type="button"
                disabled={rescanningConflicts}
                onClick={() => void onRescanConflicts()}
                title="پالایش مجدد با الگوریتم دقیق ضدخطا و تأیید معنایی برای حذف موارد مکمل و حفظ تنها تناقض‌های واقعی"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#C6D5E6] bg-[#EEF3F8] px-3 py-1 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFEAF5] disabled:opacity-50 cursor-pointer"
              >
                {rescanningConflicts ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>
                  {rescanningConflicts ? 'در حال پالایش دقیق...' : 'پالایش مجدد تناقض‌ها'}
                </span>
              </button>
            )}
          </div>
        </div>

        {conflicts.length === 0 ? (
          <div className="rounded-xl border border-[#C7DDD0] bg-[#F2F7F4] p-5 flex items-center gap-3 text-sm text-[#14532D]">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>
              هیچ تناقض عددی یا محتوایی میان فایل‌های ورودی شناسایی نشد.
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {conflicts.map((conf) => {
              const badge = STATUS_LABELS[conf.status] || STATUS_LABELS.open;
              const isGrounding = groundingConflictId === conf.id;
              const isResolving = resolvingConflictId === conf.id;
              const note = notesById[conf.id] ?? conf.resolutionNote ?? '';

              return (
                <div
                  key={conf.id}
                  className="rounded-xl border border-[#E2DDD3] bg-white p-4 sm:p-5 space-y-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE4] pb-3">
                    <div className="font-bold text-sm text-[#1A1816]">{conf.topic}</div>
                    <span
                      className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {/* Side-by-side comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="rounded-lg border border-[#E2DDD3] bg-[#FAF9F6] p-3.5 space-y-1.5">
                      <div className="text-xs font-bold text-[#1E3A5F]">
                        روایت ۱ · {conf.fileAName}
                      </div>
                      <p className="text-xs sm:text-[13px] leading-7 text-[#292524]">
                        {conf.excerptA}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#E2DDD3] bg-[#FAF9F6] p-3.5 space-y-1.5">
                      <div className="text-xs font-bold text-[#1E3A5F]">
                        روایت ۲ · {conf.fileBName}
                      </div>
                      <p className="text-xs sm:text-[13px] leading-7 text-[#292524]">
                        {conf.excerptB}
                      </p>
                    </div>
                  </div>

                  {/* Google Search Grounding Result */}
                  {conf.webGroundingJson && (
                    <div className="rounded-lg border border-[#D7CBE6] bg-[#F7F4FA] p-3.5 space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#5B21B6]">
                        <Globe className="h-4 w-4 shrink-0" />
                        <span>نتیجه راستی‌آزمایی با جستجوی گوگل</span>
                      </div>
                      <p className="text-xs sm:text-[13px] leading-7 text-[#292524]">
                        {conf.webGroundingJson.summary}
                      </p>
                      {conf.webGroundingJson.sources?.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {conf.webGroundingJson.sources.map((s, i) => (
                            <a
                              key={i}
                              href={s.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-[#D7CBE6] bg-white px-2.5 py-1 text-[11px] font-medium text-[#5B21B6] hover:bg-[#EFEAF7]"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="max-w-[220px] truncate">{s.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resolution Controls */}
                  <div className="flex flex-col gap-3 pt-1">
                    <input
                      type="text"
                      value={note}
                      onChange={(e) =>
                        setNotesById((prev) => ({ ...prev, [conf.id]: e.target.value }))
                      }
                      placeholder="یادداشت ویراستار درباره این تناقض (اختیاری)..."
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isGrounding}
                        onClick={() => onCheckConflictWithGoogle(conf.id)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#D7CBE6] bg-[#F7F4FA] px-3.5 py-1.5 text-xs font-bold text-[#5B21B6] hover:bg-[#ECE5F5] disabled:opacity-50 cursor-pointer"
                      >
                        {isGrounding ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Globe className="h-3.5 w-3.5" />
                        )}
                        بررسی با جستجوی گوگل
                      </button>

                      <button
                        type="button"
                        disabled={isResolving}
                        onClick={() => onResolveConflict(conf.id, 'keep_both', note)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[#C6D5E6] bg-[#EEF3F8] px-3 py-1.5 text-xs font-semibold text-[#1E3A5F] hover:bg-[#E1EBF5] cursor-pointer"
                      >
                        حفظ هر دو در سند
                      </button>

                      <button
                        type="button"
                        disabled={isResolving}
                        onClick={() => onResolveConflict(conf.id, 'choose_a', note)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[#D6D0C4] bg-white px-3 py-1.5 text-xs font-semibold text-[#1A1816] hover:bg-[#F5F3EE] cursor-pointer"
                      >
                        تأیید روایت ۱
                      </button>

                      <button
                        type="button"
                        disabled={isResolving}
                        onClick={() => onResolveConflict(conf.id, 'choose_b', note)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[#D6D0C4] bg-white px-3 py-1.5 text-xs font-semibold text-[#1A1816] hover:bg-[#F5F3EE] cursor-pointer"
                      >
                        تأیید روایت ۲
                      </button>

                      {conf.webGroundingJson && (
                        <button
                          type="button"
                          disabled={isResolving}
                          onClick={() =>
                            onResolveConflict(
                              conf.id,
                              'resolved_web',
                              note || conf.webGroundingJson?.summary.slice(0, 220) || ''
                            )
                          }
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-[#5B21B6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4C1D95] cursor-pointer"
                        >
                          ثبت نتیجه جستجوی گوگل
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Per-File Coverage Table */}
      {perFileCoverage.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[#1A1816] border-b border-[#E2DDD3] pb-2">
            <FileCheck2 className="h-4 w-4 text-[#1E3A5F]" />
            <span>پوشش محتوا به تفکیک هر فایل ورودی</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#E2DDD3] bg-white">
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="bg-[#FAF9F6] text-[#57534E] border-b border-[#E2DDD3]">
                  <th className="px-4 py-3 font-bold">نام فایل</th>
                  <th className="px-4 py-3 font-bold">نقش</th>
                  <th className="px-4 py-3 font-bold">واحدهای ورودی</th>
                  <th className="px-4 py-3 font-bold">واحدهای پوشش‌داده‌شده</th>
                  <th className="px-4 py-3 font-bold">درصد پوشش</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFECE4]">
                {perFileCoverage.map((row) => (
                  <tr key={row.fileId}>
                    <td className="px-4 py-2.5 font-semibold text-[#1A1816]" dir="auto">
                      {row.fileName}
                    </td>
                    <td className="px-4 py-2.5 text-[#57534E]">
                      {row.role === 'master'
                        ? 'مرجع (Master)'
                        : row.role === 'supplement'
                          ? 'تکمیلی'
                          : 'استاندارد'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{toPersianDigits(row.totalUnits)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{toPersianDigits(row.coveredUnits)}</td>
                    <td className="px-4 py-2.5 font-bold tabular-nums text-[#14532D]">
                      {toPersianDigits(row.coveragePercent)}٪
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Dedup Clusters Inspector */}
      {clusters.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[#1A1816] border-b border-[#E2DDD3] pb-2">
            <Layers className="h-4 w-4 text-[#1E3A5F]" />
            <span>خوشه‌های ادغام بدون افت ({toPersianDigits(clusters.length)} مورد)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {clusters.slice(0, 20).map((cl) => (
              <div
                key={cl.id}
                className="rounded-xl border border-[#E2DDD3] bg-white p-3.5 space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#1E3A5F]">
                    {cl.matchType === 'lossless_union'
                      ? 'ادغام بدون افت (Lossless Union)'
                      : cl.matchType === 'exact_hash'
                        ? 'حذف تکرار دقیق'
                        : 'ادغام هم‌پوشانی بالا'}
                  </span>
                  <span className="tabular-nums text-[#78716C]">
                    شباهت {toPersianDigits(Math.round(cl.similarityScore * 100))}٪
                  </span>
                </div>
                <p className="text-[#57534E] leading-6">{cl.losslessSummary}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
