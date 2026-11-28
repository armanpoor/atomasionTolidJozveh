import type { CalibrationEvidenceTier, StrictCalibrationMapSpec } from './ecuBinaryAnalyzer.ts';

export type AutomotiveDomainId =
  | 'engine_mechanics'
  | 'electrical_networks'
  | 'diagnostics_obd'
  | 'ecu_cybersecurity'
  | 'transmission_drivetrain'
  | 'chassis_brakes'
  | 'body_hvac'
  | 'hybrid_ev'
  | 'test_tools_dyno'
  | 'remap_tuning';

export interface AutomotiveDomainDefinition {
  id: AutomotiveDomainId;
  defaultVolumeNumber: number;
  titleFa: string;
  shortLabelFa: string;
  pedagogicalOrder: number;
  keywords: RegExp[];
}

export const STRICT_NULL_DISPLAY_FA = 'نامشخص / نیازمند بررسی روی فایل خودرو';

export const AUTOMOTIVE_DOMAIN_TAXONOMY: readonly AutomotiveDomainDefinition[] = [
  {
    id: 'engine_mechanics',
    defaultVolumeNumber: 1,
    titleFa: 'جلد ۱: مکانیک و ساختار موتور، سوخت‌رسانی (PFI/GDI) و احتراق',
    shortLabelFa: 'مکانیک موتور و احتراق',
    pedagogicalOrder: 1,
    keywords: [
      /\b(pfi|gdi|t-?gdi|mpi|crdi|common\s*rail|camshaft|crankshaft|piston|compression\s*ratio|valvetrain|vvt|vanos|vtec|combustion|stoichiometric|injector)\b/i,
      /(مکانیک\s*موتور|احتراق|سوخت‌رسانی|پاشش\s*مستقیم|سرسیلندر|میل‌لنگ|پیستون|سوپاپ|نسبت\s*تراکم|فشار\s*ریل|انژکتور|ناک|کوبش)/i,
    ],
  },
  {
    id: 'electrical_networks',
    defaultVolumeNumber: 2,
    titleFa: 'جلد ۲: برق، سنسورها، الکترونیک خودرو و شبکه‌های مالتی‌پلکس (CAN / CAN-FD / LIN / DoIP)',
    shortLabelFa: 'برق و شبکه‌های مالتی‌پلکس',
    pedagogicalOrder: 2,
    keywords: [
      /\b(can-?bus|can-?fd|lin-?bus|flexray|doip|automotive\s*ethernet|pinout|wiring\s*diagram|ckp|cmp|maf|map\s*sensor|tps|o2\s*sensor|wideband|hall\s*effect|alternator|bcm|bsi)\b/i,
      /(برق\s*خودرو|شبکه\s*مالتی‌پلکس|کن\s*باس|سیم‌کشی|پیناوت|سنسور\s*اکسیژن|سنسور\s*دور\s*موتور|سنسور\s*مپ|سنسور\s*ماف|دینام|استارت|کویل|رله\s*دوبل)/i,
    ],
  },
  {
    id: 'diagnostics_obd',
    defaultVolumeNumber: 3,
    titleFa: 'جلد ۳: عیب‌یابی و دیاگ کلاسیک و مدرن (OBD2 / DTC / PIDs / OBDonUDS / ZEVonUDS)',
    shortLabelFa: 'دیاگ و عیب‌یابی مدرن',
    pedagogicalOrder: 3,
    keywords: [
      /\b(obd-?ii|obd2|obdonuds|zevonuds|j1979-?2|uds|iso\s*14229|dtc|pids?|freeze\s*frame|mode\s*(?:0?[1-9]|10)|bidirectional|tsb|[pbcu][0-3][0-9a-f]{3}|p0[0-9a-f]{3}|u0[0-9a-f]{3})\b/i,
      /(دیاگ|عیب‌یابی|کد\s*خطا|داده‌های\s*زنده|فریز\s*فریم|تست\s*عملگر|بولتن\s*فنی|چراغ\s*چک)/i,
    ],
  },
  {
    id: 'ecu_cybersecurity',
    defaultVolumeNumber: 4,
    titleFa: 'جلد ۴: امنیت سایبری خودرو و قفل‌های ECU (SGW / SFD / SFD2 / Bench & Boot)',
    shortLabelFa: 'امنیت سایبری و قفل ECU',
    pedagogicalOrder: 4,
    keywords: [
      /\b(sgw|security\s*gateway|sfd2?|seed-?key|bench\s*mode|boot\s*mode|tricore|jtag|bdm|gpt|obd\s*lock|cybersecurity)\b/i,
      /(امنیت\s*سایبری|قفل\s*ایسیو|دروازه\s*امنیتی|بنچ\s*مود|بوت\s*مود|پروگرامر)/i,
    ],
  },
  {
    id: 'transmission_drivetrain',
    defaultVolumeNumber: 5,
    titleFa: 'جلد ۵: گیربکس دستی و اتوماتیک و سیستم انتقال قدرت',
    shortLabelFa: 'گیربکس و انتقال قدرت',
    pedagogicalOrder: 5,
    keywords: [
      /\b(tcu|tcm|automatic\s*transmission|manual\s*transmission|dct|dsg|cvt|torque\s*converter|valve\s*body|mechatronic|clutch|differential|al4|zf\s*8hp)\b/i,
      /(گیربکس|جعبه‌دنده|تورک\s*کانورتر|ساعت\s*گیربکس|مکاترونیک|کلاچ|دیفرانسیل)/i,
    ],
  },
  {
    id: 'chassis_brakes',
    defaultVolumeNumber: 6,
    titleFa: 'جلد ۶: سیستم تعلیق، فرمان و ترمز (ABS / ESP / EPS)',
    shortLabelFa: 'تعلیق، فرمان و ترمز',
    pedagogicalOrder: 6,
    keywords: [
      /\b(abs|esp|esc|ebd|eps|brake\s*caliper|suspension|steering\s*rack|wheel\s*alignment|tpms)\b/i,
      /(تعلیق|جلوبندی|فرمان\s*برقی|ترمز|لنت|کمک‌فنر|کمبر|کاستر)/i,
    ],
  },
  {
    id: 'body_hvac',
    defaultVolumeNumber: 7,
    titleFa: 'جلد ۷: تهویه مطبوع (HVAC)، بدنه و سیستم‌های ایمنی و رفاهی',
    shortLabelFa: 'تهویه مطبوع و بدنه',
    pedagogicalOrder: 7,
    keywords: [
      /\b(hvac|a\/c\s*compressor|refrigerant|r134a|r1234yf|airbag|srs|adas|central\s*locking)\b/i,
      /(کولر\s*خودرو|تهویه\s*مطبوع|کمپرسور\s*کولر|ایربگ|کیسه\s*هوا|بدنه\s*خودرو|قفل\s*مرکزی)/i,
    ],
  },
  {
    id: 'hybrid_ev',
    defaultVolumeNumber: 8,
    titleFa: 'جلد ۸: خودروهای هیبریدی و برقی (EV / BMS / Inverter)',
    shortLabelFa: 'هیبریدی و برقی (EV)',
    pedagogicalOrder: 8,
    keywords: [
      /\b(hev|phev|bev|bms|high\s*voltage|inverter|dc-?dc|regenerative\s*braking|traction\s*motor|obc|ccs2|soh|soc)\b/i,
      /(خودرو(?:ی|های)?\s*برقی|خودرو(?:ی|های)?\s*هیبریدی|باتری\s*ولتاژ\s*بالا|اینورتر|مدیریت\s*باتری|موتور\s*کششی|شارژر\s*خودرو)/i,
    ],
  },
  {
    id: 'test_tools_dyno',
    defaultVolumeNumber: 9,
    titleFa: 'جلد ۹: ابزارهای تست، اسیلوسکوپ و داینومتر (Dyno)',
    shortLabelFa: 'ابزار تست و داینو',
    pedagogicalOrder: 9,
    keywords: [
      /\b(dyno|dynamometer|oscilloscope|multimeter|datalog|data\s*logging|wideband\s*afr|egt\s*probe|smoke\s*tester)\b/i,
      /(داینو|داینومتر|اسیلوسکوپ|مولتی‌متر|دیتالاگ|دیتالاگینگ|تست\s*موتور)/i,
    ],
  },
  {
    id: 'remap_tuning',
    defaultVolumeNumber: 10,
    titleFa: 'جلد ۱۰: ریمپ، تیونینگ و کالیبراسیون فوق‌دقیق ECU (WinOLS / DAMOS / A2L / XDF)',
    shortLabelFa: 'ریمپ و کالیبراسیون ECU',
    pedagogicalOrder: 10,
    keywords: [
      /\b(winols|damos|a2l|xdf|asap2|remap|remapping|chiptuning|checksum|kfzw|kfzwop|lamfa|ldrxn|kfmirl|kfmiop|dwell|0x[0-9a-f]{4,}|hilo|lohi|16\s*x\s*16|me7\.4\.4|med17|edc17|sim2k|ms43)\b/i,
      /(ریمپ|تیونینگ|وینولز|داموس|کالیبراسیون|آدرس\s*هگز|جدول\s*جرقه|جدول\s*سوخت|آوانس\s*جرقه|بوست\s*توربو|کات‌آف|چک‌سام|نقشه\s*ایسیو)/i,
    ],
  },
] as const;

