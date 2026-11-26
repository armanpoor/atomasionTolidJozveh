import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Presentation,
  RefreshCw,
  Search,
  Table2,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  AuditReportDto,
  ConflictDto,
  DocxExportConfig,
  ParsedBook,
  WorkflowMode,
} from '../lib/bookTypes';
import type { WinolsExtractionReport } from '../lib/winolsMapGuide';
import type { QueuedUploadFile } from './FileDropzone';
import {
  buildBookSpreadsheetReportPayload,
  createBookGoogleDoc,
  createBookPresentation,
  createBookSpreadsheet,
  downloadDriveFileForImport,
  DriveFileItem,
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  GOOGLE_SLIDES_MIME,
  listDriveFiles,
  listSpreadsheetTabs,
  SpreadsheetMetadata,
  updateExistingSpreadsheetTab,
  uploadFinalDocumentToDrive,
} from '../lib/googleWorkspace';
import { generateDocxBlob } from '../lib/docxGenerator';
import { exportBookToMarkdown, toPersianDigits } from '../lib/formatParsers';

interface GoogleWorkspaceModalProps {
  open: boolean;
  initialTab?: 'import' | 'export';
  workspaceAccessToken: string | null;
  connectingWorkspace: boolean;
  workflowMode: WorkflowMode;
  book: ParsedBook | null;
  auditReport: AuditReportDto | null;
  conflicts: ConflictDto[];
  winolsReport: WinolsExtractionReport | null;
  config: DocxExportConfig;
  onConnectWorkspace: () => Promise<string | null>;
  onImportFiles: (files: QueuedUploadFile[]) => void;
  onClose: () => void;
}

type PendingMutationConfirmation =
  | {
      kind: 'drive_upload';
      fileName: string;
      format: 'docx' | 'md';
      overwriteFileId: string | null;
      overwriteFileName: string | null;
    }
  | {
      kind: 'sheet_create';
      spreadsheetTitle: string;
      tabNames: string[];
    }
  | {
      kind: 'sheet_update';
      spreadsheetId: string;
      spreadsheetTitle: string;
      sheetTitle: string;
      sourceTabKey: 'summary' | 'chapters' | 'winols';
    }
  | {
      kind: 'doc_create';
      docTitle: string;
    }
  | {
      kind: 'slides_create';
      presentationTitle: string;
    };

