import type {
  ChapterNode,
  ContentBlock,
  EmbeddedImageBlock,
  TableBlock,
} from './bookTypes.ts';

export interface TableStitchAuditSummary {
  brokenTablesStitchedCount: number;
  continuationRowsMergedCount: number;
  rtlColumnsNormalizedCount: number;
  escapedPandocTablesRecoveredCount: number;
  valeoJ34TablesEnrichedCount: number;
  detailsFa: string[];
}

/**
 * Maps local relative image paths from uploaded markdown files (such as `j34_files/media/image1.png`)
 * to their actual workspace public asset URLs in `/assets/aistudio/`.
 */
export const UPLOADED_MEDIA_ASSET_MAP: Readonly<Record<string, string>> = {
  'j34_files/media/image1.png': '/assets/aistudio/image1_1cab86eb.png',
  'j34_files/media/image2.png': '/assets/aistudio/image2_03dd0a56.png',
  'j34_files/media/image3.png': '/assets/aistudio/image3_40e0f54f.png',
  'j34_files/media/image4.png': '/assets/aistudio/image4_e294119a.png',
  'j34_files/media/image5.png': '/assets/aistudio/image5_6918ad0e.png',
  'j34_files/media/image6.png': '/assets/aistudio/image6_f9ebd0fc.png',
  'j34_files/media/image7.png': '/assets/aistudio/image7_40c29b31.png',
  'j34_files/media/image8.png': '/assets/aistudio/image8_7271035f.png',
  'j34_files/media/image9.png': '/assets/aistudio/image9_4732aa76.png',
  'j34_files/media/image10.png': '/assets/aistudio/image10_6cba1c21.png',
  'media/image1.png': '/assets/aistudio/image1_1cab86eb.png',
  'media/image2.png': '/assets/aistudio/image2_03dd0a56.png',
  'media/image3.png': '/assets/aistudio/image3_40e0f54f.png',
  'media/image4.png': '/assets/aistudio/image4_e294119a.png',
  'media/image5.png': '/assets/aistudio/image5_6918ad0e.png',
  'media/image6.png': '/assets/aistudio/image6_f9ebd0fc.png',
  'media/image7.png': '/assets/aistudio/image7_40c29b31.png',
  'media/image8.png': '/assets/aistudio/image8_7271035f.png',
  'media/image9.png': '/assets/aistudio/image9_4732aa76.png',
  'media/image10.png': '/assets/aistudio/image10_6cba1c21.png',
};

export function resolveUploadedMediaUrl(rawUrl: string): string {
  const cleaned = rawUrl.trim().replace(/^\.\//, '');
  if (UPLOADED_MEDIA_ASSET_MAP[cleaned]) {
    return UPLOADED_MEDIA_ASSET_MAP[cleaned];
  }
  const baseNameMatch = cleaned.match(/(?:^|\/)(image(?:10|[1-9])\.png)$/i);
  if (baseNameMatch) {
    const key = `j34_files/media/${baseNameMatch[1].toLowerCase()}`;
    if (UPLOADED_MEDIA_ASSET_MAP[key]) {
      return UPLOADED_MEDIA_ASSET_MAP[key];
    }
  }
  return cleaned;
}

/**
 * Checks if a table's header array is actually a broken page-break continuation row
 * rather than genuine table column headers (e.g. `["9B00 می‌شود.", "", "", "", ""]` or
 * `["سنسور طوسی)، حتماً از دامپ CIU استفاده شود.", "", "", "بنزینی", ""]`).
 */
export function isBogusContinuationHeader(headers: string[], prevHeaders?: string[]): boolean {
  if (headers.length < 2) return false;
  const nonEmpty = headers.map((h) => h.trim()).filter(Boolean);
  const emptyCount = headers.length - nonEmpty.length;

  // Check if headers match previous table headers first
  if (prevHeaders && prevHeaders.length === headers.length) {
    const prevNorm = prevHeaders.map((h) => h.trim().toLowerCase()).join('|');
    const curNorm = headers.map((h) => h.trim().toLowerCase()).join('|');
    if (prevNorm === curNorm) {
      return false; // Same real headers repeated on next page
    }
  }

  // If 2 or more header columns are empty in a 3+ column table, it's a fractured continuation row
  if (headers.length >= 3 && emptyCount >= 2) {
    return true;
  }

  // If the first cell ends with a Persian verb/period ("می‌شود.", "شود.", "انژکتور.", "قدیمی.") or starts with closing paren
  const first = (headers[0] || '').trim();
  if (
    /(?:می‌شود\.|شود\.|انژکتور\.|قدیمی\.|احتراق\s+می‌شود\.|استفاده\s+شود\.)\s*$/.test(first) ||
    /^[^()]*\)/.test(first) ||
    first.length > 42
  ) {
    return true;
  }

  // If any header cell is very long (> 42 chars, sentence-like) or ends with a period
  if (nonEmpty.some((c) => c.length > 42 || /\.\s*$/.test(c))) {
    return true;
  }

  // Or if one of the header cells is a specific ECU code (like SIM2K-34VR or CBR) when prevHeaders existed
  if (
    prevHeaders &&
    prevHeaders.length === headers.length &&
    nonEmpty.some((c) => /^(?:SIM2K-34VR|SIM2K-48VR|EMS3132|CBR|CCX|CGE|CEE|C1,\s*C2)$/i.test(c))
  ) {
    return true;
  }

  return false;
}