export function getAutomotiveDomainDefinition(domainId: string): AutomotiveDomainDefinition {
  return (
    AUTOMOTIVE_DOMAIN_TAXONOMY.find((d) => d.id === domainId) ??
    AUTOMOTIVE_DOMAIN_TAXONOMY[0]
  );
}

// ============================================================================
// ADAPTIVE AUTOMOTIVE CLASSIFIER + HIGH-PRECISION REMAP MODE DETECTOR
// ============================================================================

const HIGH_PRECISION_REMAP_TRIGGERS: readonly RegExp[] = [
  /\b(winols|damos|asap2|\.a2l|\.xdf|\.ols|\.kp|remap|remapping|chiptuning|kfzw|kfzwop|lamfa|ldrxn|kfmirl|kfmiop|kflbts|kfmres|checksum|hilo|lohi)\b/i,
  /\b0x[0-9a-f]{4,}\b/i,
  /(ریمپ|وینولز|داموس|کالیبراسیون\s*ecu|آدرس\s*هگز|جدول\s*جرقه|جدول\s*سوخت|نقشه\s*جرقه|نقشه\s*بوست|کات‌آف|داینو\s*ریمپ)/i,
];

export interface AutomotiveClassificationResult {
  primaryDomain: AutomotiveDomainId;
  secondaryDomains: AutomotiveDomainId[];
  highPrecisionRemapMode: boolean;
  remapSignalsMatched: string[];
  pedagogicalRank: number; // 1 = foundation -> 5 = advanced calibration
}

