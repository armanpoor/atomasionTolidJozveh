import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  History,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  Users,
  X,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import type {
  ChapterCommentItem,
  TeamUploadedAssetRecord,
} from '../../lib/collaboration/platformTypes';
import {
  pullGoogleDocContentAsMarkdown,
  syncReferenceVolumeToGoogleDoc,
} from '../../lib/googleWorkspace';
import type { WorkspaceConfirmRequest } from './WorkspaceConfirmModal';

interface Props {
  apiClient: ApiClient;
  initialVolumeId?: string | null;
  initialChapterId?: string | null;
  workspaceAccessToken: string | null;
  onConnectWorkspace: () => Promise<string | null>;
  driveRootFolderId: string | null;
  onRequestWorkspaceConfirm: (req: WorkspaceConfirmRequest) => void;
  refreshSignal: number;
}

type LibraryData = Awaited<ReturnType<ApiClient['getCollabLibrary']>>;

export const ReferenceLibraryPanel: React.FC<Props> = ({
  apiClient,
  initialVolumeId,
  initialChapterId,
  workspaceAccessToken,
  onConnectWorkspace,
  driveRootFolderId,
  onRequestWorkspaceConfirm,
  refreshSignal,
}) => {
  const [data, setData] = useState<LibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(
    initialVolumeId || null
  );
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    initialChapterId || null
  );

  // Chapter comments state
  const [comments, setComments] = useState<ChapterCommentItem[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentType, setCommentType] = useState<'comment' | 'correction'>('comment');
  const [postingComment, setPostingComment] = useState(false);

  // Google Docs sync busy
  const [docBusy, setDocBusy] = useState(false);
  const [showDocEmbed, setShowDocEmbed] = useState(false);

  // Internal PDF Viewer state
  const [activePdfAsset, setActivePdfAsset] = useState<TeamUploadedAssetRecord | null>(null);
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const pdfRequestSeqRef = useRef(0);

  const loadLibrary = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getCollabLibrary();
      setData(res);
      if (res.volumes.length > 0) {
        const nextVol =
          res.volumes.find((v) => v.id === (selectedVolumeId || initialVolumeId)) ||
          res.volumes[0];
        setSelectedVolumeId(nextVol.id);
        const nextCh =
          nextVol.chapters.find((c) => c.id === (selectedChapterId || initialChapterId)) ||
          nextVol.chapters[0] ||
          null;
        setSelectedChapterId(nextCh ? nextCh.id : null);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در بارگذاری کتابخانه مرجع.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  useEffect(() => {
    if (initialVolumeId && data) {
      const found = data.volumes.find((v) => v.id === initialVolumeId);
      if (found) {
        setSelectedVolumeId(found.id);
        const ch =
          (initialChapterId && found.chapters.find((c) => c.id === initialChapterId)) ||
          found.chapters[0] ||
          null;
        setSelectedChapterId(ch ? ch.id : null);
      }
    }
  }, [initialVolumeId, initialChapterId, data]);

  const activeVolume = useMemo(
    () => data?.volumes.find((v) => v.id === selectedVolumeId) || data?.volumes[0] || null,
    [data, selectedVolumeId]
  );

  const activeChapter = useMemo(() => {
    if (!activeVolume) return null;
    return (
      activeVolume.chapters.find((c) => c.id === selectedChapterId) ||
      activeVolume.chapters[0] ||
      null
    );
  }, [activeVolume, selectedChapterId]);

  useEffect(() => {
    if (!activeChapter) {
      setComments([]);
      return;
    }
    let cancelled = false;
    apiClient
      .getCollabChapterComments(activeChapter.id)
      .then((res) => {
        if (!cancelled) setComments(res.comments);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChapter, apiClient]);

  // Cleanup PDF blob URLs
  useEffect(() => {
    return () => {
      if (activePdfUrl && activePdfUrl.startsWith('blob:')) {
        URL.revokeObjectURL(activePdfUrl);
      }
    };
  }, [activePdfUrl]);

  // Escape closes active PDF viewer
  useEffect(() => {
    if (!activePdfAsset) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pdfRequestSeqRef.current += 1;
        setActivePdfAsset(null);
        setActivePdfUrl(null);
        setLoadingPdf(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePdfAsset]);

  const handleOpenInternalPdf = async (asset: TeamUploadedAssetRecord) => {
    const reqSeq = ++pdfRequestSeqRef.current;
    setActivePdfAsset(asset);
    setLoadingPdf(true);
    setNoticeMsg(null);
    setActivePdfUrl(null);
    try {
      if (asset.hasLocalPdfPreview) {
        const blobUrl = await apiClient.fetchCollabPdfBlobUrl(asset.id);
        if (pdfRequestSeqRef.current !== reqSeq) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        setActivePdfUrl(blobUrl);
      } else if (asset.driveFileId) {
        if (pdfRequestSeqRef.current !== reqSeq) return;
        setActivePdfUrl(
          `https://drive.google.com/file/d/${encodeURIComponent(asset.driveFileId)}/preview`
        );
      } else {
        setActivePdfUrl(null);
      }
    } catch (err) {
      if (pdfRequestSeqRef.current !== reqSeq) return;
      setNoticeMsg(err instanceof Error ? err.message : 'خطا در نمایش PDF داخلی.');
      setActivePdfUrl(null);
    } finally {
      if (pdfRequestSeqRef.current === reqSeq) {
        setLoadingPdf(false);
      }
    }
  };

  const buildChapterMarkdown = (
    volTitle: string,
    ch: NonNullable<typeof activeChapter>
  ): string => {
    const lines = [`# ${volTitle} — ${ch.title}`];
    if (ch.shortSummary) lines.push('', ch.shortSummary);
    for (const u of ch.units) {
      lines.push('', u.cleanText);
    }
    return lines.join('\n');
  };

  const handleCopyChapterText = async () => {
    if (!activeVolume || !activeChapter || activeChapter.units.length === 0) return;
    try {
      await navigator.clipboard.writeText(buildChapterMarkdown(activeVolume.title, activeChapter));
      setNoticeMsg(`متن فصل «${activeChapter.title}» در حافظه کپی شد.`);
    } catch {
      setNoticeMsg('امکان کپی خودکار متن در این مرورگر وجود ندارد.');
    }
  };

  const handleDownloadChapterMarkdown = () => {
    if (!activeVolume || !activeChapter || activeChapter.units.length === 0) return;
    const md = buildChapterMarkdown(activeVolume.title, activeChapter);
    const blob = new Blob(['\uFEFF', md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = activeChapter.title.replace(/[^\u0600-\u06FFa-zA-Z0-9_-]+/g, '-').slice(0, 60);
    a.download = `${safeName || 'chapter'}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setNoticeMsg(`فایل Markdown فصل «${activeChapter.title}» دانلود شد.`);
  };

  const buildVolumeMarkdownForDoc = (vol: NonNullable<typeof activeVolume>): string => {
    const sections: string[] = [];
    if (vol.description) sections.push(vol.description);
    for (const ch of vol.chapters) {
      sections.push(`\n## ${ch.title}`);
      if (ch.shortSummary) sections.push(ch.shortSummary);
      if (ch.units.length === 0) {
        sections.push('(این فصل آماده دریافت مشارکت‌های تخصصی تیم است.)');
      } else {
        for (const u of ch.units) {
          sections.push(u.cleanText);
        }
      }
    }
    return sections.join('\n\n');
  };

  const handleSyncVolumeToGoogleDocs = async () => {
    if (!activeVolume) return;
    let token = workspaceAccessToken;
    if (!token) {
      token = await onConnectWorkspace();
      if (!token) return;
    }
    const resolvedToken = token;
    const isUpdate = Boolean(activeVolume.googleDoc?.googleDocId);

    onRequestWorkspaceConfirm({
      title: isUpdate
        ? 'به‌روزرسانی سند Google Docs این جلد مرجع'
        : 'ساخت سند Google Docs برای این جلد مرجع',
      description: isUpdate
        ? 'محتوای فعلی کتاب مرجع در سند Google Docs متصل به‌روزرسانی می‌شود تا اعضای تیم بتوانند آن را مطالعه و ویرایش کنند.'
        : 'یک سند راست‌چین فارسی در Google Docs برای این جلد ساخته شده و به کتابخانه مرجع متصل می‌شود.',
      actionLabel: isUpdate ? 'به‌روزرسانی Google Docs' : 'ساخت و اتصال Google Docs',
      details: [
        `جلد: ${activeVolume.title}`,
        `تعداد فصل‌ها: ${activeVolume.chapters.length} فصل`,
      ],
      onConfirm: async () => {
        setDocBusy(true);
        setNoticeMsg(null);
        try {
          const synced = await syncReferenceVolumeToGoogleDoc({
            accessToken: resolvedToken,
            volumeTitle: activeVolume.title,
            markdownContent: buildVolumeMarkdownForDoc(activeVolume),
            existingDocId: activeVolume.googleDoc?.googleDocId,
            parentFolderId: driveRootFolderId,
          });
          await apiClient.linkCollabVolumeGoogleDoc(activeVolume.id, {
            googleDocId: synced.documentId,
            googleDocUrl: synced.documentUrl,
          });
          setNoticeMsg('سند Google Docs با موفقیت همگام‌سازی و متصل شد.');
          await loadLibrary();
        } catch (err) {
          setNoticeMsg(err instanceof Error ? err.message : 'خطا در اتصال Google Docs.');
        } finally {
          setDocBusy(false);
        }
      },
    });
  };

  const handlePullEditsFromGoogleDocs = async () => {
    if (!activeVolume?.googleDoc?.googleDocId) return;
    let token = workspaceAccessToken;
    if (!token) {
      token = await onConnectWorkspace();
      if (!token) return;
    }
    const resolvedToken = token;
    onRequestWorkspaceConfirm({
      title: 'دریافت آخرین ویرایش‌های تیم از Google Docs',
      description:
        'متن ویرایش‌شده از سند Google Docs خوانده شده و صرفاً تغییرات جدید (Delta-Merge) با ثبت تاریخچه نسخه (قابل Rollback) در کتاب مرجع ادغام می‌شوند.',
      actionLabel: 'دریافت و ادغام تغییرات',
      details: [`جلد: ${activeVolume.title}`],
      onConfirm: async () => {
        setDocBusy(true);
        setNoticeMsg(null);
        try {
          const text = await pullGoogleDocContentAsMarkdown({
            accessToken: resolvedToken,
            documentId: activeVolume.googleDoc!.googleDocId,
          });
          const res = await apiClient.linkCollabVolumeGoogleDoc(activeVolume.id, {
            googleDocId: activeVolume.googleDoc!.googleDocId,
            googleDocUrl: activeVolume.googleDoc!.googleDocUrl,
            pulledMarkdown: text,
          });
          const ms = res.mergeSummary;
          setNoticeMsg(
            ms
              ? `تغییرات Google Docs ادغام شد: ${ms.newUnitsCount} واحد جدید و ${ms.mergedUnitsCount} ادغام تکمیلی.`
              : 'محتوای Google Docs بررسی شد و تغییر جدیدی ثبت نشد.'
          );
          await loadLibrary();
        } catch (err) {
          setNoticeMsg(err instanceof Error ? err.message : 'خطا در دریافت از Google Docs.');
        } finally {
          setDocBusy(false);
        }
      },
    });
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVolume || !activeChapter || commentBody.trim().length < 3) return;
    setPostingComment(true);
    try {
      const res = await apiClient.addCollabChapterComment(activeChapter.id, {
        volumeId: activeVolume.id,
        commentType,
        body: commentBody.trim(),
      });
      setComments((prev) => [res.comment, ...prev]);
      setCommentBody('');
    } catch (err) {
      setNoticeMsg(err instanceof Error ? err.message : 'خطا در ثبت یادداشت.');
    } finally {
      setPostingComment(false);
    }
  };

  const handleResolveComment = async (commentId: string) => {
    try {
      const res = await apiClient.resolveCollabChapterComment(commentId);
      setComments((prev) => prev.map((c) => (c.id === commentId ? res.comment : c)));
    } catch (err) {
      setNoticeMsg(err instanceof Error ? err.message : 'خطا در بستن یادداشت.');
    }
  };

  const handleOwnerRollback = (ingestBatchId: string, sourceFileName: string) => {
    onRequestWorkspaceConfirm({
      title: 'بازگردانی (Rollback) تغییرات این دسته پردازش',
      description: `آیا مطمئن هستید که می‌خواهید تمام تغییرات اضافه‌شده از منبع «${sourceFileName}» را به حالت قبل بازگردانید؟`,
      actionLabel: 'اجرای Rollback',
      details: [`شناسه دسته: ${ingestBatchId}`],
      onConfirm: async () => {
        try {
          const res = await apiClient.rollbackCollabBatch(ingestBatchId);
          const deleted = res.deletedUnits ?? res.deletedCount ?? 0;
          const reverted = res.revertedUnits ?? res.revertedCount ?? 0;
          setNoticeMsg(
            `بازگردانی انجام شد: ${deleted} واحد حذف و ${reverted} واحد به نسخه قبلی برگشت.`
          );
          await loadLibrary();
        } catch (err) {
          setNoticeMsg(err instanceof Error ? err.message : 'خطا در بازگردانی تغییرات.');
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[#E2DDD3] bg-white p-12 text-sm text-[#5A544C]">
        <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#1E3A5F]" />
        در حال بارگذاری مجموعه کتاب‌های مرجع خودرو...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-2xl border border-[#E6B8B8] bg-[#FDF2F2] p-6 text-sm text-[#8C2D2D]">
        {errorMsg}
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header & PDF Assets quick strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2DDD3] bg-white px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-[#1A1816]">
            کتابخانه مرجع تخصصی خودرو (۶ جلد خودرشدشونده + نمایشگر PDF و Google Docs)
          </h2>
          <p className="mt-0.5 text-xs text-[#6B645B] tabular-nums">
            {data?.volumes.length || 0} جلد کتاب مرجع فعال · {data?.pdfAssets.length || 0} فایل PDF
            قابل مشاهده درون اپلیکیشن
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLibrary()}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F1ECE1]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          بروزرسانی کتابخانه
        </button>
      </div>

      {noticeMsg && (
        <div className="rounded-xl border border-[#C9D8E8] bg-[#F3F7FB] px-4 py-3 text-xs font-medium text-[#1E3A5F]">
          {noticeMsg}
        </div>
      )}

      {/* Main 2-Column Split: Volumes & Chapters List | Reader + Docs + Attribution */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Right Column (RTL first): Volumes & Chapters Navigation */}
        <aside className="space-y-3 lg:col-span-4">
          {data?.volumes.map((vol) => {
            const isSelected = activeVolume?.id === vol.id;
            return (
              <div
                key={vol.id}
                className={`rounded-2xl border transition ${
                  isSelected
                    ? 'border-[#1E3A5F] bg-white shadow-sm'
                    : 'border-[#E2DDD3] bg-[#FCFBF8] hover:border-[#C7BFA9]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedVolumeId(vol.id);
                    setSelectedChapterId(vol.chapters[0]?.id || null);
                    setShowDocEmbed(false);
                  }}
                  className="w-full p-4 text-right"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-[#1A1816]">{vol.title}</span>
                    <BookOpen
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        isSelected ? 'text-[#1E3A5F]' : 'text-[#8C8375]'
                      }`}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-[#6B645B] tabular-nums">
                    {vol.chapters.length} فصل · {vol.wordCount.toLocaleString('fa-IR')} کلمه
                    {vol.googleDoc ? ' · متصل به Google Docs' : ''}
                  </p>
                </button>

                {isSelected && vol.chapters.length > 0 && (
                  <div className="border-t border-[#EFEAE0] px-3 py-2.5 space-y-1">
                    {vol.chapters.map((ch, idx) => {
                      const chActive = activeChapter?.id === ch.id;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => setSelectedChapterId(ch.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-right text-xs transition ${
                            chActive
                              ? 'bg-[#1E3A5F] font-semibold text-white'
                              : 'text-[#3E3934] hover:bg-[#F3EFE6]'
                          }`}
                        >
                          <span className="truncate">
                            {idx + 1}. {ch.title}
                          </span>
                          <span
                            className={`shrink-0 tabular-nums ${
                              chActive ? 'text-white/80' : 'text-[#7A7267]'
                            }`}
                          >
                            {ch.unitsCount} بند
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* Left Column: Active Volume & Chapter Reader */}
        <div className="space-y-5 lg:col-span-8">
          {activeVolume && (
            <div className="rounded-2xl border border-[#E2DDD3] bg-white p-6">
              {/* Volume Header + Google Docs Sync Bar */}
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[#EFEAE0] pb-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[#6B645B]">
                    {activeVolume.domainLabelFa}
                  </p>
                  <h3 className="text-lg font-bold text-[#1A1816]">{activeVolume.title}</h3>
                  {activeVolume.description && (
                    <p className="text-xs leading-6 text-[#5A544C]">
                      {activeVolume.description}
                    </p>
                  )}
                </div>

                {data?.canUseDocs && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={docBusy}
                      onClick={() => void handleSyncVolumeToGoogleDocs()}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162C49] disabled:opacity-60"
                    >
                      {docBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      {activeVolume.googleDoc
                        ? 'به‌روزرسانی Google Docs'
                        : 'ساخت / اتصال Google Docs'}
                    </button>

                    {activeVolume.googleDoc && (
                      <>
                        <a
                          href={activeVolume.googleDoc.googleDocUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F5F2EB]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          باز کردن و ویرایش در Docs
                        </a>
                        <button
                          type="button"
                          onClick={() => setShowDocEmbed((v) => !v)}
                          className="whitespace-nowrap rounded-xl border border-[#D8D2C5] bg-[#FAF9F6] px-3 py-2 text-xs font-medium text-[#3E3934] hover:bg-[#F1ECE1]"
                        >
                          {showDocEmbed ? 'بستن نمای Docs' : 'نمایش Docs درون اپ'}
                        </button>
                        <button
                          type="button"
                          disabled={docBusy}
                          onClick={() => void handlePullEditsFromGoogleDocs()}
                          className="whitespace-nowrap rounded-xl border border-[#1E3A5F]/30 bg-[#F3F6FA] px-3 py-2 text-xs font-semibold text-[#1E3A5F] hover:bg-[#E7EEF7] disabled:opacity-60"
                        >
                          دریافت ویرایش‌ها از Docs
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Optional Embedded Google Doc Viewer */}
              {showDocEmbed && activeVolume.googleDoc && (
                <div className="mb-6 overflow-hidden rounded-xl border border-[#D8D2C5]">
                  <div className="flex items-center justify-between bg-[#FAF9F6] px-3.5 py-2 text-xs text-[#4A453F]">
                    <span>نمایش زنده Google Docs: {activeVolume.title}</span>
                    <button
                      type="button"
                      onClick={() => setShowDocEmbed(false)}
                      className="rounded p-1 hover:bg-[#EAE4D9]"
                      aria-label="بستن نمایش Google Docs"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <iframe
                    src={`https://docs.google.com/document/d/${encodeURIComponent(activeVolume.googleDoc.googleDocId)}/preview`}
                    title={activeVolume.title}
                    className="h-[460px] w-full bg-white"
                  />
                </div>
              )}

              {/* Active Chapter Content */}
              {activeChapter ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-bold text-[#1A1816]">
                        {activeChapter.title}
                      </h4>
                      {activeChapter.shortSummary && (
                        <p className="mt-1 text-xs leading-6 text-[#6B645B]">
                          {activeChapter.shortSummary}
                        </p>
                      )}
                    </div>
                    {activeChapter.units.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleCopyChapterText()}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#D8D2C5] bg-[#FAF9F6] px-2.5 py-1.5 text-[11px] font-semibold text-[#1A1816] hover:bg-[#F1ECE1]"
                        >
                          <Copy className="h-3.5 w-3.5 text-[#1E3A5F]" />
                          کپی متن فصل
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadChapterMarkdown}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#D8D2C5] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#1E3A5F] hover:bg-[#F3F6FA]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          دانلود فصل (.md)
                        </button>
                      </div>
                    )}
                  </div>

                  {activeChapter.units.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#D8D2C5] bg-[#FAF9F6] p-6 text-center text-sm text-[#6B645B]">
                      این فصل هنوز از صفر ایجاد شده و آماده دریافت اولین مشارکت‌های تخصصی تیم است.
                      با آپلود فایل‌های متنی، PDF، صوتی یا WinOLS مرتبط، محتوای این فصل به‌صورت خودکار
                      رشد می‌کند.
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {activeChapter.units.map((unit) => {
                        const meta = (unit.technicalMetadataJson || {}) as Record<string, unknown>;
                        const contributor = String(
                          meta.contributorDisplayName || meta.contributorEmail || 'تیم مرجع'
                        );
                        const srcFile = String(meta.sourceFileName || '');
                        return (
                          <article
                            key={unit.id}
                            className="rounded-xl border border-[#EAE4D9] bg-[#FCFBF8] p-4"
                          >
                            <div className="whitespace-pre-wrap text-sm leading-8 text-[#1A1816]">
                              {unit.cleanText}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#EFEAE0] pt-2.5 text-[11px] text-[#6B645B]">
                              <span>
                                مشارکت‌کننده: <strong className="text-[#3E3934]">{contributor}</strong>
                                {srcFile ? ` · منبع: ${srcFile}` : ''}
                              </span>
                              <span className="tabular-nums">
                                تأیید منابع مستقل: {unit.corroborationCount} ·{' '}
                                {unit.verificationStatus === 'verified'
                                  ? 'تأییدشده'
                                  : 'در صف بازبینی'}
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {/* Contributor Attribution & Owner Rollback Audit Trail */}
                  <div className="grid grid-cols-1 gap-4 border-t border-[#EFEAE0] pt-5 md:grid-cols-2">
                    <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-4">
                      <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-[#1A1816]">
                        <Users className="h-4 w-4 text-[#1E3A5F]" />
                        مشارکت‌کنندگان این فصل
                      </div>
                      {activeChapter.contributors.length === 0 ? (
                        <p className="text-xs text-[#6B645B]">هنوز مشارکتی ثبت نشده است.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-[#3E3934]">
                          {activeChapter.contributors.map((c, idx) => (
                            <li
                              key={`${c.email}-${idx}`}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="truncate font-medium">{c.displayName}</span>
                              <span className="shrink-0 text-[#6B645B] tabular-nums">
                                {c.count} بند علمی
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-4">
                      <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-[#1A1816]">
                        <History className="h-4 w-4 text-[#1E3A5F]" />
                        تاریخچه تغییرات فصل {data?.isOwner ? '(Rollback مالک)' : ''}
                      </div>
                      {activeChapter.recentBatches.length === 0 ? (
                        <p className="text-xs text-[#6B645B]">تاریخچه‌ای ثبت نشده است.</p>
                      ) : (
                        <ul className="space-y-2 text-xs">
                          {activeChapter.recentBatches.map((b) => (
                            <li
                              key={b.ingestBatchId}
                              className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 border border-[#EFEAE0]"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-[#1A1816]">
                                  {b.sourceFileName}
                                </p>
                                <p className="text-[11px] text-[#6B645B] tabular-nums">
                                  {b.contributorName} · {b.unitsCount} واحد
                                </p>
                              </div>
                              {data?.isOwner && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOwnerRollback(b.ingestBatchId, b.sourceFileName)
                                  }
                                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#E6B8B8] bg-[#FDF2F2] px-2.5 py-1 text-[11px] font-semibold text-[#8C2D2D] hover:bg-[#F9DFDF]"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Rollback
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Team Comments & Correction Suggestions */}
                  <div className="rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold text-[#1A1816]">
                      <MessageSquare className="h-4 w-4 text-[#1E3A5F]" />
                      یادداشت‌ها و پیشنهادهای اصلاحی تیم برای این فصل ({comments.length})
                    </div>

                    <form onSubmit={handlePostComment} className="mb-4 flex flex-col gap-2 sm:flex-row">
                      <select
                        value={commentType}
                        onChange={(e) =>
                          setCommentType(e.target.value as 'comment' | 'correction')
                        }
                        aria-label="نوع یادداشت"
                        className="rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs font-medium text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                      >
                        <option value="comment">یادداشت فنی</option>
                        <option value="correction">پیشنهاد اصلاح</option>
                      </select>
                      <input
                        type="text"
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        placeholder="نکته تکمیلی یا اصلاح تخصصی خود درباره این فصل را بنویسید..."
                        className="flex-1 rounded-xl border border-[#D8D2C5] bg-white px-3.5 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={postingComment || commentBody.trim().length < 3}
                        className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#162C49] disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        ثبت
                      </button>
                    </form>

                    {comments.length === 0 ? (
                      <p className="text-xs text-[#6B645B]">
                        هنوز یادداشتی برای این فصل ثبت نشده است.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {comments.map((cm) => (
                          <div
                            key={cm.id}
                            className="flex items-start justify-between gap-3 rounded-xl border border-[#E6E0D5] bg-white p-3 text-xs"
                          >
                            <div className="space-y-1">
                              <p className="text-[#6B645B]">
                                <strong className="text-[#1A1816]">{cm.authorName}</strong> ·{' '}
                                {cm.commentType === 'correction' ? 'پیشنهاد اصلاح' : 'یادداشت فنی'} ·{' '}
                                {cm.status === 'resolved' ? 'بررسی و بسته شد' : 'باز'}
                              </p>
                              <p className="leading-6 text-[#2C2824]">{cm.body}</p>
                            </div>
                            {data?.isOwner && cm.status === 'open' && (
                              <button
                                type="button"
                                onClick={() => void handleResolveComment(cm.id)}
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#C5DEC9] bg-[#EFF8F1] px-2.5 py-1 text-[11px] font-semibold text-[#1F6B43] hover:bg-[#E1F3E5]"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                تأیید شد
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Internal PDF Viewer Library Section */}
          <section className="rounded-2xl border border-[#E2DDD3] bg-white p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#1A1816]">
                  نمایشگر داخلی فایل‌های PDF مرجع
                </h3>
                <p className="text-xs text-[#6B645B]">
                  مطالعه مستقیم PDFهای آپلودشده توسط تیم در محیط اپلیکیشن بدون نیاز به خروج
                </p>
              </div>
              {activePdfAsset && (
                <button
                  type="button"
                  onClick={() => {
                    setActivePdfAsset(null);
                    setActivePdfUrl(null);
                  }}
                  className="text-xs font-semibold text-[#8C2D2D] hover:underline"
                >
                  بستن نمایشگر PDF
                </button>
              )}
            </div>

            {data && data.pdfAssets.length > 0 ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {data.pdfAssets.map((pdf) => (
                  <div
                    key={pdf.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[#EAE4D9] bg-[#FAF9F6] px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-[#1A1816]">{pdf.fileName}</p>
                      <p className="truncate text-[11px] text-[#6B645B]">
                        {[pdf.vehicleModel, pdf.ecuModel, pdf.uploaderDisplayName]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleOpenInternalPdf(pdf)}
                      className="shrink-0 whitespace-nowrap rounded-lg bg-[#1E3A5F] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#162C49]"
                    >
                      مشاهده PDF
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[#D8D2C5] bg-[#FAF9F6] p-4 text-center text-xs text-[#6B645B]">
                هنوز فایل PDF تخصصی آپلود نشده است. پس از ارسال هر فایل PDF در بخش مشارکت، می‌توانید
                آن را مستقیماً در همین نمایشگر مطالعه کنید.
              </p>
            )}

            {activePdfAsset && (
              <div className="mt-4 overflow-hidden rounded-xl border border-[#D8D2C5]">
                <div className="flex items-center justify-between bg-[#FAF9F6] px-4 py-2 text-xs font-semibold text-[#1A1816]">
                  <span>در حال مطالعه: {activePdfAsset.fileName}</span>
                  {activePdfAsset.driveWebViewLink && (
                    <a
                      href={activePdfAsset.driveWebViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#1E3A5F] underline"
                    >
                      باز کردن در Google Drive
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {loadingPdf ? (
                  <div className="flex h-64 items-center justify-center bg-white text-xs text-[#6B645B]">
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    در حال بارگذاری PDF...
                  </div>
                ) : activePdfUrl ? (
                  <iframe
                    src={activePdfUrl}
                    title={activePdfAsset.fileName}
                    className="h-[540px] w-full bg-white"
                  />
                ) : (
                  <div className="p-6 text-center text-xs text-[#6B645B]">
                    نسخه پیش‌نمایش داخلی برای این PDF در دسترس نیست.
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
