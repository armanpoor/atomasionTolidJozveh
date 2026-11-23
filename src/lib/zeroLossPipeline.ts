import type {
  ChapterNode,
  ConflictDto,
  ContentBlock,
  ContentUnitDto,
  DedupClusterDto,
  DiagramBlock,
  DocxExportConfig,
  FileRole,
  OutlineNodeDto,
  ParsedBook,
  SectionNode,
  SourceFileDto,
  TableBlock,
  WorkflowMode,
} from './bookTypes.ts';
import { buildDiagramSvg } from './diagramRenderer.ts';
import {
  hasDisjointEcuPlatforms,
  mergeCompatibleTablesLossless,
  runTechnicalEntityIntegrityAudit,
} from './ecuTechnicalIntegrity.ts';
import { toAsciiDigits, toPersianDigits } from './formatParsers.ts';
import { analyzeNumericDiscrepancies } from './numericDiscrepancyAnalyzer.ts';
import { analyzeWinolsGoogleEnrichment, extractWinolsMapGuides } from './winolsMapGuide.ts';

// ============================================================================
// DETERMINISTIC NORMALIZATION, HASHING & TOKEN SIMILARITY
// ============================================================================

const PERSIAN_STOP_WORDS = new Set([
  'در',
  'به',
  'از',
  'که',
  'این',
  'آن',
  'است',
  'را',
  'با',
  'برای',
  'می',
  'شود',
  'شده',
  'های',
  'یا',
  'و',
  'تا',
  'بر',
  'یک',
  'هم',
  'نیز',
  'اما',
  'اگر',
  'باید',
  'می‌شود',
  'می‌کند',
  'فصل',
  'بخش',
]);

export function normalizePersianForComparison(input: string): string {
  return toAsciiDigits(input)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s.%/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function deterministicHash(input: string): string {
  // FNV-1a 64-bit-like dual 32-bit hex digest (pure JS, works identically in Node & Browser)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function tokenizeContent(text: string): string[] {
  return normalizePersianForComparison(text)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !PERSIAN_STOP_WORDS.has(w));
}

export function computeJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function extractNumericFacts(text: string): string[] {
  const ascii = toAsciiDigits(text);
  const matches = ascii.match(/\d+(?:[.,]\d+)?(?:\s*(?:%|درصد|کیلوگرم|متر|سانتی‌متر|میلی‌متر|بار|psi|rpm|بار|درجه|ساعت|دقیقه|ثانیه|تومان|ریال|دلار|مگابایت|گیگابایت|ولت|آمپر|وات|اسب|کیلووات))?/gi);
  return matches ? matches.map((m) => m.trim().toLowerCase()) : [];
}

// ============================================================================
// STAGE 1: ATOMIC CONTENT UNIT EXTRACTION
// ============================================================================

export interface ExtractedAtomicUnit {
  id: string;
  projectId: string;
  sourceFileId: string;
  unitOrder: number;
  unitType: string;
  headingPath: string;
  rawText: string;
  normalizedHash: string;
  status: string;
  metadataJson: Record<string, unknown>;
}

function blockToPlainText(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':
      return block.text;
    case 'subheading':
      return block.text;
    case 'list':
      return block.items.map((it, i) => (block.ordered ? `${i + 1}. ${it}` : `- ${it}`)).join('\n');
    case 'callout':
      return `${block.title}\n${block.paragraphs.join('\n')}`;
    case 'table':
      return [
        block.caption || '',
        block.headers.join(' | '),
        ...block.rows.map((r) => r.join(' | ')),
      ]
        .filter(Boolean)
        .join('\n');
    case 'equation':
      return block.readable || block.latex;
    case 'figure':
      return `${block.caption}: ${block.description}`;
    case 'image':
      return `[تصویر] ${block.caption}`;
    case 'diagram':
      return `${block.title}: ${block.items.map((i) => i.label).join('، ')}`;
    case 'web_enrichment':
      return `${block.title}: ${block.summary}`;
    case 'conflict_note':
      return `${block.topic}: ${block.excerptA} / ${block.excerptB}`;
  }
}

export function extractAtomicUnitsFromBook(params: {
  projectId: string;
  sourceFileId: string;
  fileName: string;
  fileRole: FileRole;
  book: ParsedBook;
  startingOrder?: number;
}): ExtractedAtomicUnit[] {
  const units: ExtractedAtomicUnit[] = [];
  let order = params.startingOrder ?? 0;

  const pushBlock = (block: ContentBlock, headingPath: string) => {
    const rawText = blockToPlainText(block).trim();
    if (!rawText) return;
    order += 1;
    const norm = normalizePersianForComparison(rawText);
    const hash = deterministicHash(`${block.type}::${norm}`);
    units.push({
      id: `u_${params.sourceFileId}_${order}`,
      projectId: params.projectId,
      sourceFileId: params.sourceFileId,
      unitOrder: order,
      unitType: block.type,
      headingPath,
      rawText,
      normalizedHash: hash,
      status: 'active',
      metadataJson: {
        fileName: params.fileName,
        fileRole: params.fileRole,
        block,
      },
    });
  };

  for (const ch of params.book.chapters) {
    const chCleanTitle = ch.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '').trim() || ch.title;
    for (const block of ch.introBlocks) {
      pushBlock(block, chCleanTitle);
    }
    for (const sec of ch.sections) {
      const secTitle = sec.title.trim();
      const headingPath = secTitle ? `${chCleanTitle} > ${secTitle}` : chCleanTitle;
      for (const block of sec.blocks) {
        pushBlock(block, headingPath);
      }
    }
  }

  return units;
}

// ============================================================================
// STAGE 2: TWO-PASS LOSSLESS UNION DEDUPLICATION & CONFLICT DETECTION
// ============================================================================