const COMPILED_DOMAIN_KEYWORDS = AUTOMOTIVE_DOMAIN_TAXONOMY.map((domain) => ({
  id: domain.id,
  regexes: domain.keywords.map((kw) => new RegExp(kw.source, 'gi')),
}));

export function classifyAutomotiveContent(text: string, fileName = ''): AutomotiveClassificationResult {
  const combined = `${fileName}\n${text}`;
  const scores = new Map<AutomotiveDomainId, number>();

  for (const domain of COMPILED_DOMAIN_KEYWORDS) {
    let score = 0;
    for (const rx of domain.regexes) {
      rx.lastIndex = 0;
      const matches = combined.match(rx);
      if (matches && matches.length > 0) {
        score += Math.min(matches.length, 4) * 2;
      }
    }
    if (score > 0) {
      scores.set(domain.id, score);
    }
  }

  const remapSignalsMatched: string[] = [];
  for (const trig of HIGH_PRECISION_REMAP_TRIGGERS) {
    const m = combined.match(trig);
    if (m) remapSignalsMatched.push(m[0]);
  }
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (['bin', 'ori', 'mod', 'ols', 'kp', 'dam', 'damos', 'a2l', 'xdf', 'hex', 'mpc', 'fls', 'epr'].includes(ext)) {
    remapSignalsMatched.push(`.${ext}`);
  }

  const highPrecisionRemapMode = remapSignalsMatched.length > 0;

  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  let primaryDomain: AutomotiveDomainId = sorted[0]?.[0] ?? 'engine_mechanics';
  if (highPrecisionRemapMode && (!sorted[0] || (scores.get('remap_tuning') ?? 0) >= sorted[0][1] * 0.7)) {
    primaryDomain = 'remap_tuning';
  }
  const secondaryDomains = sorted
    .map(([id]) => id)
    .filter((id) => id !== primaryDomain)
    .slice(0, 3);

  // Estimate pedagogical rank (1=basics/intro -> 5=advanced remap/cybersecurity)
  let pedagogicalRank = 2;
  if (/(مقدمه|مبانی|آشنایی|مفاهیم\s*پایه|پیش‌نیاز|اصول\s*اولیه|basics|introduction)/i.test(combined)) {
    pedagogicalRank = 1;
  } else if (highPrecisionRemapMode || primaryDomain === 'ecu_cybersecurity') {
    pedagogicalRank = 5;
  } else if (/(عیب‌یابی\s*پیشرفته|اسیلوسکوپ|داینو|آنالیز|تست\s*عملگر|advanced|calibration)/i.test(combined)) {
    pedagogicalRank = 4;
  } else if (/(عیب‌یابی|دیاگ|کد\s*خطا|تست|سنسور|شبکه)/i.test(combined)) {
    pedagogicalRank = 3;
  }

  return {
    primaryDomain,
    secondaryDomains,
    highPrecisionRemapMode,
    remapSignalsMatched,
    pedagogicalRank,
  };
}

// ============================================================================
// STRICT NULL POLICY & NO INVENTED MAP NAMES NORMALIZER
// ============================================================================

export function normalizeRemapMapRecord(
  input: Partial<StrictCalibrationMapSpec> & { hexAddress: string; evidenceTier?: CalibrationEvidenceTier }
): StrictCalibrationMapSpec {
  const cleanHex = `0x${input.hexAddress.trim().replace(/^0x/i, '').toUpperCase()}`;
  const rawName = (input.mapName ?? '').trim();
  const isGenericOrEmpty =
    !rawName || /^(?:unknown|unnamed|map|table|بدون\s*نام|نامشخص|-)$/i.test(rawName);
  const mapName = isGenericOrEmpty ? `UNKNOWN_MAP_${cleanHex}` : rawName;

  const cleanOptionalText = (val?: string | null): string | null => {
    if (val === undefined || val === null) return null;
    const trimmed = val.trim();
    if (!trimmed || /^(?:null|n\/a|unknown|نامشخص|تخمینی|حدودی|-)$/i.test(trimmed)) {
      return null;
    }
    return trimmed;
  };

  return {
    mapName,
    hexAddress: cleanHex,
    dimensions:
      input.dimensions ??
      (input.cols && input.rows ? `${input.cols}x${input.rows}` : null),
    rows: input.rows ?? null,
    cols: input.cols ?? null,
    bitWidth: input.bitWidth ?? null,
    byteOrder: input.byteOrder ?? null,
    signed: input.signed ?? null,
    factor: typeof input.factor === 'number' && Number.isFinite(input.factor) ? input.factor : null,
    offset: typeof input.offset === 'number' && Number.isFinite(input.offset) ? input.offset : null,
    unit: cleanOptionalText(input.unit),
    xAxisLabel: cleanOptionalText(input.xAxisLabel),
    yAxisLabel: cleanOptionalText(input.yAxisLabel),
    stockValue: cleanOptionalText(input.stockValue),
    safeChangeRange: cleanOptionalText(input.safeChangeRange),
    evidenceTier: input.evidenceTier ?? 'text_or_screenshot_reported',
    humanReviewRequired: true,
    flashReady: false,
    notesFa: cleanOptionalText(input.notesFa),
  };
}

export function formatStrictNullableField(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    return STRICT_NULL_DISPLAY_FA;
  }
  return String(value);
}

