import { ContentUnitDto, SourceFileDto, TableBlock } from './bookTypes.ts';
import { toAsciiDigits, toPersianDigits } from './formatParsers.ts';

// ============================================================================
// PART 1: BOUNDED AI EDITORIAL POLICY (REWRITE LEVEL + TONE + CUSTOM PROMPT)
// ============================================================================

export type AiRewriteLevel =
  | 'strict_zero_touch'
  | 'light_polish'
  | 'cohesive_synthesis';

export type OutputTonePreset =
  | 'workshop_practical'
  | 'academic_engineering'
  | 'beginner_step_by_step'
  | 'concise_cheatsheet';

export interface EditorialStyleSettings {
  aiRewriteLevel?: AiRewriteLevel;
  outputTone?: OutputTonePreset;
  customStylePrompt?: string;
  includeWinolsActionTables?: boolean;
}

export interface EditorialPresetOption<T extends string> {
  id: T;
  labelFa: string;
  shortLabelFa: string;
  descriptionFa: string;
  rewriteCapPercent: number;
}

export const AI_REWRITE_LEVEL_OPTIONS: EditorialPresetOption<AiRewriteLevel>[] = [
  {
    id: 'strict_zero_touch',
    labelFa: '۰٪ بازنویسی (امانت‌داری مطلق)',
    shortLabelFa: '۰٪ دست‌نخورده',
    descriptionFa:
      'هیچ جمله‌ای از جزوه‌ها بازنویسی نمی‌شود؛ هوش مصنوعی فقط در ساختار، عناوین و باکس‌های تکمیلی مجزا کمک می‌کند.',
    rewriteCapPercent: 0,
  },
  {
    id: 'light_polish',
    labelFa: 'ویراستاری ملایم (پیشنهادی)',
    shortLabelFa: 'ویراستاری ملایم',
    descriptionFa:
      'اصلاح نیم‌فاصله، نگارش و روان کردن جمله‌بندی با قفل سخت ۱۰۰٪ روی اعداد، آدرس‌های هگز، کدهای خطا و نام نقشه‌ها.',
    rewriteCapPercent: 25,
  },
  {
    id: 'cohesive_synthesis',
    labelFa: 'ترکیب منسجم آموزشی',
    shortLabelFa: 'ترکیب منسجم',
    descriptionFa:
      'یکدست‌سازی کامل لحن میان چند جزوه، افزودن جملات پیوندی بین پاراگراف‌ها و تبدیل متن پراکنده به فصل کتاب (با حفظ مطلق داده‌های فنی).',
    rewriteCapPercent: 60,
  },
];

export const OUTPUT_TONE_OPTIONS: Array<{
  id: OutputTonePreset;
  labelFa: string;
  descriptionFa: string;
}> = [
  {
    id: 'workshop_practical',
    labelFa: 'کارگاهی و کاربردی (تیونر و تعمیرکار)',
    descriptionFa: 'زبان مستقیم، عملیاتی و متمرکز بر مراحل اجرا در WinOLS و نکات ایمنی موتور.',
  },
  {
    id: 'academic_engineering',
    labelFa: 'مهندسی و کتاب مرجع (رسمی)',
    descriptionFa: 'نثر رسمی، دقیق و ساختاریافته مناسب چاپ کتاب فنی و جزوه دانشگاهی.',
  },
  {
    id: 'beginner_step_by_step',
    labelFa: 'آموزشی گام‌به‌گام (مناسب کارآموز)',
    descriptionFa: 'توضیح ساده اصطلاحات تخصصی به همراه مثال ملموس و هشدار اشتباهات رایج.',
  },
  {
    id: 'concise_cheatsheet',
    labelFa: 'چکیده و مرجع سریع میز کار',
    descriptionFa: 'موجز، بولت‌پوینت‌شده و متمرکز بر اعداد، جدول‌ها و آدرس‌های کلیدی بدون حاشیه.',
  },
];

export const QUICK_CUSTOM_PROMPT_PRESETS: Array<{
  id: string;
  labelFa: string;
  promptText: string;
}> = [
  {
    id: 'winols_mentor',
    labelFa: 'استاد کارگاهی + هشدار ایمنی',
    promptText:
      'با لحن استاد باسابقه ریمپ توضیح بده؛ بعد از هر جدول یا مپ WinOLS یک باکس هشدار ایمنی (ناک، EGT یا AFR) و محدوده امن استیج ۱ را مشخص کن.',
  },
  {
    id: 'book_reference',
    labelFa: 'کتاب مرجع رسمی',
    promptText:
      'متن نهایی را به سبک کتاب مرجع مهندسی خودرو یکدست کن، از تکرار جملات مشابه بپرهیز و اصطلاحات لاتین (مانند KFZW، LAMFA، AFR) را دقیق حفظ کن.',
  },
  {
    id: 'stage1_cheatsheet',
    labelFa: 'چک‌لیست استیج ۱',
    promptText:
      'در پایان هر فصل یک جدول جمع‌بندی سریع شامل نام نقشه، محدوده RPM/بار هدف در WinOLS و مقدار تغییر مجاز استوک در برابر استیج ۱ تولید کن.',
  },
];

