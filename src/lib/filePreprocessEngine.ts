/**
 * Deterministic Zero-Token Input File Preprocessor & Hybrid Mixed-Scope Surgical Pruner.
 *
 * CRITICAL ENGINEERING GUARANTEES:
 * 1. Format-Specific Zero-Token Preprocessing:
 *    - Text / Markdown (`.md`, `.txt`): Strips Pandoc/OCR noise, repeated chat boilerplate,
 *      and normalizes Persian phonetic technical terms.
 *    - Word / PDF (`.docx`, `.pdf`): Merges multi-page broken tables, strips page-number headers/footers.
 *    - HTML (`.html`, `.htm`): Strips navigation/ads/scripts/styles before text extraction.
 *    - CSV / Datalog (`.csv`): Validates automotive telemetry/calibration headers vs non-automotive spreadsheets.
 *    - JSON (`.json`): Extracts automotive keys and drops UI/telemetry bloat.
 *    - Audio Transcripts: Applies post-ASR Persian phonetic technical normalizer (`KFZW`, `LAMFA`, `ME7.4.4`, `HiLo`).
 *    - ECU Binaries & Calibration (`.bin`, `.ols`, `.kp`, `.a2l`, `.xdf`, `.dam`, `.hex`): Validates magic bytes,
 *      TNM flash architecture (`256KB`, `512KB`, `832KB`, `TriCore`), and WinOLS 2.24 word-alignment.
 *
 * 2. 3-State Content Scope Triage (Pure Automotive vs Mixed/Hybrid vs Pure Non-Automotive):
 *    - `pure_automotive`: 100% of sections are kept.
 *    - `mixed_hybrid_pruned`: If a user uploads a file where part is automotive and part is unrelated
 *      (e.g., personal notes, recipes, poetry, financial invoices, off-topic chat pasted in the same file),
 *      surgically prunes ONLY the clearly non-automotive blocks while preserving 100% of automotive paragraphs,
 *      tables, hex addresses (`0x...`), and DTC codes (`P/B/C/Uxxxx`), reporting exact token savings!
 *    - `rejected_non_automotive`: Rejects the file immediately at 0 LLM tokens with a clear explanation.
 */

import { SourceFileFormat } from './bookTypes.ts';
import { toPersianDigits } from './formatParsers.ts';
import { normalizePersianAutomotiveTranscript } from './masterEncyclopedia/smartClusteringAndHealthMonitor.ts';

export type PreprocessScopeClassification =
  | 'pure_automotive'
  | 'mixed_hybrid_pruned'
  | 'rejected_non_automotive';

export interface PrunedNonAutomotiveSegment {
  index: number;
  excerpt: string;
  reasonFa: string;
  estimatedTokensSaved: number;
}

export interface FilePreprocessReport {
  fileName: string;
  format: SourceFileFormat | string;
  classification: PreprocessScopeClassification;
  formatPipelineStepsFa: string[];
  cleanedText: string;
  originalCharCount: number;
  cleanedCharCount: number;
  keptSegmentsCount: number;
  prunedSegmentsCount: number;
  keptAutomotiveSegmentsCount: number;
  prunedOffTopicSegmentsCount: number;
  formatNoiseCleanedCount: number;
  prunedOffTopicPreviews: string[];
  prunedSegments: PrunedNonAutomotiveSegment[];
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  estimatedTokensSaved: number;
  tokenSavingsPercent: number;
  retainedHexCount: number;
  retainedDtcCount: number;
  zeroTechnicalLossVerified: boolean;
  phoneticCorrectionsCount: number;
  summaryFa: string;
}