// ============================================================================
// PHYSICAL UNIT NORMALIZER (Bar↔PSI, Nm↔lb-ft, Lambda↔AFR, HP↔kW, °C↔°F)
// ============================================================================

export type CanonicalPhysicalQuantity =
  | 'pressure_bar'
  | 'torque_nm'
  | 'mixture_lambda'
  | 'power_kw'
  | 'temperature_c'
  | 'voltage_v'
  | 'ignition_deg';

export interface NormalizedPhysicalMeasurement {
  quantity: CanonicalPhysicalQuantity;
  canonicalValue: number;
  canonicalUnit: string;
  rawText: string;
}

const PERSIAN_DIGITS_TO_ASCII: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٫': '.',
};

function normalizeNumberString(raw: string): number {
  const ascii = raw.replace(/[۰-۹٫]/g, (c) => PERSIAN_DIGITS_TO_ASCII[c] ?? c).replace(/,/g, '');
  return Number(ascii);
}

export function normalizePhysicalMeasurement(
  value: number,
  rawUnit: string
): NormalizedPhysicalMeasurement | null {
  if (!Number.isFinite(value)) return null;
  const u = rawUnit.trim().toLowerCase();

  // Pressure -> Bar
  if (u === 'bar' || u === 'بار') {
    return { quantity: 'pressure_bar', canonicalValue: Number(value.toFixed(4)), canonicalUnit: 'bar', rawText: `${value} ${rawUnit}` };
  }
  if (u === 'psi') {
    return { quantity: 'pressure_bar', canonicalValue: Number((value / 14.5037738).toFixed(4)), canonicalUnit: 'bar', rawText: `${value} ${rawUnit}` };
  }
  if (u === 'kpa') {
    return { quantity: 'pressure_bar', canonicalValue: Number((value / 100).toFixed(4)), canonicalUnit: 'bar', rawText: `${value} ${rawUnit}` };
  }

  // Torque -> Nm
  if (u === 'nm' || u === 'n.m' || u === 'n-m' || u === 'نیوتن‌متر' || u === 'نیوتن متر') {
    return { quantity: 'torque_nm', canonicalValue: Number(value.toFixed(3)), canonicalUnit: 'Nm', rawText: `${value} ${rawUnit}` };
  }
  if (u === 'lb-ft' || u === 'lbft' || u === 'ft-lb' || u === 'ftlb') {
    return { quantity: 'torque_nm', canonicalValue: Number((value * 1.35581795).toFixed(3)), canonicalUnit: 'Nm', rawText: `${value} ${rawUnit}` };
  }

  // Air-Fuel Mixture -> Lambda (gasoline stoich 14.7)
  if (u === 'lambda' || u === 'λ' || u === 'لامبدا') {
    return { quantity: 'mixture_lambda', canonicalValue: Number(value.toFixed(4)), canonicalUnit: 'lambda', rawText: `${value} ${rawUnit}` };
  }
  if (u === 'afr') {
    return { quantity: 'mixture_lambda', canonicalValue: Number((value / 14.7).toFixed(4)), canonicalUnit: 'lambda', rawText: `${value} ${rawUnit}` };
  }

  // Power -> kW
  if (u === 'kw' || u === 'کیلووات') {
    return { quantity: 'power_kw', canonicalValue: Number(value.toFixed(3)), canonicalUnit: 'kW', rawText: `${value} ${rawUnit}` };
  }
  if (u === 'hp' || u === 'bhp' || u === 'whp' || u === 'اسب بخار' || u === 'اسب‌بخار') {
    return { quantity: 'power_kw', canonicalValue: Number((value * 0.745699872).toFixed(3)), canonicalUnit: 'kW', rawText: `${value} ${rawUnit}` };
  }

  // Temperature -> Celsius
  if (u === 'c' || u === '°c' || u === 'درجه سانتی‌گراد' || u === 'سانتی‌گراد') {
    return { quantity: 'temperature_c', canonicalValue: Number(value.toFixed(2)), canonicalUnit: '°C', rawText: `${value} ${rawUnit}` };
  }
  if (u === 'f' || u === '°f' || u === 'فارنهایت') {
    return { quantity: 'temperature_c', canonicalValue: Number((((value - 32) * 5) / 9).toFixed(2)), canonicalUnit: '°C', rawText: `${value} ${rawUnit}` };
  }

  // Voltage -> V
  if (u === 'v' || u === 'volt' || u === 'volts' || u === 'ولت') {
    return { quantity: 'voltage_v', canonicalValue: Number(value.toFixed(3)), canonicalUnit: 'V', rawText: `${value} ${rawUnit}` };
  }

  // Ignition advance -> deg
  if (u === 'deg' || u === '°' || u === 'درجه' || u === 'btdc') {
    return { quantity: 'ignition_deg', canonicalValue: Number(value.toFixed(2)), canonicalUnit: 'deg', rawText: `${value} ${rawUnit}` };
  }

  return null;
}

