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
];

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

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
  const { accessToken, spreadsheetId, sheetTitle, maxRange = 'A1:Z500' } = params;
  const safeTab = sheetTitle.replace(/'/g, "''");
  const rangeExpr = `'${safeTab}'!${maxRange}`;
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

export async function uploadFileToDrive(params: {
  accessToken: string;
  fileName: string;
  mimeType: string;
  data: Blob | string;
  existingFileId?: string | null;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { accessToken, fileName, mimeType, data, existingFileId } = params;
  const contentBlob =
    typeof data === 'string' ? new Blob([data], { type: mimeType }) : data;

  const metadata = existingFileId
    ? { name: fileName }
    : { name: fileName, mimeType };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', contentBlob);

  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingFileId
      )}?uploadType=multipart&fields=id,name,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';

  const res = await fetch(endpoint, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res);
    throw new Error(`خطا در ذخیره فایل در Google Drive: ${msg}`);
  }

  return (await res.json()) as { id: string; name: string; webViewLink?: string };
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
        valueInputOption: 'USER_ENTERED',
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
  const rangeExpr = `'${safeTab}'!A1`;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(rangeExpr)}?valueInputOption=USER_ENTERED`,
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
