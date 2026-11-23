import {
  extractEcuPlatforms,
  extractTechnicalEntities,
} from '../ecuTechnicalIntegrity.ts';
import { toAsciiDigits } from '../formatParsers.ts';
import { computeJaccardSimilarity, tokenizeContent } from '../zeroLossPipeline.ts';
import type {
  HarnessSourceChunk,
  Layer1AuditResult,
  Layer1Issue,
  LivingGlossary,
  SemanticBlock,
  SemanticSectionIR,
} from './types.ts';

const HTML_OR_CSS_MARKUP_RX =
  /<\s*\/?\s*(?:div|span|p|br|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|style|script|font|b|i|strong|em|img|a)\b[^>]*>|style\s*=\s*["'][^"']*["']|class\s*=\s*["'][^"']*["']/i;

const HEX_TOKEN_RX = /(?:0[xX][0-9A-Fa-f]{2,8}|\$[0-9A-Fa-f]{3,8})\b/g;
const MAP_DIM_RX = /\b\d{1,2}\s*[xX×]\s*\d{1,2}\b/g;

// Critical automotive/ECU safety warning triggers (evaluated on normalized Persian)
const SAFETY_WARNING_KEYWORDS_RX =
  /(?:سوختن|ناک|ایموبلایزر|ایموبیلایزر|قفل\s*شدن|چک\s*سام|چکسام|بکاپ|پشتیبان\s*گیری|اتصال\s*کوتاه|خطر|هشدار)/;

// Fake numeric cross-references like "جدول ۳-۲", "شکل زیر", "نمودار ۲-۱"
const FAKE_TABLE_REF_RX = /جدول\s+\d+(?:\s*[-–.]\s*\d+)?/g;
const FAKE_FIGURE_REF_RX = /(?:شکل|تصویر|نمودار)\s+(?:زیر|بالا|مقابل|\d+(?:\s*[-–.]\s*\d+)?)/g;
const STRUCTURAL_REF_TOKEN_RX = /\[\[ref:([A-Za-z0-9_.:-]+)\]\]/g;

// Unit synonym canonicalization (STRICTLY same-unit spelling only — NEVER cross-unit conversion!)
const UNIT_SYNONYM_MAP: Record<string, string> = {
  '°': 'deg',
  deg: 'deg',
  ca: 'deg',
  btdc: 'deg_btdc',
  atdc: 'deg_atdc',
  درجه: 'deg',
  '°c': 'deg_c',
  '°f': 'deg_f',
  rpm: 'rpm',
  'دور بر دقیقه': 'rpm',
  دور: 'rpm',
  ms: 'ms',
  'میلی ثانیه': 'ms',
  bar: 'bar',
  بار: 'bar',
  psi: 'psi',
  kpa: 'kpa',
  کیلوپاسکال: 'kpa',
  mbar: 'mbar',
  hpa: 'mbar',
  v: 'v',
  ولت: 'v',
  mv: 'mv',
  'میلی ولت': 'mv',
  '%': 'pct',
  درصد: 'pct',
  λ: 'lambda',
  lambda: 'lambda',
  لامبدا: 'lambda',
  afr: 'afr',
  'mg/str': 'mg_str',
  'mg/stroke': 'mg_str',
  'mg/stk': 'mg_str',
  'mg/hub': 'mg_str',
  'g/s': 'g_s',
  'kg/h': 'kg_h',
  nm: 'nm',
  'نیوتن متر': 'nm',
  kw: 'kw',
  کیلووات: 'kw',
  hp: 'hp',
  'اسب بخار': 'hp',
  hz: 'hz',
  khz: 'khz',
  mhz: 'mhz',
  kbps: 'kbps',
  baud: 'baud',
};

const MEASUREMENT_TRIPLE_RX =
  /([+-])?\s*(\d+(?:\.\d+)?)\s*(°[CFcf]|°|mg\/stroke|mg\/str|mg\/stk|mg\/hub|kg\/h|g\/s|BTDC|ATDC|RPM|rpm|bar|BAR|psi|PSI|kPa|kpa|mbar|hPa|ms|mV|V|kHz|MHz|Hz|Nm|kW|hp|AFR|afr|lambda|λ|kbps|baud|deg|CA|%|میلی[\s\u200c]*ثانیه|میلی[\s\u200c]*ولت|دور\s+بر\s+دقیقه|نیوتن[\s\u200c]*متر|اسب\s+بخار|کیلوپاسکال|کیلووات|درجه|درصد|لامبدا|ولت|بار)(?![A-Za-z0-9\u0600-\u06FF])/g;

