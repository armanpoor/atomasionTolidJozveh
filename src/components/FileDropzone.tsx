import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  FileCode2,
  FileDiff,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType2,
  FolderUp,
  GitCompareArrows,
  Loader2,
  Maximize2,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ContentUnitDto,
  FileRole,
  ParsedBook,
  SourceFileDto,
  SourceFileFormat,
} from '../lib/bookTypes';
import {
  computeTotalQueueBytes,
  DROPZONE_ACCEPT_ATTRIBUTE,
  formatCompactFileSize,
  getFormatVisualMeta,
  partitionDroppedFiles,
} from '../lib/dropzoneUtils';
import {
  buildIngestedFileComparisonData,
  computeLineDiff,
  filterQueuedFilesByName,
  matchQueuedToIngestedFile,
} from '../lib/fileDiffUtils';
import { parseAnySourceFile, toPersianDigits } from '../lib/formatParsers';
import { FilePreprocessReport } from '../lib/filePreprocessEngine';

export type UploadQueueStatus = 'pending' | 'uploading' | 'complete';

export interface QueuedUploadFile {
  id: string;
  name: string;
  format: SourceFileFormat;
  sizeBytes: number;
  role?: FileRole;
  file?: File;
  presetText?: string;
  uploadStatus?: UploadQueueStatus;
  uploadProgress?: number;
  preprocessReport?: FilePreprocessReport;
}

const FILE_ROLE_LABEL_FA: Record<FileRole, string> = {
  master: 'مرجع (Master)',
  supplement: 'تکمیلی (Supplement)',
  standard: 'استاندارد (Standard)',
};

const UPLOAD_STATUS_META: Record<
  UploadQueueStatus,
  {
    labelFa: string;
    labelEn: string;
    barColorClass: string;
    trackColorClass: string;
    textColorClass: string;
    defaultProgress: number;
  }
> = {
  pending: {
    labelFa: 'در انتظار (Pending)',
    labelEn: 'pending',
    barColorClass: 'bg-[#9CA3AF]',
    trackColorClass: 'bg-[#EAE5DA]',
    textColorClass: 'text-[#57534E]',
    defaultProgress: 12,
  },
  uploading: {
    labelFa: 'در حال آپلود (Uploading)',
    labelEn: 'uploading',
    barColorClass: 'bg-[#1E3A5F] animate-pulse',
    trackColorClass: 'bg-[#DCE6F2]',
    textColorClass: 'text-[#1E3A5F]',
    defaultProgress: 65,
  },
  complete: {
    labelFa: 'تکمیل‌شده (Complete)',
    labelEn: 'complete',
    barColorClass: 'bg-[#15803D]',
    trackColorClass: 'bg-[#DCFCE7]',
    textColorClass: 'text-[#14532D]',
    defaultProgress: 100,
  },
};

interface FileDropzoneProps {
  queuedFiles: QueuedUploadFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onMoveFile: (id: string, direction: 'up' | 'down') => void;
  onClearFiles: () => void;
  showRoleSelector?: boolean;
  onSetFileRole?: (id: string, role: FileRole) => void;
  /** Selected file IDs for bulk File Role & Delete actions in WorkspaceSidebar */
  selectedFileIds?: string[];
  onToggleSelectFile?: (id: string) => void;
  onToggleSelectAllVisible?: (visibleIds: string[]) => void;
  onBulkRemoveFiles?: (ids: string[]) => void;
  disabled?: boolean;
  /** Optional ingested project source files for visual Diff View comparison */
  sourceFiles?: SourceFileDto[];
  /** Optional ingested content units used to reconstruct the system's ingested version */
  contentUnits?: ContentUnitDto[];
  /** Optional filename search filter from WorkspaceSidebar */
  fileNameFilter?: string;
  /** External trigger to open Diff View directly on a specific ingested SourceFileDto ID */
  requestedDiffFileId?: string | null;
  onClearDiffRequest?: () => void;
}

type DropzoneMode = 'upload' | 'diff';

function getFormatIconComponent(format: SourceFileFormat) {
  switch (format) {
    case 'docx':
      return FileType2;
    case 'json':
      return FileJson;
    case 'csv':
      return FileSpreadsheet;
    case 'html':
      return FileCode2;
    default:
      return FileText;
  }
}

function inferFormatFromFileName(name: string): SourceFileFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.txt')) return 'txt';
  return 'md';
}

function flattenParsedBookToLines(book: ParsedBook): string {
  const out: string[] = [];
  for (const ch of book.chapters) {
    if (ch.title?.trim()) out.push(ch.title.trim());
    const pushBlocks = (blocks: typeof ch.introBlocks) => {
      for (const b of blocks) {
        if (b.type === 'paragraph' || b.type === 'subheading') {
          if (b.text?.trim()) out.push(b.text.trim());
        } else if (b.type === 'list') {
          for (const item of b.items) {
            if (item.trim()) out.push(`- ${item.trim()}`);
          }
        } else if (b.type === 'callout') {
          if (b.title?.trim()) out.push(b.title.trim());
          for (const p of b.paragraphs) {
            if (p.trim()) out.push(p.trim());
          }
        } else if (b.type === 'table') {
          if (b.headers.length > 0) out.push(`| ${b.headers.join(' | ')} |`);
          for (const row of b.rows) {
            out.push(`| ${row.join(' | ')} |`);
          }
        } else if (b.type === 'equation') {
          const expr = (b.readable || b.latex || '').trim();
          if (expr) out.push(expr);
        }
      }
    };
    pushBlocks(ch.introBlocks);
    for (const sec of ch.sections) {
      if (sec.title?.trim()) out.push(sec.title.trim());
      pushBlocks(sec.blocks);
    }
  }
  return out.join('\n');
}