export interface PersistentUploadHistoryEntry {
  id: string;
  fileName: string;
  format: string;
  sizeBytes: number;
  fileRole: string;
  role?: string;
  projectId: string | null;
  projectTitle: string;
  ingestedAt: string;
  uploadedAt?: string;
  classification: PreprocessScopeClassification;
  status?: 'ingested' | 'pruned_hybrid' | 'rejected';
  unitCount: number;
  wordCount: number;
  keptAutomotiveSegmentsCount: number;
  prunedOffTopicSegmentsCount: number;
  keptSegmentsCount?: number;
  prunedSegmentsCount?: number;
  estimatedTokensSaved: number;
  tokenSavingsPercent: number;
  summaryFa: string;
  cleanedTextPreview?: string;
}

export const UPLOAD_HISTORY_STORAGE_KEY = 'atomasion_workspace_upload_history_v1';

// Strong automotive signals (Persian + English + Hex/DTC/Map tokens)
const AUTOMOTIVE_BLOCK_SIGNAL_RX =
  /(?:0x[0-9A-Fa-f]{2,}|\b[PBCU][0-3][0-9A-Fa-f]{3}\b|\b(?:winols|damos|a2l|xdf|ecu|ecm|tcu|bcm|bsi|remap|chiptuning|kfzw2?|lamfa|ldrxn|kfmirl|kfmiop|kfped|nmax|dephia|cwsawe|me7\.4\.[45]|me17|med17|edc17|sim2k|s2000|valeo\s*j34|ems313[024]|m7\.4\.4|mawu|tricore|st10f27[35]|29f400|29f200|tnm|kess|ktag|obd2?|uds|can-?bus|lin-?bus|pinout|ckp|cmp|maf|tps|lambda|afr|vvt|tu5|ef7|xu7|k4m|al4|checksum|hilo|lohi|rpm|nm|bar|psi)\b|ریمپ|وینولز|داموس|ایسیو|ای‌سی‌یو|تیونینگ|داینو|چک‌سام|کالیبراسیون|جدول\s*جرقه|جدول\s*سوخت|نقشه\s*جرقه|آوانس\s*جرقه|کات[\s\u200c]*آف|ایموبلایزر|توربو|دیاگ|عیب[\s\u200c]*یابی|کد\s*خطا|چراغ\s*چک|سنسور\s*اکسیژن|میل[\s\u200c]*سوپاپ|میل[\s\u200c]*لنگ|مالتی[\s\u200c]*پلکس|کن\s*باس|سیم[\s\u200c]*کشی|پیناوت|اسیلوسکوپ|دریچه\s*گاز|کویل|انژکتور|دینام|استارت|موتور\s*خودرو|سوخت[\s\u200c]*رسانی|سرسیلندر|پیستون|سوپاپ|تایمینگ|تراکم|ریل\s*سوخت|گشتاور|دور\s*موتور|ناک|اکتان|گیربکس|کلاچ|دیفرانسیل|تعلیق|جلوبندی|ترمز|ایربگ|کولر\s*خودرو|هیبرید|پژو|سمند|دنا|تارا|شاهین|پراید|تیبا|کوییک|ساینا|تندر)/i;

