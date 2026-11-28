import type {
  AiImagePlaceholderSpec,
  ContentBlock,
  DocxExportConfig,
  FigureBlock,
  ParsedBook,
  SectionNode,
} from './bookTypes.ts';

export type SmartImageStrategyDecision = 'WEB_SEARCH' | 'AI_PLACEHOLDER' | 'NO_IMAGE';

export type TechnicalImageCategory =
  | 'ecu_pinout'
  | 'pcb_boot'
  | 'winols_map'
  | 'waveform_component';

export const AI_PLACEHOLDER_HEADER_FA = 'محل درج تصویر اختصاصی (نیازمند تولید با AI)';

export const FALLBACK_NO_VALID_WEB_IMAGE_NOTICE_FA =
  '(تصویر مرجع معتبر در وب یافت نشد — نیازمند تهیه اسکرینشات کارگاهی یا تصویرسازی)';

export const DEFAULT_MAX_IMAGE_CONCURRENCY = 4;
export const DEFAULT_IMAGE_SLOT_TIMEOUT_MS = 4000;
export const MIN_VISUAL_DENSITY_WORDS_PER_SLOT = 350;
export const MAX_VISUALS_PER_SUBSECTION = 2;

export interface SectionImageDecisionResult {
  strategy: SmartImageStrategyDecision;
  anchorId: string;
  captionFa: string;
  descriptionFa: string;
  searchQuery?: string;
  targetEntity?: string;
  imageCategory?: TechnicalImageCategory;
  aiPlaceholderSpec?: AiImagePlaceholderSpec;
  reasonFa: string;
}

export interface WebImageCandidateMetadata {
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  title?: string;
  altText?: string;
  description?: string;
  sourcePageUrl?: string;
}

export interface CandidateValidationResult {
  valid: boolean;
  score: number;
  rejectionReason?: string;
  matchedKeywords: string[];
}

