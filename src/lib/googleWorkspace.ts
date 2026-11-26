import type {
  AuditReportDto,
  ConflictDto,
  ParsedBook,
  SourceFileFormat,
} from './bookTypes.ts';
import type { WinolsExtractionReport } from './winolsMapGuide.ts';

export const GOOGLE_WORKSPACE_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/presentations.readonly',
];

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MARKDOWN_MIME_TYPE = 'text/markdown;charset=utf-8';
const DRIVE_MULTIPART_MAX_BYTES = 4 * 1024 * 1024; // Switch to resumable upload above 4MB

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  sizeBytes?: number;
  webViewLink?: string;
}

export interface SpreadsheetTabInfo {
  sheetId: number;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl?: string;
  tabs: SpreadsheetTabInfo[];
}

export interface ImportedWorkspaceDocument {
  name: string;
  format: SourceFileFormat;
  sizeBytes: number;
  presetText?: string;
  file?: File;
}

function escapeDriveQueryString(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function parseGoogleErrorMessage(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // non-json error body
  }
  return raw || `HTTP ${res.status}`;
}

export async function listDriveFiles(params: {
  accessToken: string;
  searchQuery?: string;
  onlySpreadsheets?: boolean;
  pageSize?: number;
}): Promise<DriveFileItem[]> {
  const { accessToken, searchQuery = '', onlySpreadsheets = false, pageSize = 25 } = params;

  const clauses: string[] = ['trashed = false'];
  if (onlySpreadsheets) {
    clauses.push(`mimeType = '${GOOGLE_SHEET_MIME}'`);
  } else {
    clauses.push(
      `(` +
        [
          `mimeType = '${GOOGLE_DOC_MIME}'`,
          `mimeType = '${GOOGLE_SHEET_MIME}'`,
          `mimeType = '${GOOGLE_SLIDES_MIME}'`,
          `mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'`,
          `mimeType = 'application/pdf'`,
          `mimeType = 'text/markdown'`,
          `mimeType = 'text/plain'`,
          `mimeType = 'text/csv'`,
          `mimeType = 'text/html'`,
          `mimeType = 'application/json'`,
          `name contains '.md'`,
          `name contains '.docx'`,
          `name contains '.pdf'`,
          `name contains '.txt'`,
        ].join(' or ') +
        `)`
    );
  }

  const trimmedSearch = searchQuery.trim();
  if (trimmedSearch) {
    clauses.push(`name contains '${escapeDriveQueryString(trimmedSearch)}'`);
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', clauses.join(' and '));
  url.searchParams.set('pageSize', String(Math.min(50, Math.max(5, pageSize))));
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set(
    'fields',
    'files(id,name,mimeType,modifiedTime,size,webViewLink)'
  );

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در خواندن لیست فایل‌های Google Drive: ${msg}`);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      size?: string;
      webViewLink?: string;
    }>;
  };

  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    sizeBytes: f.size ? Number(f.size) || 0 : 0,
    webViewLink: f.webViewLink,
  }));
}

export async function listSpreadsheetTabs(params: {
  accessToken: string;
  spreadsheetId: string;
}): Promise<SpreadsheetMetadata> {
  const { accessToken, spreadsheetId } = params;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=properties.title,spreadsheetUrl,sheets.properties`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در خواندن ساختار Google Sheet: ${msg}`);
  }

  const data = (await res.json()) as {
    properties?: { title?: string };
    spreadsheetUrl?: string;
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  };

  return {
    spreadsheetId,
    title: data.properties?.title || 'Google Spreadsheet',
    spreadsheetUrl: data.spreadsheetUrl,
    tabs: (data.sheets || [])
      .map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title || '',
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      }))
      .filter((t) => Boolean(t.title)),
  };
}

export async function readSpreadsheetTabValues(params: {
  accessToken: string;
  spreadsheetId: string;
  sheetTitle: string;
  maxRange?: string;
}): Promise<string[][]> {
  const { accessToken, spreadsheetId, sheetTitle, maxRange } = params;
  const safeTab = sheetTitle.replace(/'/g, "''");
  // Query full sheet grid by default so large ECU/calibration tables (>500 rows or >26 cols) are never silently truncated
  const rangeExpr = maxRange?.trim() ? `'${safeTab}'!${maxRange.trim()}` : `'${safeTab}'`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(rangeExpr)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در خواندن داده‌های تب «${sheetTitle}»: ${msg}`);
  }

  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values || []).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '').trim())
  );
}