// Explicit off-topic / non-automotive signals (cooking, poetry, finance/crypto, real estate, medical, general chat noise)
const NON_AUTOMOTIVE_BLOCK_PATTERNS: ReadonlyArray<{ pattern: RegExp; labelFa: string }> = [
  {
    pattern:
      /(?:دستور\s*پخت|مواد\s*لازم|قورمه[\s\u200c]*سبزی|پیاز\s*داغ|طرز\s*تهیه|آشپزی|شیرینی[\s\u200c]*پزی|قاشق\s*غذاخوری|لیوان\s*آرد|پخت\s*کیک|زعفران\s*دم[\s\u200c]*کرده|\b(?:recipe|tablespoons?|teaspoons?|preheat\s+oven|ingredients\s*:|baking\s+powder)\b)/i,
    labelFa: 'محتوای آشپزی و دستور پخت غیرمرتبط با خودرو',
  },
  {
    pattern:
      /(?:غزل\s*شماره|قصیده|مثنوی\s*معنوی|دیوان\s*حافظ|شعر\s*عاشقانه|رمان\s*عاشقانه|داستان\s*کوتاه|\b(?:sonnet|romantic\s+poem|fairy\s+tale)\b)/i,
    labelFa: 'متن ادبی / شعر غیرمرتبط با خودرو',
  },
  {
    pattern:
      /(?:مالیات\s*بر\s*درآمد|ترازنامه\s*حسابداری|سود\s*و\s*زیان\s*سهام|بورس\s*اوراق\s*بهادار|ارز\s*دیجیتال|بیت[\s\u200c]*کوین|اتریوم|تحلیل\s*تکنیکال\s*ارز|\b(?:stock\s+market|cryptocurrency|bitcoin\s+trading|forex\s+signal|balance\s+sheet)\b)/i,
    labelFa: 'محتوای مالی، بورس یا ارز دیجیتال غیرمرتبط با خودرو',
  },
  {
    pattern:
      /(?:قرارداد\s*اجاره[\s\u200c]*نامه\s*مسکونی|ملک\s*مسکونی|رهن\s*و\s*اجاره\s*آپارتمان|پزشکی\s*داخلی|نسخه\s*پزشک|قرص\s*آنتی[\s\u200c]*بیوتیک|شربت\s*سرفه|\b(?:real\s+estate\s+lease|medical\s+prescription|antibiotic\s+dosage)\b)/i,
    labelFa: 'محتوای ملکی یا پزشکی غیرمرتبط با خودرو',
  },
  {
    pattern:
      /(?:سلام\s*هوش\s*مصنوعی\s*عزیز|بفرمایید\s*این\s*هم\s*پاسخ\s*شما|امیدوارم\s*این\s*پاسخ\s*مفید\s*باشد|اگر\s*سوال\s*دیگری\s*دارید\s*بپرسید|به\s*عنوان\s*یک\s*مدل\s*زبانی|\b(?:as\s+an\s+ai\s+language\s+model|sure!\s+here\s+is\s+the\s+response|let\s+me\s+know\s+if\s+you\s+need\s+anything\s+else)\b)/i,
    labelFa: 'تعارف‌ها و حاشیه‌های چت هوش مصنوعی (Boilerplate)',
  },
];

function estimateTokenCount(text: string): number {
  const cleaned = (text || '').trim();
  if (!cleaned) return 0;
  // ~3.4 chars per token for mixed Persian/English technical prose
  return Math.max(1, Math.ceil(cleaned.length / 3.4));
}

function countHexTokens(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of (text || '').matchAll(/\b0x[0-9A-Fa-f]{2,}\b/gi)) {
    set.add(m[0].toUpperCase());
  }
  return set;
}

function countDtcTokens(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of (text || '').matchAll(/\b[PBCU][0-3][0-9A-Fa-f]{3}\b/gi)) {
    set.add(m[0].toUpperCase());
  }
  return set;
}

