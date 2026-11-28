/**
 * Phase 3 — Multimodal Extractors:
 * 1) Multi-page broken table merger (DTC tables, ECU pinout tables split across PDF/DOCX pages)
 * 2) Post-ASR Automotive Glossary Alignment (Persian/English technical audio transcription normalization)
 * 3) Deterministic EXIF metadata stripper (JPEG, PNG, WebP)
 * 4) Constrained Vision JSON -> Encyclopedia Markdown normalizer with Zero-Base64 guarantee
 */

// ============================================================================
// 1. MULTI-PAGE BROKEN TABLE MERGER
// ============================================================================

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length >= 3;
}

function isMarkdownSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!isMarkdownTableRow(trimmed)) return false;
  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function countTableColumns(line: string): number {
  const trimmed = line.trim();
  if (!isMarkdownTableRow(trimmed)) return 0;
  return trimmed.slice(1, -1).split('|').length;
}

function normalizeTableRowSignature(line: string): string {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}

function isPageBreakSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^-{3,}$/.test(trimmed) || /^={3,}$/.test(trimmed)) return true;
  if (/^(?:صفحه|page)\s*[0-9۰-۹]+(?:\s*(?:از|of)\s*[0-9۰-۹]+)?$/i.test(trimmed)) return true;
  if (/^<!--\s*page\s*break\s*-->$/i.test(trimmed)) return true;
  return false;
}

/**
 * Merges multi-page Markdown tables broken by page markers or repeated headers
 * (common in PDF/DOCX DTC code catalogs and ECU pinout tables).
 */
export function mergeMultiPageBrokenTables(markdown: string): {
  mergedMarkdown: string;
  mergedTablesCount: number;
} {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let mergedTablesCount = 0;

  let activeTableCols = 0;
  let activeHeaderSignature = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isMarkdownTableRow(line)) {
      const cols = countTableColumns(line);
      if (activeTableCols === 0) {
        activeTableCols = cols;
        activeHeaderSignature = normalizeTableRowSignature(line);
      }
      output.push(line);
      i += 1;
      continue;
    }

    // If we are right after a table, look ahead across page-break noise to see if the table continues
    if (activeTableCols > 0 && isPageBreakSeparatorLine(line)) {
      let lookahead = i;
      while (lookahead < lines.length && isPageBreakSeparatorLine(lines[lookahead])) {
        lookahead += 1;
      }

      if (
        lookahead < lines.length &&
        isMarkdownTableRow(lines[lookahead]) &&
        countTableColumns(lines[lookahead]) === activeTableCols
      ) {
        mergedTablesCount += 1;
        // Skip the page-break lines and jump to the continuation table
        i = lookahead;

        // If the continuation repeats the exact header + separator, drop the duplicate header
        const nextSig = normalizeTableRowSignature(lines[i]);
        if (
          nextSig === activeHeaderSignature &&
          i + 1 < lines.length &&
          isMarkdownSeparatorRow(lines[i + 1])
        ) {
          i += 2;
        } else if (isMarkdownSeparatorRow(lines[i])) {
          i += 1;
        }
        continue;
      }
    }

    // Non-table content resets active table context
    activeTableCols = 0;
    activeHeaderSignature = '';
    output.push(line);
    i += 1;
  }

  return {
    mergedMarkdown: output.join('\n'),
    mergedTablesCount,
  };
}

// ============================================================================
// 2. POST-ASR 2-STAGE AUTOMOTIVE GLOSSARY ALIGNMENT + PDF PERSIAN UNICODE CHECK
// ============================================================================

