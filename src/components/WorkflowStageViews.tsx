import React, { useRef } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileAudio,
  FileCode,
  FileText,
  Layers,
  Loader2,
  Mic,
  Printer,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  AiModelId,
  AuditReportDto,
  ConflictDto,
  DocxExportConfig,
  ParsedBook,
  ProjectBundleDto,
  ProjectSummaryDto,
  SourceFileDto,
  WorkflowMode,
} from '../lib/bookTypes';
import type { AiQuotaProbeResponse } from '../lib/aiProviderConfig';
import { BOOK_WORKFLOW_STAGES, WorkflowProgressSnapshot } from '../lib/bookWorkflow';
import { toPersianDigits } from '../lib/formatParsers';
import { ProjectsDashboardWidget } from './ProjectsDashboardWidget';

interface StageIngestViewProps {
  projects: ProjectSummaryDto[];
  activeProjectId: string | null;
  activeBundle?: ProjectBundleDto | null;
  activeAiModel: AiModelId;
  audioEngineLabel?: string;
  probeData: AiQuotaProbeResponse | null;
  sourceFiles: SourceFileDto[];
  contentUnitsCount: number;
  queuedFilesCount: number;
  processing: boolean;
  transcribingAudio?: boolean;
  progress: WorkflowProgressSnapshot;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (mode: WorkflowMode) => void;
  onOpenProviderSettings: () => void;
  onRunStage1Ingest: () => Promise<void>;
  onTranscribeAudioFile?: (file: File) => Promise<void>;
  onRunStage2Dedup: () => Promise<void>;
  onGoToStage2: () => void;
  onLoadDemoFiles: () => void;
  onOpenMobileSidebar: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  master: 'سند مادر (اصلی)',
  supplement: 'جزوه تکمیلی',
  standard: 'فایل منبع استاندارد',
};