export const GoogleWorkspaceModal: React.FC<GoogleWorkspaceModalProps> = ({
  open,
  initialTab = 'import',
  workspaceAccessToken,
  connectingWorkspace,
  workflowMode,
  book,
  auditReport,
  conflicts,
  winolsReport,
  config,
  onConnectWorkspace,
  onImportFiles,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlySpreadsheets, setOnlySpreadsheets] = useState(false);

  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [importingFileId, setImportingFileId] = useState<string | null>(null);

  const [selectedSheetMeta, setSelectedSheetMeta] =
    useState<SpreadsheetMetadata | null>(null);
  const [loadingSheetTabs, setLoadingSheetTabs] = useState(false);
  const [selectedImportTabs, setSelectedImportTabs] = useState<string[]>([]);

  // Export state
  const [driveExportFormat, setDriveExportFormat] = useState<'docx' | 'md'>('docx');
  const [driveExportFileName, setDriveExportFileName] = useState('');
  const [overwriteDriveFileId, setOverwriteDriveFileId] = useState<string>('');

  const [sheetExportMode, setSheetExportMode] = useState<'new' | 'update'>('new');
  const [newSheetTitle, setNewSheetTitle] = useState('');
  const [targetUpdateSheetId, setTargetUpdateSheetId] = useState('');
  const [targetUpdateSheetMeta, setTargetUpdateSheetMeta] =
    useState<SpreadsheetMetadata | null>(null);
  const [targetUpdateTabTitle, setTargetUpdateTabTitle] = useState('');
  const [targetUpdatePayloadKey, setTargetUpdatePayloadKey] = useState<
    'summary' | 'chapters' | 'winols'
  >('winols');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newSlidesTitle, setNewSlidesTitle] = useState('');

  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingMutationConfirmation | null>(null);
  const [executingMutation, setExecutingMutation] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    message: string;
    url?: string;
    linkLabel?: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setErrorMsg(null);
      setSuccessInfo(null);
      setPendingConfirmation(null);
      if (book) {
        const cleanTitle = book.title.replace(/[^\u0600-\u06FFa-zA-Z0-9\s_-]/g, '').trim() || 'کتاب_فنی';
        setDriveExportFileName(
          `${cleanTitle}_VazirMedium.${driveExportFormat === 'docx' ? 'docx' : 'md'}`
        );
        setNewSheetTitle(`گزارش و نقشه‌های WinOLS — ${book.title}`);
        setNewDocTitle(`${book.title} (نسخه Google Docs)`);
        setNewSlidesTitle(`اسلایدهای ارائه — ${book.title}`);
      }
    }
  }, [open, initialTab, book, driveExportFormat]);

  const fetchDriveFilesList = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride || workspaceAccessToken;
      if (!token) return;
      setLoadingFiles(true);
      setErrorMsg(null);
      try {
        const list = await listDriveFiles({
          accessToken: token,
          searchQuery,
          onlySpreadsheets,
          pageSize: 30,
        });
        setDriveFiles(list);
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'خطا در دریافت فایل‌های گوگل درایو.'
        );
      } finally {
        setLoadingFiles(false);
      }
    },
    [workspaceAccessToken, searchQuery, onlySpreadsheets]
  );

  useEffect(() => {
    if (open && workspaceAccessToken) {
      void fetchDriveFilesList();
    }
  }, [open, workspaceAccessToken, onlySpreadsheets, fetchDriveFilesList]);

  useEffect(() => {
    if (!workspaceAccessToken || !targetUpdateSheetId) {
      setTargetUpdateSheetMeta(null);
      setTargetUpdateTabTitle('');
      return;
    }
    let cancelled = false;
    setLoadingSheetTabs(true);
    void listSpreadsheetTabs({
      accessToken: workspaceAccessToken,
      spreadsheetId: targetUpdateSheetId,
    })
      .then((meta) => {
        if (cancelled) return;
        setTargetUpdateSheetMeta(meta);
        setTargetUpdateTabTitle(meta.tabs[0]?.title || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : 'خطا در خواندن تب‌های Google Sheet.');
      })
      .finally(() => {
        if (!cancelled) setLoadingSheetTabs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceAccessToken, targetUpdateSheetId]);

  if (!open) return null;

  const handleConnectClick = async () => {
    setErrorMsg(null);
    const token = await onConnectWorkspace();
    if (token) {
      await fetchDriveFilesList(token);
    }
  };

  const handleInspectSheetForImport = async (file: DriveFileItem) => {
    if (!workspaceAccessToken) return;
    setLoadingSheetTabs(true);
    setErrorMsg(null);
    setSelectedSheetMeta(null);
    try {
      const meta = await listSpreadsheetTabs({
        accessToken: workspaceAccessToken,
        spreadsheetId: file.id,
      });
      setSelectedSheetMeta(meta);
      setSelectedImportTabs(meta.tabs.map((t) => t.title));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در خواندن تب‌های فایل Google Sheets.'
      );
    } finally {
      setLoadingSheetTabs(false);
    }
  };

  const handleImportDriveItem = async (
    file: DriveFileItem,
    sheetTabsOverride?: string[]
  ) => {
    if (!workspaceAccessToken) return;
    setImportingFileId(file.id);
    setErrorMsg(null);
    setSuccessInfo(null);
    try {
      const imported = await downloadDriveFileForImport({
        accessToken: workspaceAccessToken,
        file,
        selectedSheetTabs: sheetTabsOverride,
      });
      const queued: QueuedUploadFile = {
        id: `gdrive_${file.id}_${Date.now()}`,
        name: imported.name,
        format: imported.format,
        sizeBytes: imported.sizeBytes,
        role: workflowMode === 'master_update' ? 'supplement' : 'standard',
        file: imported.file,
        presetText: imported.presetText,
      };
      onImportFiles([queued]);
      setSelectedSheetMeta(null);
      setSuccessInfo({
        message: `فایل «${imported.name}» با موفقیت به صف مرحله ۱ اضافه شد.`,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در وارد کردن فایل از Google Drive.'
      );
    } finally {
      setImportingFileId(null);
    }
  };

  const handleConfirmMutation = async () => {
    if (!pendingConfirmation || !workspaceAccessToken || !book) return;
    setExecutingMutation(true);
    setErrorMsg(null);
    setSuccessInfo(null);
    try {
      if (pendingConfirmation.kind === 'drive_upload') {
        const data: Blob | string =
          pendingConfirmation.format === 'docx'
            ? await generateDocxBlob(book, config)
            : exportBookToMarkdown(book);

        const uploaded = await uploadFinalDocumentToDrive({
          accessToken: workspaceAccessToken,
          fileName: pendingConfirmation.fileName,
          format: pendingConfirmation.format,
          data,
          existingFileId: pendingConfirmation.overwriteFileId,
          description: `خروجی نهایی کتاب: ${book.title}`,
        });
        setSuccessInfo({
          message: uploaded.updated
            ? `فایل «${uploaded.name}» در Google Drive به‌روزرسانی شد.`
            : `فایل «${uploaded.name}» با موفقیت در Google Drive ذخیره شد.`,
          url: uploaded.webViewLink,
          linkLabel: 'مشاهده در Google Drive',
        });
        void fetchDriveFilesList();
      } else if (pendingConfirmation.kind === 'sheet_create') {
        const created = await createBookSpreadsheet({
          accessToken: workspaceAccessToken,
          title: pendingConfirmation.spreadsheetTitle,
          book,
          auditReport,
          conflicts,
          winolsReport,
        });
        setSuccessInfo({
          message: `فایل Google Sheets «${created.title}» با ${toPersianDigits(
            pendingConfirmation.tabNames.length
          )} تب گزارش و نقشه‌های WinOLS ساخته شد.`,
          url: created.spreadsheetUrl,
          linkLabel: 'باز کردن در Google Sheets',
        });
        void fetchDriveFilesList();
      } else if (pendingConfirmation.kind === 'sheet_update') {
        const payloadTabs = buildBookSpreadsheetReportPayload({
          book,
          auditReport,
          conflicts,
          winolsReport,
        });
        const chosenTab =
          pendingConfirmation.sourceTabKey === 'summary'
            ? payloadTabs[0]
            : pendingConfirmation.sourceTabKey === 'chapters'
              ? payloadTabs[1]
              : payloadTabs[2];
        const res = await updateExistingSpreadsheetTab({
          accessToken: workspaceAccessToken,
          spreadsheetId: pendingConfirmation.spreadsheetId,
          sheetTitle: pendingConfirmation.sheetTitle,
          rows: chosenTab.rows,
        });
        setSuccessInfo({
          message: `تب «${pendingConfirmation.sheetTitle}» در فایل «${pendingConfirmation.spreadsheetTitle}» (${toPersianDigits(
            res.updatedRows
          )} ردیف) به‌روزرسانی شد.`,
          url: `https://docs.google.com/spreadsheets/d/${pendingConfirmation.spreadsheetId}/edit`,
          linkLabel: 'باز کردن در Google Sheets',
        });
      } else if (pendingConfirmation.kind === 'doc_create') {
        const created = await createBookGoogleDoc({
          accessToken: workspaceAccessToken,
          title: pendingConfirmation.docTitle,
          book,
        });
        setSuccessInfo({
          message: `سند بومی Google Docs «${created.title}» با جهت راست‌چین کامل ساخته شد.`,
          url: created.documentUrl,
          linkLabel: 'باز کردن در Google Docs',
        });
        void fetchDriveFilesList();
      } else if (pendingConfirmation.kind === 'slides_create') {
        const created = await createBookPresentation({
          accessToken: workspaceAccessToken,
          title: pendingConfirmation.presentationTitle,
          book,
          winolsReport,
        });
        setSuccessInfo({
          message: `ارائه Google Slides «${created.title}» با ${toPersianDigits(
            created.slideCount
          )} اسلاید ساخته شد.`,
          url: created.presentationUrl,
          linkLabel: 'باز کردن در Google Slides',
        });
        void fetchDriveFilesList();
      }
      setPendingConfirmation(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'خطا در انجام عملیات Google Workspace.'
      );
      setPendingConfirmation(null);
    } finally {
      setExecutingMutation(false);
    }
  };

  const spreadsheetDriveFiles = driveFiles.filter(
    (f) => f.mimeType === GOOGLE_SHEET_MIME
  );

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="اتصال به Google Drive و Google Sheets"
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-[#D6D0C4] bg-white shadow-xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E2DDD3] bg-[#FAF9F6] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1E3A5F] text-white">
              <FolderOpen className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-[#1A1816]">
                اتصال مستقیم به Google Drive، Docs، Sheets و Slides
              </h2>
              <p className="text-[11px] text-[#57534E]">
                وارد کردن مستقیم جزوه‌ها از Drive/Docs/Sheets/Slides و خروجی گزارش، سند و اسلاید ارائه
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره Google Drive و Sheets"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#57534E] hover:bg-[#EFECE4] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center gap-2 border-b border-[#EFECE4] bg-white px-5 py-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab('import');
              setPendingConfirmation(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'import'
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-[#F5F3EE] text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>دریافت فایل از Drive / Sheets</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('export');
              setPendingConfirmation(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'export'
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-[#F5F3EE] text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>ذخیره خروجی در Drive / Sheets</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-xl border border-[#F2B8B5] bg-[#FEF3F2] px-3.5 py-2.5 text-xs text-[#9A2E1A]">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="leading-6">{errorMsg}</span>
            </div>
          )}

          {successInfo && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#C7DDD0] bg-[#EEF6F0] px-3.5 py-2.5 text-xs text-[#14532D]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{successInfo.message}</span>
              </div>
              {successInfo.url && (
                <a
                  href={successInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-[#1E3A5F] underline"
                >
                  <span>{successInfo.linkLabel || 'باز کردن'}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}

          {!workspaceAccessToken ? (
            <div className="rounded-xl border border-[#D8E2EE] bg-[#F5F8FC] p-6 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-[#D8E2EE] text-[#1E3A5F]">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h3 className="text-sm font-extrabold text-[#1A1816]">
                  اتصال امن با حساب گوگل لازم است
                </h3>
                <p className="text-xs text-[#57534E] leading-6">
                  برای خواندن و نوشتن فایل‌ها در Google Drive و Google Sheets، با حساب گوگل خود وارد شوید. توکن دسترسی فقط در حافظه موقت همین نشست نگهداری می‌شود.
                </p>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void handleConnectClick()}
                  disabled={connectingWorkspace}
                  className="gsi-material-button inline-flex items-center gap-3 rounded-lg border border-[#747775] bg-white px-4 py-2.5 text-sm font-semibold text-[#1F1F1F] shadow-xs hover:bg-[#F8FAFD] disabled:opacity-60 cursor-pointer"
                >
                  {connectingWorkspace ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#1E3A5F]" />
                  ) : (
                    <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  )}
                  <span>Sign in with Google · اتصال به Drive و Sheets</span>
                </button>
              </div>
            </div>
          ) : activeTab === 'import' ? (
            <div className="space-y-4">
              {/* Search & Filter Row */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78716C]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void fetchDriveFilesList();
                    }}
                    placeholder="جستجو در نام فایل‌های Google Drive..."
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] pr-9 pl-3 py-2 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:bg-white focus:outline-none"
                  />
                </div>

                <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-3 py-2 text-xs font-semibold text-[#44403C] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlySpreadsheets}
                    onChange={(e) => setOnlySpreadsheets(e.target.checked)}
                    className="accent-[#1E3A5F]"
                  />
                  <span>فقط Google Sheets</span>
                </label>

                <button
                  type="button"
                  onClick={() => void fetchDriveFilesList()}
                  disabled={loadingFiles}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3 py-2 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFEAF5] disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loadingFiles ? 'animate-spin' : ''}`}
                  />
                  <span>بروزرسانی</span>
                </button>
              </div>

              {/* Dynamic Sheet Tab Selector (when user selects a Google Sheet) */}
              {selectedSheetMeta && (
                <div className="rounded-xl border border-[#1E3A5F] bg-[#F5F8FC] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-extrabold text-[#1E3A5F]">
                      انتخاب تب‌های فایل Google Sheet: «{selectedSheetMeta.title}»
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSheetMeta(null)}
                      className="text-[11px] font-bold text-[#57534E] hover:underline cursor-pointer"
                    >
                      بستن
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedSheetMeta.tabs.map((tab) => {
                      const checked = selectedImportTabs.includes(tab.title);
                      return (
                        <label
                          key={tab.sheetId}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold cursor-pointer ${
                            checked
                              ? 'border-[#1E3A5F] bg-white text-[#1E3A5F]'
                              : 'border-[#D6D0C4] bg-[#FAF9F6] text-[#57534E]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedImportTabs((prev) =>
                                e.target.checked
                                  ? [...prev, tab.title]
                                  : prev.filter((t) => t !== tab.title)
                              );
                            }}
                            className="accent-[#1E3A5F]"
                          />
                          <span>{tab.title}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={
                        selectedImportTabs.length === 0 || importingFileId !== null
                      }
                      onClick={() => {
                        const file = driveFiles.find(
                          (f) => f.id === selectedSheetMeta.spreadsheetId
                        );
                        if (file) {
                          void handleImportDriveItem(file, selectedImportTabs);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-4 py-2 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer"
                    >
                      {importingFileId === selectedSheetMeta.spreadsheetId && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      <span>
                        افزودن {toPersianDigits(selectedImportTabs.length)} تب به صف مرحله ۱
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Drive File List */}
              {loadingFiles ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#57534E]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#1E3A5F]" />
                  <span>در حال دریافت فایل‌ها از Google Drive...</span>
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#D6D0C4] bg-[#FAF9F6] p-8 text-center text-xs text-[#57534E]">
                  فایل سازگاری در Google Drive یافت نشد. می‌توانید عبارت جستجو را تغییر دهید یا فایل‌های `.md` / `.docx` / `.pdf` / Google Docs / Sheets را در درایو قرار دهید.
                </div>
              ) : (
                <ul className="divide-y divide-[#EFECE4] rounded-xl border border-[#E2DDD3] bg-white">
                  {driveFiles.map((file) => {
                    const isSheet = file.mimeType === GOOGLE_SHEET_MIME;
                    const isSlides = file.mimeType === GOOGLE_SLIDES_MIME;
                    const busy = importingFileId === file.id;
                    return (
                      <li
                        key={file.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-[#FCFBF8]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                              isSheet
                                ? 'bg-[#EEF6F0] text-[#14532D]'
                                : isSlides
                                  ? 'bg-[#FEF6E7] text-[#92400E]'
                                  : 'bg-[#EEF3F8] text-[#1E3A5F]'
                            }`}
                          >
                            {isSheet ? (
                              <Table2 className="h-4 w-4" />
                            ) : isSlides ? (
                              <Presentation className="h-4 w-4" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-[#1A1816]" dir="auto">
                              {file.name}
                            </div>
                            <div className="text-[11px] text-[#78716C]">
                              {isSheet
                                ? 'Google Sheets'
                                : isSlides
                                  ? 'Google Slides'
                                  : file.mimeType === GOOGLE_DOC_MIME
                                    ? 'Google Docs'
                                    : 'فایل درایو'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isSheet ? (
                            <button
                              type="button"
                              disabled={loadingSheetTabs || busy}
                              onClick={() => void handleInspectSheetForImport(file)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#14532D]/40 bg-[#EEF6F0] px-3 py-1.5 text-xs font-bold text-[#14532D] hover:bg-[#E1F0E5] disabled:opacity-50 cursor-pointer"
                            >
                              <Table2 className="h-3.5 w-3.5" />
                              <span>انتخاب تب‌ها و ورود</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleImportDriveItem(file)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-[#EEF3F8] px-3 py-1.5 text-xs font-bold text-[#1E3A5F] hover:bg-[#DFEAF5] disabled:opacity-50 cursor-pointer"
                            >
                              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              <span>افزودن به صف مرحله ۱</span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : !book ? (
            <div className="rounded-xl border border-dashed border-[#D6D0C4] bg-[#FAF9F6] p-8 text-center text-xs text-[#57534E] leading-6">
              برای ارسال سند کتاب به Google Drive یا ساخت گزارش در Google Sheets، ابتدا مراحل ۱ تا ۳ را اجرا کنید تا خروجی کتاب ساخته شود.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Mandatory Explicit Confirmation Dialog Before Any Drive/Sheets Mutation */}
              {pendingConfirmation && (
                <div
                  role="alertdialog"
                  aria-label="تأیید عملیات تغییر یا ایجاد در Google Workspace"
                  className="rounded-xl border-2 border-[#B45309] bg-[#FFFBEB] p-4 space-y-3"
                >
                  <div className="text-xs sm:text-sm font-extrabold text-[#92400E]">
                    تأیید نهایی پیش از اعمال تغییر در حساب گوگل شما
                  </div>
                  <p className="text-xs text-[#78350F] leading-6">
                    {pendingConfirmation.kind === 'drive_upload'
                      ? pendingConfirmation.overwriteFileId
                        ? `فایل موجود «${pendingConfirmation.overwriteFileName}» در Google Drive شما با نسخه جدید («${pendingConfirmation.fileName}») بازنویسی خواهد شد. آیا مطمئن هستید؟`
                        : `یک فایل جدید با نام «${pendingConfirmation.fileName}» در Google Drive شما ساخته و ذخیره خواهد شد. آیا تأیید می‌کنید؟`
                      : pendingConfirmation.kind === 'sheet_create'
                        ? `یک Google Sheet جدید با عنوان «${pendingConfirmation.spreadsheetTitle}» شامل ${toPersianDigits(
                            pendingConfirmation.tabNames.length
                          )} تب (${pendingConfirmation.tabNames.join('، ')}) در حساب شما ایجاد خواهد شد.`
                        : pendingConfirmation.kind === 'doc_create'
                          ? `یک سند بومی Google Docs جدید با عنوان «${pendingConfirmation.docTitle}» شامل متن ساختاریافته کتاب در حساب شما ساخته خواهد شد. آیا تأیید می‌کنید؟`
                          : pendingConfirmation.kind === 'slides_create'
                            ? `یک فایل ارائه Google Slides جدید با عنوان «${pendingConfirmation.presentationTitle}» شامل خلاصه فصل‌ها و نقشه‌های WinOLS در حساب شما ساخته خواهد شد. آیا تأیید می‌کنید؟`
                            : `داده‌های تب «${pendingConfirmation.sheetTitle}» در فایل Google Sheet «${pendingConfirmation.spreadsheetTitle}» به‌روزرسانی و بازنویسی خواهد شد. آیا تأیید می‌کنید؟`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={executingMutation}
                      onClick={() => void handleConfirmMutation()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F4022] disabled:opacity-60 cursor-pointer"
                    >
                      {executingMutation && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      <span>تأیید و اجرای عملیات</span>
                    </button>
                    <button
                      type="button"
                      disabled={executingMutation}
                      onClick={() => setPendingConfirmation(null)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6D0C4] bg-white px-4 py-2 text-xs font-bold text-[#44403C] hover:bg-[#FAF9F6] cursor-pointer"
                    >
                      انصراف
                    </button>
                  </div>
                </div>
              )}

              {/* Export Section 1: Save Book to Google Drive */}
              <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[#1E3A5F]">
                  <UploadCloud className="h-4 w-4" />
                  <span>۱. ذخیره فایل نهایی کتاب در Google Drive</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="block text-[11px] font-bold text-[#57534E]">
                      نام فایل در Google Drive
                    </label>
                    <input
                      type="text"
                      value={driveExportFileName}
                      onChange={(e) => setDriveExportFileName(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-[#57534E]">
                      فرمت خروجی
                    </label>
                    <select
                      value={driveExportFormat}
                      onChange={(e) =>
                        setDriveExportFormat(e.target.value as 'docx' | 'md')
                      }
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs font-semibold text-[#1A1816]"
                    >
                      <option value="docx">Word (.docx)</option>
                      <option value="md">Markdown (.md)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-[#57534E]">
                    حالت ذخیره (فایل جدید یا جایگزینی فایل موجود)
                  </label>
                  <select
                    value={overwriteDriveFileId}
                    onChange={(e) => setOverwriteDriveFileId(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
                  >
                    <option value="">ایجاد فایل جدید در Google Drive</option>
                    {driveFiles
                      .filter(
                        (f) =>
                          f.mimeType !== GOOGLE_DOC_MIME &&
                          f.mimeType !== GOOGLE_SHEET_MIME &&
                          f.mimeType !== GOOGLE_SLIDES_MIME
                      )
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          به‌روزرسانی و جایگزینی: {f.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!driveExportFileName.trim() || executingMutation}
                    onClick={() => {
                      const targetFile = driveFiles.find(
                        (f) => f.id === overwriteDriveFileId
                      );
                      setPendingConfirmation({
                        kind: 'drive_upload',
                        fileName: driveExportFileName.trim(),
                        format: driveExportFormat,
                        overwriteFileId: targetFile?.id || null,
                        overwriteFileName: targetFile?.name || null,
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-4 py-2 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    <span>ذخیره در Google Drive</span>
                  </button>
                </div>
              </div>

              {/* Export Section 2: Export Audit + Chapters + WinOLS Maps to Google Sheets */}
              <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-[#14532D]">
                    <Table2 className="h-4 w-4" />
                    <span>۲. خروجی گزارش ممیزی، سرفصل‌ها و نقشه‌های WinOLS در Google Sheets</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold">
                    <input
                      type="radio"
                      name="sheetExportMode"
                      checked={sheetExportMode === 'new'}
                      onChange={() => setSheetExportMode('new')}
                      className="accent-[#14532D]"
                    />
                    <span>ایجاد Google Sheet جدید (۳ تب کامل)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold">
                    <input
                      type="radio"
                      name="sheetExportMode"
                      checked={sheetExportMode === 'update'}
                      onChange={() => setSheetExportMode('update')}
                      className="accent-[#14532D]"
                    />
                    <span>به‌روزرسانی یک Google Sheet موجود</span>
                  </label>
                </div>

                {sheetExportMode === 'new' ? (
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-[#57534E]">
                      عنوان فایل Google Sheets جدید
                    </label>
                    <input
                      type="text"
                      value={newSheetTitle}
                      onChange={(e) => setNewSheetTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-[#57534E]">
                        انتخاب Google Sheet
                      </label>
                      <select
                        value={targetUpdateSheetId}
                        onChange={(e) => setTargetUpdateSheetId(e.target.value)}
                        className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
                      >
                        <option value="">انتخاب کنید...</option>
                        {spreadsheetDriveFiles.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-[#57534E]">
                        تب مقصد در شیت
                      </label>
                      <select
                        value={targetUpdateTabTitle}
                        disabled={!targetUpdateSheetMeta || loadingSheetTabs}
                        onChange={(e) => setTargetUpdateTabTitle(e.target.value)}
                        className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816] disabled:opacity-50"
                      >
                        {targetUpdateSheetMeta ? (
                          targetUpdateSheetMeta.tabs.map((t) => (
                            <option key={t.sheetId} value={t.title}>
                              {t.title}
                            </option>
                          ))
                        ) : (
                          <option value="">ابتدا شیت را انتخاب کنید</option>
                        )}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-[#57534E]">
                        بخش داده برای نوشتن
                      </label>
                      <select
                        value={targetUpdatePayloadKey}
                        onChange={(e) =>
                          setTargetUpdatePayloadKey(
                            e.target.value as 'summary' | 'chapters' | 'winols'
                          )
                        }
                        className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
                      >
                        <option value="winols">جدول نقشه‌های WinOLS</option>
                        <option value="chapters">فهرست فصل‌ها و بخش‌ها</option>
                        <option value="summary">خلاصه ممیزی و پوشش</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={
                      executingMutation ||
                      (sheetExportMode === 'new'
                        ? !newSheetTitle.trim()
                        : !targetUpdateSheetId || !targetUpdateTabTitle)
                    }
                    onClick={() => {
                      if (sheetExportMode === 'new') {
                        setPendingConfirmation({
                          kind: 'sheet_create',
                          spreadsheetTitle: newSheetTitle.trim(),
                          tabNames: [
                            'خلاصه_ممیزی',
                            'فهرست_فصل‌ها',
                            'نقشه‌های_WinOLS',
                          ],
                        });
                      } else {
                        setPendingConfirmation({
                          kind: 'sheet_update',
                          spreadsheetId: targetUpdateSheetId,
                          spreadsheetTitle:
                            targetUpdateSheetMeta?.title || 'Google Sheet',
                          sheetTitle: targetUpdateTabTitle,
                          sourceTabKey: targetUpdatePayloadKey,
                        });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F4022] disabled:opacity-50 cursor-pointer"
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    <span>
                      {sheetExportMode === 'new'
                        ? 'ساخت گزارش در Google Sheets'
                        : 'به‌روزرسانی تب در Google Sheets'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Export Section 3: Native Google Docs & Google Slides */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-[#1E3A5F]">
                    <FileText className="h-4 w-4" />
                    <span>۳. ساخت سند بومی در Google Docs</span>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-[#57534E]">
                      عنوان سند Google Docs
                    </label>
                    <input
                      type="text"
                      value={newDocTitle}
                      onChange={(e) => setNewDocTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!newDocTitle.trim() || executingMutation}
                      onClick={() =>
                        setPendingConfirmation({
                          kind: 'doc_create',
                          docTitle: newDocTitle.trim(),
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#162C49] disabled:opacity-50 cursor-pointer"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>ایجاد در Google Docs</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-[#E2DDD3] bg-white p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-[#92400E]">
                    <Presentation className="h-4 w-4" />
                    <span>۴. ساخت اسلاید ارائه در Google Slides</span>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-[#57534E]">
                      عنوان ارائه Google Slides
                    </label>
                    <input
                      type="text"
                      value={newSlidesTitle}
                      onChange={(e) => setNewSlidesTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-xs text-[#1A1816]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!newSlidesTitle.trim() || executingMutation}
                      onClick={() =>
                        setPendingConfirmation({
                          kind: 'slides_create',
                          presentationTitle: newSlidesTitle.trim(),
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#92400E] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#78350F] disabled:opacity-50 cursor-pointer"
                    >
                      <Presentation className="h-3.5 w-3.5" />
                      <span>ایجاد در Google Slides</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