const POST_ASR_AUTOMOTIVE_GLOSSARY: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(?:وین\s*اولس|وین\s*الس|وینولز|وینوئلس)/gi, replacement: 'WinOLS' },
  { pattern: /(?:دیموس|داموس|داموز)/gi, replacement: 'DAMOS' },
  { pattern: /(?:ای\s*سی\s*یو|ای‌سی‌یو|ایسیو)/gi, replacement: 'ECU' },
  { pattern: /(?:تی\s*سی\s*یو|تی‌سی‌یو)/gi, replacement: 'TCU' },
  { pattern: /(?:بی\s*سی\s*ام|بی‌سی‌ام)/gi, replacement: 'BCM' },
  { pattern: /(?:بی\s*ام\s*اس|بی‌ام‌اس)/gi, replacement: 'BMS' },
  { pattern: /(?:کن\s*اف\s*دی|کان\s*اف\s*دی)/gi, replacement: 'CAN-FD' },
  { pattern: /(?:کن\s*باس|کان\s*باس)/gi, replacement: 'CAN-BUS' },
  { pattern: /(?:لین\s*باس)/gi, replacement: 'LIN-BUS' },
  { pattern: /(?:دو\s*آی\s*پی|دوایپی)/gi, replacement: 'DoIP' },
  { pattern: /(?:او\s*بی\s*دی\s*دو|او\s*بی\s*دی\s*۲|اوبیدی\s*۲)/gi, replacement: 'OBD-II' },
  { pattern: /(?:او\s*بی\s*دی\s*آن\s*یو\s*دی\s*اس)/gi, replacement: 'OBDonUDS' },
  { pattern: /(?:دی\s*تی\s*سی|دی‌تی‌سی)/gi, replacement: 'DTC' },
  { pattern: /(?:پی\s*آی\s*دی|پی‌آی‌دی)/gi, replacement: 'PID' },
  { pattern: /(?:تی\s*اس\s*بی|تی‌اس‌بی)/gi, replacement: 'TSB' },
  { pattern: /(?:اس\s*جی\s*دبلیو|اس‌جی‌دبلیو)/gi, replacement: 'SGW' },
  { pattern: /(?:اس\s*اف\s*دی\s*دو|اس‌اف‌دی\s*۲)/gi, replacement: 'SFD2' },
  { pattern: /(?:اس\s*اف\s*دی|اس‌اف‌دی)/gi, replacement: 'SFD' },
  { pattern: /(?:لامبدا|لامدا)/gi, replacement: 'Lambda' },
  { pattern: /(?:ای\s*اف\s*آر|ای‌اف‌آر)/gi, replacement: 'AFR' },
  { pattern: /(?:جی\s*دی\s*آی|جی‌دی‌آی)/gi, replacement: 'GDI' },
  { pattern: /(?:پی\s*اف\s*آی|پی‌اف‌آی)/gi, replacement: 'PFI' },
  { pattern: /(?:سی\s*آر\s*دی\s*آی|کامن\s*ریل)/gi, replacement: 'CRDi' },
  { pattern: /(?:کی\s*اف\s*زد\s*دبلیو)/gi, replacement: 'KFZW' },
  { pattern: /(?:لامفا)/gi, replacement: 'LAMFA' },
  { pattern: /(?:ال\s*دی\s*آر\s*ایکس\s*ان)/gi, replacement: 'LDRXN' },
  { pattern: /(?:تی\s*جی\s*بی|تی‌جی‌بی)/gi, replacement: 'TGB' },
  { pattern: /(?:کی\s*تگ|کیتگ)/gi, replacement: 'K-TAG' },
  { pattern: /(?:کس\s*وی\s*دو|کس\s*وی\s*۲)/gi, replacement: 'KESSv2' },
  { pattern: /(?:تی\s*ان\s*ام|پروگرامر\s*تی\s*ان\s*ام)/gi, replacement: 'TNM' },
  { pattern: /(?:پین\s*اوت|پیناوت)/gi, replacement: 'Pinout' },
  { pattern: /(?:فریز\s*فریم)/gi, replacement: 'Freeze Frame' },
  { pattern: /(?:بنچ\s*مود)/gi, replacement: 'Bench Mode' },
  { pattern: /(?:بوت\s*مود)/gi, replacement: 'Boot Mode' },
  { pattern: /(?:چک\s*سام|چک‌سام)/gi, replacement: 'Checksum' },
  { pattern: /(?:ایموبلایزر|ایموبیلایزر)/gi, replacement: 'Immobilizer' },
  { pattern: /(?:بوش\s*ام\s*ای\s*هفت\s*چهار\s*چهار|ام\s*ای\s*۷\.۴\.۴)/gi, replacement: 'Bosch ME7.4.4' },
  { pattern: /(?:بوش\s*ام\s*ای\s*هفت\s*چهار\s*پنج|ام\s*ای\s*۷\.۴\.۵)/gi, replacement: 'Bosch ME7.4.5' },
  { pattern: /(?:بوش\s*ام\s*ای\s*هفده\s*نه\s*هفت|ام\s*ای\s*۱۷\.۹\.۷)/gi, replacement: 'Bosch ME17.9.7' },
  { pattern: /(?:زیمنس\s*سیم\s*دو\s*کا|سیم\s*تو\s*کی)/gi, replacement: 'Siemens SIM2K' },
  { pattern: /(?:والئو\s*جی\s*سی\s*و\s*چهار|جی\s*۳۴)/gi, replacement: 'Valeo J34P' },
  { pattern: /(?:ساژم\s*اس\s*دوهزار|اس\s*۲۰۰۰)/gi, replacement: 'Sagem S2000' },
];