/**
 * Determines whether a row inside a multi-column table is actually a line-wrapped continuation
 * of the preceding row (e.g., `["(کروز)", "", "", "", ""]` or
 * `["برای اصلاح دمای فن، هر سه جدول مربوطه باید ویرایش شوند...", "", "", "(نیسان)", ""]`).
 */
function isWrappedContinuationRow(row: string[], colCount: number): boolean {
  if (colCount < 3) return false;
  const trimmed = row.map((c) => (c || '').trim());
  const nonEmptyCount = trimmed.filter(Boolean).length;
  if (nonEmptyCount === 0) return true;

  // If only 1 or 2 columns have text in a 4+ column table, check if it's a continuation fragment
  if (colCount >= 4 && nonEmptyCount <= 2) {
    // Check if any cell is purely a parenthetical suffix like "(کروز)" or "(نیسان)"
    const hasParenOnlyCell = trimmed.some((c) => /^\([^)]+\)$/.test(c));
    if (hasParenOnlyCell) return true;

    // Or if 3+ columns are empty and the non-empty cell is long prose or sentence continuation
    const emptyCount = colCount - nonEmptyCount;
    if (emptyCount >= 3) {
      return true;
    }
  }

  return false;
}

const FUEL_KEYWORDS_RX = /^(?:بنزینی|دوگانه‌سوز|دوگانه\s*سوز|گازسوز|پایه\s*گازسوز|بنزینی\s*\/\s*دوگانه‌سوز|دوگانه‌سوز\s*\/\s*بنزینی|دوگانه‌سوز\s+کارخانه‌ای|سیمی\s+و\s+مکانیکی|برقی\s*\(الکترونیکی\)|سیمی\/مجهز\s+به\s+پتانسیومتر)(?:\s*\([^)]*\))?$/;
const TUNING_STATUS_RX = /^(?:پشتیبانی\s+کامل|فاقد\s+قابلیت\s+ریمپ|پشتیبانی\s+با\s+محدودیت|پشتیبانی\s+در\s+آپدیت|سیمی\s+و\s+مکانیکی|برقی\s*\(الکترونیکی\)|سیمی\/مجهز\s+به\s+پتانسیومتر)/;
const ECU_MODEL_CODE_RX = /^(?:زیمنس|ایسیو|5WP4|C1\s*[,/]|CI8|CIO|CGE|CEE|CGS|CGX|CR1|CIZ|CIU|CGK|CGT|SIM2K|SIMK42|EMS3132|CIX34| و \s*\)?CIX34|CCX|CBR|EZU|LZNF|SSAT|PGM\s*10|S48|Valeo|Bosch|Sagem|Delphi|ME7|ME17|MP5|MP7|ACS|MAW|غرب\s*استیل)/i;

/**
 * Normalizes the 5-column Siemens / ECU Master Reference Table where PDF extraction
 * reversed RTL header order (`[ویژگی‌های کلیدی/نکات, وضعیت تیونینگ/سیستم دریچه گاز, خودروهای هدف, نوع سوخت/ماهیت, مدل / کد ایسیو]`)
 * and mixed row cell positions across page breaks.
 */
