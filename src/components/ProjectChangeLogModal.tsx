import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cpu,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  User as UserIcon,
  X,
} from 'lucide-react';
import {
  filterProjectRevisions,
  formatRevisionTimestampFa,
  getActorLabelFa,
  ProjectRevisionDto,
  RevisionActorFilter,
} from '../lib/changeLogUtils';
import { toPersianDigits } from '../lib/formatParsers';

interface ProjectChangeLogModalProps {
  open: boolean;
  projectTitle: string;
  revisions: ProjectRevisionDto[];
  loading: boolean;
  error: string | null;
  rollingBackId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onRollback: (revision: ProjectRevisionDto) => Promise<void>;
}

export const ProjectChangeLogModal: React.FC<ProjectChangeLogModalProps> = ({
  open,
  projectTitle,
  revisions,
  loading,
  error,
  rollingBackId,
  onClose,
  onRefresh,
  onRollback,
}) => {
  const [actorFilter, setActorFilter] = useState<RevisionActorFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmingRevisionId, setConfirmingRevisionId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmingRevisionId(null);
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

  const filtered = useMemo(
    () =>
      filterProjectRevisions(revisions, {
        actorFilter,
        query: searchQuery,
      }),
    [revisions, actorFilter, searchQuery]
  );

  const latestVersionNumber = revisions.length > 0 ? revisions[0].versionNumber : 0;

  if (!open) return null;

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="تاریخچه تغییرات پروژه"
      className="no-print fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]"
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 flex h-full w-full max-w-[540px] flex-col border-r border-[#D6D0C4] bg-[#FCFBF8] shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E2DDD3] bg-white px-5 py-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-[#1E3A5F]">
              <History className="h-4 w-4 shrink-0" />
              <h2 className="text-sm sm:text-base font-extrabold text-[#1A1816]">
                تاریخچه تغییرات پروژه (Change Log)
              </h2>
            </div>
            <p className="truncate text-xs text-[#57534E] tabular-nums">
              {projectTitle} · {toPersianDigits(revisions.length)} نسخه ثبت‌شده
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
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

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 text-[#78716C]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو در عنوان تغییر، شماره نسخه یا اقدام..."
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
                با هر بارگذاری فایل، ویرایش فصل، حل تناقض یا اجرای هوش مصنوعی، یک نسخه قابل بازگشت به‌صورت خودکار ثبت می‌شود.
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
                        <span className="truncate max-w-[160px]">{rev.actorName}</span>
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
                            <span>نسخه فعلی</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs leading-6 text-[#44403C]">{rev.summary}</p>
                    </div>

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
                        {rev.details.hasBookSnapshot && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#14532D] font-semibold">دارای پیش‌نمایش کتاب</span>
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

        {/* Footer Note */}
        <div className="border-t border-[#E2DDD3] bg-white px-5 py-3 text-[11px] text-[#78716C] flex items-center justify-between gap-2">
          <span>بازگشت به هر نسخه به‌عنوان یک رکورد جدید ثبت می‌شود (بدون حذف تاریخچه).</span>
        </div>
      </div>
    </div>
  );
};