export function convertSheetValuesToMarkdown(params: {
  spreadsheetTitle: string;
  sheetTitle: string;
  values: string[][];
}): string {
  const { spreadsheetTitle, sheetTitle, values } = params;
  const nonEmptyRows = values.filter((row) => row.some((c) => c.trim().length > 0));
  if (nonEmptyRows.length === 0) {
    return `# ${spreadsheetTitle} — ${sheetTitle}\n\n(جدول خالی است)`;
  }

  const maxCols = Math.max(1, ...nonEmptyRows.map((r) => r.length));
  const normalizeRow = (row: string[]) =>
    Array.from({ length: maxCols }, (_, idx) =>
      (row[idx] ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
    );

  const header = normalizeRow(nonEmptyRows[0]);
  const separator = Array.from({ length: maxCols }, () => '---');
  const body = nonEmptyRows.slice(1).map(normalizeRow);

  const lines = [
    `# ${spreadsheetTitle} — ${sheetTitle}`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function inferFormatFromFileName(name: string, mimeType: string): SourceFileFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) return 'docx';
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  if (lower.endsWith('.csv') || mimeType === 'text/csv') return 'csv';
  if (lower.endsWith('.json') || mimeType === 'application/json') return 'json';
  if (lower.endsWith('.html') || lower.endsWith('.htm') || mimeType === 'text/html') return 'html';
  if (lower.endsWith('.txt') || mimeType === 'text/plain') return 'txt';
  return 'md';
}

export async function downloadDriveFileForImport(params: {
  accessToken: string;
  file: DriveFileItem;
  selectedSheetTabs?: string[];
}): Promise<ImportedWorkspaceDocument> {
  const { accessToken, file, selectedSheetTabs } = params;

  if (file.mimeType === GOOGLE_DOC_MIME) {
    // Export Google Doc cleanly as Markdown (fallback to plain text if Markdown export unavailable)
    let res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        file.id
      )}/export?mimeType=text/markdown`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          file.id
        )}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    }
    if (!res.ok) {
      const msg = await parseGoogleErrorMessage(res);
      throw new Error(`خطا در خروجی گرفتن از Google Doc «${file.name}»: ${msg}`);
    }
    const text = await res.text();
    const outName = file.name.endsWith('.md') ? file.name : `${file.name}.md`;
    return {
      name: outName,
      format: 'md',
      sizeBytes: new Blob([text]).size,
      presetText: text,
    };
  }

  if (file.mimeType === GOOGLE_SHEET_MIME) {
    const meta = await listSpreadsheetTabs({
      accessToken,
      spreadsheetId: file.id,
    });
    const tabsToRead =
      selectedSheetTabs && selectedSheetTabs.length > 0
        ? meta.tabs.filter((t) => selectedSheetTabs.includes(t.title))
        : meta.tabs;

    if (tabsToRead.length === 0) {
      throw new Error(`هیچ تب قابل خواندنی در فایل «${file.name}» یافت نشد.`);
    }

    const mdSections: string[] = [];
    for (const tab of tabsToRead) {
      const values = await readSpreadsheetTabValues({
        accessToken,
        spreadsheetId: file.id,
        sheetTitle: tab.title,
      });
      mdSections.push(
        convertSheetValuesToMarkdown({
          spreadsheetTitle: meta.title || file.name,
          sheetTitle: tab.title,
          values,
        })
      );
    }

    const combinedText = mdSections.join('\n\n---\n\n');
    const outName = file.name.endsWith('.md') ? file.name : `${file.name}.md`;
    return {
      name: outName,
      format: 'md',
      sizeBytes: new Blob([combinedText]).size,
      presetText: combinedText,
    };
  }

  if (file.mimeType === GOOGLE_SLIDES_MIME) {
    const res = await fetch(
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(file.id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const msg = await parseGoogleErrorMessage(res);
      throw new Error(`خطا در خواندن اسلایدهای Google Slides «${file.name}»: ${msg}`);
    }
    const presentation = (await res.json()) as GoogleSlidesPresentationPayload;
    const markdown = extractPresentationTextToMarkdown(presentation, file.name);
    const outName = file.name.endsWith('.md') ? file.name : `${file.name}.md`;
    return {
      name: outName,
      format: 'md',
      sizeBytes: new Blob([markdown]).size,
      presetText: markdown,
    };
  }

  // Binary or text file stored directly in Google Drive
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در دریافت فایل «${file.name}» از Google Drive: ${msg}`);
  }

  const format = inferFormatFromFileName(file.name, file.mimeType);
  if (format === 'docx' || format === 'pdf') {
    const blob = await res.blob();
    const fileObj = new File([blob], file.name, {
      type: file.mimeType || blob.type || 'application/octet-stream',
    });
    return {
      name: file.name,
      format,
      sizeBytes: fileObj.size,
      file: fileObj,
    };
  }

  const text = await res.text();
  return {
    name: file.name,
    format,
    sizeBytes: new Blob([text]).size,
    presetText: text,
  };
}

export type FinalExportFormat = 'docx' | 'md';

export interface DriveUploadResult {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  webViewLink?: string;
  updated: boolean;
}