const HARD_TECHNICAL_FREEZE_CLAUSE = [
  'قفل مطلق داده‌های فنی (Hard Numeric & Hex Freeze):',
  '- هرگز هیچ آدرس هگز (مثل 0x1A4F0)، نام نقشه WinOLS (مثل KFZW، LAMFA، KFMIRL، LDRXN، NMAX)، مدل ECU (مثل ME7.4.4، SIM2K-241، Bosch MED17)، کد خطای DTC (مثل P0135، P0420) یا مقدار عددی کالیبراسیون (درجه آوانس، AFR، فشار bar، دور RPM، درصد بار) را تغییر، گرد یا حذف نکن.',
  '- اگر در متن دو جزوه اختلاف عددی وجود دارد، هر دو عدد را با ذکر منبع حفظ کن و هیچ‌کدام را به دلخواه حدس نزن.',
].join('\n');

export function normalizeEditorialSettings(
  raw?: Partial<EditorialStyleSettings> | Record<string, unknown> | null
): Required<EditorialStyleSettings> {
  const input = (raw || {}) as Partial<EditorialStyleSettings>;
  const validLevels: AiRewriteLevel[] = [
    'strict_zero_touch',
    'light_polish',
    'cohesive_synthesis',
  ];
  const validTones: OutputTonePreset[] = [
    'workshop_practical',
    'academic_engineering',
    'beginner_step_by_step',
    'concise_cheatsheet',
  ];

  const aiRewriteLevel = validLevels.includes(input.aiRewriteLevel as AiRewriteLevel)
    ? (input.aiRewriteLevel as AiRewriteLevel)
    : 'light_polish';
  const outputTone = validTones.includes(input.outputTone as OutputTonePreset)
    ? (input.outputTone as OutputTonePreset)
    : 'workshop_practical';
  const customStylePrompt =
    typeof input.customStylePrompt === 'string' ? input.customStylePrompt.trim().slice(0, 1200) : '';
  const includeWinolsActionTables = input.includeWinolsActionTables !== false;

  return {
    aiRewriteLevel,
    outputTone,
    customStylePrompt,
    includeWinolsActionTables,
  };
}

/**
 * Builds the deterministic Persian system directive injected into Gemini/LLM passes
 * so the user's chosen Rewrite Intensity, Output Tone, and Custom Prompt govern output
 * while strictly freezing all ECU numbers, hex addresses, map IDs, and DTC codes.
 */
export function buildEditorialSystemDirective(
  raw?: Partial<EditorialStyleSettings> | Record<string, unknown> | null
): string {
  const cfg = normalizeEditorialSettings(raw);

  const levelDirectiveMap: Record<AiRewriteLevel, string> = {
    strict_zero_touch:
      'سطح دخالت هوش مصنوعی: ۰٪ بازنویسی (Strict Zero-Touch). هیچ‌یک از پاراگراف‌های اصلی کاربر را بازنویسی نکن؛ صرفاً اصلاح عنوان فصل‌ها، افزودن باکس‌های تکمیلی/هشدار جداگانه و تولید جدول راهنمای WinOLS مجاز است.',
    light_polish:
      'سطح دخالت هوش مصنوعی: ویراستاری ملایم (Light Polish — حداکثر ۲۵٪ تغییر سطحی). فقط غلط‌های املایی، نیم‌فاصله‌ها، علائم نگارشی و ناهماهنگی‌های جزئی نگارشی را اصلاح کن و جملات ربط کوتاه بین جزوه‌ها اضافه کن؛ ساختار استدلال و جزئیات فنی دقیقاً مطابق متن اصلی بماند.',
    cohesive_synthesis:
      'سطح دخالت هوش مصنوعی: ترکیب منسجم آموزشی (Cohesive Synthesis). لحن چند جزوه را کاملاً یکپارچه کن، پاراگراف‌های پراکنده را با جملات پیوندی منطقی به هم وصل کن و توضیحات مبهم را شفاف‌تر بنویس، اما همچنان ۱۰۰٪ نکات یکتا و داده‌های فنی همه فایل‌ها را بدون حذف حفظ کن.',
  };

  const toneDirectiveMap: Record<OutputTonePreset, string> = {
    workshop_practical:
      'لحن خروجی: کارگاهی و کاربردی. مانند یک مهندس کالیبراسیون و تیونر باتجربه بنویس؛ مراحل عملی در WinOLS، محدوده دور/بار هدف و نکات ایمنی موتور را صریح و مستقیم بیان کن.',
    academic_engineering:
      'لحن خروجی: مهندسی و مرجع رسمی. از نثر استاندارد کتاب‌های فنی فارسی، اصطلاحات دقیق مهندسی احتراق/کالیبراسیون و ساختار علمی منظم استفاده کن.',
    beginner_step_by_step:
      'لحن خروجی: آموزشی گام‌به‌گام. هر مفهوم یا نقشه ECU را پیش از بیان مقدار تغییر، به زبان ساده توضیح بده و هشدار خطاهای رایج کارآموزان را برجسته کن.',
    concise_cheatsheet:
      'لحن خروجی: چکیده و مرجع سریع کارگاه. از حاشیه‌روی پرهیز کن، اطلاعات را فشرده، عددی و جدولی ارائه بده تا تیونر در چند ثانیه مقدار و محدوده تغییر را پیدا کند.',
  };

  const sections = [
    levelDirectiveMap[cfg.aiRewriteLevel],
    toneDirectiveMap[cfg.outputTone],
    HARD_TECHNICAL_FREEZE_CLAUSE,
  ];

  if (cfg.customStylePrompt) {
    sections.push(
      `دستورالعمل و پرامپت اختصاصی کاربر (با اولویت بالا تا زمانی که قفل داده‌های فنی را نقض نکند):\n«${cfg.customStylePrompt}»`
    );
  }

  return sections.join('\n\n');
}

