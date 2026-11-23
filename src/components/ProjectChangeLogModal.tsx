import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  Bot,
  CheckCircle2,
  Cpu,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  User as UserIcon,
  X,
} from 'lucide-react';
import {
  computeRevisionMetricDeltas,
  exportRevisionsToCsv,
  exportRevisionsToJson,
  filterProjectRevisions,
  formatRevisionTimestampFa,
  getActionLabelFa,
  getActorLabelFa,
  ProjectRevisionDto,
  RevisionActorFilter,
  RevisionCategoryFilter,
} from '../lib/changeLogUtils';
import { toPersianDigits } from '../lib/formatParsers';

interface ProjectChangeLogModalProps {
  open: boolean;
  projectTitle: string;
  revisions: ProjectRevisionDto[];
  loading: boolean;
  error: string | null;
  rollingBackId: string | null;
  savingCheckpoint?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRollback: (revision: ProjectRevisionDto) => Promise<void>;
  onCreateCheckpoint?: (note: string) => Promise<void>;
}

const CATEGORY_TABS: Array<{ id: RevisionCategoryFilter; label: string }> = [
  { id: 'all', label: 'همه رویدادها' },
  { id: 'files_merge', label: 'فایل و ادغام' },
  { id: 'ai', label: 'هوش مصنوعی' },
  { id: 'winols', label: 'WinOLS و داموس' },
  { id: 'export', label: 'خروجی و چاپ' },
  { id: 'settings', label: 'تنظیمات و بازیابی' },
];