export const StageIngestView: React.FC<StageIngestViewProps> = ({
  projects,
  activeProjectId,
  activeBundle = null,
  activeAiModel,
  audioEngineLabel = 'Gemini Audio (gemini-3.5-transcribe)',
  probeData,
  sourceFiles,
  contentUnitsCount,
  queuedFilesCount,
  processing,
  transcribingAudio = false,
  progress,
  onSelectProject,
  onCreateProject,
  onOpenProviderSettings,
  onRunStage1Ingest,
  onTranscribeAudioFile,
  onRunStage2Dedup,
  onGoToStage2,
  onLoadDemoFiles,
  onOpenMobileSidebar,
}) => {
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const totalWords = sourceFiles.reduce((sum, f) => sum + (f.wordCount || 0), 0);

  const handleAudioSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onTranscribeAudioFile) return;
    await onTranscribeAudioFile(file);
  };

  const audioIngestCard = onTranscribeAudioFile ? (
    <div className="rounded-xl border border-[#D8E2EE] bg-[#F5F8FC] p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] text-white">
          <FileAudio className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="text-xs sm:text-sm font-extrabold text-[#1E3A5F]">
            تبدیل ویس کارگاهی به جزوه متنی و افزودن مستقیم به پروژه
          </div>
          <p className="text-[11px] text-[#475569] leading-5">
            فایل صوتی (MP3 / WAV / M4A / OGG / WEBM) را آپلود کنید تا با موتور{' '}
            <span className="font-mono font-bold text-[#1E3A5F]" dir="ltr">
              {audioEngineLabel}
            </span>{' '}
            پیاده‌سازی و به‌عنوان منبع جزوه ثبت شود.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
          onChange={(e) => void handleAudioSelected(e)}
          className="hidden"
        />
        <button
          type="button"
          onClick={onOpenProviderSettings}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#C6D5E6] bg-white px-3 py-1.5 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
        >
          <Mic className="h-3.5 w-3.5" />
          <span>تغییر مدل صوت</span>
        </button>
        <button
          type="button"
          disabled={transcribingAudio || processing}
          onClick={() => audioInputRef.current?.click()}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer"
        >
          {transcribingAudio ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          <span>{transcribingAudio ? 'در حال تبدیل ویس به متن...' : 'آپلود فایل ویس'}</span>
        </button>
      </div>
    </div>
  ) : null;

  const dashboardSection = (
    <ProjectsDashboardWidget
      projects={projects}
      activeProjectId={activeProjectId}
      activeBundle={activeBundle}
      activeAiModel={activeAiModel}
      probeData={probeData}
      onSelectProject={onSelectProject}
      onCreateProject={onCreateProject}
      onOpenProviderSettings={onOpenProviderSettings}
    />
  );

  if (sourceFiles.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 space-y-6">
        {dashboardSection}
        {audioIngestCard}
        <div className="rounded-xl border border-[#E2DDD3] bg-white p-6 sm:p-8 text-center space-y-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#EEF3F8] text-[#1E3A5F]">
            <Layers className="h-6 w-6" />
          </div>

          <div className="space-y-2 max-w-2xl mx-auto">
            <p className="text-xs font-bold text-[#1E3A5F]">
              مرحله ۱ از ۵ · دریافت و استخراج اتمی فایل‌ها
            </p>
            <h2 className="text-xl font-extrabold text-[#1A1816]">
              تدوین مرحله‌به‌مرحله کتاب بدون افت محتوا
            </h2>
            <p className="text-sm text-[#57534E] leading-7">
              در این استودیو همه کارها یک‌جا و بی‌کنترل انجام نمی‌شوند. در مرحله اول فقط فایل‌های ورودی شما خوانده و واحدهای متنی استخراج می‌شوند؛ سپس در مراحل بعدی با تأیید شما ادغام، فصل‌بندی، کادربندی و خروجی نهایی انجام می‌گیرد.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            {queuedFilesCount > 0 ? (
              <button
                type="button"
                disabled={processing}
                onClick={() => void onRunStage1Ingest()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1E3A5F] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#162C49] disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {processing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span>
                  {processing
                    ? 'در حال استخراج فایل‌ها...'
                    : `اجرای مرحله ۱: استخراج ${toPersianDigits(queuedFilesCount)} فایل انتخاب‌شده`}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onLoadDemoFiles}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#1E3A5F] bg-white px-5 py-2.5 text-xs sm:text-sm font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
              >
                <Sparkles className="h-4 w-4" />
                بارگذاری ۲ فایل نمونه برای تست مرحله‌به‌مرحله
              </button>
            )}

            <button
              type="button"
              onClick={onOpenMobileSidebar}
              className="lg:hidden inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1E3A5F] px-5 py-2.5 text-xs font-bold text-white cursor-pointer"
            >
              انتخاب فایل از دستگاه
            </button>
          </div>
        </div>

        {/* 5-Stage Authoring Workflow Overview */}
        <div className="rounded-xl border border-[#E2DDD3] bg-white p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b border-[#EFECE4] pb-2.5">
            <h3 className="text-sm font-extrabold text-[#1A1816]">
              نقشه راه ۵ مرحله‌ای تدوین کتاب
            </h3>
            <span className="text-[11px] text-[#78716C]">
              هر مرحله یک وظیفه مشخص و مستقل دارد
            </span>
          </div>

          <ol className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
            {BOOK_WORKFLOW_STAGES.map((st) => (
              <li
                key={st.stage}
                className={`rounded-lg border p-3 space-y-1.5 ${
                  st.stage === 1
                    ? 'border-[#1E3A5F] bg-[#F5F8FC]'
                    : 'border-[#E7E2D8] bg-[#FAF9F6]'
                }`}
              >
                <div className="text-xs font-extrabold text-[#1E3A5F]">
                  {st.shortTitleFa}
                </div>
                <p className="text-[11px] text-[#57534E] leading-5">
                  {st.singleResponsibilityFa}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 space-y-6">
      {dashboardSection}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2DDD3] pb-4">
        <div className="space-y-1">
          <p className="text-xs font-bold text-[#14532D]">
            مرحله ۱ تکمیل شد · استخراج اتمی بدون تغییر یا حذف محتوا
          </p>
          <h2 className="text-lg sm:text-xl font-extrabold text-[#1A1816]">
            فایل‌های منبع ثبت‌شده در پروژه
          </h2>
          <p className="text-xs sm:text-sm text-[#57534E]">
            فایل‌های زیر استخراج و در پایگاه داده ثبت شده‌اند. هنوز ادغام یا تغییر فصل‌بندی انجام نشده تا ابتدا صحت ورودی‌ها را بررسی کنید.
          </p>
        </div>

        {queuedFilesCount > 0 && (
          <button
            type="button"
            disabled={processing}
            onClick={() => void onRunStage1Ingest()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3.5 py-2 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFEAF5] disabled:opacity-50 cursor-pointer"
          >
            {processing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span>
              جایگزینی و استخراج {toPersianDigits(queuedFilesCount)} فایل جدید صف
            </span>
          </button>
        )}
      </div>

      {/* Stage 1 KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#E2DDD3] bg-white p-4">
          <div className="text-xs text-[#57534E]">تعداد فایل‌های منبع</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#1E3A5F]">
            {toPersianDigits(sourceFiles.length)}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C]">ذخیره‌شده با شناسه منبع</div>
        </div>

        <div className="rounded-xl border border-[#E2DDD3] bg-white p-4">
          <div className="text-xs text-[#57534E]">واحدهای متنی اتمی استخراج‌شده</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#14532D]">
            {toPersianDigits(contentUnitsCount)}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C]">پاراگراف‌ها، جداول و تیترها</div>
        </div>

        <div className="rounded-xl border border-[#E2DDD3] bg-white p-4">
          <div className="text-xs text-[#57534E]">مجموع کلمات ورودی</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#1A1816]">
            {toPersianDigits(totalWords.toLocaleString('en-US'))}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C]">آماده برای ممیزی مرحله ۲</div>
        </div>
      </div>

      {audioIngestCard}

      {/* Ingested Source Files Table */}
      <div className="overflow-x-auto rounded-xl border border-[#E2DDD3] bg-white">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-[#FAF9F6] border-b border-[#E2DDD3] text-[#44403C]">
              <th className="px-4 py-2.5 font-bold">#</th>
              <th className="px-4 py-2.5 font-bold">نام فایل</th>
              <th className="px-4 py-2.5 font-bold">فرمت</th>
              <th className="px-4 py-2.5 font-bold">نقش در پروژه</th>
              <th className="px-4 py-2.5 font-bold">تعداد کلمات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EFECE4]">
            {sourceFiles.map((file, idx) => (
              <tr key={file.id} className="hover:bg-[#FCFBF8]">
                <td className="px-4 py-2.5 tabular-nums text-[#78716C]">
                  {toPersianDigits(idx + 1)}
                </td>
                <td className="px-4 py-2.5 font-semibold text-[#1A1816]">{file.fileName}</td>
                <td className="px-4 py-2.5 uppercase font-mono text-[11px] text-[#57534E]">
                  {file.format}
                </td>
                <td className="px-4 py-2.5 text-[#57534E]">
                  {ROLE_LABELS[file.fileRole] || file.fileRole}
                </td>
                <td className="px-4 py-2.5 tabular-nums font-semibold text-[#1E3A5F]">
                  {toPersianDigits((file.wordCount || 0).toLocaleString('en-US'))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Clear Next-Stage Transition CTA */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-[#C6D5E6] bg-[#EEF3F8] p-4 sm:p-5">
        <div className="space-y-1 text-right">
          <div className="text-sm font-extrabold text-[#1E3A5F]">
            گام بعدی: مرحله ۲ — ادغام بدون افت و کشف تناقض‌ها
          </div>
          <p className="text-xs text-[#3B5578] leading-6">
            با کلیک روی دکمه مقابل، فقط الگوریتم حذف تکراری بدون افت و شناسایی تناقض‌های واقعی اجرا می‌شود و گزارش آن برای تصمیم‌گیری شما باز می‌گردد.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
          {progress.hasDedupResults && (
            <button
              type="button"
              onClick={onGoToStage2}
              className="flex-1 sm:flex-none min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1E3A5F] bg-white px-4 py-2 text-xs font-bold text-[#1E3A5F] hover:bg-[#F5F8FC] cursor-pointer"
            >
              <span>مشاهده نتایج مرحله ۲</span>
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            disabled={processing}
            onClick={() => void onRunStage2Dedup()}
            className="flex-1 sm:flex-none min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] px-5 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-[#162C49] disabled:opacity-60 cursor-pointer shadow-xs"
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>در حال ادغام و کشف تناقض...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                <span>
                  {progress.hasDedupResults
                    ? 'اجرای مجدد مرحله ۲ (ادغام و ممیزی)'
                    : 'اجرای مرحله ۲: ادغام و کشف تناقض'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

interface StageExportViewProps {
  book: ParsedBook;
  auditReport: AuditReportDto | null;
  conflicts: ConflictDto[];
  config: DocxExportConfig;
  exportingDocx: boolean;
  onDownloadDocx: () => Promise<void>;
  onDownloadMarkdown: () => void;
  onPrintPdf: () => void;
  onGoToStage4Preview: () => void;
  onGoToStage2Audit: () => void;
}

export const StageExportView: React.FC<StageExportViewProps> = ({
  book,
  auditReport,
  conflicts,
  config,
  exportingDocx,
  onDownloadDocx,
  onDownloadMarkdown,
  onPrintPdf,
  onGoToStage4Preview,
  onGoToStage2Audit,
}) => {
  const openConflicts = conflicts.filter((c) => c.status === 'open').length;
  const totalCallouts = book.chapters.reduce(
    (sum, ch) =>
      sum +
      ch.sections.reduce(
        (s, sec) => s + sec.blocks.filter((b) => b.type === 'callout').length,
        0
      ),
    0
  );
  const totalTables = book.chapters.reduce(
    (sum, ch) =>
      sum +
      ch.sections.reduce(
        (s, sec) => s + sec.blocks.filter((b) => b.type === 'table').length,
        0
      ),
    0
  );
  const coverage = auditReport?.coveragePercent ?? 100;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2DDD3] pb-4">
        <div className="space-y-1">
          <p className="text-xs font-bold text-[#14532D]">
            مرحله ۵ از ۵ · تأیید نهایی و استودیو خروجی استاندارد
          </p>
          <h2 className="text-lg sm:text-xl font-extrabold text-[#1A1816]">
            سند نهایی آماده انتشار و دانلود است
          </h2>
          <p className="text-xs sm:text-sm text-[#57534E]">
            «{book.title}» با کادرهای رنگی تفکیک‌شده، راست‌چین استاندارد و فونت {config.fontFamily} برای خروجی آماده است.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onGoToStage4Preview}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-3 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#FAF9F6] cursor-pointer"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>بازگشت به پیش‌نمایش (مرحله ۴)</span>
          </button>
        </div>
      </div>

      {/* Final Sign-Off Checklist */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#C7DDD0] bg-[#F2F7F4] p-4">
          <div className="text-xs font-medium text-[#14532D]">نرخ پوشش بدون افت</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#14532D]">
            {toPersianDigits(coverage)}٪
          </div>
          <div className="mt-0.5 text-[11px] text-[#3F6B50]">تمام نکات یکتا حفظ شده</div>
        </div>

        <div className="rounded-xl border border-[#E2DDD3] bg-white p-4">
          <div className="text-xs font-medium text-[#57534E]">ساختار نهایی کتاب</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#1E3A5F]">
            {toPersianDigits(book.chapters.length)} فصل
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C]">
            {toPersianDigits(
              book.chapters.reduce((sum, ch) => sum + ch.sections.length, 0)
            )}{' '}
            زیربخش سازمان‌یافته
          </div>
        </div>

        <div className="rounded-xl border border-[#E2DDD3] bg-white p-4">
          <div className="text-xs font-medium text-[#57534E]">کادرهای رنگی و جداول</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#1E3A5F]">
            {toPersianDigits(totalCallouts + totalTables)}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716C]">
            {toPersianDigits(totalCallouts)} کادر موضوعی · {toPersianDigits(totalTables)} جدول
          </div>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            openConflicts > 0
              ? 'border-[#F2B8B5] bg-[#FEF3F2]'
              : 'border-[#C7DDD0] bg-[#F2F7F4]'
          }`}
        >
          <div
            className={`text-xs font-medium ${
              openConflicts > 0 ? 'text-[#9A2E1A]' : 'text-[#14532D]'
            }`}
          >
            وضعیت تناقض‌ها
          </div>
          <div
            className={`mt-1 text-2xl font-extrabold tabular-nums ${
              openConflicts > 0 ? 'text-[#9A2E1A]' : 'text-[#14532D]'
            }`}
          >
            {openConflicts > 0 ? `${toPersianDigits(openConflicts)} باز` : 'پاک و تأییدشده'}
          </div>
          {openConflicts > 0 ? (
            <button
              type="button"
              onClick={onGoToStage2Audit}
              className="mt-1 text-[11px] font-bold text-[#9A2E1A] underline cursor-pointer"
            >
              بازگشت به مرحله ۲ برای تعیین‌تکلیف
            </button>
          ) : (
            <div className="mt-0.5 text-[11px] text-[#3F6B50]">بدون تناقض بی‌پاسخ</div>
          )}
        </div>
      </div>

      {openConflicts > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#F2B8B5] bg-[#FEF3F2] px-4 py-3 text-xs text-[#9A2E1A]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="leading-6">
            هنوز {toPersianDigits(openConflicts)} تناقض در وضعیت «در انتظار تصمیم» دارید. هر دو روایت در کادر هشدار تناقض داخل سند حفظ شده‌اند؛ در صورت تمایل می‌توانید پیش از دانلود، از مرحله ۲ تصمیم نهایی را ثبت کنید.
          </div>
        </div>
      )}

      {/* Primary Word (.docx) Export Card */}
      <div className="rounded-2xl border-2 border-[#1E3A5F] bg-white p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1E3A5F] text-white">
              <FileText className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-extrabold text-[#1A1816]">
                فایل استاندارد Microsoft Word (.docx)
              </h3>
              <p className="text-xs text-[#57534E] leading-6">
                شامل جلد کتاب، فهرست مطالب خودکار، سرفصل‌های استاندارد Heading، کادرهای رنگی تفکیک‌شده برای هر موضوع (هشدار قرمز، مهندسی لاجوردی، مفهومی فیروزه‌ای، پرسش‌وپاسخ بنفش، پروژه زمردی و پژوهش وب) و واژه‌نامه دوزبانه.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={exportingDocx}
            onClick={() => void onDownloadDocx()}
            className="w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] px-6 py-3 text-sm font-extrabold text-white hover:bg-[#162C49] disabled:opacity-60 cursor-pointer shrink-0 shadow-sm"
          >
            {exportingDocx ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>در حال ساخت فایل ورد...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>دانلود فایل ورد (.docx)</span>
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-[#EFECE4] pt-3 text-[11px] text-[#57534E]">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#14532D]" />
            فونت {config.fontFamily} · سایز {toPersianDigits(config.baseFontSizePt)}pt
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#14532D]" />
            قطع {config.paperSize === 'B5' ? 'وزیری (B5)' : 'A4'} · راست‌چین کامل RTL
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#14532D]" />
            {toPersianDigits(book.glossary.length)} مدخل واژه‌نامه · {toPersianDigits(book.footnotes.length)} پاورقی
          </span>
        </div>
      </div>

      {/* Secondary Formats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF3F8] text-[#1E3A5F]">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-extrabold text-[#1A1816]">نسخه Markdown (.md)</h4>
              <p className="text-[11px] text-[#57534E] mt-0.5">
                متن ساختاریافته و تمیز مناسب آرشیو Git یا نشر وب.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDownloadMarkdown}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-[#C8C1B4] bg-[#FAF9F6] px-3.5 py-1.5 text-xs font-bold text-[#1A1816] hover:bg-[#EFECE4] cursor-pointer shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-[#1E3A5F]" />
            <span>دانلود MD</span>
          </button>
        </div>

        <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F5F3EE] text-[#44403C]">
              <Printer className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-extrabold text-[#1A1816]">پیش‌نمایش چاپ استاندارد A4 / PDF</h4>
              <p className="text-[11px] text-[#57534E] mt-0.5">
                نمایش صفحه‌بندی دقیق A4 با حاشیه‌های استاندارد، فونت بهینه و ذخیره مستقیم PDF.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onPrintPdf}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3.5 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFEAF5] cursor-pointer shrink-0"
          >
            <Printer className="h-3.5 w-3.5 text-[#1E3A5F]" />
            <span>پیش‌نمایش چاپ A4 / PDF</span>
          </button>
        </div>
      </div>
    </div>
  );
};
