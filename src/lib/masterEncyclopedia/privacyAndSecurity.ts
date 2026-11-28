/**
 * Privacy, Security, Indirect Prompt Injection Defense, PII Sanitizer with Technical Allowlist,
 * VIN Last-6 Serial Masking, and Copyright N-Gram Shield for the Master Automotive Encyclopedia.
 */

// ============================================================================
// 1. INDIRECT PROMPT INJECTION DEFENSE & DATA QUARANTINE
// ============================================================================

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: 'ignore_previous_instructions',
    regex: /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|system)\s+instructions?\b/i,
  },
  {
    label: 'override_system_prompt',
    regex: /\b(?:override|reveal|print|dump|leak|disclose)\s+(?:the\s+|your\s+)?(?:system\s+prompt|hidden\s+instructions?|developer\s+message)\b/i,
  },
  {
    label: 'role_hijack_tokens',
    regex: /(?:<\|(?:system|im_start|assistant|developer)\|>|^\s*#{1,3}\s*(?:SYSTEM|DEVELOPER)\s*(?:PROMPT|INSTRUCTION)\s*:)/im,
  },
  {
    label: 'jailbreak_directive',
    regex: /\b(?:you\s+are\s+now\s+(?:DAN|unrestricted|in\s+developer\s+mode)|act\s+as\s+an?\s+unfiltered\s+ai|bypass\s+all\s+safety)\b/i,
  },
  {
    label: 'persian_prompt_injection',
    regex: /(?:دستورات?\s+(?:قبلی|سیستم|بالا)\s+را\s+(?:نادیده\s+بگیر|فراموش\s+کن|لغو\s+کن)|پرامپت\s+سیستم\s+را\s+(?:چاپ|نمایش|افشا)\s+کن|تمام\s+قوانین\s+قبلی\s+را\s+لغو)/i,
  },
  {
    label: 'destructive_db_command',
    regex: /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM\s+master_|UPDATE\s+master_)\b/i,
  },
];

export interface PromptInjectionScanResult {
  suspicious: boolean;
  quarantined: boolean;
  matchedSignals: string[];
  sanitizedText: string;
}

export function detectIndirectPromptInjection(rawText: string): PromptInjectionScanResult {
  const matchedSignals: string[] = [];
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    if (rule.regex.test(rawText)) {
      matchedSignals.push(rule.label);
    }
  }

  if (matchedSignals.length === 0) {
    return {
      suspicious: false,
      quarantined: false,
      matchedSignals: [],
      sanitizedText: rawText,
    };
  }

  // Neutralize injection lines while preserving surrounding technical lines in quarantine
  const lines = rawText.split(/\r?\n/);
  const cleanedLines = lines.filter((line) => {
    return !PROMPT_INJECTION_PATTERNS.some((rule) => rule.regex.test(line));
  });

  return {
    suspicious: true,
    quarantined: true,
    matchedSignals,
    sanitizedText: cleanedLines.join('\n').trim(),
  };
}

/**
 * Wraps untrusted extracted text in explicit XML data boundaries before any LLM prompt.
 * Neutralizes any attempt to close the boundary tag prematurely inside the user text.
 */
export function wrapUntrustedSourceData(rawText: string): string {
  const escaped = rawText.replace(
    /<\s*(\/?)\s*untrusted_source_data(?:\s+[^>]*)?\s*>/gi,
    (_m, slash: string) => `&lt;${slash}untrusted_source_data&gt;`
  );
  return `<untrusted_source_data>\n${escaped}\n</untrusted_source_data>`;
}

// ============================================================================
// 2. PII SANITIZER WITH AUTOMOTIVE TECHNICAL ALLOWLIST + VIN SERIAL MASKING
// ============================================================================

const PERSIAN_DIGIT_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGIT_MAP[ch] ?? ch);
}

/**
 * Identifies 10-digit automotive ECU / OEM part numbers & software IDs that MUST NEVER be stripped
 * as Iranian national IDs (کد ملی):
 * - Bosch 10-digit part numbers: 0261xxxxxx, 0281xxxxxx, 0265xxxxxx, 0280xxxxxx, 0227xxxxxx, 0232xxxxxx, 0986xxxxxx
 * - Bosch SW numbers: 1037xxxxxx, 1039xxxxxx
 * - PSA / Sagem / Valeo / Continental 10-digit OEM numbers: 96xxxxxxxx, 98xxxxxxxx
 * - Context-prefixed technical IDs: HW, SW, Bosch, Siemens, Part, P/N, ECU, Ref, شماره فنی
 */