// ============================================================================
// PART 2: DETERMINISTIC WINOLS MAP DETECTOR, 2D ZONE MATRIX & TABLE GENERATOR
// ============================================================================

export type WinolsMapCategory =
  | 'ignition'
  | 'fuel'
  | 'torque'
  | 'boost'
  | 'limiter'
  | 'pedal'
  | 'injection'
  | 'emission';

export type WinolsCellZone = 'stock' | 'ramp' | 'modify';

export interface WinolsZoneCell {
  rpm: number;
  loadPercent: number;
  zone: WinolsCellZone;
  deltaLabel: string;
}

export interface WinolsZoneMatrix {
  rpmAxis: number[];
  loadAxis: number[];
  unit: string;
  cells: WinolsZoneCell[][]; // [loadRowIndex][rpmColIndex]
  highlightedCellCount: number;
  totalCellCount: number;
  selectionInstructionFa: string;
}

export interface WinolsMapActionEntry {
  id: string;
  mapCode: string;
  mapNameFa: string;
  category: WinolsMapCategory;
  categoryLabelFa: string;
  ecuModels: string[];
  hexAddresses: string[];
  dimensions: string;
  isScalar: boolean;
  targetRpmRange: { min: number; max: number } | null;
  targetLoadRange: { min: number; max: number } | null;
  targetZoneLabelFa: string;
  modificationSummaryFa: string;
  numericValuesDetected: string[];
  recommendedDeltaLabel: string;
  safetyChecklistFa: string;
  winolsStepsFa: string[];
  sourceFiles: string[];
  evidenceSnippets: string[];
  zoneMatrix: WinolsZoneMatrix | null;
  confidence: 'high' | 'medium';
}

export interface WinolsExtractionReport {
  mapsDetected: number;
  entries: WinolsMapActionEntry[];
  summaryTable: TableBlock | null;
  generatedAt: string;
}

interface WinolsMapSpec {
  code: string;
  aliases: RegExp[];
  nameFa: string;
  category: WinolsMapCategory;
  categoryLabelFa: string;
  defaultDimensions: string;
  isScalar: boolean;
  defaultRpmRange: { min: number; max: number };
  defaultLoadRange: { min: number; max: number };
  defaultUnit: string;
  defaultDeltaLabel: string;
  safetyChecklistFa: string;
}