export function alignPostAsrAutomotiveTerms(transcript: string): {
  alignedText: string;
  replacementsApplied: number;
  ambiguousSentencesForSlm: string[];
} {
  let result = transcript;
  let replacementsApplied = 0;

  for (const entry of POST_ASR_AUTOMOTIVE_GLOSSARY) {
    result = result.replace(entry.pattern, () => {
      replacementsApplied += 1;
      return entry.replacement;
    });
  }

  // Stage 2: Detect sentences that still contain phonetic technical ambiguity for optional SLM review
  const sentences = result
    .split(/(?<=[.؟!\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ambiguousSentencesForSlm = sentences.filter((s) =>
    /(?:آدرس\s*هگز|جدول\s*[آ-ی]{2,4}\s+[آ-ی]{2,4}|کد\s*خطای\s*پی\s*[۰-۹0-9]+)/i.test(s)
  );

  return {
    alignedText: result,
    replacementsApplied,
    ambiguousSentencesForSlm,
  };
}

export interface PdfPersianUnicodeHealthReport {
  healthy: boolean;
  needsVisionOcrFallback: boolean;
  presentationFormsRatio: number;
  reversedVisualOrderDetected: boolean;
  replacementCharCount: number;
  reasonFa: string | null;
}

/**
 * Inspects text extracted from a PDF layer before accepting it into the Encyclopedia.
 * Detects broken Arabic Presentation Forms (U+FB50..U+FDFF, U+FE70..U+FEFF), replacement
 * characters (U+FFFD), or reversed visual-order Persian words (e.g. "ورجوپ", "وتوم")
 * so garbled pages are routed to Vision OCR instead of polluting the knowledge store.
 */
export function checkPdfPersianUnicodeHealth(extractedText: string): PdfPersianUnicodeHealthReport {
  const sample = (extractedText || '').trim();
  if (sample.length === 0) {
    return {
      healthy: false,
      needsVisionOcrFallback: true,
      presentationFormsRatio: 0,
      reversedVisualOrderDetected: false,
      replacementCharCount: 0,
      reasonFa: 'لایه متنی PDF خالی یا اسکن تصویری است؛ نیازمند Vision OCR.',
    };
  }

  let persianStandardCount = 0;
  let presentationFormsCount = 0;
  let replacementCharCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code >= 0x0600 && code <= 0x06ff) {
      persianStandardCount += 1;
    } else if ((code >= 0xfb50 && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfeff)) {
      presentationFormsCount += 1;
    } else if (code === 0xfffd) {
      replacementCharCount += 1;
    }
  }

  const totalPersian = persianStandardCount + presentationFormsCount;
  const presentationFormsRatio =
    totalPersian > 0 ? Number((presentationFormsCount / totalPersian).toFixed(3)) : 0;

  // Detect common visual-order reversed Persian words in broken legacy PDFs
  const reversedVisualOrderDetected =
    /(?:\bورجوپ\b|\bوتوم\b|\bوسیا\b|\bروما\b|\bدنمس\b|\bانید\b)/.test(sample);

  const unhealthy =
    replacementCharCount > 5 ||
    presentationFormsRatio > 0.35 ||
    reversedVisualOrderDetected;

  return {
    healthy: !unhealthy,
    needsVisionOcrFallback: unhealthy,
    presentationFormsRatio,
    reversedVisualOrderDetected,
    replacementCharCount,
    reasonFa: unhealthy
      ? reversedVisualOrderDetected
        ? 'متن فارسی PDF به صورت معکوس (Visual-Order) استخراج شده است؛ نیازمند Vision OCR.'
        : 'انکودینگ فونت فارسی PDF دارای گلیف‌های شکسته یا Presentation Forms غیرهمگون است؛ نیازمند Vision OCR.'
      : null,
  };
}

// ============================================================================
// 3. DETERMINISTIC EXIF STRIPPER (JPEG, PNG, WEBP)
// ============================================================================

/**
 * Strips EXIF/XMP/comment metadata segments from JPEG, PNG, and WebP buffers in-memory
 * without touching image pixel payloads.
 */
export function stripImageExifBytes(bytes: Uint8Array, format: 'jpg' | 'jpeg' | 'png' | 'webp'): {
  cleanedBytes: Uint8Array;
  strippedMetadataSegments: number;
} {
  if (format === 'jpg' || format === 'jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return { cleanedBytes: bytes, strippedMetadataSegments: 0 };
    }
    const chunks: Uint8Array[] = [bytes.slice(0, 2)]; // SOI
    let offset = 2;
    let stripped = 0;

    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        chunks.push(bytes.slice(offset));
        break;
      }
      const marker = bytes[offset + 1];
      // SOS (0xDA) starts entropy-coded image stream until EOI
      if (marker === 0xda) {
        chunks.push(bytes.slice(offset));
        break;
      }
      // EOI (0xD9) or standalone RST markers
      if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        chunks.push(bytes.slice(offset, offset + 2));
        offset += 2;
        continue;
      }
      if (offset + 3 >= bytes.length) {
        chunks.push(bytes.slice(offset));
        break;
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const end = Math.min(bytes.length, offset + 2 + segLen);
      // Strip APP1 (0xE1 EXIF/XMP), APP2 (0xE2 ICC/FlashPix), APP13 (0xED IPTC), COM (0xFE)
      if (marker === 0xe1 || marker === 0xe2 || marker === 0xed || marker === 0xfe) {
        stripped += 1;
      } else {
        chunks.push(bytes.slice(offset, end));
      }
      offset = end;
    }

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      merged.set(c, pos);
      pos += c.length;
    }
    return { cleanedBytes: merged, strippedMetadataSegments: stripped };
  }

  if (format === 'png') {
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      return { cleanedBytes: bytes, strippedMetadataSegments: 0 };
    }
    const chunks: Uint8Array[] = [bytes.slice(0, 8)]; // PNG signature
    let offset = 8;
    let stripped = 0;
    const decoder = new TextDecoder('ascii');

    while (offset + 12 <= bytes.length) {
      const length =
        ((bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3]) >>>
        0;
      const chunkType = decoder.decode(bytes.slice(offset + 4, offset + 8));
      const end = Math.min(bytes.length, offset + 12 + length);
      if (chunkType === 'eXIf' || chunkType === 'tEXt' || chunkType === 'iTXt' || chunkType === 'zTXt') {
        stripped += 1;
      } else {
        chunks.push(bytes.slice(offset, end));
      }
      offset = end;
    }

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      merged.set(c, pos);
      pos += c.length;
    }
    return { cleanedBytes: merged, strippedMetadataSegments: stripped };
  }

  // WebP RIFF container: strip EXIF / XMP chunks
  if (format === 'webp' && bytes.length >= 12) {
    const decoder = new TextDecoder('ascii');
    const chunks: Uint8Array[] = [];
    let offset = 12;
    let stripped = 0;

    while (offset + 8 <= bytes.length) {
      const fourcc = decoder.decode(bytes.slice(offset, offset + 4));
      const size =
        (bytes[offset + 4] |
          (bytes[offset + 5] << 8) |
          (bytes[offset + 6] << 16) |
          (bytes[offset + 7] << 24)) >>>
        0;
      const paddedSize = size + (size % 2);
      const end = Math.min(bytes.length, offset + 8 + paddedSize);
      if (fourcc === 'EXIF' || fourcc === 'XMP ') {
        stripped += 1;
      } else {
        chunks.push(bytes.slice(offset, end));
      }
      offset = end;
    }

    if (stripped === 0) return { cleanedBytes: bytes, strippedMetadataSegments: 0 };
    const payloadLen = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(12 + payloadLen);
    out.set(bytes.slice(0, 12), 0);
    const riffSize = 4 + payloadLen;
    out[4] = riffSize & 0xff;
    out[5] = (riffSize >>> 8) & 0xff;
    out[6] = (riffSize >>> 16) & 0xff;
    out[7] = (riffSize >>> 24) & 0xff;
    let pos = 12;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return { cleanedBytes: out, strippedMetadataSegments: stripped };
  }

  return { cleanedBytes: bytes, strippedMetadataSegments: 0 };
}

