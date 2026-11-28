import type { ContentUnitDto, DiagramBlock, FigureBlock, SourceFileDto, TableBlock } from './bookTypes.ts';
import { extractEcuPlatforms, hasDisjointEcuPlatforms } from './ecuTechnicalIntegrity.ts';
import { toAsciiDigits } from './formatParsers.ts';

// ============================================================================
// DETERMINISTIC STATISTICAL NUMERIC DISCREPANCY ANALYZER FOR ECU REMAPPING
// Compares Data Tables & Embedded Charts/Series across source file versions
// with 0% AI hallucination risk.
// ============================================================================

export type DiscrepancySourceKind = 'table' | 'chart';
export type DiscrepancySeverity = 'critical' | 'warning' | 'info';

export interface VersionNumericValue {
  fileId: string;
  fileName: string;
  unitId: string;
  rawDisplay: string;
  numericValue: number;
  normalizedValue: number;
  unit: string | null;
  normalizedUnit: string | null;
}

export interface NumericDiscrepancyItem {
  id: string;
  sourceKind: DiscrepancySourceKind;
  datasetTitle: string;
  parameterLabel: string;
  columnOrAxisLabel: string;
  ecuPlatforms: string[];
  severity: DiscrepancySeverity;
  severityReason: string;
  safetyGuidance: string;
  unitDisplay: string;
  unitMismatch: boolean;
  versions: VersionNumericValue[];
  stats: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    stdDev: number;
    absDelta: number;
    percentDiff: number;
    cvPercent: number;
  };
}

export interface DatasetSeriesPointComparison {
  label: string;
  valueA: number;
  valueB: number;
  rawA: string;
  rawB: string;
  absDelta: number;
  percentDiff: number;
  unit: string | null;
  severity: DiscrepancySeverity | 'match';
}

export interface DatasetStatisticalComparison {
  id: string;
  sourceKind: DiscrepancySourceKind;
  title: string;
  fileAName: string;
  fileBName: string;
  unitDisplay: string;
  matchedPointsCount: number;
  inconsistentPointsCount: number;
  meanPercentDiff: number;
  maxPercentDiff: number;
  rmse: number;
  pearsonR: number | null;
  points: DatasetSeriesPointComparison[];
}

export interface NumericDiscrepancyReport {
  generatedAt: string;
  comparedFilesCount: number;
  analyzedTablesCount: number;
  analyzedChartsCount: number;
  totalMatchedPoints: number;
  inconsistentCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  maxPercentDiff: number;
  meanPercentDiff: number;
  discrepancies: NumericDiscrepancyItem[];
  datasetComparisons: DatasetStatisticalComparison[];
}

// ============================================================================
// 1. UNIT-AWARE NUMERIC PARSER (Handles Persian/Latin numbers, ratios, ranges,
//    and physical unit conversions such as bar <-> kPa <-> psi)
// ============================================================================

export interface ParsedMeasurement {
  rawDisplay: string;
  numericValue: number;
  normalizedValue: number;
  unit: string | null;
  normalizedUnit: string | null;
  isRange: boolean;
}

const UNIT_CONVERSION_TABLE: Record<string, { canonical: string; factor: number; offset?: number }> = {
  // Pressure -> canonical bar
  bar: { canonical: 'bar', factor: 1 },
  'بار': { canonical: 'bar', factor: 1 },
  kpa: { canonical: 'bar', factor: 0.01 },
  'کیلوپاسکال': { canonical: 'bar', factor: 0.01 },
  mbar: { canonical: 'bar', factor: 0.001 },
  hpa: { canonical: 'bar', factor: 0.001 },
  'میلی‌بار': { canonical: 'bar', factor: 0.001 },
  psi: { canonical: 'bar', factor: 0.0689476 },
  // Engine speed -> RPM
  rpm: { canonical: 'RPM', factor: 1 },
  'دور': { canonical: 'RPM', factor: 1 },
  'دوربردقیقه': { canonical: 'RPM', factor: 1 },
  // Ignition angle -> deg
  '°': { canonical: 'deg', factor: 1 },
  deg: { canonical: 'deg', factor: 1 },
  ca: { canonical: 'deg', factor: 1 },
  btdc: { canonical: 'deg', factor: 1 },
  atdc: { canonical: 'deg', factor: 1 },
  'درجه': { canonical: 'deg', factor: 1 },
  // AFR / Lambda
  afr: { canonical: 'AFR', factor: 1 },
  lambda: { canonical: 'AFR', factor: 14.7 },
  'λ': { canonical: 'AFR', factor: 14.7 },
  'لاندا': { canonical: 'AFR', factor: 14.7 },
  'لامبدا': { canonical: 'AFR', factor: 14.7 },
  // Torque -> Nm
  nm: { canonical: 'Nm', factor: 1 },
  'نیوتن‌متر': { canonical: 'Nm', factor: 1 },
  'نیوتنمتر': { canonical: 'Nm', factor: 1 },
  // Power -> hp
  hp: { canonical: 'hp', factor: 1 },
  'اسب': { canonical: 'hp', factor: 1 },
  'اسب‌بخار': { canonical: 'hp', factor: 1 },
  kw: { canonical: 'hp', factor: 1.34102 },
  'کیلووات': { canonical: 'hp', factor: 1.34102 },
  // Temperature -> °C
  '°c': { canonical: '°C', factor: 1 },
  c: { canonical: '°C', factor: 1 },
  'سانتی‌گراد': { canonical: '°C', factor: 1 },
  'درجه‌سانتی‌گراد': { canonical: '°C', factor: 1 },
  '°f': { canonical: '°C', factor: 5 / 9, offset: -32 },
  f: { canonical: '°C', factor: 5 / 9, offset: -32 },
  'فارنهایت': { canonical: '°C', factor: 5 / 9, offset: -32 },
  'درجه‌فارنهایت': { canonical: '°C', factor: 5 / 9, offset: -32 },
  // Voltage -> V
  v: { canonical: 'V', factor: 1 },
  'ولت': { canonical: 'V', factor: 1 },
  mv: { canonical: 'V', factor: 0.001 },
  'میلی‌ولت': { canonical: 'V', factor: 0.001 },
  // Time -> ms
  ms: { canonical: 'ms', factor: 1 },
  'میلی‌ثانیه': { canonical: 'ms', factor: 1 },
  s: { canonical: 'ms', factor: 1000 },
  sec: { canonical: 'ms', factor: 1000 },
  'ثانیه': { canonical: 'ms', factor: 1000 },
  // Fuel / Air mass
  'mg/str': { canonical: 'mg/str', factor: 1 },
  'mg/stk': { canonical: 'mg/str', factor: 1 },
  'mg/hub': { canonical: 'mg/str', factor: 1 },
  'g/s': { canonical: 'g/s', factor: 1 },
  'kg/h': { canonical: 'g/s', factor: 1 / 3.6 },
  '%': { canonical: '%', factor: 1 },
  'درصد': { canonical: '%', factor: 1 },
};