function countWords(text: string): number {
  const cleaned = (text || '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministic Persian, Arabic, Invisible-Char & Digit Normalizer.
 * Eliminates False Positives on ي/ی, ك/ک, tatweel (ـ), invisible BiDi/BOM chars, half-spaces, and Persian digits.
 */
export function normalizePersianStrict(input: string): string {
  return toAsciiDigits(input || '')
    .replace(/\u0640/g, '') // Tatweel / Kashida (e.g., ايسيـو -> ایسیو)
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g, '') // Invisible control/BiDi chars
    .replace(/[يیى]/g, 'ی')
    .replace(/[كک]/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/٫/g, '.') // Persian decimal separator
    .replace(/٬/g, ',') // Persian thousands separator
    .replace(/\s*\u200c\s*/g, '\u200c') // Standardize half-space (ZWNJ)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes text for glossary comparison by collapsing ZWNJ to empty/space-insensitive tokens
 * so "ای‌سی‌یو" / "ايسيـو" / "ایسیو" all align cleanly.
 */
export function normalizeForGlossaryMatch(input: string): string {
  return normalizePersianStrict(input)
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Canonicalizes hex addresses regardless of case, `$` vs `0x` prefix, or leading zeros:
 * `0x001A4F` == `0x1a4f` == `$1A4F` -> `0x1A4F`.
 */
export function canonicalizeHexAddress(raw: string): string {
  const ascii = toAsciiDigits(raw || '').trim();
  const stripped = ascii.replace(/^(?:0[xX]|\$)/, '').replace(/^0+(?=[0-9A-Fa-f])/, '');
  return `0x${(stripped || '0').toUpperCase()}`;
}

/**
 * Canonicalizes decimal numbers: `۱۴.۷۰` == `14.70` == `14.7` -> `14.7`.
 */
export function canonicalizeDecimalNumber(raw: string): string {
  const ascii = toAsciiDigits(raw || '')
    .replace(/٫/g, '.')
    .trim();
  const num = Number(ascii);
  if (!Number.isFinite(num)) return ascii;
  // Convert without scientific notation artifacts for typical ECU calibration ranges
  return String(num);
}

/**
 * Canonicalizes calibration map dimensions: `۱۶×۱۶` == `16 X 16` == `16x16` -> `16x16`.
 */
export function canonicalizeMapDimension(raw: string): string {
  const ascii = toAsciiDigits(raw || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('×', 'x');
  const parts = ascii.split('x');
  if (parts.length === 2) {
    return `${Number(parts[0])}x${Number(parts[1])}`;
  }
  return ascii;
}

export interface MeasurementTriple {
  sign: '+' | '-' | '';
  value: string;
  unit: string;
  raw: string;
  key: string;
}

export function extractMeasurementTriples(text: string): MeasurementTriple[] {
  const normalized = normalizePersianStrict(text).replace(/\u200c/g, ' ');
  const triples: MeasurementTriple[] = [];
  MEASUREMENT_TRIPLE_RX.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = MEASUREMENT_TRIPLE_RX.exec(normalized)) !== null) {
    const sign = (m[1] === '+' || m[1] === '-' ? m[1] : '') as '+' | '-' | '';
    const value = canonicalizeDecimalNumber(m[2]);
    const rawUnit = m[3].trim().toLowerCase().replace(/\s+/g, ' ');
    const unit = UNIT_SYNONYM_MAP[rawUnit] || rawUnit;
    const key = `${sign}${value}|${unit}`;
    triples.push({ sign, value, unit, raw: m[0].trim(), key });
  }
  return triples;
}

export function flattenSemanticBlockText(block: SemanticBlock): string {
  const parts: string[] = [];
  if (block.title) parts.push(block.title);
  if (block.text) parts.push(block.text);
  if (Array.isArray(block.items)) parts.push(...block.items);
  if (Array.isArray(block.headers)) parts.push(...block.headers);
  if (Array.isArray(block.rows)) {
    for (const row of block.rows) {
      if (Array.isArray(row)) parts.push(...row);
    }
  }
  if (block.readable) parts.push(block.readable);
  if (block.latex) parts.push(block.latex);
  if (block.gapReason) parts.push(block.gapReason);
  if (block.missingInfo) parts.push(block.missingInfo);
  if (block.conflictTopic) parts.push(block.conflictTopic);
  if (block.conflictSourceA) parts.push(block.conflictSourceA);
  if (block.conflictSourceB) parts.push(block.conflictSourceB);
  if (block.caption) parts.push(block.caption);
  return parts.join(' ').trim();
}

interface ExtractedAnchorSet {
  hexAddresses: Set<string>;
  dtcCodes: Set<string>;
  ecuModels: Set<string>;
  ecuPlatforms: Set<string>;
  mapIdentifiers: Set<string>;
  mapDimensions: Set<string>;
  measurements: MeasurementTriple[];
  measurementKeys: Set<string>;
  measurementUnits: Set<string>;
  measurementByValueAndUnit: Map<string, Set<'+' | '-' | ''>>;
  measurementByValue: Map<string, Set<string>>;
}

function extractExtendedEcuAnchors(text: string): ExtractedAnchorSet {
  const normalized = normalizePersianStrict(text);
  const base = extractTechnicalEntities(normalized);

  const hexAddresses = new Set<string>();
  for (const h of base.hexAddresses) {
    hexAddresses.add(canonicalizeHexAddress(h));
  }
  HEX_TOKEN_RX.lastIndex = 0;
  for (const m of normalized.matchAll(HEX_TOKEN_RX)) {
    hexAddresses.add(canonicalizeHexAddress(m[0]));
  }

  const mapDimensions = new Set<string>();
  MAP_DIM_RX.lastIndex = 0;
  for (const m of normalized.matchAll(MAP_DIM_RX)) {
    mapDimensions.add(canonicalizeMapDimension(m[0]));
  }

  const measurements = extractMeasurementTriples(normalized);
  const measurementKeys = new Set<string>();
  const measurementUnits = new Set<string>();
  const measurementByValueAndUnit = new Map<string, Set<'+' | '-' | ''>>();
  const measurementByValue = new Map<string, Set<string>>();

  for (const tr of measurements) {
    measurementKeys.add(tr.key);
    measurementUnits.add(tr.unit);

    const vuKey = `${tr.value}|${tr.unit}`;
    const signs = measurementByValueAndUnit.get(vuKey) || new Set<'+' | '-' | ''>();
    signs.add(tr.sign);
    measurementByValueAndUnit.set(vuKey, signs);

    const unitsForVal = measurementByValue.get(tr.value) || new Set<string>();
    unitsForVal.add(tr.unit);
    measurementByValue.set(tr.value, unitsForVal);
  }

  return {
    hexAddresses,
    dtcCodes: new Set(base.dtcCodes),
    ecuModels: new Set(base.ecuModels),
    ecuPlatforms: extractEcuPlatforms(normalized),
    mapIdentifiers: new Set(base.mapIdentifiers),
    mapDimensions,
    measurements,
    measurementKeys,
    measurementUnits,
    measurementByValueAndUnit,
    measurementByValue,
  };
}

/**
 * Strips pure ordinal / list-index numbers (e.g. "1. ", "۲) ", "گام ۱:", "مرحله 2")
 * from step_list items before checking standalone technical numbers.
 */
function stripStepListOrdinals(text: string): string {
  return normalizePersianStrict(text)
    .replace(/^\s*(?:(?:گام|مرحله|بند|نکته|مورد)\s*)?\d+\s*[.)\-–:]\s*/gm, '')
    .replace(/(?:گام|مرحله)\s+\d+/g, '')
    .replace(STRUCTURAL_REF_TOKEN_RX, '');
}

/**
 * Detects degenerate N-gram repetition loops inside a block (4-gram repeated >= 4 times
 * or consecutive identical sentences repeated >= 3 times).
 */
export function detectDegenerateRepetition(text: string): string | null {
  const normalized = normalizePersianStrict(text)
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s.؟!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Check consecutive duplicate sentences
  const sentences = normalized
    .split(/[.؟!\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);
  let consecutiveCount = 1;
  for (let i = 1; i < sentences.length; i++) {
    if (sentences[i] === sentences[i - 1]) {
      consecutiveCount += 1;
      if (consecutiveCount >= 3) {
        return sentences[i].slice(0, 60);
      }
    } else {
      consecutiveCount = 1;
    }
  }

  // Check 4-gram repetition counts
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 16) {
    const ngramCounts = new Map<string, number>();
    for (let i = 0; i <= words.length - 4; i++) {
      const gram = `${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`;
      const next = (ngramCounts.get(gram) || 0) + 1;
      if (next >= 4) {
        return gram;
      }
      ngramCounts.set(gram, next);
    }
  }

  return null;
}

/**
 * Extracts normalized header sets from any Markdown/pipe tables found inside sourceChunks.
 */
function extractSourceTableHeaderTokens(sourceText: string): Set<string> {
  const tokens = new Set<string>();
  const lines = (sourceText || '').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|.+\|\s*$/.test(lines[i]) && /^\s*\|[\s:-]+\|\s*$/.test(lines[i + 1])) {
      const cells = lines[i]
        .split('|')
        .map((c) => normalizeForGlossaryMatch(c))
        .filter(Boolean);
      for (const cell of cells) {
        for (const w of cell.split(/\s+/)) {
          if (w.length >= 2) tokens.add(w);
        }
      }
    }
  }
  return tokens;
}