export function extractPhysicalMeasurements(text: string): NormalizedPhysicalMeasurement[] {
  const results: NormalizedPhysicalMeasurement[] = [];
  const patterns: Array<{ regex: RegExp; unitOverride?: string }> = [
    // Prefix forms: AFR 12.8:1 or Lambda 0.87
    { regex: /\bAFR\s*[:=]?\s*([0-9۰-۹]+(?:[.٫][0-9۰-۹]+)?)(?::1)?/gi, unitOverride: 'afr' },
    { regex: /\b(?:Lambda|λ|لامبدا)\s*[:=]?\s*([0-9۰-۹]+(?:[.٫][0-9۰-۹]+)?)/gi, unitOverride: 'lambda' },
    // Suffix forms: 1.2 bar, 17.4 psi, 240 Nm, 177 lb-ft, 150 HP, 112 kW, 12.6 V, 18 درجه
    {
      regex:
        /([+-]?[0-9۰-۹]+(?:[.٫][0-9۰-۹]+)?)\s*(bar|psi|kpa|nm|n\.m|lb-ft|ft-lb|kw|hp|bhp|whp|°c|°f|volts?|volt|v|deg|btdc|بار|نیوتن‌متر|نیوتن\s+متر|کیلووات|اسب‌بخار|اسب\s+بخار|ولت|درجه)(?![A-Za-z])/gi,
    },
  ];

  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.regex.exec(text)) !== null) {
      const val = normalizeNumberString(m[1]);
      const unit = p.unitOverride ?? m[2];
      const norm = normalizePhysicalMeasurement(val, unit);
      if (norm) {
        results.push(norm);
      }
    }
  }
  return results;
}

/**
 * Checks whether two physical measurements represent the same value within relative tolerance (default 3.5%).
 * Example: 1.0 bar vs 14.5 psi -> true (equivalent, NOT a conflict!).
 * Example: Lambda 0.85 vs AFR 12.5:1 -> true (equivalent!).
 */
export function areMeasurementsEquivalent(
  a: NormalizedPhysicalMeasurement,
  b: NormalizedPhysicalMeasurement,
  relativeTolerance = 0.035
): boolean {
  if (a.quantity !== b.quantity) return false;
  const maxAbs = Math.max(Math.abs(a.canonicalValue), Math.abs(b.canonicalValue), 0.001);
  const diff = Math.abs(a.canonicalValue - b.canonicalValue);
  return diff / maxAbs <= relativeTolerance || diff <= 0.03;
}

// ============================================================================
// 4-STAGE CANONICAL AUTOMOTIVE ENTITY RESOLVER (Funnel: Key Normalizer -> Graph -> Trigram)
// ============================================================================

export interface CanonicalAutomotiveEntitySeed {
  id: string;
  entityType: 'ecu' | 'vehicle' | 'engine' | 'protocol' | 'component';
  canonicalName: string;
  aliases: string[];
  /** Associated engine codes or vehicle models for cross-scope resolution */
  relatedEngineCodes?: string[];
  relatedVehicles?: string[];
  domainTag: AutomotiveDomainId;
}

export interface CanonicalEntityResolutionResult {
  entity: CanonicalAutomotiveEntitySeed;
  matchStage: 'exact_key' | 'alias_graph' | 'trigram_fuzzy';
  matchedAlias: string;
  confidence: number;
}

/**
 * Stage 1 Deterministic Entity Key Normalizer:
 * - Converts Persian/Arabic digits to ASCII, unifies ي/ی and ك/ک, strips Tatweel & ZWNJ.
 * - Uses positive lookahead `/(\d)\s*[.\-_/]\s*(?=\d)/g` so multi-dot codes like `"ME7.4.4"`
 *   compress cleanly to `"me744"` in a single pass without consuming the middle digit.
 * - IMPORTANT: Only run this on entity/alias lookup keys, NEVER on raw prose with measurements.
 */
export function normalizeAutomotiveEntityKey(rawKey: string): string {
  return (rawKey || '')
    .toLowerCase()
    .replace(/[۰-۹٫]/g, (c) => PERSIAN_DIGITS_TO_ASCII[c] ?? c)
    .replace(/[\u0640\u200c\u200e\u200f\u2066-\u2069]/g, '')
    .replace(/[يیى]/g, 'ی')
    .replace(/[كک]/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/(\d)\s*[.\-_/]\s*(?=\d)/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Character 3-gram Dice similarity for fuzzy automotive alias matching (0..1).
 */
export function computeTrigramSimilarity(a: string, b: string): number {
  const normA = normalizeAutomotiveEntityKey(a).replace(/\s+/g, '');
  const normB = normalizeAutomotiveEntityKey(b).replace(/\s+/g, '');
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.length < 3 || normB.length < 3) {
    return normA === normB ? 1 : 0;
  }

  const buildTrigrams = (str: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i <= str.length - 3; i++) {
      set.add(str.slice(i, i + 3));
    }
    return set;
  };

  const triA = buildTrigrams(normA);
  const triB = buildTrigrams(normB);
  let intersection = 0;
  for (const t of triA) {
    if (triB.has(t)) intersection += 1;
  }
  return Number(((2 * intersection) / (triA.size + triB.size)).toFixed(4));
}