// ============================================================================
// 4. CONSTRAINED IMAGE KNOWLEDGE EXTRACTION + ZERO-BASE64 ENCYCLOPEDIA GUARD
// ============================================================================

export interface ConstrainedAutomotiveImageExtraction {
  domainTag: string;
  summaryFa: string | null;
  extractedNumbers: Array<{ label: string; value: string | null; unit: string | null }>;
  hexAddresses: string[];
  pinoutRows: Array<{ pin: string | null; signal: string | null; voltageOrNote: string | null }>;
  dynoOrChartNotesFa: string | null;
  unreadableRegionsWarning: boolean;
  optionalImageRefId?: string | null;
  imagePublicationApproved?: boolean;
}

/**
 * Strips any accidental inline Base64 data URIs (`data:image/...;base64,...`) so
 * Master Encyclopedia Markdown/JSON NEVER stores embedded raw images.
 */
export function stripBase64ImagesFromMarkdown(markdown: string): {
  cleanMarkdown: string;
  removedBase64Count: number;
} {
  let removedBase64Count = 0;
  const cleanMarkdown = markdown.replace(
    /!\[[^\]]*\]\(\s*data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+\)/gi,
    () => {
      removedBase64Count += 1;
      return '[تصویر منبع صرفاً به‌صورت داده متنی/جدولی استخراج شد]';
    }
  ).replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi,
    () => {
      removedBase64Count += 1;
      return '[Base64-Removed]';
    }
  );

  return { cleanMarkdown, removedBase64Count };
}