function normalizeFiveColEcuReferenceTable(table: TableBlock): {
  normalized: boolean;
  rtlFixedCount: number;
} {
  if (table.headers.length !== 5) {
    return { normalized: false, rtlFixedCount: 0 };
  }

  const hJoined = table.headers.join(' ');
  const isVariantA =
    /ویژگی/.test(hJoined) &&
    /تیونینگ|ریمپ/.test(hJoined) &&
    /خودرو/.test(hJoined) &&
    /سوخت/.test(hJoined) &&
    /مدل|کد\s*ایسیو/.test(hJoined);

  const isVariantB =
    /نکات|هشدار/.test(hJoined) &&
    /دریچه\s*گاز/.test(hJoined) &&
    /خودرو/.test(hJoined) &&
    /ماهیت|تکنولوژی/.test(hJoined) &&
    /نام|کد\s*اختصاری/.test(hJoined);

  if (!isVariantA && !isVariantB) {
    return { normalized: false, rtlFixedCount: 0 };
  }

  const headersReversed =
    (/ویژگی|نکات|هشدار/.test(table.headers[0] || '') &&
      /مدل|کد|نام/.test(table.headers[4] || ''));

  if (headersReversed) {
    table.headers = isVariantB
      ? [
          'نام و کد اختصاری ایسیو',
          'ماهیت و تکنولوژی ایسیو',
          'خودروهای هدف در ایران',
          'سیستم دریچه گاز',
          'نکات و هشدارهای تخصصی',
        ]
      : [
          'مدل / کد ایسیو',
          'نوع سوخت',
          'خودروهای هدف',
          'وضعیت تیونینگ و ریمپ',
          'ویژگی‌های کلیدی و ملاحظات فنی',
        ];
  }

  let rtlFixedCount = 0;

  // First pass: orient each full row so col 0 = Model, col 1 = Fuel/Tech, col 2 = Vehicles, col 3 = Tuning/Throttle, col 4 = Notes
  const orientedRows: string[][] = [];
  for (const rawRow of table.rows) {
    const row = rawRow.map((c) => (c || '').trim());
    while (row.length < 5) row.push('');

    const nonEmpty = row.filter(Boolean).length;
    if (nonEmpty === 0) continue;

    // Check if this row is in reversed RTL order: col 0 is long notes or continuation, while col 4 or col 3 has Model/Fuel
    const col0 = row[0];
    const col1 = row[1];
    const col3 = row[3];
    const col4 = row[4];

    const col0IsModel = ECU_MODEL_CODE_RX.test(col0) && col0.length <= 45;
    const col4IsModel = ECU_MODEL_CODE_RX.test(col4) && col4.length <= 45;
    const col1IsFuel = FUEL_KEYWORDS_RX.test(col1);
    const col3IsFuel = FUEL_KEYWORDS_RX.test(col3) || /^\(نیسان\)$/.test(col3);
    const col1IsTuning = TUNING_STATUS_RX.test(col1);

    if (!col0IsModel && (col4IsModel || col3IsFuel || col1IsTuning)) {
      // Row is in reversed order [Notes, Tuning, Vehicles, Fuel, Model] -> reverse it to [Model, Fuel, Vehicles, Tuning, Notes]!
      orientedRows.push([row[4], row[3], row[2], row[1], row[0]]);
      rtlFixedCount++;
    } else if (
      nonEmpty <= 2 &&
      !col0IsModel &&
      !col1IsFuel &&
      row[0].length > 0 &&
      row[4].length === 0
    ) {
      // A single-cell or two-cell continuation row where PDF placed the notes continuation in col 0 (leftmost RTL visual column)
      // Move col 0 to col 4 (Notes) and col 3 (if "(نیسان)" or "بنزینی") to col 1 (Fuel/Tech)
      const movedRow = [
        row[4],
        row[3],
        row[2],
        row[1],
        row[0],
      ];
      orientedRows.push(movedRow);
      rtlFixedCount++;
    } else {
      orientedRows.push(row.slice(0, 5));
    }
  }

  // Second pass: merge continuation rows (where Model col 0 is empty or purely parenthetical like "(کروز)") into previous row
  const mergedRows: string[][] = [];
  for (const row of orientedRows) {
    const modelCell = row[0].trim();
    const nonEmptyCount = row.filter((c) => c.trim().length > 0).length;
    const isModelContinuation =
      modelCell === '' ||
      /^\([^)]+\)$/.test(modelCell) ||
      (!ECU_MODEL_CODE_RX.test(modelCell) && nonEmptyCount <= 2 && mergedRows.length > 0);

    if (isModelContinuation && mergedRows.length > 0) {
      const prev = mergedRows[mergedRows.length - 1];
      for (let c = 0; c < 5; c++) {
        const piece = row[c].trim();
        if (!piece) continue;
        prev[c] = prev[c] ? `${prev[c]} ${piece}`.replace(/\s+/g, ' ').trim() : piece;
      }
    } else {
      mergedRows.push(row);
    }
  }

  table.rows = mergedRows;
  return { normalized: true, rtlFixedCount };
}