export function normalizeDriveExportFileName(
  fileName: string,
  format: FinalExportFormat
): string {
  const cleaned = String(fileName || '')
    .replace(/[\u0000-\u001F\u007F/\\:*?"<>|]/g, '_')
    .trim();
  const ext = format === 'docx' ? '.docx' : '.md';
  const base = cleaned || (format === 'docx' ? 'book_export' : 'book_export');
  const lower = base.toLowerCase();
  if (lower.endsWith(ext)) return base;
  const strippedOther = base.replace(/\.(docx|md|markdown)$/i, '');
  return `${strippedOther || 'book_export'}${ext}`;
}

export function buildMultipartRelatedUploadPayload(params: {
  metadata: Record<string, unknown>;
  contentBytes: Uint8Array;
  mimeType: string;
  boundary?: string;
}): { contentType: string; bytes: Uint8Array } {
  const { metadata, contentBytes, mimeType } = params;
  const boundary =
    params.boundary || `drive_upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const encoder = new TextEncoder();

  const metaPart = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
  );
  const closing = encoder.encode(`\r\n--${boundary}--`);

  const combined = new Uint8Array(metaPart.byteLength + contentBytes.byteLength + closing.byteLength);
  combined.set(metaPart, 0);
  combined.set(contentBytes, metaPart.byteLength);
  combined.set(closing, metaPart.byteLength + contentBytes.byteLength);

  return {
    contentType: `multipart/related; boundary=${boundary}`,
    bytes: combined,
  };
}

export async function listDriveExportFiles(params: {
  accessToken: string;
  formatFilter?: 'all' | FinalExportFormat;
  searchQuery?: string;
  folderId?: string;
  pageSize?: number;
}): Promise<DriveFileItem[]> {
  const {
    accessToken,
    formatFilter = 'all',
    searchQuery = '',
    folderId,
    pageSize = 30,
  } = params;

  const clauses: string[] = ['trashed = false'];
  if (formatFilter === 'docx') {
    clauses.push(`(mimeType = '${DOCX_MIME_TYPE}' or name contains '.docx')`);
  } else if (formatFilter === 'md') {
    clauses.push(`(mimeType = 'text/markdown' or name contains '.md')`);
  } else {
    clauses.push(
      `(mimeType = '${DOCX_MIME_TYPE}' or mimeType = 'text/markdown' or name contains '.docx' or name contains '.md')`
    );
  }

  if (folderId?.trim()) {
    clauses.push(`'${escapeDriveQueryString(folderId.trim())}' in parents`);
  }

  const trimmedSearch = searchQuery.trim();
  if (trimmedSearch) {
    clauses.push(`name contains '${escapeDriveQueryString(trimmedSearch)}'`);
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', clauses.join(' and '));
  url.searchParams.set('pageSize', String(Math.min(100, Math.max(1, pageSize))));
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set(
    'fields',
    'files(id,name,mimeType,modifiedTime,size,webViewLink)'
  );

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در خواندن فهرست فایل‌های .docx و .md در Google Drive: ${msg}`);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      size?: string;
      webViewLink?: string;
    }>;
  };

  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    sizeBytes: f.size ? Number(f.size) || 0 : 0,
    webViewLink: f.webViewLink,
  }));
}

export async function findOrCreateDriveFolder(params: {
  accessToken: string;
  folderName: string;
  parentId?: string;
}): Promise<{ id: string; name: string }> {
  const { accessToken, folderName, parentId } = params;
  const safeName = folderName.trim() || 'Persian Book Studio Exports';

  const clauses = [
    'trashed = false',
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `name = '${escapeDriveQueryString(safeName)}'`,
  ];
  if (parentId?.trim()) {
    clauses.push(`'${escapeDriveQueryString(parentId.trim())}' in parents`);
  }

  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.searchParams.set('q', clauses.join(' and '));
  listUrl.searchParams.set('pageSize', '1');
  listUrl.searchParams.set('fields', 'files(id,name)');

  const searchRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (searchRes.ok) {
    const found = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };
    if (found.files && found.files.length > 0) {
      return found.files[0];
    }
  }

  const createBody: Record<string, unknown> = {
    name: safeName,
    mimeType: DRIVE_FOLDER_MIME,
  };
  if (parentId?.trim()) {
    createBody.parents = [parentId.trim()];
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createBody),
    }
  );
  if (!createRes.ok) {
    const msg = await parseGoogleErrorMessage(createRes);
    throw new Error(`خطا در ایجاد پوشه «${safeName}» در Google Drive: ${msg}`);
  }
  return (await createRes.json()) as { id: string; name: string };
}