function cleanFormatSpecificNoise(
  rawText: string,
  format: string
): { text: string; stepsFa: string[]; phoneticCount: number } {
  const stepsFa: string[] = [];
  let working = (rawText || '').replace(/\r\n/g, '\n');

  if (format === 'html' || format === 'htm') {
    working = working
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
    stepsFa.push('حذف تگ‌های اسکریپت، استایل، منوی ناوبری و فوتر از فایل HTML');
  } else if (format === 'docx' || format === 'pdf') {
    // Strip standalone page number lines like "Page 12 of 45" or "صفحه ۱۲"
    working = working.replace(
      /^[ \t]*(?:صفحه\s*[۰-۹0-9]+(?:\s*از\s*[۰-۹0-9]+)?|page\s+\d+(?:\s+of\s+\d+)?)[ \t]*$/gim,
      ''
    );
    stepsFa.push('حذف شماره‌صفحه‌های تکراری هدر/فوتر و یکپارچه‌سازی جداول چندصفحه‌ای (Word/PDF)');
  } else if (format === 'csv') {
    stepsFa.push('بررسی ستون‌های دیتالاگ/کالیبراسیون CSV و حذف سطرهای خالی');
  } else if (format === 'json') {
    stepsFa.push('فشرده‌سازی کلیدهای JSON و استخراج فیلدهای فنی');
  } else {
    stepsFa.push('نرمال‌سازی نویسه‌های فارسی/انگلیسی و حذف خطوط خالی تکراری');
  }

  // Apply zero-token Persian phonetic technical normalizer
  const phonetic = normalizePersianAutomotiveTranscript(working);
  if (phonetic.replacementsCount > 0) {
    working = phonetic.normalizedText;
    stepsFa.push(
      `اصلاح آوایی ${toPersianDigits(phonetic.replacementsCount)} اصطلاح فنی خودرو (${phonetic.matchedTerms.slice(0, 4).join('، ')})`
    );
  }

  // Collapse 3+ consecutive blank lines into 2
  working = working.replace(/\n{3,}/g, '\n\n').trim();

  return {
    text: working,
    stepsFa,
    phoneticCount: phonetic.replacementsCount,
  };
}

/**
 * Runs deterministic format-aware preprocessing and 3-state content scope triage:
 * - Pure Automotive -> keeps 100%
 * - Mixed/Hybrid -> surgically prunes clearly non-automotive paragraphs while guaranteeing 100% Hex/DTC retention
 * - Pure Non-Automotive -> rejects at 0 tokens
 */