function normalizeLabelKey(text: string): string {
  return toAsciiDigits(text || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeUnitToken(rawUnit: string | null | undefined): {
  unit: string | null;
  canonical: string | null;
  factor: number;
  offset: number;
} {
  if (!rawUnit) return { unit: null, canonical: null, factor: 1, offset: 0 };
  const cleaned = toAsciiDigits(rawUnit)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200e\u200f]/g, '')
    .trim();
  if (!cleaned) return { unit: null, canonical: null, factor: 1, offset: 0 };

  const compact = cleaned.replace(/\s+/g, '').toLowerCase();
  const entry = UNIT_CONVERSION_TABLE[cleaned.toLowerCase()] || UNIT_CONVERSION_TABLE[compact];
  if (entry) {
    return {
      unit: cleaned,
      canonical: entry.canonical,
      factor: entry.factor,
      offset: entry.offset ?? 0,
    };
  }
  return { unit: cleaned, canonical: compact, factor: 1, offset: 0 };
}

/**
 * Parses a numeric cell or chart value into a normalized measurement.
 * Ignores hex addresses (0x1A4F0), DTC codes (P0135), and matrix sizes (16x16)
 * so non-quantitative identifiers are never treated as statistical magnitudes.
 */
export function parseNumericMeasurement(
  rawText: string,
  fallbackUnit?: string | null
): ParsedMeasurement | null {
  const original = (rawText || '').trim();
  if (!original) return null;

  const ascii = toAsciiDigits(original)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    // Strip thousands grouping commas (e.g. 1,250 or 12,500) first
    .replace(/(?<=\d)[٬,](?=\d{3}(?:\D|$))/g, '')
    // Convert remaining single decimal commas (e.g. 14,7 or 0,85) to decimal points
    .replace(/(?<=\d)[٬,](?=\d{1,2}(?:\D|$))/g, '.')
    .trim();

  // Skip hex addresses, OBD-II DTC fault codes, and map dimensions (16x16)
  if (/^0x[0-9a-f]+$/i.test(ascii) || /\b0x[0-9a-f]{2,8}\b/i.test(ascii)) return null;
  if (/^[PCBU][0-3][0-9a-f]{3}$/i.test(ascii)) return null;
  if (/^\d{1,2}\s*[xX×]\s*\d{1,2}$/.test(ascii)) return null;

  // 1. Ratio like "14.7:1" or "12.8 به 1"
  const ratioMatch = ascii.match(/^([+-]?\d+(?:\.\d+)?)\s*(?::|به)\s*1\b/);
  if (ratioMatch) {
    const val = Number(ratioMatch[1]);
    if (!Number.isFinite(val)) return null;
    const uInfo = normalizeUnitToken(fallbackUnit || 'AFR');
    return {
      rawDisplay: original,
      numericValue: val,
      normalizedValue: Number((val * uInfo.factor).toFixed(4)),
      unit: uInfo.unit || 'AFR',
      normalizedUnit: uInfo.canonical || 'AFR',
      isRange: false,
    };
  }

  // 2. Range like "750 تا 850 RPM" or "12.5 - 13.2 AFR"
  const rangeMatch = ascii.match(
    /^([+-]?\d+(?:\.\d+)?)\s*(?:تا|[-–—~])\s*([+-]?\d+(?:\.\d+)?)(?:\s*([A-Za-z°%λ/آ-ی]+(?:\s*[آ-ی]+)?))?$/
  );
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = Number(rangeMatch[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const mid = (lo + hi) / 2;
    const uInfo = normalizeUnitToken(rangeMatch[3] || fallbackUnit);
    return {
      rawDisplay: original,
      numericValue: Number(mid.toFixed(4)),
      normalizedValue: Number(((mid + uInfo.offset) * uInfo.factor).toFixed(4)),
      unit: uInfo.unit,
      normalizedUnit: uInfo.canonical,
      isRange: true,
    };
  }

  // 3. Single scalar with optional unit: "+2.5°", "-1.5 deg", "4.2 bar", "6500 RPM", "145 Nm", "212 °F"
  const scalarMatch = ascii.match(
    /^([+-]?\d+(?:\.\d+)?)(?:\s*(°[CF]?|°|%|λ|mg\/str|mg\/stk|mg\/hub|g\/s|kg\/h|[A-Za-z]+|[آ-ی]+(?:\s+[آ-ی]+)?))?$/i
  );
  if (scalarMatch) {
    const val = Number(scalarMatch[1]);
    if (!Number.isFinite(val)) return null;
    const uInfo = normalizeUnitToken(scalarMatch[2] || fallbackUnit);
    return {
      rawDisplay: original,
      numericValue: val,
      normalizedValue: Number(((val + uInfo.offset) * uInfo.factor).toFixed(4)),
      unit: uInfo.unit,
      normalizedUnit: uInfo.canonical,
      isRange: false,
    };
  }

  return null;
}

// ============================================================================
// 2. STATISTICAL MATH HELPERS (Mean, Median, StdDev, CV%, RMSE, Pearson r)
// ============================================================================

export function computeDescriptiveStats(values: number[]): {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  absDelta: number;
  percentDiff: number;
  cvPercent: number;
} {
  if (values.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      absDelta: 0,
      percentDiff: 0,
      cvPercent: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const mean = sorted.reduce((acc, v) => acc + v, 0) / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);
  const absDelta = max - min;

  // Order-independent relative percentage difference anchored to minimum non-zero magnitude (fallback to max/mean)
  const baseDenom =
    Math.abs(min) > 1e-9
      ? Math.abs(min)
      : Math.abs(max) > 1e-9
        ? Math.abs(max)
        : Math.abs(mean) > 1e-9
          ? Math.abs(mean)
          : 1;
  const percentDiff = (absDelta / baseDenom) * 100;
  const cvPercent = Math.abs(mean) > 1e-9 ? (stdDev / Math.abs(mean)) * 100 : 0;

  return {
    count,
    min: Number(min.toFixed(3)),
    max: Number(max.toFixed(3)),
    mean: Number(mean.toFixed(3)),
    median: Number(median.toFixed(3)),
    stdDev: Number(stdDev.toFixed(3)),
    absDelta: Number(absDelta.toFixed(3)),
    percentDiff: Number(percentDiff.toFixed(1)),
    cvPercent: Number(cvPercent.toFixed(1)),
  };
}

export function computeRmseAndPearson(
  xs: number[],
  ys: number[]
): { rmse: number; pearsonR: number | null } {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return { rmse: 0, pearsonR: null };

  let sqErrSum = 0;
  for (let i = 0; i < n; i++) {
    const d = ys[i] - xs[i];
    sqErrSum += d * d;
  }
  const rmse = Number(Math.sqrt(sqErrSum / n).toFixed(3));

  if (n < 3) return { rmse, pearsonR: null };
  const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  if (denom < 1e-9) return { rmse, pearsonR: null };
  return { rmse, pearsonR: Number((num / denom).toFixed(3)) };
}

// ============================================================================
// 3. ECU REMAPPING SEVERITY & SAFETY RISK CLASSIFIER
// ============================================================================

function classifyEcuDiscrepancySeverity(params: {
  label: string;
  unit: string | null;
  absDelta: number;
  percentDiff: number;
  unitMismatch: boolean;
}): { severity: DiscrepancySeverity; reason: string; safetyGuidance: string } {
  const lower = params.label.toLowerCase();
  const unit = params.unit;

  if (params.unitMismatch) {
    return {
      severity: 'critical',
      reason: 'عدم تطابق واحد فیزیکی اندازه‌گیری میان نسخه‌ها',
      safetyGuidance:
        'پیش از اعمال عدد در نقشه WinOLS، واحد فیزیکی (مثلاً bar در برابر psi یا AFR در برابر Lambda) را یکسان‌سازی کنید؛ خطای واحد منجر به کالیبراسیون اشتباه شدید می‌شود.',
    };
  }

  // 1. Explicit unit takes absolute precedence over ambient text keywords
  const isPressure =
    unit === 'bar' || (!unit && /فشار|بوست|ریل|توربو|boost|ldrxn/.test(lower));
  const isIgnition =
    unit === 'deg' || (!unit && /آوانس|جرقه|kfzw|btdc|atdc|تایمینگ|ریتارد/.test(lower));
  const isAfr =
    unit === 'AFR' || (!unit && /afr|استوکیومتری|نسبت هوا|lambda|لاندا|لامبدا|lamfa/.test(lower));
  const isTorquePower =
    unit === 'Nm' || unit === 'hp' || (!unit && /گشتاور|توان|قدرت|داینو|torque|power/.test(lower));
  const isRpm =
    unit === 'RPM' || (!unit && /کات‌آف|کات اف|دور آرام|nmax/.test(lower));

  // Boost / Fuel Rail Pressure
  if (isPressure) {
    if (params.percentDiff >= 15 || params.absDelta >= 0.5) {
      return {
        severity: 'critical',
        reason: `اختلاف بحرانی فشار کاری (${params.absDelta.toFixed(2)} bar / ${params.percentDiff.toFixed(1)}%)`,
        safetyGuidance:
          'اختلاف بالای ۱۵٪ در فشار ریل سوخت یا بوست توربو می‌تواند باعث خطای اوربوست (Overboost)، آسیب به توربوشارژر یا قفل شدن سوزن انژکتور شود.',
      };
    }
    if (params.percentDiff >= 7) {
      return {
        severity: 'warning',
        reason: `تغییر قابل‌توجه فشار (${params.percentDiff.toFixed(1)}%)`,
        safetyGuidance: 'محدودکننده‌های فشار (SVBL/LDRXN) و ظرفیت پمپ سوخت را بین دو نسخه تطبیق دهید.',
      };
    }
  }

  // Ignition advance / timing (KFZW / BTDC)
  if (isIgnition) {
    if (params.absDelta >= 2.0 || params.percentDiff >= 15) {
      return {
        severity: 'critical',
        reason: `اختلاف بحرانی زاویه آوانس جرقه (${params.absDelta.toFixed(1)} درجه)`,
        safetyGuidance:
          'اختلاف ۲ درجه یا بیشتر در مپ آوانس جرقه (KFZW) بدون سوخت با اکتان مناسب ریسک مستقیم ناک (Knock / Detonation) و شکستن رینگ پیستون ایجاد می‌کند.',
      };
    }
    if (params.absDelta >= 1.0 || params.percentDiff >= 8) {
      return {
        severity: 'warning',
        reason: `اختلاف متوسط در زاویه جرقه (${params.absDelta.toFixed(1)} درجه)`,
        safetyGuidance:
          'پیش از ثبت مقدار بالاتر، لاگ سنسور ناک (Knock Retard) را در بار کامل بررسی کنید.',
      };
    }
  }

  // AFR / Lambda
  if (isAfr) {
    if (params.absDelta >= 0.5 || params.percentDiff >= 5) {
      return {
        severity: 'critical',
        reason: `انحراف بحرانی نسبت هوا به سوخت (${params.absDelta.toFixed(2)} AFR / ${params.percentDiff.toFixed(1)}%)`,
        safetyGuidance:
          'تفاوت بیش از ۰.۵ واحد در AFR (به‌ویژه به سمت سوخت رقیق/Lean در بار کامل) می‌تواند دمای اگزوز (EGT) را بالا برده و باعث ذوب شدن پیستون یا سوپاپ شود.',
      };
    }
    if (params.absDelta >= 0.2 || params.percentDiff >= 2) {
      return {
        severity: 'warning',
        reason: `تفاوت قابل‌توجه در هدف سوخت (${params.percentDiff.toFixed(1)}%)`,
        safetyGuidance:
          'مقدار هدف AFR/LAMFA را با وایدبند (Wideband O2) روی داینو یا تست جاده راستی‌آزمایی کنید.',
      };
    }
  }

  // Torque / Power curves (Nm / hp)
  if (isTorquePower) {
    if (params.percentDiff >= 20) {
      return {
        severity: 'critical',
        reason: `اختلاف بزرگ در منحنی گشتاور/توان (${params.percentDiff.toFixed(1)}%)`,
        safetyGuidance:
          'اختلاف بالای ۲۰٪ در گشتاور یا توان بین دو نسخه ممکن است ناشی از مقایسه حالت استوک با استیج ۲ یا خطای ضریب تصحیح داینو باشد؛ شرایط تست را در جزوه شفاف کنید.',
      };
    }
    if (params.percentDiff >= 8) {
      return {
        severity: 'warning',
        reason: `تفاوت آماری در خروجی گشتاور/توان (${params.percentDiff.toFixed(1)}%)`,
        safetyGuidance:
          'محدودکننده گشتاور (KFMIRL / KFMIOP) و شرایط دمایی تست داینو را بین دو نسخه بررسی کنید.',
      };
    }
  }

  // RPM / Rev Limiter (NMAX)
  if (isRpm) {
    if (params.absDelta >= 400 || params.percentDiff >= 8) {
      return {
        severity: 'critical',
        reason: `اختلاف بحرانی در دور موتور / کات‌آف (${Math.round(params.absDelta)} RPM)`,
        safetyGuidance:
          'افزایش غیرمجاز کات‌آف (NMAX) فراتر از تحمل فنر سوپاپ و یاتاقان موتور در نسخه‌های مختلف جزوه می‌تواند به شناور شدن سوپاپ (Valve Float) منجر شود.',
      };
    }
    if (params.absDelta >= 150) {
      return {
        severity: 'warning',
        reason: `اختلاف دور موتور (${Math.round(params.absDelta)} RPM)`,
        safetyGuidance: 'بررسی کنید کدام نسخه مربوط به موتور استاندارد و کدام مربوط به ستاپ تقویت‌شده است.',
      };
    }
  }

  // Generic numeric threshold
  if (params.percentDiff >= 25) {
    return {
      severity: 'critical',
      reason: `انحراف عددی شدید میان نسخه‌ها (${params.percentDiff.toFixed(1)}%)`,
      safetyGuidance:
        'این اختلاف عددی فراتر از تلرانس معمول نسخه‌های جزوه است؛ پیش از انتشار نهایی منبع مرجع معتبرتر را تأیید کنید.',
    };
  }
  if (params.percentDiff >= 8) {
    return {
      severity: 'warning',
      reason: `انحراف آماری متوسط میان نسخه‌ها (${params.percentDiff.toFixed(1)}%)`,
      safetyGuidance: 'مقدار نهایی را با کاتالوگ فنی یا فایل دامپ استاندارد تطبیق دهید.',
    };
  }
  return {
    severity: 'info',
    reason: `تفاوت جزئی میان نسخه‌ها (${params.percentDiff.toFixed(1)}%)`,
    safetyGuidance: 'تفاوت در محدوده تلرانس جزئی است؛ جهت یکدستی جزوه عدد مرجع را یکسان‌سازی کنید.',
  };
}

// ============================================================================
// 4. EXTRACTORS FOR TABLES AND CHARTS/SERIES ACROSS SOURCE FILES
// ============================================================================

interface ExtractedTableDataset {
  unitId: string;
  fileId: string;
  fileName: string;
  title: string;
  normTitle: string;
  headers: string[];
  normHeaders: string[];
  rows: string[][];
  ecuPlatforms: string[];
  unitColIndex: number; // optional dedicated "واحد" / "Unit" column
}

interface ExtractedChartPoint {
  xLabel: string;
  xNorm: string;
  measurement: ParsedMeasurement;
}

interface ExtractedChartDataset {
  unitId: string;
  fileId: string;
  fileName: string;
  title: string;
  normTitle: string;
  points: ExtractedChartPoint[];
  ecuPlatforms: string[];
}

function extractInlineChartFromText(text: string): { title: string; points: ExtractedChartPoint[] } | null {
  const clean = (text || '').trim();
  if (!clean) return null;
  // Detect explicit chart/curve descriptions in Persian or English:
  // e.g. "نمودار منحنی گشتاور موتور: 2000 RPM = 128 Nm | 3000 RPM = 148 Nm | 4000 RPM = 162 Nm"
  const headerMatch = clean.match(
    /^(?:نمودار|منحنی|گراف|چارت|شکل\s*[۰-۹0-9-]*\s*[:：-]?\s*نمودار|Chart|Graph|Curve)\s*([^:\n：]{2,90})[:：]\s*([\s\S]+)$/i
  );
  if (!headerMatch) return null;

  const title = headerMatch[1].trim();
  const body = headerMatch[2].trim();
  const segments = body.split(/[|؛;\n]+/).map((s) => s.trim()).filter(Boolean);
  const points: ExtractedChartPoint[] = [];

  for (const seg of segments) {
    // Match "2000 RPM = 128 Nm" or "2000 RPM: 128 Nm" or "دور 2000 ← 128 Nm"
    const kv = seg.match(/^([^=:←→]{1,40})\s*(?:=|:|←|→)\s*(.+)$/);
    if (!kv) continue;
    const xLabel = kv[1].trim();
    const valStr = kv[2].trim();
    const parsed = parseNumericMeasurement(valStr);
    if (parsed) {
      points.push({
        xLabel,
        xNorm: normalizeLabelKey(xLabel),
        measurement: parsed,
      });
    }
  }

  if (points.length < 2) return null;
  return { title, points };
}

function extractDatasetsFromUnits(
  sourceFiles: SourceFileDto[],
  units: ContentUnitDto[]
): {
  tables: ExtractedTableDataset[];
  charts: ExtractedChartDataset[];
} {
  const fileMap = new Map(sourceFiles.map((f) => [f.id, f]));
  const tables: ExtractedTableDataset[] = [];
  const charts: ExtractedChartDataset[] = [];

  for (const unit of units) {
    const file = fileMap.get(unit.sourceFileId);
    const fileName = file?.fileName || String(unit.metadataJson?.fileName || 'سند منبع');
    // Prefer pristine pre-merge originalBlock if table fusion ran earlier
    const block = (unit.metadataJson?.originalBlock || unit.metadataJson?.block) as
      | TableBlock
      | DiagramBlock
      | FigureBlock
      | undefined;

    if (unit.unitType === 'table' && block && block.type === 'table' && block.headers.length >= 2) {
      const normHeaders = block.headers.map(normalizeLabelKey);
      const unitColIndex = normHeaders.findIndex((h) => h === 'واحد' || h === 'unit' || h === 'واحد اندازه گیری');
      const title = (block.caption || unit.headingPath || 'جدول داده‌های فنی')
        .replace(/^جدول\s*[۰-۹0-9]+[-–][۰-۹0-9]+\s*[:：-]?\s*/, '')
        .trim();
      const contextText = `${title} ${block.headers.join(' ')} ${block.rows.map((r) => r.join(' ')).join(' ')}`;
      tables.push({
        unitId: unit.id,
        fileId: unit.sourceFileId,
        fileName,
        title,
        normTitle: normalizeLabelKey(title),
        headers: block.headers,
        normHeaders,
        rows: block.rows,
        ecuPlatforms: Array.from(extractEcuPlatforms(contextText)),
        unitColIndex,
      });
      continue;
    }

    if (block && block.type === 'diagram' && Array.isArray(block.items) && block.items.length >= 2) {
      const points: ExtractedChartPoint[] = [];
      for (const item of block.items) {
        if (typeof item.value === 'number' && Number.isFinite(item.value)) {
          const parsedFromDetail = item.detail ? parseNumericMeasurement(item.detail) : null;
          const unitToken = parsedFromDetail?.unit || null;
          const uInfo = normalizeUnitToken(unitToken);
          points.push({
            xLabel: item.label,
            xNorm: normalizeLabelKey(item.label),
            measurement: {
              rawDisplay: item.detail ? `${item.value} (${item.detail})` : String(item.value),
              numericValue: item.value,
              normalizedValue: Number((item.value * uInfo.factor).toFixed(4)),
              unit: uInfo.unit,
              normalizedUnit: uInfo.canonical,
              isRange: false,
            },
          });
        } else if (item.detail) {
          const parsed = parseNumericMeasurement(item.detail);
          if (parsed) {
            points.push({
              xLabel: item.label,
              xNorm: normalizeLabelKey(item.label),
              measurement: parsed,
            });
          }
        }
      }
      if (points.length >= 2) {
        const title = (block.title || block.caption || 'نمودار داده‌های عددی').trim();
        charts.push({
          unitId: unit.id,
          fileId: unit.sourceFileId,
          fileName,
          title,
          normTitle: normalizeLabelKey(title),
          points,
          ecuPlatforms: Array.from(extractEcuPlatforms(`${title} ${block.caption || ''}`)),
        });
      }
      continue;
    }

    // Inline textual / Markdown / Figure chart data series
    const rawCandidate =
      block && block.type === 'figure' ? `${block.caption}: ${block.description}` : unit.rawText;
    const inlineChart = extractInlineChartFromText(rawCandidate);
    if (inlineChart) {
      charts.push({
        unitId: unit.id,
        fileId: unit.sourceFileId,
        fileName,
        title: inlineChart.title,
        normTitle: normalizeLabelKey(inlineChart.title),
        points: inlineChart.points,
        ecuPlatforms: Array.from(extractEcuPlatforms(rawCandidate)),
      });
    }
  }

  return { tables, charts };
}

function tokenJaccard(a: string, b: string): number {
  const tokA = new Set(a.split(/\s+/).filter((w) => w.length >= 2));
  const tokB = new Set(b.split(/\s+/).filter((w) => w.length >= 2));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let inter = 0;
  for (const t of tokA) if (tokB.has(t)) inter++;
  const union = tokA.size + tokB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ============================================================================
// 5. MAIN ENTRYPOINT: ANALYZE NUMERIC DISCREPANCIES ACROSS FILE VERSIONS
// ============================================================================

export function analyzeNumericDiscrepancies(params: {
  sourceFiles: SourceFileDto[];
  units: ContentUnitDto[];
}): NumericDiscrepancyReport {
  const { tables, charts } = extractDatasetsFromUnits(params.sourceFiles, params.units);

  const discrepancies: NumericDiscrepancyItem[] = [];
  const datasetComparisons: DatasetStatisticalComparison[] = [];
  let totalMatchedPoints = 0;
  let seq = 0;

  // --- A. COMPARE COMPATIBLE DATA TABLES ACROSS DIFFERENT SOURCE FILES ---
  const visitedTablePairs = new Set<string>();
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const tA = tables[i];
      const tB = tables[j];
      if (tA.fileId === tB.fileId) continue;

      const pairKey = [tA.unitId, tB.unitId].sort().join('::');
      if (visitedTablePairs.has(pairKey)) continue;

      // Schema compatibility: >= 60% shared headers OR >= 60% shared title + same col count
      const headerOverlap =
        tA.normHeaders.filter((h) => h && tB.normHeaders.includes(h)).length /
        Math.max(tA.normHeaders.length, tB.normHeaders.length);
      const titleSim = tokenJaccard(tA.normTitle, tB.normTitle);
      if (headerOverlap < 0.6 && !(titleSim >= 0.55 && tA.headers.length === tB.headers.length)) {
        continue;
      }

      // Build column mapping from tB to tA by header name or position
      const colMapBtoA = new Map<number, number>();
      tA.normHeaders.forEach((hA, idxA) => {
        const idxB = tB.normHeaders.indexOf(hA);
        if (idxB >= 0) colMapBtoA.set(idxA, idxB);
        else if (tA.headers.length === tB.headers.length) colMapBtoA.set(idxA, idxA);
      });

      // Index rows of tB by normalized primary key (column 0)
      const rowsBByKey = new Map<string, string[]>();
      for (const rB of tB.rows) {
        const k = normalizeLabelKey(rB[0] || '');
        if (k && !rowsBByKey.has(k)) rowsBByKey.set(k, rB);
      }

      const comparisonPoints: DatasetSeriesPointComparison[] = [];
      const xs: number[] = [];
      const ys: number[] = [];
      let datasetUnitDisplay = '';

      for (const rA of tA.rows) {
        const rawKey = (rA[0] || '').trim();
        const keyNorm = normalizeLabelKey(rawKey);
        if (!keyNorm) continue;
        const rB = rowsBByKey.get(keyNorm);
        if (!rB) continue;

        // Guard against comparing rows that explicitly belong to two disjoint ECU models
        if (hasDisjointEcuPlatforms(rA.join(' '), rB.join(' '))) continue;

        const rowUnitA = tA.unitColIndex >= 0 ? rA[tA.unitColIndex] : null;
        const rowUnitB = tB.unitColIndex >= 0 ? rB[tB.unitColIndex] : null;

        for (let colA = 1; colA < tA.headers.length; colA++) {
          if (colA === tA.unitColIndex) continue;
          const colB = colMapBtoA.get(colA);
          if (colB === undefined || colB === tB.unitColIndex) continue;

          const cellA = (rA[colA] || '').trim();
          const cellB = (rB[colB] || '').trim();
          const mA = parseNumericMeasurement(cellA, rowUnitA);
          const mB = parseNumericMeasurement(cellB, rowUnitB);
          if (!mA || !mB) continue;

          totalMatchedPoints++;
          const unitMismatch = Boolean(
            mA.normalizedUnit && mB.normalizedUnit && mA.normalizedUnit !== mB.normalizedUnit
          );
          const valA = unitMismatch ? mA.numericValue : mA.normalizedValue;
          const valB = unitMismatch ? mB.numericValue : mB.normalizedValue;
          const stats = computeDescriptiveStats([valA, valB]);
          const unitDisp = unitMismatch
            ? `${mA.unit || ''} ≠ ${mB.unit || ''}`.trim()
            : mA.normalizedUnit || mB.normalizedUnit || mA.unit || mB.unit || '';

          if (!datasetUnitDisplay && unitDisp) datasetUnitDisplay = unitDisp;

          xs.push(valA);
          ys.push(valB);

          const isInconsistent = unitMismatch || stats.percentDiff >= 0.5 || stats.absDelta >= 0.01;
          if (!isInconsistent) {
            comparisonPoints.push({
              label: rawKey,
              valueA: valA,
              valueB: valB,
              rawA: cellA,
              rawB: cellB,
              absDelta: 0,
              percentDiff: 0,
              unit: unitDisp || null,
              severity: 'match',
            });
            continue;
          }

          const sev = classifyEcuDiscrepancySeverity({
            label: `${rawKey} ${tA.headers[colA] || ''}`,
            unit: mA.normalizedUnit || mB.normalizedUnit,
            absDelta: stats.absDelta,
            percentDiff: stats.percentDiff,
            unitMismatch,
          });

          comparisonPoints.push({
            label: rawKey,
            valueA: valA,
            valueB: valB,
            rawA: cellA,
            rawB: cellB,
            absDelta: stats.absDelta,
            percentDiff: stats.percentDiff,
            unit: unitDisp || null,
            severity: sev.severity,
          });

          const platforms = Array.from(
            new Set([
              ...tA.ecuPlatforms,
              ...tB.ecuPlatforms,
              ...Array.from(extractEcuPlatforms(`${rawKey} ${cellA} ${cellB}`)),
            ])
          );

          discrepancies.push({
            id: `disc_tbl_${++seq}`,
            sourceKind: 'table',
            datasetTitle: tA.title,
            parameterLabel: rawKey,
            columnOrAxisLabel: tA.headers[colA] || `ستون ${colA + 1}`,
            ecuPlatforms: platforms,
            severity: sev.severity,
            severityReason: sev.reason,
            safetyGuidance: sev.safetyGuidance,
            unitDisplay: unitDisp || 'عددی',
            unitMismatch,
            versions: [
              {
                fileId: tA.fileId,
                fileName: tA.fileName,
                unitId: tA.unitId,
                rawDisplay: cellA,
                numericValue: mA.numericValue,
                normalizedValue: valA,
                unit: mA.unit,
                normalizedUnit: mA.normalizedUnit,
              },
              {
                fileId: tB.fileId,
                fileName: tB.fileName,
                unitId: tB.unitId,
                rawDisplay: cellB,
                numericValue: mB.numericValue,
                normalizedValue: valB,
                unit: mB.unit,
                normalizedUnit: mB.normalizedUnit,
              },
            ],
            stats,
          });
        }
      }

      if (comparisonPoints.length > 0) {
        visitedTablePairs.add(pairKey);
        const { rmse, pearsonR } = computeRmseAndPearson(xs, ys);
        const inconsistentPts = comparisonPoints.filter((p) => p.severity !== 'match');
        const meanPct =
          comparisonPoints.reduce((acc, p) => acc + p.percentDiff, 0) / comparisonPoints.length;
        const maxPct = Math.max(...comparisonPoints.map((p) => p.percentDiff));

        datasetComparisons.push({
          id: `dsc_tbl_${datasetComparisons.length + 1}`,
          sourceKind: 'table',
          title: tA.title,
          fileAName: tA.fileName,
          fileBName: tB.fileName,
          unitDisplay: datasetUnitDisplay || 'متنوع',
          matchedPointsCount: comparisonPoints.length,
          inconsistentPointsCount: inconsistentPts.length,
          meanPercentDiff: Number(meanPct.toFixed(1)),
          maxPercentDiff: Number(maxPct.toFixed(1)),
          rmse,
          pearsonR,
          points: comparisonPoints,
        });
      }
    }
  }

  // --- B. COMPARE COMPATIBLE CHARTS / CURVES ACROSS DIFFERENT SOURCE FILES ---
  const visitedChartPairs = new Set<string>();
  for (let i = 0; i < charts.length; i++) {
    for (let j = i + 1; j < charts.length; j++) {
      const cA = charts[i];
      const cB = charts[j];
      if (cA.fileId === cB.fileId) continue;

      const pairKey = [cA.unitId, cB.unitId].sort().join('::');
      if (visitedChartPairs.has(pairKey)) continue;

      // Guard disjoint ECU charts (e.g., ME7.4.4 dyno curve vs SIM2K-241 dyno curve)
      if (hasDisjointEcuPlatforms(cA.title, cB.title)) continue;

      const mapB = new Map(cB.points.map((p) => [p.xNorm, p]));
      const sharedPoints = cA.points
        .filter((pA) => mapB.has(pA.xNorm))
        .map((pA) => ({ pA, pB: mapB.get(pA.xNorm)! }));

      const xOverlapRatio =
        sharedPoints.length / Math.max(cA.points.length, cB.points.length, 1);
      const titleSim = tokenJaccard(cA.normTitle, cB.normTitle);

      if (sharedPoints.length < 2 || (xOverlapRatio < 0.5 && titleSim < 0.4)) {
        continue;
      }

      const comparisonPoints: DatasetSeriesPointComparison[] = [];
      const xs: number[] = [];
      const ys: number[] = [];
      let chartUnit = '';

      for (const { pA, pB } of sharedPoints) {
        totalMatchedPoints++;
        const mA = pA.measurement;
        const mB = pB.measurement;
        const unitMismatch = Boolean(
          mA.normalizedUnit && mB.normalizedUnit && mA.normalizedUnit !== mB.normalizedUnit
        );
        const valA = unitMismatch ? mA.numericValue : mA.normalizedValue;
        const valB = unitMismatch ? mB.numericValue : mB.normalizedValue;
        const stats = computeDescriptiveStats([valA, valB]);
        const unitDisp = unitMismatch
          ? `${mA.unit || ''} ≠ ${mB.unit || ''}`.trim()
          : mA.normalizedUnit || mB.normalizedUnit || mA.unit || mB.unit || '';
        if (!chartUnit && unitDisp) chartUnit = unitDisp;

        xs.push(valA);
        ys.push(valB);

        const isInconsistent = unitMismatch || stats.percentDiff >= 0.5 || stats.absDelta >= 0.01;
        if (!isInconsistent) {
          comparisonPoints.push({
            label: pA.xLabel,
            valueA: valA,
            valueB: valB,
            rawA: mA.rawDisplay,
            rawB: mB.rawDisplay,
            absDelta: 0,
            percentDiff: 0,
            unit: unitDisp || null,
            severity: 'match',
          });
          continue;
        }

        const sev = classifyEcuDiscrepancySeverity({
          label: `${cA.title} ${pA.xLabel}`,
          unit: mA.normalizedUnit || mB.normalizedUnit,
          absDelta: stats.absDelta,
          percentDiff: stats.percentDiff,
          unitMismatch,
        });

        comparisonPoints.push({
          label: pA.xLabel,
          valueA: valA,
          valueB: valB,
          rawA: mA.rawDisplay,
          rawB: mB.rawDisplay,
          absDelta: stats.absDelta,
          percentDiff: stats.percentDiff,
          unit: unitDisp || null,
          severity: sev.severity,
        });

        discrepancies.push({
          id: `disc_cht_${++seq}`,
          sourceKind: 'chart',
          datasetTitle: cA.title,
          parameterLabel: pA.xLabel,
          columnOrAxisLabel: 'مقدار روی محور نمودار',
          ecuPlatforms: Array.from(new Set([...cA.ecuPlatforms, ...cB.ecuPlatforms])),
          severity: sev.severity,
          severityReason: sev.reason,
          safetyGuidance: sev.safetyGuidance,
          unitDisplay: unitDisp || 'عددی',
          unitMismatch,
          versions: [
            {
              fileId: cA.fileId,
              fileName: cA.fileName,
              unitId: cA.unitId,
              rawDisplay: mA.rawDisplay,
              numericValue: mA.numericValue,
              normalizedValue: valA,
              unit: mA.unit,
              normalizedUnit: mA.normalizedUnit,
            },
            {
              fileId: cB.fileId,
              fileName: cB.fileName,
              unitId: cB.unitId,
              rawDisplay: mB.rawDisplay,
              numericValue: mB.numericValue,
              normalizedValue: valB,
              unit: mB.unit,
              normalizedUnit: mB.normalizedUnit,
            },
          ],
          stats,
        });
      }

      if (comparisonPoints.length > 0) {
        visitedChartPairs.add(pairKey);
        const { rmse, pearsonR } = computeRmseAndPearson(xs, ys);
        const inconsistentPts = comparisonPoints.filter((p) => p.severity !== 'match');
        const meanPct =
          comparisonPoints.reduce((acc, p) => acc + p.percentDiff, 0) / comparisonPoints.length;
        const maxPct = Math.max(...comparisonPoints.map((p) => p.percentDiff));

        datasetComparisons.push({
          id: `dsc_cht_${datasetComparisons.length + 1}`,
          sourceKind: 'chart',
          title: cA.title,
          fileAName: cA.fileName,
          fileBName: cB.fileName,
          unitDisplay: chartUnit || 'عددی',
          matchedPointsCount: comparisonPoints.length,
          inconsistentPointsCount: inconsistentPts.length,
          meanPercentDiff: Number(meanPct.toFixed(1)),
          maxPercentDiff: Number(maxPct.toFixed(1)),
          rmse,
          pearsonR,
          points: comparisonPoints,
        });
      }
    }
  }

  // Sort discrepancies: critical first, then warning, then highest percentDiff
  const sevRank: Record<DiscrepancySeverity, number> = { critical: 0, warning: 1, info: 2 };
  discrepancies.sort((a, b) => {
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
    return b.stats.percentDiff - a.stats.percentDiff;
  });

  const criticalCount = discrepancies.filter((d) => d.severity === 'critical').length;
  const warningCount = discrepancies.filter((d) => d.severity === 'warning').length;
  const infoCount = discrepancies.filter((d) => d.severity === 'info').length;
  const maxPercentDiff =
    discrepancies.length > 0 ? Math.max(...discrepancies.map((d) => d.stats.percentDiff)) : 0;
  const meanPercentDiff =
    discrepancies.length > 0
      ? Number(
          (
            discrepancies.reduce((acc, d) => acc + d.stats.percentDiff, 0) / discrepancies.length
          ).toFixed(1)
        )
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    comparedFilesCount: params.sourceFiles.length,
    analyzedTablesCount: tables.length,
    analyzedChartsCount: charts.length,
    totalMatchedPoints,
    inconsistentCount: discrepancies.length,
    criticalCount,
    warningCount,
    infoCount,
    maxPercentDiff: Number(maxPercentDiff.toFixed(1)),
    meanPercentDiff,
    discrepancies,
    datasetComparisons,
  };
}