export async function uploadFileToDrive(params: {
  accessToken: string;
  fileName: string;
  mimeType: string;
  data: Blob | string | Uint8Array;
  existingFileId?: string | null;
  folderId?: string | null;
  description?: string;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { accessToken, fileName, mimeType, data, existingFileId, folderId, description } = params;
  const contentBytes =
    data instanceof Uint8Array
      ? data
      : typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(await data.arrayBuffer());

  const metadata: Record<string, unknown> = existingFileId
    ? { name: fileName }
    : { name: fileName, mimeType };
  if (description) {
    metadata.description = description;
  }
  if (!existingFileId && folderId?.trim()) {
    metadata.parents = [folderId.trim()];
  }

  // Use Google Drive Resumable Upload for files larger than 4MB (e.g. rich .docx with embedded diagrams)
  if (contentBytes.byteLength > DRIVE_MULTIPART_MAX_BYTES) {
    const initEndpoint = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
          existingFileId
        )}?uploadType=resumable&fields=id,name,webViewLink`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink';

    const initRes = await fetch(initEndpoint, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(contentBytes.byteLength),
      },
      body: JSON.stringify(metadata),
    });

    if (!initRes.ok) {
      const msg = await parseGoogleErrorMessage(initRes);
      throw new Error(`خطا در آغاز آپلود فایل حجیم در Google Drive: ${msg}`);
    }

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('آدرس جلسه آپلود (Resumable Session URL) از Google Drive دریافت نشد.');
    }

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
      },
      body: contentBytes.buffer.slice(
        contentBytes.byteOffset,
        contentBytes.byteOffset + contentBytes.byteLength
      ) as ArrayBuffer,
    });

    if (!putRes.ok) {
      const msg = await parseGoogleErrorMessage(putRes);
      throw new Error(`خطا در ارسال محتوای فایل به Google Drive: ${msg}`);
    }

    return (await putRes.json()) as { id: string; name: string; webViewLink?: string };
  }

  // Standard RFC-2387 multipart/related upload for files <= 4MB
  const multipart = buildMultipartRelatedUploadPayload({
    metadata,
    contentBytes,
    mimeType,
  });

  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingFileId
      )}?uploadType=multipart&fields=id,name,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';

  const res = await fetch(endpoint, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': multipart.contentType,
    },
    body: multipart.bytes.buffer.slice(
      multipart.bytes.byteOffset,
      multipart.bytes.byteOffset + multipart.bytes.byteLength
    ) as ArrayBuffer,
  });

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در ذخیره فایل در Google Drive: ${msg}`);
  }

  return (await res.json()) as { id: string; name: string; webViewLink?: string };
}

export async function uploadFinalDocumentToDrive(params: {
  accessToken: string;
  fileName: string;
  format: FinalExportFormat;
  data: Blob | string | Uint8Array;
  existingFileId?: string | null;
  folderId?: string | null;
  description?: string;
}): Promise<DriveUploadResult> {
  const { accessToken, format, data, existingFileId, folderId, description } = params;
  const normalizedName = normalizeDriveExportFileName(params.fileName, format);
  const mimeType = format === 'docx' ? DOCX_MIME_TYPE : MARKDOWN_MIME_TYPE;
  const sizeBytes =
    data instanceof Uint8Array
      ? data.byteLength
      : typeof data === 'string'
        ? new TextEncoder().encode(data).byteLength
        : data.size;

  const uploaded = await uploadFileToDrive({
    accessToken,
    fileName: normalizedName,
    mimeType,
    data,
    existingFileId,
    folderId,
    description,
  });

  return {
    id: uploaded.id,
    name: uploaded.name || normalizedName,
    mimeType,
    sizeBytes,
    webViewLink:
      uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    updated: Boolean(existingFileId),
  };
}

export function createGoogleDriveService(accessToken: string) {
  return {
    listFiles: (options?: {
      searchQuery?: string;
      onlySpreadsheets?: boolean;
      pageSize?: number;
    }) => listDriveFiles({ accessToken, ...options }),

    listExportFiles: (options?: {
      formatFilter?: 'all' | FinalExportFormat;
      searchQuery?: string;
      folderId?: string;
      pageSize?: number;
    }) => listDriveExportFiles({ accessToken, ...options }),

    findOrCreateFolder: (folderName: string, parentId?: string) =>
      findOrCreateDriveFolder({ accessToken, folderName, parentId }),

    uploadFile: (options: {
      fileName: string;
      mimeType: string;
      data: Blob | string | Uint8Array;
      existingFileId?: string | null;
      folderId?: string | null;
      description?: string;
    }) => uploadFileToDrive({ accessToken, ...options }),

    uploadFinalDocument: (options: {
      fileName: string;
      format: FinalExportFormat;
      data: Blob | string | Uint8Array;
      existingFileId?: string | null;
      folderId?: string | null;
      description?: string;
    }) => uploadFinalDocumentToDrive({ accessToken, ...options }),
  };
}