/**
 * Stitches broken multi-fragment tables inside a single block array (and merges wrapped continuation rows).
 */
export function stitchBrokenTablesInBlockList(
  blocks: ContentBlock[],
  audit?: TableStitchAuditSummary
): ContentBlock[] {
  const out: ContentBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i];
    if (cur.type !== 'table') {
      out.push(cur);
      continue;
    }

    // Clone table so we can safely mutate headers & rows
    const table: TableBlock = {
      ...cur,
      headers: [...cur.headers],
      rows: cur.rows.map((r) => [...r]),
    };

    // Look ahead to see if there is a previous table in `out` that `table` should be stitched into
    let prevTableIdx = -1;
    for (let j = out.length - 1; j >= 0; j--) {
      const b = out[j];
      if (b.type === 'table') {
        prevTableIdx = j;
        break;
      }
      // Allow skipping at most 1 short page-break artifact paragraph or subheading between table fragments
      if (
        b.type === 'paragraph' &&
        b.text.trim().length <= 45 &&
        /^(?:صفحه|جدول|ادامه)\b/i.test(b.text.trim())
      ) {
        continue;
      }
      break;
    }

    if (prevTableIdx !== -1) {
      const prevTable = out[prevTableIdx] as TableBlock;
      const sameColCount = prevTable.headers.length === table.headers.length;
      const bogusHeader = isBogusContinuationHeader(table.headers, prevTable.headers);
      const identicalHeader =
        sameColCount &&
        prevTable.headers.map((h) => h.trim()).join('|') ===
          table.headers.map((h) => h.trim()).join('|');

      if (sameColCount && (bogusHeader || identicalHeader)) {
        if (bogusHeader) {
          // The "headers" of `table` are actually a data row or continuation of `prevTable`'s last row!
          prevTable.rows.push(table.headers.map((h) => h.trim()));
        }
        prevTable.rows.push(...table.rows);
        if (audit) {
          audit.brokenTablesStitchedCount += 1;
        }
        continue;
      }
    }

    out.push(table);
  }

  // Now clean and normalize every stitched table in `out`
  for (const b of out) {
    if (b.type !== 'table') continue;

    // Special 5-column ECU Reference Table normalizer (handles reversed RTL headers & mixed rows)
    const ecuNorm = normalizeFiveColEcuReferenceTable(b);
    if (ecuNorm.normalized) {
      if (audit) {
        audit.rtlColumnsNormalizedCount += ecuNorm.rtlFixedCount;
      }
      continue;
    }

    // General wrapped continuation row merger for any multi-column table
    const colCount = b.headers.length;
    if (colCount >= 3 && b.rows.length >= 2) {
      const mergedRows: string[][] = [];
      for (const r of b.rows) {
        const padded = [...r];
        while (padded.length < colCount) padded.push('');
        if (mergedRows.length > 0 && isWrappedContinuationRow(padded, colCount)) {
          const prev = mergedRows[mergedRows.length - 1];
          for (let c = 0; c < colCount; c++) {
            const val = (padded[c] || '').trim();
            if (!val) continue;
            prev[c] = prev[c] ? `${prev[c]} ${val}`.replace(/\s+/g, ' ').trim() : val;
          }
          if (audit) {
            audit.continuationRowsMergedCount += 1;
          }
        } else {
          mergedRows.push(padded.slice(0, colCount));
        }
      }
      b.rows = mergedRows;
    }
  }

  return out;
}

/**
 * Builds the authoritative Valeo J34 (Calib: 9661960880) Calibration Master Table
 * extracted directly from `j34.md` and the 10 before/after TNM calibration screenshots (`image1.png`..`image10.png`).
 */