export function splitPersianSentences(text: string): string[] {
  return text
    .split(/(?<=[.!؟؛\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Lossless Union of two overlapping texts: (X + Y) ∪ (X + Z) => (X + Y + Z).
 * Preserves every unique sentence, numeric detail, or parenthetical clause from B
 * that is not already present in A.
 */
export function losslessUnionTexts(canonicalText: string, duplicateText: string): {
  mergedText: string;
  addedSentences: string[];
} {
  const baseSentences = splitPersianSentences(canonicalText);
  const incomingSentences = splitPersianSentences(duplicateText);
  const baseNorms = baseSentences.map((s) => normalizePersianForComparison(s));
  const baseTokensList = baseSentences.map((s) => tokenizeContent(s));

  const addedSentences: string[] = [];
  for (const inc of incomingSentences) {
    const incNorm = normalizePersianForComparison(inc);
    if (!incNorm) continue;
    const incTokens = tokenizeContent(inc);
    const alreadyCovered = baseNorms.some((bn, idx) => {
      if (bn === incNorm || bn.includes(incNorm)) return true;
      return computeJaccardSimilarity(baseTokensList[idx], incTokens) >= 0.8;
    });
    if (!alreadyCovered) {
      addedSentences.push(inc);
      baseSentences.push(inc);
      baseNorms.push(incNorm);
      baseTokensList.push(incTokens);
    }
  }

  return {
    mergedText: addedSentences.length > 0 ? baseSentences.join(' ') : canonicalText,
    addedSentences,
  };
}

const ENTITY_INDEX_PREFIXES = new Set([
  'عدد',
  'شماره',
  'پین',
  'پایه',
  'بیت',
  'بایت',
  'مرحله',
  'گام',
  'فصل',
  'بخش',
  'مثال',
  'شکل',
  'جدول',
  'ردیف',
  'سطر',
  'ستون',
  'نسخه',
  'مدل',
  'کد',
  'پورت',
  'کانال',
  'سیلندر',
  'دنده',
  'بانک',
  'کانکتور',
  'سنسور',
  'نقشه',
  'آدرس',
  'بلاک',
  'سکتور',
  'خط',
  'مورد',
  'نکته',
  'تست',
  'آزمون',
  'سطح',
  'حرف',
  'کاراکتر',
  'رقم',
  'باند',
  'گروه',
  'رده',
  'کلاس',
  'نوع',
]);

const QUANTITATIVE_VALUE_PREFIXES = new Set([
  'برابر',
  'مساوی',
  'معادل',
  'حداکثر',
  'حداقل',
  'بیشینه',
  'کمینه',
  'حدود',
  'تقریبا',
  'دقیقا',
  'بیش',
  'کمتر',
  'نباید',
  'هر',
  'تا',
  'مقدار',
  'فشار',
  'دما',
  'دمای',
  'ولتاژ',
  'جریان',
  'سرعت',
  'دور',
  'ظرفیت',
  'نسبت',
  'زمان',
  'فاصله',
  'طول',
  'وزن',
  'حجم',
  'قیمت',
  'درصد',
  'مقاومت',
  'توان',
  'گشتاور',
  'فرکانس',
  'اکتان',
  'ضخامت',
  'قطر',
  'عرض',
  'ارتفاع',
  'زاویه',
]);

const OPPOSING_CONDITION_PAIRS: Array<[string, string]> = [
  ['سرد', 'گرم'],
  ['آرام', 'کامل'],
  ['آرام', 'تمام'],
  ['آیدل', 'تمام'],
  ['حداقل', 'حداکثر'],
  ['کمینه', 'بیشینه'],
  ['کمترین', 'بیشترین'],
  ['پایین', 'بالا'],
  ['ورودی', 'خروجی'],
  ['بالادست', 'پاییندست'],
  ['قبل', 'بعد'],
  ['پیش', 'پس'],
  ['بنزینی', 'دیزلی'],
  ['اتمسفریک', 'توربو'],
  ['طبیعی', 'توربو'],
  ['معمولی', 'سوپر'],
  ['استاندارد', 'پرفشار'],
  ['مقدماتی', 'پیشرفته'],
  ['پایه', 'تخصصی'],
  ['نرمال', 'بحرانی'],
  ['نرمال', 'فن'],
  ['کارکرد', 'فن'],
  ['خاموش', 'روشن'],
  ['باز', 'بسته'],
  ['اول', 'دوم'],
  ['دوم', 'سوم'],
  ['سوم', 'چهارم'],
  ['ابتدا', 'انتها'],
  ['شروع', 'پایان'],
  ['جلو', 'عقب'],
  ['چپ', 'راست'],
  ['اصلی', 'فرعی'],
  ['داخلی', 'خارجی'],
  ['دسیمال', 'باینری'],
  ['هگزادسیمال', 'باینری'],
  ['بیت', 'بایت'],
  ['مثبت', 'منفی'],
  ['افزایش', 'کاهش'],
  // ECU Calibration & Remapping distinct operating regimes (complementary, not contradictory!)
  ['استوک', 'ریمپ'],
  ['فابریک', 'ریمپ'],
  ['فابریک', 'تیون'],
  ['فابریک', 'استیج'],
  ['استوک', 'استیج'],
  ['استاندارد', 'استیج'],
  ['بنزین', 'گاز'],
  ['بنزینی', 'دوگانه'],
  ['معمولی', 'متانول'],
  ['سرد', 'کاری'],
  ['جزئی', 'کامل'],
  ['جزئی', 'تخته'],
  ['آرام', 'تخته'],
  ['آیدل', 'wot'],
  ['stock', 'stage'],
  ['oem', 'tuned'],
];

const MEASUREMENT_UNIT_ALIASES: Record<string, string> = {
  '%': 'percent',
  'درصد': 'percent',
  'بار': 'bar',
  bar: 'bar',
  mbar: 'mbar',
  'میلیبار': 'mbar',
  'میلی‌بار': 'mbar',
  kpa: 'kpa',
  'کیلوپاسکال': 'kpa',
  hpa: 'hpa',
  psi: 'psi',
  rpm: 'rpm',
  'دور': 'rpm',
  afr: 'afr',
  lambda: 'lambda',
  'λ': 'lambda',
  'لامبدا': 'lambda',
  btdc: 'deg_ca',
  atdc: 'deg_ca',
  ca: 'deg_ca',
  'درجه': 'deg',
  'سانتیگراد': 'deg',
  'سلسیوس': 'deg',
  '°c': 'deg',
  'mg/str': 'mg_str',
  'mg/stroke': 'mg_str',
  'mg/stk': 'mg_str',
  'mg/hub': 'mg_str',
  'g/s': 'g_s',
  'kg/h': 'kg_h',
  'کیلومتر': 'km',
  km: 'km',
  'متر': 'm',
  'سانتیمتر': 'cm',
  'سانتی‌متر': 'cm',
  cm: 'cm',
  'میلیمتر': 'mm',
  'میلی‌متر': 'mm',
  mm: 'mm',
  'کیلوگرم': 'kg',
  kg: 'kg',
  'گرم': 'g',
  'لیتر': 'l',
  'میلیلیتر': 'ml',
  'میلی‌لیتر': 'ml',
  ml: 'ml',
  'ثانیه': 's',
  'میلیثانیه': 'ms',
  'میلی‌ثانیه': 'ms',
  ms: 'ms',
  'دقیقه': 'min',
  'ساعت': 'hr',
  'روز': 'day',
  'ماه': 'month',
  'سال': 'year',
  'تومان': 'toman',
  'ریال': 'rial',
  'دلار': 'usd',
  'مگابایت': 'mb',
  mb: 'mb',
  'گیگابایت': 'gb',
  gb: 'gb',
  'کیلوبایت': 'kb',
  kb: 'kb',
  'ولت': 'v',
  'میلیولت': 'mv',
  'میلی‌ولت': 'mv',
  'آمپر': 'a',
  'میلیآمپر': 'ma',
  'میلی‌آمپر': 'ma',
  'وات': 'w',
  'کیلووات': 'kw',
  kw: 'kw',
  'اسب': 'hp',
  hp: 'hp',
  'اهم': 'ohm',
  'هرتز': 'hz',
  hz: 'hz',
  'کیلوهرتز': 'khz',
  khz: 'khz',
  'مگاهرتز': 'mhz',
  mhz: 'mhz',
  kbps: 'kbps',
  baud: 'baud',
  'اکتان': 'octane',
  'نیوتن': 'nm',
  nm: 'nm',
  'به 1': 'ratio',
  ':1': 'ratio',
};

const MEASUREMENT_UNIT_PATTERN =
  /(%|درصد|کیلوگرم|کیلومتر|کیلوپاسکال|میلی[‌\s]?بار|سانتی[‌\s]?متر|میلی[‌\s]?متر|میلی[‌\s]?لیتر|میلی[‌\s]?ثانیه|میلی[‌\s]?ولت|میلی[‌\s]?آمپر|متر|بار|psi|rpm|afr|lambda|λ|لامبدا|btdc|atdc|mg\/str(?:oke)?|mg\/stk|mg\/hub|g\/s|kg\/h|kpa|mbar|hpa|درجه|سانتیگراد|سلسیوس|°c|ساعت|دقیقه|ثانیه|روز|ماه|سال|تومان|ریال|دلار|مگابایت|گیگابایت|کیلوبایت|ولت|آمپر|وات|اسب|کیلووات|اهم|کیلوهرتز|مگاهرتز|هرتز|kbps|baud|اکتان|نیوتن|لیتر|گرم|bar|km|mm|cm|kg|ml|ms|mb|gb|kb|kw|hp|hz|khz|mhz|nm|به\s+1|:1)/i;

function normalizeUnitKey(rawUnit: string): string {
  const cleaned = toAsciiDigits(rawUnit)
    .replace(/[\u200c\s]+/g, ' ')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .trim()
    .toLowerCase();
  if (cleaned === 'به 1' || cleaned === ':1') return 'ratio';
  const compact = cleaned.replace(/\s+/g, '');
  return MEASUREMENT_UNIT_ALIASES[cleaned] || MEASUREMENT_UNIT_ALIASES[compact] || compact;
}

interface KeyValueMapping {
  lhsNorm: string;
  rhsNorm: string;
}

function extractKeyValueMappings(text: string): KeyValueMapping[] {
  const ascii = toAsciiDigits(text)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[=≡]/.test(ascii)) return [];

  // Split multi-mapping lines like:
  // "عدد 14 در دسیمال = حرف E در هگزادسیمال عدد 15 در دسیمال = حرف F در هگزادسیمال"
  // Strategy: locate every "=" operator and partition the text cleanly between consecutive "="
  const eqMatches = Array.from(ascii.matchAll(/\s*[=≡]\s*/g));
  if (eqMatches.length === 0) return [];

  const mappings: KeyValueMapping[] = [];
  if (eqMatches.length === 1) {
    const idx = eqMatches[0].index ?? 0;
    const lhs = normalizePersianForComparison(ascii.slice(0, idx));
    const rhs = normalizePersianForComparison(ascii.slice(idx + eqMatches[0][0].length));
    if (lhs && rhs) mappings.push({ lhsNorm: lhs, rhsNorm: rhs });
    return mappings;
  }

  // Multiple "=" in one block: split around repeated subject starter token (e.g. "عدد", "پین", "کد", "بیت", or newline/punctuation)
  const firstLhsWords = ascii.slice(0, eqMatches[0].index ?? 0).trim().split(/\s+/);
  const starterWord = firstLhsWords[0] || '';
  let segments: string[] = [];

  if (starterWord && starterWord.length >= 2) {
    const escaped = starterWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const splitRe = new RegExp(`(?=(?:^|[\\s،؛.!؟])${escaped}\\s)`, 'g');
    segments = ascii
      .split(splitRe)
      .map((s) => s.trim())
      .filter((s) => /[=≡]/.test(s));
  }

  if (segments.length < 2) {
    segments = ascii
      .split(/(?:[\n.!؟؛،]|(?=\b(?:عدد|شماره|پین|کد|بیت|مرحله|حرف)\b))/)
      .map((s) => s.trim())
      .filter((s) => /[=≡]/.test(s));
  }

  for (const seg of segments) {
    const parts = seg.split(/\s*[=≡]\s*/);
    if (parts.length === 2) {
      const lhs = normalizePersianForComparison(parts[0]);
      const rhs = normalizePersianForComparison(parts[1]);
      if (lhs && rhs) {
        mappings.push({ lhsNorm: lhs, rhsNorm: rhs });
      }
    }
  }
  return mappings;
}

const GENERIC_LATIN_UNITS = new Set([
  'bar',
  'psi',
  'rpm',
  'km',
  'mm',
  'cm',
  'kg',
  'ml',
  'ms',
  'mb',
  'gb',
  'tb',
  'kb',
  'kw',
  'hp',
  'hz',
  'khz',
  'mhz',
  'nm',
  'cc',
  'db',
  'min',
  'hr',
  'sec',
]);

function extractLatinIdentifiers(text: string): Set<string> {
  const ascii = toAsciiDigits(text);
  // Strip numbers immediately attached to measurement units (e.g. "12V", "90 C", "4 bar", "3000 rpm")
  const withoutUnitPairs = ascii.replace(
    /\b\d+(?:[.,]\d+)?\s*(?:°?[cfk]|v|a|w|g|m|l|s|bar|psi|rpm|km|mm|cm|kg|ml|ms|mb|gb|tb|kb|kw|hp|hz|khz|mhz|nm|cc|db|min|hr|sec)\b/gi,
    ' '
  );
  const matches = withoutUnitPairs.match(/\b[A-Za-z][A-Za-z0-9_-]*\b/g) || [];
  const ids = new Set<string>();
  for (const raw of matches) {
    const lower = raw.toLowerCase();
    if (GENERIC_LATIN_UNITS.has(lower)) continue;
    ids.add(lower);
  }
  return ids;
}

function extractEntityIndexTags(text: string): Set<string> {
  const ascii = toAsciiDigits(text)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .toLowerCase();
  const words = ascii.split(/\s+/).filter(Boolean);
  const tags = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    if (ENTITY_INDEX_PREFIXES.has(words[i]) && /^\d+$/.test(words[i + 1])) {
      tags.add(`${words[i]}:${words[i + 1]}`);
    }
  }
  return tags;
}

interface MeasuredFact {
  value: number;
  rawNumber: string;
  unit: string | null;
}

function extractMeasuredFacts(sentence: string): MeasuredFact[] {
  const ascii = toAsciiDigits(sentence)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/,/g, '');

  const facts: MeasuredFact[] = [];
  const numRegex = /\b\d+(?:\.\d+)?\b/g;
  let match: RegExpExecArray | null;

  while ((match = numRegex.exec(ascii)) !== null) {
    const rawNumber = match[0];
    const startIdx = match.index;
    const endIdx = startIdx + rawNumber.length;

    const beforeWords = ascii
      .slice(0, startIdx)
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const prevWord = (beforeWords[beforeWords.length - 1] || '').toLowerCase();
    const prev2Word = (beforeWords[beforeWords.length - 2] || '').toLowerCase();

    // Skip entity indices like "عدد 14", "پین 11", "مرحله 2", "فصل 1", "بیت 3"
    if (ENTITY_INDEX_PREFIXES.has(prevWord)) {
      continue;
    }

    const afterSlice = ascii.slice(endIdx, endIdx + 24).trimStart();
    const unitMatch = afterSlice.match(new RegExp(`^${MEASUREMENT_UNIT_PATTERN.source}`, 'i'));
    const unit = unitMatch ? normalizeUnitKey(unitMatch[0]) : null;

    const hasQuantPrefix =
      QUANTITATIVE_VALUE_PREFIXES.has(prevWord) ||
      (prevWord === 'از' && QUANTITATIVE_VALUE_PREFIXES.has(prev2Word));

    if (unit || hasQuantPrefix) {
      const value = Number(rawNumber);
      if (!Number.isNaN(value)) {
        facts.push({ value, rawNumber, unit });
      }
    }
  }
  return facts;
}

function hasOpposingCondition(tokensA: Set<string>, tokensB: Set<string>): boolean {
  for (const [term1, term2] of OPPOSING_CONDITION_PAIRS) {
    const aHas1 = tokensA.has(term1) && !tokensA.has(term2);
    const bHas2 = tokensB.has(term2) && !tokensB.has(term1);
    const aHas2 = tokensA.has(term2) && !tokensA.has(term1);
    const bHas1 = tokensB.has(term1) && !tokensB.has(term2);
    if ((aHas1 && bHas2) || (aHas2 && bHas1)) {
      return true;
    }
  }
  return false;
}

function getNonNumericSkeletonTokens(sentence: string): string[] {
  const withoutNumbers = toAsciiDigits(sentence).replace(/\d+(?:[.,]\d+)?/g, ' ');
  return normalizePersianForComparison(withoutNumbers)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !PERSIAN_STOP_WORDS.has(w));
}

