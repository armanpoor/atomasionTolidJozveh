import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType2,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { DragEvent, useRef, useState } from 'react';
import { FileRole, SourceFileFormat } from '../lib/bookTypes';
import {
  computeTotalQueueBytes,
  DROPZONE_ACCEPT_ATTRIBUTE,
  formatCompactFileSize,
  getFormatVisualMeta,
  partitionDroppedFiles,
} from '../lib/dropzoneUtils';
import { toPersianDigits } from '../lib/formatParsers';

export interface QueuedUploadFile {
  id: string;
  name: string;
  format: SourceFileFormat;
  sizeBytes: number;
  role?: FileRole;
  file?: File;
  presetText?: string;
}

interface FileDropzoneProps {
  queuedFiles: QueuedUploadFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onMoveFile: (id: string, direction: 'up' | 'down') => void;
  onClearFiles: () => void;
  showRoleSelector?: boolean;
  onSetFileRole?: (id: string, role: FileRole) => void;
  disabled?: boolean;
}

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

export function FileDropzone({
  queuedFiles,
  onAddFiles,
  onRemoveFile,
  onMoveFile,
  onClearFiles,
  showRoleSelector = false,
  onSetFileRole,
  disabled = false,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const hasFiles = queuedFiles.length > 0;
  const totalBytes = computeTotalQueueBytes(queuedFiles);

  return (
    <div className="mt-4 space-y-3.5">
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

      {/* Compact, Clean File Cards Grid (1-col airy cards on mobile, 2-col compact cards on desktop) */}
      {hasFiles && (
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between gap-2 text-xs text-[#57534E]">
            <div className="tabular-nums">
              <strong className="font-bold text-[#1A1816]">
                {toPersianDigits(queuedFiles.length)} فایل
              </strong>{' '}
              آماده پردازش
              <span className="mx-1.5 text-[#C8C1B4]" aria-hidden="true">
                ·
              </span>
              <span>مجموع {formatCompactFileSize(totalBytes)}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setNotice(null);
                onClearFiles();
              }}
              className="min-h-[36px] shrink-0 px-2 text-xs font-semibold text-[#9A3412] hover:underline"
            >
              پاک کردن همه
            </button>
          </div>

          <ul
            data-testid="uploaded-file-cards"
            className="grid grid-cols-1 gap-2"
          >
            {queuedFiles.map((item, idx) => {
              const Icon = getFormatIconComponent(item.format);
              const meta = getFormatVisualMeta(item.format);
              const isMaster = item.role === 'master';

              return (
                <li
                  key={item.id}
                  data-testid="uploaded-file-card"
                  className={`flex min-h-[66px] items-center justify-between gap-2 rounded-md border px-3 py-2 transition-colors ${
                    showRoleSelector && isMaster
                      ? 'border-[#1E3A5F] bg-[#F2F6FA]'
                      : 'border-[#E5E0D6] bg-[#FCFBF8] hover:border-[#C9C1B2]'
                  }`}
                >
                  {/* Leading Format Icon + Compact 2-line Info */}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
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
                        {showRoleSelector && onSetFileRole && (
                          <button
                            type="button"
                            onClick={() =>
                              onSetFileRole(item.id, isMaster ? 'supplement' : 'master')
                            }
                            className={`mr-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold cursor-pointer ${
                              isMaster
                                ? 'bg-[#1E3A5F] text-white'
                                : 'bg-[#EAE5DA] text-[#57534E] hover:bg-[#DDD6C7]'
                            }`}
                          >
                            {isMaster ? 'سند مرجع (Master)' : 'فایل تکمیلی'}
                          </button>
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
                          className="flex h-9 w-8 items-center justify-center rounded-sm text-[#57534E] transition-colors hover:bg-[#EFECE4] hover:text-[#1E3A5F] disabled:opacity-25"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === queuedFiles.length - 1}
                          onClick={() => onMoveFile(item.id, 'down')}
                          aria-label={`انتقال فایل ${item.name} به پایین`}
                          className="flex h-9 w-8 items-center justify-center rounded-sm text-[#57534E] transition-colors hover:bg-[#EFECE4] hover:text-[#1E3A5F] disabled:opacity-25"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => onRemoveFile(item.id)}
                      aria-label={`حذف فایل ${item.name}`}
                      className="flex h-9 w-8 items-center justify-center rounded-sm text-[#9A3412] transition-colors hover:bg-[#FDF2F0]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