export interface Layer1GuardOptions {
  /** Minimum output/source word ratio for pure prose (default 0.40) */
  minWordRatio?: number;
  /** Relaxed floor when 100% of technical entities are preserved on verbose spoken transcripts (default 0.25) */
  minWordRatioWhenEntitiesPreserved?: number;
  /** Maximum output/source word ratio to prevent excessive padding (default 3.8) */
  maxWordRatio?: number;
  /** Enforce that every source chunk is referenced by at least one block (default true) */
  requireAllChunksCovered?: boolean;
  /** Previous <= 5 subsections in the same chapter to catch cross-section intro/body duplication */
  previousChapterSectionsIR?: SemanticSectionIR[];
  /** Known blueprint section IDs to validate [[ref:sectionId]] tokens */
  knownSectionIds?: string[];
  /** Explicit ECU platform tags allowed for this subsection (if omitted, derived from sourceChunks) */
  allowedEcuPlatformTags?: string[];
}

/**
 * Deterministic Zero-Token Layer 1 Guard (Package A Red-Team Hardened — Automotive / ECU / WinOLS).
 * Covers:
 * - Strict Semantic IR schema + empty_blocks_output + zero HTML/CSS
 * - Persian/Arabic/Tatweel/ZWNJ/Decimal/Dimension/Hex normalization (zero False Positives)
 * - Strict (Sign + Number + Unit) triple matching & anti-unit-conversion
 * - ECU platform isolation (ecu_platform_mismatch)
 * - Mandatory callout_warning preservation for critical safety keywords
 * - Technical entity retention rate vs spoken-transcript filler words
 * - Rectangular table matrix integrity & header check
 * - N-gram repetition loop detection, excessive >30% gap bailout, broken numeric cross-refs,
 *   and cross-section Jaccard duplication against the last 5 subsections of the same chapter.
 */