function isSentencePairGenuineConflict(sentA: string, sentB: string): boolean {
  // 1. Key-value / equation mappings ("X = Y")
  const mapsA = extractKeyValueMappings(sentA);
  const mapsB = extractKeyValueMappings(sentB);
  if (mapsA.length > 0 && mapsB.length > 0) {
    for (const ma of mapsA) {
      for (const mb of mapsB) {
        if (ma.lhsNorm === mb.lhsNorm && ma.rhsNorm !== mb.rhsNorm) {
          return true;
        }
      }
    }
    // Both sentences are key-value mappings with completely distinct LHS keys -> complementary rows, NOT conflicts
    return false;
  }

  // 2. Distinct Latin entity identifiers / letters / codes (e.g., B vs E, P0135 vs P0141)
  const latinA = extractLatinIdentifiers(sentA);
  const latinB = extractLatinIdentifiers(sentB);
  if (latinA.size > 0 && latinB.size > 0) {
    const onlyA = Array.from(latinA).filter((x) => !latinB.has(x));
    const onlyB = Array.from(latinB).filter((x) => !latinA.has(x));
    if (onlyA.length > 0 && onlyB.length > 0) {
      return false;
    }
  }

  // 3. Distinct entity-index tags (e.g., "پین 11" vs "پین 14", "مرحله 1" vs "مرحله 2", "عدد 11" vs "عدد 14")
  const idxA = extractEntityIndexTags(sentA);
  const idxB = extractEntityIndexTags(sentB);
  if (idxA.size > 0 && idxB.size > 0) {
    const onlyIdxA = Array.from(idxA).filter((x) => !idxB.has(x));
    const onlyIdxB = Array.from(idxB).filter((x) => !idxA.has(x));
    if (onlyIdxA.length > 0 && onlyIdxB.length > 0) {
      return false;
    }
  }

  // 3B. Disjoint ECU / engine platforms (e.g., Bosch ME7.4.4 vs Siemens SIM2K-241 -> never contradictory!)
  if (hasDisjointEcuPlatforms(sentA, sentB)) {
    return false;
  }

  // 4. Opposing / distinct operating conditions (e.g., cold vs hot, idle vs full-throttle, stock vs stage 1)
  const skelA = getNonNumericSkeletonTokens(sentA);
  const skelB = getNonNumericSkeletonTokens(sentB);
  const skelSetA = new Set(skelA);
  const skelSetB = new Set(skelB);
  if (hasOpposingCondition(skelSetA, skelSetB)) {
    return false;
  }

  // 5. Require strong non-numeric subject/predicate alignment (>= 4 shared tokens & Jaccard >= 0.72)
  let sharedCount = 0;
  for (const t of skelSetA) {
    if (skelSetB.has(t)) sharedCount++;
  }
  const skelSim = computeJaccardSimilarity(skelA, skelB);
  if (sharedCount < 4 || skelSim < 0.72) {
    return false;
  }

  // 6. Compare measured quantitative facts (excluding entity indices)
  const factsA = extractMeasuredFacts(sentA);
  const factsB = extractMeasuredFacts(sentB);
  if (factsA.length === 0 || factsB.length === 0) {
    return false;
  }

  // Superset / elaboration guard: if all measured values of A appear in B (or vice versa), it is elaboration not conflict
  const valsA = new Set(factsA.map((f) => `${f.unit ?? '*'}::${f.value}`));
  const valsB = new Set(factsB.map((f) => `${f.unit ?? '*'}::${f.value}`));
  const allAInB = Array.from(valsA).every((v) => valsB.has(v));
  const allBInA = Array.from(valsB).every((v) => valsA.has(v));
  if (allAInB || allBInA) {
    return false;
  }

  // Require at least one matching unit (when both sides have explicit units) with different numeric values
  const unitsA = new Set(factsA.map((f) => f.unit).filter((u): u is string => Boolean(u)));
  const unitsB = new Set(factsB.map((f) => f.unit).filter((u): u is string => Boolean(u)));

  if (unitsA.size > 0 && unitsB.size > 0) {
    for (const unit of unitsA) {
      if (!unitsB.has(unit)) continue;
      const aValsForUnit = new Set(factsA.filter((f) => f.unit === unit).map((f) => f.value));
      const bValsForUnit = new Set(factsB.filter((f) => f.unit === unit).map((f) => f.value));
      const onlyA = Array.from(aValsForUnit).filter((v) => !bValsForUnit.has(v));
      const onlyB = Array.from(bValsForUnit).filter((v) => !aValsForUnit.has(v));
      if (onlyA.length > 0 && onlyB.length > 0) {
        return true;
      }
    }
    return false;
  }

  // If unitless quantitative predicates (e.g. "حداکثر تعداد برابر 4 است" vs "حداکثر تعداد برابر 6 است")
  const rawValsA = new Set(factsA.map((f) => f.value));
  const rawValsB = new Set(factsB.map((f) => f.value));
  const diffA = Array.from(rawValsA).filter((v) => !rawValsB.has(v));
  const diffB = Array.from(rawValsB).filter((v) => !rawValsA.has(v));
  return diffA.length > 0 && diffB.length > 0;
}

/**
 * Strict deterministic conflict detector: returns true ONLY when two texts contain
 * an actual contradictory claim about the exact same subject and condition
 * (never for parallel examples, hex/decimal mapping rows, distinct conditions, or elaborations).
 */
