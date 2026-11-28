import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BookMarked,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  GitMerge,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ApiClient } from '../lib/apiClient';
import { toPersianDigits } from '../lib/formatParsers';

interface MasterEncyclopediaAdminModalProps {
  open: boolean;
  onClose: () => void;
  api: ApiClient;
}

type AdminTab = 'structure' | 'queue' | 'moderation' | 'exports';

type OverviewData = Awaited<ReturnType<ApiClient['getMasterEncyclopediaOverview']>>;
type JobsAndLogsData = Awaited<ReturnType<ApiClient['getMasterEncyclopediaJobsAndLogs']>>;
type StagingData = Awaited<ReturnType<ApiClient['getMasterStaging']>>;
type ConflictsData = Awaited<ReturnType<ApiClient['getMasterConflicts']>>;
type LinterData = Awaited<ReturnType<ApiClient['runMasterKnowledgeLinter']>>;

export const MasterEncyclopediaAdminModal: React.FC<MasterEncyclopediaAdminModalProps> = ({
  open,
  onClose,
  api,
}) => {
  const [tab, setTab] = useState<AdminTab>('structure');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [jobsLogs, setJobsLogs] = useState<JobsAndLogsData | null>(null);
  const [staging, setStaging] = useState<StagingData | null>(null);
  const [conflicts, setConflicts] = useState<ConflictsData['conflicts']>([]);
  const [linterReport, setLinterReport] = useState<LinterData | null>(null);

  // Structure tools state
  const [renameChapterId, setRenameChapterId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [moveChapterId, setMoveChapterId] = useState('');
  const [moveTargetVolId, setMoveTargetVolId] = useState('');
  const [mergeSourceChapterId, setMergeSourceChapterId] = useState('');
  const [mergeTargetChapterId, setMergeTargetChapterId] = useState('');
  const [takedownHashInput, setTakedownHashInput] = useState('');
  const [importFileName, setImportFileName] = useState('initial-automotive-reference.md');
  const [importMarkdownText, setImportMarkdownText] = useState('');
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [exportVolumeId, setExportVolumeId] = useState('');
  const [conditionInputs, setConditionInputs] = useState<Record<string, string>>({});

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, jl, st, cf] = await Promise.all([
        api.getMasterEncyclopediaOverview(),
        api.getMasterEncyclopediaJobsAndLogs(),
        api.getMasterStaging(),
        api.getMasterConflicts(),
      ]);
      setOverview(ov);
      setJobsLogs(jl);
      setStaging(st);
      setConflicts(cf.conflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری اطلاعات دایرةالمعارف مرجع.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!open) return;
    void refreshAll();
  }, [open, refreshAll]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const allChapters =
    overview?.volumes.flatMap((v) =>
      v.chapters.map((c) => ({ ...c, volumeTitle: v.title }))
    ) ?? [];

  const runAction = async (label: string, fn: () => Promise<string>) => {
    setBusyAction(label);
    setError(null);
    setToast(null);
    try {
      const msg = await fn();
      setToast(msg);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'عملیات ناموفق بود.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownload = async (format: 'md' | 'docx' | 'csv' | 'a2l' | 'xdf' | 'json') => {
    await runAction(`export_${format}`, async () => {
      const { blob, fileName } = await api.downloadMasterExport(
        format,
        exportVolumeId || undefined
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      return `فایل ${fileName} با موفقیت دانلود شد.`;
    });
  };

  const handleImportFilePick = async (file: File) => {
    const text = await file.text();
    setImportFileName(file.name);
    setImportMarkdownText(text);
  };

  const openConflicts = conflicts.filter((c) => c.status === 'open');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="پنل مدیریت دایرةالمعارف مرجع خودرو"
      data-testid="master-encyclopedia-admin-modal"
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#D8D1C4] bg-[#FAF9F6] text-[#1A1816] shadow-2xl">
        {/* Top Header */}
        <header className="flex items-center justify-between gap-3 border-b border-[#E2DDD3] bg-white px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1E3A5F] text-white">
              <BookMarked className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm sm:text-base font-extrabold text-[#1A1816]">
                مدیریت دایرةالمعارف مرجع خودرو (اختصاصی مالک پلتفرم)
              </h2>
              <p className="text-[11px] text-[#57534E]">
                معماری چندجلدی و خودرشد · پایگاه‌داده اتمیک مرجع · خروجی WinOLS / Google Sheets / Word
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={loading}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-3 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#F5F8FC] cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>بروزرسانی</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن پنل مدیریت دایرةالمعارف"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2DDD3] text-[#57534E] hover:bg-[#F2EFE8] hover:text-[#1A1816] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Summary KPI Strip (Tabular Numerals, Flat Single Elevation) */}
        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 border-b border-[#E2DDD3] bg-[#F7F5EF] px-5 py-3 tabular-nums">
            <div className="rounded-lg border border-[#E5E0D6] bg-white px-3 py-2">
              <div className="text-[10.5px] text-[#78716C]">مجلدات / فصل‌ها</div>
              <div className="mt-0.5 text-sm font-extrabold text-[#1E3A5F]">
                {toPersianDigits(overview.summary.volumesCount)} جلد · {toPersianDigits(overview.summary.chaptersCount)} فصل
              </div>
            </div>
            <div className="rounded-lg border border-[#E5E0D6] bg-white px-3 py-2">
              <div className="text-[10.5px] text-[#78716C]">واحدهای تأییدشده</div>
              <div className="mt-0.5 text-sm font-extrabold text-[#14532D]">
                {toPersianDigits(overview.summary.verifiedUnitsCount)} واحد
              </div>
            </div>
            <div className="rounded-lg border border-[#E5E0D6] bg-white px-3 py-2">
              <div className="text-[10.5px] text-[#78716C]">حجم کل / صفحات</div>
              <div className="mt-0.5 text-sm font-extrabold text-[#1A1816]">
                {toPersianDigits(overview.summary.totalWords)} کلمه ({toPersianDigits(overview.summary.totalEstimatedPages)} ص)
              </div>
            </div>
            <div className="rounded-lg border border-[#E5E0D6] bg-white px-3 py-2">
              <div className="text-[10.5px] text-[#78716C]">صف بازبینی (Staging)</div>
              <div className="mt-0.5 text-sm font-extrabold text-[#854D0E]">
                {toPersianDigits(overview.summary.stagingUnitsCount)} واحد · {toPersianDigits(overview.summary.draftProposalsCount)} پیشنهاد جلد
              </div>
            </div>
            <div className="rounded-lg border border-[#E5E0D6] bg-white px-3 py-2">
              <div className="text-[10.5px] text-[#78716C]">تعارض‌های باز</div>
              <div className="mt-0.5 text-sm font-extrabold text-[#9A3412]">
                {toPersianDigits(overview.summary.openConflictsCount)} تعارض
              </div>
            </div>
            <div className="rounded-lg border border-[#E5E0D6] bg-white px-3 py-2">
              <div className="text-[10.5px] text-[#78716C]">موجودیت‌ها / صف / DLQ</div>
              <div className="mt-0.5 text-sm font-extrabold text-[#1E3A5F]">
                {toPersianDigits(overview.summary.canonicalEntitiesCount)} · {toPersianDigits(overview.summary.queuedJobsCount)} / {toPersianDigits(overview.summary.dlqJobsCount)}
              </div>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <nav
          role="tablist"
          aria-label="بخش‌های پنل مدیریت دایرةالمعارف"
          className="flex flex-wrap items-center gap-1.5 border-b border-[#E2DDD3] bg-white px-5 py-2"
        >
          {[
            { id: 'structure' as const, label: 'ساختار مجلدات و ایمپورت' },
            { id: 'queue' as const, label: 'صف پردازش، لاگ و Rollback / Takedown' },
            {
              id: 'moderation' as const,
              label: `صف بازبینی و تعارض‌ها (${toPersianDigits((staging?.stagingUnits.length ?? 0) + openConflicts.length)})`,
            },
            { id: 'exports' as const, label: 'Knowledge Linter و خروجی‌های یک‌کلیکی' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                tab === item.id
                  ? 'bg-[#1E3A5F] text-white'
                  : 'text-[#57534E] hover:bg-[#F3F0E9] hover:text-[#1A1816]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Feedback Banner */}
        {(error || toast) && (
          <div className="px-5 pt-3">
            {error && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#E6CFC2] bg-[#FDF2F0] px-3.5 py-2 text-xs font-semibold text-[#9A3412]">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} className="cursor-pointer">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {toast && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#C7DDD0] bg-[#EEF6F0] px-3.5 py-2 text-xs font-semibold text-[#14532D]">
                <span>{toast}</span>
                <button type="button" onClick={() => setToast(null)} className="cursor-pointer">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && !overview ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#57534E]">
              <Loader2 className="h-5 w-5 animate-spin text-[#1E3A5F]" />
              <span>در حال بارگذاری ساختار دایرةالمعارف مرجع...</span>
            </div>
          ) : tab === 'structure' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 7 Cols: Volume -> Chapter Tree & Domain Breakdown */}
              <div className="lg:col-span-7 space-y-4">
                <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                  <h3 className="text-sm font-extrabold text-[#1A1816]">
                    درخت مجلدات و فصل‌های دایرةالمعارف مرجع
                  </h3>
                  {!overview || overview.volumes.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[#D6D0C4] bg-[#FAF9F6] p-6 text-center text-xs text-[#57534E] leading-6">
                      دایرةالمعارف مرجع در حال حاضر کاملاً خالی است. می‌توانید از بخش «ایمپورت Markdown اولیه» فایل مرجع خود را وارد کنید یا با آپلود اسناد خودرو در پلتفرم، رشد تدریجی آن را مشاهده نمایید.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {overview.volumes.map((vol) => (
                        <div
                          key={vol.id}
                          className="rounded-lg border border-[#E5E0D6] bg-[#FCFBF8] p-3 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-[#1E3A5F]">
                                {vol.title}
                              </div>
                              <div className="mt-0.5 text-[11px] text-[#57534E] tabular-nums">
                                دامنه: {vol.automotiveDomain} · وضعیت:{' '}
                                <strong className={vol.status === 'published' ? 'text-[#14532D]' : 'text-[#854D0E]'}>
                                  {vol.status === 'published' ? 'منتشرشده' : 'پیشنهاد جلد جدید'}
                                </strong>{' '}
                                · {toPersianDigits(vol.wordCount)} کلمه · {toPersianDigits(vol.estimatedPages)} صفحه · آستانه تقسیم:{' '}
                                {toPersianDigits(vol.splitThresholdPages)} صفحه
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {vol.status === 'draft_proposal' && (
                                <button
                                  type="button"
                                  disabled={busyAction !== null}
                                  onClick={() =>
                                    void runAction(`pub_${vol.id}`, async () => {
                                      await api.approveMasterVolumeProposal(vol.id);
                                      return `جلد «${vol.title}» تأیید و منتشر شد.`;
                                    })
                                  }
                                  className="rounded-md bg-[#14532D] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#0F4022] cursor-pointer"
                                >
                                  تأیید و انتشار
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busyAction !== null}
                                onClick={() =>
                                  void runAction(`thresh_${vol.id}`, async () => {
                                    const nextPages = vol.splitThresholdPages === 500 ? 700 : 500;
                                    await api.updateMasterVolumeSettings(vol.id, {
                                      splitThresholdPages: nextPages,
                                      splitThresholdWords: nextPages * 300,
                                    });
                                    return `آستانه تقسیم جلد به ${toPersianDigits(nextPages)} صفحه تغییر یافت.`;
                                  })
                                }
                                className="rounded-md border border-[#D6D0C4] bg-white px-2 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                              >
                                تغییر آستانه ({toPersianDigits(vol.splitThresholdPages)} ص)
                              </button>
                            </div>
                          </div>

                          {vol.chapters.length > 0 && (
                            <ul className="space-y-1.5 border-t border-[#ECE7DC] pt-2">
                              {vol.chapters.map((ch) => (
                                <li
                                  key={ch.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#ECE7DC] bg-white px-2.5 py-1.5 text-xs"
                                >
                                  {renameChapterId === ch.id ? (
                                    <div className="flex flex-1 items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={renameTitle}
                                        onChange={(e) => setRenameTitle(e.target.value)}
                                        className="flex-1 rounded border border-[#1E3A5F] px-2 py-1 text-xs"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void runAction(`ren_${ch.id}`, async () => {
                                            await api.renameMasterChapter(ch.id, renameTitle);
                                            setRenameChapterId(null);
                                            return 'عنوان فصل با موفقیت تغییر یافت.';
                                          })
                                        }
                                        className="rounded bg-[#1E3A5F] px-2 py-1 text-[11px] font-bold text-white cursor-pointer"
                                      >
                                        ذخیره
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setRenameChapterId(null)}
                                        className="rounded border px-2 py-1 text-[11px] cursor-pointer"
                                      >
                                        انصراف
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="min-w-0 flex-1">
                                        <span className="font-bold text-[#1A1816]">{ch.title}</span>
                                        <span className="mr-2 text-[10.5px] text-[#78716C] tabular-nums">
                                          سطح آموزشی {toPersianDigits(ch.pedagogicalRank)} · {toPersianDigits(ch.unitCount)} واحد · {toPersianDigits(ch.wordCount)} کلمه
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRenameChapterId(ch.id);
                                          setRenameTitle(ch.title);
                                        }}
                                        className="text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                                      >
                                        تغییر نام
                                      </button>
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Domain Breakdown Table */}
                {overview && (
                  <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-2.5">
                    <h3 className="text-sm font-extrabold text-[#1A1816]">
                      تفکیک واحدهای دانش بر اساس شاخه‌های تخصصی خودرو
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs tabular-nums">
                      {overview.domainBreakdown.map((d) => (
                        <div
                          key={d.domainId}
                          className="flex items-center justify-between rounded-md border border-[#ECE7DC] bg-[#FAF9F6] px-3 py-2"
                        >
                          <span className="font-semibold text-[#292524]">{d.shortLabelFa}</span>
                          <span className="font-extrabold text-[#1E3A5F]">
                            {toPersianDigits(d.unitCount)} واحد
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Right 5 Cols: Chapter Move/Merge + Owner Initial .md Import + Reset */}
              <div className="lg:col-span-5 space-y-4">
                {/* Import Initial Markdown */}
                <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-sm font-extrabold text-[#1E3A5F]">
                    <Upload className="h-4 w-4" />
                    <span>ایمپورت اولیه Markdown مالک</span>
                  </div>
                  <p className="text-[11px] text-[#57534E] leading-5">
                    فایل `.md` مرجع خودرو را انتخاب کنید یا متن آن را وارد نمایید تا از طریق موتور Delta-Merge در مجلدات و فصل‌های مناسب ثبت شود.
                  </p>
                  <input
                    type="file"
                    accept=".md,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleImportFilePick(f);
                      e.currentTarget.value = '';
                    }}
                    className="block w-full text-xs text-[#57534E]"
                  />
                  <input
                    type="text"
                    value={importFileName}
                    onChange={(e) => setImportFileName(e.target.value)}
                    placeholder="نام فایل منبع (مثلاً automotive-master.md)"
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                  />
                  <textarea
                    rows={5}
                    value={importMarkdownText}
                    onChange={(e) => setImportMarkdownText(e.target.value)}
                    placeholder="# عنوان فصل خودرو&#10;متن فنی و جداول را اینجا وارد کنید..."
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] p-2.5 text-xs leading-6"
                  />
                  <button
                    type="button"
                    disabled={!importMarkdownText.trim() || busyAction !== null}
                    onClick={() =>
                      void runAction('import_md', async () => {
                        const res = await api.importMasterMarkdown(importFileName, importMarkdownText);
                        setImportMarkdownText('');
                        return res.summaryFa;
                      })
                    }
                    className="w-full min-h-[38px] rounded-lg bg-[#1E3A5F] px-3 py-2 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer"
                  >
                    ایمپورت و ادغام در دایرةالمعارف مرجع
                  </button>
                </section>

                {/* Move & Merge Chapters */}
                <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#1A1816]">
                    <ArrowLeftRight className="h-4 w-4 text-[#1E3A5F]" />
                    <span>انتقال فصل بین مجلدات / ادغام دو فصل</span>
                  </div>

                  <div className="space-y-2 border-b border-[#ECE7DC] pb-3">
                    <select
                      value={moveChapterId}
                      onChange={(e) => setMoveChapterId(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                    >
                      <option value="">انتخاب فصل برای انتقال...</option>
                      {allChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.volumeTitle})
                        </option>
                      ))}
                    </select>
                    <select
                      value={moveTargetVolId}
                      onChange={(e) => setMoveTargetVolId(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                    >
                      <option value="">انتخاب جلد مقصد...</option>
                      {overview?.volumes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!moveChapterId || !moveTargetVolId || busyAction !== null}
                      onClick={() =>
                        void runAction('move_ch', async () => {
                          await api.moveMasterChapter(moveChapterId, moveTargetVolId);
                          setMoveChapterId('');
                          return 'فصل به جلد مقصد منتقل شد.';
                        })
                      }
                      className="w-full rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFE9F4] disabled:opacity-50 cursor-pointer"
                    >
                      انتقال فصل
                    </button>
                  </div>

                  <div className="space-y-2">
                    <select
                      value={mergeSourceChapterId}
                      onChange={(e) => setMergeSourceChapterId(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                    >
                      <option value="">فصل مبدأ (حذف پس از ادغام)...</option>
                      {allChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <select
                      value={mergeTargetChapterId}
                      onChange={(e) => setMergeTargetChapterId(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-xs"
                    >
                      <option value="">فصل مقصد (باقی‌مانده)...</option>
                      {allChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={
                        !mergeSourceChapterId ||
                        !mergeTargetChapterId ||
                        mergeSourceChapterId === mergeTargetChapterId ||
                        busyAction !== null
                      }
                      onClick={() =>
                        void runAction('merge_ch', async () => {
                          const res = await api.mergeMasterChapters(
                            mergeSourceChapterId,
                            mergeTargetChapterId
                          );
                          setMergeSourceChapterId('');
                          return `ادغام انجام شد (${toPersianDigits(res.mergedUnits)} واحد منتقل گردید).`;
                        })
                      }
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#F5F8FC] disabled:opacity-50 cursor-pointer"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      <span>ادغام دو فصل</span>
                    </button>
                  </div>
                </section>

                {/* Clean Reset */}
                <section className="rounded-xl border border-[#E6CFC2] bg-[#FDF6F2] p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#9A3412]">
                    <Trash2 className="h-4 w-4" />
                    <span>ریست کامل دایرةالمعارف مرجع به حالت خالی</span>
                  </div>
                  <p className="text-[11px] text-[#7C2D12] leading-5">
                    برای ریست کامل تمام مجلدات، فصل‌ها، واحدها و تعارض‌ها، عبارت{' '}
                    <code className="font-mono font-bold">RESET</code> را وارد کنید:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={resetConfirmText}
                      onChange={(e) => setResetConfirmText(e.target.value)}
                      placeholder="RESET"
                      className="flex-1 rounded-lg border border-[#E6CFC2] bg-white px-2.5 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={resetConfirmText.trim() !== 'RESET' || busyAction !== null}
                      onClick={() =>
                        void runAction('reset_all', async () => {
                          const res = await api.resetMasterEncyclopedia();
                          setResetConfirmText('');
                          return res.messageFa;
                        })
                      }
                      className="rounded-lg bg-[#9A3412] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#7C2D12] disabled:opacity-40 cursor-pointer"
                    >
                      ریست کامل
                    </button>
                  </div>
                </section>
              </div>
            </div>
          ) : tab === 'queue' ? (
            <div className="space-y-5">
              {/* Source Takedown by Hash */}
              <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-2.5">
                <div className="flex items-center gap-1.5 text-sm font-extrabold text-[#9A3412]">
                  <ShieldAlert className="h-4 w-4" />
                  <span>حذف حقوقی کامل منبع بر اساس اثر انگشت (Source Takedown)</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={takedownHashInput}
                    onChange={(e) => setTakedownHashInput(e.target.value)}
                    placeholder="source_upload_hash (SHA-256) را وارد کنید..."
                    className="flex-1 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs font-mono"
                  />
                  <button
                    type="button"
                    disabled={!takedownHashInput.trim() || busyAction !== null}
                    onClick={() =>
                      void runAction('takedown', async () => {
                        const res = await api.takedownMasterSource(takedownHashInput.trim());
                        setTakedownHashInput('');
                        return `حذف حقوقی انجام شد: ${toPersianDigits(res.deletedUnits)} واحد حذف و ${toPersianDigits(res.sanitizedCorroborations)} تأیید اصلاح شد.`;
                      })
                    }
                    className="rounded-lg bg-[#9A3412] px-4 py-2 text-xs font-bold text-white hover:bg-[#7C2D12] disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    اجرای Source Takedown
                  </button>
                </div>
              </section>

              {/* Ingest Logs Table with 1-Click Rollback Batch */}
              <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  لاگ‌های پردازش (master_ingest_logs) با قابلیت بازگشت یک‌کلیکی (Rollback Batch)
                </h3>
                {!jobsLogs || jobsLogs.logs.length === 0 ? (
                  <p className="text-xs text-[#78716C]">هنوز هیچ لاگ پردازشی ثبت نشده است.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs border-collapse tabular-nums">
                      <thead>
                        <tr className="border-b border-[#E2DDD3] bg-[#F7F5EF] text-[11px] text-[#57534E]">
                          <th className="p-2">فایل منبع</th>
                          <th className="p-2">جدید / ادغام / هم‌پوشان / تعارض</th>
                          <th className="p-2">وضعیت</th>
                          <th className="p-2">اثر انگشت منبع</th>
                          <th className="p-2">عملیات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobsLogs.logs.map((log) => (
                          <tr key={log.id} className="border-b border-[#EFECE4]">
                            <td className="p-2 font-bold text-[#1A1816]">{log.sourceFileName}</td>
                            <td className="p-2">
                              +{toPersianDigits(log.newUnitsCount)} / {toPersianDigits(log.mergedUnitsCount)} /{' '}
                              {toPersianDigits(log.duplicateUnitsCount)} / {toPersianDigits(log.conflictsCount)}
                            </td>
                            <td className="p-2 font-semibold">{log.status}</td>
                            <td className="p-2 font-mono text-[10.5px] text-[#57534E]">
                              <div className="inline-flex items-center gap-1.5">
                                <span title={log.sourceUploadHash}>
                                  {log.sourceUploadHash.slice(0, 14)}...
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard
                                      ?.writeText(log.sourceUploadHash)
                                      .then(() => setToast('اثر انگشت SHA-256 در حافظه کپی شد.'))
                                      .catch(() => undefined);
                                  }}
                                  title="کپی کامل SHA-256"
                                  aria-label="کپی کامل اثر انگشت SHA-256"
                                  className="rounded border border-[#E2DDD3] bg-[#FAF9F6] p-1 text-[#57534E] hover:text-[#1E3A5F] cursor-pointer"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={log.status === 'rolled_back' || busyAction !== null}
                                  onClick={() =>
                                    void runAction(`rb_${log.ingestBatchId}`, async () => {
                                      const res = await api.rollbackMasterBatch(log.ingestBatchId);
                                      return `دسته ${log.ingestBatchId} بازگشت داده شد (${toPersianDigits(res.deletedUnits)} حذف، ${toPersianDigits(res.revertedUnits)} بازیابی).`;
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded border border-[#D6D0C4] bg-white px-2 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-40 cursor-pointer"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  <span>Rollback Batch</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTakedownHashInput(log.sourceUploadHash)}
                                  className="rounded border border-[#E6CFC2] bg-[#FDF6F2] px-2 py-1 text-[11px] font-bold text-[#9A3412] cursor-pointer"
                                >
                                  Takedown
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Persistent Jobs Queue */}
              <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  صف پس‌زمینه پایدار (master_ingest_jobs)
                </h3>
                {!jobsLogs || jobsLogs.jobs.length === 0 ? (
                  <p className="text-xs text-[#78716C]">صف پردازش خالی است.</p>
                ) : (
                  <div className="space-y-1.5 text-xs tabular-nums">
                    {jobsLogs.jobs.slice(0, 20).map((job) => (
                      <div
                        key={job.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#ECE7DC] bg-[#FAF9F6] px-3 py-2"
                      >
                        <div>
                          <span className="font-bold text-[#1A1816]">{job.sourceFileName}</span>
                          <span className="mr-2 text-[11px] text-[#57534E]">
                            نقش: {job.submittedByRole} · تلاش {toPersianDigits(job.attempts)} از {toPersianDigits(job.maxAttempts)}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] font-bold text-[#1E3A5F]">
                          {job.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : tab === 'moderation' ? (
            <div className="space-y-5">
              {/* Staging Units Queue */}
              <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  صف بازبینی واحدهای حساس (Staging — گاردهای فیزیکی نسل ۲، معادله داینو و داده‌های ریمپ)
                </h3>
                {!staging || staging.stagingUnits.length === 0 ? (
                  <p className="text-xs text-[#78716C]">
                    هیچ واحد دانشی در صف Staging منتظر تأیید نیست.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {staging.stagingUnits.map((u) => {
                      const rawMeta = (
                        u as { technicalMetadataJson?: Record<string, unknown> | null }
                      ).technicalMetadataJson;
                      const meta = (rawMeta ?? {}) as {
                        evidenceTierRank?: number;
                        evidenceTierWeight?: number;
                        contextScope?: Record<string, string | undefined>;
                        physicalGuardWarnings?: Array<{
                          kind?: string;
                          code?: string;
                          severity: string;
                          messageFa: string;
                        }>;
                      };
                      const physWarnings = Array.isArray(meta.physicalGuardWarnings)
                        ? meta.physicalGuardWarnings
                        : [];
                      const scopeEntries = meta.contextScope
                        ? Object.entries(meta.contextScope).filter(([, v]) => Boolean(v))
                        : [];

                      return (
                        <div
                          key={u.id}
                          className="rounded-lg border border-[#E5E0D6] bg-[#FCFBF8] p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E] tabular-nums">
                            <span>
                              دامنه: <strong>{u.domainTag}</strong> · سطح سند:{' '}
                              <code>{u.evidenceTier}</code>
                              {meta.evidenceTierWeight !== undefined
                                ? ` (وزن اعتبار: ${toPersianDigits(meta.evidenceTierWeight)})`
                                : ''}{' '}
                              · تأیید مستقل: {toPersianDigits(u.corroborationCount)}
                            </span>
                            <span className="font-mono">{u.id}</span>
                          </div>

                          {scopeEntries.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                              <span className="font-bold text-[#1E3A5F]">ContextScope:</span>
                              {scopeEntries.map(([k, v]) => (
                                <span
                                  key={k}
                                  className="rounded border border-[#D8E2EE] bg-[#F4F7FB] px-1.5 py-0.5 font-mono text-[10px] text-[#1E3A5F]"
                                  dir="ltr"
                                >
                                  {k}={v}
                                </span>
                              ))}
                            </div>
                          )}

                          {physWarnings.length > 0 && (
                            <div className="rounded-md border border-[#E6CFC2] bg-[#FDF2F0] p-2.5 space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#9A3412]">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                  قرنطینه غیرمخرب گارد فیزیکی نسل ۲ (نیازمند بازبینی متخصص بدون حذف داده):
                                </span>
                              </div>
                              <ul className="list-disc pr-4 space-y-0.5 text-[11px] text-[#7C2D12]">
                                {physWarnings.map((w, idx) => (
                                  <li key={`${u.id}-pw-${idx}`}>
                                    <code className="font-mono font-bold">[{w.kind ?? w.code}]</code>{' '}
                                    {w.messageFa}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <p className="whitespace-pre-wrap text-xs leading-6 text-[#1A1816]">
                            {u.cleanText}
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void runAction(`stg_ok_${u.id}`, async () => {
                                  await api.moderateMasterStagingUnit(u.id, 'approve');
                                  return 'واحد دانش تأیید و وارد نسخه مرجع شد.';
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-[#14532D] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0F4022] cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>تأیید متخصص و انتشار</span>
                            </button>
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void runAction(`stg_rej_${u.id}`, async () => {
                                  await api.moderateMasterStagingUnit(u.id, 'reject');
                                  return 'واحد دانش رد شد.';
                                })
                              }
                              className="rounded-md border border-[#E6CFC2] bg-[#FDF2F0] px-3 py-1.5 text-xs font-bold text-[#9A3412] cursor-pointer"
                            >
                              رد کردن
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Technical Conflicts Queue */}
              <section className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-[#9A3412]">
                  صف تعارض‌های فنی (master_conflicts)
                </h3>
                {openConflicts.length === 0 ? (
                  <p className="text-xs text-[#78716C]">هیچ تعارض فنی بازی وجود ندارد.</p>
                ) : (
                  <div className="space-y-3">
                    {openConflicts.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border border-[#E6CFC2] bg-[#FFFBF9] p-3.5 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <strong className="text-[#9A3412]">{c.topic}</strong>
                          <span className="font-mono text-[11px] text-[#57534E]">
                            نوع تعارض: {c.conflictType}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                          <div className="rounded-md border border-[#E2DDD3] bg-white p-2.5">
                            <div className="text-[10.5px] font-bold text-[#1E3A5F] mb-1">
                              نسخه فعلی در دایرةالمعارف
                            </div>
                            <p className="whitespace-pre-wrap leading-6">{c.existingExcerpt}</p>
                          </div>
                          <div className="rounded-md border border-[#E2DDD3] bg-white p-2.5">
                            <div className="text-[10.5px] font-bold text-[#854D0E] mb-1">
                              روایت ورودی جدید
                            </div>
                            <p className="whitespace-pre-wrap leading-6">{c.incomingExcerpt}</p>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={conditionInputs[c.id] ?? c.conditionContext ?? ''}
                          onChange={(e) =>
                            setConditionInputs((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                          placeholder="شرط تفاوت (مثلاً بنزین اکتان ۹۸ / موتور GDI / مدل ۲۰۲۳)..."
                          className="w-full rounded-lg border border-[#D6D0C4] bg-white px-2.5 py-1.5 text-xs"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void runAction(`cf_cond_${c.id}`, async () => {
                                await api.resolveMasterConflict(c.id, {
                                  resolution: 'merged_conditional',
                                  conditionContext: conditionInputs[c.id] ?? c.conditionContext ?? undefined,
                                });
                                return 'ادغام شرطی با حفظ هر دو نسخه ثبت شد.';
                              })
                            }
                            className="rounded-md bg-[#1E3A5F] px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                          >
                            ادغام شرطی (حفظ هر دو نسخه)
                          </button>
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void runAction(`cf_inc_${c.id}`, async () => {
                                await api.resolveMasterConflict(c.id, {
                                  resolution: 'approved_incoming',
                                });
                                return 'نسخه جدید جایگزین و تأیید شد.';
                              })
                            }
                            className="rounded-md bg-[#14532D] px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                          >
                            تأیید نسخه جدید
                          </button>
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void runAction(`cf_ex_${c.id}`, async () => {
                                await api.resolveMasterConflict(c.id, {
                                  resolution: 'approved_existing',
                                });
                                return 'نسخه قبلی حفظ شد.';
                              })
                            }
                            className="rounded-md border border-[#D6D0C4] bg-white px-3 py-1.5 text-xs font-bold text-[#1A1816] cursor-pointer"
                          >
                            حفظ نسخه فعلی
                          </button>
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void runAction(`cf_rej_${c.id}`, async () => {
                                await api.resolveMasterConflict(c.id, { resolution: 'rejected' });
                                return 'تعارض رد و بسته شد.';
                              })
                            }
                            className="rounded-md border border-[#E6CFC2] bg-[#FDF2F0] px-3 py-1.5 text-xs font-bold text-[#9A3412] cursor-pointer"
                          >
                            رد کردن
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            /* Tab 4: Knowledge Linter & One-Click Exports */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Exports */}
              <section className="lg:col-span-7 rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-extrabold text-[#1E3A5F]">
                    <Download className="h-4 w-4" />
                    <span>خروجی‌های یک‌کلیکی استاندارد (۱۰۰٪ واقعی و معتبر)</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-[#1A1816]">
                    محدوده خروجی (کل دایرةالمعارف یا یک جلد خاص)
                  </label>
                  <select
                    value={exportVolumeId}
                    onChange={(e) => setExportVolumeId(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs"
                  >
                    <option value="">تمام مجلدات منتشرشده</option>
                    {overview?.volumes.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDownload('md')}
                    className="flex items-center gap-2.5 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] p-3 text-right hover:border-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                  >
                    <FileText className="h-5 w-5 text-[#1E3A5F] shrink-0" />
                    <div>
                      <div className="text-xs font-extrabold">خروجی Markdown (.md)</div>
                      <div className="text-[10.5px] text-[#57534E]">ایزولاسیون BiDi (U+2066..U+2069)</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDownload('docx')}
                    className="flex items-center gap-2.5 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] p-3 text-right hover:border-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                  >
                    <BookMarked className="h-5 w-5 text-[#14532D] shrink-0" />
                    <div>
                      <div className="text-xs font-extrabold">خروجی Word فارسی (.docx)</div>
                      <div className="text-[10.5px] text-[#57534E]">فونت وزیر + &lt;w:rtl w:val=&quot;0&quot;/&gt;</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDownload('csv')}
                    className="flex items-center gap-2.5 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] p-3 text-right hover:border-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                  >
                    <FileSpreadsheet className="h-5 w-5 text-[#14532D] shrink-0" />
                    <div>
                      <div className="text-xs font-extrabold">جدول Google Sheets / Excel (.csv)</div>
                      <div className="text-[10.5px] text-[#57534E]">Strict Null Policy + evidence_tier</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDownload('a2l')}
                    className="flex items-center gap-2.5 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] p-3 text-right hover:border-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                  >
                    <FileCode2 className="h-5 w-5 text-[#1E3A5F] shrink-0" />
                    <div>
                      <div className="text-xs font-extrabold">WinOLS 2.24 & 5 ASAP2 (.a2l)</div>
                      <div className="text-[10.5px] text-[#57534E]">ASAP2 v1.60 معتبر (فقط نقشه‌های کامل)</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDownload('xdf')}
                    className="flex items-center gap-2.5 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] p-3 text-right hover:border-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                  >
                    <FileCode2 className="h-5 w-5 text-[#854D0E] shrink-0" />
                    <div>
                      <div className="text-xs font-extrabold">TunerPro Definition (.xdf)</div>
                      <div className="text-[10.5px] text-[#57534E]">XML استاندارد با BASEOFFSET و MATH</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDownload('json')}
                    className="flex items-center gap-2.5 rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] p-3 text-right hover:border-[#1E3A5F] hover:bg-[#EEF3F8] cursor-pointer"
                  >
                    <Database className="h-5 w-5 text-[#1E3A5F] shrink-0" />
                    <div>
                      <div className="text-xs font-extrabold">Calibration Spec (.json)</div>
                      <div className="text-[10.5px] text-[#57534E]">بدون باینری خام · flashReady: false</div>
                    </div>
                  </button>
                </div>
              </section>

              {/* Knowledge Linter */}
              <section className="lg:col-span-5 rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-extrabold text-[#1A1816]">
                    <Sparkles className="h-4 w-4 text-[#1E3A5F]" />
                    <span>ممیزی سلامت دانش (Knowledge Linter)</span>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      void runAction('linter', async () => {
                        const rep = await api.runMasterKnowledgeLinter();
                        setLinterReport(rep);
                        return rep.healthy
                          ? 'ممیزی سلامت دانش با موفقیت انجام شد: ساختار کاملاً سالم است.'
                          : 'ممیزی سلامت دانش تکمیل شد: مواردی برای اصلاح شناسایی گردید.';
                      })
                    }
                    className="rounded-lg bg-[#1E3A5F] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] cursor-pointer"
                  >
                    اجرای Linter
                  </button>
                </div>

                {linterReport ? (
                  <div className="space-y-2.5 text-xs tabular-nums">
                    <div
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 font-bold ${
                        linterReport.healthy
                          ? 'border-[#C7DDD0] bg-[#EEF6F0] text-[#14532D]'
                          : 'border-[#E6CFC2] bg-[#FDF6F2] text-[#9A3412]'
                      }`}
                    >
                      {linterReport.healthy ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                      )}
                      <span>
                        {linterReport.healthy
                          ? 'هیچ فصل یتیم یا تعارض بین‌جلدی یافت نشد.'
                          : `${toPersianDigits(linterReport.orphanChapters.length)} فصل یتیم · ${toPersianDigits(linterReport.crossVolumeConflicts.length)} تعارض بین‌جلدی`}
                      </span>
                    </div>

                    {linterReport.orphanChapters.length > 0 && (
                      <div className="space-y-1">
                        <div className="font-bold text-[#854D0E]">فصل‌های بدون محتوا (یتیم):</div>
                        {linterReport.orphanChapters.map((oc) => (
                          <div
                            key={oc.chapterId}
                            className="rounded border border-[#ECE7DC] bg-[#FAF9F6] px-2.5 py-1.5"
                          >
                            {oc.title}
                          </div>
                        ))}
                      </div>
                    )}

                    {linterReport.crossVolumeConflicts.length > 0 && (
                      <div className="space-y-1">
                        <div className="font-bold text-[#9A3412]">تعارض‌های بین‌جلدی:</div>
                        {linterReport.crossVolumeConflicts.map((cv, idx) => (
                          <div
                            key={idx}
                            className="rounded border border-[#E6CFC2] bg-[#FDF6F2] px-2.5 py-1.5 text-[#9A3412]"
                          >
                            {cv.detailFa}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#57534E] leading-6">
                    برای بررسی فصل‌های خالی (یتیم)، تعارض‌های بین‌جلدی (مثلاً برق خودرو در برابر ریمپ) و واحدهای منسوخ، روی «اجرای Linter» کلیک کنید.
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