export interface BookSpreadsheetTabData {
  tabTitle: string;
  rows: string[][];
}

export function buildBookSpreadsheetReportPayload(params: {
  book: ParsedBook;
  auditReport?: AuditReportDto | null;
  conflicts?: ConflictDto[];
  winolsReport?: WinolsExtractionReport | null;
}): BookSpreadsheetTabData[] {
  const { book, auditReport = null, conflicts = [], winolsReport = null } = params;

  const totalSections = book.chapters.reduce((s, c) => s + c.sections.length, 0);
  const openConflicts = conflicts.filter((c) => c.status === 'open').length;

  const summaryRows: string[][] = [
    ['شاخص کیفیت و ممیزی', 'مقدار ثبت‌شده'],
    ['عنوان کتاب', book.title],
    ['زیرعنوان', book.subtitle || '-'],
    ['تعداد فصل‌ها', String(book.chapters.length)],
    ['تعداد کل زیربخش‌ها', String(totalSections)],
    ['درصد پوشش بدون افت (٪)', String(auditReport?.coveragePercent ?? 100)],
    ['تعداد واحدهای متنی یکتا', String(auditReport?.uniqueUnitsPreserved ?? 0)],
    ['تعداد موارد ادغام‌شده', String(auditReport?.duplicatesMerged ?? 0)],
    ['تناقض‌های باز', String(openConflicts)],
    ['نقشه‌های WinOLS شناسایی‌شده', String(winolsReport?.mapsDetected ?? 0)],
    ['تعداد مدخل واژه‌نامه', String(book.glossary?.length ?? 0)],
    ['تعداد پاورقی‌ها', String(book.footnotes?.length ?? 0)],
  ];

  const chapterRows: string[][] = [
    ['شماره فصل', 'عنوان فصل', 'تعداد زیربخش', 'تعداد کادر موضوعی', 'تعداد جدول', 'منبع اصلی'],
    ...book.chapters.map((ch) => {
      const callouts = ch.sections.reduce(
        (s, sec) => s + sec.blocks.filter((b) => b.type === 'callout').length,
        0
      );
      const tables = ch.sections.reduce(
        (s, sec) => s + sec.blocks.filter((b) => b.type === 'table').length,
        0
      );
      return [
        String(ch.chapterNumber),
        ch.title,
        String(ch.sections.length),
        String(callouts),
        String(tables),
        ch.sourceFileName || '-',
      ];
    }),
  ];

  const winolsRows: string[][] = [
    [
      'کد نقشه',
      'نام فارسی',
      'دسته',
      'مدل‌های ECU',
      'آدرس‌های هگز',
      'ابعاد',
      'محدوده RPM / بار',
      'ضریب (Factor)',
      'تغییر پیشنهادی',
      'نکته ایمنی',
    ],
    ...(winolsReport?.entries || []).map((entry) => [
      entry.mapCode,
      entry.mapNameFa,
      entry.categoryLabelFa,
      entry.ecuModels.join(', ') || '-',
      entry.hexAddresses.join(', ') || '-',
      entry.dimensions,
      entry.targetZoneLabelFa || '-',
      entry.damosMeta?.factor !== undefined ? String(entry.damosMeta.factor) : '-',
      entry.recommendedDeltaLabel || '-',
      entry.safetyChecklistFa || '-',
    ]),
  ];

  return [
    { tabTitle: 'خلاصه_ممیزی', rows: summaryRows },
    { tabTitle: 'فهرست_فصل‌ها', rows: chapterRows },
    { tabTitle: 'نقشه‌های_WinOLS', rows: winolsRows },
  ];
}

export async function createBookSpreadsheet(params: {
  accessToken: string;
  title: string;
  book: ParsedBook;
  auditReport?: AuditReportDto | null;
  conflicts?: ConflictDto[];
  winolsReport?: WinolsExtractionReport | null;
}): Promise<{ spreadsheetId: string; spreadsheetUrl: string; title: string }> {
  const { accessToken, title, book, auditReport, conflicts, winolsReport } = params;
  const tabs = buildBookSpreadsheetReportPayload({
    book,
    auditReport,
    conflicts,
    winolsReport,
  });

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: tabs.map((t) => ({
        properties: {
          title: t.tabTitle,
          rightToLeft: true,
        },
      })),
    }),
  });

  if (!createRes.ok) {
    const msg = await parseGoogleErrorMessage(createRes);
    throw new Error(`خطا در ایجاد Google Sheet: ${msg}`);
  }

  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
  };

  const batchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      created.spreadsheetId
    )}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // RAW prevents spreadsheet formula injection / accidental evaluation of technical strings starting with =, +, -, @
        valueInputOption: 'RAW',
        data: tabs.map((t) => ({
          range: `'${t.tabTitle.replace(/'/g, "''")}'!A1`,
          values: t.rows,
        })),
      }),
    }
  );

  if (!batchRes.ok) {
    const msg = await parseGoogleErrorMessage(batchRes);
    throw new Error(`فایل Google Sheet ساخته شد اما درج داده‌ها خطا داد: ${msg}`);
  }

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    title: created.properties?.title || title,
  };
}