export function isGenuineNumericConflict(textA: string, textB: string): boolean {
  const sentsA = splitPersianSentences(textA);
  const sentsB = splitPersianSentences(textB);
  if (sentsA.length === 0 || sentsB.length === 0) return false;

  for (const sa of sentsA) {
    for (const sb of sentsB) {
      if (isSentencePairGenuineConflict(sa, sb)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true when two texts represent parallel distinct items/rows
 * (e.g. different "=" LHS keys, distinct Latin codes/letters like B vs E or P0135 vs P0141,
 * or distinct entity-index numbers like "پین 11" vs "پین 14" / "عدد 11" vs "عدد 14")
 * so they are neither falsely flagged as conflicts nor wrongly collapsed into a near-duplicate merge.
 */
export function hasDistinctParallelIdentifiers(textA: string, textB: string): boolean {
  // Distinct key-value LHS mappings
  const mapsA = extractKeyValueMappings(textA);
  const mapsB = extractKeyValueMappings(textB);
  if (mapsA.length > 0 && mapsB.length > 0) {
    const lhsSetA = new Set(mapsA.map((m) => m.lhsNorm));
    const lhsSetB = new Set(mapsB.map((m) => m.lhsNorm));
    const anySharedLhs = Array.from(lhsSetA).some((k) => lhsSetB.has(k));
    if (!anySharedLhs) return true;
  }

  // Distinct Latin identifiers/letters/codes on both sides
  const latinA = extractLatinIdentifiers(textA);
  const latinB = extractLatinIdentifiers(textB);
  if (latinA.size > 0 && latinB.size > 0) {
    const onlyA = Array.from(latinA).filter((x) => !latinB.has(x));
    const onlyB = Array.from(latinB).filter((x) => !latinA.has(x));
    if (onlyA.length > 0 && onlyB.length > 0) return true;
  }

  // Distinct entity-index tags (e.g. "عدد 11" vs "عدد 14", "پین 3" vs "پین 7", "مرحله 1" vs "مرحله 2")
  const idxA = extractEntityIndexTags(textA);
  const idxB = extractEntityIndexTags(textB);
  if (idxA.size > 0 && idxB.size > 0) {
    const onlyA = Array.from(idxA).filter((x) => !idxB.has(x));
    const onlyB = Array.from(idxB).filter((x) => !idxA.has(x));
    if (onlyA.length > 0 && onlyB.length > 0) return true;
  }

  // Disjoint ECU / engine platforms (e.g. Bosch ME7.4.4 vs Siemens SIM2K)
  if (hasDisjointEcuPlatforms(textA, textB)) {
    return true;
  }

  return false;
}

export interface DedupPipelineOutput {
  unitUpdates: Array<{
    id: string;
    status: 'active' | 'merged' | 'conflict';
    canonicalUnitId: string | null;
    rawText: string;
    payloadJson?: Record<string, unknown>;
  }>;
  clusters: Array<{
    id: string;
    projectId: string;
    canonicalUnitId: string;
    mergedUnitIds: string[];
    matchType: 'exact_hash' | 'near_duplicate' | 'lossless_union';
    similarityScore: number;
    losslessSummary: string;
    preservedDetailsJson: Record<string, unknown>;
  }>;
  conflicts: Array<{
    id: string;
    projectId: string;
    topic: string;
    unitAId: string;
    unitBId: string;
    fileAName: string;
    fileBName: string;
    excerptA: string;
    excerptB: string;
    status: 'open';
  }>;
}

export function runDeterministicLosslessDedup(params: {
  projectId: string;
  workflowMode: WorkflowMode;
  sourceFiles: SourceFileDto[];
  units: ContentUnitDto[];
}): DedupPipelineOutput {
  const fileMap = new Map(params.sourceFiles.map((f) => [f.id, f]));

  // Sort units so 'master' role files ALWAYS become canonical anchors first in master_update mode
  const sortedUnits = [...params.units].sort((a, b) => {
    const fA = fileMap.get(a.sourceFileId);
    const fB = fileMap.get(b.sourceFileId);
    const rankA = fA?.fileRole === 'master' ? 0 : 1;
    const rankB = fB?.fileRole === 'master' ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    return a.unitOrder - b.unitOrder;
  });

  interface CanonicalSlot {
    slotIndex: number;
    unit: ContentUnitDto;
    text: string;
    tokens: string[];
    tokenSet: Set<string>;
    normSentences: Set<string>;
    nums: string[];
    fileName: string;
    mergedIds: string[];
    addedDetails: string[];
    matchType: 'exact_hash' | 'near_duplicate' | 'lossless_union';
    bestScore: number;
  }

  const hashIndex = new Map<string, CanonicalSlot>();
  const activeSlots: CanonicalSlot[] = [];
  const tableSlotIndices: number[] = [];
  // Inverted candidate indices per unitType -> token/sentence -> slot indices for sub-quadratic scaling
  const typeTokenIndex = new Map<string, Map<string, number[]>>();
  const typeSentenceIndex = new Map<string, Map<string, number[]>>();

  const getNormLongSentences = (text: string): Set<string> => {
    const set = new Set<string>();
    for (const s of splitPersianSentences(text)) {
      const n = normalizePersianForComparison(s);
      if (n.length >= 20) set.add(n);
    }
    return set;
  };

  const computeJaccardFromSets = (setA: Set<string>, setB: Set<string>): number => {
    if (setA.size === 0 || setB.size === 0) return 0;
    const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    let intersection = 0;
    for (const t of smaller) {
      if (larger.has(t)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  };

  const indexSlot = (slot: CanonicalSlot) => {
    const uType = slot.unit.unitType;
    if (uType === 'table') {
      tableSlotIndices.push(slot.slotIndex);
      return;
    }
    if (uType !== 'paragraph' && uType !== 'callout' && uType !== 'list') return;

    let tokMap = typeTokenIndex.get(uType);
    if (!tokMap) {
      tokMap = new Map<string, number[]>();
      typeTokenIndex.set(uType, tokMap);
    }
    for (const tok of slot.tokenSet) {
      let arr = tokMap.get(tok);
      if (!arr) {
        arr = [];
        tokMap.set(tok, arr);
      }
      arr.push(slot.slotIndex);
    }

    let sentMap = typeSentenceIndex.get(uType);
    if (!sentMap) {
      sentMap = new Map<string, number[]>();
      typeSentenceIndex.set(uType, sentMap);
    }
    for (const sent of slot.normSentences) {
      let arr = sentMap.get(sent);
      if (!arr) {
        arr = [];
        sentMap.set(sent, arr);
      }
      arr.push(slot.slotIndex);
    }
  };

  const unitStatusMap = new Map<
    string,
    {
      status: 'active' | 'merged' | 'conflict';
      canonicalUnitId: string | null;
      rawText: string;
      payloadJson?: Record<string, unknown>;
    }
  >();
  const detectedConflicts: DedupPipelineOutput['conflicts'] = [];
  const conflictPairKeys = new Set<string>();

  for (const unit of sortedUnits) {
    const fileName =
      fileMap.get(unit.sourceFileId)?.fileName ||
      String(unit.metadataJson?.fileName || 'سند ورودی');

    // Never deduplicate embedded images or equations aggressively unless exact hash match
    const existingExact = hashIndex.get(unit.normalizedHash);
    if (existingExact) {
      existingExact.mergedIds.push(unit.id);
      unitStatusMap.set(unit.id, {
        status: 'merged',
        canonicalUnitId: existingExact.unit.id,
        rawText: unit.rawText,
      });
      continue;
    }

    const tokens = tokenizeContent(unit.rawText);
    const tokenSet = new Set(tokens);
    const normSentences = getNormLongSentences(unit.rawText);
    const nums = extractNumericFacts(unit.rawText);

    let matchedSlot: CanonicalSlot | null = null;
    let matchedScore = 0;

    // Structured Row-by-Row Lossless Table Fusion for compatible tables (DTC / Pinout / Map Tables)
    if (unit.unitType === 'table') {
      const incomingBlock = unit.metadataJson?.block as TableBlock | undefined;
      if (incomingBlock && incomingBlock.type === 'table') {
        let mergedIntoTableSlot = false;
        for (const sIdx of tableSlotIndices) {
          const slot = activeSlots[sIdx];
          if (slot.unit.sourceFileId === unit.sourceFileId) continue;
          const slotBlock = slot.unit.metadataJson?.block as TableBlock | undefined;
          if (!slotBlock || slotBlock.type !== 'table') continue;

          const tableMerge = mergeCompatibleTablesLossless(
            slotBlock,
            incomingBlock,
            slot.fileName,
            fileName
          );
          if (!tableMerge.compatible) continue;

          // Update canonical table block in-place (preserving originalBlock for pristine statistical diffing!)
          const pristineOriginalBlock =
            (slot.unit.metadataJson?.originalBlock as TableBlock | undefined) || slotBlock;
          slot.unit.metadataJson = {
            ...(slot.unit.metadataJson || {}),
            originalBlock: pristineOriginalBlock,
            block: tableMerge.mergedTable,
          };
          slot.text = blockToPlainText(tableMerge.mergedTable);
          slot.tokens = tokenizeContent(slot.text);
          slot.tokenSet = new Set(slot.tokens);
          slot.nums = extractNumericFacts(slot.text);
          slot.mergedIds.push(unit.id);
          slot.matchType = 'lossless_union';
          slot.bestScore = 0.95;
          slot.addedDetails.push(
            `ادغام ردیف‌به‌ردیف جدول: ${toPersianDigits(tableMerge.addedRowCount)} ردیف جدید افزوده و ${toPersianDigits(tableMerge.dedupedRowCount)} ردیف تکراری حذف شد.`
          );

          for (const rc of tableMerge.rowConflicts) {
            const pairKey = [slot.unit.id, unit.id, rc.rowKey, rc.columnHeader].join('::');
            if (!conflictPairKeys.has(pairKey)) {
              conflictPairKeys.add(pairKey);
              detectedConflicts.push({
                id: `conf_${deterministicHash(`${params.projectId}:${pairKey}`)}`,
                projectId: params.projectId,
                topic: `تناقض سلول جدول (${rc.rowKey} · ${rc.columnHeader})`,
                unitAId: slot.unit.id,
                unitBId: unit.id,
                fileAName: slot.fileName,
                fileBName: fileName,
                excerptA: `${rc.rowKey} ← ${rc.columnHeader}: ${rc.valueA}`,
                excerptB: `${rc.rowKey} ← ${rc.columnHeader}: ${rc.valueB}`,
                status: 'open',
              });
            }
          }

          unitStatusMap.set(slot.unit.id, {
            status: tableMerge.rowConflicts.length > 0 ? 'conflict' : 'active',
            canonicalUnitId: null,
            rawText: slot.text,
            payloadJson: {
              ...(slot.unit.metadataJson || {}),
              headingPath: slot.unit.headingPath,
            },
          });
          unitStatusMap.set(unit.id, {
            status: 'merged',
            canonicalUnitId: slot.unit.id,
            rawText: unit.rawText,
          });
          mergedIntoTableSlot = true;
          break;
        }
        if (mergedIntoTableSlot) continue;
      }
    }

    // Sub-quadratic candidate retrieval via inverted token + verbatim sentence index
    if (unit.unitType === 'paragraph' || unit.unitType === 'callout' || unit.unitType === 'list') {
      const candidateSharedCounts = new Map<number, number>();
      const verbatimCandidateSet = new Set<number>();

      const sentMap = typeSentenceIndex.get(unit.unitType);
      if (sentMap && normSentences.size > 0) {
        for (const s of normSentences) {
          const hits = sentMap.get(s);
          if (hits) {
            for (const idx of hits) {
              verbatimCandidateSet.add(idx);
              candidateSharedCounts.set(idx, (candidateSharedCounts.get(idx) || 0) + 10);
            }
          }
        }
      }

      const tokMap = typeTokenIndex.get(unit.unitType);
      if (tokMap && tokenSet.size > 0) {
        // Upper bound on posting-list size to skip hyper-frequent boilerplate words on giant books
        const maxPosting = Math.max(48, Math.floor(activeSlots.length * 0.35));
        for (const tok of tokenSet) {
          const hits = tokMap.get(tok);
          if (!hits || hits.length > maxPosting) continue;
          for (const idx of hits) {
            candidateSharedCounts.set(idx, (candidateSharedCounts.get(idx) || 0) + 1);
          }
        }
      }

      // Minimum shared tokens mathematically needed for Jaccard >= 0.35 (with safety floor of 1 for tiny units)
      const minSharedForOverlap = tokenSet.size <= 3 ? 1 : Math.max(2, Math.floor(tokenSet.size * 0.25));

      for (const [slotIdx, sharedHits] of candidateSharedCounts.entries()) {
        const hasSharedSentence = verbatimCandidateSet.has(slotIdx);
        if (!hasSharedSentence && sharedHits < minSharedForOverlap) continue;

        const slot = activeSlots[slotIdx];
        const sim = computeJaccardFromSets(slot.tokenSet, tokenSet);

        // Check cross-file GENUINE factual/numeric contradiction BEFORE merging!
        if (
          sim >= 0.35 &&
          slot.unit.sourceFileId !== unit.sourceFileId &&
          isGenuineNumericConflict(slot.text, unit.rawText)
        ) {
          const pairKey = [slot.unit.id, unit.id].sort().join('::');
          if (!conflictPairKeys.has(pairKey)) {
            conflictPairKeys.add(pairKey);
            const topic =
              (unit.headingPath || slot.unit.headingPath || 'تناقض مقدار عددی در اسناد')
                .split('>')[0]
                .trim();
            detectedConflicts.push({
              id: `conf_${deterministicHash(`${params.projectId}:${pairKey}`)}`,
              projectId: params.projectId,
              topic,
              unitAId: slot.unit.id,
              unitBId: unit.id,
              fileAName: slot.fileName,
              fileBName: fileName,
              excerptA: slot.text.slice(0, 420),
              excerptB: unit.rawText.slice(0, 420),
              status: 'open',
            });
          }
          // Strictly do NOT merge conflicting units — keep both!
          matchedSlot = null;
          matchedScore = 0;
          break;
        }

        // Fast skip if neither verbatim sentence nor high Jaccard overlap
        const effectiveScore = hasSharedSentence ? Math.max(sim, 0.72) : sim;
        if (effectiveScore < 0.48 || effectiveScore <= matchedScore) {
          continue;
        }

        // Do NOT merge distinct parallel items unless they literally share an identical 20+ char verbatim sentence
        if (!hasSharedSentence && hasDistinctParallelIdentifiers(slot.text, unit.rawText)) {
          continue;
        }

        // Also do NOT merge two distinct-condition quantitative statements
        if (!hasSharedSentence && hasOpposingCondition(slot.tokenSet, tokenSet)) {
          continue;
        }

        matchedSlot = slot;
        matchedScore = effectiveScore;
      }
    }

    if (matchedSlot) {
      const union = losslessUnionTexts(matchedSlot.text, unit.rawText);
      matchedSlot.text = union.mergedText;
      const newTokens = tokenizeContent(matchedSlot.text);
      const newTokenSet = new Set(newTokens);
      const newNormSents = getNormLongSentences(matchedSlot.text);

      // Incrementally index any newly added tokens/sentences from the lossless union
      const tokMap = typeTokenIndex.get(matchedSlot.unit.unitType);
      if (tokMap) {
        for (const t of newTokenSet) {
          if (!matchedSlot.tokenSet.has(t)) {
            let arr = tokMap.get(t);
            if (!arr) {
              arr = [];
              tokMap.set(t, arr);
            }
            arr.push(matchedSlot.slotIndex);
          }
        }
      }
      const sentMap = typeSentenceIndex.get(matchedSlot.unit.unitType);
      if (sentMap) {
        for (const s of newNormSents) {
          if (!matchedSlot.normSentences.has(s)) {
            let arr = sentMap.get(s);
            if (!arr) {
              arr = [];
              sentMap.set(s, arr);
            }
            arr.push(matchedSlot.slotIndex);
          }
        }
      }

      matchedSlot.tokens = newTokens;
      matchedSlot.tokenSet = newTokenSet;
      matchedSlot.normSentences = newNormSents;
      matchedSlot.nums = extractNumericFacts(matchedSlot.text);
      matchedSlot.mergedIds.push(unit.id);
      if (union.addedSentences.length > 0) {
        matchedSlot.addedDetails.push(...union.addedSentences);
        matchedSlot.matchType = 'lossless_union';
      } else if (matchedSlot.matchType === 'exact_hash') {
        matchedSlot.matchType = 'near_duplicate';
      }
      matchedSlot.bestScore = Math.max(matchedSlot.bestScore, matchedScore);

      unitStatusMap.set(matchedSlot.unit.id, {
        status: 'active',
        canonicalUnitId: null,
        rawText: matchedSlot.text,
      });
      unitStatusMap.set(unit.id, {
        status: 'merged',
        canonicalUnitId: matchedSlot.unit.id,
        rawText: unit.rawText,
      });
    } else {
      const slot: CanonicalSlot = {
        slotIndex: activeSlots.length,
        unit,
        text: unit.rawText,
        tokens,
        tokenSet,
        normSentences,
        nums,
        fileName,
        mergedIds: [],
        addedDetails: [],
        matchType: 'exact_hash',
        bestScore: 1,
      };
      hashIndex.set(unit.normalizedHash, slot);
      activeSlots.push(slot);
      indexSlot(slot);
      unitStatusMap.set(unit.id, {
        status: 'active',
        canonicalUnitId: null,
        rawText: unit.rawText,
      });
    }
  }

  // Mark conflict participants with 'conflict' status (they remain visible & preserved!)
  for (const c of detectedConflicts) {
    const a = unitStatusMap.get(c.unitAId);
    if (a && a.status === 'active') a.status = 'conflict';
    const b = unitStatusMap.get(c.unitBId);
    if (b && b.status === 'active') b.status = 'conflict';
  }

  const clusters: DedupPipelineOutput['clusters'] = activeSlots
    .filter((s) => s.mergedIds.length > 0)
    .map((s, idx) => ({
      id: `cl_${params.projectId}_${idx + 1}`,
      projectId: params.projectId,
      canonicalUnitId: s.unit.id,
      mergedUnitIds: s.mergedIds,
      matchType: s.matchType,
      similarityScore: Number(s.bestScore.toFixed(2)),
      losslessSummary:
        s.unit.unitType === 'table' && s.addedDetails.length > 0
          ? s.addedDetails.join(' ')
          : s.addedDetails.length > 0
            ? `ادغام بدون افت (Lossless Union): ${toPersianDigits(s.mergedIds.length)} مورد هم‌پوشان ادغام شد و ${toPersianDigits(s.addedDetails.length)} جزئیات یکتا به متن اصلی افزوده شد.`
            : `حذف تکرار کامل: ${toPersianDigits(s.mergedIds.length)} نسخه تکراری در واحد مرجع تجمیع شد.`,
      preservedDetailsJson: {
        addedSentences: s.addedDetails,
        sourceFileName: s.fileName,
      },
    }));

  const unitUpdates = sortedUnits.map((u) => {
    const st = unitStatusMap.get(u.id) ?? {
      status: 'active' as const,
      canonicalUnitId: null,
      rawText: u.rawText,
    };
    return {
      id: u.id,
      status: st.status,
      canonicalUnitId: st.canonicalUnitId,
      rawText: st.rawText,
      ...(st.payloadJson ? { payloadJson: st.payloadJson } : {}),
    };
  });

  return {
    unitUpdates,
    clusters,
    conflicts: detectedConflicts,
  };
}

// ============================================================================
// STAGE 3: INITIAL INTERACTIVE OUTLINE BUILDER (ALL 4 WORKFLOW MODES)
// ============================================================================

export interface ProposedOutlineResult {
  nodes: Array<{
    id: string;
    projectId: string;
    parentId: string | null;
    level: number;
    nodeOrder: number;
    title: string;
    summary: string;
    isApproved: boolean;
  }>;
  unitAssignments: Array<{ unitId: string; outlineNodeId: string }>;
}

export function buildInitialOutline(params: {
  projectId: string;
  workflowMode: WorkflowMode;
  sourceFiles: SourceFileDto[];
  units: ContentUnitDto[];
}): ProposedOutlineResult {
  const fileMap = new Map(params.sourceFiles.map((f) => [f.id, f]));
  const activeUnits = params.units.filter((u) => u.status !== 'merged');

  interface Bucket {
    id: string;
    title: string;
    tokens: string[];
    isMaster: boolean;
    units: ContentUnitDto[];
  }

  const buckets: Bucket[] = [];

  const getTopHeading = (u: ContentUnitDto): string => {
    const raw = (u.headingPath || '').split('>')[0]?.trim();
    if (raw && raw.length >= 2) return raw;
    const fname = fileMap.get(u.sourceFileId)?.fileName || 'فصل اصلی';
    return fname.replace(/\.(docx|pdf|md|txt|json|csv|html)$/i, '').replace(/[_-]+/g, ' ').trim();
  };

  if (params.workflowMode === 'master_update') {
    // 1. Seed buckets from Master file headings first
    const masterUnits = activeUnits.filter(
      (u) => fileMap.get(u.sourceFileId)?.fileRole === 'master'
    );
    const supplementUnits = activeUnits.filter(
      (u) => fileMap.get(u.sourceFileId)?.fileRole !== 'master'
    );

    for (const u of masterUnits) {
      const heading = getTopHeading(u);
      const normHeading = normalizePersianForComparison(heading);
      let bucket = buckets.find((b) => normalizePersianForComparison(b.title) === normHeading);
      if (!bucket) {
        bucket = {
          id: `node_${params.projectId}_${buckets.length + 1}`,
          title: heading,
          tokens: tokenizeContent(heading),
          isMaster: true,
          units: [],
        };
        buckets.push(bucket);
      }
      bucket.units.push(u);
    }

    // 2. Inject genuinely new Supplement units into the closest Master chapter
    for (const u of supplementUnits) {
      const uTokens = tokenizeContent(`${u.headingPath || ''} ${u.rawText.slice(0, 220)}`);
      const uSet = new Set(uTokens);
      let bestBucket: Bucket | null = null;
      let bestScore = 0;

      for (const b of buckets) {
        const bTextTokens = b.tokens.concat(
          b.units.slice(0, 4).flatMap((bu) => tokenizeContent(bu.rawText.slice(0, 160)))
        );
        const bSet = new Set(bTextTokens);
        let sharedCount = 0;
        for (const t of uSet) {
          if (bSet.has(t)) sharedCount += 1;
        }
        const jaccard = computeJaccardSimilarity(bTextTokens, uTokens);
        const overlapCoeff =
          Math.min(uSet.size, bSet.size) > 0 ? sharedCount / Math.min(uSet.size, bSet.size) : 0;
        const combined = Math.max(jaccard, sharedCount >= 2 ? overlapCoeff * 0.85 : 0);
        if (combined > bestScore) {
          bestScore = combined;
          bestBucket = b;
        }
      }

      if (bestBucket && bestScore >= 0.14) {
        bestBucket.units.push(u);
      } else {
        const suppHeading = getTopHeading(u);
        let newBucket = buckets.find(
          (b) => !b.isMaster && normalizePersianForComparison(b.title) === normalizePersianForComparison(suppHeading)
        );
        if (!newBucket) {
          newBucket = {
            id: `node_${params.projectId}_${buckets.length + 1}`,
            title: `تکمیلی — ${suppHeading}`,
            tokens: tokenizeContent(suppHeading),
            isMaster: false,
            units: [],
          };
          buckets.push(newBucket);
        }
        newBucket.units.push(u);
      }
    }
  } else if (params.workflowMode === 'raw_synthesis') {
    // Group raw notes into cohesive logical chapters of ~6-10 units if there are no clear headings
    const distinctHeadings = new Set(activeUnits.map((u) => normalizePersianForComparison(getTopHeading(u))));
    if (distinctHeadings.size <= 1 && activeUnits.length > 6) {
      const chunkSize = Math.max(4, Math.ceil(activeUnits.length / Math.min(6, Math.ceil(activeUnits.length / 5))));
      for (let i = 0; i < activeUnits.length; i += chunkSize) {
        const slice = activeUnits.slice(i, i + chunkSize);
        const leadWords = slice[0].rawText.split(/\s+/).slice(0, 6).join(' ');
        buckets.push({
          id: `node_${params.projectId}_${buckets.length + 1}`,
          title: `مبحث ${toPersianDigits(buckets.length + 1)}: ${leadWords.slice(0, 48)}`,
          tokens: tokenizeContent(leadWords),
          isMaster: false,
          units: slice,
        });
      }
    } else {
      for (const u of activeUnits) {
        const heading = getTopHeading(u);
        const norm = normalizePersianForComparison(heading);
        let bucket = buckets.find((b) => normalizePersianForComparison(b.title) === norm);
        if (!bucket) {
          bucket = {
            id: `node_${params.projectId}_${buckets.length + 1}`,
            title: heading,
            tokens: tokenizeContent(heading),
            isMaster: false,
            units: [],
          };
          buckets.push(bucket);
        }
        bucket.units.push(u);
      }
    }
  } else {
    // single_polish & multi_merge: unify chapters by normalized heading, token overlap, or domain topic signature
    interface DomainTopicRule {
      key: string;
      pedagogicalRank: number;
      pattern: RegExp;
    }

    const REMAP_DOMAIN_TOPICS: readonly DomainTopicRule[] = [
      { key: 'ecu_basics', pedagogicalRank: 10, pattern: /(?:مقدمه|مبانی|ساختار\s*ایسیو|سخت.?افزار|پین.?اوت|بایوس|پروگرامر|بک.?آپ|کپچر|تبدیل\s*(?:هگز|دسیمال|باینری)|مفاهیم\s*پایه)/i },
      { key: 'winols_axes', pedagogicalRank: 20, pattern: /(?:وینولز|winols|آدرس.?یابی|داموس|damos|a2l|محور|axis|fce6|ضریب|factor|offset|آفست|هیگزا|16.?bit|8.?bit|تبدیل\s*داده)/i },
      { key: 'airflow_load', pedagogicalRank: 30, pattern: /(?:هوا|بار\s*موتور|load|دریچه\s*گاز|پدال|kfped|kfmiop|kfmirl|ve|راندمان\s*حجمی|مپ\s*سنسور|ماف|maf|توربو|بوست|ldrxn)/i },
      { key: 'fuel_lambda', pedagogicalRank: 40, pattern: /(?:سوخت|پاشش|انژکتور|لامبدا|lamfa|afr|استوکیومتری|غنی.?سازی|سرد\s*کردن|cold\s*start|stft|ltft|اکسیژن)/i },
      { key: 'ignition_spark', pedagogicalRank: 50, pattern: /(?:جرقه|آوانس|ریتارد|kfzw|شمع|کویل|ناک|کوبش|knock|dwell|زمان\s*شارژ|زاویه\s*جرقه)/i },
      { key: 'vvt_valve', pedagogicalRank: 60, pattern: /(?:vvt|cvvt|میل.?سوپاپ|همپوشانی|سوپاپ|تایمینگ\s*سوپاپ|وانوس)/i },
      { key: 'limits_idle_fan', pedagogicalRank: 70, pattern: /(?:کات.?آف|cutoff|nmax|دور\s*آرام|idle|فن|دمای\s*آب|ترموستات|محدودکننده|vmax|سرعت|پاپ.?اند.?بنگ|بک.?فایر|لانچ)/i },
      { key: 'dtc_immo_safety', pedagogicalRank: 80, pattern: /(?:خطا|dtc|کد\s*خطا|حذف\s*سنسور|کاتالیست|ایموبلایزر|immo|چک.?سام|checksum|عیب.?یابی|ایمنی|محافظت)/i },
    ];

    const detectDomainTopic = (text: string): DomainTopicRule | null => {
      for (const rule of REMAP_DOMAIN_TOPICS) {
        if (rule.pattern.test(text)) return rule;
      }
      return null;
    };

    const bucketTopicKey = new Map<string, string | null>();
    const bucketRank = new Map<string, number>();

    for (const u of activeUnits) {
      const heading = getTopHeading(u);
      const norm = normalizePersianForComparison(heading);
      const hTokens = tokenizeContent(heading);
      const topicRule =
        params.workflowMode === 'multi_merge'
          ? detectDomainTopic(`${heading} ${u.rawText.slice(0, 140)}`)
          : null;

      let bucket = buckets.find((b) => {
        if (normalizePersianForComparison(b.title) === norm) return true;
        if (params.workflowMode === 'multi_merge') {
          if (hTokens.length >= 2 && b.tokens.length >= 2) {
            if (computeJaccardSimilarity(b.tokens, hTokens) >= 0.45) return true;
          }
          // Cross-file semantic domain unification when headings use different wording for the same remap subsystem
          if (topicRule && bucketTopicKey.get(b.id) === topicRule.key) {
            const bHasDifferentFile = b.units.some((bu) => bu.sourceFileId !== u.sourceFileId);
            if (bHasDifferentFile || hTokens.length <= 4) {
              return true;
            }
          }
        }
        return false;
      });

      if (!bucket) {
        bucket = {
          id: `node_${params.projectId}_${buckets.length + 1}`,
          title: heading,
          tokens: hTokens,
          isMaster: false,
          units: [],
        };
        buckets.push(bucket);
        bucketTopicKey.set(bucket.id, topicRule?.key ?? null);
        bucketRank.set(bucket.id, topicRule?.pedagogicalRank ?? 55);
      } else if (heading.length > bucket.title.length && heading.length <= 72 && bucket.title.length < 18) {
        // Prefer the more descriptive chapter heading when merging cross-file buckets
        bucket.title = heading;
        bucket.tokens = Array.from(new Set([...bucket.tokens, ...hTokens]));
      }
      bucket.units.push(u);
    }

    // In multi_merge with many fragmented tiny 1-unit stub buckets from messy files,
    // fold single-unit stubs into their closest semantic chapter (100% zero-loss: every unit is kept!)
    if (params.workflowMode === 'multi_merge' && buckets.length > 8) {
      for (let i = buckets.length - 1; i >= 0; i--) {
        const stub = buckets[i];
        if (stub.units.length !== 1 || buckets.length <= 6) continue;
        const stubTokens = tokenizeContent(`${stub.title} ${stub.units[0].rawText.slice(0, 180)}`);
        let bestTargetIdx = -1;
        let bestSim = 0;
        for (let j = 0; j < buckets.length; j++) {
          if (j === i || buckets[j].units.length < 2) continue;
          const targetTokens = buckets[j].tokens.concat(
            buckets[j].units.slice(0, 3).flatMap((bu) => tokenizeContent(bu.rawText.slice(0, 120)))
          );
          const sim = computeJaccardSimilarity(stubTokens, targetTokens);
          if (sim > bestSim) {
            bestSim = sim;
            bestTargetIdx = j;
          }
        }
        if (bestTargetIdx !== -1 && bestSim >= 0.14) {
          buckets[bestTargetIdx].units.push(...stub.units);
          buckets.splice(i, 1);
        }
      }
    }

    // Pedagogical curriculum ordering for multi_merge across >=2 distinct source files
    // (keeps original order within the same domain rank so numbered lessons stay chronological!)
    const distinctSourceFileCount = new Set(activeUnits.map((u) => u.sourceFileId)).size;
    if (params.workflowMode === 'multi_merge' && distinctSourceFileCount >= 2 && buckets.length >= 3) {
      const originalIndex = new Map(buckets.map((b, idx) => [b.id, idx]));
      buckets.sort((a, b) => {
        const ra = bucketRank.get(a.id) ?? 55;
        const rb = bucketRank.get(b.id) ?? 55;
        if (ra !== rb) return ra - rb;
        return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
      });
    }
  }

  if (buckets.length === 0) {
    buckets.push({
      id: `node_${params.projectId}_1`,
      title: 'فصل اول — محتوای سند',
      tokens: [],
      isMaster: false,
      units: [],
    });
  }

  const nodes = buckets.map((b, idx) => {
    const fileNames = Array.from(
      new Set(b.units.map((u) => fileMap.get(u.sourceFileId)?.fileName).filter(Boolean))
    );
    return {
      id: b.id,
      projectId: params.projectId,
      parentId: null,
      level: 1,
      nodeOrder: idx + 1,
      title: b.title,
      summary: `${toPersianDigits(b.units.length)} واحد محتوایی از ${toPersianDigits(Math.max(1, fileNames.length))} فایل منبع`,
      isApproved: false,
    };
  });

  const unitAssignments: Array<{ unitId: string; outlineNodeId: string }> = [];
  for (const b of buckets) {
    for (const u of b.units) {
      unitAssignments.push({ unitId: u.id, outlineNodeId: b.id });
    }
  }

  return { nodes, unitAssignments };
}

// ============================================================================
// STAGE 4 & 5: FINAL BOOK ASSEMBLY, VISUAL ENRICHMENT & 100% COVERAGE AUDIT
// ============================================================================

export interface FinalizePipelineOutput {
  book: ParsedBook;
  audit: {
    id: string;
    projectId: string;
    totalSourceFiles: number;
    totalInputUnits: number;
    uniqueUnitsPreserved: number;
    duplicatesMerged: number;
    conflictsDetected: number;
    conflictsResolved: number;
    coveragePercent: number;
    detailsJson: Record<string, unknown>;
  };
}

export function assembleFinalBookAndAudit(params: {
  projectId: string;
  projectTitle: string;
  workflowMode: WorkflowMode;
  config: DocxExportConfig;
  sourceFiles: SourceFileDto[];
  units: ContentUnitDto[];
  clusters: DedupClusterDto[];
  conflicts: ConflictDto[];
  outlineNodes: OutlineNodeDto[];
}): FinalizePipelineOutput {
  const fileMap = new Map(params.sourceFiles.map((f) => [f.id, f]));
  const clusterByCanonical = new Map(params.clusters.map((c) => [c.canonicalUnitId, c]));
  const unitMap = new Map(params.units.map((u) => [u.id, u]));

  const orderedNodes = [...params.outlineNodes].sort((a, b) => a.nodeOrder - b.nodeOrder);
  const activeUnits = params.units.filter((u) => u.status !== 'merged');

  // Map units to outline nodes (fallback to first node so zero units are ever orphaned!)
  const nodeUnitsMap = new Map<string, ContentUnitDto[]>();
  for (const node of orderedNodes) {
    nodeUnitsMap.set(node.id, []);
  }
  for (const u of activeUnits) {
    const targetNodeId =
      u.outlineNodeId && nodeUnitsMap.has(u.outlineNodeId)
        ? u.outlineNodeId
        : orderedNodes[0]?.id;
    if (targetNodeId) {
      nodeUnitsMap.get(targetNodeId)!.push(u);
    }
  }

  const chapters: ChapterNode[] = [];
  const placedUnitIds = new Set<string>();
  const tableIndex: ParsedBook['tableIndex'] = [];
  let tableSeq = 0;

  orderedNodes.forEach((node, idx) => {
    const chapterNum = idx + 1;
    const nodeUnits = nodeUnitsMap.get(node.id) || [];

    // Group units inside this chapter by sub-heading (second segment of headingPath)
    const sectionBuckets = new Map<string, ContentUnitDto[]>();
    const introUnits: ContentUnitDto[] = [];

    for (const u of nodeUnits) {
      placedUnitIds.add(u.id);
      const parts = (u.headingPath || '').split('>').map((s) => s.trim()).filter(Boolean);
      const subHeading = parts.length >= 2 ? parts.slice(1).join(' — ') : '';
      if (!subHeading) {
        introUnits.push(u);
      } else {
        if (!sectionBuckets.has(subHeading)) sectionBuckets.set(subHeading, []);
        sectionBuckets.get(subHeading)!.push(u);
      }
    }

    const toContentBlock = (u: ContentUnitDto): ContentBlock => {
      const ownFile = fileMap.get(u.sourceFileId)?.fileName || 'سند منبع';
      const cluster = clusterByCanonical.get(u.id);
      const mergedFiles = cluster
        ? cluster.mergedUnitIds
            .map((mid) => {
              const mu = unitMap.get(mid);
              return mu ? fileMap.get(mu.sourceFileId)?.fileName : undefined;
            })
            .filter((x): x is string => Boolean(x))
        : [];
      const provenanceFiles = Array.from(new Set([ownFile, ...mergedFiles]));
      const provenanceUnitIds = [u.id, ...(cluster?.mergedUnitIds || [])];

      const storedBlock = u.metadataJson?.block as ContentBlock | undefined;
      if (storedBlock && typeof storedBlock === 'object' && 'type' in storedBlock) {
        if (storedBlock.type === 'paragraph') {
          return {
            ...storedBlock,
            id: u.id,
            text: u.rawText,
            sourceFileNames: provenanceFiles,
            sourceUnitIds: provenanceUnitIds,
          };
        }
        return {
          ...storedBlock,
          id: u.id,
          sourceFileNames: provenanceFiles,
          sourceUnitIds: provenanceUnitIds,
        };
      }

      return {
        type: 'paragraph',
        id: u.id,
        text: u.rawText,
        sourceFileNames: provenanceFiles,
        sourceUnitIds: provenanceUnitIds,
      };
    };

    const introBlocks: ContentBlock[] = introUnits.map(toContentBlock);
    const sections: SectionNode[] = [];
    let secSeq = 0;

    for (const [secTitle, secUnits] of sectionBuckets.entries()) {
      secSeq += 1;
      const blocks = secUnits.map(toContentBlock);
      const secFiles = Array.from(
        new Set(
          blocks.flatMap((b) => b.sourceFileNames || [])
        )
      );
      sections.push({
        id: `sec_${chapterNum}_${secSeq}`,
        numberLabel: `${toPersianDigits(chapterNum)}-${toPersianDigits(secSeq)}`,
        title: secTitle,
        originalTitle: secTitle,
        sourceFileName: secFiles[0],
        sourceFileNames: secFiles,
        blocks,
      });
    }

    // If chapter has only introBlocks and no sections, wrap them in a clean first section for Word Heading 3 navigation
    if (sections.length === 0 && introBlocks.length > 0) {
      const files = Array.from(new Set(introBlocks.flatMap((b) => b.sourceFileNames || [])));
      sections.push({
        id: `sec_${chapterNum}_1`,
        numberLabel: `${toPersianDigits(chapterNum)}-۱`,
        title: `شرح و جزئیات ${node.title}`,
        originalTitle: node.title,
        sourceFileName: files[0],
        sourceFileNames: files,
        blocks: introBlocks.splice(0, introBlocks.length),
      });
    }

    // Append chapter-relevant Conflict comparison boxes (Zero-Loss conflict transparency)
    const chapterUnitIdSet = new Set(nodeUnits.map((u) => u.id));
    const chapterConflicts = params.conflicts.filter(
      (c) =>
        (c.unitAId && chapterUnitIdSet.has(c.unitAId)) ||
        (c.unitBId && chapterUnitIdSet.has(c.unitBId))
    );
    for (const conf of chapterConflicts) {
      if (conf.status === 'open' || conf.status === 'keep_both' || conf.status === 'resolved_web') {
        const targetBlocks = sections[sections.length - 1]?.blocks ?? introBlocks;
        targetBlocks.push({
          type: 'conflict_note',
          id: `cblk_${conf.id}`,
          conflictId: conf.id,
          topic: conf.topic,
          fileAName: conf.fileAName,
          excerptA: conf.excerptA,
          fileBName: conf.fileBName,
          excerptB: conf.excerptB,
          status: conf.status,
          resolutionNote: conf.resolutionNote ?? undefined,
          webSummary: conf.webGroundingJson?.summary,
          webSources: conf.webGroundingJson?.sources,
          sourceFileNames: [conf.fileAName, conf.fileBName],
        });
      }
    }

    // Append isolated Google Search Web Enrichment box if present on this outline node
    if (node.webEnrichmentJson && node.webEnrichmentJson.summary) {
      const targetBlocks = sections[sections.length - 1]?.blocks ?? introBlocks;
      targetBlocks.push({
        type: 'web_enrichment',
        id: `web_${node.id}`,
        title: node.webEnrichmentJson.title || node.title,
        summary: node.webEnrichmentJson.summary,
        sources: node.webEnrichmentJson.sources || [],
        checkedAt: node.webEnrichmentJson.checkedAt || new Date().toISOString(),
      });
    }

    // Modular visual enrichment: auto-insert concise summary diagram when enabled and chapter has >= 3 sections
    if (params.config.optimization.embedGeneratedTablesAndDiagrams && sections.length >= 2) {
      const diagramItems = sections.slice(0, 5).map((s) => ({
        label: s.title.slice(0, 34),
        detail: `${toPersianDigits(s.blocks.length)} بلوک محتوا`,
      }));
      const svgMarkup = buildDiagramSvg(
        'process_steps',
        `نقشه ساختار ${node.title}`,
        diagramItems,
        'ساختار یکپارچه فصل'
      );
      const diagramBlock: DiagramBlock = {
        type: 'diagram',
        id: `diag_ch_${chapterNum}`,
        kind: 'process_steps',
        title: `نقشه ساختار ${node.title}`,
        caption: `شکل ${toPersianDigits(chapterNum)}-۱: ساختار یکپارچه مباحث فصل ${toPersianDigits(chapterNum)}`,
        rationale: 'ترسیم خودکار برای نمایش بصری سلسله‌مراتب فصل',
        items: diagramItems,
        svgMarkup,
        widthPx: 960,
        heightPx: 480,
        generatedBy: 'local',
      };
      sections[0].blocks.unshift(diagramBlock);
    }

    // Renumber tables sequentially across the chapter and record List of Tables
    let chTableNum = 0;
    const registerTables = (blocks: ContentBlock[], secTitle: string) => {
      for (const b of blocks) {
        if (b.type === 'table') {
          chTableNum += 1;
          tableSeq += 1;
          const tblNum = `${toPersianDigits(chapterNum)}-${toPersianDigits(chTableNum)}`;
          const cleanCap = (b.caption || `جدول داده‌های ${secTitle}`).replace(
            /^جدول\s*[۰-۹0-9]+[-–][۰-۹0-9]+\s*[:：-]?\s*/,
            ''
          );
          (b as TableBlock).caption = `جدول ${tblNum}: ${cleanCap}`;
          tableIndex.push({
            tableNumber: tblNum,
            caption: (b as TableBlock).caption!,
            chapterNumber: chapterNum,
            chapterTitle: node.title,
            sectionTitle: secTitle,
            generatedBy: b.generatedBy,
          });
        }
      }
    };
    registerTables(introBlocks, node.title);
    sections.forEach((s) => registerTables(s.blocks, s.title));

    const chapterFiles = Array.from(
      new Set(nodeUnits.map((u) => fileMap.get(u.sourceFileId)?.fileName).filter((x): x is string => Boolean(x)))
    );

    const cleanTitle = node.title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：-]?\s*/, '').trim();
    chapters.push({
      id: node.id,
      chapterNumber: chapterNum,
      title: `فصل ${toPersianDigits(chapterNum)}: ${cleanTitle}`,
      volumeIndex: 1,
      volumeTitle: params.projectTitle || 'مجموعه جامع مستندات',
      meta: [
        { label: 'تعداد زیربخش‌ها', value: `${toPersianDigits(sections.length)} زیربخش` },
        { label: 'واحدهای یکتای حفظ‌شده', value: `${toPersianDigits(nodeUnits.length)} واحد` },
        {
          label: 'فایل‌های منبع فصل',
          value: chapterFiles.length > 0 ? chapterFiles.join('، ') : 'سند اصلی',
        },
      ],
      introBlocks,
      sections,
      sourceFileName: chapterFiles[0] || params.sourceFiles[0]?.fileName || 'سند اصلی',
    });
  });

  const mergedCount = params.units.filter((u) => u.status === 'merged').length;
  const uniqueUnitsCount = activeUnits.length;
  const coveragePercent =
    uniqueUnitsCount === 0 ? 100 : Math.min(100, Math.round((placedUnitIds.size / uniqueUnitsCount) * 100));

  const resolvedConflictsCount = params.conflicts.filter((c) => c.status !== 'open').length;

  const totalRawWords = params.units.reduce(
    (sum, u) => sum + u.rawText.split(/\s+/).filter(Boolean).length,
    0
  );
  const totalOutWords = activeUnits.reduce(
    (sum, u) => sum + u.rawText.split(/\s+/).filter(Boolean).length,
    0
  );

  const workflowLabels: Record<WorkflowMode, string> = {
    single_polish: 'پالایش و صفحه‌آرایی تک‌فایل',
    multi_merge: 'ادغام بدون افت چندفایلی (Zero-Loss)',
    master_update: 'به‌روزرسانی سند مرجع (Master Update)',
    raw_synthesis: 'تبدیل یادداشت خام به سند رسمی',
  };

  const book: ParsedBook = {
    title: params.projectTitle || 'سند یکپارچه و صفحه‌آرایی‌شده',
    subtitle: `${workflowLabels[params.workflowMode]} — ${toPersianDigits(params.sourceFiles.length)} فایل منبع با پوشش ${toPersianDigits(coveragePercent)}٪`,
    editionNote: 'تولید و ممیزی‌شده با موتور یکپارچه‌سازی بدون افت (فونت وزیر مدیوم · راست‌چین استاندارد)',
    sourceFiles: params.sourceFiles.map((f) => f.fileName),
    volumes: [
      {
        id: 'vol_1',
        index: 1,
        title: params.projectTitle || 'متن جامع سند',
      },
    ],
    chapters,
    footnotes: [],
    glossary: [],
    tableIndex,
    cheatSheets: [],
    visualSuggestions: [],
    sourceMapRows: params.sourceFiles.map((f, idx) => [
      toPersianDigits(idx + 1),
      f.fileName,
      f.fileRole === 'master' ? 'مرجع (Master)' : f.fileRole === 'supplement' ? 'تکمیلی' : 'استاندارد',
      `${toPersianDigits(f.unitCount)} واحد`,
    ]),
    audit: {
      rawWordCount: totalRawWords,
      optimizedWordCount: totalOutWords,
      rawBlockCount: params.units.length,
      optimizedBlockCount: uniqueUnitsCount,
      rawFootnoteCount: 0,
      optimizedFootnoteCount: 0,
      duplicateFootnotesMerged: 0,
      duplicateBlocksConsolidated: mergedCount,
      tablesRenumbered: tableSeq,
      unnumberedSectionsFixed: 0,
      artifactsRepaired: 0,
      generatedTablesInserted: 0,
      generatedDiagramsInserted: chapters.reduce(
        (sum, ch) => sum + ch.sections.reduce((s2, sec) => s2 + sec.blocks.filter((b) => b.type === 'diagram').length, 0),
        0
      ),
      glossaryEntriesCount: 0,
      visualSuggestionsCount: 0,
      conceptRetentionRate: coveragePercent,
      conceptChecks: [],
      records: params.clusters.map((c) => ({
        id: c.id,
        category: 'thematic_merge',
        categoryLabel: c.matchType === 'lossless_union' ? 'ادغام بدون افت' : 'حذف تکرار کامل',
        location: c.canonicalUnitId,
        canonicalLocation: c.canonicalUnitId,
        summary: c.losslessSummary || 'ادغام واحدهای هم‌پوشان',
        beforeSnippet: `${toPersianDigits(c.mergedUnitIds.length + 1)} واحد ورودی`,
        afterSnippet: '۱ واحد جامع یکپارچه بدون حذف جزئیات',
        conceptsPreserved: true,
      })),
    },
  };

  // Deterministic Post-Merge ECU Technical Entity Integrity Audit (0% AI — verifies 100% hex/DTC/ECU/map retention)
  const technicalIntegrity = runTechnicalEntityIntegrityAudit(
    params.units.map((u) => u.rawText),
    book
  );

  // Deterministic Statistical Discrepancy Analyzer across Data Tables & Charts between file versions
  const numericDiscrepancyReport = analyzeNumericDiscrepancies({
    sourceFiles: params.sourceFiles,
    units: params.units,
  });

  // Deterministic WinOLS Map Modification Detector & Quick-Action Table Generator
  const winolsGuideReport = extractWinolsMapGuides({
    sourceFiles: params.sourceFiles,
    units: params.units,
  });

  if (
    params.config.includeWinolsActionTables !== false &&
    winolsGuideReport.summaryTable &&
    winolsGuideReport.mapsDetected > 0
  ) {
    const appendixChapterNum = chapters.length + 1;
    const winolsTableNum = `${toPersianDigits(appendixChapterNum)}-۱`;
    const summaryTable: TableBlock = {
      ...winolsGuideReport.summaryTable,
      caption: `جدول ${winolsTableNum}: راهنمای سریع تغییرات نقشه‌های WinOLS (استخراج خودکار از جزوه‌های پروژه)`,
    };
    tableSeq += 1;
    tableIndex.push({
      tableNumber: winolsTableNum,
      caption: summaryTable.caption!,
      chapterNumber: appendixChapterNum,
      chapterTitle: 'پیوست کارگاهی: راهنمای سریع تغییرات نقشه‌های WinOLS',
      sectionTitle: 'جدول جامع مپ‌ها، آدرس‌های هگز و نواحی هدف تغییر',
      generatedBy: 'local',
    });

    const stepItems = winolsGuideReport.entries.map((entry) => {
      const hexPart = entry.hexAddresses.length > 0 ? ` (آدرس ${entry.hexAddresses[0]})` : '';
      return `${entry.mapCode}${hexPart}: ${entry.targetZoneLabelFa} ← مقدار پیشنهادی: ${entry.recommendedDeltaLabel}`;
    });

    chapters.push({
      id: 'ch_winols_quick_guide',
      chapterNumber: appendixChapterNum,
      title: `فصل ${toPersianDigits(appendixChapterNum)}: پیوست کارگاهی — راهنمای سریع تغییرات نقشه‌های WinOLS`,
      volumeIndex: 1,
      volumeTitle: params.projectTitle || 'مجموعه جامع مستندات',
      meta: [
        { label: 'نقشه‌های شناسایی‌شده', value: `${toPersianDigits(winolsGuideReport.mapsDetected)} نقشه WinOLS` },
        { label: 'روش تولید جدول', value: 'استخراج قطعی از متن و جداول پروژه (۰٪ خطای توهم)' },
        { label: 'کاربرد عملی', value: 'مراجعه سریع روی میز کار WinOLS و بررسی چک‌لیست ایمنی' },
      ],
      introBlocks: [
        {
          type: 'callout',
          id: 'callout_winols_guide_intro',
          variant: 'engineering',
          title: 'راهنمای استفاده سریع از این جدول در نرم‌افزار WinOLS',
          paragraphs: [
            `این پیوست به‌صورت خودکار از میان ${toPersianDigits(params.sourceFiles.length)} فایل جزوه پروژه استخراج شده است تا هنگام باز کردن دامپ در WinOLS دقیقاً بدانید کدام نقشه‌ها، در چه محدوده دور موتور (RPM) و بار (Load) و به چه میزان باید اصلاح شوند.`,
            'همواره پیش از اعمال تغییرات، از فایل اصلی (Ori) بکاپ بگیرید، سطح نقشه را در نمای 3D از نظر نبود پله‌های تیز بررسی کنید و Checksum فایل خروجی را تصحیح نمایید.',
          ],
        },
      ],
      sections: [
        {
          id: 'sec_winols_master_table',
          numberLabel: `${toPersianDigits(appendixChapterNum)}-۱`,
          title: 'جدول جامع مپ‌ها، آدرس‌های هگز و نواحی هدف تغییر',
          originalTitle: 'جدول جامع مپ‌ها، آدرس‌های هگز و نواحی هدف تغییر',
          blocks: [
            summaryTable,
            {
              type: 'subheading',
              id: 'sub_winols_steps',
              level: 3,
              text: 'خلاصه گام‌های انتخاب ناحیه هدف در WinOLS',
            },
            {
              type: 'list',
              id: 'list_winols_steps',
              ordered: true,
              items: stepItems,
            },
          ],
        },
      ],
      sourceFileName: 'تولید خودکار از فایل‌های پروژه',
    });

    if (book.audit) {
      book.audit.tablesRenumbered = tableSeq;
      book.audit.generatedTablesInserted = (book.audit.generatedTablesInserted || 0) + 1;
    }
  }

  const winolsGoogleCoverage = analyzeWinolsGoogleEnrichment({
    entries: winolsGuideReport.entries,
    book,
    outlineNodes: params.outlineNodes,
  });

  return {
    book,
    audit: {
      id: `aud_${params.projectId}`,
      projectId: params.projectId,
      totalSourceFiles: params.sourceFiles.length,
      totalInputUnits: params.units.length,
      uniqueUnitsPreserved: placedUnitIds.size,
      duplicatesMerged: mergedCount,
      conflictsDetected: params.conflicts.length,
      conflictsResolved: resolvedConflictsCount,
      coveragePercent,
      detailsJson: {
        workflowMode: params.workflowMode,
        chapterCount: chapters.length,
        tableCount: tableSeq,
        technicalIntegrity,
        numericDiscrepancyReport,
        winolsGuideReport,
        winolsGoogleCoverage,
        perFileCoverage: params.sourceFiles.map((f) => {
          const fUnits = params.units.filter((u) => u.sourceFileId === f.id);
          const fCovered = fUnits.filter(
            (u) => placedUnitIds.has(u.id) || (u.canonicalUnitId && placedUnitIds.has(u.canonicalUnitId))
          );
          return {
            fileId: f.id,
            fileName: f.fileName,
            role: f.fileRole,
            totalUnits: fUnits.length,
            coveredUnits: fCovered.length,
            coveragePercent: fUnits.length === 0 ? 100 : Math.round((fCovered.length / fUnits.length) * 100),
          };
        }),
      },
    },
  };
}
