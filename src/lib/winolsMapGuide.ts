import type { ContentUnitDto, OutlineNodeDto, ParsedBook, SourceFileDto, TableBlock } from './bookTypes.ts';
import { toAsciiDigits, toPersianDigits } from './formatParsers.ts';
import { buildUniversalSystemPromptBlock } from './universalSystemPrompt.ts';

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
  {
    id: 'zero_to_hero_book',
    labelFa: 'کتاب آموزشی از صفر (رسمی و شیرین)',
    promptText:
      'کتاب را طوری تدوین کن که خواننده بدون هیچ پیش‌زمینه‌ای از صفرِ صفر و پله‌پله تا سطح پیشرفته یاد بگیرد؛ لحن رسمی اما شیرین، ساده و بدون کلمات قلمبه‌سلمبه باشد و مفاهیم کلیدی با مثال روزمره، توضیح ساده، فرمول با مثال عددی و جدول/باکس آموزشی شفاف شوند.',
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

  const universalRulesBlock = buildUniversalSystemPromptBlock({
    mode: 'compact',
    respectZeroTouch: cfg.aiRewriteLevel === 'strict_zero_touch',
  });

  const sections = [
    universalRulesBlock,
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

export interface WinolsDamosExtractedMeta {
  factor?: number;
  offset?: number;
  dataOrg?: '8bit' | '16bit';
  signed?: boolean;
  byteOrder?: 'LoHi' | 'HiLo';
  baseAddressHex?: string;
  axisXHex?: string;
  axisYHex?: string;
  axisXLabel?: string;
  axisYLabel?: string;
  axisXUnit?: string;
  axisYUnit?: string;
  unit?: string;
  lineSwappingRequired?: boolean;
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
  damosMeta?: WinolsDamosExtractedMeta;
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
  defaultDamosMeta?: WinolsDamosExtractedMeta;
}

const WINOLS_MAP_CATALOG: WinolsMapSpec[] = [
  // ---- BOSCH / EUROPEAN STANDARD MAPS ----
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
    defaultDamosMeta: { factor: 0.75, offset: 0, dataOrg: '8bit', signed: true, unit: 'deg' },
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
    defaultDamosMeta: { factor: 0.007813, offset: 0, dataOrg: '8bit', signed: false, unit: 'Lambda' },
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
    defaultDamosMeta: { factor: 0.023438, offset: 0, dataOrg: '16bit', signed: false, unit: '%' },
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
    defaultDamosMeta: { factor: 0.023438, offset: 0, dataOrg: '16bit', signed: false, unit: '%' },
  },
  {
    code: 'NMAX',
    aliases: [/\bNMAX(?:OG|DV)?\b/i, /\bHard\s*Limit\b/i, /محدودکننده\s+دور/i, /محدوده\s+کات[‌\s]?آف/i, /مپ\s+کات[‌\s]?آف/i, /کات[‌\s]?آف\s+رگباری/i],
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
    defaultDamosMeta: { factor: 1, offset: 0, dataOrg: '16bit', signed: false, unit: 'RPM' },
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
    defaultDamosMeta: { factor: 0.003052, offset: 0, dataOrg: '16bit', signed: false, unit: '%' },
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
    defaultDamosMeta: { factor: 0.000111, offset: 0, dataOrg: '16bit', signed: false, unit: 'ms/%' },
  },
  {
    code: 'VMAX',
    aliases: [/\bVMAX\b/i, /\bSpeed\s+Limiter\b/i, /محدودکننده\s+سرعت/i],
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
      'شاخص سرعت تایرها و سیستم ترمز خودرو را پیش از افزایش VMAX بررسی کنید (در زیمنس زامیاد هر ۳ پارامتر باید یکسان شوند).',
    defaultDamosMeta: { factor: 1, offset: 0, dataOrg: '8bit', signed: false, unit: 'km/h' },
  },

  // ---- IRANIAN SIEMENS / TNM / WINOLS CALIBRATION MAPS ----
  {
    code: 'IGN_BASE',
    aliases: [/\bIGN[_\s]?Base\b/i, /\bIGN\s*1\b/i, /نقشه\s+پایه\s+آوانس\s+جرقه/i, /آوانس\s+جرقه\s+بنزین/i],
    nameFa: 'نقشه پایه آوانس جرقه بنزین زیمنس (IGN_Base / IGN 1)',
    category: 'ignition',
    categoryLabelFa: 'جرقه‌زنی و آوانس',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 2500, max: 5800 },
    defaultLoadRange: { min: 60, max: 100 },
    defaultUnit: '°BTDC',
    defaultDeltaLabel: '+2.5°',
    safetyChecklistFa:
      'در موتورهای تراکم بالا (مثل EF7 با نسبت 11:1) بدون غنی‌سازی سوخت و پایش سنسور ناک، آوانس تهاجمی ندهید؛ فاکتور استاندارد زیمنس 0.375 و آفست -23.6 است.',
    defaultDamosMeta: {
      factor: 0.375,
      offset: -23.6,
      dataOrg: '8bit',
      signed: false,
      unit: 'degBTDC',
      axisXLabel: 'Engine Speed (RPM)',
      axisYLabel: 'Air Mass / Load',
    },
  },
  {
    code: 'IGN_2_GAS',
    aliases: [/\bIGN[_\s]?2(?:[_\s]?Gas(?:[_\s]?Base)?)?\b/i, /آوانس\s+جرقه\s+گاز/i, /جدول\s+دوم\s+جرقه/i],
    nameFa: 'نقشه پایه آوانس جرقه گاز دوگانه‌سوز (IGN 2 / CNG-LPG)',
    category: 'ignition',
    categoryLabelFa: 'جرقه‌زنی و آوانس',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 1500, max: 4500 },
    defaultLoadRange: { min: 40, max: 90 },
    defaultUnit: '°BTDC',
    defaultDeltaLabel: '+4.0°',
    safetyChecklistFa:
      'در ایسیوهای دوگانه‌سوز زیمنس، IGN 2 باید دقیقاً چسبیده به IGN 1 و یک مستطیل کامل تشکیل دهد؛ مراقب افزایش دمای سوپاپ‌های دود در CNG باشید.',
    defaultDamosMeta: {
      factor: 0.375,
      offset: -23.6,
      dataOrg: '8bit',
      signed: false,
      unit: 'degBTDC',
      axisXLabel: 'Engine Speed (RPM)',
      axisYLabel: 'Air Mass / Load',
    },
  },
  {
    code: 'IGN_CORR_FL',
    aliases: [
      /\bFull\s+Load\s+Ignition\s+Correction\b/i,
      /\bGeneral\s+Ignition\s+Correction\b/i,
      /\bIGN\s+Correction\b/i,
      /اصلاح\s+(?:کلی\s+)?(?:آوانس\s+)?جرقه/i,
    ],
    nameFa: 'جدول اصلاح آوانس جرقه بار کامل / عمومی (IGN Correction)',
    category: 'ignition',
    categoryLabelFa: 'جرقه‌زنی و آوانس',
    defaultDimensions: '4x16',
    isScalar: false,
    defaultRpmRange: { min: 3000, max: 6000 },
    defaultLoadRange: { min: 70, max: 100 },
    defaultUnit: 'deg',
    defaultDeltaLabel: '0.02 (خنثی)',
    safetyChecklistFa:
      'در EF7 مقدار ثابت 0.02 برای جلوگیری از خطای Division by Zero قرار داده شده و نباید دستکاری شود؛ اصلاحات جرقه روی IGN 1 / IGN 2 انجام شود.',
    defaultDamosMeta: { factor: 0.08292, offset: 0, dataOrg: '8bit', signed: false, unit: 'deg' },
  },
  {
    code: 'FULL_LOAD_DET',
    aliases: [/\bFull\s+Load\s+Detection\b/i, /تشخیص\s+بار\s+کامل/i, /آستانه\s+بار\s+کامل/i],
    nameFa: 'منحنی آستانه تشخیص بار کامل (Full Load Detection)',
    category: 'pedal',
    categoryLabelFa: 'پدال و دریچه گاز',
    defaultDimensions: '16x1',
    isScalar: false,
    defaultRpmRange: { min: 1500, max: 6000 },
    defaultLoadRange: { min: 50, max: 85 },
    defaultUnit: '%',
    defaultDeltaLabel: '80% -> 70%',
    safetyChecklistFa:
      'کاهش بیش‌ازحد آستانه بار کامل (زیر ۴۰٪) باعث خروج زودهنگام از حلقه بسته و افزایش شدید مصرف سوخت شهری می‌شود.',
    defaultDamosMeta: { factor: 0.468627, offset: 0, dataOrg: '8bit', signed: false, unit: '%' },
  },
  {
    code: 'VE_TABLE',
    aliases: [/\bVE\s+Table\b/i, /\bVolumetric\s+Efficiency\b/i, /بازده\s+تنفسی/i, /جدول\s+VE\b/i],
    nameFa: 'جدول بازده تنفسی سیلندر (Volumetric Efficiency — VE)',
    category: 'torque',
    categoryLabelFa: 'جریان هوا و تنفس',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 2000, max: 6000 },
    defaultLoadRange: { min: 50, max: 100 },
    defaultUnit: 'ratio',
    defaultDeltaLabel: '+5%',
    safetyChecklistFa:
      'در موتورهای دارای VVT (مانند EF7) منحنی VE ذاتاً غیرخطی است؛ در خودروهای دارای میل‌سوپاپ اسپرت حداکثر +۵٪ با پایش وایدبند اصلاح شود.',
    defaultDamosMeta: { factor: 0.00390625, offset: 0, dataOrg: '8bit', signed: false, unit: '-' },
  },
  {
    code: 'AIR_MASS_OFFSET_SLOPE',
    aliases: [
      /\bAir\s+Mass\s+Offset\b/i,
      /\bAir\s+Mass\s+Factor\b/i,
      /\bAir\s+Mass\s+Slope\b/i,
      /عرض\s+از\s+مبدأ\s+جریان\s+هوا/i,
      /شیب\s+خط\s+جریان\s+هوا/i,
      /جداول\s+محاسباتی\s+هوا/i,
    ],
    nameFa: 'نقشه‌های سه‌بعدی عرض از مبدأ و شیب جریان هوا (Air Mass Offset & Slope)',
    category: 'torque',
    categoryLabelFa: 'جریان هوا و تنفس',
    defaultDimensions: '8x12',
    isScalar: false,
    defaultRpmRange: { min: 3500, max: 6500 },
    defaultLoadRange: { min: 70, max: 100 },
    defaultUnit: 'mg/stk',
    defaultDeltaLabel: '+5% گوشه‌ای',
    safetyChecklistFa:
      'در EF7 شبکه CBAR مبنای محوریابی 0x14000 است (محور X: 14FDA و محور Y: 14078)؛ تغییر را صرفاً به‌صورت گوشه‌ای (+۵٪ بار سنگین و دور بالا) اعمال کنید.',
    defaultDamosMeta: {
      factor: 0.03125,
      offset: 0,
      dataOrg: '16bit',
      signed: false,
      unit: 'mg/stk',
      axisXLabel: 'RPM / VVT',
      axisYLabel: 'MAP (hPa)',
    },
  },
  {
    code: 'AIR_MASS_MAP',
    aliases: [/\bAir\s+Mass\s+vs\s+(?:MAP|Pressure)\b/i, /دبی\s+جرمی\s+هوا.*فشار/i],
    nameFa: 'نقشه جرم هوای ورودی بر اساس فشار مانیفولد (Air Mass vs MAP)',
    category: 'torque',
    categoryLabelFa: 'جریان هوا و تنفس',
    defaultDimensions: '16x8',
    isScalar: false,
    defaultRpmRange: { min: 2000, max: 6000 },
    defaultLoadRange: { min: 50, max: 100 },
    defaultUnit: 'mg/stk',
    defaultDeltaLabel: '+4%',
    safetyChecklistFa:
      'تغییر نامتوازن مدل Speed-Density باعث خطای سنسور MAP و به‌هم‌ریختن Fuel Trim در دور آرام می‌شود.',
    defaultDamosMeta: { factor: 0.00032195, offset: 0, dataOrg: '16bit', signed: false, unit: 'mg/stk' },
  },
  {
    code: 'AIR_MASS_TPS',
    aliases: [/\bAir\s+Mass\s+vs\s+TPS\b/i, /جرم\s+هوا.*دریچه\s+گاز/i],
    nameFa: 'نقشه جرم هوا بر اساس زاویه دریچه گاز (Air Mass vs TPS)',
    category: 'pedal',
    categoryLabelFa: 'پدال و دریچه گاز',
    defaultDimensions: '16x8',
    isScalar: false,
    defaultRpmRange: { min: 1500, max: 5500 },
    defaultLoadRange: { min: 30, max: 100 },
    defaultUnit: 'mg/stk',
    defaultDeltaLabel: '+3%',
    safetyChecklistFa:
      'در خودروهای دارای دریچه گاز بزرگ‌تر (مانند دریچه نیسانی) باید هم‌زمان با جدول MAP و Injection Multiplier هماهنگ شود.',
    defaultDamosMeta: { factor: 0.03125, offset: 0, dataOrg: '16bit', signed: false, unit: 'mg/stk' },
  },
  {
    code: 'VALVE_OVERLAP',
    aliases: [/\bValve\s+Overlap\b/i, /هم[‌\s]?پوشانی\s+سوپاپ/i, /قیچی\s+سوپاپ/i],
    nameFa: 'نقشه هم‌پوشانی سوپاپ‌ها (Valve Overlap)',
    category: 'torque',
    categoryLabelFa: 'جریان هوا و تنفس',
    defaultDimensions: '8x8',
    isScalar: false,
    defaultRpmRange: { min: 2500, max: 6000 },
    defaultLoadRange: { min: 50, max: 100 },
    defaultUnit: 'deg',
    defaultDeltaLabel: '-10%',
    safetyChecklistFa:
      'در خودروهای دارای میل‌سوپاپ اسپرت (تیبا/XU7) کاهش حدود -۱۰٪ در جدول قیچی سوپاپ برای اصلاح مدل هوا در WinOLS توصیه می‌شود.',
    defaultDamosMeta: { factor: 0.002061, offset: -198.2, dataOrg: '16bit', signed: false, unit: 'deg' },
  },
  {
    code: 'VVT_MAP',
    aliases: [/\bVVT\s+Map\b/i, /نقشه\s+(?:زمان[‌\s]?بندی\s+متغیر\s+سوپاپ|VVT)/i, /جدول\s+VVT\b/i],
    nameFa: 'نقشه زمان‌بندی متغیر سوپاپ هوا (VVT / CVVT Map)',
    category: 'torque',
    categoryLabelFa: 'تایمینگ سوپاپ (VVT)',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 2000, max: 6000 },
    defaultLoadRange: { min: 40, max: 100 },
    defaultUnit: 'deg',
    defaultDeltaLabel: '+2..3% (سقف 5%)',
    safetyChecklistFa:
      'خط قرمز مطلق ۵٪! تجاوز از ۵٪ در جدول VVT موتور EF7 فاصله خلاصی 1.2mm در TDC را از بین برده و منجر به برخورد فیزیکی سوپاپ با پیستون می‌شود.',
    defaultDamosMeta: {
      factor: 0.375,
      offset: 0,
      dataOrg: '8bit',
      signed: false,
      unit: 'deg',
      axisXLabel: 'Air Mass (mg/stroke)',
      axisYLabel: 'Engine Speed (RPM)',
    },
  },
  {
    code: 'FULL_LOAD_ENRICH',
    aliases: [/\bFull\s+Load\s+Enrichment\b/i, /غنی[‌\s]?سازی\s+بار\s+کامل/i, /غنی[‌\s]?سازی\s+شتاب/i],
    nameFa: 'زوج‌جداول غنی‌سازی سوخت در بار کامل (Full Load Enrichment)',
    category: 'fuel',
    categoryLabelFa: 'سوخت و AFR',
    defaultDimensions: '6x16',
    isScalar: false,
    defaultRpmRange: { min: 3000, max: 6500 },
    defaultLoadRange: { min: 75, max: 100 },
    defaultUnit: 'raw',
    defaultDeltaLabel: '+5% (بنزین)',
    safetyChecklistFa:
      'در شبکه EF7 CVR جدول اول (اعداد بزرگ‌تر) مربوط به گاز CNG بوده و تغییر آن اکیداً ممنوع است (خطر انفجار منیفولد)؛ تغییر +۵٪ فقط روی جدول بنزین اعمال شود.',
    defaultDamosMeta: {
      factor: 1,
      offset: 0,
      dataOrg: '8bit',
      signed: false,
      unit: 'raw',
      axisXLabel: 'MAP (600-1100 hPa)',
      axisYLabel: 'RPM (600-6500)',
    },
  },
  {
    code: 'FUEL_MASS_CORR',
    aliases: [
      /\bCorrection\s+Factor\s+for\s+Fuel\s+Mass\b/i,
      /\bInjection\s+Multiplier\b/i,
      /ضریب\s+تصحیح\s+جرم\s+سوخت/i,
      /ضریب\s+پاشش/i,
    ],
    nameFa: 'جدول ضریب تصحیح جرم سوخت (Fuel Mass Correction / Multiplier)',
    category: 'fuel',
    categoryLabelFa: 'سوخت و AFR',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 2000, max: 6000 },
    defaultLoadRange: { min: 50, max: 100 },
    defaultUnit: 'factor',
    defaultDeltaLabel: '+5%',
    safetyChecklistFa:
      'در TU5 معمولاً کم‌بار/میانی +۵٪ و بار کامل بالای ۴۰۰۰ دور برای اصلاح AFR از 11.5 به 12.5..13 به میزان -۵٪ تنظیم می‌شود؛ پایش وایدبند الزامی است.',
    defaultDamosMeta: { factor: 0.007813, offset: 0, dataOrg: '8bit', signed: false, unit: 'factor' },
  },
  {
    code: 'LAMBDA_5PARAM',
    aliases: [
      /\b58982\b/,
      /\bMinimal\s+Lambda\b/i,
      /بلوک\s+۵\s*گانه\s+لامبدا/i,
      /۵\s+متغیر\s+(?:کنترل\s+)?(?:سنسور\s+اکسیژن|لامبدا)/i,
      /۵\s+تک[‌\s]?پارامتر\s+لامبدا/i,
    ],
    nameFa: 'بلوک ۵ پارامتر محدودکننده حلقه بسته لامبدا (58982..55706)',
    category: 'fuel',
    categoryLabelFa: 'سوخت و AFR',
    defaultDimensions: '1x1 (5x Scalar)',
    isScalar: true,
    defaultRpmRange: { min: 1500, max: 5000 },
    defaultLoadRange: { min: 20, max: 80 },
    defaultUnit: '%',
    defaultDeltaLabel: 'Factor 0.001526',
    safetyChecklistFa:
      'حتماً در حالت 16-bit Decimal و گزینه Signed برای Low Limit (63570) بررسی شود تا بازه منفی (-25% تا -3%) به‌درستی تفسیر شود.',
    defaultDamosMeta: { factor: 0.001526, offset: 0, dataOrg: '16bit', signed: true, unit: '%' },
  },
  {
    code: 'OVERRUN',
    aliases: [/\bOverrun\b/i, /قطع\s+سوخت\s+در\s+شتاب\s+منفی/i, /\bFuel\s+Resume\s+RPM\b/i],
    nameFa: 'جدول قطع و وصل سوخت در شتاب منفی (Overrun Fuel Cut-Off)',
    category: 'fuel',
    categoryLabelFa: 'سوخت و AFR',
    defaultDimensions: '6x6',
    isScalar: false,
    defaultRpmRange: { min: 1300, max: 2500 },
    defaultLoadRange: { min: 10, max: 35 },
    defaultUnit: 'RPM',
    defaultDeltaLabel: '+150 RPM',
    safetyChecklistFa:
      'در حالت گاز (CNG) قطع سوخت زیر 2000 RPM اکیداً ممنوع است (خطر انفجار برگشتی و خرد شدن منیفولد هوا)!',
    defaultDamosMeta: { factor: 32, offset: 0, dataOrg: '8bit', signed: false, unit: 'RPM' },
  },
  {
    code: 'COIL_DWELL',
    aliases: [/\bCoil\s+Dwell(?:\s+Time)?\b/i, /\bCoil\s+Charge\s+Time\b/i, /ولتاژ\s+کوئل/i, /شارژ\s+کوئل/i],
    nameFa: 'نقشه زمان شارژ و ولتاژ کوئل (Coil Dwell Time)',
    category: 'ignition',
    categoryLabelFa: 'جرقه‌زنی و آوانس',
    defaultDimensions: '6x6',
    isScalar: false,
    defaultRpmRange: { min: 1000, max: 6000 },
    defaultLoadRange: { min: 20, max: 100 },
    defaultUnit: 'ms',
    defaultDeltaLabel: '+8% (سقف 15%)',
    safetyChecklistFa:
      'افزایش بیش از ۱۵٪ زمان شارژ کوئل باعث داغ شدن بیش‌ازحد و سوختن ترانزیستورهای درایور کوئل یا خود کوئل (به‌ویژه در EF7) می‌شود.',
    defaultDamosMeta: { factor: 0.00004, offset: 0, dataOrg: '16bit', signed: false, unit: 'ms' },
  },
  {
    code: 'CPS_CANISTER',
    aliases: [/\bCanister\s+Purge\b/i, /\bCPS\b(?=\s|[)/،])/, /شیر\s+برقی\s+کنیستر/i, /جدول\s+کنیستر/i],
    nameFa: 'نقشه کنترل شیر برقی کنیستر (Canister Purge / CPS)',
    category: 'emission',
    categoryLabelFa: 'آلایندگی و کنیستر',
    defaultDimensions: '16x12',
    isScalar: false,
    defaultRpmRange: { min: 1500, max: 3500 },
    defaultLoadRange: { min: 20, max: 60 },
    defaultUnit: '%',
    defaultDeltaLabel: '+5% رانندگی عادی',
    safetyChecklistFa:
      'تغییر جدول کنیستر صرفاً در ناحیه رانندگی روزمره (حداکثر +۵٪ در EF7) مجاز است و نواحی غیرکاری نباید دستکاری شوند.',
    defaultDamosMeta: { factor: 0.003051, offset: 0, dataOrg: '16bit', signed: false, unit: '%' },
  },
  {
    code: 'EGT_MODEL',
    aliases: [/\bEGT\b/i, /مدل\s+حرارتی\s+اگزوز/i, /دمای\s+اگزوز/i],
    nameFa: 'جدول مدل حرارتی دمای گازهای اگزوز (EGT Thermal Model)',
    category: 'emission',
    categoryLabelFa: 'مدیریت حرارتی و EGT',
    defaultDimensions: '9x20',
    isScalar: false,
    defaultRpmRange: { min: 3000, max: 6500 },
    defaultLoadRange: { min: 70, max: 100 },
    defaultUnit: '°C',
    defaultDeltaLabel: 'پایش حرارتی',
    safetyChecklistFa:
      'از دستکاری کورکورانه مدل حفاظتی EGT خودداری کنید؛ در موتورهای دوگانه‌سوز، جداول EGT بنزین و گاز مجزا هستند.',
    defaultDamosMeta: { factor: 0.000625, offset: -273.15, dataOrg: '16bit', signed: false, unit: 'degC' },
  },
  {
    code: 'INJ_DEAD_TIME',
    aliases: [/\bInjection\s+Dead\s+Time\b/i, /\bDead\s+Time\b/i, /زمان\s+مرده\s+انژکتور/i],
    nameFa: 'منحنی زمان مرده انژکتور بر اساس ولتاژ باتری (Injection Dead Time)',
    category: 'injection',
    categoryLabelFa: 'انژکتور و پاشش',
    defaultDimensions: '7x1',
    isScalar: false,
    defaultRpmRange: { min: 800, max: 3000 },
    defaultLoadRange: { min: 10, max: 60 },
    defaultUnit: 'ms',
    defaultDeltaLabel: '0.58 ms',
    safetyChecklistFa:
      'تنها هنگام تعویض سوزن انژکتور یا اصلاح دقیق دور آرام تغییر داده شود؛ در زیمنس دوگانه‌سوز جداول Dead Time بنزین و گاز جداگانه است.',
    defaultDamosMeta: { factor: 0.390625, offset: 0, dataOrg: '8bit', signed: false, unit: 'ms' },
  },
  {
    code: 'INJ_CAPACITY',
    aliases: [/\bInjector\s+Capacity\b/i, /ظرفیت\s+انژکتور/i, /\b10558\b/],
    nameFa: 'پارامتر ثابت ظرفیت پاشش انژکتور (Injector Capacity)',
    category: 'injection',
    categoryLabelFa: 'انژکتور و پاشش',
    defaultDimensions: '1x1 (Scalar)',
    isScalar: true,
    defaultRpmRange: { min: 1000, max: 6000 },
    defaultLoadRange: { min: 20, max: 100 },
    defaultUnit: 'cc/min',
    defaultDeltaLabel: 'تطبیق دبی سوزن',
    safetyChecklistFa:
      'پس از نصب انژکتور با دبی بالاتر، این تک‌پارامتر (مثلاً آدرس 0x10558 در XU7 CGE) را متناسب با دبی واقعی کالیبره کنید.',
    defaultDamosMeta: { factor: 1, offset: 0, dataOrg: '16bit', signed: false, unit: 'cc/min' },
  },
  {
    code: 'ENGINE_VOLUME',
    aliases: [/\bEngine\s+Volume\b/i, /حجم\s+موتور/i, /\b1073A\b/i],
    nameFa: 'پارامتر ثابت حجم موتور (Engine Displacement Volume)',
    category: 'torque',
    categoryLabelFa: 'جریان هوا و تنفس',
    defaultDimensions: '1x1 (Scalar)',
    isScalar: true,
    defaultRpmRange: { min: 1000, max: 6000 },
    defaultLoadRange: { min: 20, max: 100 },
    defaultUnit: 'L',
    defaultDeltaLabel: '1.800 L',
    safetyChecklistFa:
      'تنها در صورت تغییر حجم واقعی موتور (استروکر یا تعویض بلوک سیلندر) تغییر داده شود (مثلاً آدرس 0x1073A در XU7 عدد خام 18 = 1.800L).',
    defaultDamosMeta: { factor: 0.1, offset: 0, dataOrg: '8bit', signed: false, unit: 'L' },
  },
  {
    code: 'TORQUE_OPT',
    aliases: [/\bReverse\s+Torque\b/i, /\bTorque\s+[12]\b/i, /گشتاور\s+معکوس/i, /گشتاور\s+۱\s+و\s+۲/i],
    nameFa: 'جداول مدیریت گشتاور و گشتاور معکوس (Torque 1/2 & Reverse Torque)',
    category: 'torque',
    categoryLabelFa: 'مدیریت گشتاور',
    defaultDimensions: '12x16',
    isScalar: false,
    defaultRpmRange: { min: 1800, max: 5500 },
    defaultLoadRange: { min: 50, max: 100 },
    defaultUnit: '%',
    defaultDeltaLabel: '+13% .. +18%',
    safetyChecklistFa:
      'در L90 دنده اتوماتیک (گیربکس AL4) و دریچه برقی، دستکاری جداول ممنوعه گشتاور 13x17 باعث خطای گیربکس و محدودیت شتاب می‌شود.',
    defaultDamosMeta: { factor: 0.003052, offset: 0, dataOrg: '16bit', signed: false, unit: '%' },
  },
  {
    code: 'IDLE_RPM',
    aliases: [/\bIdle\s+RPM\b/i, /\bIGN\s+at\s+Idle\b/i, /دور\s+آرام/i],
    nameFa: 'جدول تنظیم دور آرام موتور (Target Idle RPM)',
    category: 'limiter',
    categoryLabelFa: 'دور آرام و فن',
    defaultDimensions: '8x1',
    isScalar: false,
    defaultRpmRange: { min: 800, max: 1500 },
    defaultLoadRange: { min: 5, max: 25 },
    defaultUnit: 'RPM',
    defaultDeltaLabel: '+100 RPM',
    safetyChecklistFa:
      'در زیمنس باید هر ۳ یا ۴ جدول دور آرام به‌صورت یکنواخت اصلاح شوند و حتی برای ۱ واحد تغییر، Checksum اصلاح گردد.',
    defaultDamosMeta: { factor: 10, offset: 0, dataOrg: '8bit', signed: false, unit: 'RPM' },
  },
];