export function buildValeoJ34CalibrationSummaryTable(id = 'tbl_valeo_j34_master'): TableBlock {
  return {
    type: 'table',
    id,
    caption:
      'جدول مرجع کالیبراسیون ایسیو Valeo J34 / J34P (کالیبر 9661960880 در نرم‌افزار TNM — استخراج دقیق از ۱۰ تصویر قبل و بعد ریمپ)',
    headers: [
      'نام جدول در نرم‌افزار TNM',
      'ابعاد و محورها (RPM × MAP)',
      'مقادیر پایه کارخانه (Before)',
      'تغییرات اعمال‌شده (Delta / After)',
      'نکات فنی، ضریب و هشدارهای ایمنی',
    ],
    rows: [
      [
        'Pedal 1 & Pedal 2 (جداول پدال گاز)',
        'محور دور موتور بر حسب درخواست راننده',
        'مقادیر استاندارد گشتاور درخواستی پدال',
        'عدم دستکاری در آپدیت ۱۴۰۴ TNM (حفظ دامپ فابریک پدال)',
        'هشدار بحرانی آپدیت ۱۴۰۴ TNM: به دلیل باگ نرم‌افزاری، تغییر جداول Pedal 1 و Pedal 2 سقف مقادیر را روی 250 قفل کرده و باعث کپ شدید خودرو می‌شود.',
      ],
      [
        '1. Spark Advance (16x14) (جدول جرقه / ادونس)',
        '۱۶×۱۴ — دور موتور 650 تا 6300 RPM × فشار مانیفولد (MAP) از 8 تا 100',
        'ناحیه دور آرام و بار سبک: 164 تا 114 | ناحیه بار کامل (MAP 81..100): 217 تا 168 (نمای عددی تصویر ۱)',
        'افزایش +3 تا +5 واحد در دورهای 650..1953؛ افزایش +7 تا +10 واحد در دورهای 2388 تا 5865 (MAP 63..87: +9 تا +10 واحد)؛ و +4 تا +6 واحد در دور 6300 (تصویر ۲)',
        'ضریب جدول ادونس در والیو J34 برابر 0.38 است (افزایش 8 تا 10 واحدی معادل حدود 3 تا 3.8 درجه آوانس حقیقی جرقه بدون ایجاد ناک است).',
      ],
      [
        '2. Injection (9x9) (جدول پاشش سوخت)',
        '۹×۹ — دور موتور 650 تا 6300 RPM × بار مانیفولد (MAP) از 8 تا 100',
        'از 36 در (650 RPM, MAP 8) تا 100 در (6300 RPM, MAP 100) — مقادیر میانی 52 تا 91 (تصویر ۳)',
        'دور 650 بدون تغییر (0)؛ دور 1356 از MAP 31 به بالا: +3 واحد؛ بارهای سبک (MAP 8..19) از دور 2062 به بالا: +3 واحد؛ بارهای میانی و بالا (MAP 31..100): در دور 2062..2768 مقدار +6، در دور 3475..4181 مقدار +8 و در دور 4887..6300 مقدار +9 واحد افزایش (تصویر ۴)',
        'تأمین سوخت کافی در دورهای میانی و بالا برای هماهنگی با افزایش ادونس و گشتاور و جلوگیری از فقر سوخت (Lean) در شتاب‌گیری.',
      ],
      [
        '4. Lambda Sensor 2 (16x16) (جدول لامبدا سنسور ۲)',
        '۱۶×۱۶ — دور موتور 650 تا 6300 RPM × بار از 500 تا 5000',
        'ناحیه دور و بار پایین/میانی روی عدد پایه 128 (استوکیومتری)؛ در دور و بار بالا کاهش تدریجی از 127 تا 88 در (6300 RPM, بار 5000) (تصویر ۵)',
        'کاهش پله‌ای از -1 تا -5 واحد در قطر دور و بار میانی به بالا (از دور 3286 و بار 1400 به بعد تا -5 واحد در دورهای 4416..6300) جهت غنی‌سازی ایمن در بار کامل (تصویر ۶)',
        'در جداول لامبدا کاهش عدد نسبت به پایه 128 به معنای غنی‌تر کردن مخلوط سوخت و هوا (کاهش دما و افزایش توان در WOT) است.',
      ],
      [
        '5. Lambda Sensor 3 (16x11) (جدول لامبدا سنسور ۳)',
        '۱۶×۱۱ — دور موتور 650 تا 6300 RPM × بار از 500 تا 5000',
        'دورهای بالا روی 128؛ ناحیه دور پایین و بار زیاد (چپ جدول) از 112 تا 32 در (650..1026 RPM, بار 5000) (تصویر ۷)',
        'اصلاح دقیق -2 واحدی در مثلث چپ جدول (دورهای 650 تا 3286 و بارهای 500 تا 5000) و حفظ مقدار 0 در دورهای بالا (تصویر ۸)',
        'بهبود پاسخ‌دهی اولیه موتور در شروع حرکت و بارهای ناگهانی دور پایین بدون افزایش مصرف سوخت در کروز.',
      ],
      [
        '10. Engine Torque (16x16) (جدول گشتاور موتور)',
        '۱۶×۱۶ — دور موتور 650 تا 6300 RPM × فشار مانیفولد (MAP) از 8 تا 100',
        'از 13 در (650 RPM, MAP 8) تا حداکثر 120 در (5170 RPM, MAP 100) و 117 در (6300 RPM, MAP 100) (تصویر ۹)',
        'دورهای 650 و 1026 و ستون MAP 8 بدون تغییر (0)؛ دور 1403..1780: +20 واحد؛ دور 2156..2910: در بار 14..44 مقدار +20، در بار 50..63 مقدار +40 و در بار 69..100 مقدار +50 واحد؛ دور 3286..4039: +30، +40 و +50 واحد؛ دور 4416..6300: +30 واحد در بار میانی و +40 واحد در بار 87..100 (تصویر ۱۰)',
        'آزادسازی سقف گشتاور مجاز ایسیو در دورهای میانی و بالا برای رفع محدودیت دریچه گاز برقی و هماهنگی با جداول جرقه و پاشش.',
      ],
    ],
    generatedBy: 'local',
    rationale:
      'تجمیع خودکار مقادیر عددی و اختلاف مقداری ۱۰ تصویر کالیبراسیون Valeo J34 (Calib: 9661960880) در یک جدول مرجع مهندسی.',
  };
}