const WINOLS_MAP_CATALOG: WinolsMapSpec[] = [
  {
    code: 'KFZW',
    aliases: [/\bKFZW2?\b/i, /\bKFZWOP2?\b/i, /جدول\s+آوانس\s+جرقه/i, /مپ\s+آوانس/i],
    nameFa: 'نقشه اصلی آوانس جرقه (Ignition Timing)',
    category: 'ignition',
    categoryLabelFa: 'جرقه‌زنی و آوانس',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 3000, max: 5500 },
    defaultLoadRange: { min: 70, max: 100 },
    defaultUnit: 'deg',
    defaultDeltaLabel: '+2.0°',
    safetyChecklistFa:
      'لاگ‌گیری ناک (Knock Retard) روی بنزین واقعی الزامی است؛ در صورت مشاهده ناک بالای ۲ درجه، آوانس را برگردانید.',
  },
  {
    code: 'LAMFA',
    aliases: [/\bLAMFA\b/i, /\bKFLBTS\b/i, /مپ\s+سوخت\s+درخواستی/i, /نسبت\s+هوا\s+به\s+سوخت\s+در\s+بار\s+کامل/i],
    nameFa: 'نقشه نسبت هوا به سوخت درخواستی راننده (Target AFR / Lambda)',
    category: 'fuel',
    categoryLabelFa: 'سوخت و AFR',
    defaultDimensions: '6x15',
    isScalar: false,
    defaultRpmRange: { min: 3000, max: 6000 },
    defaultLoadRange: { min: 80, max: 100 },
    defaultUnit: 'AFR',
    defaultDeltaLabel: '12.5:1',
    safetyChecklistFa:
      'در بار کامل (WOT) با وایدبند بررسی کنید؛ مخلوط فقیرتر از 13.0:1 زیر بار خطر افزایش EGT و ذوب پیستون دارد.',
  },
  {
    code: 'KFMIRL',
    aliases: [/\bKFMIRL\b/i, /\bKFMIOP\b/i, /مپ\s+گشتاور\s+هدف/i, /نقشه\s+گشتاور\s+درخواستی/i],
    nameFa: 'نقشه تبدیل گشتاور به بار موتور (Target Engine Load)',
    category: 'torque',
    categoryLabelFa: 'مدیریت گشتاور',
    defaultDimensions: '16x16',
    isScalar: false,
    defaultRpmRange: { min: 2500, max: 5500 },
    defaultLoadRange: { min: 65, max: 100 },
    defaultUnit: '%',
    defaultDeltaLabel: '+10%',
    safetyChecklistFa:
      'تغییر KFMIRL بدون هماهنگی محور KFMIOP باعث خطای Torque Monitoring (کپ کردن دریچه گاز) می‌شود.',
  },
  {
    code: 'LDRXN',
    aliases: [/\bLDRXN(?:ZK)?\b/i, /\bKFLDHBN\b/i, /\bKFLDIMX\b/i, /\bSVBL\b/i, /مپ\s+بوست/i, /فشار\s+توربو/i],
    nameFa: 'نقشه حداکثر بار و فشار توربوشارژ (Max Boost / Load)',
    category: 'boost',
    categoryLabelFa: 'توربو و بوست',
    defaultDimensions: '16x1',
    isScalar: false,
    defaultRpmRange: { min: 2500, max: 5500 },
    defaultLoadRange: { min: 80, max: 100 },
    defaultUnit: 'bar',
    defaultDeltaLabel: '+0.2 bar',
    safetyChecklistFa:
      'محدودکننده تک‌مقداری SVBL و دمای هوای ورودی (IAT) را چک کنید تا توربو به ناحیه Surge یا Overspeed وارد نشود.',
  },
  {
    code: 'NMAX',
    aliases: [/\bNMAX(?:OG|DV)?\b/i, /محدودکننده\s+دور/i, /محدوده\s+کات[‌\s]?آف/i, /مپ\s+کات[‌\s]?آف/i],
    nameFa: 'محدودکننده حداکثر دور موتور (Rev Limiter / Cut-Off)',
    category: 'limiter',
    categoryLabelFa: 'محدودکننده (Limiter)',
    defaultDimensions: '1x1 (Scalar)',
    isScalar: true,
    defaultRpmRange: { min: 6000, max: 7000 },
    defaultLoadRange: { min: 80, max: 100 },
    defaultUnit: 'RPM',
    defaultDeltaLabel: '+350 RPM',
    safetyChecklistFa:
      'افزایش بیش‌ازحد کات‌آف در موتور با فنر سوپاپ استاندارد باعث شناور شدن سوپاپ (Valve Float) می‌شود.',
  },
  {
    code: 'KFPED',
    aliases: [/\bKFPED\b/i, /\bDW\b(?=\s+(?:map|مپ|جدول))/i, /مپ\s+پدال\s+گاز/i, /جدول\s+پدال\s+گاز/i],
    nameFa: 'نقشه حساسیت پدال گاز (Driver Wish / Throttle Response)',
    category: 'pedal',
    categoryLabelFa: 'پدال و دریچه گاز',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 1500, max: 4500 },
    defaultLoadRange: { min: 30, max: 80 },
    defaultUnit: '%',
    defaultDeltaLabel: '+8%',
    safetyChecklistFa:
      'در درصدهای زیر ۲۰٪ پدال (ترافیک و شروع حرکت) افزایش شدید ندهید تا خودرو دچار تقه و کله کردن نشود.',
  },
  {
    code: 'KRKTE',
    aliases: [/\bKRKTE\b/i, /\bTVUB\b/i, /\bSOI\b/i, /\bEOI\b/i, /پاشش\s+انژکتور/i],
    nameFa: 'ضریب پاشش انژکتور و زمان‌بندی سوخت (Injector Scaling / SOI)',
    category: 'injection',
    categoryLabelFa: 'انژکتور و پاشش',
    defaultDimensions: '1x1 / 16x16',
    isScalar: false,
    defaultRpmRange: { min: 2000, max: 5500 },
    defaultLoadRange: { min: 60, max: 100 },
    defaultUnit: 'ms',
    defaultDeltaLabel: 'تنظیم دقیق',
    safetyChecklistFa:
      'پس از تغییر ضریب انژکتور، مقادیر STFT و LTFT را در دور آرام و بار جاده پایش کنید (بازه‌ی ±۵٪).',
  },
  {
    code: 'VMAX',
    aliases: [/\bVMAX\b/i, /محدودکننده\s+سرعت/i],
    nameFa: 'محدودکننده حداکثر سرعت خودرو (Speed Limiter)',
    category: 'limiter',
    categoryLabelFa: 'محدودکننده (Limiter)',
    defaultDimensions: '1x1 (Scalar)',
    isScalar: true,
    defaultRpmRange: { min: 5000, max: 6500 },
    defaultLoadRange: { min: 80, max: 100 },
    defaultUnit: 'km/h',
    defaultDeltaLabel: 'برداشت محدودیت',
    safetyChecklistFa:
      'شاخص سرعت تایرها و سیستم ترمز خودرو را پیش از افزایش VMAX بررسی کنید.',
  },
];

const ECU_MODEL_REGEX =
  /\b(?:Bosch\s+)?(?:ME\d+(?:\.\d+){1,3}|MED\d+(?:\.\d+){1,2}|EDC\d+[A-Z0-9._-]*|SIM2K[- ]?\d+|SSAT|LZNF|MAW|S2000|SL96|J34|J35|Valeo\s*J\d+|M7\.4\.4|M7\.9\.7|ME17(?:\.\d+)*|EMS\d+|Delphi\s*MT\d+)\b/gi;