export async function updateExistingSpreadsheetTab(params: {
  accessToken: string;
  spreadsheetId: string;
  sheetTitle: string;
  rows: string[][];
}): Promise<{ updatedRows: number }> {
  const { accessToken, spreadsheetId, sheetTitle, rows } = params;
  const safeTab = sheetTitle.replace(/'/g, "''");
  const fullTabRange = `'${safeTab}'`;
  const rangeExpr = `'${safeTab}'!A1`;

  // Clear existing grid values first so shorter updates never leave stale trailing rows from prior exports
  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(fullTabRange)}:clear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );
  if (!clearRes.ok) {
    const msg = await parseGoogleErrorMessage(clearRes);
    throw new Error(`خطا در پاک‌سازی تب «${sheetTitle}» پیش از به‌روزرسانی Google Sheets: ${msg}`);
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(rangeExpr)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: rangeExpr,
        majorDimension: 'ROWS',
        values: rows,
      }),
    }
  );

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در به‌روزرسانی تب «${sheetTitle}» در Google Sheets: ${msg}`);
  }

  const data = (await res.json()) as { updatedRows?: number };
  return { updatedRows: data.updatedRows ?? rows.length };
}

export interface GoogleSlidesTextElement {
  textRun?: { content?: string };
}

export interface GoogleSlidesPageElement {
  shape?: {
    text?: { textElements?: GoogleSlidesTextElement[] };
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{
        text?: { textElements?: GoogleSlidesTextElement[] };
      }>;
    }>;
  };
}

export interface GoogleSlidesPresentationPayload {
  title?: string;
  slides?: Array<{
    objectId?: string;
    pageElements?: GoogleSlidesPageElement[];
    slideProperties?: {
      notesPage?: {
        pageElements?: GoogleSlidesPageElement[];
      };
    };
  }>;
}

function collectSlideTextElements(elements?: GoogleSlidesTextElement[]): string {
  if (!Array.isArray(elements)) return '';
  return elements
    .map((el) => el.textRun?.content || '')
    .join('')
    .replace(/\r/g, '')
    .trim();
}

export function extractPresentationTextToMarkdown(
  presentation: GoogleSlidesPresentationPayload,
  fallbackTitle = 'Google Slides'
): string {
  const title = (presentation.title || fallbackTitle).trim();
  const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
  if (slides.length === 0) {
    return `# ${title}\n\n(ارائه بدون اسلاید است)`;
  }

  const parts: string[] = [`# ${title}`];
  slides.forEach((slide, idx) => {
    const slideBlocks: string[] = [];
    for (const el of slide.pageElements || []) {
      const shapeText = collectSlideTextElements(el.shape?.text?.textElements);
      if (shapeText) {
        slideBlocks.push(shapeText);
      }
      if (el.table?.tableRows && el.table.tableRows.length > 0) {
        const rows = el.table.tableRows.map((row) =>
          (row.tableCells || []).map((cell) =>
            collectSlideTextElements(cell.text?.textElements)
              .replace(/\|/g, '\\|')
              .replace(/\n+/g, ' ')
          )
        );
        const maxCols = Math.max(1, ...rows.map((r) => r.length));
        const padRow = (r: string[]) =>
          Array.from({ length: maxCols }, (_, i) => r[i] ?? '');
        const header = padRow(rows[0] || []);
        const sep = Array.from({ length: maxCols }, () => '---');
        const body = rows.slice(1).map(padRow);
        slideBlocks.push(
          [
            `| ${header.join(' | ')} |`,
            `| ${sep.join(' | ')} |`,
            ...body.map((r) => `| ${r.join(' | ')} |`),
          ].join('\n')
        );
      }
    }

    const notesTexts = (slide.slideProperties?.notesPage?.pageElements || [])
      .map((el) => collectSlideTextElements(el.shape?.text?.textElements))
      .filter((t) => t.length > 0);

    parts.push(`## اسلاید ${idx + 1}`);
    if (slideBlocks.length > 0) {
      parts.push(slideBlocks.join('\n\n'));
    } else {
      parts.push('(بدون متن)');
    }
    if (notesTexts.length > 0) {
      parts.push(`> یادداشت ارائه‌دهنده: ${notesTexts.join(' ')}`);
    }
  });

  return parts.join('\n\n');
}

export interface GoogleDocBatchSegment {
  text: string;
  namedStyleType: 'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'NORMAL_TEXT';
}