const ECU_MODEL_REGEX =
  /\b(?:Bosch\s+|Siemens\s+)?(?:ME\d+(?:\.\d+){1,3}|MED\d+(?:\.\d+){1,2}|EDC\d+[A-Z0-9._-]*|SIM2K[- ]?\d+|SIM2C|SIM3|SSAT(?:\s+No[- ]?Flash)?|EasyU|LZNF|MAW|S2000|S200|S100|S300|SL96|J34|J35|Valeo\s*J\d+|M7\.4\.4|M7\.9\.7|ME17(?:\.\d+)*|EMS3132|Sirius\s*32|Delphi\s*MT\d+|CBAR|CBiR|CVR|CBR|CBM(?:\s+No[- ]?Flash)?|CGE(?:\s+No[- ]?Flash)?|CGI|CGX|CG4|CR3|CI7|CIU|CBi|CA6|CBY|CCX(?:\s+IR2)?|CIX\d*|PTP|S90)\b/gi;
const HEX_PREFIXED_REGEX = /\b0x[0-9A-Fa-f]{4,8}\b/g;
// Contextual bare hex extractor for messy Iranian WinOLS notes (e.g., "آدرس 1A9EE", "18C1D", "14FDA", "10558", "1073A", "14078")
const BARE_HEX_WITH_LETTERS_REGEX = /\b(?:[0-9A-Fa-f]{4,6})\b/g;
const CONTEXTUAL_NUMERIC_HEX_REGEX =
  /(?:آدرس(?:\s+پایه|\s+نهایی|\s+هگز)?|محور\s*[XY]|ناحیه\s+کاری|خط\s+هگزادسیمال|addr(?:ess)?|offset|base|->|=|\()[\s:`*«]*([1-9A-F][0-9A-Fa-f]{3,5})\b/gi;
const DIM_REGEX = /\b(\d{1,2})\s*[x×*]\s*(\d{1,2})\b/i;

const STANDARD_RPM_AXIS = [1500, 2500, 3500, 4500, 5500, 6500];
const STANDARD_LOAD_AXIS = [20, 40, 60, 80, 100];

const KNOWN_NON_HEX_TOKENS = new Set([
  'C167', 'ST10', 'F273', 'F276', 'CBAR', 'CBIR', 'CCX', 'CIX', 'CGE', 'CGI', 'CBM',
  'S200', 'S100', 'S300', 'SSAT', 'EASY', 'BIOS', 'BOOT', 'DATA', 'CODE', 'CAFE', 'DEAD',
  'FEED', 'FACE', 'BASE', 'ACID', 'ABBA', 'BABA', 'DADA', 'FADE', '1400', '1401', '1402',
  '1403', '1404', '2024', '2025', '2026', '25504', '58982', '16384', '63570', '32767', '55706',
  '65535', '65536', '13540000',
]);

function extractHexAddressesFromSegment(segment: string): string[] {
  const ascii = toAsciiDigits(segment);
  const results = new Set<string>();

  // 1. Explicit 0x... hex addresses (always reliable)
  for (const m of ascii.matchAll(HEX_PREFIXED_REGEX)) {
    const clean = `0x${m[0].slice(2).toUpperCase()}`;
    results.add(clean);
  }

  // 2. Bare 4-6 char hex containing at least one digit AND one A-F letter (e.g., 1A9EE, 6A9EE, 18C1D, 14FDA, 1073A, 189AB)
  for (const m of ascii.matchAll(BARE_HEX_WITH_LETTERS_REGEX)) {
    const token = m[0].toUpperCase();
    if (KNOWN_NON_HEX_TOKENS.has(token)) continue;
    if (!/[0-9]/.test(token) || !/[A-F]/.test(token)) continue;
    // Skip common automotive/ECU codes like 206, 405, A4, C3, M15, EF7, TU5, XU7, F4R, K4M, V16, C4E, C34, FCE6, FC66, AA00
    if (/^(?:FCE6|FC66|FC26|AA00|FE8|C34|C4E|EF7|TU5|XU7|K4M|M15|B5|A2L|CA6)$/i.test(token)) continue;
    // Must be 4..6 chars and typically start with 0..7 or 1..6 (typical Siemens/Bosch flash addresses)
    if (token.length >= 4 && token.length <= 6 && /^[0-7A-F]/.test(token)) {
      results.add(`0x${token}`);
    }
  }

  // 3. Pure-digit 5-char addresses ONLY when explicitly preceded by address/axis context (e.g., "آدرس 14078", "ظرفیت انژکتور (10558)", "آدرس 19912")
  for (const m of ascii.matchAll(CONTEXTUAL_NUMERIC_HEX_REGEX)) {
    const token = m[1].toUpperCase();
    if (KNOWN_NON_HEX_TOKENS.has(token)) continue;
    // Exclude plain working-area bases unless no other address exists, and exclude obvious RPM/year numbers
    if (/^(?:140[0-9]|20[0-2][0-9]|1[0-9]{3}|[2-7]000|6500|3500|2500|1500|12000)$/.test(token)) continue;
    if (token.length === 5 && /^[1-7][0-9A-F]{4}$/.test(token)) {
      results.add(`0x${token}`);
    }
  }

  return Array.from(results);
}

function extractDamosMetaFromSegment(segment: string): Partial<WinolsDamosExtractedMeta> {
  const ascii = toAsciiDigits(segment);
  const meta: Partial<WinolsDamosExtractedMeta> = {};

  // Factor extraction: "فاکتور 0.375", "Factor = 0.00390625", "ضریب تبدیل 0.001526"
  const factorMatch = ascii.match(
    /(?:فاکتور(?:\s+تبدیل)?|ضریب(?:\s+تبدیل(?:\s+مشترک)?)?|factor)[\s:=`*(]*([0-9]+(?:\.[0-9]+)?)/i
  );
  if (factorMatch) {
    const f = Number(factorMatch[1]);
    if (Number.isFinite(f) && f > 0 && f <= 1000) meta.factor = f;
  }

  // Offset extraction: "آفست -23.6", "Offset = -273.15"
  const offsetMatch = ascii.match(
    /(?:آفست|افست|offset)[\s:=`*(]*([+-]?[0-9]+(?:\.[0-9]+)?)/i
  );
  if (offsetMatch) {
    const o = Number(offsetMatch[1]);
    if (Number.isFinite(o) && Math.abs(o) <= 10000) meta.offset = o;
  }

  // Data Org (8-bit / 16-bit)
  if (/\b16[-\s]?bit\b|۱۶\s*بیتی|16\s*بیتی/i.test(ascii)) {
    meta.dataOrg = '16bit';
  } else if (/\b8[-\s]?bit\b|۸\s*بیتی|8\s*بیتی/i.test(ascii)) {
    meta.dataOrg = '8bit';
  }

  // Signed
  if (/\bSigned\b|\bSign\b|علامت[‌\s]?دار/i.test(ascii)) {
    meta.signed = true;
  }

  // Byte order
  if (/\bHi[-\s]?Lo\b|\b25504\b|Motorola/i.test(ascii)) {
    meta.byteOrder = 'HiLo';
  } else if (/\bLo[-\s]?Hi\b|Intel/i.test(ascii)) {
    meta.byteOrder = 'LoHi';
  }

  // Working area base
  if (/\b0x68000\b|\b68000\b|No[-\s]?Flash/i.test(ascii)) {
    meta.baseAddressHex = '0x68000';
    meta.lineSwappingRequired = false;
  } else if (/\b0x14000\b|\b14000\b|\bCBAR\b|\bCVR\b|\bCBiR\b/i.test(ascii)) {
    meta.baseAddressHex = '0x14000';
  } else if (/\b0x18000\b|\b18000\b/i.test(ascii)) {
    meta.baseAddressHex = '0x18000';
  } else if (/\b0x8000\b|\b8000\b/i.test(ascii)) {
    meta.baseAddressHex = '0x8000';
  }

  // Axis X / Y hex addresses (e.g., "X: 18750", "محور X ... 14FDA", "محور عمودی Y ... 14078")
  const axisXMatch = ascii.match(
    /(?:محور\s+(?:افقی\s+)?X|axis\s*X|X\s*:)[^\n]{0,90}?(?:0x)?([1-7][0-9A-Fa-f]{4})\b/i
  );
  if (axisXMatch) {
    meta.axisXHex = `0x${axisXMatch[1].toUpperCase()}`;
  }
  const axisYMatch = ascii.match(
    /(?:محور\s+(?:عمودی\s+)?Y|axis\s*Y|Y\s*:)[^\n]{0,90}?(?:0x)?([1-7][0-9A-Fa-f]{4})\b/i
  );
  if (axisYMatch) {
    meta.axisYHex = `0x${axisYMatch[1].toUpperCase()}`;
  }

  return meta;
}

function extractRpmRangeFromText(text: string): { min: number; max: number } | null {
  const ascii = toAsciiDigits(text);
  // Pattern: "3000 تا 5500 RPM" or "3000-5500 دور"
  const rangeMatch = ascii.match(
    /\b([1-8]\d{3})\s*(?:تا|[-–—]|to|\.\.)\s*([1-8]\d{3})\s*(?:rpm|دور)?/i
  );
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (a >= 600 && b <= 9000 && a < b) {
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
    /(?:بار|پدال|load|throttle)[^\d]{0,14}(\d{2,3})\s*(?:تا|[-–—]|to|\.\.)\s*(\d{2,3})\s*[%٪]?/i
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

  const uniqueFound = Array.from(new Set(found)).slice(0, 6);

  let deltaLabel = spec.defaultDeltaLabel;
  if (uniqueFound.length > 0) {
    const signed = uniqueFound.find((v) => v.startsWith('+') || v.startsWith('-'));
    if (signed) {
      deltaLabel = signed;
    } else if (spec.category === 'ignition') {
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
 * Deterministically scans all project content units (prose + tables + messy unstructured notes)
 * to detect WinOLS calibration maps across both Iranian Siemens/TNM/S2000/SSAT and Bosch families,
 * extracting hex addresses, DAMOS technical parameters (Factor, Offset, Bit-width, Sign, Axis X/Y),
 * RPM/Load operating windows, 2D WinOLS Cell-Zone Matrices, and a print-ready Summary Table.
 */
export function extractWinolsMapGuides(params: {
  sourceFiles: SourceFileDto[];
  units: ContentUnitDto[];
}): WinolsExtractionReport {
  const fileMap = new Map(params.sourceFiles.map((f) => [f.id, f.fileName]));
  const activeUnits = params.units.filter((u) => u.status !== 'merged');

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
      damosMeta: WinolsDamosExtractedMeta;
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

  let customGenericCounter = 0;

  for (const unit of activeUnits) {
    const fileName = fileMap.get(unit.sourceFileId) || 'سند منبع';
    const segments = unit.rawText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const segment of segments) {
      let matchedAnyCatalog = false;
      let matchedExplicitBosch = false;
      const BOSCH_CODES = new Set([
        'KFZW',
        'KFZW2',
        'LAMFA',
        'KFMIRL',
        'KFMIOP',
        'LDRXN',
        'KFLBTS',
        'NMAX',
      ]);
      const isSiemensContext = /(?:زیمنس|siemens|tnm|ef7|cbar|cbir|تیبا|tiba|پراید|pride|xu7|tu5|l90|ems3132)/i.test(
        segment
      );

      for (const spec of WINOLS_MAP_CATALOG) {
        if (!BOSCH_CODES.has(spec.code) && !isSiemensContext && matchedExplicitBosch) {
          continue;
        }
        const matched = spec.aliases.some((re) => re.test(segment));
        if (!matched) continue;
        matchedAnyCatalog = true;
        if (BOSCH_CODES.has(spec.code)) {
          matchedExplicitBosch = true;
        }

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
            damosMeta: { ...(spec.defaultDamosMeta || {}) },
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

        const segHex = extractHexAddressesFromSegment(segment);
        segHex.forEach((h) => bucket!.hexAddresses.add(h));

        const dimM = toAsciiDigits(segment).match(DIM_REGEX);
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

        const extractedMeta = extractDamosMetaFromSegment(segment);
        if (extractedMeta.factor !== undefined) bucket.damosMeta.factor = extractedMeta.factor;
        if (extractedMeta.offset !== undefined) bucket.damosMeta.offset = extractedMeta.offset;
        if (extractedMeta.dataOrg) bucket.damosMeta.dataOrg = extractedMeta.dataOrg;
        if (extractedMeta.signed) bucket.damosMeta.signed = true;
        if (extractedMeta.byteOrder) bucket.damosMeta.byteOrder = extractedMeta.byteOrder;
        if (extractedMeta.baseAddressHex) bucket.damosMeta.baseAddressHex = extractedMeta.baseAddressHex;
        if (extractedMeta.axisXHex) bucket.damosMeta.axisXHex = extractedMeta.axisXHex;
        if (extractedMeta.axisYHex) bucket.damosMeta.axisYHex = extractedMeta.axisYHex;
        if (extractedMeta.lineSwappingRequired !== undefined) {
          bucket.damosMeta.lineSwappingRequired = extractedMeta.lineSwappingRequired;
        }
      }

      // Messy-Document Generic Fallback: recover custom/unlisted WinOLS maps that specify a Hex address + Dimension or Factor
      if (!matchedAnyCatalog && customGenericCounter < 12) {
        const asciiSeg = toAsciiDigits(segment);
        const explicitHex = asciiSeg.match(HEX_PREFIXED_REGEX) || [];
        const dimM = asciiSeg.match(DIM_REGEX);
        const hasMapCue = /(?:جدول|مپ|نقشه|map|table|فاکتور|factor|winols|damos|داموس)/i.test(asciiSeg);
        const firstHex = explicitHex[0];
        if (firstHex && hasMapCue && (dimM || /factor|فاکتور/i.test(asciiSeg))) {
          const hexClean = `0x${firstHex.slice(2).toUpperCase()}`;
          // Skip if this hex is already owned by a catalog map
          const alreadyOwned = Array.from(mapHits.values()).some((b) => b.hexAddresses.has(hexClean));
          if (!alreadyOwned) {
            customGenericCounter += 1;
            const customCode = `CUSTOM_${hexClean.slice(2)}`;
            if (!mapHits.has(customCode)) {
              const extractedMeta = extractDamosMetaFromSegment(segment);
              const isScalar = !dimM || (dimM[1] === '1' && dimM[2] === '1');
              const customSpec: WinolsMapSpec = {
                code: customCode,
                aliases: [],
                nameFa: `نقشه سفارشی استخراج‌شده (${hexClean})`,
                category: 'torque',
                categoryLabelFa: 'نقشه سفارشی (متن آزاد)',
                defaultDimensions: dimM ? `${dimM[1]}x${dimM[2]}` : '1x1 (Scalar)',
                isScalar,
                defaultRpmRange: { min: 2000, max: 5500 },
                defaultLoadRange: { min: 50, max: 100 },
                defaultUnit: '%',
                defaultDeltaLabel: 'مطابق جزوه',
                safetyChecklistFa:
                  'این نقشه به‌صورت خودکار از متن آزاد/نامرتب استخراج شده است؛ پیش از اعمال روی دامپ واقعی، آدرس هگز و فاکتور آن را در WinOLS 2.24 بررسی کنید.',
                defaultDamosMeta: extractedMeta,
              };
              const ecus = new Set<string>((segment.match(ECU_MODEL_REGEX) || []).map((e) => e.trim()));
              mapHits.set(customCode, {
                spec: customSpec,
                texts: [segment],
                files: new Set([fileName]),
                ecuModels: ecus,
                hexAddresses: new Set(explicitHex.map((h) => `0x${h.slice(2).toUpperCase()}`)),
                dimensions: dimM ? `${dimM[1]}x${dimM[2]}` : null,
                rpmRange: extractRpmRangeFromText(segment),
                loadRange: extractLoadRangeFromText(segment),
                damosMeta: extractedMeta,
              });
            }
          }
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
          `مقدار فعلی استوک را یادداشت کرده و مقدار جدید (${deltaLabel}) را با رعایت ضریب (Factor=${bucket.damosMeta.factor ?? 1}) استاندارد ایسیو وارد کنید.`,
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
      damosMeta: bucket.damosMeta,
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

// ============================================================================
// PART 3: GOOGLE SEARCH ENRICHMENT COVERAGE & RPM/LOAD VISUAL COORDINATES
// ============================================================================

export type WinolsGoogleMatchReason =
  | 'direct_map_mention'
  | 'chapter_web_enrichment'
  | 'none';

export interface WinolsMapGoogleCoverage {
  mapId: string;
  mapCode: string;
  hasGoogleEnrichment: boolean;
  matchReason: WinolsGoogleMatchReason;
  matchedChapterNumbers: number[];
  matchedChapterTitles: string[];
  webSourcesCount: number;
  webSources: Array<{ title: string; uri: string }>;
  summaryExcerpt: string | null;
  /** Normalized RPM (1000..7000) & Load (0..100%) envelope for the 2D visual chart */
  plotRpmMin: number;
  plotRpmMax: number;
  plotLoadMin: number;
  plotLoadMax: number;
  plotRpmCenter: number;
  plotLoadCenter: number;
}

export interface WinolsGoogleCoverageSummary {
  totalMaps: number;
  enrichedCount: number;
  localOnlyCount: number;
  coveragePercent: number;
  byMapId: Record<string, WinolsMapGoogleCoverage>;
  items: WinolsMapGoogleCoverage[];
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textMentionsMap(text: string, entry: WinolsMapActionEntry): boolean {
  if (!text) return false;
  const codePattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(entry.mapCode)}(?![A-Za-z0-9_])`, 'i');
  if (codePattern.test(text)) return true;
  for (const hex of entry.hexAddresses) {
    if (hex && text.toLowerCase().includes(hex.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computePlotEnvelope(
  entry: WinolsMapActionEntry,
  fallbackIndex: number
): {
  plotRpmMin: number;
  plotRpmMax: number;
  plotLoadMin: number;
  plotLoadMax: number;
  plotRpmCenter: number;
  plotLoadCenter: number;
} {
  // Default category envelopes when a map is scalar or lacks explicit RPM/Load bounds
  const categoryDefaults: Record<
    WinolsMapCategory,
    { rpmMin: number; rpmMax: number; loadMin: number; loadMax: number }
  > = {
    ignition: { rpmMin: 2800, rpmMax: 5600, loadMin: 60, loadMax: 95 },
    fuel: { rpmMin: 3200, rpmMax: 6200, loadMin: 72, loadMax: 100 },
    torque: { rpmMin: 2200, rpmMax: 5400, loadMin: 55, loadMax: 92 },
    boost: { rpmMin: 2400, rpmMax: 5500, loadMin: 65, loadMax: 100 },
    limiter: { rpmMin: 5800, rpmMax: 6900, loadMin: 84, loadMax: 100 },
    pedal: { rpmMin: 1500, rpmMax: 4500, loadMin: 25, loadMax: 75 },
    injection: { rpmMin: 2000, rpmMax: 5200, loadMin: 45, loadMax: 90 },
    emission: { rpmMin: 1400, rpmMax: 3400, loadMin: 15, loadMax: 55 },
  };

  const def = categoryDefaults[entry.category] || {
    rpmMin: 2500,
    rpmMax: 5200,
    loadMin: 50,
    loadMax: 85,
  };

  let rpmMin = entry.targetRpmRange ? entry.targetRpmRange.min : def.rpmMin;
  let rpmMax = entry.targetRpmRange ? entry.targetRpmRange.max : def.rpmMax;
  let loadMin = entry.targetLoadRange ? entry.targetLoadRange.min : def.loadMin;
  let loadMax = entry.targetLoadRange ? entry.targetLoadRange.max : def.loadMax;

  // Special handling for rev limiters (NMAX / VMAX) when a single RPM limit is detected
  if (entry.isScalar && entry.category === 'limiter') {
    const detectedRpm = entry.numericValuesDetected
      .map((v) => Number(toAsciiDigits(v).replace(/[^\d.]/g, '')))
      .find((n) => n >= 4500 && n <= 9000);
    if (detectedRpm) {
      rpmMin = clamp(detectedRpm - 550, 1200, 6600);
      rpmMax = clamp(detectedRpm + 150, 1800, 7000);
    }
    loadMin = 84;
    loadMax = 99;
  }

  rpmMin = clamp(rpmMin, 1000, 6600);
  rpmMax = clamp(Math.max(rpmMax, rpmMin + 500), 1500, 7000);
  loadMin = clamp(loadMin, 5, 88);
  loadMax = clamp(Math.max(loadMax, loadMin + 12), 18, 100);

  // Subtle deterministic micro-offset when multiple maps share identical bounds so pins stay separable
  const jitterRpm = ((fallbackIndex % 3) - 1) * 120;
  const jitterLoad = ((fallbackIndex % 2) === 0 ? -1 : 1) * 2.5;
  const plotRpmCenter = clamp(Math.round((rpmMin + rpmMax) / 2 + jitterRpm), 1150, 6850);
  const plotLoadCenter = clamp(Math.round((loadMin + loadMax) / 2 + jitterLoad), 10, 96);

  return {
    plotRpmMin: rpmMin,
    plotRpmMax: rpmMax,
    plotLoadMin: loadMin,
    plotLoadMax: loadMax,
    plotRpmCenter,
    plotLoadCenter,
  };
}

interface ExtractedEnrichmentRecord {
  chapterNumber: number;
  chapterTitle: string;
  chapterPlainText: string;
  enrichmentTitle: string;
  enrichmentSummary: string;
  sources: Array<{ title: string; uri: string }>;
}

/**
 * Deterministically inspects the final Word book (`ParsedBook`) and optional `outlineNodes`
 * to identify which detected WinOLS maps carry "تکمیل‌شده با جستجوی گوگل" (`web_enrichment`
 * or web-grounded conflict notes) explanations in the exported `.docx`.
 */
export function analyzeWinolsGoogleEnrichment(params: {
  entries: WinolsMapActionEntry[];
  book?: ParsedBook | null;
  outlineNodes?: OutlineNodeDto[];
}): WinolsGoogleCoverageSummary {
  const { entries, book, outlineNodes } = params;
  const enrichmentRecords: ExtractedEnrichmentRecord[] = [];

  if (book && Array.isArray(book.chapters)) {
    for (const ch of book.chapters) {
      if (ch.id === 'ch_winols_quick_guide') continue;

      const allBlocks = [
        ...(ch.introBlocks || []),
        ...(ch.sections || []).flatMap((sec) => sec.blocks || []),
      ];

      const chapterTextParts: string[] = [ch.title];
      for (const sec of ch.sections || []) {
        chapterTextParts.push(sec.title);
      }

      for (const b of allBlocks) {
        if (b.type === 'paragraph') chapterTextParts.push(b.text);
        else if (b.type === 'subheading') chapterTextParts.push(b.text);
        else if (b.type === 'callout') chapterTextParts.push(b.title, ...(b.paragraphs || []));
        else if (b.type === 'list') chapterTextParts.push(...(b.items || []));
        else if (b.type === 'table') {
          if (b.caption) chapterTextParts.push(b.caption);
          chapterTextParts.push(...(b.headers || []));
          for (const row of b.rows || []) chapterTextParts.push(...row);
        }
      }
      const chapterPlainText = chapterTextParts.join('\n');

      for (const b of allBlocks) {
        if (b.type === 'web_enrichment' && b.summary?.trim()) {
          enrichmentRecords.push({
            chapterNumber: ch.chapterNumber,
            chapterTitle: ch.title,
            chapterPlainText,
            enrichmentTitle: b.title || ch.title,
            enrichmentSummary: b.summary,
            sources: (b.sources || []).map((s) => ({ title: s.title, uri: s.uri })),
          });
        } else if (b.type === 'conflict_note' && b.webSummary?.trim()) {
          enrichmentRecords.push({
            chapterNumber: ch.chapterNumber,
            chapterTitle: ch.title,
            chapterPlainText: `${chapterPlainText}\n${b.topic}\n${b.excerptA}\n${b.excerptB}`,
            enrichmentTitle: b.topic || ch.title,
            enrichmentSummary: b.webSummary,
            sources: (b.webSources || []).map((s) => ({ title: s.title, uri: s.uri })),
          });
        }
      }
    }
  }

  // Fallback to outlineNodes.webEnrichmentJson if book snapshot has no records yet
  if (enrichmentRecords.length === 0 && Array.isArray(outlineNodes)) {
    outlineNodes.forEach((node, idx) => {
      const w = node.webEnrichmentJson as
        | { title?: string; summary?: string; sources?: Array<{ title: string; uri: string }> }
        | null
        | undefined;
      if (w && typeof w.summary === 'string' && w.summary.trim()) {
        enrichmentRecords.push({
          chapterNumber: idx + 1,
          chapterTitle: node.title,
          chapterPlainText: `${node.title}\n${node.summary || ''}`,
          enrichmentTitle: w.title || node.title,
          enrichmentSummary: w.summary,
          sources: Array.isArray(w.sources) ? w.sources : [],
        });
      }
    });
  }

  // Pre-check which enrichment records explicitly mention specific WinOLS map codes
  const recordExplicitlyNamesAnyMap = enrichmentRecords.map((rec) => {
    const combined = `${rec.enrichmentTitle}\n${rec.enrichmentSummary}`;
    return entries.some((entry) => textMentionsMap(combined, entry));
  });

  const byMapId: Record<string, WinolsMapGoogleCoverage> = {};
  const items: WinolsMapGoogleCoverage[] = [];

  entries.forEach((entry, idx) => {
    const env = computePlotEnvelope(entry, idx);
    const directMatches: ExtractedEnrichmentRecord[] = [];
    const chapterMatches: ExtractedEnrichmentRecord[] = [];

    enrichmentRecords.forEach((rec, rIdx) => {
      const combinedEnrichment = `${rec.enrichmentTitle}\n${rec.enrichmentSummary}`;
      if (textMentionsMap(combinedEnrichment, entry)) {
        directMatches.push(rec);
      } else if (
        !recordExplicitlyNamesAnyMap[rIdx] &&
        textMentionsMap(rec.chapterPlainText, entry)
      ) {
        chapterMatches.push(rec);
      }
    });

    const chosen = directMatches.length > 0 ? directMatches : chapterMatches;
    const matchReason: WinolsGoogleMatchReason =
      directMatches.length > 0
        ? 'direct_map_mention'
        : chapterMatches.length > 0
          ? 'chapter_web_enrichment'
          : 'none';

    const uniqueSourcesMap = new Map<string, { title: string; uri: string }>();
    for (const rec of chosen) {
      for (const s of rec.sources) {
        if (s?.uri && !uniqueSourcesMap.has(s.uri)) {
          uniqueSourcesMap.set(s.uri, { title: s.title || s.uri, uri: s.uri });
        }
      }
    }
    const webSources = Array.from(uniqueSourcesMap.values());
    const matchedChapterNumbers = Array.from(new Set(chosen.map((r) => r.chapterNumber))).sort(
      (a, b) => a - b
    );
    const matchedChapterTitles = Array.from(new Set(chosen.map((r) => r.chapterTitle)));
    const firstSummary = chosen[0]?.enrichmentSummary?.trim() || null;
    const summaryExcerpt = firstSummary
      ? firstSummary.length > 220
        ? `${firstSummary.slice(0, 217).trim()}...`
        : firstSummary
      : null;

    const item: WinolsMapGoogleCoverage = {
      mapId: entry.id,
      mapCode: entry.mapCode,
      hasGoogleEnrichment: chosen.length > 0,
      matchReason,
      matchedChapterNumbers,
      matchedChapterTitles,
      webSourcesCount: webSources.length,
      webSources,
      summaryExcerpt,
      ...env,
    };

    byMapId[entry.id] = item;
    items.push(item);
  });

  const totalMaps = items.length;
  const enrichedCount = items.filter((i) => i.hasGoogleEnrichment).length;
  const localOnlyCount = totalMaps - enrichedCount;
  const coveragePercent = totalMaps > 0 ? Math.round((enrichedCount / totalMaps) * 100) : 0;

  return {
    totalMaps,
    enrichedCount,
    localOnlyCount,
    coveragePercent,
    byMapId,
    items,
  };
}