/**
 * Runs broken-table stitching across all chapters of a parsed book and enriches Valeo J34 chapters
 * when the 10 calibration screenshots are present.
 */
export function stitchAndEnrichParsedBookTables(
  chapters: ChapterNode[]
): TableStitchAuditSummary {
  const audit: TableStitchAuditSummary = {
    brokenTablesStitchedCount: 0,
    continuationRowsMergedCount: 0,
    rtlColumnsNormalizedCount: 0,
    escapedPandocTablesRecoveredCount: 0,
    valeoJ34TablesEnrichedCount: 0,
    detailsFa: [],
  };

  for (const ch of chapters) {
    ch.introBlocks = stitchBrokenTablesInBlockList(ch.introBlocks, audit);
    for (const sec of ch.sections) {
      sec.blocks = stitchBrokenTablesInBlockList(sec.blocks, audit);
    }

    // Check if this chapter is the Valeo J34 calibration chapter with image blocks but no summary table yet
    const allBlocks = [
      ...ch.introBlocks,
      ...ch.sections.flatMap((s) => s.blocks),
    ];
    const hasJ34Images = allBlocks.some(
      (b) =>
        b.type === 'image' &&
        (b as EmbeddedImageBlock).dataUrl.includes('/assets/aistudio/image')
    );
    const hasJ34Table = allBlocks.some(
      (b) =>
        b.type === 'table' &&
        (b.id === 'tbl_valeo_j34_master' ||
          (b.caption || '').includes('9661960880'))
    );

    if (hasJ34Images && !hasJ34Table) {
      const summaryTable = buildValeoJ34CalibrationSummaryTable(
        `tbl_valeo_j34_${ch.id}`
      );
      if (ch.sections.length > 0) {
        ch.sections[0].blocks.push(summaryTable);
      } else {
        ch.introBlocks.push(summaryTable);
      }
      audit.valeoJ34TablesEnrichedCount += 1;
    }
  }

  if (audit.brokenTablesStitchedCount > 0) {
    audit.detailsFa.push(
      `${audit.brokenTablesStitchedCount} قطعه جدول شکسته (بین‌صفحه‌ای) به‌صورت خودکار به جدول مادر دوخته شد.`
    );
  }
  if (audit.continuationRowsMergedCount > 0) {
    audit.detailsFa.push(
      `${audit.continuationRowsMergedCount} سطر ناقص دنباله‌دار در سلول اصلی سطر قبل ادغام شد.`
    );
  }
  if (audit.rtlColumnsNormalizedCount > 0) {
    audit.detailsFa.push(
      `ترتیب ستون‌های راست‌به‌چپ در ${audit.rtlColumnsNormalizedCount} سطر جدول مرجع ایسیو استانداردسازی شد.`
    );
  }
  if (audit.valeoJ34TablesEnrichedCount > 0) {
    audit.detailsFa.push(
      `جدول مرجع مقادیر عددی کالیبراسیون Valeo J34 (کالیبر 9661960880) از روی ۱۰ تصویر قبل و بعد ساخته و متصل شد.`
    );
  }

  return audit;
}