async function readReadableSourceFileText(params: {
  name: string;
  format: SourceFileFormat;
  file?: File;
  presetText?: string;
}): Promise<string> {
  if (typeof params.presetText === 'string' && params.presetText.length > 0) {
    return params.presetText;
  }
  if (!params.file) return '';
  if (params.format === 'docx' || params.format === 'pdf') {
    const buffer = await params.file.arrayBuffer();
    const parsed = await parseAnySourceFile({
      name: params.name,
      format: params.format,
      buffer: new Uint8Array(buffer),
    });
    return flattenParsedBookToLines(parsed);
  }
  return params.file.text();
}

export function FileDropzone({
  queuedFiles,
  onAddFiles,
  onRemoveFile,
  onMoveFile,
  onClearFiles,
  showRoleSelector = false,
  onSetFileRole,
  selectedFileIds,
  onToggleSelectFile,
  onToggleSelectAllVisible,
  onBulkRemoveFiles,
  disabled = false,
  sourceFiles = [],
  contentUnits = [],
  fileNameFilter = '',
  requestedDiffFileId = null,
  onClearDiffRequest,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const diffLocalFileRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<DropzoneMode>('upload');
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);

  const isSelectionControlled = typeof onToggleSelectFile === 'function';
  const effectiveSelectedIds = isSelectionControlled
    ? selectedFileIds ?? []
    : internalSelectedIds;

  useEffect(() => {
    if (isSelectionControlled) return;
    const valid = new Set(queuedFiles.map((q) => q.id));
    setInternalSelectedIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [queuedFiles, isSelectionControlled]);

  const handleToggleRowSelection = (id: string) => {
    if (onToggleSelectFile) {
      onToggleSelectFile(id);
    } else {
      setInternalSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    }
  };

  // Diff View state
  const [selectedIngestedId, setSelectedIngestedId] = useState<string>('');
  const [selectedSourceChoice, setSelectedSourceChoice] = useState<string>('ingested_raw');
  const [localCompareFile, setLocalCompareFile] = useState<{
    name: string;
    format: SourceFileFormat;
    file: File;
  } | null>(null);
  const [externalSourceText, setExternalSourceText] = useState<string>('');
  const [loadingSourceText, setLoadingSourceText] = useState(false);
  const [sourceReadError, setSourceReadError] = useState<string | null>(null);
  const [changesOnly, setChangesOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Sync external diff request (e.g. clicking "مقایسه" in WorkspaceSidebar source files list)
  useEffect(() => {
    if (!requestedDiffFileId) return;
    const exists = sourceFiles.some((sf) => sf.id === requestedDiffFileId);
    if (exists) {
      setSelectedIngestedId(requestedDiffFileId);
      setMode('diff');
      // If a queued file matches this ingested file, select it automatically
      const targetSf = sourceFiles.find((sf) => sf.id === requestedDiffFileId);
      const matchedQueued = targetSf
        ? queuedFiles.find(
            (q) => matchQueuedToIngestedFile(q.name, [targetSf]) !== null
          )
        : null;
      if (matchedQueued) {
        setSelectedSourceChoice(`queued:${matchedQueued.id}`);
      } else if (!localCompareFile) {
        setSelectedSourceChoice('ingested_raw');
      }
    }
    onClearDiffRequest?.();
  }, [requestedDiffFileId, sourceFiles, queuedFiles, localCompareFile, onClearDiffRequest]);

  // Keep selectedIngestedId valid when sourceFiles changes
  useEffect(() => {
    if (sourceFiles.length === 0) {
      setSelectedIngestedId('');
      return;
    }
    if (!selectedIngestedId || !sourceFiles.some((sf) => sf.id === selectedIngestedId)) {
      setSelectedIngestedId(sourceFiles[0].id);
    }
  }, [sourceFiles, selectedIngestedId]);

  // Close Side-by-Side modal on Escape key
  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen]);

  // Load text whenever the user compares against a queued file or picked local file
  useEffect(() => {
    let cancelled = false;
    setSourceReadError(null);

    if (selectedSourceChoice === 'ingested_raw') {
      setExternalSourceText('');
      setLoadingSourceText(false);
      return;
    }

    if (selectedSourceChoice === 'local_file' && localCompareFile) {
      setLoadingSourceText(true);
      readReadableSourceFileText(localCompareFile)
        .then((text) => {
          if (!cancelled) setExternalSourceText(text);
        })
        .catch((err) => {
          if (!cancelled) {
            setExternalSourceText('');
            setSourceReadError(
              err instanceof Error ? err.message : 'خواندن متن فایل محلی ناموفق بود.'
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingSourceText(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (selectedSourceChoice.startsWith('queued:')) {
      const qId = selectedSourceChoice.slice('queued:'.length);
      const queuedItem = queuedFiles.find((q) => q.id === qId);
      if (!queuedItem) {
        setSelectedSourceChoice('ingested_raw');
        return;
      }
      setLoadingSourceText(true);
      readReadableSourceFileText(queuedItem)
        .then((text) => {
          if (!cancelled) setExternalSourceText(text);
        })
        .catch((err) => {
          if (!cancelled) {
            setExternalSourceText('');
            setSourceReadError(
              err instanceof Error ? err.message : 'خواندن متن فایل صف ناموفق بود.'
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingSourceText(false);
        });
      return () => {
        cancelled = true;
      };
    }

    return () => {
      cancelled = true;
    };
  }, [selectedSourceChoice, localCompareFile, queuedFiles]);

  const handleIncomingFiles = (rawFiles: FileList | File[]) => {
    const fileArray = Array.from(rawFiles);
    if (fileArray.length === 0) return;

    const existing = queuedFiles.map((item) => ({
      name: item.name,
      size: item.sizeBytes,
    }));

    const { accepted, rejectedNames, duplicateNames } = partitionDroppedFiles(
      fileArray,
      existing
    );

    if (accepted.length > 0) {
      onAddFiles(accepted);
    }

    const messages: string[] = [];
    if (rejectedNames.length > 0) {
      messages.push(
        `فرمت پشتیبانی‌نشده نادیده گرفته شد: ${rejectedNames.slice(0, 3).join('، ')}${
          rejectedNames.length > 3 ? ` و ${toPersianDigits(rejectedNames.length - 3)} فایل دیگر` : ''
        }`
      );
    }
    if (duplicateNames.length > 0) {
      messages.push(
        `${toPersianDigits(duplicateNames.length)} فایل تکراری قبلاً در صف موجود بود.`
      );
    }
    setNotice(messages.length > 0 ? messages.join(' · ') : null);
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files?.length) {
      handleIncomingFiles(e.dataTransfer.files);
    }
  };

  const visibleQueuedFiles = useMemo(
    () => filterQueuedFilesByName(queuedFiles, fileNameFilter),
    [queuedFiles, fileNameFilter]
  );

  const selectedIngestedFile = useMemo(
    () => sourceFiles.find((sf) => sf.id === selectedIngestedId) || null,
    [sourceFiles, selectedIngestedId]
  );

  const ingestedComparison = useMemo(() => {
    if (!selectedIngestedFile) return null;
    return buildIngestedFileComparisonData(selectedIngestedFile.id, contentUnits);
  }, [selectedIngestedFile, contentUnits]);

  const diffLeftLabel = useMemo(() => {
    if (selectedSourceChoice === 'local_file' && localCompareFile) {
      return `فایل محلی: ${localCompareFile.name}`;
    }
    if (selectedSourceChoice.startsWith('queued:')) {
      const qId = selectedSourceChoice.slice('queued:'.length);
      const q = queuedFiles.find((item) => item.id === qId);
      return q ? `فایل منبع (صف): ${q.name}` : 'فایل منبع';
    }
    return 'متن خام استخراج‌شده (تمام واحدهای منبع)';
  }, [selectedSourceChoice, localCompareFile, queuedFiles]);

  const diffRightLabel = useMemo(() => {
    if (selectedSourceChoice === 'ingested_raw') {
      return 'نسخه فعال در سیستم (پس از ادغام و ممیزی)';
    }
    return selectedIngestedFile
      ? `نسخه ثبت‌شده در سیستم: ${selectedIngestedFile.fileName}`
      : 'نسخه ثبت‌شده در سیستم';
  }, [selectedSourceChoice, selectedIngestedFile]);

  const diffResult = useMemo(() => {
    if (!ingestedComparison) return null;
    const leftText =
      selectedSourceChoice === 'ingested_raw'
        ? ingestedComparison.allExtractedText
        : externalSourceText;
    const rightText =
      selectedSourceChoice === 'ingested_raw'
        ? ingestedComparison.activeIngestedText
        : ingestedComparison.allExtractedText;
    return computeLineDiff(leftText, rightText);
  }, [ingestedComparison, selectedSourceChoice, externalSourceText]);

  const visibleDiffLines = useMemo(() => {
    if (!diffResult) return [];
    return changesOnly
      ? diffResult.lines.filter((l) => l.kind !== 'equal')
      : diffResult.lines;
  }, [diffResult, changesOnly]);

  const visibleSideBySideRows = useMemo(() => {
    if (!diffResult) return [];
    return changesOnly
      ? diffResult.sideBySideRows.filter(
          (r) => r.leftKind !== 'equal' || r.rightKind !== 'equal'
        )
      : diffResult.sideBySideRows;
  }, [diffResult, changesOnly]);

  const hasFiles = queuedFiles.length > 0;
  const totalBytes = computeTotalQueueBytes(queuedFiles);
  const showModeToggle = sourceFiles.length > 0 || queuedFiles.length > 0;

  return (
    <div className="mt-3 space-y-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={disabled}
        accept={DROPZONE_ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            handleIncomingFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <input
        ref={diffLocalFileRef}
        type="file"
        disabled={disabled}
        accept={DROPZONE_ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) {
            setLocalCompareFile({
              name: picked.name,
              format: inferFormatFromFileName(picked.name),
              file: picked,
            });
            setSelectedSourceChoice('local_file');
            const autoMatch = matchQueuedToIngestedFile(picked.name, sourceFiles);
            if (autoMatch) {
              setSelectedIngestedId(autoMatch.id);
            }
            e.target.value = '';
          }
        }}
      />

      {/* Interactive Segmented Mode Toggle: Upload vs Diff View */}
      {showModeToggle && (
        <div
          role="tablist"
          aria-label="حالت نمایش بخش فایل‌های ورودی"
          className="grid grid-cols-2 gap-1 rounded-lg bg-[#EFECE4] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'upload'}
            data-testid="dropzone-mode-upload"
            onClick={() => setMode('upload')}
            className={`flex min-h-[34px] items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'upload'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <UploadCloud className="h-3.5 w-3.5 shrink-0" />
            <span>آپلود فایل</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'diff'}
            data-testid="dropzone-mode-diff"
            onClick={() => setMode('diff')}
            className={`flex min-h-[34px] items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'diff'
                ? 'bg-white text-[#1E3A5F] shadow-xs'
                : 'text-[#57534E] hover:text-[#1A1816]'
            }`}
          >
            <FileDiff className="h-3.5 w-3.5 shrink-0" />
            <span>مقایسه (Diff View)</span>
          </button>
        </div>
      )}

      {mode === 'upload' ? (
        <>
          {/* Multi-file Drag & Drop Surface (Adaptive: full canvas when empty, compact strip when files queued) */}
          <div
            data-testid="file-dropzone"
            data-dragging={isDragging ? 'true' : 'false'}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-md border-2 border-dashed transition-colors duration-150 ${
              isDragging
                ? 'border-[#1E3A5F] bg-[#EBF2FA]'
                : hasFiles
                ? 'border-[#CFC8B9] bg-[#FBF9F5] hover:border-[#1E3A5F] hover:bg-[#F5F7FA]'
                : 'border-[#CFC8B9] bg-[#FBF9F5] hover:border-[#1E3A5F] hover:bg-[#F5F7FA]'
            } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              aria-label={
                hasFiles
                  ? 'افزودن فایل‌های بیشتر با کشیدن و رها کردن یا انتخاب از دستگاه'
                  : 'انتخاب یا رها کردن یک یا چند فایل ورودی'
              }
              className={`flex w-full cursor-pointer text-right focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F] ${
                hasFiles
                  ? 'flex-col items-center justify-between gap-2.5 px-4 py-3.5 sm:flex-row sm:text-right'
                  : 'flex-col items-center justify-center px-4 py-7 text-center sm:py-9'
              }`}
            >
              {hasFiles ? (
                <>
                  <div className="flex items-center gap-3 text-right">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[#E9F0F8] text-[#1E3A5F]">
                      <UploadCloud className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-[#1A1816] sm:text-sm">
                        {isDragging
                          ? 'فایل‌ها را اینجا رها کنید تا اضافه شوند'
                          : 'فایل‌های بیشتری بکشید و رها کنید یا از دستگاه انتخاب نمایید'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#57534E]">
                        پشتیبانی چندفایلی:{' '}
                        <span className="font-mono-ltr font-semibold text-[#1E3A5F]">
                          DOCX · PDF · MD · TXT · JSON · CSV · HTML
                        </span>
                      </div>
                    </div>
                  </div>

                  <span className="inline-flex min-h-[40px] w-full shrink-0 items-center justify-center gap-1.5 rounded-sm bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white sm:w-auto">
                    <Plus className="h-4 w-4" />
                    <span className="whitespace-nowrap">افزودن فایل</span>
                  </span>
                </>
              ) : (
                <>
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-md transition-transform duration-150 ${
                      isDragging
                        ? 'scale-105 bg-[#1E3A5F] text-white'
                        : 'bg-[#E9F0F8] text-[#1E3A5F]'
                    }`}
                  >
                    <UploadCloud className="h-6 w-6" />
                  </span>

                  <div className="mt-3 text-sm font-bold text-[#1A1816]">
                    {isDragging
                      ? 'فایل‌ها را اینجا رها کنید'
                      : 'چند فایل را بکشید و اینجا رها کنید یا لمس نمایید'}
                  </div>

                  <div className="mt-1 text-xs text-[#57534E]">
                    امکان انتخاب هم‌زمان چندین فایل ·{' '}
                    <span className="font-mono-ltr font-semibold text-[#1E3A5F]">
                      .docx · .pdf · .md · .txt · .json · .csv · .html
                    </span>
                  </div>

                  <span className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-sm bg-[#1E3A5F] px-5 py-2 text-xs font-semibold text-white">
                    <Plus className="h-4 w-4" />
                    <span className="whitespace-nowrap">انتخاب فایل از دستگاه</span>
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Inline Rejection / Duplicate Feedback Notice */}
          {notice && (
            <div
              role="status"
              className="flex items-start justify-between gap-2 rounded-sm border border-[#E6CFC2] bg-[#FDF6F2] px-3 py-2.5 text-xs text-[#9A3412]"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="leading-relaxed">{notice}</span>
              </div>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="بستن پیام فایل"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-[#9A3412] hover:bg-[#F7E5DC]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Compact, Clean File Cards Grid */}
          {hasFiles && (
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between gap-2 text-xs text-[#57534E]">
                <div className="flex items-center gap-2 tabular-nums">
                  {visibleQueuedFiles.length > 0 && (
                    <input
                      type="checkbox"
                      data-testid="queue-select-all-checkbox"
                      checked={
                        visibleQueuedFiles.length > 0 &&
                        visibleQueuedFiles.every((f) => effectiveSelectedIds.includes(f.id))
                      }
                      onChange={() => {
                        const visibleIds = visibleQueuedFiles.map((f) => f.id);
                        if (onToggleSelectAllVisible) {
                          onToggleSelectAllVisible(visibleIds);
                        } else {
                          const allChecked = visibleIds.every((id) =>
                            effectiveSelectedIds.includes(id)
                          );
                          setInternalSelectedIds(allChecked ? [] : visibleIds);
                        }
                      }}
                      aria-label="انتخاب یا لغو انتخاب همه فایل‌های صف"
                      title="انتخاب همه فایل‌های صف"
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#1E3A5F]"
                    />
                  )}
                  <div>
                    <strong className="font-bold text-[#1A1816]">
                      {fileNameFilter.trim()
                        ? `${toPersianDigits(visibleQueuedFiles.length)} از ${toPersianDigits(queuedFiles.length)} فایل`
                        : `${toPersianDigits(queuedFiles.length)} فایل`}
                    </strong>{' '}
                    آماده پردازش
                    <span className="mx-1.5 text-[#C8C1B4]" aria-hidden="true">
                      ·
                    </span>
                    <span>مجموع {formatCompactFileSize(totalBytes)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    onClearFiles();
                  }}
                  className="min-h-[36px] shrink-0 px-2 text-xs font-semibold text-[#9A3412] hover:underline cursor-pointer"
                >
                  پاک کردن همه
                </button>
              </div>

              {/* Standalone Contextual Bulk Toolbar when FileDropzone manages its own selection */}
              {!isSelectionControlled && effectiveSelectedIds.length > 0 && (
                <div
                  data-testid="file-queue-bulk-toolbar"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#1E3A5F] bg-[#EEF3F8] px-2.5 py-2 text-[11px]"
                >
                  <span className="font-bold text-[#1E3A5F] tabular-nums">
                    {toPersianDigits(effectiveSelectedIds.length)} فایل انتخاب‌شده
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {onSetFileRole && (
                      <select
                        aria-label="تغییر نقش گروهی فایل‌های انتخاب‌شده"
                        defaultValue=""
                        onChange={(e) => {
                          const role = e.target.value as FileRole;
                          if (!role) return;
                          effectiveSelectedIds.forEach((id) => onSetFileRole(id, role));
                          e.target.value = '';
                        }}
                        className="rounded border border-[#C6D5E6] bg-white px-2 py-1 text-[10.5px] font-bold text-[#1A1816]"
                      >
                        <option value="" disabled>
                          تغییر نقش گروهی...
                        </option>
                        <option value="standard">استاندارد (Standard)</option>
                        <option value="supplement">تکمیلی (Supplement)</option>
                        <option value="master">سند مرجع (Master)</option>
                      </select>
                    )}
                    <button
                      type="button"
                      data-testid="file-queue-bulk-delete-btn"
                      onClick={() => {
                        if (onBulkRemoveFiles) {
                          onBulkRemoveFiles(effectiveSelectedIds);
                        } else {
                          effectiveSelectedIds.forEach((id) => onRemoveFile(id));
                        }
                        setInternalSelectedIds([]);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-[#E6CFC2] bg-[#FEF2F2] px-2 py-1 text-[10.5px] font-bold text-[#9A3412] hover:bg-[#FEE2E2] cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>حذف گروهی</span>
                    </button>
                  </div>
                </div>
              )}

              {visibleQueuedFiles.length === 0 ? (
                <div className="rounded-md border border-[#E5E0D6] bg-white px-3 py-2.5 text-[11px] text-[#78716C]">
                  فایلی در صف آپلود با عبارت «{fileNameFilter.trim()}» مطابقت ندارد.
                </div>
              ) : (
                <ul
                  data-testid="uploaded-file-cards"
                  className="grid grid-cols-1 gap-2"
                >
                  {visibleQueuedFiles.map((item, idx) => {
                    const Icon = getFormatIconComponent(item.format);
                    const meta = getFormatVisualMeta(item.format);
                    const currentRole: FileRole = item.role || 'standard';
                    const isMaster = currentRole === 'master';
                    const isSelected = effectiveSelectedIds.includes(item.id);
                    const matchedIngested = matchQueuedToIngestedFile(item.name, sourceFiles);
                    const status: UploadQueueStatus = item.uploadStatus || 'pending';
                    const statusMeta = UPLOAD_STATUS_META[status];
                    const progressPercent =
                      typeof item.uploadProgress === 'number'
                        ? Math.max(0, Math.min(100, Math.round(item.uploadProgress)))
                        : statusMeta.defaultProgress;

                    return (
                      <li
                        key={item.id}
                        data-testid="uploaded-file-card"
                        data-upload-status={status}
                        data-file-role={currentRole}
                        data-selected={isSelected ? 'true' : 'false'}
                        className={`flex flex-col gap-2 rounded-md border px-3 py-2.5 transition-colors ${
                          isSelected
                            ? 'border-[#1E3A5F] bg-[#EEF3F8]'
                            : isMaster
                            ? 'border-[#1E3A5F] bg-[#F2F6FA]'
                            : 'border-[#E5E0D6] bg-[#FCFBF8] hover:border-[#C9C1B2]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          {/* Leading Selection Checkbox + Format Icon + Compact Info */}
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              data-testid={`select-queued-file-${item.id}`}
                              checked={isSelected}
                              onChange={() => handleToggleRowSelection(item.id)}
                              aria-label={`انتخاب فایل ${item.name} برای حذف یا تغییر نقش گروهی`}
                              className="h-4 w-4 shrink-0 cursor-pointer accent-[#1E3A5F]"
                            />

                            <div
                              className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-sm ${meta.iconBgClass} ${meta.iconTextClass}`}
                              title={meta.persianLabel}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="mt-0.5 text-[8px] font-extrabold leading-none tracking-tight">
                                {meta.shortCode}
                              </span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div
                                className="truncate text-[12.5px] font-bold leading-snug text-[#1A1816]"
                                dir="auto"
                                title={item.name}
                              >
                                {item.name}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#78716C] tabular-nums">
                                <span>{toPersianDigits(idx + 1)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatCompactFileSize(item.sizeBytes)}</span>
                                {matchedIngested && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedIngestedId(matchedIngested.id);
                                        setSelectedSourceChoice(`queued:${item.id}`);
                                        setMode('diff');
                                      }}
                                      className="font-bold text-[#1E3A5F] hover:underline cursor-pointer"
                                    >
                                      مقایسه با نسخه سیستم
                                    </button>
                                  </>
                                )}
                                {onSetFileRole ? (
                                  <select
                                    data-testid={`file-role-select-${item.id}`}
                                    aria-label={`نقش فایل ${item.name}`}
                                    value={currentRole}
                                    onChange={(e) =>
                                      onSetFileRole(item.id, e.target.value as FileRole)
                                    }
                                    className={`mr-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold cursor-pointer ${
                                      isMaster
                                        ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white'
                                        : currentRole === 'supplement'
                                        ? 'border-[#C8B99E] bg-[#EFE9DC] text-[#44403C]'
                                        : 'border-[#D6D0C4] bg-white text-[#57534E]'
                                    }`}
                                  >
                                    <option value="standard" className="bg-white text-[#1A1816]">
                                      استاندارد (Standard)
                                    </option>
                                    <option value="master" className="bg-white text-[#1A1816]">
                                      سند مرجع (Master)
                                    </option>
                                    <option value="supplement" className="bg-white text-[#1A1816]">
                                      فایل تکمیلی (Supplement)
                                    </option>
                                  </select>
                                ) : (
                                  showRoleSelector && (
                                    <span className="mr-1 rounded-sm bg-[#EAE5DA] px-1.5 py-0.5 text-[10px] font-bold text-[#57534E]">
                                      {FILE_ROLE_LABEL_FA[currentRole]}
                                    </span>
                                  )
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Trailing Compact Touch Controls */}
                          <div className="flex shrink-0 items-center gap-0.5">
                            {queuedFiles.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => onMoveFile(item.id, 'up')}
                                  aria-label={`انتقال فایل ${item.name} به بالا`}
                                  className="flex h-8 w-7 items-center justify-center rounded-sm text-[#57534E] transition-colors hover:bg-[#EFECE4] hover:text-[#1E3A5F] disabled:opacity-25 cursor-pointer"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === visibleQueuedFiles.length - 1}
                                  onClick={() => onMoveFile(item.id, 'down')}
                                  aria-label={`انتقال فایل ${item.name} به پایین`}
                                  className="flex h-8 w-7 items-center justify-center rounded-sm text-[#57534E] transition-colors hover:bg-[#EFECE4] hover:text-[#1E3A5F] disabled:opacity-25 cursor-pointer"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}

                            <button
                              type="button"
                              onClick={() => onRemoveFile(item.id)}
                              aria-label={`حذف فایل ${item.name}`}
                              className="flex h-8 w-7 items-center justify-center rounded-sm text-[#9A3412] transition-colors hover:bg-[#FDF2F0] cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Granular Upload Queue Visual Progress Bar (pending, uploading, complete) */}
                        <div
                          data-testid={`upload-queue-progress-${item.id}`}
                          className="space-y-1 border-t border-[#EAE5DA] pt-1.5"
                        >
                          <div className="flex items-center justify-between text-[10px] font-semibold tabular-nums">
                            <span
                              data-testid="upload-queue-status-label"
                              className={statusMeta.textColorClass}
                            >
                              وضعیت صف: {statusMeta.labelFa}
                            </span>
                            <span className="font-mono text-[#57534E]">
                              {toPersianDigits(progressPercent)}٪
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`وضعیت آپلود فایل ${item.name}: ${statusMeta.labelFa}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progressPercent}
                            className={`h-1.5 w-full overflow-hidden rounded-sm ${statusMeta.trackColorClass}`}
                          >
                            <div
                              data-testid="upload-queue-progress-bar-fill"
                              className={`h-full transition-all duration-300 ${statusMeta.barColorClass}`}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          {item.preprocessReport && (
                            <div
                              data-testid="upload-queue-preprocess-badge"
                              data-preprocess-classification={item.preprocessReport.classification}
                              className={`mt-1 flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 text-[10px] font-semibold leading-4 ${
                                item.preprocessReport.classification === 'rejected_non_automotive'
                                  ? 'border border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]'
                                  : item.preprocessReport.classification === 'mixed_hybrid_pruned'
                                    ? 'border border-[#FCD34D] bg-[#FFFBEB] text-[#92400E]'
                                    : 'border border-[#BBF7D0] bg-[#F0FDF4] text-[#14532D]'
                              }`}
                            >
                              <span>
                                {item.preprocessReport.classification === 'rejected_non_automotive'
                                  ? 'پیش‌پردازش لایه ۰: غیرمرتبط با خودرو (رد بدون مصرف توکن)'
                                  : item.preprocessReport.classification === 'mixed_hybrid_pruned'
                                    ? `هرس هوشمند ترکیبی: حذف ${toPersianDigits(item.preprocessReport.prunedOffTopicSegmentsCount)} بخش غیرخودرویی · حفظ ${toPersianDigits(item.preprocessReport.keptAutomotiveSegmentsCount)} بخش فنی`
                                    : `پیش‌پردازش فرمت (${item.format.toUpperCase()}): ۱۰۰٪ مرتبط با خودرو`}
                              </span>
                              {item.preprocessReport.estimatedTokensSaved > 0 && (
                                <span className="font-mono font-bold">
                                  صرفه‌جویی {toPersianDigits(item.preprocessReport.estimatedTokensSaved)} توکن ({toPersianDigits(item.preprocessReport.tokenSavingsPercent)}٪)
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        /* Visual Diff View Mode */
        <div
          data-testid="dropzone-diff-view"
          className="space-y-3 rounded-lg border border-[#E2DDD3] bg-white p-3"
        >
          {sourceFiles.length === 0 ? (
            <div className="space-y-2.5 py-4 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-[#EEF3F8] text-[#1E3A5F]">
                <GitCompareArrows className="h-5 w-5" />
              </div>
              <div className="text-xs font-bold text-[#1A1816]">
                هنوز فایل ثبت‌شده‌ای برای مقایسه وجود ندارد
              </div>
              <p className="text-[11px] leading-5 text-[#57534E]">
                ابتدا یک یا چند فایل را در مرحله ۱ استخراج کنید تا بتوانید تفاوت نسخه منبع را با نسخه ثبت‌شده در سیستم مشاهده کنید.
              </p>
              <button
                type="button"
                onClick={() => setMode('upload')}
                className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md bg-[#1E3A5F] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#162C49] cursor-pointer"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>بازگشت به آپلود فایل</span>
              </button>
            </div>
          ) : (
            <>
              {/* Selectors: Ingested System Version + Source File to Compare */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <label
                    htmlFor="diff-ingested-file-select"
                    className="block text-[11px] font-bold text-[#1A1816]"
                  >
                    نسخه ثبت‌شده در سیستم
                  </label>
                  <select
                    id="diff-ingested-file-select"
                    value={selectedIngestedId}
                    onChange={(e) => setSelectedIngestedId(e.target.value)}
                    className="w-full rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-[11.5px] text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                  >
                    {sourceFiles.map((sf) => (
                      <option key={sf.id} value={sf.id}>
                        {sf.fileName} ({toPersianDigits(sf.unitCount)} واحد)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="diff-source-file-select"
                      className="block text-[11px] font-bold text-[#1A1816]"
                    >
                      فایل منبع برای مقایسه
                    </label>
                    <button
                      type="button"
                      onClick={() => diffLocalFileRef.current?.click()}
                      className="inline-flex items-center gap-1 text-[10.5px] font-bold text-[#1E3A5F] hover:underline cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FolderUp className="h-3 w-3" />
                      <span>انتخاب فایل محلی</span>
                    </button>
                  </div>

                  <select
                    id="diff-source-file-select"
                    value={selectedSourceChoice}
                    onChange={(e) => setSelectedSourceChoice(e.target.value)}
                    className="w-full rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2.5 py-1.5 text-[11.5px] text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
                  >
                    <option value="ingested_raw">
                      متن خام استخراج‌شده در برابر نسخه فعال پس از ادغام
                    </option>
                    {queuedFiles.map((q) => (
                      <option key={q.id} value={`queued:${q.id}`}>
                        فایل صف آپلود: {q.name}
                      </option>
                    ))}
                    {localCompareFile && (
                      <option value="local_file">
                        فایل محلی: {localCompareFile.name}
                      </option>
                    )}
                  </select>
                </div>
              </div>

              {/* Unboxed Tabular Summary Metrics (Zero-Pill Discipline) */}
              {ingestedComparison && diffResult && (
                <div className="space-y-1.5 border-t border-b border-[#EFECE4] py-2 text-[11px] text-[#57534E] tabular-nums">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-bold text-[#14532D]">
                      +{toPersianDigits(diffResult.addedCount)} افزوده
                    </span>
                    <span aria-hidden="true" className="text-[#C8C1B4]">·</span>
                    <span className="font-bold text-[#9A3412]">
                      −{toPersianDigits(diffResult.removedCount)} حذف/ادغام
                    </span>
                    <span aria-hidden="true" className="text-[#C8C1B4]">·</span>
                    <span>
                      تشابه <strong className="text-[#1E3A5F]">{toPersianDigits(diffResult.similarityPercent)}٪</strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-[#78716C]">
                    <span>{toPersianDigits(ingestedComparison.totalUnits)} واحد کل</span>
                    <span aria-hidden="true">·</span>
                    <span>{toPersianDigits(ingestedComparison.uniqueUnits)} یکتا</span>
                    {ingestedComparison.mergedUnits > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#854D0E] font-semibold">
                          {toPersianDigits(ingestedComparison.mergedUnits)} ادغام‌شده
                        </span>
                      </>
                    )}
                    {ingestedComparison.conflictUnits > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#9A3412] font-semibold">
                          {toPersianDigits(ingestedComparison.conflictUnits)} تناقض
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Controls: Changes-Only Filter + Expand Side-by-Side Modal */}
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <label className="inline-flex items-center gap-1.5 font-semibold text-[#44403C] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={changesOnly}
                    onChange={(e) => setChangesOnly(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#1E3A5F]"
                  />
                  <span>فقط خطوط دارای تغییر</span>
                </label>

                <button
                  type="button"
                  data-testid="open-side-by-side-diff"
                  disabled={!diffResult || loadingSourceText}
                  onClick={() => setModalOpen(true)}
                  className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-[#D6D0C4] bg-[#FAF9F6] px-2 py-1 text-[10.5px] font-bold text-[#1E3A5F] hover:border-[#1E3A5F] hover:bg-[#EEF3F8] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>نمای دو ستونه</span>
                </button>
              </div>

              {/* Loading / Error / Unified Inline Diff Viewport */}
              {loadingSourceText ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#57534E]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#1E3A5F]" />
                  <span>در حال خواندن و استخراج متن فایل منبع...</span>
                </div>
              ) : sourceReadError ? (
                <div className="rounded-md border border-[#E6CFC2] bg-[#FDF6F2] p-2.5 text-[11px] text-[#9A3412]">
                  {sourceReadError}
                </div>
              ) : diffResult && visibleDiffLines.length === 0 ? (
                <div className="rounded-md border border-[#D8E7DC] bg-[#F3FAF5] px-3 py-3 text-center text-[11.5px] font-semibold text-[#14532D]">
                  نسخه منبع و نسخه ثبت‌شده در سیستم کاملاً منطبق هستند (۰ تغییر).
                </div>
              ) : diffResult ? (
                <div className="space-y-1">
                  {diffResult.truncated && (
                    <div className="text-[10px] text-[#854D0E]">
                      برای سرعت بالا، ۴۵۰ خط اول هر نسخه مقایسه شده است.
                    </div>
                  )}
                  <div
                    data-testid="inline-diff-lines"
                    className="max-h-64 overflow-y-auto rounded-md border border-[#E5E0D6] bg-[#FCFBF8] font-mono text-[11px] leading-5"
                  >
                    {visibleDiffLines.map((line, i) => {
                      const rowBg =
                        line.kind === 'added'
                          ? 'bg-[#EEF8F2] text-[#124E32]'
                          : line.kind === 'removed'
                          ? 'bg-[#FDF2F0] text-[#9A3412]'
                          : 'bg-white text-[#292524]';
                      const marker =
                        line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ';
                      const lineNum = line.rightLineNumber ?? line.leftLineNumber ?? i + 1;

                      return (
                        <div
                          key={`${line.kind}-${i}`}
                          className={`flex items-start gap-2 border-b border-[#EFECE4] px-2 py-1 last:border-b-0 ${rowBg}`}
                        >
                          <span
                            className="w-6 shrink-0 select-none text-left text-[10px] opacity-65 tabular-nums"
                            aria-hidden="true"
                          >
                            {toPersianDigits(lineNum)}
                          </span>
                          <span
                            className="w-3 shrink-0 select-none font-extrabold"
                            aria-label={
                              line.kind === 'added'
                                ? 'افزوده‌شده در سیستم'
                                : line.kind === 'removed'
                                ? 'حذف یا ادغام‌شده از منبع'
                                : 'بدون تغییر'
                            }
                          >
                            {marker}
                          </span>
                          <span
                            dir="auto"
                            className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans text-[11px]"
                          >
                            {line.text || ' '}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* Full-Width Side-by-Side Visual Diff Modal */}
      {modalOpen && diffResult && selectedIngestedFile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`مقایسه دو ستونه فایل ${selectedIngestedFile.fileName}`}
          data-testid="side-by-side-diff-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#D6D0C4] bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2DDD3] bg-[#FCFBF8] px-5 py-3.5">
              <div className="min-w-0 space-y-0.5">
                <h3 className="truncate text-sm font-extrabold text-[#1A1816]" dir="auto">
                  مقایسه بصری نسخه منبع و نسخه ثبت‌شده — {selectedIngestedFile.fileName}
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#57534E] tabular-nums">
                  <span className="font-bold text-[#14532D]">
                    +{toPersianDigits(diffResult.addedCount)} خط افزوده
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-bold text-[#9A3412]">
                    −{toPersianDigits(diffResult.removedCount)} خط حذف/ادغام
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {toPersianDigits(diffResult.unchangedCount)} خط بدون تغییر
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    انطباق {toPersianDigits(diffResult.similarityPercent)}٪
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#44403C] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={changesOnly}
                    onChange={(e) => setChangesOnly(e.target.checked)}
                    className="h-4 w-4 accent-[#1E3A5F]"
                  />
                  <span>فقط تغییرات</span>
                </label>

                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="بستن پنجره مقایسه"
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-[#D6D0C4] bg-white text-[#44403C] hover:bg-[#EFECE4] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Dual-Column Sticky Labels */}
            <div className="grid grid-cols-1 border-b border-[#E2DDD3] bg-[#F5F3EE] text-xs font-bold text-[#1E3A5F] md:grid-cols-2">
              <div className="border-b border-[#E2DDD3] px-4 py-2 md:border-b-0 md:border-l">
                {diffLeftLabel}
              </div>
              <div className="px-4 py-2">
                {diffRightLabel}
              </div>
            </div>

            {/* Aligned Side-by-Side Rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#EFECE4] text-xs">
              {visibleSideBySideRows.length === 0 ? (
                <div className="p-8 text-center font-semibold text-[#14532D]">
                  هیچ تفاوتی میان نسخه منبع و نسخه ثبت‌شده در سیستم وجود ندارد.
                </div>
              ) : (
                visibleSideBySideRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-2">
                    {/* Left Column: Source File */}
                    <div
                      className={`flex items-start gap-2.5 px-3 py-1.5 md:border-l md:border-[#EFECE4] ${
                        row.leftKind === 'removed'
                          ? 'bg-[#FDF2F0] text-[#9A3412]'
                          : row.leftKind === 'empty'
                          ? 'bg-[#F8F6F1] text-[#A8A29E]'
                          : 'bg-white text-[#292524]'
                      }`}
                    >
                      <span className="w-7 shrink-0 select-none text-left text-[10.5px] opacity-60 tabular-nums">
                        {row.leftLineNumber ? toPersianDigits(row.leftLineNumber) : ''}
                      </span>
                      <span className="w-3 shrink-0 select-none font-extrabold">
                        {row.leftKind === 'removed' ? '−' : ' '}
                      </span>
                      <span dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-6">
                        {row.leftText ?? ''}
                      </span>
                    </div>

                    {/* Right Column: Ingested System Version */}
                    <div
                      className={`flex items-start gap-2.5 px-3 py-1.5 ${
                        row.rightKind === 'added'
                          ? 'bg-[#EEF8F2] text-[#124E32]'
                          : row.rightKind === 'empty'
                          ? 'bg-[#F8F6F1] text-[#A8A29E]'
                          : 'bg-white text-[#292524]'
                      }`}
                    >
                      <span className="w-7 shrink-0 select-none text-left text-[10.5px] opacity-60 tabular-nums">
                        {row.rightLineNumber ? toPersianDigits(row.rightLineNumber) : ''}
                      </span>
                      <span className="w-3 shrink-0 select-none font-extrabold">
                        {row.rightKind === 'added' ? '+' : ' '}
                      </span>
                      <span dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-6">
                        {row.rightText ?? ''}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
