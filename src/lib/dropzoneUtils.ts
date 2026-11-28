import type { SourceFileFormat } from './bookTypes.ts';
import { toPersianDigits } from './formatParsers.ts';

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  '.docx',
  '.pdf',
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.csv',
  '.html',
  '.htm',
] as const;

export const DROPZONE_ACCEPT_ATTRIBUTE = SUPPORTED_UPLOAD_EXTENSIONS.join(',');

export interface DropFileLike {
  name: string;
  size: number;
}

export interface PartitionedDropResult<T extends DropFileLike> {
  accepted: T[];
  rejectedNames: string[];
  duplicateNames: string[];
}

export function isSupportedUploadFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Separates incoming dropped/selected files into valid additions, unsupported
 * extensions, and already-queued exact duplicates (same name + size).
 */
export function partitionDroppedFiles<T extends DropFileLike>(
  incomingFiles: readonly T[],
  existingFiles: readonly DropFileLike[] = []
): PartitionedDropResult<T> {
  const seenKeys = new Set(
    existingFiles.map((f) => `${f.name.trim().toLowerCase()}::${f.size}`)
  );

  const accepted: T[] = [];
  const rejectedNames: string[] = [];
  const duplicateNames: string[] = [];

  for (const file of incomingFiles) {
    if (!isSupportedUploadFileName(file.name)) {
      rejectedNames.push(file.name);
      continue;
    }

    const key = `${file.name.trim().toLowerCase()}::${file.size}`;
    if (seenKeys.has(key)) {
      duplicateNames.push(file.name);
      continue;
    }

    seenKeys.add(key);
    accepted.push(file);
  }

  return { accepted, rejectedNames, duplicateNames };
}

export function formatCompactFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
  }
  if (bytes >= 1024) {
    return `${toPersianDigits(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
  }
  return `${toPersianDigits(Math.max(0, bytes))} بایت`;
}

export function computeTotalQueueBytes(files: readonly { sizeBytes: number }[]): number {
  return files.reduce((sum, item) => sum + Math.max(0, item.sizeBytes), 0);
}

export interface FormatVisualMeta {
  shortCode: string;
  persianLabel: string;
  iconBgClass: string;
  iconTextClass: string;
}

export function getFormatVisualMeta(format: SourceFileFormat): FormatVisualMeta {
  switch (format) {
    case 'docx':
      return {
        shortCode: 'DOCX',
        persianLabel: 'سند ورد',
        iconBgClass: 'bg-[#E9F0F8]',
        iconTextClass: 'text-[#1E3A5F]',
      };
    case 'pdf':
      return {
        shortCode: 'PDF',
        persianLabel: 'سند پی‌دی‌اف',
        iconBgClass: 'bg-[#FBECE9]',
        iconTextClass: 'text-[#9A3412]',
      };
    case 'md':
      return {
        shortCode: 'MD',
        persianLabel: 'مارک‌داون',
        iconBgClass: 'bg-[#EDF2F4]',
        iconTextClass: 'text-[#2B4C59]',
      };
    case 'json':
      return {
        shortCode: 'JSON',
        persianLabel: 'ساختار جیسون',
        iconBgClass: 'bg-[#F9F1E1]',
        iconTextClass: 'text-[#854D0E]',
      };
    case 'csv':
      return {
        shortCode: 'CSV',
        persianLabel: 'جدول داده',
        iconBgClass: 'bg-[#EAF4EE]',
        iconTextClass: 'text-[#14532D]',
      };
    case 'html':
      return {
        shortCode: 'HTML',
        persianLabel: 'صفحه وب',
        iconBgClass: 'bg-[#F2EDF8]',
        iconTextClass: 'text-[#5B21B6]',
      };
    default:
      return {
        shortCode: 'TXT',
        persianLabel: 'متن ساده',
        iconBgClass: 'bg-[#F1EEE7]',
        iconTextClass: 'text-[#57534E]',
      };
  }
}