export function isTechnicalAutomotivePartNumber(
  digits10: string,
  surroundingContext: string
): boolean {
  const d = toAsciiDigits(digits10);
  if (!/^\d{10}$/.test(d)) return false;

  // Known OEM 10-digit prefixes
  if (
    /^(?:0261|0281|0265|0280|0227|0232|0242|0258|0986|1037|1039|96\d{2}|98\d{2})\d{6}$/.test(d)
  ) {
    return true;
  }

  // Preceded by explicit technical hardware/software context
  if (
    /(?:bosch|siemens|continental|valeo|sagem|marelli|delphi|denso|ecu|hw|sw|part\s*(?:no|num|number)?|p\/n|oem|calib|calibration|شماره\s*فنی|پارت\s*نامبر|سخت‌افزار|نرم‌افزار)\s*[:#\-]?\s*$/i.test(
      surroundingContext
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Standard Iranian National ID (کد ملی) checksum validation to minimize false positives
 * on arbitrary technical 10-digit numbers.
 */
export function isValidIranianNationalIdChecksum(digits10: string): boolean {
  const d = toAsciiDigits(digits10);
  if (!/^\d{10}$/.test(d)) return false;
  if (/^(\d)\1{9}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(d[i]) * (10 - i);
  }
  const rem = sum % 11;
  const check = Number(d[9]);
  return rem < 2 ? check === rem : check === 11 - rem;
}

export interface PiiSanitizationResult {
  sanitizedText: string;
  redactionCounts: {
    emails: number;
    phones: number;
    licensePlates: number;
    nationalIds: number;
    customerNames: number;
    userIds: number;
    vinSerialsMasked: number;
  };
  preservedTechnicalTokensCount: number;
}

export function sanitizePiiWithAutomotiveAllowlist(rawText: string): PiiSanitizationResult {
  const counts = {
    emails: 0,
    phones: 0,
    licensePlates: 0,
    nationalIds: 0,
    customerNames: 0,
    userIds: 0,
    vinSerialsMasked: 0,
  };
  let preservedTechnicalTokensCount = 0;

  let text = rawText;

  // 1. Mask ONLY the last 6 serial digits of 17-character ISO 3779 VINs (preserving 11-char WMI+VDS)
  // ISO 3779 VIN excludes I, O, Q and ends with 6 serial characters (usually digits, last 4 always digits)
  text = text.replace(
    /\b([A-HJ-NPR-Z0-9]{11})([A-HJ-NPR-Z0-9]{2}\d{4})\b/gi,
    (fullMatch, wmiVds: string, _serial: string) => {
      const upperWmi = wmiVds.toUpperCase();
      // Must contain at least one letter and one digit to avoid plain 17-digit numbers or pure words
      if (!/[A-Z]/.test(upperWmi) || !/\d/.test(fullMatch)) {
        return fullMatch;
      }
      counts.vinSerialsMasked += 1;
      preservedTechnicalTokensCount += 1;
      return `${upperWmi}XXXXXX`;
    }
  );

  // 2. Emails
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => {
    counts.emails += 1;
    return '[ایمیل حذف‌شده]';
  });

  // 3. Iranian mobile numbers (+989xxxxxxxxx, 00989..., 09xxxxxxxxx, Persian digits too)
  text = text.replace(
    /(?:\+98|0098|0|۰)(?:9|۹)[0-9۰-۹]{2}[\s\-]?[0-9۰-۹]{3}[\s\-]?[0-9۰-۹]{4}\b/g,
    () => {
      counts.phones += 1;
      return '[تلفن حذف‌شده]';
    }
  );

  // 4. Iranian landline numbers with explicit phone label (e.g. تلفن: 021-88776655)
  text = text.replace(
    /(?:تلفن|تماس|موبایل|شماره\s*تماس|phone|tel|mobile)\s*[:：\-]?\s*(?:0|۰)?[1-8۱-۸][0-9۰-۹]{1,2}[\s\-]?[0-9۰-۹]{7,8}\b/gi,
    () => {
      counts.phones += 1;
      return '[تلفن حذف‌شده]';
    }
  );

  // 5. Iranian license plates (e.g. 12 ب 345 ایران 66 or ۱۲ب۳۴۵-۶۶ or پلاک: 44 ج 512 11)
  text = text.replace(
    /(?:پلاک(?:\s*خودرو)?\s*[:：\-]?\s*)?\b[0-9۰-۹]{2}\s*[ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی]\s*[0-9۰-۹]{3}(?:\s*(?:ایران|[-–/])\s*[0-9۰-۹]{2})?\b/gi,
    () => {
      counts.licensePlates += 1;
      return '[پلاک حذف‌شده]';
    }
  );

  // 6. Customer / Owner names after explicit personal labels
  text = text.replace(
    /((?:نام\s*مشتری|نام\s*و\s*نام\s*خانوادگی|مالک\s*خودرو|نام\s*مالک|تحویل‌گیرنده|customer\s*name|owner\s*name|client\s*name)\s*[:：\-]\s*)([^\n\r,;،؛]{2,50})/gi,
    (_m, label: string) => {
      counts.customerNames += 1;
      return `${label}[نام حذف‌شده]`;
    }
  );

  // 7. User IDs / Session IDs
  text = text.replace(
    /\b(?:user_id|uid|session_id|owner_uid|شناسه\s*کاربر)\s*[:：=]\s*[A-Za-z0-9_\-.]{4,64}\b/gi,
    () => {
      counts.userIds += 1;
      return '[شناسه کاربر حذف‌شده]';
    }
  );

  // 8. 10-digit Iranian National IDs (کد ملی) — STRICTLY respecting Technical Allowlist!
  // Case A: Explicitly labeled National ID (supports continuous 10 digits or hyphenated/spaced 001-234567-8)
  text = text.replace(
    /((?:کد\s*ملی|کدملی|شماره\s*ملی|national\s*id)\s*[:：\-]?\s*)([0-9۰-۹]{3}[\s\-]?[0-9۰-۹]{6}[\s\-]?[0-9۰-۹])\b/gi,
    (fullMatch, label: string, digitsRaw: string, offset: number, source: string) => {
      const digits = digitsRaw.replace(/[\s\-]/g, '');
      const ctx = source.slice(Math.max(0, offset - 40), offset);
      if (isTechnicalAutomotivePartNumber(digits, ctx)) {
        preservedTechnicalTokensCount += 1;
        return fullMatch;
      }
      counts.nationalIds += 1;
      return `${label}[کد ملی حذف‌شده]`;
    }
  );

  // Case B: Unlabeled standalone 10-digit numbers that pass Iranian National ID checksum
  // AND are NOT in the automotive technical allowlist (Bosch/Siemens/HW/SW/OEM part numbers)
  text = text.replace(
    /(?<![0-9A-Za-z۰-۹xX])([0-9۰-۹]{10})(?![0-9A-Za-z۰-۹])/g,
    (fullMatch, digits: string, offset: number, source: string) => {
      const ctx = source.slice(Math.max(0, offset - 48), offset);
      if (isTechnicalAutomotivePartNumber(digits, ctx)) {
        preservedTechnicalTokensCount += 1;
        return fullMatch;
      }
      if (isValidIranianNationalIdChecksum(digits)) {
        counts.nationalIds += 1;
        return '[کد ملی حذف‌شده]';
      }
      return fullMatch;
    }
  );

  return {
    sanitizedText: text,
    redactionCounts: counts,
    preservedTechnicalTokensCount,
  };
}

// ============================================================================
// 3. COPYRIGHT SHIELD (DETERMINISTIC N-GRAM VERBATIM OVERLAP GUARD)
// ============================================================================

function tokenizeForNgrams(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u200c\u200f\u200e\u2066-\u2069]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function buildNgramSet(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  if (tokens.length < n) return out;
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

export interface CopyrightOverlapReport {
  isVerbatimViolation: boolean;
  overlapRatio: number;
  matchedNgrams: number;
  totalCandidateNgrams: number;
  longestVerbatimRunWords: number;
}

/**
 * Deterministic n-gram overlap guard preventing verbatim copying of long source paragraphs
 * into the Master Encyclopedia. Short technical definitions, tables, or formulas (< 24 words)
 * are allowed; longer rewritten passages must remain below overlap thresholds.
 */
export function checkCopyrightVerbatimOverlap(
  rawSourceText: string,
  candidateEncyclopediaText: string,
  options?: { ngramSize?: number; maxOverlapRatio?: number; maxVerbatimRunWords?: number }
): CopyrightOverlapReport {
  const n = options?.ngramSize ?? 8;
  const maxOverlapRatio = options?.maxOverlapRatio ?? 0.35;
  const maxVerbatimRunWords = options?.maxVerbatimRunWords ?? 28;

  const srcTokens = tokenizeForNgrams(rawSourceText);
  const candTokens = tokenizeForNgrams(candidateEncyclopediaText);

  if (candTokens.length < 24 || srcTokens.length < n) {
    return {
      isVerbatimViolation: false,
      overlapRatio: 0,
      matchedNgrams: 0,
      totalCandidateNgrams: Math.max(0, candTokens.length - n + 1),
      longestVerbatimRunWords: 0,
    };
  }

  const srcNgrams = buildNgramSet(srcTokens, n);
  const totalCandidateNgrams = candTokens.length - n + 1;
  let matchedNgrams = 0;
  let currentRun = 0;
  let maxRun = 0;

  for (let i = 0; i <= candTokens.length - n; i++) {
    const gram = candTokens.slice(i, i + n).join(' ');
    if (srcNgrams.has(gram)) {
      matchedNgrams += 1;
      currentRun = currentRun === 0 ? n : currentRun + 1;
      if (currentRun > maxRun) maxRun = currentRun;
    } else {
      currentRun = 0;
    }
  }

  const overlapRatio = totalCandidateNgrams > 0 ? matchedNgrams / totalCandidateNgrams : 0;
  const isVerbatimViolation =
    overlapRatio > maxOverlapRatio || maxRun >= maxVerbatimRunWords;

  return {
    isVerbatimViolation,
    overlapRatio: Number(overlapRatio.toFixed(4)),
    matchedNgrams,
    totalCandidateNgrams,
    longestVerbatimRunWords: maxRun,
  };
}