export const DEFAULT_CANONICAL_AUTOMOTIVE_ENTITIES: readonly CanonicalAutomotiveEntitySeed[] = [
  {
    id: 'ECU:BOSCH_ME7.4.4',
    entityType: 'ecu',
    canonicalName: 'Bosch ME7.4.4 (TU5 / NFU)',
    aliases: [
      'me7.4.4',
      'me744',
      'bosch me7.4.4',
      'بوش ۷.۴.۴',
      'بوش 7.4.4',
      'بوش هفت چهار چهار',
      '۲۰۶ تیپ ۵',
      '206 تیپ 5',
      'پژو ۲۰۶ تیپ ۵',
      'peugeot 206 type 5',
      'tu5 me7.4.4',
      'tu5jp4',
      'nfu 1.6',
      'موتور tu5',
    ],
    relatedEngineCodes: ['TU5', 'TU5JP4', 'NFU'],
    relatedVehicles: ['Peugeot 206 Type 5', 'Peugeot 207', 'Rana'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:BOSCH_ME7.4.5',
    entityType: 'ecu',
    canonicalName: 'Bosch ME7.4.5 (TU5)',
    aliases: [
      'me7.4.5',
      'me745',
      'bosch me7.4.5',
      'بوش ۷.۴.۵',
      'بوش 7.4.5',
      '۲۰۶ اس دی ۷.۴.۵',
    ],
    relatedEngineCodes: ['TU5', 'TU5JP4', 'NFU'],
    relatedVehicles: ['Peugeot 206 SD', 'Peugeot 206 Type 5'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:BOSCH_ME7.4.9',
    entityType: 'ecu',
    canonicalName: 'Bosch ME7.4.9 (EF7 / TU5)',
    aliases: [
      'me7.4.9',
      'me749',
      'bosch me7.4.9',
      'بوش ۷.۴.۹',
      'بوش 7.4.9',
      'ef7 bosch',
      'سمند ef7 بوش',
      'موتور ملی بوش ۷.۴.۹',
    ],
    relatedEngineCodes: ['EF7', 'TU5'],
    relatedVehicles: ['Samand EF7', 'Dena', 'Soren'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:BOSCH_ME17.9.7',
    entityType: 'ecu',
    canonicalName: 'Bosch ME17.9.7 / ME17.9.71',
    aliases: [
      'me17.9.7',
      'me17.9.71',
      'me1797',
      'me17971',
      'بوش ۱۷.۹.۷',
      'بوش 17.9.7',
      'دنا پلاس توربو',
      'سورن توربو',
      'ef7 tc',
      'ef7 turbo',
    ],
    relatedEngineCodes: ['EF7-TC', 'EF7', 'TU5'],
    relatedVehicles: ['Dena Plus Turbo', 'Soren Turbo', 'Peugeot 207'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:BOSCH_MED17',
    entityType: 'ecu',
    canonicalName: 'Bosch MED17 / MEVD17 (GDI/TGDI)',
    aliases: ['med17', 'med17.5', 'med17.7', 'mevd17', 'med175', 'بوش med17'],
    relatedEngineCodes: ['GDI', 'T-GDI', 'EP6'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:BOSCH_EDC17',
    entityType: 'ecu',
    canonicalName: 'Bosch EDC17 (CRDi Diesel)',
    aliases: ['edc17', 'edc17c46', 'edc17cp14', 'edc17c60', 'بوش edc17'],
    relatedEngineCodes: ['CRDi', 'TDI', 'HDi'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:SIEMENS_SIM2K',
    entityType: 'ecu',
    canonicalName: 'Siemens/Continental SIM2K',
    aliases: [
      'sim2k',
      'sim2k-241',
      'sim2k-34',
      'sim2k-141',
      'sim2k241',
      'sim2k34',
      'sim2k141',
      'زیمنس sim2k',
      'کنتیننتال sim2k',
    ],
    relatedEngineCodes: ['Theta-II', 'Nu', 'Gamma'],
    relatedVehicles: ['Hyundai', 'Kia'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:SIEMENS_EMS3132',
    entityType: 'ecu',
    canonicalName: 'Siemens/Continental EMS3132 / Sirius32 (K4M)',
    aliases: [
      'ems3132',
      'sirius32',
      'ems3125',
      'تندر ۹۰',
      'ال ۹۰',
      'l90',
      'ساندرو',
      'موتور k4m',
      'k4m 1.6',
    ],
    relatedEngineCodes: ['K4M'],
    relatedVehicles: ['Tondar 90 (L90)', 'Renault Sandero', 'Renault Megane'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:SIEMENS_MS43',
    entityType: 'ecu',
    canonicalName: 'Siemens MS43',
    aliases: ['ms43', 'siemens ms43', 'زیمنس ms43', 'bmw m54 ms43'],
    relatedEngineCodes: ['M54'],
    relatedVehicles: ['BMW E46 / E39'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:VALEO_J34',
    entityType: 'ecu',
    canonicalName: 'Valeo J34P / J35 / V42 / S3000 (TU5 / K4M)',
    aliases: [
      'valeo j34',
      'j34',
      'j34p',
      'valeo j35',
      'valeo v42',
      'valeo s3000',
      '9661960880',
      'والئو j34',
      'والیو j34',
      'والئو جی ۳۴',
      'والیو جی ۳۴',
      'والئو',
      'والیو',
    ],
    relatedEngineCodes: ['TU5', 'TU5JP4', 'NFU', 'K4M'],
    relatedVehicles: ['Peugeot 206', 'Peugeot 207', 'Rana', 'Tondar 90'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:SAGEM_S2000',
    entityType: 'ecu',
    canonicalName: 'Sagem S2000 / Valeo PL4 / SL96 (XU7)',
    aliases: [
      'sagem s2000',
      's2000',
      's2000pl4',
      's2000-10',
      's2000-11',
      's2000-3e',
      's2000-3f',
      's2000 valvetronic',
      'sl96',
      'ساژم s2000',
      'ساژم',
      'پژو ۴۰۵ xu7',
      'موتور xu7',
      'xu7jp',
    ],
    relatedEngineCodes: ['XU7', 'XU7JP', 'LFZ'],
    relatedVehicles: ['Peugeot 405', 'Peugeot Pars', 'Samand XU7', 'Pride'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:SIEMENS_CROUSE_CG_CI_CR',
    entityType: 'ecu',
    canonicalName: 'Siemens / Crouse / Continental (5WP4 / CI / CG / CR / CIX / CCX / CBR / No-Flash 9B00 / PGM10 / S48)',
    aliases: [
      'زیمنس',
      'ایسیو زیمنس',
      'زیمنس کروز',
      'کانتیننتال',
      '5wp4.11',
      'ci1',
      'ci2',
      'ci3',
      'ci4',
      'ci5',
      'ci6',
      'ci7',
      'ci8',
      'cio',
      'cip',
      'cir',
      'cid',
      'cge',
      'cee',
      'cbm e4',
      'c4e',
      'ciz',
      'ciu',
      'cgx',
      'cgs',
      'cgd',
      'cr1',
      'cr2',
      'cr3',
      'cix34',
      'cix48',
      'ccx',
      'cbr',
      'cbar',
      'cbir',
      'cvr',
      'ptp',
      'no-flash',
      '9b00',
      'pgm 10',
      's48',
      'زیمنس cg',
      'زیمنس ci',
    ],
    relatedEngineCodes: ['XU7', 'XU7P', 'XUP', 'TU5', 'EF7', 'M15', 'M13', 'Z24'],
    relatedVehicles: ['Peugeot 405', 'Peugeot Pars', 'Samand', 'Dena', 'Tiba', 'Saina', 'Quick', 'Pride', 'Zamyad'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:DELPHI_MT_FAMILY',
    entityType: 'ecu',
    canonicalName: 'Delphi MT20U / MT22.1 / MT34 / MT38 / MT60 / MT80 / MT86 / MT92 (Chinese & Korean Platforms)',
    aliases: [
      'delphi',
      'دلفی',
      'ایسیو دلفی',
      'mt20u',
      'mt20u2',
      'mt22.1',
      'mt22.1.1',
      'mt22u',
      'mt34',
      'mt38',
      'mt60',
      'mt62.1',
      'mt80',
      'mt86',
      'mt92',
      'mt92.1',
      'dcm3.4',
      'dcm6.2',
      'دلفی mt20',
      'دلفی mt22',
      'دلفی mt80',
      'دلفی mt92',
    ],
    relatedEngineCodes: ['ACTECO', 'SQRE4T15', 'SQRF4J16', '4G63', '4G69', 'G6DA', 'GDI', 'TGDI'],
    relatedVehicles: ['MVM', 'Chery', 'Fownix', 'Tiggo 7', 'Tiggo 8', 'Arrizo 5', 'JAC S5', 'KMC', 'Lifan', 'Great Wall', 'Hyundai', 'Kia'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:BOSCH_MP_M7_MG1_S2',
    entityType: 'ecu',
    canonicalName: 'Bosch MP5.0 / MP7.3 / M7.9.7 / ME7.8.8 / MEG17.9.12 / MG1 / Bosch S2 (Iranian, Chinese & Korean)',
    aliases: [
      'mp5.0',
      'mp7.3',
      'm7.9.7',
      'm7.9.7.1',
      'me7.8.8',
      'm7.8',
      'meg17.9.12',
      'meg17.9.13',
      'meg17.9.21',
      'medg17.9.8',
      'mg1cs008',
      'mg1cs018',
      'mg1cs080',
      'md1',
      'bosch s2',
      'بوش s2',
      'بوش اس ۲',
      'بوش mp5',
      'بوش mp7.3',
    ],
    relatedEngineCodes: ['Z24', 'XU7', 'M15', 'Gamma', 'Theta-II', 'TGDI'],
    relatedVehicles: ['Zamyad', 'Peugeot 206', 'Samand', 'Saina', 'Quick', 'Chery', 'JAC', 'Hyundai', 'Kia'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:EZU_EASYU',
    entityType: 'ecu',
    canonicalName: 'Crouse / Continental EZU (EasyU 2.0 / 2.5 / 2.8)',
    aliases: [
      'ezu',
      'easyu',
      'easyu 2.0',
      'easyu 2.5',
      'easyu 2.8',
      'easyu2.5',
      'easyu25',
      'ایسیو ezu',
      'ایزی یو',
    ],
    relatedEngineCodes: ['XU7', 'M15', 'M13'],
    relatedVehicles: ['Samand', 'Peugeot 405', 'Peugeot Pars', 'Tiba', 'Saina', 'Quick'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:GHARB_STEEL_MAW_ACS',
    entityType: 'ecu',
    canonicalName: 'Gharb Steel (غرب استیل) / MAW / ACS (Iranian Domestic & Turbo Platforms)',
    aliases: [
      'غرب استیل',
      'gharb steel',
      'ایسیو غرب استیل',
      'maw',
      'ایسیو ماو',
      'ایسیو maw',
      'acs',
      'ایسیو acs',
      'ای سی اس',
    ],
    relatedEngineCodes: ['XU7', 'XU7P', 'EF7-TC', 'M15-TC', 'Z24'],
    relatedVehicles: ['Samand Bi-Fuel', 'Peugeot 405', 'Dena Plus Turbo', 'Shahin', 'Zamyad'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:MAW_SSAT_KESENS',
    entityType: 'ecu',
    canonicalName: 'Kesens ME7.4.9 / Siemens SSAT / LZNF SPC56',
    aliases: [
      'ssat',
      'kesens',
      'lznf',
      'spc56',
      'ایسیو اس ست',
      'زیمنس ssat',
      'کسنس',
      'کیسنس',
      'کیسنس ۷.۴.۹',
      'موتور m15',
      'کوییک',
      'ساینا',
      'تیبا',
    ],
    relatedEngineCodes: ['M15', 'M13', 'TU5', 'XU7', 'EF7'],
    relatedVehicles: ['Quick', 'Saina', 'Tiba', 'Pride', 'Peugeot Pars', 'Samand'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'ECU:KEFICO_KOREAN',
    entityType: 'ecu',
    canonicalName: 'Hyundai/Kia Kefico (CPEGD2 / CPGDSH2 / MEG17 / SIM2K)',
    aliases: [
      'kefico',
      'کفیکو',
      'ایسیو کفیکو',
      'cpegd2',
      'cpgdsh2',
    ],
    relatedEngineCodes: ['Gamma', 'Nu', 'Theta-II', 'Lambda', 'MPI', 'GDI'],
    relatedVehicles: ['Hyundai Elantra', 'Hyundai Sonata', 'Hyundai Tucson', 'Hyundai SantaFe', 'Kia Cerato', 'Kia Optima', 'Kia Sportage'],
    domainTag: 'remap_tuning',
  },
  {
    id: 'PROTOCOL:CAN_FD',
    entityType: 'protocol',
    canonicalName: 'CAN-FD / ISO 11898-1',
    aliases: ['can-fd', 'can fd', 'کن اف دی', 'iso 11898'],
    domainTag: 'electrical_networks',
  },
  {
    id: 'PROTOCOL:DOIP',
    entityType: 'protocol',
    canonicalName: 'DoIP / Automotive Ethernet (ISO 13400)',
    aliases: ['doip', 'automotive ethernet', 'iso 13400', 'اترنت خودرو'],
    domainTag: 'electrical_networks',
  },
  {
    id: 'PROTOCOL:OBDONUDS_J1979_2',
    entityType: 'protocol',
    canonicalName: 'OBDonUDS / SAE J1979-2',
    aliases: ['obdonuds', 'j1979-2', 'sae j1979-2', 'zevonuds'],
    domainTag: 'diagnostics_obd',
  },
  {
    id: 'SECURITY:SGW_SFD2',
    entityType: 'protocol',
    canonicalName: 'ECU Security Gateway (SGW / SFD / SFD2)',
    aliases: ['sgw', 'security gateway', 'sfd', 'sfd2', 'دروازه امنیتی', 'قفل ایسیو'],
    domainTag: 'ecu_cybersecurity',
  },
  {
    id: 'SYSTEM:EV_BMS',
    entityType: 'component',
    canonicalName: 'EV Battery Management System (BMS)',
    aliases: ['bms', 'battery management system', 'مدیریت باتری', 'باتری ولتاژ بالا'],
    domainTag: 'hybrid_ev',
  },
] as const;

/**
 * Full 4-Stage Canonical Automotive Entity Resolution Funnel:
 * Stage 1: Deterministic key normalization with multi-dot lookahead (`ME7.4.4` -> `me744`).
 * Stage 2: Exact & substring alias graph lookup across Iranian/Global vehicle-engine-ECU equivalences.
 * Stage 3: Character Trigram fuzzy matching (>= 0.72) on candidate technical tokens.
 */
export function resolveCanonicalAutomotiveEntityFunnel(
  text: string
): CanonicalEntityResolutionResult | null {
  if (!text || !text.trim()) return null;
  const lower = text.toLowerCase();
  const normalizedInputKey = normalizeAutomotiveEntityKey(text);

  // Stage 1 & 2: Direct alias or normalized key match
  for (const entity of DEFAULT_CANONICAL_AUTOMOTIVE_ENTITIES) {
    for (const alias of entity.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        return {
          entity,
          matchStage: 'exact_key',
          matchedAlias: alias,
          confidence: 1.0,
        };
      }
      const normAlias = normalizeAutomotiveEntityKey(alias);
      if (normAlias.length >= 3 && normalizedInputKey.includes(normAlias)) {
        return {
          entity,
          matchStage: 'alias_graph',
          matchedAlias: alias,
          confidence: 0.95,
        };
      }
    }
  }

  // Stage 3: Trigram fuzzy matching against short candidate windows
  const words = normalizedInputKey.split(/\s+/).filter((w) => w.length >= 3);
  const windows: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    windows.push(`${words[i]} ${words[i + 1]}`);
  }

  let bestEntity: CanonicalAutomotiveEntitySeed | null = null;
  let bestAlias = '';
  let bestScore = 0;

  for (const win of windows.slice(0, 35)) {
    for (const entity of DEFAULT_CANONICAL_AUTOMOTIVE_ENTITIES) {
      for (const alias of entity.aliases) {
        const sim = computeTrigramSimilarity(win, alias);
        if (sim >= 0.74 && sim > bestScore) {
          bestScore = sim;
          bestEntity = entity;
          bestAlias = alias;
        }
      }
    }
  }

  if (bestEntity) {
    return {
      entity: bestEntity,
      matchStage: 'trigram_fuzzy',
      matchedAlias: bestAlias,
      confidence: bestScore,
    };
  }

  return null;
}

export function resolveCanonicalAutomotiveEntity(
  text: string
): CanonicalAutomotiveEntitySeed | null {
  return resolveCanonicalAutomotiveEntityFunnel(text)?.entity ?? null;
}