function triggerLedgerDownload(content: string, mimeType: string, fileName: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const ProjectChangeLogModal: React.FC<ProjectChangeLogModalProps> = ({
  open,
  projectTitle,
  revisions,
  loading,
  error,
  rollingBackId,
  savingCheckpoint = false,
  onClose,
  onRefresh,
  onRollback,
  onCreateCheckpoint,
}) => {
  const [actorFilter, setActorFilter] = useState<RevisionActorFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<RevisionCategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmingRevisionId, setConfirmingRevisionId] = useState<string | null>(null);
  const [checkpointFormOpen, setCheckpointFormOpen] = useState(false);
  const [checkpointNote, setCheckpointNote] = useState('');

  useEffect(() => {
    if (!open) {
      setConfirmingRevisionId(null);
      setCheckpointFormOpen(false);
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const counts = useMemo(() => {
    let userCount = 0;
    let aiCount = 0;
    for (const r of revisions) {
      if (r.actorType === 'user') userCount += 1;
      else aiCount += 1;
    }
    return { all: revisions.length, user: userCount, ai: aiCount };
  }, [revisions]);

  const metricDeltas = useMemo(() => computeRevisionMetricDeltas(revisions), [revisions]);

  const filtered = useMemo(
    () =>
      filterProjectRevisions(revisions, {
        actorFilter,
        categoryFilter,
        query: searchQuery,
      }),
    [revisions, actorFilter, categoryFilter, searchQuery]
  );

  const latestVersionNumber = revisions.length > 0 ? revisions[0].versionNumber : 0;

  if (!open) return null;

  const handleSaveCheckpointSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateCheckpoint) return;
    await onCreateCheckpoint(checkpointNote.trim());
    setCheckpointNote('');
    setCheckpointFormOpen(false);
  };

  const handleExportJson = () => {
    const json = exportRevisionsToJson(projectTitle, revisions);
    triggerLedgerDownload(json, 'application/json;charset=utf-8', 'project-audit-history.json');
  };

  const handleExportCsv = () => {
    const csv = exportRevisionsToCsv(revisions);
    triggerLedgerDownload(csv, 'text/csv;charset=utf-8', 'project-audit-history.csv');
  };

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="تاریخچه جامع تغییرات پروژه"
      className="no-print fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]"
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 flex h-full w-full max-w-[600px] flex-col border-r border-[#D6D0C4] bg-[#FCFBF8] shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E2DDD3] bg-white px-5 py-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-[#1E3A5F]">
              <History className="h-4 w-4 shrink-0" />
              <h2 className="text-sm sm:text-base font-extrabold text-[#1A1816]">
                دفترکل جامع تاریخچه و وقایع پروژه
              </h2>
            </div>
            <p className="truncate text-xs text-[#57534E] tabular-nums">
              {projectTitle} — {toPersianDigits(revisions.length)} رویداد و نسخه ثبت‌شده
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onCreateCheckpoint && (
              <button
                type="button"
                onClick={() => setCheckpointFormOpen((v) => !v)}
                disabled={savingCheckpoint}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#1E3A5F] px-3 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {savingCheckpoint ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <BookmarkPlus className="h-3.5 w-3.5" />
                )}
                <span>ثبت نقطه بازیابی</span>
              </button>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label="به‌روزرسانی تاریخچه تغییرات"
              title="به‌روزرسانی"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2DDD3] bg-[#FAF9F6] text-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن تاریخچه تغییرات"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2DDD3] bg-[#FAF9F6] text-[#57534E] hover:bg-[#EFECE4] hover:text-[#1A1816] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Manual Checkpoint Inline Form */}
        {checkpointFormOpen && onCreateCheckpoint && (
          <form
            onSubmit={handleSaveCheckpointSubmit}
            className="border-b border-[#D8D2C5] bg-[#F2F6FA] px-5 py-3 space-y-2"
          >
            <label className="block text-xs font-bold text-[#1E3A5F]">
              عنوان یا یادداشت نقطه بازیابی دستی (Snapshot کامل ذخیره می‌شود):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={checkpointNote}
                onChange={(e) => setCheckpointNote(e.target.value)}
                placeholder="مثلاً: پیش از اعمال تغییرات EF7 یا قبل از بازنویسی فصل ۸"
                className="flex-1 rounded-lg border border-[#C6D2E0] bg-white px-3 py-1.5 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingCheckpoint}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-[#14532D] px-3 py-1 text-xs font-bold text-white hover:bg-[#166534] disabled:opacity-50 cursor-pointer"
              >
                {savingCheckpoint ? 'در حال ثبت...' : 'ذخیره نسخه'}
              </button>
            </div>
          </form>
        )}

        {/* Filter & Search Bar */}
        <div className="border-b border-[#E2DDD3] bg-[#FAF8F4] px-5 py-3 space-y-2.5">
          <div className="flex items-center gap-1 rounded-lg bg-[#EFECE4] p-1">
            {(
              [
                { id: 'all', label: `همه (${toPersianDigits(counts.all)})` },
                { id: 'user', label: `کاربر (${toPersianDigits(counts.user)})` },
                { id: 'ai', label: `هوش مصنوعی و موتور (${toPersianDigits(counts.ai)})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActorFilter(tab.id)}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors tabular-nums cursor-pointer whitespace-nowrap ${
                  actorFilter === tab.id
                    ? 'bg-white text-[#1E3A5F] shadow-xs'
                    : 'text-[#57534E] hover:text-[#1A1816]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Category Filter Row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORY_TABS.map((cat) => {
              const active = categoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                    active
                      ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                      : 'border-[#DDD6C9] bg-white text-[#57534E] hover:bg-[#F3F0E8]'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو در عنوان، شماره نسخه، نام فایل، خروجی A2L/DOCX یا اقدام..."
              aria-label="جستجو در تاریخچه تغییرات"
              className="w-full rounded-lg border border-[#D8D2C5] bg-white py-2 pr-9 pl-3 text-xs text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1E3A5F] focus:outline-none"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-[#F2B8B5] bg-[#FEF3F2] p-3 text-xs text-[#9A2E1A]">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="font-bold underline cursor-pointer"
                >
                  تلاش مجدد
                </button>
              </div>
            </div>
          )}

          {loading && revisions.length === 0 ? (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="rounded-xl border border-[#E6E0D4] bg-white p-4 space-y-2 animate-pulse"
                >
                  <div className="h-3 w-32 rounded bg-[#ECE7DD]" />
                  <div className="h-4 w-3/4 rounded bg-[#ECE7DD]" />
                  <div className="h-3 w-full rounded bg-[#F3F0E8]" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-[#E2DDD3] bg-white p-8 text-center space-y-2">
              <History className="mx-auto h-7 w-7 text-[#A8A29E]" />
              <h3 className="text-sm font-bold text-[#1A1816]">
                {revisions.length === 0
                  ? 'هنوز تغییری برای این پروژه ثبت نشده است'
                  : 'موردی مطابق فیلتر یا جستجوی شما یافت نشد'}
              </h3>
              <p className="text-xs text-[#57534E] leading-6">
                تمام بارگذاری‌ها، ادغام‌ها، تحلیل‌های هوش مصنوعی، خروجی‌های Word/DAMOS (.a2l) و نقاط بازیابی دستی در این دفترکل ثبت می‌شوند.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {filtered.map((rev) => {
                const isLatest = rev.versionNumber === latestVersionNumber;
                const isConfirming = confirmingRevisionId === rev.id;
                const isRollingBack = rollingBackId === rev.id;
                const isAi = rev.actorType === 'ai';
                const isSystem = rev.actorType === 'system';
                const delta = metricDeltas[rev.id];

                return (
                  <li
                    key={rev.id}
                    className={`rounded-xl border bg-white p-4 transition-colors ${
                      isLatest ? 'border-[#1E3A5F]/45' : 'border-[#E2DDD3]'
                    }`}
                  >
                    {/* Unboxed Typographic Metadata Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E] tabular-nums">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 font-bold text-[#1E3A5F]">
                          {isAi ? (
                            <Bot className="h-3.5 w-3.5 text-[#5B21B6]" />
                          ) : isSystem ? (
                            <Cpu className="h-3.5 w-3.5 text-[#14532D]" />
                          ) : (
                            <UserIcon className="h-3.5 w-3.5 text-[#1E3A5F]" />
                          )}
                          <span>نسخه {toPersianDigits(rev.versionNumber)}</span>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            isAi
                              ? 'text-[#5B21B6]'
                              : isSystem
                                ? 'text-[#14532D]'
                                : 'text-[#1A1816]'
                          }`}
                        >
                          {getActorLabelFa(rev.actorType)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#78716C]">{getActionLabelFa(rev.actionType)}</span>
                      </div>

                      <time dateTime={rev.createdAt} className="text-[#78716C] shrink-0">
                        {formatRevisionTimestampFa(rev.createdAt)}
                      </time>
                    </div>

                    {/* Title & Summary */}
                    <div className="mt-2 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[13.5px] font-extrabold text-[#1A1816] leading-snug">
                          {rev.title}
                        </h3>
                        {isLatest && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-[#14532D]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>آخرین ثبت</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs leading-6 text-[#44403C]">{rev.summary}</p>
                    </div>

                    {/* Before/After Delta & Export Details */}
                    {(delta &&
                      (delta.chaptersDelta !== 0 ||
                        delta.unitsDelta !== 0 ||
                        delta.openConflictsDelta !== 0)) ||
                    rev.details?.exportFormat ||
                    rev.details?.fileName ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] font-bold tabular-nums">
                        {delta && delta.chaptersDelta !== 0 && (
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              delta.chaptersDelta > 0
                                ? 'bg-[#ECFDF5] text-[#14532D]'
                                : 'bg-[#FEF3C7] text-[#92400E]'
                            }`}
                          >
                            {delta.chaptersDelta > 0 ? '+' : ''}
                            {toPersianDigits(delta.chaptersDelta)} فصل
                          </span>
                        )}
                        {delta && delta.unitsDelta !== 0 && (
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              delta.unitsDelta > 0
                                ? 'bg-[#EEF3F8] text-[#1E3A5F]'
                                : 'bg-[#F3F0E8] text-[#57534E]'
                            }`}
                          >
                            {delta.unitsDelta > 0 ? '+' : ''}
                            {toPersianDigits(delta.unitsDelta)} واحد
                          </span>
                        )}
                        {delta && delta.openConflictsDelta !== 0 && (
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              delta.openConflictsDelta < 0
                                ? 'bg-[#ECFDF5] text-[#14532D]'
                                : 'bg-[#FEF2F2] text-[#991B1B]'
                            }`}
                          >
                            {delta.openConflictsDelta > 0 ? '+' : ''}
                            {toPersianDigits(delta.openConflictsDelta)} تناقض باز
                          </span>
                        )}
                        {rev.details?.exportFormat && (
                          <span dir="ltr" className="rounded bg-[#EEF3F8] px-1.5 py-0.5 font-mono text-[#1E3A5F]">
                            {rev.details.exportFormat}
                          </span>
                        )}
                        {rev.details?.fileName && (
                          <span dir="ltr" className="truncate max-w-[220px] font-mono text-[#57534E]">
                            {rev.details.fileName}
                          </span>
                        )}
                      </div>
                    ) : null}

                    {/* Snapshot Metrics & Rollback Action */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0ECE3] pt-2.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#78716C] tabular-nums">
                        {typeof rev.details.pipelineStage === 'number' && (
                          <span>مرحله {toPersianDigits(rev.details.pipelineStage)}</span>
                        )}
                        {typeof rev.details.chaptersCount === 'number' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{toPersianDigits(rev.details.chaptersCount)} فصل</span>
                          </>
                        )}
                        {typeof rev.details.unitsCount === 'number' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{toPersianDigits(rev.details.unitsCount)} واحد</span>
                          </>
                        )}
                        {rev.hasSnapshot && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#14532D] font-semibold">قابل بازگردانی</span>
                          </>
                        )}
                      </div>

                      {!isLatest && rev.hasSnapshot && !isConfirming && (
                        <button
                          type="button"
                          disabled={Boolean(rollingBackId)}
                          onClick={() => setConfirmingRevisionId(rev.id)}
                          aria-label={`بازگشت به نسخه ${rev.versionNumber}`}
                          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#1E3A5F]/35 bg-[#F5F8FC] px-3 py-1 text-xs font-bold text-[#1E3A5F] hover:bg-[#E5EFF9] disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                          <span>بازگشت به این نسخه</span>
                        </button>
                      )}
                    </div>

                    {/* Inline Non-Blocking Rollback Confirmation */}
                    {isConfirming && (
                      <div className="mt-3 rounded-lg border border-[#E6C79C] bg-[#FDF8EE] p-3 space-y-2.5">
                        <p className="text-xs leading-6 text-[#6B420D]">
                          آیا مطمئن هستید که می‌خواهید ساختار فصل‌ها، وضعیت تناقض‌ها و متن کتاب را به{' '}
                          <strong>نسخه {toPersianDigits(rev.versionNumber)}</strong> بازگردانید؟
                          وضعیت فعلی شما نیز در تاریخچه حفظ می‌شود و هیچ داده‌ای از بین نمی‌رود.
                        </p>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={isRollingBack}
                            onClick={() => setConfirmingRevisionId(null)}
                            className="min-h-[34px] rounded-lg border border-[#D6D0C4] bg-white px-3 py-1 text-xs font-semibold text-[#57534E] hover:bg-[#FAF9F6] cursor-pointer"
                          >
                            انصراف
                          </button>
                          <button
                            type="button"
                            disabled={isRollingBack}
                            onClick={async () => {
                              await onRollback(rev);
                              setConfirmingRevisionId(null);
                            }}
                            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3.5 py-1 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-60 cursor-pointer"
                          >
                            {isRollingBack ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>در حال بازگردانی...</span>
                              </>
                            ) : (
                              <>
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>تأیید و بازگشت</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Footer Audit Export Bar */}
        <div className="border-t border-[#E2DDD3] bg-white px-5 py-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-[#78716C]">
            تمامی وقایع بدون حذف تاریخچه ثبت می‌شوند.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={revisions.length === 0}
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1 rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-bold text-[#1A1816] hover:bg-[#EFECE4] disabled:opacity-40 cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#14532D]" />
              خروجی CSV
            </button>
            <button
              type="button"
              disabled={revisions.length === 0}
              onClick={handleExportJson}
              className="inline-flex items-center gap-1 rounded-md border border-[#1E3A5F]/40 bg-[#F5F8FC] px-2.5 py-1 text-[11px] font-bold text-[#1E3A5F] hover:bg-[#E5EFF9] disabled:opacity-40 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              خروجی JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
