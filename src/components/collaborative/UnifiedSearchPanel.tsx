import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Cloud,
  ExternalLink,
  FileCode2,
  FileText,
  HardDrive,
  History,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import {
  listDriveFolderContents,
  type LiveDriveBrowserEntry,
} from '../../lib/googleWorkspace';

interface Props {
  apiClient: ApiClient;
  initialQuery: string;
  workspaceAccessToken: string | null;
  driveRootFolderId: string | null;
  onConnectWorkspace: () => Promise<string | null>;
  onOpenChapter: (volumeId: string, chapterId: string) => void;
}

type SearchResultData = Awaited<ReturnType<ApiClient['searchCollabAll']>>;

function highlightQueryText(text: string, term: string): React.ReactNode {
  const cleanTerm = term.trim();
  if (!cleanTerm || cleanTerm.length < 2) return text;
  const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(rx);
  if (parts.length <= 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === cleanTerm.toLowerCase() ? (
      <mark
        key={i}
        className="rounded bg-[#FEF08A] px-0.5 font-semibold text-[#1A1816]"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

export const UnifiedSearchPanel: React.FC<Props> = ({
  apiClient,
  initialQuery,
  workspaceAccessToken,
  driveRootFolderId,
  onConnectWorkspace,
  onOpenChapter,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResultData | null>(null);
  const [liveDriveMatches, setLiveDriveMatches] = useState<LiveDriveBrowserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runSearch = async (q: string, tokenOverride?: string | null) => {
    const clean = q.trim();
    if (clean.length < 2) {
      setResults(null);
      setLiveDriveMatches([]);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    const activeToken = tokenOverride !== undefined ? tokenOverride : workspaceAccessToken;
    try {
      const [dbRes, liveRes] = await Promise.all([
        apiClient.searchCollabAll(clean),
        activeToken
          ? listDriveFolderContents({
              accessToken: activeToken,
              folderId: driveRootFolderId || undefined,
              searchQuery: clean,
            }).catch(() => [] as LiveDriveBrowserEntry[])
          : Promise.resolve([] as LiveDriveBrowserEntry[]),
      ]);
      setResults(dbRes);
      setLiveDriveMatches(liveRes.filter((item) => !item.isFolder));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در جستجوی سراسری.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setQuery(initialQuery);
    if (initialQuery.trim().length >= 2) {
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const handleConnectAndSearchDrive = async () => {
    const token = await onConnectWorkspace();
    if (token && query.trim().length >= 2) {
      await runSearch(query, token);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query);
        }}
        className="rounded-2xl border border-[#E2DDD3] bg-white p-5"
      >
        <h2 className="mb-1 text-base font-bold text-[#1A1816]">
          جستجوی سراسری و هوشمند دیتابیس خودرو
        </h2>
        <p className="mb-4 text-xs text-[#6B645B]">
          جستجوی هم‌زمان در متن همه جلدهای مرجع، کدهای خطا (DTC)، مدل خودرو، ECU (مثلاً ME7.4.4)،
          فایل‌های WinOLS (.ols / .kp)، PDF و فایل‌های زنده Google Drive
        </p>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3.5 top-3 h-4 w-4 text-[#8C8375]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو بر اساس کد خطا (P0171)، مدل خودرو (206)، ECU (Bosch ME7.4.4)، جدول (KFZW) یا کلیدواژه..."
              aria-label="عبارت جستجوی سراسری دیتابیس خودرو"
              className="w-full rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] py-2.5 pl-9 pr-10 text-sm text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults(null);
                  setLiveDriveMatches([]);
                  setErrorMsg(null);
                }}
                aria-label="پاک کردن جستجو"
                className="absolute left-2.5 top-2.5 rounded-lg p-1 text-[#8C8375] hover:bg-[#EFEAE0] hover:text-[#1A1816]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || query.trim().length < 2}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#162C49] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            جستجو
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B645B]">
          <div className="flex flex-wrap items-center gap-2">
            <span>پیشنهادهای سریع:</span>
            {['ME7.4.4', 'CAN', 'P0171', 'KFZW', 'SIM2K', 'TU5'].map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => {
                  setQuery(term);
                  void runSearch(term);
                }}
                className="rounded-lg border border-[#E2DDD3] bg-[#FAF9F6] px-2.5 py-1 text-xs font-medium text-[#3E3934] hover:border-[#1E3A5F] hover:text-[#1E3A5F]"
                dir="ltr"
              >
                {term}
              </button>
            ))}
          </div>

          {!workspaceAccessToken && (
            <button
              type="button"
              onClick={() => void handleConnectAndSearchDrive()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8D2C5] bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-semibold text-[#1E3A5F] hover:bg-[#EFEAE0]"
            >
              <Cloud className="h-3.5 w-3.5" />
              اتصال Google Drive برای جستجوی زنده فایل‌ها
            </button>
          )}
        </div>
      </form>

      {errorMsg && (
        <div className="rounded-xl border border-[#E6B8B8] bg-[#FDF2F2] p-4 text-xs text-[#8C2D2D]">
          {errorMsg}
        </div>
      )}

      {results && (
        <div className="space-y-5">
          {/* Reference Book Matches */}
          <section className="rounded-2xl border border-[#E2DDD3] bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#1A1816]">
              <BookOpen className="h-4 w-4 text-[#1E3A5F]" />
              نتایج در کتاب‌های مرجع و کدهای خطا ({results.bookMatches.length})
            </h3>
            {results.bookMatches.length === 0 ? (
              <p className="text-xs text-[#6B645B]">
                در متن کتاب‌های مرجع موردی با عبارت «{results.query}» یافت نشد.
              </p>
            ) : (
              <div className="space-y-2.5">
                {results.bookMatches.map((m) => (
                  <div
                    key={m.unitId}
                    className="rounded-xl border border-[#EAE4D9] bg-[#FCFBF8] p-3.5"
                  >
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[#1E3A5F]">
                        {m.volumeTitle} · {m.chapterTitle}
                      </p>
                      <button
                        type="button"
                        onClick={() => onOpenChapter(m.volumeId, m.chapterId)}
                        className="text-xs font-semibold text-[#1E3A5F] hover:underline"
                      >
                        مشاهده فصل
                      </button>
                    </div>
                    <p className="text-xs leading-6 text-[#2C2824]">
                      {highlightQueryText(m.excerpt, results.query)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* WinOLS / PDF / Indexed Drive Asset Matches */}
          <section className="rounded-2xl border border-[#E2DDD3] bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#1A1816]">
              <FileCode2 className="h-4 w-4 text-[#1E3A5F]" />
              نتایج در فایل‌های WinOLS (.ols / .kp)، PDF و کاتالوگ تیم ({results.assetMatches.length})
            </h3>
            {results.assetMatches.length === 0 ? (
              <p className="text-xs text-[#6B645B]">
                فایل فنی مطابقی با عبارت «{results.query}» پیدا نشد.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {results.assetMatches.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-3.5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5">
                        {a.fileCategory === 'ols' || a.fileCategory === 'kp' ? (
                          <FileCode2 className="h-4 w-4 shrink-0 text-[#1E3A5F]" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-[#6B645B]" />
                        )}
                        <p className="truncate text-xs font-bold text-[#1A1816]" dir="ltr">
                          {a.fileName}
                        </p>
                      </div>
                      <p className="text-[11px] text-[#5A544C]">
                        {[a.vehicleModel, a.ecuModel].filter(Boolean).join(' · ') || 'عمومی'}
                      </p>
                      {a.mapList && (
                        <p className="truncate text-[11px] text-[#6B645B]">جداول: {a.mapList}</p>
                      )}
                    </div>
                    {a.driveWebViewLink && (
                      <a
                        href={a.driveWebViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] underline"
                      >
                        Drive
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Live Google Drive Matches (when Google Workspace connected) */}
          {workspaceAccessToken && (
            <section className="rounded-2xl border border-[#E2DDD3] bg-white p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#1A1816]">
                <HardDrive className="h-4 w-4 text-[#1E3A5F]" />
                نتایج زنده در Google Drive ({liveDriveMatches.length})
              </h3>
              {liveDriveMatches.length === 0 ? (
                <p className="text-xs text-[#6B645B]">
                  فایلی با نام مطابق «{results.query}» در پوشه Google Drive یافت نشد.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {liveDriveMatches.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] px-3.5 py-2.5"
                    >
                      <span className="truncate text-xs font-semibold text-[#1A1816]" dir="ltr">
                        {item.name}
                      </span>
                      <a
                        href={item.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#1E3A5F] underline"
                      >
                        باز کردن
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Related Contribution Records */}
          {results.contributionMatches.length > 0 && (
            <section className="rounded-2xl border border-[#E2DDD3] bg-white p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#1A1816]">
                <History className="h-4 w-4 text-[#1E3A5F]" />
                سوابق مشارکت‌های مرتبط ({results.contributionMatches.length})
              </h3>
              <div className="space-y-2">
                {results.contributionMatches.slice(0, 10).map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EAE4D9] bg-[#FCFBF8] px-3.5 py-2.5 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-[#1A1816]">
                        {c.fileName} ·{' '}
                        <span className="text-[#1E3A5F]">{c.detectedVolumeTitle}</span>
                      </p>
                      <p className="text-[11px] text-[#6B645B]">
                        {[c.uploaderDisplayName, c.vehicleModel, c.ecuModel, c.statusLabelFa]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <span className="font-bold text-[#1E3A5F] tabular-nums" dir="ltr">
                      +{c.score}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
