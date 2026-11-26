import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileText,
  GitMerge,
  History,
  Image as ImageIcon,
  Layers,
  ShieldCheck,
  Table2,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { HistoryRunRecord } from '../lib/bookTypes';
import { sanitizeSvgMarkup } from '../lib/diagramRenderer';
import { toPersianDigits } from '../lib/formatParsers';

interface HistoryViewProps {
  runs: HistoryRunRecord[];
  onRestoreRun: (run: HistoryRunRecord) => void;
  onDownloadRunDocx: (run: HistoryRunRecord) => void;
  onDeleteRun: (id: string) => void;
  onStartNew: () => void;
}

function formatPersianDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fa-IR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function HistoryView({
  runs,
  onRestoreRun,
  onDownloadRunDocx,
  onDeleteRun,
  onStartNew,
}: HistoryViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(runs[0]?.id ?? null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const selectedRun = runs.find((r) => r.id === selectedId) || runs[0] || null;

  if (runs.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm bg-[#EEF3F8] text-[#1E3A5F]">
          <History className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-[#1A1816]">هنوز تاریخچه‌ای ثبت نشده است</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#57534E]">
          به محض پردازش و یکپارچه‌سازی اولین مجموعه فایل، تمام جزئیات تشخیص‌های هوش مصنوعی (فصل‌بندی موضوعی، تکرارهای ادغام‌شده، جداول و نمودارهای ساخته‌شده) و فایل ورد خروجی در این بخش ذخیره می‌شوند.
        </p>
        <button
          type="button"
          onClick={onStartNew}
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-[#1E3A5F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#162C49]"
        >
          <span>شروع ساخت اولین سند</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pt-5 pb-24 sm:px-6 md:pb-10">
      <div className="mb-5 border-b border-[#E2DDD3] pb-4">
        <h1 className="text-xl font-extrabold text-[#1A1816] sm:text-2xl">
          تاریخچه پردازش‌ها و جزئیات تشخیص هوش مصنوعی
        </h1>
        <p className="mt-1 text-xs text-[#57534E] sm:text-sm">
          مشاهده کامل ساختار فصل‌بندی، مطالب تکراری ادغام‌شده، جداول و نمودارهای تولیدشده و دانلود مجدد هر خروجی
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Run List Column */}
        <div className={`space-y-2.5 lg:col-span-4 ${mobileShowDetail ? 'hidden lg:block' : 'block'}`}>
          {runs.map((run) => {
            const active = selectedRun?.id === run.id;
            return (
              <div
                key={run.id}
                className={`rounded-sm border transition-colors ${
                  active
                    ? 'border-[#1E3A5F] bg-[#F3F7FB]'
                    : 'border-[#E2DDD3] bg-white hover:border-[#B7C7DA]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(run.id);
                    setMobileShowDetail(true);
                  }}
                  className="w-full p-4 text-right"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-bold leading-snug text-[#1A1816]">{run.title}</div>
                    <span className="shrink-0 text-[10px] font-semibold text-[#1E3A5F]">
                      {run.engineMode === 'ai' ? run.thinkingLevel : 'داخلی'}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#57534E]">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatPersianDate(run.createdAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {toPersianDigits(run.sourceFiles.length)} فایل
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#EAE5DA] pt-2 text-[11px] text-[#44403C]">
                    <span>{toPersianDigits(run.stats.chapterCount)} فصل</span>
                    <span>{toPersianDigits(run.stats.tableCount)} جدول</span>
                    <span>{toPersianDigits(run.stats.diagramCount)} نمودار</span>
                    <span className="font-semibold text-[#14532D]">
                      {toPersianDigits(run.stats.conceptRetentionRate)}٪ حفظ مفاهیم
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* Detailed AI Inspector Column */}
        {selectedRun && (
          <div className={`space-y-5 lg:col-span-8 ${mobileShowDetail ? 'block' : 'hidden lg:block'}`}>
            {/* Mobile Back Button */}
            <button
              type="button"
              onClick={() => setMobileShowDetail(false)}
              className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-bold text-[#1E3A5F] lg:hidden"
            >
              <ArrowRight className="h-4 w-4" />
              <span>بازگشت به فهرست تاریخچه</span>
            </button>

            {/* Run Overview Card */}
            <section className="rounded-sm border border-[#E2DDD3] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#57534E]">
                    <Cpu className="h-3.5 w-3.5 text-[#1E3A5F]" />
                    <span className="font-bold text-[#1E3A5F]">
                      {selectedRun.engineMode === 'ai'
                        ? `${selectedRun.modelDisplayName} · سطح ${selectedRun.thinkingLevel}`
                        : 'موتور یکپارچه‌ساز ساختاری داخلی'}
                    </span>
                    <span>·</span>
                    <span>{formatPersianDate(selectedRun.createdAt)}</span>
                  </div>
                  <h2 className="mt-1.5 text-lg font-extrabold text-[#1A1816]">{selectedRun.title}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onDownloadRunDocx(selectedRun)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-sm bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162C49]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>دانلود مجدد ورد</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRestoreRun(selectedRun)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-sm border border-[#1E3A5F] bg-white px-3.5 py-2 text-xs font-semibold text-[#1E3A5F] hover:bg-[#EEF3F8]"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>مشاهده کتاب</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteRun(selectedRun.id)}
                    aria-label="حذف از تاریخچه"
                    className="flex h-10 w-10 items-center justify-center rounded-sm border border-[#E6BFB7] text-[#9A3412] hover:bg-[#FDF2F0]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* AI Executive Summary */}
              {selectedRun.aiReport?.executiveSummary && (
                <div className="mt-4 rounded-sm border border-[#D2DFEE] bg-[#F4F8FC] p-3.5 text-xs leading-relaxed text-[#1A1816]">
                  <div className="mb-1 font-bold text-[#1E3A5F]">خلاصه تشخیص و تحلیل هوش مصنوعی:</div>
                  <p>{selectedRun.aiReport.executiveSummary}</p>
                  {selectedRun.aiReport.apiNote && (
                    <p className="mt-1.5 text-[11px] text-[#854D0E]">{selectedRun.aiReport.apiNote}</p>
                  )}
                </div>
              )}

              {/* Input Files */}
              <div className="mt-4 border-t border-[#EFECE4] pt-3">
                <div className="mb-2 text-xs font-bold text-[#57534E]">
                  فایل‌های ورودی ترکیب‌شده ({toPersianDigits(selectedRun.sourceFiles.length)}):
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedRun.sourceFiles.map((f, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-[#D8D2C5] bg-[#FBF9F5] px-2.5 py-1 text-xs text-[#292524]"
                    >
                      <FileText className="h-3.5 w-3.5 text-[#1E3A5F]" />
                      <span dir="auto">{f.name}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Key Stats Grid */}
              <div className="mt-4 grid grid-cols-2 gap-px border border-[#E2DDD3] bg-[#E2DDD3] sm:grid-cols-4">
                <div className="bg-[#FBF9F5] p-3">
                  <div className="text-[11px] text-[#78716C]">تضمین حفظ مفاهیم</div>
                  <div className="mt-1 text-lg font-extrabold text-[#14532D]">
                    {toPersianDigits(selectedRun.stats.conceptRetentionRate)}٪
                  </div>
                </div>
                <div className="bg-[#FBF9F5] p-3">
                  <div className="text-[11px] text-[#78716C]">فصل‌بندی موضوعی</div>
                  <div className="mt-1 text-lg font-extrabold text-[#1E3A5F]">
                    {toPersianDigits(selectedRun.stats.chapterCount)} فصل
                  </div>
                </div>
                <div className="bg-[#FBF9F5] p-3">
                  <div className="text-[11px] text-[#78716C]">تکرارهای ادغام‌شده</div>
                  <div className="mt-1 text-lg font-extrabold text-[#854D0E]">
                    {toPersianDigits(selectedRun.stats.duplicatesConsolidated)} مورد
                  </div>
                </div>
                <div className="bg-[#FBF9F5] p-3">
                  <div className="text-[11px] text-[#78716C]">جداول و نمودارهای درج‌شده</div>
                  <div className="mt-1 text-lg font-extrabold text-[#1E3A5F]">
                    {toPersianDigits(
                      (selectedRun.aiReport?.insertedTables.length || 0) +
                        (selectedRun.aiReport?.insertedDiagrams.length || 0)
                    )}{' '}
                    مورد
                  </div>
                </div>
              </div>
            </section>

            {/* 1. AI Detected Thematic Chapters */}
            {selectedRun.aiReport && selectedRun.aiReport.thematicChapters.length > 0 && (
              <section className="rounded-sm border border-[#E2DDD3] bg-white p-5">
                <div className="mb-3 flex items-center gap-2 border-b border-[#EFECE4] pb-2.5">
                  <Layers className="h-4 w-4 text-[#1E3A5F]" />
                  <h3 className="text-sm font-bold text-[#1A1816]">
                    ساختار فصل‌بندی موضوعی تشخیص‌داده‌شده ({toPersianDigits(selectedRun.aiReport.thematicChapters.length)} فصل)
                  </h3>
                </div>
                <div className="divide-y divide-[#EFECE4] text-xs">
                  {selectedRun.aiReport.thematicChapters.map((ch, idx) => (
                    <div key={idx} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-bold text-[#1E3A5F]">{ch.chapterTitle}</span>
                        <span className="shrink-0 text-[11px] text-[#78716C]">
                          {toPersianDigits(ch.sectionIds.length)} زیربخش
                        </span>
                      </div>
                      {ch.topicSummary && (
                        <p className="mt-1 text-[#57534E]">{ch.topicSummary}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 2. Generated Tables & Diagrams Embedded in Word */}
            {selectedRun.aiReport &&
              (selectedRun.aiReport.insertedTables.length > 0 ||
                selectedRun.aiReport.insertedDiagrams.length > 0) && (
                <section className="rounded-sm border border-[#E2DDD3] bg-white p-5">
                  <div className="mb-3 flex items-center gap-2 border-b border-[#EFECE4] pb-2.5">
                    <ImageIcon className="h-4 w-4 text-[#1E3A5F]" />
                    <h3 className="text-sm font-bold text-[#1A1816]">
                      جداول و نمودارهای تولید و درج‌شده در سند ورد
                    </h3>
                  </div>

                  {selectedRun.aiReport.insertedTables.length > 0 && (
                    <div className="mb-4 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#57534E]">
                        <Table2 className="h-3.5 w-3.5 text-[#1E3A5F]" />
                        <span>جداول درج‌شده ({toPersianDigits(selectedRun.aiReport.insertedTables.length)})</span>
                      </div>
                      <div className="space-y-2">
                        {selectedRun.aiReport.insertedTables.map((t, idx) => (
                          <div
                            key={idx}
                            className="rounded-sm border border-[#EFECE4] bg-[#FBF9F5] p-3 text-xs"
                          >
                            <div className="font-bold text-[#1E3A5F]">{t.caption}</div>
                            <div className="mt-1 text-[#57534E]">{t.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedRun.aiReport.insertedDiagrams.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#57534E]">
                        <ImageIcon className="h-3.5 w-3.5 text-[#1E3A5F]" />
                        <span>
                          نمودارهای تصویری درج‌شده ({toPersianDigits(selectedRun.aiReport.insertedDiagrams.length)})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {selectedRun.aiReport.insertedDiagrams.map((d, idx) => (
                          <div
                            key={idx}
                            className="overflow-hidden rounded-sm border border-[#E2DDD3] bg-[#FBF9F5]"
                          >
                            <div className="border-b border-[#E2DDD3] px-3.5 py-2 text-xs">
                              <div className="font-bold text-[#1E3A5F]">{d.caption}</div>
                              {d.rationale && <div className="mt-0.5 text-[#57534E]">{d.rationale}</div>}
                            </div>
                            <div
                              className="p-2 [&>svg]:h-auto [&>svg]:w-full"
                              dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(d.svgMarkup) }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

            {/* 3. Semantic & Structural Duplicates Consolidated + Concept Retention */}
            <section className="rounded-sm border border-[#E2DDD3] bg-white p-5">
              <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#EFECE4] pb-2.5">
                <div className="flex items-center gap-2">
                  <GitMerge className="h-4 w-4 text-[#14532D]" />
                  <h3 className="text-sm font-bold text-[#1A1816]">
                    گزارش تکرارهای تشخیص‌داده‌شده و تضمین حفظ مفاهیم
                  </h3>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-[#14532D]">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{toPersianDigits(selectedRun.stats.conceptRetentionRate)}٪ حفظ دانش</span>
                </span>
              </div>

              {/* AI Semantic Duplicates */}
              {selectedRun.aiReport && selectedRun.aiReport.semanticDuplicates.length > 0 && (
                <div className="mb-4 space-y-2">
                  <div className="text-xs font-bold text-[#1E3A5F]">تکرارهای معنایی شناسایی‌شده توسط هوش مصنوعی:</div>
                  {selectedRun.aiReport.semanticDuplicates.map((dup, idx) => (
                    <div key={idx} className="rounded-sm border border-[#D2DFEE] bg-[#F4F8FC] p-3 text-xs">
                      <div className="font-bold text-[#1A1816]">{dup.topic}</div>
                      <p className="mt-1 text-[#44403C]">{dup.mergeRationale}</p>
                      {dup.preservedConcepts.length > 0 && (
                        <div className="mt-1.5 text-[11px] font-semibold text-[#14532D]">
                          مفاهیم حفظ‌شده: {dup.preservedConcepts.join('، ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Concept Retention Proof */}
              {selectedRun.audit && selectedRun.audit.conceptChecks.length > 0 && (
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {selectedRun.audit.conceptChecks.slice(0, 12).map((chk) => (
                    <div
                      key={chk.token}
                      className="flex items-center justify-between gap-2 rounded-sm border border-[#EFECE4] bg-[#FBF9F5] px-3 py-2 text-xs"
                    >
                      <span className="truncate font-medium text-[#1A1816]">{chk.label}</span>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#14532D]" />
                    </div>
                  ))}
                </div>
              )}

              {/* Structural Deduplication Log Sample */}
              {selectedRun.audit && selectedRun.audit.records.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-[#57534E]">
                    جزئیات اصلاحات و ادغام‌ها ({toPersianDigits(selectedRun.audit.records.length)} مورد):
                  </div>
                  <div className="max-h-80 divide-y divide-[#EFECE4] overflow-y-auto rounded-sm border border-[#EFECE4]">
                    {selectedRun.audit.records.slice(0, 35).map((rec) => (
                      <div key={rec.id} className="p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-[#1E3A5F]">{rec.categoryLabel}</span>
                          <span className="text-[11px] text-[#78716C]">{rec.location}</span>
                        </div>
                        <p className="mt-1 text-[#44403C]">{rec.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