/**
 * Converts constrained Vision extraction JSON into clean encyclopedia Markdown text/tables
 * (Strict Null Policy for unreadable cells, ZERO Base64 image data, image publication defaults to false).
 */
export function normalizeImageExtractionForEncyclopedia(
  extraction: ConstrainedAutomotiveImageExtraction
): {
  markdown: string;
  metadata: {
    evidenceTier: 'text_or_screenshot_reported';
    optionalImageRefId: string | null;
    imagePublicationApproved: boolean;
    unreadableRegionsWarning: boolean;
  };
} {
  const parts: string[] = [];
  const UNKNOWN = 'نامشخص / ناخوانا در تصویر';

  if (extraction.summaryFa?.trim()) {
    parts.push(extraction.summaryFa.trim());
  }

  if (extraction.hexAddresses.length > 0) {
    parts.push(`آدرس‌های هگز مشاهده‌شده در تصویر: ${extraction.hexAddresses.join('، ')}`);
  }

  if (extraction.extractedNumbers.length > 0) {
    parts.push('| پارامتر فنی | مقدار | واحد |');
    parts.push('| --- | --- | --- |');
    for (const item of extraction.extractedNumbers) {
      parts.push(
        `| ${item.label} | ${item.value ?? UNKNOWN} | ${item.unit ?? 'نامشخص'} |`
      );
    }
  }

  if (extraction.pinoutRows.length > 0) {
    parts.push('| پایه (Pin) | سیگنال | ولتاژ / توضیح |');
    parts.push('| --- | --- | --- |');
    for (const row of extraction.pinoutRows) {
      parts.push(
        `| ${row.pin ?? UNKNOWN} | ${row.signal ?? UNKNOWN} | ${row.voltageOrNote ?? UNKNOWN} |`
      );
    }
  }

  if (extraction.dynoOrChartNotesFa?.trim()) {
    parts.push(`تحلیل نمودار / داینو: ${extraction.dynoOrChartNotesFa.trim()}`);
  }

  if (extraction.unreadableRegionsWarning) {
    parts.push(
      '> **هشدار دقت استخراج تصویر:** برخی بخش‌های تصویر ناخوانا بوده‌اند و بدون حدس‌زدن به‌صورت «نامشخص / ناخوانا» ثبت شده‌اند.'
    );
  }

  const rawMd = parts.join('\n\n');
  const { cleanMarkdown } = stripBase64ImagesFromMarkdown(rawMd);

  return {
    markdown: cleanMarkdown,
    metadata: {
      evidenceTier: 'text_or_screenshot_reported',
      optionalImageRefId: extraction.optionalImageRefId ?? null,
      imagePublicationApproved: Boolean(extraction.imagePublicationApproved === true),
      unreadableRegionsWarning: extraction.unreadableRegionsWarning,
    },
  };
}