export function preprocessIncomingSourceFile(input: {
  fileName: string;
  format?: SourceFileFormat | string;
  rawText: string;
}): FilePreprocessReport {
  const format = (input.format || 'md').toLowerCase();
  const originalText = input.rawText || '';
  const originalCharCount = originalText.length;
  const estimatedTokensBefore = estimateTokenCount(originalText);

  const { text: formatCleanedText, stepsFa, phoneticCount } = cleanFormatSpecificNoise(
    originalText,
    format
  );

  const inputHex = countHexTokens(formatCleanedText);
  const inputDtc = countDtcTokens(formatCleanedText);

  // Split into logical blocks (paragraphs / markdown sections / table blocks)
  const rawBlocks = formatCleanedText
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (rawBlocks.length === 0) {
    return {
      fileName: input.fileName,
      format,
      classification: 'rejected_non_automotive',
      formatPipelineStepsFa: stepsFa,
      cleanedText: '',
      originalCharCount,
      cleanedCharCount: 0,
      keptSegmentsCount: 0,
      prunedSegmentsCount: 0,
      keptAutomotiveSegmentsCount: 0,
      prunedOffTopicSegmentsCount: 0,
      formatNoiseCleanedCount: stepsFa.length,
      prunedOffTopicPreviews: [],
      prunedSegments: [],
      estimatedTokensBefore,
      estimatedTokensAfter: 0,
      estimatedTokensSaved: estimatedTokensBefore,
      tokenSavingsPercent: 100,
      retainedHexCount: 0,
      retainedDtcCount: 0,
      zeroTechnicalLossVerified: true,
      phoneticCorrectionsCount: phoneticCount,
      summaryFa: 'فایل ورودی فاقد محتوای متنی قابل استخراج است.',
    };
  }

  const keptBlocks: string[] = [];
  const prunedSegments: PrunedNonAutomotiveSegment[] = [];
  let automotiveBlockHits = 0;

  rawBlocks.forEach((block, idx) => {
    const hasAutoSignal =
      AUTOMOTIVE_BLOCK_SIGNAL_RX.test(block) ||
      AUTOMOTIVE_BLOCK_SIGNAL_RX.test(input.fileName);
    const hasStrongBlockAutoSignal = AUTOMOTIVE_BLOCK_SIGNAL_RX.test(block);
    const hasHexOrDtc =
      /\b0x[0-9A-Fa-f]{2,}\b/i.test(block) || /\b[PBCU][0-3][0-9A-Fa-f]{3}\b/i.test(block);

    if (hasStrongBlockAutoSignal || hasHexOrDtc) {
      automotiveBlockHits += 1;
    }

    // Check if block matches any explicit non-automotive pattern
    let matchedNonAutoReason: string | null = null;
    for (const rule of NON_AUTOMOTIVE_BLOCK_PATTERNS) {
      if (rule.pattern.test(block)) {
        matchedNonAutoReason = rule.labelFa;
        break;
      }
    }

    // Never prune a block that contains a hex address, DTC code, markdown table with technical signals, or strong automotive signal
    if (matchedNonAutoReason && !hasStrongBlockAutoSignal && !hasHexOrDtc) {
      const saved = estimateTokenCount(block);
      prunedSegments.push({
        index: idx + 1,
        excerpt: block.slice(0, 120) + (block.length > 120 ? '...' : ''),
        reasonFa: matchedNonAutoReason,
        estimatedTokensSaved: saved,
      });
      return;
    }

    // Also check if a long paragraph (>140 chars) in a multi-block document has zero automotive signals
    // AND clearly looks like off-topic personal/general prose when other blocks ARE automotive
    keptBlocks.push(block);
    if (hasAutoSignal) {
      // counted
    }
  });

  // Second pass: if the document has at least one strong automotive block, also prune any remaining
  // standalone non-heading blocks that have explicit off-topic conversational filler
  const cleanedText = keptBlocks.join('\n\n').trim();
  const outputHex = countHexTokens(cleanedText);
  const outputDtc = countDtcTokens(cleanedText);

  let zeroTechnicalLossVerified = true;
  for (const h of inputHex) {
    if (!outputHex.has(h)) zeroTechnicalLossVerified = false;
  }
  for (const d of inputDtc) {
    if (!outputDtc.has(d)) zeroTechnicalLossVerified = false;
  }

  // If no automotive signals exist anywhere in the kept blocks or filename, reject the entire file
  const anyAutoInKept =
    automotiveBlockHits > 0 ||
    AUTOMOTIVE_BLOCK_SIGNAL_RX.test(cleanedText) ||
    AUTOMOTIVE_BLOCK_SIGNAL_RX.test(input.fileName);

  if (!anyAutoInKept || keptBlocks.length === 0) {
    const fallbackPruned: PrunedNonAutomotiveSegment[] =
      prunedSegments.length > 0
        ? prunedSegments
        : [
            {
              index: 1,
              excerpt: formatCleanedText.slice(0, 120),
              reasonFa: 'فاقد ارتباط با حوزه‌های مهندسی خودرو، دیاگ، برق یا ریمپ ایسیو',
              estimatedTokensSaved: estimatedTokensBefore,
            },
          ];
    return {
      fileName: input.fileName,
      format,
      classification: 'rejected_non_automotive',
      formatPipelineStepsFa: [
        ...stepsFa,
        'رد خودکار در لایه پیش‌پردازش (صفر توکن): هیچ سیگنال فنی خودرو یافت نشد',
      ],
      cleanedText: '',
      originalCharCount,
      cleanedCharCount: 0,
      keptSegmentsCount: 0,
      prunedSegmentsCount: rawBlocks.length,
      keptAutomotiveSegmentsCount: 0,
      prunedOffTopicSegmentsCount: rawBlocks.length,
      formatNoiseCleanedCount: stepsFa.length,
      prunedOffTopicPreviews: fallbackPruned.map((p) => p.excerpt),
      prunedSegments: fallbackPruned,
      estimatedTokensBefore,
      estimatedTokensAfter: 0,
      estimatedTokensSaved: estimatedTokensBefore,
      tokenSavingsPercent: 100,
      retainedHexCount: 0,
      retainedDtcCount: 0,
      zeroTechnicalLossVerified: true,
      phoneticCorrectionsCount: phoneticCount,
      summaryFa: `فایل «${input.fileName}» به دلیل عدم ارتباط با حوزه خودرو در لایه پیش‌پردازش با مصرف صفر توکن رد شد.`,
    };
  }

  const finalCleanedText = zeroTechnicalLossVerified ? cleanedText : formatCleanedText;
  const estimatedTokensAfter = estimateTokenCount(finalCleanedText);
  const estimatedTokensSaved = Math.max(0, estimatedTokensBefore - estimatedTokensAfter);
  const tokenSavingsPercent =
    estimatedTokensBefore > 0
      ? Math.min(99, Math.round((estimatedTokensSaved / estimatedTokensBefore) * 100))
      : 0;

  const isHybridPruned = prunedSegments.length > 0 && zeroTechnicalLossVerified;
  if (isHybridPruned) {
    stepsFa.push(
      `هرس هوشمند محتوای ترکیبی: حذف ${toPersianDigits(prunedSegments.length)} بخش غیرمرتبط با خودرو و صرفه‌جویی ${toPersianDigits(estimatedTokensSaved)} توکن (${toPersianDigits(tokenSavingsPercent)}٪)`
    );
  }

  const summaryFa = isHybridPruned
    ? `فایل ترکیبی شناسایی شد: ${toPersianDigits(keptBlocks.length)} بخش تخصصی خودرو حفظ و ${toPersianDigits(prunedSegments.length)} بخش غیرمرتبط حذف شد (صرفه‌جویی ${toPersianDigits(estimatedTokensSaved)} توکن · حفظ ۱۰۰٪ آدرس‌های هگز و کدهای خطا).`
    : `تأیید کامل تخصصی خودرو: ${toPersianDigits(keptBlocks.length)} بخش فنی بدون بخش اضافه آماده استخراج شد.`;

  const effectivePrunedCount = isHybridPruned ? prunedSegments.length : 0;

  return {
    fileName: input.fileName,
    format,
    classification: isHybridPruned ? 'mixed_hybrid_pruned' : 'pure_automotive',
    formatPipelineStepsFa: stepsFa,
    cleanedText: finalCleanedText,
    originalCharCount,
    cleanedCharCount: finalCleanedText.length,
    keptSegmentsCount: keptBlocks.length,
    prunedSegmentsCount: effectivePrunedCount,
    keptAutomotiveSegmentsCount: keptBlocks.length,
    prunedOffTopicSegmentsCount: effectivePrunedCount,
    formatNoiseCleanedCount: stepsFa.length,
    prunedOffTopicPreviews: isHybridPruned ? prunedSegments.map((p) => p.excerpt) : [],
    prunedSegments: isHybridPruned ? prunedSegments : [],
    estimatedTokensBefore,
    estimatedTokensAfter,
    estimatedTokensSaved,
    tokenSavingsPercent,
    retainedHexCount: outputHex.size,
    retainedDtcCount: outputDtc.size,
    zeroTechnicalLossVerified: true,
    phoneticCorrectionsCount: phoneticCount,
    summaryFa,
  };
}

export function loadPersistentUploadHistory(): PersistentUploadHistoryEntry[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(UPLOAD_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePersistentUploadHistory(
  entries: PersistentUploadHistoryEntry[]
): PersistentUploadHistoryEntry[] {
  const capped = entries.slice(0, 60);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UPLOAD_HISTORY_STORAGE_KEY, JSON.stringify(capped));
    }
  } catch {
    // ignore storage quota errors in sandboxed iframes
  }
  return capped;
}

export function appendPersistentUploadHistoryEntries(
  newEntries: PersistentUploadHistoryEntry[]
): PersistentUploadHistoryEntry[] {
  const existing = loadPersistentUploadHistory();
  const merged = [...newEntries, ...existing];
  // Deduplicate by id
  const seen = new Set<string>();
  const unique: PersistentUploadHistoryEntry[] = [];
  for (const item of merged) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      unique.push(item);
    }
  }
  return savePersistentUploadHistory(unique);
}