export interface ResolvedWebImagePayload {
  imageUrl: string;
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  widthPx?: number;
  heightPx?: number;
  sourceTitle: string;
  sourceUri: string;
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toPersianDigitsLocal(input: number | string): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/**
 * Formats the compact 3-line machine-parseable AI Image Placeholder tag:
 * [[AI_IMAGE_PLACEHOLDER | type="..." | subject="..." | elements="..." | labels="..."]]
 */
export function formatCompactAiPlaceholderTag(params: {
  typeFa: string;
  subjectFa: string;
  elementsFa: string;
  labelsFa: string;
}): string {
  const clean = (v: string) =>
    String(v || '')
      .replace(/["[\]|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `[[AI_IMAGE_PLACEHOLDER | type="${clean(params.typeFa)}" | subject="${clean(params.subjectFa)}" | elements="${clean(params.elementsFa)}" | labels="${clean(params.labelsFa)}"]]`;
}

/**
 * Parses a compact `[[AI_IMAGE_PLACEHOLDER | ...]]` tag back into structured 3-line metadata.
 */
export function parseCompactAiPlaceholderTag(
  rawTag: string,
  fallbackCodeId = 'IMG-AI-01'
): AiImagePlaceholderSpec | null {
  const text = String(rawTag || '').trim();
  if (!text.includes('AI_IMAGE_PLACEHOLDER')) return null;

  const extractAttr = (key: string): string => {
    const re = new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  const extractFaSegment = (labels: string[]): string => {
    const inner = text.replace(/^\[\[\s*AI_IMAGE_PLACEHOLDER\s*\|?/i, '').replace(/\]\]\s*$/, '');
    const parts = inner.split('|').map((p) => p.trim());
    for (const part of parts) {
      for (const label of labels) {
        const re = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, 'i');
        const m = part.match(re);
        if (m && m[1].trim()) return m[1].trim();
      }
    }
    return '';
  };

  const typeFa =
    extractAttr('type') ||
    extractFaSegment(['سبک پیشنهادی', 'نوع تصویر', 'نوع', 'سبک']) ||
    'دیاگرام آموزشی مفهومی';
  const subjectFa =
    extractAttr('subject') ||
    extractFaSegment(['موضوع دقیق', 'موضوع']) ||
    'نمایش شماتیک فرآیند فنی';
  const elementsFa =
    extractAttr('elements') ||
    extractFaSegment(['عناصر کلیدی', 'عناصر', 'اجزای کلیدی']) ||
    'اجزای کلیدی، مسیر سیگنال و نواحی عملکردی';
  const labelsFa =
    extractAttr('labels') ||
    extractFaSegment(['برچسب‌های فنی', 'برچسب‌ها', 'برچسب']) ||
    'RPM, Load, ECU, Sensor';

  return {
    codeId: fallbackCodeId,
    typeFa,
    subjectFa,
    elementsFa,
    labelsFa,
    compactTag: formatCompactAiPlaceholderTag({
      typeFa,
      subjectFa,
      elementsFa,
      labelsFa,
    }),
  };
}

const WATERMARK_AND_STOCK_BLOCKLIST = [
  'shutterstock',
  'istockphoto',
  'istock',
  'alamy',
  '123rf',
  'dreamstime',
  'gettyimages',
  'watermark',
  'vectorstock',
  'depositphotos',
  'vecteezy',
  'stock.adobe',
  'adobestock',
  'bigstock',
  'canstockphoto',
  'pond5',
  'depositphotos',
];

const ALLOWED_WEB_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const AUTOMOTIVE_RELEVANCE_TERMS = [
  'ecu',
  'ecm',
  'pcm',
  'bosch',
  'siemens',
  'valeo',
  'sagem',
  'continental',
  'marelli',
  'me7',
  'sim2k',
  'ems',
  'winols',
  'pinout',
  'connector',
  'wiring',
  'schematic',
  'pcb',
  'circuit',
  'microcontroller',
  'eeprom',
  'flash',
  'am29f400',
  'st10',
  'oscilloscope',
  'waveform',
  'sensor',
  'crankshaft',
  'camshaft',
  'ckp',
  'cmp',
  'ignition',
  'fuel',
  'injection',
  'engine',
  'automotive',
  'obd',
  'can',
  'lambda',
  'throttle',
  'dyno',
  'map',
  'spark',
  'cylinder',
  'combustion',
  'turbo',
  'calibration',
];

/**
 * Image Quality & Relevance Validator:
 * - Verifies supported raster MIME (`image/png`, `image/jpeg`, `image/webp`)
 * - Rejects tiny thumbnails/icons (`width < 320 || height < 200`) and extreme banner ratios
 * - Blocks watermarked stock/promotional URLs & filenames
 * - Verifies keyword relevance against target entity / query / automotive domain vocabulary
 */
export function validateCandidateWebImage(
  candidate: WebImageCandidateMetadata,
  targetKeywords: string[] = []
): CandidateValidationResult {
  const url = String(candidate.url || '').trim();
  const urlLower = url.toLowerCase();
  const mimeLower = String(candidate.mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!url || !/^https?:\/\//i.test(url)) {
    return { valid: false, score: 0, rejectionReason: 'invalid_url', matchedKeywords: [] };
  }

  if (!ALLOWED_WEB_IMAGE_MIMES.has(mimeLower)) {
    return {
      valid: false,
      score: 0,
      rejectionReason: `unsupported_mime:${mimeLower || 'empty'}`,
      matchedKeywords: [],
    };
  }

  const combinedIdentity = `${urlLower} ${String(candidate.title || '').toLowerCase()} ${String(candidate.altText || '').toLowerCase()} ${String(candidate.sourcePageUrl || '').toLowerCase()}`;
  for (const blocked of WATERMARK_AND_STOCK_BLOCKLIST) {
    if (combinedIdentity.includes(blocked)) {
      return {
        valid: false,
        score: 0,
        rejectionReason: `blocked_stock_or_watermark:${blocked}`,
        matchedKeywords: [],
      };
    }
  }

  if (typeof candidate.width === 'number' && typeof candidate.height === 'number') {
    if (candidate.width < 320 || candidate.height < 200) {
      return {
        valid: false,
        score: 0,
        rejectionReason: `resolution_too_low:${candidate.width}x${candidate.height}`,
        matchedKeywords: [],
      };
    }
    const aspectRatio = candidate.width / Math.max(1, candidate.height);
    if (aspectRatio < 0.35 || aspectRatio > 4.2) {
      return {
        valid: false,
        score: 0,
        rejectionReason: `invalid_aspect_ratio:${aspectRatio.toFixed(2)}`,
        matchedKeywords: [],
      };
    }
  } else {
    return {
      valid: false,
      score: 0,
      rejectionReason: 'missing_dimensions',
      matchedKeywords: [],
    };
  }

  const metaCorpus = `${candidate.title || ''} ${candidate.altText || ''} ${candidate.description || ''} ${url}`.toLowerCase();

  const normalizedTargets = Array.from(
    new Set(
      targetKeywords
        .flatMap((kw) => kw.toLowerCase().split(/[^a-z0-9._-]+/))
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    )
  );

  const matchedTargetKeywords = normalizedTargets.filter((kw) => metaCorpus.includes(kw));
  const matchedDomainKeywords = AUTOMOTIVE_RELEVANCE_TERMS.filter((kw) => metaCorpus.includes(kw));
  const matchedKeywords = Array.from(new Set([...matchedTargetKeywords, ...matchedDomainKeywords]));

  if (matchedKeywords.length === 0) {
    return {
      valid: false,
      score: 0,
      rejectionReason: 'irrelevant_metadata_no_technical_keyword_match',
      matchedKeywords: [],
    };
  }

  let score = matchedTargetKeywords.length * 3 + matchedDomainKeywords.length * 1.5;
  if (candidate.width >= 640 && candidate.height >= 400) score += 2;
  if (mimeLower === 'image/png') score += 1;

  return {
    valid: true,
    score,
    matchedKeywords,
  };
}

const KNOWN_ECU_MODELS = [
  'Bosch ME7.4.4',
  'Bosch ME7.4.5',
  'Bosch ME7.4.9',
  'Bosch ME17.9.71',
  'Bosch MED17',
  'Valeo J34',
  'Valeo J34P',
  'Valeo V42',
  'Valeo PL4',
  'Sagem S2000',
  'Siemens SIM2K-34',
  'Siemens SIM2K',
  'Continental EMS3132',
  'Continental SIM2K',
  'Marelli IAW',
  'SSAT',
  'MAW',
  'LZNF',
  'Crouse',
  'ME7.4.4',
  'ME7.4.5',
  'J34P',
  'J34',
  'S2000',
  'SIM2K-34',
  'SIM2K',
  'EMS3132',
];

const KNOWN_CHIP_AND_MAP_CODES = [
  'AM29F400BB',
  '29F400BB',
  '29F400',
  'ST10F273',
  'ST10F275',
  'TC1762',
  'TC1766',
  'TC1797',
  '95160',
  '95080',
  '95320',
  'L9929',
  'TLE6209',
  'KFZW',
  'KFZW2',
  'LAMFA',
  'KFLBTS',
  'LDRXN',
  'KFMIOP',
  'KFMIRL',
  'KRKTE',
  'TVUB',
  'NMAX',
  'CWKONFZ',
];

function detectPrimaryEntityInText(combinedText: string): string {
  const upper = combinedText.toUpperCase();
  for (const ecu of KNOWN_ECU_MODELS) {
    if (upper.includes(ecu.toUpperCase())) {
      return ecu;
    }
  }
  for (const code of KNOWN_CHIP_AND_MAP_CODES) {
    if (upper.includes(code.toUpperCase())) {
      return code;
    }
  }
  const hexMatch = combinedText.match(/\b0x[0-9A-Fa-f]{4,8}\b/);
  if (hexMatch) {
    return `WinOLS 2.24 (${hexMatch[0]})`;
  }
  return 'ECU / WinOLS 2.24';
}

function countWordsInBlocks(blocks: ContentBlock[]): number {
  return blocks
    .map((b) => {
      if (b.type === 'paragraph') return b.text;
      if (b.type === 'callout') return `${b.title} ${b.paragraphs.join(' ')}`;
      if (b.type === 'list') return b.items.join(' ');
      if (b.type === 'subheading') return b.text;
      return '';
    })
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function isSafetyChecklistOrPureFormulaSection(
  sectionTitle: string,
  blocks: ContentBlock[],
  combinedText: string
): boolean {
  const hasEquationBlocks = blocks.some((b) => b.type === 'equation');
  const paragraphCount = blocks.filter((b) => b.type === 'paragraph').length;
  const isPureMathFormula =
    (hasEquationBlocks && paragraphCount <= 1) ||
    /(?:factor\s*\*\s*raw|raw\s*\*\s*factor|offset\s*\+|فرمول\s*تبدیل\s*مقدار\s*خام|رابطه\s*ریاضی\s*تبدیل)/i.test(
      combinedText
    ) && !/پین[\u200c\s]*اوت|pinout|pcb|بوت|boot|نمای\s*3d|اسیلوسکوپ|احتراق|جبهه\s*شعله/i.test(combinedText);

  if (isPureMathFormula) return true;

  const isSafetyChecklist =
    /چک[\u200c\s]*لیست\s*ایمنی|نکات\s*ایمنی\s*قبل\s*از\s*فلش|هشدار\s*ولتاژ\s*باتری|قوانین\s*چکسام|قوانین\s*طلایی\s*فلش/i.test(
      sectionTitle
    ) ||
    (/ولتاژ\s*باتری|شارژر\s*تثبیت[\u200c\s]*شده|چکسام|checksum/i.test(combinedText) &&
      blocks.some((b) => b.type === 'list' || (b.type === 'callout' && b.variant === 'warning')) &&
      !/پین[\u200c\s]*اوت|pinout|pcb|boot\s*pin|نمای\s*3d|اسیلوسکوپ|جبهه\s*شعله/i.test(combinedText));

  return isSafetyChecklist;
}

/**
 * Deterministic 3-State Decision Matrix (`WEB_SEARCH` vs `AI_PLACEHOLDER` vs `NO_IMAGE`)
 * with Visual Density Guard:
 * 1. `NO_IMAGE`:
 *    - Existing data table / diagram / image / figure in section, OR subsection already has >= 2 visuals
 *    - Pure safety checklists (battery voltage during flashing, checksum rules) or pure math formulas (`Factor * Raw + Offset`)
 *    - Chapter/section text too short (< 120 words for general/conceptual text without strong explicit visual trigger)
 *    - Visual Density Guard: max 1 visual per 350–500 words across a chapter (unless high-value hardware ground-truth slot on first pass)
 * 2. `WEB_SEARCH` (Ground-Truth Physical/Software Hardware):
 *    - ECU pinout/connector, PCB/Boot-Pin/Flash IC, WinOLS 2.24 2D/3D/hex maps, oscilloscope CKP/CMP waveforms
 * 3. `AI_PLACEHOLDER` (Conceptual / Internal-Combustion Physics / Pedagogical):
 *    - Flame-front knock, TDC cylinder pressure, comparative split-view schematics -> 3-line structured box (0 AI image tokens)
 */
export function evaluateSectionImageDecision(params: {
  chapterNumber: number;
  chapterTitle: string;
  sectionIndex: number;
  sectionTitle: string;
  blocks: ContentBlock[];
  existingVisualCountInChapter?: number;
  chapterTotalWordCount?: number;
}): SectionImageDecisionResult {
  const {
    chapterNumber,
    chapterTitle,
    sectionIndex,
    sectionTitle,
    blocks,
    existingVisualCountInChapter = 0,
    chapterTotalWordCount,
  } = params;

  const anchorId = `img_anchor_ch${chapterNumber}_sec${sectionIndex}`;
  const codeId = `IMG-AI-${String(chapterNumber).padStart(2, '0')}-${String(sectionIndex).padStart(2, '0')}`;

  const paragraphTexts = blocks
    .map((b) => {
      if (b.type === 'paragraph') return b.text;
      if (b.type === 'callout') return `${b.title} ${b.paragraphs.join(' ')}`;
      if (b.type === 'list') return b.items.join(' ');
      if (b.type === 'subheading') return b.text;
      return '';
    })
    .filter(Boolean)
    .join(' ');

  const proseWordCount = paragraphTexts.split(/\s+/).filter(Boolean).length;
  const combinedText = `${chapterTitle} ${sectionTitle} ${paragraphTexts}`.trim();
  const wordCount = combinedText.split(/\s+/).filter(Boolean).length;

  // 1. Existing visual/table guard + max 2 visuals per subsection
  const existingFiguresOrImages = blocks.filter(
    (b) => b.type === 'image' || b.type === 'figure'
  ).length;
  const existingVisualsInSection = blocks.filter(
    (b) => b.type === 'image' || b.type === 'figure' || b.type === 'diagram'
  ).length;
  const hasLargeTable = blocks.some((b) => b.type === 'table' && b.rows.length >= 3);
  const isTableDominatedSection = hasLargeTable && proseWordCount < 40;

  if (
    existingVisualsInSection >= MAX_VISUALS_PER_SUBSECTION ||
    existingFiguresOrImages >= 1 ||
    isTableDominatedSection
  ) {
    return {
      strategy: 'NO_IMAGE',
      anchorId,
      captionFa: '',
      descriptionFa: '',
      reasonFa: 'این زیربخش از قبل دارای جدول داده‌ای مستقل یا تصویر/شکل فنی است (رعایت سقف تراکم بصری).',
    };
  }

  // Cap maximum auto-injected image slots per chapter
  if (existingVisualCountInChapter >= 4) {
    return {
      strategy: 'NO_IMAGE',
      anchorId,
      captionFa: '',
      descriptionFa: '',
      reasonFa: 'سقف مجاز تصاویر خودکار در این فصل تکمیل شده است.',
    };
  }

  // 2. Explicit NO_IMAGE exclusion: safety checklists & pure math formulas (Factor * Raw + Offset)
  if (isSafetyChecklistOrPureFormulaSection(sectionTitle, blocks, combinedText)) {
    return {
      strategy: 'NO_IMAGE',
      anchorId,
      captionFa: '',
      descriptionFa: '',
      reasonFa: 'چک‌لیست ایمنی یا فرمول ریاضی خالص (نیاز به کادر متن/فرمول دارد نه تصویر).',
    };
  }

  // 3. Visual Density Guard (word budget: max 1 visual slot per 350 words across a chapter)
  if (
    typeof chapterTotalWordCount === 'number' &&
    chapterTotalWordCount > 0 &&
    existingVisualCountInChapter >= 1
  ) {
    const allowedSlotsByWordBudget = Math.max(
      1,
      Math.floor(chapterTotalWordCount / MIN_VISUAL_DENSITY_WORDS_PER_SLOT)
    );
    if (existingVisualCountInChapter >= allowedSlotsByWordBudget) {
      return {
        strategy: 'NO_IMAGE',
        anchorId,
        captionFa: '',
        descriptionFa: '',
        reasonFa: `گارد تراکم بصری فعال شد (حداکثر ۱ تصویر به ازای هر ۳۵۰ تا ۵۰۰ کلمه؛ کلمات فصل: ${chapterTotalWordCount}).`,
      };
    }
  }

  const targetEntity = detectPrimaryEntityInText(combinedText);

  // ---------------------------------------------------------------------------
  // STATE 1: WEB_SEARCH (Physical / Software Ground-Truth Entities)
  // ---------------------------------------------------------------------------
  const isPinoutOrConnector =
    /پین[\u200c\s]*اوت|pinout|پایه[\u200c\s]*های\s*ایسیو|سوکت|کانکتور|connector|wiring|نقشه\s*سیم[\u200c\s]*کشی/i.test(
      combinedText
    );
  const isPcbOrBootPin =
    /برد\s*ایسیو|pcb|بوت[\u200c\s]*پین|boot\s*pin|مقاومت\s*بوت|آی[\u200c\s]*سی\s*فلش|آی[\u200c\s]*سی\s*ایپرام|29f400|st10f273|95160|tnm|k-tag|ktag|پروگرامر|جیتگ|jtag/i.test(
      combinedText
    );
  const isWinolsMapOrHex =
    /winols|وینولز|نمای\s*2d|نمای\s*3d|دامپ|هگز|0x[0-9a-f]{4,8}|kfzw|lamfa|kflbts|ldrxn|kfmiop|kfmirl|krkte|tvub|axis|محورهای\s*نقشه|ضریب\s*فاکتور|lo\/hi|hilo|16-bit/i.test(
      combinedText
    );
  const isWaveformOrHardware =
    /اسیلوسکوپ|موج\s*سنسور|شکل\s*موج|waveform|ckp|cmp|سنسور\s*دور\s*موتور|سنسور\s*اکسیژن|وایدبند|داینو|dyno|دریچه\s*گاز\s*برقی/i.test(
      combinedText
    );

  if (
    wordCount >= 18 &&
    (isPinoutOrConnector || isPcbOrBootPin || isWinolsMapOrHex || isWaveformOrHardware)
  ) {
    let imageCategory: TechnicalImageCategory = 'winols_map';
    let searchQuery = `"${targetEntity}" WinOLS 2.24 3D map calibration table screenshot`;
    let captionFa = `شکل ${toPersianDigitsLocal(chapterNumber)}-${toPersianDigitsLocal(sectionIndex)}: نمای فنی و مرجع ${targetEntity} (${sectionTitle})`;
    let fallbackTypeFa = 'نمای مرجع سخت‌افزاری / نرم‌افزاری';
    let fallbackSubjectFa = `جزئیات فنی ${targetEntity} در مبحث ${sectionTitle}`;
    let fallbackElementsFa = `ساختار دقیق ${targetEntity}، شماره‌گذاری پایه‌ها یا محورهای X/Y و مقادیر کالیبراسیون`;
    let fallbackLabelsFa = `${targetEntity}, WinOLS 2.24, RPM, Load`;

    if (isPinoutOrConnector) {
      imageCategory = 'ecu_pinout';
      searchQuery = `"${targetEntity}" ECU pinout diagram connector wiring`;
      captionFa = `شکل ${toPersianDigitsLocal(chapterNumber)}-${toPersianDigitsLocal(sectionIndex)}: نقشه پین‌اوت و آرایش سوکت‌های ایسیو ${targetEntity}`;
      fallbackTypeFa = 'دیاگرام پین‌اوت و سوکت ECU';
      fallbackSubjectFa = `آرایش کامل پایه‌ها و سوکت‌های ایسیو ${targetEntity}`;
      fallbackElementsFa =
        'بلوک کانکتورهای ECU، شماره‌گذاری ردیف پین‌ها، تغذیه +12V، بدنه GND و خطوط شبکه CAN / K-Line';
      fallbackLabelsFa = `${targetEntity}, Pinout, +12V, GND, CAN-H, CAN-L, K-Line`;
    } else if (isPcbOrBootPin) {
      imageCategory = 'pcb_boot';
      searchQuery = `"${targetEntity}" PCB boot pin flash 29F400 ST10F273 ECU board`;
      captionFa = `شکل ${toPersianDigitsLocal(chapterNumber)}-${toPersianDigitsLocal(sectionIndex)}: نمای برد PCB، آی‌سی حافظه و نقطه اتصال Boot Pin در ${targetEntity}`;
      fallbackTypeFa = 'نقشه برد PCB و نقطه Boot-Pin';
      fallbackSubjectFa = `محل قرارگیری آی‌سی فلش/میکرو و پین بوت روی برد ${targetEntity}`;
      fallbackElementsFa =
        'نمای نزدیک برد PCB، آی‌سی فلش یا میکروکنترلر، پین بوت (Boot Pin) و مقاومت Pull-Down';
      fallbackLabelsFa = `${targetEntity}, Boot Pin, Flash IC, GND, 4.7k-10k Ohm`;
    } else if (isWinolsMapOrHex) {
      imageCategory = 'winols_map';
      const matchedMap =
        KNOWN_CHIP_AND_MAP_CODES.find((m) => combinedText.toUpperCase().includes(m)) || 'KFZW';
      searchQuery = `WinOLS 2.24 3D map ignition ${matchedMap} "${targetEntity}" screenshot`;
      captionFa = `شکل ${toPersianDigitsLocal(chapterNumber)}-${toPersianDigitsLocal(sectionIndex)}: نمای نقشه و محورهای کالیبراسیون ${matchedMap} در WinOLS 2.24 (${targetEntity})`;
      fallbackTypeFa = 'شماتیک نقشه کالیبراسیون WinOLS 2.24';
      fallbackSubjectFa = `ساختار جدول و منحنی نقشه ${matchedMap} روی دامپ ${targetEntity} در WinOLS 2.24`;
      fallbackElementsFa =
        'پنجره جدول ۱۶×۱۲ همراه با محور افقی بار (Load)، محور عمودی دور موتور (RPM) و ناحیه هدف ریمپ';
      fallbackLabelsFa = `WinOLS 2.24, ${matchedMap}, ${targetEntity}, RPM, Load %, Factor/Offset`;
    } else {
      imageCategory = 'waveform_component';
      searchQuery = `"${targetEntity}" automotive oscilloscope waveform CKP CMP sensor signal`;
      captionFa = `شکل ${toPersianDigitsLocal(chapterNumber)}-${toPersianDigitsLocal(sectionIndex)}: شکل موج مرجع و دیاگرام سیگنال در ${sectionTitle}`;
      fallbackTypeFa = 'نمودار شکل موج اسیلوسکوپ / سیگنال سنسور';
      fallbackSubjectFa = `تطبیق سیگنال سنسور و شکل موج مرجع در ${sectionTitle}`;
      fallbackElementsFa =
        'محور زمان (ms)، دامنه ولتاژ (V)، دندانه‌های مرجع ۵۸+۲ (CKP) و پالس میل‌سوپاپ (CMP)';
      fallbackLabelsFa = `${targetEntity}, CKP (58X), CMP, Voltage (V), Time (ms)`;
    }

    const aiPlaceholderSpec: AiImagePlaceholderSpec = {
      codeId,
      typeFa: fallbackTypeFa,
      subjectFa: fallbackSubjectFa,
      elementsFa: fallbackElementsFa,
      labelsFa: fallbackLabelsFa,
      compactTag: formatCompactAiPlaceholderTag({
        typeFa: fallbackTypeFa,
        subjectFa: fallbackSubjectFa,
        elementsFa: fallbackElementsFa,
        labelsFa: fallbackLabelsFa,
      }),
    };

    return {
      strategy: 'WEB_SEARCH',
      anchorId,
      captionFa,
      descriptionFa: `جستجوی هدفمند وب برای تصویر فنی مرجع: «${searchQuery}»`,
      searchQuery,
      targetEntity,
      imageCategory,
      aiPlaceholderSpec,
      reasonFa:
        'موجودیت سخت‌افزاری یا نرم‌افزاری استاندارد (کاشت لنگر WEB_SEARCH برای جستجو و اعتبارسنجی موازی در وب).',
    };
  }

  // ---------------------------------------------------------------------------
  // STATE 2: AI_PLACEHOLDER (Conceptual / Combustion Physics / Custom Schematics)
  // ---------------------------------------------------------------------------
  const isStrongConceptualTrigger =
    /جبهه\s*شعله|اتاق\s*احتراق|فشار\s*سیلندر|ضربه\s*ناک|خودسوزی|انفجار\s*خودبه[\u200c\s]*خودی|مقایسه\s*دوحالته|حلقه‌بسته|closed[\u200c\s-]*loop|open[\u200c\s-]*loop|مقطع\s*عرضی/i.test(
      combinedText
    );
  const isGeneralConceptual =
    /فرآیند|مکانیزم|فیزیک|احتراق|ناک|پیش[\u200c\s]*رسانی|آوانس|ریتارد|استوکیومتری|لامبدا|مقایسه|تفاوت|چرخه|معماری|شماتیک|فلوچارت|گشتاور|راندمان/i.test(
      combinedText
    );

  // Enforce <120 words NO_IMAGE rule for general/conceptual text unless explicit strong physics trigger
  if (
    (isStrongConceptualTrigger && wordCount >= 30) ||
    (isGeneralConceptual && wordCount >= 120)
  ) {
    const typeFa = /مقایسه|تفاوت|در\s*برابر/i.test(combinedText)
      ? 'اینفوگرافیک مقایسه‌ای دوحالته (Split-View)'
      : /احتراق|ناک|شعله|سیلندر|آوانس/i.test(combinedText)
        ? 'شماتیک فنی مقطع عرضی و منحنی احتراق'
        : 'دیاگرام بلوکی و جریان سیگنال کنترلی ECU';

    const subjectFa = `تشریح بصری «${sectionTitle}» در سیستم مدیریت موتور ${targetEntity}`;
    const elementsFa = /احتراق|ناک|آوانس/i.test(combinedText)
      ? 'مقطع اتاق احتراق، مقایسه جبهه شعله نرمال در برابر انفجار خودبه‌خودی (Knock) و نمودار فشار سیلندر بر حسب زاویه میل‌لنگ (CA°)'
      : `بلوک‌های ورودی سنسورها، منطق تصمیم‌گیری داخل ایسیو (${targetEntity}) و تأثیر مستقیم روی عملگرها در مبحث ${sectionTitle}`;
    const labelsFa = `${targetEntity}, RPM, Load, Spark Advance (°BTDC), Lambda (λ)`;

    const aiPlaceholderSpec: AiImagePlaceholderSpec = {
      codeId,
      typeFa,
      subjectFa,
      elementsFa,
      labelsFa,
      compactTag: formatCompactAiPlaceholderTag({
        typeFa,
        subjectFa,
        elementsFa,
        labelsFa,
      }),
    };

    return {
      strategy: 'AI_PLACEHOLDER',
      anchorId,
      captionFa: `شکل ${toPersianDigitsLocal(chapterNumber)}-${toPersianDigitsLocal(sectionIndex)}: ${subjectFa}`,
      descriptionFa: aiPlaceholderSpec.compactTag,
      targetEntity,
      aiPlaceholderSpec,
      reasonFa:
        'مفهوم تحلیلی/آموزشی اختصاصی — درج قالب خلاصه ۳ خطی (۰ توکن تولید تصویر AI).',
    };
  }

  return {
    strategy: 'NO_IMAGE',
    anchorId,
    captionFa: '',
    descriptionFa: '',
    reasonFa:
      wordCount < 120
        ? 'متن زیربخش کمتر از ۱۲۰ کلمه و فاقد موجودیت سخت‌افزاری یا شماتیک ضروری است (NO_IMAGE).'
        : 'عدم نیاز به تصویر اختصاصی در این بخش.',
  };
}

/**
 * Scans all paragraph blocks across the book for inline LLM-emitted tags:
 * `[[AI_IMAGE_PLACEHOLDER | type="..." | subject="..." | elements="..." | labels="..."]]`
 * and deterministically hydrates them into structured `FigureBlock` cards while preserving
 * 100% of surrounding text (Zero-Loss).
 */
export function hydrateInlineAiPlaceholderTagsInBook(book: ParsedBook): number {
  const tagRegex = /\[\[AI_IMAGE_PLACEHOLDER\s*\|[\s\S]*?\]\]/g;
  let hydratedCount = 0;

  const transformBlocks = (blocks: ContentBlock[], chapterNumber: number): ContentBlock[] => {
    const nextBlocks: ContentBlock[] = [];
    for (const block of blocks) {
      if (block.type !== 'paragraph' || !block.text.includes('[[AI_IMAGE_PLACEHOLDER')) {
        nextBlocks.push(block);
        continue;
      }

      let lastIndex = 0;
      let match: RegExpExecArray | null;
      tagRegex.lastIndex = 0;
      let localHit = 0;

      while ((match = tagRegex.exec(block.text)) !== null) {
        const beforeText = block.text.slice(lastIndex, match.index).trim();
        if (beforeText) {
          nextBlocks.push({
            ...block,
            id: localHit === 0 ? block.id : `${block.id}_pre_${localHit}`,
            text: beforeText,
          });
        }

        hydratedCount += 1;
        localHit += 1;
        const codeId = `IMG-AI-${String(chapterNumber).padStart(2, '0')}-TAG${String(hydratedCount).padStart(2, '0')}`;
        const spec = parseCompactAiPlaceholderTag(match[0], codeId);
        if (spec) {
          nextBlocks.push({
            type: 'figure',
            id: `${block.id}_ai_fig_${localHit}`,
            anchorId: `img_anchor_tag_${chapterNumber}_${hydratedCount}`,
            caption: `${AI_PLACEHOLDER_HEADER_FA} — ${spec.subjectFa}`,
            description: spec.compactTag,
            imageStrategy: 'AI_PLACEHOLDER',
            resolutionStatus: 'ai_placeholder',
            aiPlaceholderSpec: spec,
            sourceFileNames: block.sourceFileNames,
            sourceUnitIds: block.sourceUnitIds,
          });
        }
        lastIndex = match.index + match[0].length;
      }

      const afterText = block.text.slice(lastIndex).trim();
      if (afterText) {
        nextBlocks.push({
          ...block,
          id: `${block.id}_post_${localHit}`,
          text: afterText,
        });
      }
    }
    return nextBlocks;
  };

  for (const ch of book.chapters) {
    ch.introBlocks = transformBlocks(ch.introBlocks, ch.chapterNumber);
    for (const sec of ch.sections) {
      sec.blocks = transformBlocks(sec.blocks, ch.chapterNumber);
    }
  }

  return hydratedCount;
}

/**
 * STAGE A (Synchronous / 0ms Network Latency — Anchor-First Architecture):
 * 1. Hydrates any raw inline `[[AI_IMAGE_PLACEHOLDER | ...]]` tags emitted by LLMs into structured `FigureBlock` cards.
 * 2. Scans assembled book chapters & sections and plants lightweight `FigureBlock` anchors using the
 *    3-State Decision Matrix (`WEB_SEARCH` vs `AI_PLACEHOLDER` vs `NO_IMAGE`) and Visual Density Guard:
 *    - `WEB_SEARCH`: planted with `resolutionStatus: 'pending'` (0ms network latency) + bilingual query + fallback spec.
 *    - `AI_PLACEHOLDER`: planted with `resolutionStatus: 'ai_placeholder'` + 3-line structured box (0 AI image tokens).
 */
export function injectSmartImageAnchorsIntoBook(
  book: ParsedBook,
  config: DocxExportConfig
): {
  webSearchSlotsCount: number;
  aiPlaceholderSlotsCount: number;
  inlineTagsHydratedCount: number;
  skippedSectionsCount: number;
} {
  const inlineTagsHydratedCount = hydrateInlineAiPlaceholderTagsInBook(book);

  if (config.includeVisualSuggestions === false) {
    return {
      webSearchSlotsCount: 0,
      aiPlaceholderSlotsCount: inlineTagsHydratedCount,
      inlineTagsHydratedCount,
      skippedSectionsCount: 0,
    };
  }

  let webSearchSlotsCount = 0;
  let aiPlaceholderSlotsCount = inlineTagsHydratedCount;
  let skippedSectionsCount = 0;

  for (const chapter of book.chapters) {
    // Skip auto-generated WinOLS quick guide appendix chapter
    if (chapter.id === 'ch_winols_quick_guide') continue;

    const chapterTotalWordCount =
      countWordsInBlocks(chapter.introBlocks) +
      chapter.sections.reduce((acc, s) => acc + countWordsInBlocks(s.blocks), 0);

    let chapterVisualCount =
      chapter.introBlocks.filter(
        (b) => b.type === 'figure' || b.type === 'image'
      ).length +
      chapter.sections.reduce(
        (sum, s) =>
          sum +
          s.blocks.filter(
            (b) => b.type === 'figure' || b.type === 'image'
          ).length,
        0
      );

    chapter.sections.forEach((sec: SectionNode, secIdx: number) => {
      const decision = evaluateSectionImageDecision({
        chapterNumber: chapter.chapterNumber,
        chapterTitle: chapter.title,
        sectionIndex: secIdx + 1,
        sectionTitle: sec.title,
        blocks: sec.blocks,
        existingVisualCountInChapter: chapterVisualCount,
        chapterTotalWordCount,
      });

      if (decision.strategy === 'NO_IMAGE') {
        skippedSectionsCount += 1;
        return;
      }

      chapterVisualCount += 1;

      if (decision.strategy === 'WEB_SEARCH') {
        webSearchSlotsCount += 1;
        const figBlock: FigureBlock = {
          type: 'figure',
          id: decision.anchorId,
          anchorId: decision.anchorId,
          caption: decision.captionFa,
          description: decision.descriptionFa,
          imageStrategy: 'WEB_SEARCH',
          resolutionStatus: 'pending',
          searchQuery: decision.searchQuery,
          targetEntity: decision.targetEntity,
          imageCategory: decision.imageCategory,
          aiPlaceholderSpec: decision.aiPlaceholderSpec,
          sourceFileNames: sec.sourceFileNames,
        };
        sec.blocks.push(figBlock);
      } else if (decision.strategy === 'AI_PLACEHOLDER') {
        aiPlaceholderSlotsCount += 1;
        const figBlock: FigureBlock = {
          type: 'figure',
          id: decision.anchorId,
          anchorId: decision.anchorId,
          caption: decision.captionFa,
          description: decision.descriptionFa,
          imageStrategy: 'AI_PLACEHOLDER',
          resolutionStatus: 'ai_placeholder',
          targetEntity: decision.targetEntity,
          aiPlaceholderSpec: decision.aiPlaceholderSpec,
          sourceFileNames: sec.sourceFileNames,
        };
        sec.blocks.push(figBlock);
      }
    });
  }

  return {
    webSearchSlotsCount,
    aiPlaceholderSlotsCount,
    inlineTagsHydratedCount,
    skippedSectionsCount,
  };
}

export interface ParallelImageResolutionResult {
  totalWebSlots: number;
  resolvedFromWebCount: number;
  fallbackToAiPlaceholderCount: number;
  cacheHitsCount: number;
  totalAiPlaceholders: number;
  durationMs: number;
}

export type CustomWebImageFetcher = (params: {
  anchorId: string;
  searchQuery: string;
  targetEntity?: string;
  imageCategory?: TechnicalImageCategory;
  signal: AbortSignal;
}) => Promise<ResolvedWebImagePayload | null>;

/**
 * Bounded Query-Keyed LRU Cache for resolved web images (avoids re-downloading the same
 * Bosch ME7.4.4 / SIM2K / WinOLS technical image across chapters or repeated runs).
 */
export class WebImageQueryCache {
  private readonly maxEntries: number;
  private readonly store = new Map<string, ResolvedWebImagePayload | null>();

  constructor(maxEntries = 100) {
    this.maxEntries = Math.max(10, maxEntries);
  }

  private normalizeKey(query: string): string {
    return String(query || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  has(query: string): boolean {
    return this.store.has(this.normalizeKey(query));
  }

  get(query: string): ResolvedWebImagePayload | null | undefined {
    const key = this.normalizeKey(query);
    if (!this.store.has(key)) return undefined;
    const val = this.store.get(key) ?? null;
    // Refresh LRU recency
    this.store.delete(key);
    this.store.set(key, val);
    return val;
  }

  set(query: string, value: ResolvedWebImagePayload | null): void {
    const key = this.normalizeKey(query);
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

const defaultSharedImageCache = new WebImageQueryCache(120);

function applyAutoFallbackToPlaceholder(slot: FigureBlock): void {
  slot.imageUrl = undefined;
  slot.mimeType = undefined;
  slot.widthPx = undefined;
  slot.heightPx = undefined;
  slot.resolutionStatus = 'fallback_placeholder';
  slot.fallbackReasonFa = FALLBACK_NO_VALID_WEB_IMAGE_NOTICE_FA;

  const baseSpec: AiImagePlaceholderSpec = slot.aiPlaceholderSpec
    ? { ...slot.aiPlaceholderSpec }
    : {
        codeId: `IMG-AI-FB-${slot.id.slice(-4).toUpperCase()}`,
        typeFa: 'شماتیک یا اسکرینشات فنی جایگزین',
        subjectFa: slot.caption,
        elementsFa: `اجزای فنی مرتبط با «${slot.searchQuery || slot.caption}»`,
        labelsFa: `${slot.targetEntity || 'ECU'}, WinOLS 2.24, RPM, Load`,
        compactTag: '',
      };

  if (!baseSpec.subjectFa.includes('تصویر مرجع معتبر در وب یافت نشد')) {
    baseSpec.subjectFa = `${baseSpec.subjectFa} ${FALLBACK_NO_VALID_WEB_IMAGE_NOTICE_FA}`;
  }
  baseSpec.compactTag = formatCompactAiPlaceholderTag({
    typeFa: baseSpec.typeFa,
    subjectFa: baseSpec.subjectFa,
    elementsFa: baseSpec.elementsFa,
    labelsFa: baseSpec.labelsFa,
  });

  slot.aiPlaceholderSpec = baseSpec;
  slot.description = baseSpec.compactTag;
}

/**
 * STAGE B (Bounded Parallel Worker Pool — MAX_CONCURRENCY = 4, per-slot timeout = 4000ms):
 * Resolves all `WEB_SEARCH` figure anchor slots across the book in parallel without blocking
 * text generation.
 * - Uses query-keyed LRU cache so identical ECU/map queries are never fetched twice.
 * - On valid image download: hydrates exact `anchorId` block (`resolutionStatus = 'resolved_web'`).
 * - Mandatory Auto-Fallback Rule: If no valid relevant image is found on the web or download times out
 *   in 4000ms, NEVER fakes a web photo — automatically transitions the slot to
 *   `resolutionStatus = 'fallback_placeholder'` with the exact Persian notice:
 *   `(تصویر مرجع معتبر در وب یافت نشد — نیازمند تهیه اسکرینشات کارگاهی یا تصویرسازی)`.
 */
export async function resolveBookWebImagesParallel(
  book: ParsedBook,
  options?: {
    concurrency?: number;
    timeoutMs?: number;
    fetcher?: CustomWebImageFetcher;
    cache?: WebImageQueryCache;
    forceRequery?: boolean;
  }
): Promise<ParallelImageResolutionResult> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, Math.min(8, options?.concurrency ?? DEFAULT_MAX_IMAGE_CONCURRENCY));
  const timeoutMs = Math.max(100, options?.timeoutMs ?? DEFAULT_IMAGE_SLOT_TIMEOUT_MS);
  const fetcher: CustomWebImageFetcher =
    options?.fetcher ?? (async () => null);
  const cache = options?.cache ?? defaultSharedImageCache;
  const forceRequery = Boolean(options?.forceRequery);

  const webSlots: FigureBlock[] = [];
  let totalAiPlaceholders = 0;

  for (const ch of book.chapters) {
    for (const b of ch.introBlocks) {
      if (b.type === 'figure') {
        if (b.imageStrategy === 'WEB_SEARCH') webSlots.push(b);
        else if (b.imageStrategy === 'AI_PLACEHOLDER') totalAiPlaceholders += 1;
      }
    }
    for (const sec of ch.sections) {
      for (const b of sec.blocks) {
        if (b.type === 'figure') {
          if (b.imageStrategy === 'WEB_SEARCH') webSlots.push(b);
          else if (b.imageStrategy === 'AI_PLACEHOLDER') totalAiPlaceholders += 1;
        }
      }
    }
  }

  let resolvedFromWebCount = 0;
  let fallbackToAiPlaceholderCount = 0;
  let cacheHitsCount = 0;
  let cursor = 0;

  const processSingleSlot = async (slot: FigureBlock) => {
    // Skip already resolved web images unless forceRequery is requested
    if (!forceRequery && slot.resolutionStatus === 'resolved_web' && slot.imageUrl) {
      resolvedFromWebCount += 1;
      return;
    }

    const queryKey = slot.searchQuery || slot.caption;

    // Check LRU cache first (when not force-requerying)
    if (!forceRequery && cache.has(queryKey)) {
      cacheHitsCount += 1;
      const cached = cache.get(queryKey);
      if (cached && cached.imageUrl) {
        slot.imageUrl = cached.imageUrl;
        slot.mimeType = cached.mimeType;
        slot.widthPx = cached.widthPx;
        slot.heightPx = cached.heightPx;
        slot.sourceTitle = cached.sourceTitle;
        slot.sourceUri = cached.sourceUri;
        slot.fallbackReasonFa = undefined;
        slot.resolutionStatus = 'resolved_web';
        resolvedFromWebCount += 1;
        return;
      }
      applyAutoFallbackToPlaceholder(slot);
      fallbackToAiPlaceholderCount += 1;
      totalAiPlaceholders += 1;
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await Promise.race([
        fetcher({
          anchorId: slot.anchorId || slot.id,
          searchQuery: queryKey,
          targetEntity: slot.targetEntity,
          imageCategory: slot.imageCategory,
          signal: controller.signal,
        }),
        new Promise<null>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error('WEB_IMAGE_SEARCH_TIMEOUT'))
          );
        }),
      ]);

      if (result && result.imageUrl) {
        cache.set(queryKey, result);
        slot.imageUrl = result.imageUrl;
        slot.mimeType = result.mimeType;
        slot.widthPx = result.widthPx;
        slot.heightPx = result.heightPx;
        slot.sourceTitle = result.sourceTitle;
        slot.sourceUri = result.sourceUri;
        slot.fallbackReasonFa = undefined;
        slot.resolutionStatus = 'resolved_web';
        resolvedFromWebCount += 1;
        return;
      }
      // Cache negative lookup too so repeated identical queries in the same batch don't thrash
      cache.set(queryKey, null);
    } catch {
      // On timeout/network failure, fall through cleanly to automatic 3-line AI Placeholder fallback
    } finally {
      clearTimeout(timer);
    }

    applyAutoFallbackToPlaceholder(slot);
    fallbackToAiPlaceholderCount += 1;
    totalAiPlaceholders += 1;
  };

  const workerCount = Math.min(concurrency, Math.max(1, webSlots.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < webSlots.length) {
      const idx = cursor++;
      const slot = webSlots[idx];
      if (slot) {
        await processSingleSlot(slot);
      }
    }
  });

  if (webSlots.length > 0) {
    await Promise.all(workers);
  }

  return {
    totalWebSlots: webSlots.length,
    resolvedFromWebCount,
    fallbackToAiPlaceholderCount,
    cacheHitsCount,
    totalAiPlaceholders,
    durationMs: Date.now() - startedAt,
  };
}