const HEX_ADDR_REGEX = /\b0x[0-9A-Fa-f]{4,8}\b/g;
const DIM_REGEX = /\b(\d{1,2})\s*[x×*]\s*(\d{1,2})\b/i;

const STANDARD_RPM_AXIS = [1500, 2500, 3500, 4500, 5500, 6500];
const STANDARD_LOAD_AXIS = [20, 40, 60, 80, 100];

function extractRpmRangeFromText(text: string): { min: number; max: number } | null {
  const ascii = toAsciiDigits(text);
  // Pattern: "3000 تا 5500 RPM" or "3000-5500 دور"
  const rangeMatch = ascii.match(
    /\b([1-8]\d{3})\s*(?:تا|[-–—]|to)\s*([1-8]\d{3})\s*(?:rpm|دور)?/i
  );
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (a >= 800 && b <= 9000 && a < b) {
      return { min: a, max: b };
    }
  }
  // Pattern: single RPM mention near map (e.g. "در 3500 دور" or "3500 RPM")
  const singleMatch = ascii.match(/\b([1-8]\d{3})\s*(?:rpm|دور)/i);
  if (singleMatch) {
    const v = Number(singleMatch[1]);
    if (v >= 1000 && v <= 8500) {
      return { min: Math.max(1500, v - 500), max: Math.min(7000, v + 1000) };
    }
  }
  return null;
}

function extractLoadRangeFromText(text: string): { min: number; max: number } | null {
  const ascii = toAsciiDigits(text);
  // Pattern: "بار 70 تا 100%" or "70-100% load"
  const rangeMatch = ascii.match(
    /(?:بار|پدال|load|throttle)[^\d]{0,14}(\d{2,3})\s*(?:تا|[-–—]|to)\s*(\d{2,3})\s*[%٪]?/i
  );
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (a >= 0 && b <= 100 && a < b) return { min: a, max: b };
  }
  // Pattern: "بار بالای 70%"
  const aboveMatch = ascii.match(/(?:بار|پدال|load)[^\d]{0,14}(?:بالای|بیش\s*از|>=?)\s*(\d{2})\s*[%٪]?/i);
  if (aboveMatch) {
    const a = Number(aboveMatch[1]);
    if (a >= 20 && a <= 95) return { min: a, max: 100 };
  }
  // Pattern: WOT / full load
  if (/بار\s+کامل|\bWOT\b|تخته\s*گاز|فول\s*لود/i.test(ascii)) {
    return { min: 80, max: 100 };
  }
  return null;
}

function extractModificationValues(
  text: string,
  spec: WinolsMapSpec
): { values: string[]; deltaLabel: string; summaryFa: string } {
  const ascii = toAsciiDigits(text);
  const found: string[] = [];

  // 1. Explicit signed delta (+2.5°, -2.5 deg, +10%, +0.3 bar)
  const deltaRegex =
    /([+-]\s*\d+(?:\.\d+)?)\s*(°|درجه|deg|%|٪|bar|بار|psi|rpm|دور|nm|ms)/gi;
  let m: RegExpExecArray | null;
  while ((m = deltaRegex.exec(ascii)) !== null) {
    const num = m[1].replace(/\s+/g, '');
    const rawUnit = m[2];
    const unit =
      rawUnit === 'درجه' || rawUnit.toLowerCase() === 'deg'
        ? '°'
        : rawUnit === '٪'
          ? '%'
          : rawUnit === 'بار'
            ? ' bar'
            : rawUnit === 'دور'
              ? ' RPM'
              : rawUnit === '°' || rawUnit === '%'
                ? rawUnit
                : ` ${rawUnit}`;
    found.push(`${num}${unit}`);
  }

  // 2. Unsigned explicit degree/AFR/bar/RPM values specific to this map
  if (spec.category === 'ignition') {
    const degMatches = ascii.match(/\b\d+(?:\.\d+)?\s*(?:°|درجه|deg)\b/gi) || [];
    for (const dm of degMatches) {
      const clean = dm.replace(/درجه|deg/gi, '°').replace(/\s+/g, '');
      if (!found.some((f) => f.includes(clean))) found.push(clean);
    }
  } else if (spec.category === 'fuel') {
    const afrMatches = ascii.match(/\b1[0-6](?:\.\d+)?\s*:\s*1\b/g) || [];
    for (const am of afrMatches) {
      const clean = am.replace(/\s+/g, '');
      if (!found.includes(clean)) found.push(clean);
    }
    const lamMatches = ascii.match(/\b0\.\d{2}\s*(?:lambda|لامبدا)\b/gi) || [];
    for (const lm of lamMatches) {
      if (!found.includes(lm)) found.push(lm);
    }
  } else if (spec.category === 'limiter') {
    const rpmMatches = ascii.match(/\b[5-8]\d{3}\s*(?:rpm|دور)\b/gi) || [];
    for (const rm of rpmMatches) {
      const clean = rm.replace(/دور/g, 'RPM').replace(/\s+/g, ' ').toUpperCase();
      if (!found.includes(clean)) found.push(clean);
    }
  } else if (spec.category === 'boost') {
    const barMatches = ascii.match(/\b\d+(?:\.\d+)?\s*(?:bar|بار|psi)\b/gi) || [];
    for (const bm of barMatches) {
      const clean = bm.replace(/بار/g, 'bar').replace(/\s+/g, ' ');
      if (!found.includes(clean)) found.push(clean);
    }
  }

  // Detect "from X to Y" transitions (e.g., "6500 به 6950 RPM" or two distinct numbers in table)
  const uniqueFound = Array.from(new Set(found)).slice(0, 6);

  let deltaLabel = spec.defaultDeltaLabel;
  if (uniqueFound.length > 0) {
    const signed = uniqueFound.find((v) => v.startsWith('+') || v.startsWith('-'));
    if (signed) {
      deltaLabel = signed;
    } else if (spec.category === 'ignition') {
      // If text mentions "تا 2.5°", display +2.5°
      const smallDeg = uniqueFound.find((v) => {
        const n = parseFloat(v);
        return !Number.isNaN(n) && n > 0 && n <= 6;
      });
      deltaLabel = smallDeg ? `+${smallDeg}` : uniqueFound[0];
    } else {
      deltaLabel = uniqueFound[0];
    }
  }

  let summaryFa = '';
  if (uniqueFound.length >= 2) {
    summaryFa = `مقادیر استخراج‌شده از جزوه‌ها: ${uniqueFound.join(' | ')}`;
  } else if (uniqueFound.length === 1) {
    summaryFa = `مقدار هدف / تغییر ثبت‌شده در جزوه: ${uniqueFound[0]}`;
  } else {
    summaryFa = `تغییر توصیه‌شده در متن (نیاز به اعمال تدریجی با ${spec.defaultDeltaLabel})`;
  }

  return { values: uniqueFound, deltaLabel, summaryFa };
}