export function runLayer1DeterministicGuard(
  sectionIR: SemanticSectionIR,
  sourceChunks: HarnessSourceChunk[],
  glossary?: LivingGlossary | null,
  options?: Layer1GuardOptions
): Layer1AuditResult {
  const issues: Layer1Issue[] = [];
  const invalidBlockSet = new Set<string>();

  const minWordRatio = options?.minWordRatio ?? 0.4;
  const minWordRatioEntities = options?.minWordRatioWhenEntitiesPreserved ?? 0.25;
  const maxWordRatio = options?.maxWordRatio ?? 3.8;
  const requireAllChunksCovered = options?.requireAllChunksCovered ?? true;

  const allowedChunkIds = new Set(sourceChunks.map((c) => c.id));
  const coveredChunkIds = new Set<string>();

  const sourceFullText = sourceChunks.map((c) => c.text).join('\n');
  const normalizedSourceFull = normalizePersianStrict(sourceFullText);
  const sourceWordCount = sourceChunks.reduce(
    (sum, c) => sum + (c.wordCount > 0 ? c.wordCount : countWords(c.text)),
    0
  );

  // Extract technical anchors STRICTLY from THIS subsection's source chunks (never bleed global glossary ECUs/Hex!)
  const sourceAnchors = extractExtendedEcuAnchors(sourceFullText);
  const allowedPlatforms = new Set<string>([
    ...sourceAnchors.ecuPlatforms,
    ...(options?.allowedEcuPlatformTags || []),
    ...sourceChunks.flatMap((c) => c.ecuPlatformTags || []),
  ]);

  // Identify source chunks containing critical safety warnings that MUST yield a callout_warning
  const safetyRequiredChunkIds = new Set<string>();
  for (const chunk of sourceChunks) {
    const normChunk = normalizePersianStrict(chunk.text).replace(/\u200c/g, ' ');
    if (SAFETY_WARNING_KEYWORDS_RX.test(normChunk)) {
      safetyRequiredChunkIds.add(chunk.id);
    }
  }
  const warningCoveredChunkIds = new Set<string>();

  // Extract source table headers if any markdown pipe tables exist in source chunks
  const sourceTableHeaderTokens = extractSourceTableHeaderTokens(sourceFullText);

  const blocks = Array.isArray(sectionIR.blocks) ? sectionIR.blocks : [];
  if (blocks.length === 0) {
    issues.push({
      id: 'l1-empty-blocks',
      kind: 'empty_blocks_output',
      severity: 'error',
      messageFa: 'خروجی زیربخش فاقد هرگونه بلوک معنایی است (empty_blocks_output).',
    });
  }

  const hasFigureRefInSection = blocks.some((b) => b.kind === 'figure_ref');
  const knownSectionIdSet = options?.knownSectionIds ? new Set(options.knownSectionIds) : null;

  let outputWordCount = 0;
  let checkedAnchorsCount = 0;
  let gapFlagCount = 0;
  const combinedOutputTexts: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockId = block?.id || `block-${i + 1}`;
    const flatText = flattenSemanticBlockText(block);
    const normalizedBlockText = normalizePersianStrict(flatText);
    combinedOutputTexts.push(flatText);
    outputWordCount += countWords(flatText);

    if (block.kind === 'source_gap_flag') {
      gapFlagCount += 1;
    }

    // 1. Structure validation per kind
    if (!block.id || !block.kind) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-struct-${blockId}`,
        kind: 'invalid_block_structure',
        severity: 'error',
        blockId,
        messageFa: `بلوک ${blockId} فاقد شناسه یا نوع معتبر Semantic IR است.`,
      });
    } else if (block.kind === 'table') {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (headers.length === 0 || rows.length === 0) {
        invalidBlockSet.add(blockId);
        issues.push({
          id: `l1-table-empty-${blockId}`,
          kind: 'invalid_table_matrix',
          severity: 'error',
          blockId,
          messageFa: `بلوک جدول (${blockId}) فاقد سرستون یا ردیف داده است.`,
        });
      } else {
        // Strict rectangular matrix check: every row.length === headers.length
        const malformedRowIdx = rows.findIndex(
          (r) => !Array.isArray(r) || r.length !== headers.length
        );
        if (malformedRowIdx >= 0) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-table-rect-${blockId}`,
            kind: 'invalid_table_matrix',
            severity: 'error',
            blockId,
            messageFa: `جدول ${blockId} مستطیلی نیست: ردیف ${malformedRowIdx + 1} دارای ${rows[malformedRowIdx]?.length ?? 0} ستون است اما سرستون ${headers.length} ستون دارد.`,
          });
        }

        // If source contained a structured table, verify headers aren't completely fabricated
        if (sourceTableHeaderTokens.size > 0) {
          const genHeaderTokens = headers
            .map((h) => normalizeForGlossaryMatch(h))
            .join(' ')
            .split(/\s+/)
            .filter((w) => w.length >= 2);
          const overlap = genHeaderTokens.filter(
            (w) => sourceTableHeaderTokens.has(w) || normalizeForGlossaryMatch(sourceFullText).includes(w)
          );
          if (genHeaderTokens.length > 0 && overlap.length === 0) {
            invalidBlockSet.add(blockId);
            issues.push({
              id: `l1-table-headers-${blockId}`,
              kind: 'invalid_table_matrix',
              severity: 'error',
              blockId,
              messageFa: `سرستون‌های جدول ${blockId} هیچ انطباقی با سرستون‌ها یا داده‌های جدول منبع ندارند.`,
            });
          }
        }
      }
    } else if (
      block.kind === 'step_list' &&
      (!Array.isArray(block.items) || block.items.filter((x) => x.trim()).length === 0)
    ) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-list-${blockId}`,
        kind: 'invalid_block_structure',
        severity: 'error',
        blockId,
        messageFa: `بلوک فهرست مراحل (${blockId}) خالی است.`,
      });
    } else if (block.kind === 'source_gap_flag' && !(block.gapReason || block.text || '').trim()) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-gap-${blockId}`,
        kind: 'invalid_block_structure',
        severity: 'error',
        blockId,
        messageFa: `بلوک اعلام نقص منبع (${blockId}) باید علت دقیق نقص اطلاعات را ذکر کند.`,
      });
    } else if (
      block.kind === 'source_conflict_flag' &&
      !(block.conflictTopic || block.title || block.text || '').trim()
    ) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-conflict-${blockId}`,
        kind: 'invalid_block_structure',
        severity: 'error',
        blockId,
        messageFa: `بلوک تناقض منابع (${blockId}) باید موضوع تناقض بین دو منبع را مشخص کند.`,
      });
    } else if (block.kind === 'figure_ref' && !(block.assetId || '').trim()) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-fig-${blockId}`,
        kind: 'invalid_block_structure',
        severity: 'error',
        blockId,
        messageFa: `بلوک ارجاع تصویر (${blockId}) فاقد شناسه assetId است.`,
      });
    } else if (
      (block.kind === 'paragraph' ||
        block.kind === 'heading' ||
        block.kind === 'callout_warning' ||
        block.kind === 'callout_tip') &&
      !flatText
    ) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-empty-text-${blockId}`,
        kind: 'invalid_block_structure',
        severity: 'error',
        blockId,
        messageFa: `متن بلوک ${blockId} (${block.kind}) خالی است.`,
      });
    }

    // 2. Zero HTML / CSS markup rule
    if (HTML_OR_CSS_MARKUP_RX.test(flatText)) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-html-${blockId}`,
        kind: 'html_markup_detected',
        severity: 'error',
        blockId,
        messageFa: `بلوک ${blockId} شامل تگ خام HTML یا استایل CSS است؛ مدل فقط مجاز به تولید Semantic IR خالص است.`,
      });
    }

    // 3. Degenerate N-gram repetition loop guard
    const repeatedGram = detectDegenerateRepetition(flatText);
    if (repeatedGram) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-repeat-${blockId}`,
        kind: 'degenerate_repetition_detected',
        severity: 'error',
        blockId,
        offendingToken: repeatedGram,
        messageFa: `تکرار چرخه‌ای و غیرطبیعی عبارت «${repeatedGram}» در بلوک ${blockId} شناسایی شد (degenerate_repetition_detected).`,
      });
    }

    // 4. Provenance / sourceChunkIds validation + safety warning coverage tracking
    const refs = Array.isArray(block.sourceChunkIds) ? block.sourceChunkIds.filter(Boolean) : [];
    if (refs.length === 0 && allowedChunkIds.size > 0) {
      invalidBlockSet.add(blockId);
      issues.push({
        id: `l1-nocite-${blockId}`,
        kind: 'missing_source_citation',
        severity: 'error',
        blockId,
        messageFa: `بلوک ${blockId} به هیچ شناسه قطعه منبع (sourceChunkIds) ارجاع نداده است.`,
      });
    } else {
      for (const refId of refs) {
        if (!allowedChunkIds.has(refId)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-badcite-${blockId}-${refId}`,
            kind: 'invalid_source_chunk_id',
            severity: 'error',
            blockId,
            offendingToken: refId,
            messageFa: `بلوک ${blockId} به شناسه نامعتبر «${refId}» ارجاع داده است که جزو قطعات تزریق‌شده این زیربخش نیست.`,
          });
        } else {
          coveredChunkIds.add(refId);
          if (block.kind === 'callout_warning') {
            warningCoveredChunkIds.add(refId);
          }
        }
      }
    }

    // 5. Technical Fact, Sign+Number+Unit, and ECU Platform Isolation Guard (skip meta-flag blocks)
    if (block.kind !== 'source_gap_flag' && block.kind !== 'source_conflict_flag') {
      // Strip pure ordinal numbering on step_list so "1. ... 2. ..." never causes false numeric positives
      const inspectText = block.kind === 'step_list' ? stripStepListOrdinals(flatText) : flatText;
      const blockAnchors = extractExtendedEcuAnchors(inspectText);

      // 5a. Hex addresses (canonicalized: 0x001A4F == 0x1a4f)
      for (const hex of blockAnchors.hexAddresses) {
        checkedAnchorsCount++;
        if (!sourceAnchors.hexAddresses.has(hex)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-halluc-hex-${blockId}-${hex}`,
            kind: 'hallucinated_technical_fact',
            severity: 'error',
            blockId,
            offendingToken: hex,
            messageFa: `آدرس هگز «${hex}» در بلوک ${blockId} در هیچ‌یک از قطعات منبع این زیربخش وجود ندارد (احتمال توهم فنی).`,
          });
        }
      }

      // 5b. OBD-II DTC codes
      for (const dtc of blockAnchors.dtcCodes) {
        checkedAnchorsCount++;
        if (!sourceAnchors.dtcCodes.has(dtc)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-halluc-dtc-${blockId}-${dtc}`,
            kind: 'hallucinated_technical_fact',
            severity: 'error',
            blockId,
            offendingToken: dtc,
            messageFa: `کد خطای OBD «${dtc}» در بلوک ${blockId} در قطعات منبع تزریق‌شده وجود ندارد.`,
          });
        }
      }

      // 5c. ECU Platform Isolation (ecu_platform_mismatch) & ECU Model codes
      for (const platform of blockAnchors.ecuPlatforms) {
        checkedAnchorsCount++;
        if (allowedPlatforms.size > 0 && !allowedPlatforms.has(platform)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-ecu-platform-${blockId}-${platform}`,
            kind: 'ecu_platform_mismatch',
            severity: 'error',
            blockId,
            offendingToken: platform,
            messageFa: `نشت پلتفرم ایسیو ناسازگار (${platform}) در بلوک ${blockId}: این زیربخش منحصراً متعلق به پلتفرم‌های [${Array.from(allowedPlatforms).join(', ')}] است.`,
          });
        }
      }
      for (const ecu of blockAnchors.ecuModels) {
        checkedAnchorsCount++;
        if (!sourceAnchors.ecuModels.has(ecu)) {
          const ecuPlatformMatchesAllowed = Array.from(extractEcuPlatforms(ecu)).some((p) =>
            allowedPlatforms.has(p)
          );
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-halluc-ecu-${blockId}-${ecu}`,
            kind: ecuPlatformMatchesAllowed ? 'hallucinated_technical_fact' : 'ecu_platform_mismatch',
            severity: 'error',
            blockId,
            offendingToken: ecu,
            messageFa: `مدل ایسیو «${ecu}» در بلوک ${blockId} در قطعات منبع این زیربخش وجود ندارد.`,
          });
        }
      }

      // 5d. WinOLS Map Identifiers
      for (const mapCode of blockAnchors.mapIdentifiers) {
        checkedAnchorsCount++;
        if (!sourceAnchors.mapIdentifiers.has(mapCode)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-halluc-map-${blockId}-${mapCode}`,
            kind: 'hallucinated_technical_fact',
            severity: 'error',
            blockId,
            offendingToken: mapCode,
            messageFa: `نام نقشه WinOLS «${mapCode}» در بلوک ${blockId} در قطعات منبع این زیربخش دیده نشده است.`,
          });
        }
      }

      // 5e. Calibration Map Dimensions (canonicalized: ۱۶×۱۶ == 16x16)
      for (const dim of blockAnchors.mapDimensions) {
        checkedAnchorsCount++;
        if (!sourceAnchors.mapDimensions.has(dim)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-halluc-dim-${blockId}-${dim}`,
            kind: 'hallucinated_technical_fact',
            severity: 'error',
            blockId,
            offendingToken: dim,
            messageFa: `ابعاد نقشه «${dim}» در بلوک ${blockId} در منابع این زیربخش ثبت نشده است.`,
          });
        }
      }

      // 5f. Strict (Sign + Number + Unit) Triple Guard & Anti-Unit-Conversion
      for (const tr of blockAnchors.measurements) {
        checkedAnchorsCount++;
        if (sourceAnchors.measurementKeys.has(tr.key)) {
          continue;
        }
        const vuKey = `${tr.value}|${tr.unit}`;
        const sourceSigns = sourceAnchors.measurementByValueAndUnit.get(vuKey);
        if (sourceSigns) {
          // Unsigned output matches unsigned source, OR explicit '+' matches unsigned source only if source wasn't negative
          const hasExplicitMinus = sourceSigns.has('-');
          const hasExplicitPlus = sourceSigns.has('+');
          const hasUnsigned = sourceSigns.has('');

          if (tr.sign === '' && hasUnsigned) continue;
          if (tr.sign === '+' && hasUnsigned && !hasExplicitMinus) continue;

          // Sign inversion detected! (e.g. -2.5° -> +2.5° or -2.5° -> 2.5° or +2.5° -> -2.5°)
          if (
            (hasExplicitMinus && tr.sign !== '-') ||
            (hasExplicitPlus && tr.sign === '-') ||
            (tr.sign === '-' && !hasExplicitMinus)
          ) {
            invalidBlockSet.add(blockId);
            issues.push({
              id: `l1-sign-${blockId}-${tr.raw}`,
              kind: 'sign_inversion_detected',
              severity: 'error',
              blockId,
              offendingToken: tr.raw,
              messageFa: `وارونگی علامت عددی در بلوک ${blockId}: مقدار «${tr.raw}» با علامت ثبت‌شده در منبع مغایرت دارد (sign_inversion_detected).`,
            });
            continue;
          }
        }

        // Check if same numeric value existed in source with a DIFFERENT unit (e.g. 1200 RPM -> 1200 ms)
        const sourceUnitsForVal = sourceAnchors.measurementByValue.get(tr.value);
        if (sourceUnitsForVal && !sourceUnitsForVal.has(tr.unit)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-unit-swap-${blockId}-${tr.raw}`,
            kind: 'unit_mismatch_or_conversion',
            severity: 'error',
            blockId,
            offendingToken: tr.raw,
            messageFa: `جابه‌جایی واحد در بلوک ${blockId}: عدد ${tr.value} با واحد «${tr.unit}» آمده اما در منبع با واحد [${Array.from(sourceUnitsForVal).join(', ')}] ثبت شده است.`,
          });
          continue;
        }

        // Check unsolicited unit conversion (e.g. bar -> psi or °C -> °F when target unit isn't in source at all)
        if (!sourceAnchors.measurementUnits.has(tr.unit)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-unit-conv-${blockId}-${tr.raw}`,
            kind: 'unit_mismatch_or_conversion',
            severity: 'error',
            blockId,
            offendingToken: tr.raw,
            messageFa: `تبدیل واحد سرخود یا واحد غیرمستند «${tr.raw}» در بلوک ${blockId}: واحد «${tr.unit}» در منبع این زیربخش وجود ندارد.`,
          });
          continue;
        }

        // Fabricated numeric measurement
        invalidBlockSet.add(blockId);
        issues.push({
          id: `l1-halluc-meas-${blockId}-${tr.raw}`,
          kind: 'hallucinated_technical_fact',
          severity: 'error',
          blockId,
          offendingToken: tr.raw,
          messageFa: `مقدار فنی «${tr.raw}» در بلوک ${blockId} در قطعات منبع تزریق‌شده وجود ندارد.`,
        });
      }
    }

    // 6. Broken / Fabricated Numeric Cross-Reference Guard + [[ref:sectionId]] Validator
    if (block.kind !== 'source_gap_flag' && block.kind !== 'source_conflict_flag') {
      FAKE_TABLE_REF_RX.lastIndex = 0;
      for (const m of normalizedBlockText.matchAll(FAKE_TABLE_REF_RX)) {
        const phrase = m[0];
        if (!normalizedSourceFull.includes(phrase)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-ref-table-${blockId}-${phrase}`,
            kind: 'broken_cross_reference',
            severity: 'error',
            blockId,
            offendingToken: phrase,
            messageFa: `ارجاع عددی جعلی «${phrase}» در بلوک ${blockId} یافت شد؛ از توکن ساختاری [[ref:sectionId]] استفاده کنید.`,
          });
        }
      }

      FAKE_FIGURE_REF_RX.lastIndex = 0;
      for (const m of normalizedBlockText.matchAll(FAKE_FIGURE_REF_RX)) {
        const phrase = m[0];
        if (!hasFigureRefInSection && !normalizedSourceFull.includes(phrase)) {
          invalidBlockSet.add(blockId);
          issues.push({
            id: `l1-ref-fig-${blockId}-${phrase}`,
            kind: 'broken_cross_reference',
            severity: 'error',
            blockId,
            offendingToken: phrase,
            messageFa: `ارجاع شکسته به تصویر/شکل («${phrase}») در بلوک ${blockId} بدون وجود بلوک figure_ref در زیربخش.`,
          });
        }
      }

      if (knownSectionIdSet) {
        STRUCTURAL_REF_TOKEN_RX.lastIndex = 0;
        for (const m of flatText.matchAll(STRUCTURAL_REF_TOKEN_RX)) {
          const targetId = m[1];
          if (!knownSectionIdSet.has(targetId)) {
            invalidBlockSet.add(blockId);
            issues.push({
              id: `l1-ref-token-${blockId}-${targetId}`,
              kind: 'broken_cross_reference',
              severity: 'error',
              blockId,
              offendingToken: m[0],
              messageFa: `توکن ارجاع ساختاری ${m[0]} در بلوک ${blockId} به شناسه زیربخش نامعتبر اشاره دارد.`,
            });
          }
        }
      }
    }

    // 7. LivingGlossary forbidden-variant consistency guard (strictly normalized Persian/Tatweel/ZWNJ)
    if (glossary?.entries?.length) {
      const normalizedGlossaryText = normalizeForGlossaryMatch(flatText);
      for (const entry of glossary.entries) {
        for (const forbidden of entry.forbiddenVariants || []) {
          const normForbidden = normalizeForGlossaryMatch(forbidden);
          if (normForbidden.length >= 3 && normalizedGlossaryText.includes(normForbidden)) {
            invalidBlockSet.add(blockId);
            issues.push({
              id: `l1-glossary-${blockId}-${entry.id}`,
              kind: 'glossary_violation',
              severity: 'error',
              blockId,
              offendingToken: forbidden,
              messageFa: `عدم تطابق با واژه‌نامه زنده در بلوک ${blockId}: به جای «${forbidden}» باید از معادل استاندارد «${entry.canonicalTerm}» استفاده شود.`,
            });
          }
        }
      }
    }
  }

  // 8. Excessive source_gap_flag bailout check (> 30% on a substantive subsection)
  if (sourceWordCount >= 35 && blocks.length >= 2 && gapFlagCount / blocks.length > 0.3) {
    issues.push({
      id: 'l1-excessive-gap-bailout',
      kind: 'excessive_gap_bailout',
      severity: 'error',
      messageFa: `بیش از ۳۰٪ بلوک‌های این زیربخش غنی (${gapFlagCount} از ${blocks.length}) به source_gap_flag تبدیل شده‌اند (excessive_gap_bailout).`,
    });
  }

  // 9. Verify zero silent omission of injected source chunks
  if (requireAllChunksCovered && allowedChunkIds.size > 0) {
    for (const chunkId of allowedChunkIds) {
      if (!coveredChunkIds.has(chunkId)) {
        issues.push({
          id: `l1-uncovered-${chunkId}`,
          kind: 'missing_source_chunk',
          severity: 'error',
          offendingToken: chunkId,
          messageFa: `قطعه منبع «${chunkId}» در هیچ بلوکی از خروجی پوشش داده نشده است (خطر حذف خاموش مطلب).`,
        });
      }
    }
  }

  // 10. Mandatory Safety Warning Preservation Check
  for (const safetyChunkId of safetyRequiredChunkIds) {
    if (!warningCoveredChunkIds.has(safetyChunkId)) {
      issues.push({
        id: `l1-missing-safety-${safetyChunkId}`,
        kind: 'missing_safety_warning',
        severity: 'error',
        offendingToken: safetyChunkId,
        messageFa: `قطعه منبع «${safetyChunkId}» حاوی هشدار ایمنی حیاتی (سوختن/ناک/چک‌سام/ایموبلایزر/خطر) است اما هیچ بلوک callout_warning متصل به آن در خروجی وجود ندارد.`,
      });
    }
  }

  // 11. Technical Entity Retention Rate (100% hard requirement on critical ECU facts)
  const fullOutputAnchors = extractExtendedEcuAnchors(combinedOutputTexts.join('\n'));
  let totalCriticalEntities = 0;
  let preservedCriticalEntities = 0;

  for (const hex of sourceAnchors.hexAddresses) {
    totalCriticalEntities++;
    checkedAnchorsCount++;
    if (fullOutputAnchors.hexAddresses.has(hex)) {
      preservedCriticalEntities++;
    } else {
      issues.push({
        id: `l1-missing-hex-${hex}`,
        kind: 'missing_technical_anchor',
        severity: 'error',
        offendingToken: hex,
        messageFa: `آدرس هگز کلیدی «${hex}» از متن منبع در خروجی زیربخش حذف شده است.`,
      });
    }
  }

  for (const dtc of sourceAnchors.dtcCodes) {
    totalCriticalEntities++;
    checkedAnchorsCount++;
    if (fullOutputAnchors.dtcCodes.has(dtc)) {
      preservedCriticalEntities++;
    } else {
      issues.push({
        id: `l1-missing-dtc-${dtc}`,
        kind: 'missing_technical_anchor',
        severity: 'error',
        offendingToken: dtc,
        messageFa: `کد خطای کلیدی «${dtc}» از متن منبع در خروجی زیربخش حذف شده است.`,
      });
    }
  }

  for (const mapCode of sourceAnchors.mapIdentifiers) {
    totalCriticalEntities++;
    if (fullOutputAnchors.mapIdentifiers.has(mapCode)) {
      preservedCriticalEntities++;
    } else {
      issues.push({
        id: `l1-missing-map-${mapCode}`,
        kind: 'missing_technical_anchor',
        severity: 'error',
        offendingToken: mapCode,
        messageFa: `شناسه نقشه WinOLS «${mapCode}» از متن منبع در خروجی زیربخش حذف شده است.`,
      });
    }
  }

  for (const dim of sourceAnchors.mapDimensions) {
    totalCriticalEntities++;
    if (fullOutputAnchors.mapDimensions.has(dim)) {
      preservedCriticalEntities++;
    } else {
      issues.push({
        id: `l1-missing-dim-${dim}`,
        kind: 'missing_technical_anchor',
        severity: 'error',
        offendingToken: dim,
        messageFa: `ابعاد نقشه «${dim}» از متن منبع در خروجی زیربخش حذف شده است.`,
      });
    }
  }

  for (const tr of sourceAnchors.measurements) {
    totalCriticalEntities++;
    const matched =
      fullOutputAnchors.measurementKeys.has(tr.key) ||
      (tr.sign === '' && fullOutputAnchors.measurementKeys.has(`+${tr.value}|${tr.unit}`));
    if (matched) {
      preservedCriticalEntities++;
    } else {
      issues.push({
        id: `l1-missing-meas-${tr.key}`,
        kind: 'missing_technical_anchor',
        severity: 'error',
        offendingToken: tr.raw,
        messageFa: `مقدار فنی کلیدی «${tr.raw}» از متن منبع در خروجی حفظ نشده است.`,
      });
    }
  }

  const technicalEntityRetentionPercent =
    totalCriticalEntities === 0
      ? 100
      : Math.round((preservedCriticalEntities / totalCriticalEntities) * 100);

  // 12. Entity-Aware Word Ratio Floor (avoids False Positives when editing verbose spoken transcripts cleanly)
  const coverageRatio =
    sourceWordCount > 0 ? Number((outputWordCount / sourceWordCount).toFixed(2)) : 1;

  const effectiveWordFloor =
    technicalEntityRetentionPercent === 100 && totalCriticalEntities >= 2
      ? minWordRatioEntities
      : minWordRatio;

  if (sourceWordCount >= 40 && coverageRatio < effectiveWordFloor) {
    issues.push({
      id: 'l1-low-word-ratio',
      kind: 'low_word_ratio',
      severity: 'error',
      messageFa: `افت طول غیرمجاز در زیربخش (نسبت کلمات خروجی به منبع ${Math.round(coverageRatio * 100)}٪ است و کمتر از کف مجاز ${Math.round(effectiveWordFloor * 100)}٪ می‌باشد).`,
    });
  } else if (sourceWordCount >= 50 && coverageRatio > maxWordRatio) {
    issues.push({
      id: 'l1-excessive-bloat',
      kind: 'excessive_bloat',
      severity: 'warning',
      messageFa: `حجم خروجی زیربخش ${coverageRatio} برابر متن منبع است؛ بررسی کنید حاشیه‌روی یا متن خارج از منبع اضافه نشده باشد.`,
    });
  }

  // 13. Cross-Section Duplication Check (Jaccard similarity vs up to 5 previous subsections of same chapter)
  if (options?.previousChapterSectionsIR && options.previousChapterSectionsIR.length > 0 && blocks.length > 0) {
    const recentPrev = options.previousChapterSectionsIR.slice(-5);
    const currentIntroPara = blocks.find((b) => b.kind === 'paragraph' && (b.text || '').trim().length >= 30);
    const currentIntroTokens = currentIntroPara ? tokenizeContent(currentIntroPara.text || '') : [];
    const currentFullTokens = tokenizeContent(combinedOutputTexts.join(' '));

    for (const prevSec of recentPrev) {
      if (prevSec.sectionId === sectionIR.sectionId) continue;
      const prevIntroPara = prevSec.blocks.find(
        (b) => b.kind === 'paragraph' && (b.text || '').trim().length >= 30
      );
      if (currentIntroPara && prevIntroPara && currentIntroTokens.length >= 6) {
        const prevIntroTokens = tokenizeContent(prevIntroPara.text || '');
        const introSim = computeJaccardSimilarity(currentIntroTokens, prevIntroTokens);
        if (introSim >= 0.65) {
          invalidBlockSet.add(currentIntroPara.id);
          issues.push({
            id: `l1-cross-dup-intro-${prevSec.sectionId}`,
            kind: 'cross_section_duplication',
            severity: 'error',
            blockId: currentIntroPara.id,
            offendingToken: prevSec.sectionId,
            messageFa: `مقدمه تکراری بین‌بخشی (تشابه ${Math.round(introSim * 100)}٪ با زیربخش «${prevSec.title}») شناسایی شد (cross_section_duplication).`,
          });
          break;
        }
      }

      const prevFullTokens = tokenizeContent(prevSec.blocks.map(flattenSemanticBlockText).join(' '));
      if (currentFullTokens.length >= 12 && prevFullTokens.length >= 12) {
        const fullSim = computeJaccardSimilarity(currentFullTokens, prevFullTokens);
        if (fullSim >= 0.55) {
          issues.push({
            id: `l1-cross-dup-full-${prevSec.sectionId}`,
            kind: 'cross_section_duplication',
            severity: 'error',
            offendingToken: prevSec.sectionId,
            messageFa: `تشابه محتوایی بیش از حد (${Math.round(fullSim * 100)}٪) با زیربخش قبلی «${prevSec.title}» شناسایی شد.`,
          });
          break;
        }
      }
    }
  }

  const hasErrors = issues.some((it) => it.severity === 'error');

  return {
    passed: !hasErrors,
    issues,
    invalidBlockIds: Array.from(invalidBlockSet),
    coverageRatio,
    sourceWordCount,
    outputWordCount,
    checkedAnchorsCount,
    technicalEntityRetentionPercent,
  };
}