export function buildGoogleDocSegmentsFromBook(book: ParsedBook): GoogleDocBatchSegment[] {
  const segments: GoogleDocBatchSegment[] = [];
  segments.push({ text: `${book.title}\n`, namedStyleType: 'TITLE' });
  if (book.subtitle?.trim()) {
    segments.push({ text: `${book.subtitle.trim()}\n`, namedStyleType: 'SUBTITLE' });
  }

  for (const ch of book.chapters) {
    segments.push({ text: `${ch.title}\n`, namedStyleType: 'HEADING_1' });
    for (const block of ch.introBlocks) {
      if (block.type === 'paragraph' && block.text.trim()) {
        segments.push({ text: `${block.text.trim()}\n`, namedStyleType: 'NORMAL_TEXT' });
      }
    }
    for (const sec of ch.sections) {
      const heading = sec.numberLabel ? `${sec.numberLabel}. ${sec.title}` : sec.title;
      segments.push({ text: `${heading}\n`, namedStyleType: 'HEADING_2' });
      for (const b of sec.blocks) {
        if (b.type === 'paragraph' && b.text.trim()) {
          segments.push({ text: `${b.text.trim()}\n`, namedStyleType: 'NORMAL_TEXT' });
        } else if (b.type === 'subheading' && b.text.trim()) {
          segments.push({ text: `${b.text.trim()}\n`, namedStyleType: 'HEADING_2' });
        } else if (b.type === 'list' && b.items.length > 0) {
          const listText = b.items
            .map((it, idx) => (b.ordered ? `${idx + 1}. ${it}` : `• ${it}`))
            .join('\n');
          segments.push({ text: `${listText}\n`, namedStyleType: 'NORMAL_TEXT' });
        } else if (b.type === 'callout') {
          const body = b.paragraphs.join('\n');
          segments.push({
            text: `【${b.title}】\n${body}\n`,
            namedStyleType: 'NORMAL_TEXT',
          });
        } else if (b.type === 'table') {
          const captionLine = b.caption ? `${b.caption}\n` : '';
          const headerLine = b.headers.join(' | ');
          const rowLines = b.rows.map((r) => r.join(' | ')).join('\n');
          segments.push({
            text: `${captionLine}${headerLine}\n${rowLines}\n`,
            namedStyleType: 'NORMAL_TEXT',
          });
        } else if (b.type === 'equation' && b.readable.trim()) {
          segments.push({ text: `${b.readable.trim()}\n`, namedStyleType: 'NORMAL_TEXT' });
        } else if (b.type === 'conflict_note') {
          segments.push({
            text: `تناقض (${b.topic}): روایت ۱ (${b.fileAName}): ${b.excerptA} | روایت ۲ (${b.fileBName}): ${b.excerptB}\n`,
            namedStyleType: 'NORMAL_TEXT',
          });
        }
      }
    }
  }

  return segments;
}

export async function createBookGoogleDoc(params: {
  accessToken: string;
  title: string;
  book: ParsedBook;
}): Promise<{ documentId: string; documentUrl: string; title: string }> {
  const { accessToken, title, book } = params;

  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!createRes.ok) {
    const msg = await parseGoogleErrorMessage(createRes);
    throw new Error(`خطا در ایجاد Google Doc: ${msg}`);
  }

  const created = (await createRes.json()) as {
    documentId: string;
    title?: string;
  };

  const segments = buildGoogleDocSegmentsFromBook(book);
  const fullText = segments.map((s) => s.text).join('');
  if (fullText.length > 0) {
    const requests: Array<Record<string, unknown>> = [
      {
        insertText: {
          location: { index: 1 },
          text: fullText,
        },
      },
    ];

    let cursor = 1;
    for (const seg of segments) {
      const startIndex = cursor;
      const endIndex = cursor + seg.text.length;
      requests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: {
            namedStyleType: seg.namedStyleType,
            direction: 'RIGHT_TO_LEFT',
          },
          fields: 'namedStyleType,direction',
        },
      });
      cursor = endIndex;
    }

    const batchRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
        created.documentId
      )}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!batchRes.ok) {
      const msg = await parseGoogleErrorMessage(batchRes);
      throw new Error(`سند Google Doc ساخته شد اما درج محتوا خطا داد: ${msg}`);
    }
  }

  return {
    documentId: created.documentId,
    documentUrl: `https://docs.google.com/document/d/${created.documentId}/edit`,
    title: created.title || title,
  };
}

export interface BookSlidePlanItem {
  slideId: string;
  titleId: string;
  bodyId: string;
  title: string;
  body: string;
}