function buildWinols2DZoneMatrix(params: {
  rpmRange: { min: number; max: number };
  loadRange: { min: number; max: number };
  deltaLabel: string;
  unit: string;
}): WinolsZoneMatrix {
  const { rpmRange, loadRange, deltaLabel, unit } = params;
  const cells: WinolsZoneCell[][] = [];
  let highlightedCellCount = 0;

  // Build ramp delta label (half of numeric delta when parseable)
  const numMatch = deltaLabel.match(/^([+-]?)(\d+(?:\.\d+)?)(.*)$/);
  const rampLabel = numMatch
    ? `${numMatch[1]}${Number((parseFloat(numMatch[2]) * 0.5).toFixed(1))}${numMatch[3]}`
    : 'شیب نرم';

  for (const load of STANDARD_LOAD_AXIS) {
    const row: WinolsZoneCell[] = [];
    for (const rpm of STANDARD_RPM_AXIS) {
      const inRpm = rpm >= rpmRange.min && rpm <= rpmRange.max;
      const inLoad = load >= loadRange.min && load <= loadRange.max;

      const nearRpm = rpm >= rpmRange.min - 1000 && rpm <= rpmRange.max + 1000;
      const nearLoad = load >= loadRange.min - 20 && load <= loadRange.max + 20;

      let zone: WinolsCellZone = 'stock';
      let cellLabel = '0';

      if (inRpm && inLoad) {
        zone = 'modify';
        cellLabel = deltaLabel;
        highlightedCellCount += 1;
      } else if (nearRpm && nearLoad) {
        zone = 'ramp';
        cellLabel = rampLabel;
      } else {
        zone = 'stock';
        cellLabel = 'استوک';
      }

      row.push({
        rpm,
        loadPercent: load,
        zone,
        deltaLabel: cellLabel,
      });
    }
    cells.push(row);
  }

  const selectionInstructionFa = `در WinOLS، ستون‌های دور ${toPersianDigits(rpmRange.min)} تا ${toPersianDigits(rpmRange.max)} RPM و سطرهای بار ${toPersianDigits(loadRange.min)}٪ تا ${toPersianDigits(loadRange.max)}٪ را با ماوس انتخاب (Highlight) کنید، مقدار ${deltaLabel} را اعمال کرده و سلول‌های همجوار (ناحیه زرد) را برای جلوگیری از پله ناگهانی، با ابزار Smooth / Interpolate هموار کنید.`;

  return {
    rpmAxis: STANDARD_RPM_AXIS,
    loadAxis: STANDARD_LOAD_AXIS,
    unit,
    cells,
    highlightedCellCount,
    totalCellCount: STANDARD_RPM_AXIS.length * STANDARD_LOAD_AXIS.length,
    selectionInstructionFa,
  };
}

/**
 * Deterministically scans all project content units (prose + tables) to detect WinOLS
 * calibration map modifications, extract ECU models, hex addresses, RPM/Load operating
 * windows, and generate both interactive 2D WinOLS Cell-Zone Matrices and an export-ready
 * WinOLS Quick-Action Table (`TableBlock`).
 */
export function extractWinolsMapGuides(params: {
  sourceFiles: SourceFileDto[];
  units: ContentUnitDto[];
}): WinolsExtractionReport {
  const fileMap = new Map(params.sourceFiles.map((f) => [f.id, f.fileName]));
  const activeUnits = params.units.filter((u) => u.status !== 'merged');

  // Collect all evidence blocks per catalog map
  const mapHits = new Map<
    string,
    {
      spec: WinolsMapSpec;
      texts: string[];
      files: Set<string>;
      ecuModels: Set<string>;
      hexAddresses: Set<string>;
      dimensions: string | null;
      rpmRange: { min: number; max: number } | null;
      loadRange: { min: number; max: number } | null;
    }
  >();

  // Global ECU context fallback (if file mentions ECU in heading/previous paragraph)
  const fileEcuHints = new Map<string, Set<string>>();
  for (const u of activeUnits) {
    const ecus = u.rawText.match(ECU_MODEL_REGEX) || [];
    if (ecus.length > 0) {
      if (!fileEcuHints.has(u.sourceFileId)) fileEcuHints.set(u.sourceFileId, new Set());
      ecus.forEach((e) => fileEcuHints.get(u.sourceFileId)!.add(e.trim()));
    }
  }

  for (const unit of activeUnits) {
    const fileName = fileMap.get(unit.sourceFileId) || 'سند منبع';
    // Split multi-line tables/paragraphs into granular lines so we bind hex addresses accurately to the right map
    const segments = unit.rawText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const segment of segments) {
      for (const spec of WINOLS_MAP_CATALOG) {
        const matched = spec.aliases.some((re) => re.test(segment));
        if (!matched) continue;

        let bucket = mapHits.get(spec.code);
        if (!bucket) {
          bucket = {
            spec,
            texts: [],
            files: new Set<string>(),
            ecuModels: new Set<string>(),
            hexAddresses: new Set<string>(),
            dimensions: null,
            rpmRange: null,
            loadRange: null,
          };
          mapHits.set(spec.code, bucket);
        }

        bucket.texts.push(segment);
        bucket.files.add(fileName);

        const segEcus = segment.match(ECU_MODEL_REGEX) || [];
        segEcus.forEach((e) => bucket!.ecuModels.add(e.trim()));
        if (segEcus.length === 0) {
          const hint = fileEcuHints.get(unit.sourceFileId);
          if (hint && hint.size === 1) {
            hint.forEach((e) => bucket!.ecuModels.add(e));
          }
        }

        const segHex = segment.match(HEX_ADDR_REGEX) || [];
        segHex.forEach((h) => bucket!.hexAddresses.add(h.toUpperCase().replace(/^0X/, '0x')));

        const dimM = segment.match(DIM_REGEX);
        if (dimM && !bucket.dimensions) {
          bucket.dimensions = `${dimM[1]}x${dimM[2]}`;
        }

        const segRpm = extractRpmRangeFromText(segment);
        if (segRpm && !bucket.rpmRange) {
          bucket.rpmRange = segRpm;
        }

        const segLoad = extractLoadRangeFromText(segment);
        if (segLoad && !bucket.loadRange) {
          bucket.loadRange = segLoad;
        }
      }
    }
  }

  const entries: WinolsMapActionEntry[] = [];

  for (const [code, bucket] of mapHits.entries()) {
    const combinedText = bucket.texts.join(' | ');
    const { values, deltaLabel, summaryFa } = extractModificationValues(combinedText, bucket.spec);

    const effectiveRpm = bucket.rpmRange || bucket.spec.defaultRpmRange;
    const effectiveLoad = bucket.loadRange || bucket.spec.defaultLoadRange;

    const targetZoneLabelFa = bucket.spec.isScalar
      ? 'مقدار تک‌سلولی (Scalar / 1x1) — بدون محور ۲بعدی'
      : `دور ${toPersianDigits(effectiveRpm.min)} تا ${toPersianDigits(effectiveRpm.max)} RPM · بار ${toPersianDigits(effectiveLoad.min)}٪ تا ${toPersianDigits(effectiveLoad.max)}٪`;

    const hexList = Array.from(bucket.hexAddresses);
    const ecuList = Array.from(bucket.ecuModels);
    const dimensions = bucket.dimensions || bucket.spec.defaultDimensions;

    const zoneMatrix = bucket.spec.isScalar
      ? null
      : buildWinols2DZoneMatrix({
          rpmRange: effectiveRpm,
          loadRange: effectiveLoad,
          deltaLabel,
          unit: bucket.spec.defaultUnit,
        });

    const winolsStepsFa: string[] = bucket.spec.isScalar
      ? [
          hexList.length > 0
            ? `در WinOLS با کلید Ctrl+G به آدرس هگز ${hexList[0]} بروید (یا نقشه ${code} را در فهرست Potential Maps باز کنید).`
            : `در WinOLS با استفاده از Damos / Map Pack نقشه تک‌مقداری ${code} را جستجو و باز کنید.`,
          `مقدار فعلی استوک را یادداشت کرده و مقدار جدید (${deltaLabel}) را با رعایت ضریب (Factor) استاندارد ایسیو وارد کنید.`,
          `پس از ذخیره، Checksum فایل خروجی را قبل از رایت روی ECU حتماً تصحیح کنید.`,
        ]
      : [
          hexList.length > 0
            ? `در WinOLS با Ctrl+G به آدرس ${hexList[0]} بروید و نقشه ${code} (${dimensions}) را در نمای Text/2D باز کنید.`
            : `در WinOLS نقشه ${code} (ابعاد معمول ${dimensions}) را در نمای جدولی (Text View) باز کنید.`,
          `سلول‌های ناحیه هدف یعنی دور ${toPersianDigits(effectiveRpm.min)} تا ${toPersianDigits(effectiveRpm.max)} RPM و بار ${toPersianDigits(effectiveLoad.min)}٪ تا ${toPersianDigits(effectiveLoad.max)}٪ را انتخاب کنید.`,
          `تغییر (${deltaLabel}) را با کلید Enter یا تغییر درصدی اعمال کرده و ردیف/ستون مرزی (ناحیه زرد ماتریس) را شیب نرم (Interpolate) دهید.`,
          `در نمای 3D سطح نقشه را بررسی کنید تا هیچ قله تیز یا افت ناگهانی وجود نداشته باشد و سپس Checksum بگیرید.`,
        ];

    const confidence: 'high' | 'medium' =
      hexList.length > 0 || values.length > 0 || bucket.rpmRange !== null ? 'high' : 'medium';

    entries.push({
      id: `winols_${code.toLowerCase()}`,
      mapCode: code,
      mapNameFa: bucket.spec.nameFa,
      category: bucket.spec.category,
      categoryLabelFa: bucket.spec.categoryLabelFa,
      ecuModels: ecuList,
      hexAddresses: hexList,
      dimensions,
      isScalar: bucket.spec.isScalar,
      targetRpmRange: bucket.spec.isScalar ? null : effectiveRpm,
      targetLoadRange: bucket.spec.isScalar ? null : effectiveLoad,
      targetZoneLabelFa,
      modificationSummaryFa: summaryFa,
      numericValuesDetected: values,
      recommendedDeltaLabel: deltaLabel,
      safetyChecklistFa: bucket.spec.safetyChecklistFa,
      winolsStepsFa,
      sourceFiles: Array.from(bucket.files),
      evidenceSnippets: Array.from(new Set(bucket.texts)).slice(0, 3),
      zoneMatrix,
      confidence,
    });
  }

  // Sort high-confidence and hex-anchored maps first
  entries.sort((a, b) => {
    const scoreA = (a.hexAddresses.length > 0 ? 4 : 0) + (a.confidence === 'high' ? 2 : 0) + (a.isScalar ? 0 : 1);
    const scoreB = (b.hexAddresses.length > 0 ? 4 : 0) + (b.confidence === 'high' ? 2 : 0) + (b.isScalar ? 0 : 1);
    return scoreB - scoreA;
  });

  const summaryTable = buildWinolsSummaryTableBlock(entries);

  return {
    mapsDetected: entries.length,
    entries,
    summaryTable,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates an export-ready `TableBlock` summarizing all detected WinOLS map modifications
 * so the reader has a concise, print-ready WinOLS Cheat Sheet inside the merged book and `.docx`.
 */
export function buildWinolsSummaryTableBlock(entries: WinolsMapActionEntry[]): TableBlock | null {
  if (entries.length === 0) return null;

  return {
    type: 'table',
    id: 'tbl_winols_quick_action_guide',
    caption: 'جدول راهنمای سریع تغییرات نقشه‌های WinOLS (استخراج خودکار از جزوه‌های پروژه)',
    headers: [
      'کد و نام نقشه WinOLS',
      'ایسیو / آدرس هگز / ابعاد',
      'ناحیه هدف تغییر در جدول WinOLS',
      'مقدار تغییر / داده استخراج‌شده',
      'هشدار ایمنی و چک‌لیست اجرا',
    ],
    rows: entries.map((entry) => {
      const ecuPart = entry.ecuModels.length > 0 ? entry.ecuModels.join('، ') : 'مطابق دامپ پروژه';
      const hexPart = entry.hexAddresses.length > 0 ? entry.hexAddresses.join('، ') : 'جستجو با Damos';
      return [
        `${entry.mapCode} — ${entry.mapNameFa}`,
        `${ecuPart} | آدرس: ${hexPart} | ابعاد: ${entry.dimensions}`,
        entry.targetZoneLabelFa,
        `${entry.recommendedDeltaLabel} (${entry.modificationSummaryFa})`,
        entry.safetyChecklistFa,
      ];
    }),
    generatedBy: 'local',
    sourceFileNames: Array.from(new Set(entries.flatMap((e) => e.sourceFiles))),
  };
}

/**
 * Generates a UTF-8 CSV (with BOM for Excel) containing all extracted WinOLS map actions
 * for quick workshop reference or import into tuning checklists.
 */
export function buildWinolsGuideCsv(entries: WinolsMapActionEntry[]): string {
  const esc = (v: string) => `"${String(v || '').replace(/"/g, '""')}"`;
  const headers = [
    'Map Code',
    'Persian Name',
    'ECU Models',
    'Hex Addresses',
    'Dimensions',
    'Target Zone (WinOLS)',
    'Delta / Value',
    'Safety Checklist',
    'Source Files',
  ];
  const rows = entries.map((e) =>
    [
      e.mapCode,
      e.mapNameFa,
      e.ecuModels.join('; '),
      e.hexAddresses.join('; '),
      e.dimensions,
      e.targetZoneLabelFa,
      `${e.recommendedDeltaLabel} — ${e.modificationSummaryFa}`,
      e.safetyChecklistFa,
      e.sourceFiles.join('; '),
    ]
      .map(esc)
      .join(',')
  );
  return `\uFEFF${headers.map(esc).join(',')}\n${rows.join('\n')}`;
}