export function buildBookSlidesPlan(params: {
  book: ParsedBook;
  winolsReport?: WinolsExtractionReport | null;
  maxChapterSlides?: number;
}): BookSlidePlanItem[] {
  const { book, winolsReport = null, maxChapterSlides = 16 } = params;
  const plan: BookSlidePlanItem[] = [];

  plan.push({
    slideId: 'slide_cover',
    titleId: 'slide_cover_title',
    bodyId: 'slide_cover_body',
    title: book.title,
    body: [
      book.subtitle || 'ارائه ساختاریافته کتاب فنی',
      `تعداد فصل‌ها: ${book.chapters.length}`,
      `نقشه‌های WinOLS شناسایی‌شده: ${winolsReport?.mapsDetected ?? 0}`,
      `مداخل واژه‌نامه: ${book.glossary?.length ?? 0}`,
    ].join('\n'),
  });

  book.chapters.slice(0, maxChapterSlides).forEach((ch, idx) => {
    const bulletLines = ch.sections
      .slice(0, 8)
      .map((sec) => `• ${sec.numberLabel ? `${sec.numberLabel}. ` : ''}${sec.title}`);
    if (ch.sections.length > 8) {
      bulletLines.push(`• و ${ch.sections.length - 8} زیربخش دیگر...`);
    }
    plan.push({
      slideId: `slide_ch_${idx + 1}`,
      titleId: `slide_ch_${idx + 1}_title`,
      bodyId: `slide_ch_${idx + 1}_body`,
      title: ch.title,
      body: bulletLines.join('\n') || 'خلاصه مباحث کلیدی فصل',
    });
  });

  if (winolsReport && winolsReport.entries.length > 0) {
    const mapLines = winolsReport.entries
      .slice(0, 10)
      .map(
        (m) =>
          `• ${m.mapCode} (${m.mapNameFa}) — ${m.dimensions}${m.hexAddresses.length > 0 ? ` · ${m.hexAddresses[0]}` : ''}`
      );
    plan.push({
      slideId: 'slide_winols_summary',
      titleId: 'slide_winols_summary_title',
      bodyId: 'slide_winols_summary_body',
      title: 'خلاصه نقشه‌های کلیدی WinOLS و کالیبراسیون',
      body: mapLines.join('\n'),
    });
  }

  return plan;
}

export async function createBookPresentation(params: {
  accessToken: string;
  title: string;
  book: ParsedBook;
  winolsReport?: WinolsExtractionReport | null;
}): Promise<{ presentationId: string; presentationUrl: string; title: string; slideCount: number }> {
  const { accessToken, title, book, winolsReport = null } = params;

  const createRes = await fetch('https://slides.googleapis.com/v1/presentations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!createRes.ok) {
    const msg = await parseGoogleErrorMessage(createRes);
    throw new Error(`خطا در ایجاد Google Slides: ${msg}`);
  }

  const created = (await createRes.json()) as {
    presentationId: string;
    title?: string;
    slides?: Array<{ objectId?: string }>;
  };

  const slidesPlan = buildBookSlidesPlan({ book, winolsReport });
  const requests: Array<Record<string, unknown>> = [];

  for (const item of slidesPlan) {
    requests.push(
      {
        createSlide: {
          objectId: item.slideId,
          slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
          placeholderIdMappings: [
            {
              layoutPlaceholder: { type: 'TITLE', index: 0 },
              objectId: item.titleId,
            },
            {
              layoutPlaceholder: { type: 'BODY', index: 0 },
              objectId: item.bodyId,
            },
          ],
        },
      },
      {
        insertText: {
          objectId: item.titleId,
          insertionIndex: 0,
          text: item.title,
        },
      },
      {
        insertText: {
          objectId: item.bodyId,
          insertionIndex: 0,
          text: item.body,
        },
      },
      {
        updateParagraphStyle: {
          objectId: item.titleId,
          textRange: { type: 'ALL' },
          style: { direction: 'RIGHT_TO_LEFT', alignment: 'START' },
          fields: 'direction,alignment',
        },
      },
      {
        updateParagraphStyle: {
          objectId: item.bodyId,
          textRange: { type: 'ALL' },
          style: { direction: 'RIGHT_TO_LEFT', alignment: 'START' },
          fields: 'direction,alignment',
        },
      }
    );
  }

  // Remove the default blank initial slide so presentation starts cleanly at cover slide
  const initialSlideId = created.slides?.[0]?.objectId;
  if (initialSlideId && slidesPlan.length > 0) {
    requests.push({ deleteObject: { objectId: initialSlideId } });
  }

  const batchRes = await fetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(
      created.presentationId
    )}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  );

  if (!batchRes.ok) {
    const msg = await parseGoogleErrorMessage(batchRes);
    throw new Error(`فایل Google Slides ساخته شد اما تولید اسلایدها خطا داد: ${msg}`);
  }

  return {
    presentationId: created.presentationId,
    presentationUrl: `https://docs.google.com/presentation/d/${created.presentationId}/edit`,
    title: created.title || title,
    slideCount: slidesPlan.length,
  };
}
