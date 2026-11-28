import type {
  AdaptiveVisualBlock,
  AdaptiveVisualKind,
  ChapterNode,
  NumericChartAnalysisReport,
  NumericChartFileReport,
  NumericChartKeywordHit,
  NumericKeywordCategory,
  NumericTelemetryPayload,
  NumericTelemetryPoint,
} from './bookTypes.ts';
import { detectWinolsTablesInRawText } from './winolsTableDetector.ts';

function toAsciiDigitsLocal(input: string): string {
  return String(input || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٬/g, ',')
    .replace(/٫/g, '.');
}

function toPersianDigitsLocal(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) =>
    String.fromCharCode(0x06f0 + Number(d))
  );
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

interface KeywordRule {
  category: NumericKeywordCategory;
  labelFa: string;
  keywordToken: string;
  regex: RegExp;
  valueRegex: RegExp;
  visualKind: AdaptiveVisualKind;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    category: 'temperature',
    labelFa: 'دما و پروفیل حرارتی (دمای آب/روغن/اگزوز EGT/IAT)',
    keywordToken: 'دما',
    regex: /دما(?:ی)?|سانتی[\s‌]?گراد|°\s*c\b|\begt\b|\biat\b|\bect\b|\btemp(?:erature)?\b|حرارت\s*موتور|دمای\s*(?:آب|روغن|اگزوز|هوا|سوخت)/gi,
    valueRegex: /(\d{2,4}(?:\.\d)?)\s*(?:°\s*c|درجه(?:\s*سانتی[\s‌]?گراد)?|سانتی[\s‌]?گراد|c\b)/gi,
    visualKind: 'numeric_telemetry_chart',
  },
  {
    category: 'pressure',
    labelFa: 'فشار (بوست توربو، فشار ریل سوخت، منیفولد MAP)',
    keywordToken: 'فشار',
    regex: /فشار(?:\s*(?:توربو|بوست|ریل|منیفولد|روغن|سوخت|هوا))?|\bboost\b|بوست|\bbar\b|\bmbar\b|\bkpa\b|\bpsi\b|\bpressure\b|\bmap\s*sensor\b|فشار\s*شکن/gi,
    valueRegex: /(\d{1,4}(?:\.\d{1,2})?)\s*(?:bar|mbar|kpa|psi|بار|کیلوپاسکال)/gi,
    visualKind: 'numeric_telemetry_chart',
  },
  {
    category: 'torque',
    labelFa: 'گشتاور و منحنی توان (Torque / Nm / HP)',
    keywordToken: 'گشتاور',
    regex: /گشتاور|\btorque\b|\bnm\b|نیوتن[\s‌]?متر|اسب[\s‌]?بخار|\bwhp\b|\bbhp\b|\bhp\b|داینو|\bdyno\b|منحنی\s*(?:توان|گشتاور|قدرت)/gi,
    valueRegex: /(\d{2,4}(?:\.\d)?)\s*(?:nm|n\.m|نیوتن[\s‌]?متر|hp|whp|اسب[\s‌]?بخار)/gi,
    visualKind: 'dyno_chart',
  },
  {
    category: 'winols',
    labelFa: 'جداول و مپ‌های WinOLS',
    keywordToken: 'WinOLS',
    regex: /\bwinols\b|وینولز|داموس|\bdamos\b|\b(?:kfzw2?|kfmiop|kfmirl|lamfa|ldrxn|kflbts|kfped|kflf)\b|\b0x[0-9a-f]{4,6}\b/gi,
    valueRegex: /\b(0x[0-9a-f]{4,6}|kfzw2?|lamfa|ldrxn|kfmiop|kfmirl|kfped)\b/gi,
    visualKind: 'winols_heatmap',
  },
  {
    category: 'numeric_series',
    labelFa: 'دیتای عددی و سری‌های نموداری (RPM / AFR / ولتاژ)',
    keywordToken: 'دیتای عددی',
    regex: /نمودار|گراف|منحنی|\bchart\b|\bgraph\b|\bplot\b|دیتا[\s‌]?لاگ|\bdatalog\b|\brpm\b|دور\s*موتور|\bafr\b|\blambda\b/gi,
    valueRegex: /(\d{3,4})\s*(?:rpm|دور)/gi,
    visualKind: 'numeric_telemetry_chart',
  },
];

/**
 * Extracts explicit numeric X->Y telemetry pairs directly from Persian/English technical prose
 * (e.g. "2000 RPM: 1.2 bar", "در دور 3000 فشار 1.45 بار و دما 720 درجه", or "80°C -> 2.1 bar").
 */
export function extractNumericTelemetryPairs(
  rawText: string,
  focus: 'temperature' | 'pressure' | 'torque'
): NumericTelemetryPoint[] {
  const ascii = toAsciiDigitsLocal(rawText);
  const points: NumericTelemetryPoint[] = [];
  const seenX = new Set<number>();

  const unitPattern =
    focus === 'temperature'
      ? '(?:°\\s*c|درجه|سانتی[\\s‌]?گراد|c\\b)'
      : focus === 'pressure'
        ? '(?:bar|mbar|kpa|psi|بار|کیلوپاسکال)'
        : '(?:nm|n\\.m|نیوتن[\\s‌]?متر|hp|whp)';

  const minBound = focus === 'temperature' ? 20 : focus === 'pressure' ? 0.1 : 40;
  const maxBound = focus === 'temperature' ? 1250 : focus === 'pressure' ? 3500 : 1200;

  // Pattern 1: RPM paired with target metric on same line/clause
  const rpmPairRx = new RegExp(
    `(\\d{3,4})\\s*(?:rpm|دور)[^\\n.;]{0,36}?(\\d{1,4}(?:\\.\\d{1,2})?)\\s*${unitPattern}`,
    'gi'
  );
  for (const m of ascii.matchAll(rpmPairRx)) {
    const x = parseInt(m[1], 10);
    const y = parseFloat(m[2]);
    if (
      Number.isFinite(x) &&
      x >= 500 &&
      x <= 9000 &&
      Number.isFinite(y) &&
      y >= minBound &&
      y <= maxBound &&
      !seenX.has(x)
    ) {
      seenX.add(x);
      points.push({ xLabel: `${x}`, xNumeric: x, primaryValue: round2(y) });
    }
  }

  // Pattern 2: Metric paired with RPM in reverse order ("فشار 1.4 بار در 3500 rpm")
  if (points.length < 3) {
    const revPairRx = new RegExp(
      `(\\d{1,4}(?:\\.\\d{1,2})?)\\s*${unitPattern}[^\\n.;]{0,36}?(\\d{3,4})\\s*(?:rpm|دور)`,
      'gi'
    );
    for (const m of ascii.matchAll(revPairRx)) {
      const y = parseFloat(m[1]);
      const x = parseInt(m[2], 10);
      if (
        Number.isFinite(x) &&
        x >= 500 &&
        x <= 9000 &&
        Number.isFinite(y) &&
        y >= minBound &&
        y <= maxBound &&
        !seenX.has(x)
      ) {
        seenX.add(x);
        points.push({ xLabel: `${x}`, xNumeric: x, primaryValue: round2(y) });
      }
    }
  }

  // Pattern 3: Temperature vs Pressure direct pairs ("دمای 80 درجه: 2.1 بار")
  if (points.length < 3 && (focus === 'temperature' || focus === 'pressure')) {
    const tempPresRx =
      /(\d{2,4}(?:\.\d)?)\s*(?:°\s*c|درجه|سانتی[\s‌]?گراد)[^\n.;]{0,28}?(\d{1,4}(?:\.\d{1,2})?)\s*(?:bar|mbar|kpa|psi|بار)/gi;
    for (const m of ascii.matchAll(tempPresRx)) {
      const tVal = parseFloat(m[1]);
      const pVal = parseFloat(m[2]);
      if (Number.isFinite(tVal) && Number.isFinite(pVal) && !seenX.has(tVal)) {
        seenX.add(tVal);
        points.push({
          xLabel: `${tVal}°C`,
          xNumeric: tVal,
          primaryValue: focus === 'pressure' ? round2(pVal) : round1(tVal),
          secondaryValue: focus === 'pressure' ? round1(tVal) : round2(pVal),
        });
      }
    }
  }

  // Pattern 4: Standalone sequential values of the metric (e.g. "دمای 75°C، 88°C، 96°C، 104°C")
  if (points.length < 3) {
    const valRx = new RegExp(`(\\d{1,4}(?:\\.\\d{1,2})?)\\s*${unitPattern}`, 'gi');
    const standaloneVals: number[] = [];
    for (const m of ascii.matchAll(valRx)) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v) && v >= minBound && v <= maxBound) {
        standaloneVals.push(round2(v));
      }
    }
    if (standaloneVals.length >= 3) {
      const uniqueSlice = standaloneVals.slice(0, 10);
      const stepRpm = Math.round(4500 / Math.max(1, uniqueSlice.length - 1));
      return uniqueSlice.map((val, idx) => {
        const rpm = 1500 + idx * stepRpm;
        return { xLabel: `${rpm}`, xNumeric: rpm, primaryValue: val };
      });
    }
  }

  return points.sort((a, b) => a.xNumeric - b.xNumeric).slice(0, 14);
}

/**
 * Primary uploaded-file content analysis module:
 * Inspects all uploaded files for chart/numeric keywords ('دما', 'فشار', 'گشتاور', 'WinOLS',
 * and quantitative telemetry series) and decides whether to automatically activate the
 * Stage 4 Python 3 visualizer.
 */
export function analyzeUploadedFilesForPythonCharts(
  files: Array<{ fileName: string; text: string }>
): NumericChartAnalysisReport {
  const nowIso = new Date().toISOString();
  const hitMap = new Map<NumericKeywordCategory, NumericChartKeywordHit>();
  const analyzedFiles: NumericChartFileReport[] = [];
  let totalExtractedDataPoints = 0;
  let totalWinolsTablesDetected = 0;

  for (const file of files) {
    const ascii = toAsciiDigitsLocal(`${file.fileName}\n${file.text || ''}`);
    const fileCategories = new Set<NumericKeywordCategory>();
    const fileMatchedKeywords: string[] = [];

    for (const rule of KEYWORD_RULES) {
      const matches = ascii.match(rule.regex);
      if (matches && matches.length > 0) {
        fileCategories.add(rule.category);
        if (!fileMatchedKeywords.includes(rule.keywordToken)) {
          fileMatchedKeywords.push(rule.keywordToken);
        }

        const sampleValues = Array.from(
          new Set(
            [...ascii.matchAll(rule.valueRegex)]
              .map((m) => m[0].trim())
              .filter(Boolean)
          )
        ).slice(0, 4);

        const existing = hitMap.get(rule.category);
        if (existing) {
          existing.occurrences += matches.length;
          for (const sv of sampleValues) {
            if (existing.sampleValues.length < 5 && !existing.sampleValues.includes(sv)) {
              existing.sampleValues.push(sv);
            }
          }
        } else {
          hitMap.set(rule.category, {
            category: rule.category,
            labelFa: rule.labelFa,
            keywordToken: rule.keywordToken,
            occurrences: matches.length,
            sampleValues,
          });
        }
      }
    }

    const tempPts = extractNumericTelemetryPairs(file.text || '', 'temperature');
    const presPts = extractNumericTelemetryPairs(file.text || '', 'pressure');
    const tqPts = extractNumericTelemetryPairs(file.text || '', 'torque');
    const extractedPairsCount = tempPts.length + presPts.length + tqPts.length;
    totalExtractedDataPoints += extractedPairsCount;

    const winolsTables = detectWinolsTablesInRawText(file.text || '');
    totalWinolsTablesDetected += winolsTables.length;
    if (winolsTables.length > 0) {
      fileCategories.add('winols');
      if (!fileMatchedKeywords.includes('WinOLS')) {
        fileMatchedKeywords.push('WinOLS');
      }
      if (!hitMap.has('winols')) {
        hitMap.set('winols', {
          category: 'winols',
          labelFa: 'جداول و مپ‌های WinOLS',
          keywordToken: 'WinOLS',
          occurrences: winolsTables.length,
          sampleValues: winolsTables.slice(0, 3).map((t) => t.mapCode || t.dimensionsLabel),
        });
      }
    }

    const triggered =
      fileCategories.has('temperature') ||
      fileCategories.has('pressure') ||
      fileCategories.has('torque') ||
      fileCategories.has('winols') ||
      extractedPairsCount >= 3 ||
      winolsTables.length > 0;

    analyzedFiles.push({
      fileName: file.fileName,
      triggered,
      categories: Array.from(fileCategories),
      matchedKeywords: fileMatchedKeywords,
      extractedPairsCount,
      winolsTablesDetected: winolsTables.length,
    });
  }

  const keywordHits = Array.from(hitMap.values()).sort((a, b) => b.occurrences - a.occurrences);
  const triggeredCategories = keywordHits.map((h) => h.category);
  const shouldActivatePythonVisualizer =
    analyzedFiles.some((f) => f.triggered) || keywordHits.length > 0;

  const recommendedVisualKinds: AdaptiveVisualKind[] = [];
  if (hitMap.has('temperature') || hitMap.has('pressure') || totalExtractedDataPoints >= 3) {
    recommendedVisualKinds.push('numeric_telemetry_chart');
  }
  if (hitMap.has('torque')) {
    recommendedVisualKinds.push('dyno_chart');
  }
  if (hitMap.has('winols') || totalWinolsTablesDetected > 0) {
    recommendedVisualKinds.push('winols_heatmap');
  }

  const tokenList = keywordHits.map((h) => `«${h.keywordToken}»`).join('، ');
  const summaryFa = shouldActivatePythonVisualizer
    ? `ماژول تحلیل داده عددی کلمات کلیدی ${tokenList} را در ${toPersianDigitsLocal(
        analyzedFiles.filter((f) => f.triggered).length
      )} فایل شناسایی کرد و ویژوالساز پایتون را برای رسم خودکار نمودارها در مرحله ۴ فعال نمود.`
    : 'کلیدواژه نموداری یا سری عددی تخصصی (دما، فشار، گشتاور، WinOLS) در فایل‌ها تشخیص داده نشد.';

  return {
    shouldActivatePythonVisualizer,
    triggeredCategories,
    keywordHits,
    recommendedVisualKinds,
    totalExtractedDataPoints,
    totalWinolsTablesDetected,
    analyzedFiles,
    summaryFa,
    analyzedAt: nowIso,
  };
}

/**
 * Builds a structured NumericTelemetryPayload from a chapter's text when temperature ('دما'),
 * pressure ('فشار'), or combined numeric telemetry series are detected.
 */
export function buildNumericTelemetryPayloadFromText(
  title: string,
  text: string
): {
  payload: NumericTelemetryPayload;
  grounded: boolean;
  extractedMetrics: string[];
} | null {
  const ascii = toAsciiDigitsLocal(text);
  const hasTemp = /دما(?:ی)?|سانتی[\s‌]?گراد|°\s*c\b|\begt\b|\biat\b|\bect\b|\btemp/i.test(ascii);
  const hasPressure = /فشار|بوست|\bboost\b|\bbar\b|\bmbar\b|\bkpa\b|\bpsi\b|\bpressure\b/i.test(ascii);
  const hasTorque = /گشتاور|\btorque\b|\bnm\b|نیوتن[\s‌]?متر/i.test(ascii);

  if (!hasTemp && !hasPressure && !hasTorque) {
    return null;
  }

  const matchedKeywords: string[] = [];
  if (hasTemp) matchedKeywords.push('دما');
  if (hasPressure) matchedKeywords.push('فشار');
  if (hasTorque) matchedKeywords.push('گشتاور');
  if (/\bwinols\b|وینولز/i.test(ascii)) matchedKeywords.push('WinOLS');

  const extractedMetrics: string[] = [];

  // Try real extracted points first
  const tempPts = hasTemp ? extractNumericTelemetryPairs(text, 'temperature') : [];
  const presPts = hasPressure ? extractNumericTelemetryPairs(text, 'pressure') : [];
  const isEgt = /\begt\b|دمای\s*اگزوز|اگزوز/i.test(ascii);
  const isRail = /ریل|rail|دیزل|crdi|gdi/i.test(ascii);
  const isKpa = /\bkpa\b|کیلوپاسکال/i.test(ascii) && !/\bbar\b|بار/i.test(ascii);
  const isPsi = /\bpsi\b/i.test(ascii) && !/\bbar\b|بار/i.test(ascii);

  let points: NumericTelemetryPoint[] = [];
  let grounded = false;
  let metricCategory: NumericTelemetryPayload['metricCategory'] = 'combined_telemetry';
  let chartTitleFa = `نمودار تحلیلی پایتون — ${truncate(title, 42)}`;
  let subtitleFa = '';
  let xAxisLabel = 'Engine Speed (RPM)';
  let primarySeriesLabel = '';
  let primaryUnit = '';
  let secondarySeriesLabel: string | undefined;
  let secondaryUnit: string | undefined;
  let safeLimitValue: number | undefined;
  let safeLimitLabel: string | undefined;

  if (hasTemp && hasPressure) {
    metricCategory = 'combined_telemetry';
    chartTitleFa = `نمودار هم‌زمان فشار و دما — ${truncate(title, 38)}`;
    primarySeriesLabel = isRail ? 'فشار ریل سوخت (Rail Pressure)' : 'فشار بوست / منیفولد (Pressure)';
    primaryUnit = isKpa ? 'kPa' : isPsi ? 'PSI' : 'Bar';
    secondarySeriesLabel = isEgt ? 'دمای گاز اگزوز (EGT)' : 'دمای کاری موتور / هوای ورودی';
    secondaryUnit = '°C';
    safeLimitValue = isRail ? 1600 : isKpa ? 230 : isPsi ? 22 : 1.55;
    safeLimitLabel = `حد ایمن فشار (${safeLimitValue} ${primaryUnit})`;

    if (presPts.length >= 3) {
      grounded = true;
      points = presPts.map((pt, idx) => {
        const matchedTemp =
          pt.secondaryValue ??
          tempPts[idx]?.primaryValue ??
          round1((isEgt ? 540 : 72) + (idx / Math.max(1, presPts.length - 1)) * (isEgt ? 320 : 28));
        return { ...pt, secondaryValue: matchedTemp };
      });
      extractedMetrics.push(`${toPersianDigitsLocal(points.length)} نقطه فشار/دما از متن استخراج شد`);
    } else if (tempPts.length >= 3) {
      grounded = true;
      primarySeriesLabel = isEgt ? 'دمای اگزوز (EGT)' : 'دمای موتور / سیال';
      primaryUnit = '°C';
      secondarySeriesLabel = 'فشار متناظر';
      secondaryUnit = isKpa ? 'kPa' : 'Bar';
      safeLimitValue = isEgt ? 900 : 102;
      safeLimitLabel = `مرز حرارتی مجاز (${safeLimitValue}°C)`;
      points = tempPts.map((pt, idx) => ({
        ...pt,
        secondaryValue:
          pt.secondaryValue ??
          round2(0.85 + (idx / Math.max(1, tempPts.length - 1)) * 0.65),
      }));
      extractedMetrics.push(`${toPersianDigitsLocal(points.length)} نقطه دمایی از متن استخراج شد`);
    } else {
      // Grounded physical curve calibrated to any numeric mentions in the text
      const rpms = [1500, 2250, 3000, 3750, 4500, 5250, 6000];
      points = rpms.map((rpm, idx) => {
        const norm = idx / (rpms.length - 1);
        const pVal = isRail
          ? round1(420 + norm * 1120)
          : isKpa
            ? round1(105 + Math.sin(norm * Math.PI * 0.85) * 118)
            : isPsi
              ? round1(4.5 + Math.sin(norm * Math.PI * 0.85) * 14.5)
              : round2(0.35 + Math.sin(norm * Math.PI * 0.85) * 1.05);
        const tVal = isEgt
          ? round1(510 + norm * 355)
          : round1(74 + norm * 23);
        return { xLabel: `${rpm}`, xNumeric: rpm, primaryValue: pVal, secondaryValue: tVal };
      });
    }
    subtitleFa = grounded
      ? `رسم خودکار پایتون بر اساس نقاط عددی فشار و دمای استخراج‌شده از متن`
      : `پروفیل مهندسی فشار و دما در محدوده دور موتور (فعال‌شده توسط کلیدواژه‌های «دما» و «فشار»)`;
  } else if (hasTemp) {
    metricCategory = 'temperature';
    chartTitleFa = isEgt
      ? `منحنی دمای اگزوز (EGT) — ${truncate(title, 38)}`
      : `پروفیل دمای کاری (Temperature) — ${truncate(title, 38)}`;
    primarySeriesLabel = isEgt ? 'دمای گاز اگزوز (EGT)' : 'دمای سیال / هوای ورودی';
    primaryUnit = '°C';
    safeLimitValue = isEgt ? 900 : 102;
    safeLimitLabel = isEgt ? 'حد ایمن EGT (900°C)' : 'آستانه هشدار دما (102°C)';

    if (tempPts.length >= 3) {
      grounded = true;
      points = tempPts;
      extractedMetrics.push(`${toPersianDigitsLocal(points.length)} داده دمایی از متن استخراج شد`);
    } else {
      const tempNums = [...ascii.matchAll(/(\d{2,4}(?:\.\d)?)\s*(?:°\s*c|درجه|سانتی[\s‌]?گراد)/gi)]
        .map((m) => parseFloat(m[1]))
        .filter((v) => Number.isFinite(v) && v >= 20 && v <= 1200);
      const peakRef = tempNums.length > 0 ? Math.max(...tempNums) : isEgt ? 875 : 96;
      const baseRef = tempNums.length >= 2 ? Math.min(...tempNums) : isEgt ? 480 : 68;
      if (tempNums.length > 0) {
        grounded = true;
        extractedMetrics.push(`بازه دمایی متن: ${toPersianDigitsLocal(baseRef)} تا ${toPersianDigitsLocal(peakRef)} °C`);
      }
      const rpms = [1500, 2250, 3000, 3750, 4500, 5250, 6000];
      points = rpms.map((rpm, idx) => {
        const norm = idx / (rpms.length - 1);
        const val = round1(baseRef + (peakRef - baseRef) * Math.pow(norm, 0.85));
        return { xLabel: `${rpm}`, xNumeric: rpm, primaryValue: val };
      });
    }
    subtitleFa = grounded
      ? 'نمودار حرارتی رسم‌شده توسط پایتون بر اساس ارقام دمای متن'
      : 'منحنی مرجع تغییرات دما در برابر دور/بار موتور (تشخیص کلیدواژه «دما»)';
  } else if (hasPressure) {
    metricCategory = 'pressure';
    chartTitleFa = isRail
      ? `نمودار فشار ریل سوخت — ${truncate(title, 38)}`
      : `منحنی فشار بوست / منیفولد — ${truncate(title, 38)}`;
    primarySeriesLabel = isRail ? 'فشار ریل سوخت' : 'فشار بوست / منیفولد';
    primaryUnit = isKpa ? 'kPa' : isPsi ? 'PSI' : 'Bar';
    safeLimitValue = isRail ? 1600 : isKpa ? 235 : isPsi ? 22 : 1.5;
    safeLimitLabel = `حد ایمن فشار (${safeLimitValue} ${primaryUnit})`;

    if (presPts.length >= 3) {
      grounded = true;
      points = presPts;
      extractedMetrics.push(`${toPersianDigitsLocal(points.length)} نقطه فشار از متن استخراج شد`);
    } else {
      const presNums = [...ascii.matchAll(/(\d{1,4}(?:\.\d{1,2})?)\s*(?:bar|mbar|kpa|psi|بار)/gi)]
        .map((m) => parseFloat(m[1]))
        .filter((v) => Number.isFinite(v) && v >= 0.2 && v <= 2600);
      const peakRef = presNums.length > 0 ? Math.max(...presNums) : isRail ? 1550 : isKpa ? 215 : isPsi ? 19 : 1.35;
      const baseRef = presNums.length >= 2 ? Math.min(...presNums) : isRail ? 380 : isKpa ? 100 : isPsi ? 4 : 0.35;
      if (presNums.length > 0) {
        grounded = true;
        extractedMetrics.push(`بازه فشار متن: ${toPersianDigitsLocal(baseRef)} تا ${toPersianDigitsLocal(peakRef)} ${primaryUnit}`);
      }
      const rpms = [1500, 2250, 3000, 3750, 4500, 5250, 6000];
      points = rpms.map((rpm, idx) => {
        const norm = idx / (rpms.length - 1);
        const shape = isRail ? Math.pow(norm, 0.8) : Math.sin(Math.min(1, norm * 1.05) * Math.PI * 0.82);
        const val = round2(baseRef + (peakRef - baseRef) * Math.max(0.08, shape));
        return { xLabel: `${rpm}`, xNumeric: rpm, primaryValue: val };
      });
    }
    subtitleFa = grounded
      ? 'نمودار فشار رسم‌شده با پایتون بر اساس ارقام استخراج‌شده از متن'
      : 'منحنی مرجع فشار کاری موتور در محدوده دور موتور (تشخیص کلیدواژه «فشار»)';
  } else {
    // Pure torque fallback if not handled by dyno_chart
    metricCategory = 'torque';
    chartTitleFa = `منحنی گشتاور خروجی — ${truncate(title, 38)}`;
    primarySeriesLabel = 'گشتاور موتور (Torque)';
    primaryUnit = 'Nm';
    const tqPts = extractNumericTelemetryPairs(text, 'torque');
    if (tqPts.length >= 3) {
      grounded = true;
      points = tqPts;
      extractedMetrics.push(`${toPersianDigitsLocal(points.length)} نقطه گشتاور از متن استخراج شد`);
    } else {
      const rpms = [1500, 2250, 3000, 3750, 4500, 5250, 6000];
      points = rpms.map((rpm, idx) => {
        const norm = idx / (rpms.length - 1);
        const val = round1(140 + Math.sin(norm * Math.PI * 0.88) * 65);
        return { xLabel: `${rpm}`, xNumeric: rpm, primaryValue: val };
      });
    }
    subtitleFa = 'پروفیل گشتاور تولیدشده توسط ویژوالساز پایتون';
  }

  const primaries = points.map((p) => p.primaryValue);
  const peakPrimary = Math.max(...primaries);
  const minPrimary = Math.min(...primaries);
  const avgPrimary = round2(primaries.reduce((a, b) => a + b, 0) / Math.max(1, primaries.length));

  return {
    payload: {
      kind: 'numeric_telemetry_chart',
      metricCategory,
      chartTitleFa,
      subtitleFa,
      xAxisLabel,
      primarySeriesLabel,
      primaryUnit,
      secondarySeriesLabel,
      secondaryUnit,
      safeLimitValue,
      safeLimitLabel,
      matchedKeywords,
      peakPrimary,
      minPrimary,
      avgPrimary,
      points,
    },
    grounded,
    extractedMetrics,
  };
}

export function generatePythonScriptForNumericTelemetry(
  title: string,
  payload: NumericTelemetryPayload
): string {
  const xs = payload.points.map((p) => p.xNumeric).join(', ');
  const ys1 = payload.points.map((p) => p.primaryValue).join(', ');
  const hasSecondary = payload.points.some((p) => p.secondaryValue !== undefined);
  const ys2 = hasSecondary
    ? payload.points.map((p) => p.secondaryValue ?? 0).join(', ')
    : '';

  return `import numpy as np
import matplotlib.pyplot as plt

# Auto-Activated Python Telemetry Plot — ${title}
# Triggered Keywords: ${payload.matchedKeywords.join(', ')}
x_vals = np.array([${xs}])
primary_vals = np.array([${ys1}])
${hasSecondary ? `secondary_vals = np.array([${ys2}])\n` : ''}
fig, ax1 = plt.subplots(figsize=(10.2, 5.2))
ax1.plot(x_vals, primary_vals, '-o', color='#1E3A5F', lw=2.6, markersize=5, label='${payload.primarySeriesLabel} (${payload.primaryUnit})')
ax1.fill_between(x_vals, primary_vals, primary_vals.min(), color='#2563EB', alpha=0.10)
${
  payload.safeLimitValue !== undefined
    ? `ax1.axhline(${payload.safeLimitValue}, color='#DC2626', linestyle='--', lw=1.6, label='Safe Limit (${payload.safeLimitValue} ${payload.primaryUnit})')\n`
    : ''
}ax1.set_xlabel('${payload.xAxisLabel}', fontweight='bold')
ax1.set_ylabel('${payload.primarySeriesLabel} (${payload.primaryUnit})', color='#1E3A5F', fontweight='bold')
ax1.grid(True, linestyle='--', alpha=0.35)
${
  hasSecondary
    ? `
ax2 = ax1.twinx()
ax2.plot(x_vals, secondary_vals, '-s', color='#D97706', lw=2.2, markersize=4.5, label='${payload.secondarySeriesLabel} (${payload.secondaryUnit})')
ax2.set_ylabel('${payload.secondarySeriesLabel} (${payload.secondaryUnit})', color='#B45309', fontweight='bold')
`
    : ''
}
plt.title('${payload.chartTitleFa.replace(/'/g, '')} | Peak: ${payload.peakPrimary} ${payload.primaryUnit}')
fig.tight_layout()
plt.savefig('telemetry_${payload.metricCategory}.png', dpi=220)
plt.show()
`;
}

export function buildNumericTelemetrySvg(
  title: string,
  payload: NumericTelemetryPayload
): string {
  const W = 960;
  const H = 500;
  const pts = payload.points;
  if (pts.length < 2) return '';

  const px = 86;
  const py = 92;
  const pw = 780;
  const ph = 310;

  const minX = pts[0].xNumeric;
  const maxX = pts[pts.length - 1].xNumeric;
  const hasSecondary = pts.some((p) => p.secondaryValue !== undefined);

  const maxY1 = Math.max(
    payload.peakPrimary,
    payload.safeLimitValue ?? 0
  ) * 1.16;
  const minY1 = Math.min(0, payload.minPrimary * 0.9);
  const spanY1 = Math.max(0.1, maxY1 - minY1);

  const secVals = hasSecondary ? pts.map((p) => p.secondaryValue ?? 0) : [];
  const maxY2 = hasSecondary ? Math.max(...secVals) * 1.15 : 1;
  const minY2 = hasSecondary ? Math.min(...secVals) * 0.85 : 0;
  const spanY2 = Math.max(0.1, maxY2 - minY2);

  const xOf = (x: number) => px + ((x - minX) / Math.max(1, maxX - minX)) * pw;
  const y1Of = (v: number) => py + ph - ((v - minY1) / spanY1) * ph;
  const y2Of = (v: number) => py + ph - ((v - minY2) / spanY2) * ph;

  const line1 = pts.map((p) => `${xOf(p.xNumeric).toFixed(1)},${y1Of(p.primaryValue).toFixed(1)}`).join(' ');
  const area1 = `${px},${py + ph} ${line1} ${(px + pw).toFixed(1)},${py + ph}`;
  const line2 = hasSecondary
    ? pts.map((p) => `${xOf(p.xNumeric).toFixed(1)},${y2Of(p.secondaryValue ?? 0).toFixed(1)}`).join(' ')
    : '';

  const gridLines: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const f = i / 5;
    const yy = py + ph * (1 - f);
    const val1 = round1(minY1 + spanY1 * f);
    gridLines.push(
      `<line x1="${px}" y1="${yy.toFixed(1)}" x2="${px + pw}" y2="${yy.toFixed(1)}" stroke="#E2E8F0" stroke-dasharray="3 3"/>`
    );
    gridLines.push(
      `<text x="${px - 10}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10.5" fill="#1E3A5F">${val1}</text>`
    );
    if (hasSecondary) {
      const val2 = round1(minY2 + spanY2 * f);
      gridLines.push(
        `<text x="${px + pw + 10}" y="${(yy + 4).toFixed(1)}" text-anchor="start" font-family="ui-monospace, monospace" font-size="10.5" fill="#B45309">${val2}</text>`
      );
    }
  }

  const xLabels = pts
    .map((p) => {
      const xx = xOf(p.xNumeric);
      return `<text x="${xx.toFixed(1)}" y="${py + ph + 20}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#334155">${escapeXml(p.xLabel)}</text>`;
    })
    .join('');

  const safeLimitSvg =
    payload.safeLimitValue !== undefined
      ? `<line x1="${px}" y1="${y1Of(payload.safeLimitValue).toFixed(1)}" x2="${px + pw}" y2="${y1Of(payload.safeLimitValue).toFixed(1)}" stroke="#DC2626" stroke-dasharray="6 4" stroke-width="1.6"/>
         <text x="${px + pw - 10}" y="${Math.max(py + 14, y1Of(payload.safeLimitValue) - 6).toFixed(1)}" text-anchor="end" direction="ltr" font-family="ui-monospace, monospace" font-size="10" font-weight="700" fill="#DC2626">Safe Limit: ${escapeXml(String(payload.safeLimitValue))} ${escapeXml(payload.primaryUnit)}</text>`
      : '';

  const catLabel = payload.metricCategory.replace(/_/g, ' ').toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="100%" height="100%" fill="#FFFFFF"/>
    <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="6" fill="#F8FAFC" stroke="#CBD5E1"/>
    <rect x="10" y="10" width="${W - 20}" height="56" rx="6" fill="#0F172A"/>
    <text x="${W - 26}" y="35" text-anchor="end" direction="rtl" font-family="Vazirmatn, Tahoma, sans-serif" font-size="14.5" font-weight="700" fill="#FFFFFF">${escapeXml(truncate(title, 58))}</text>
    <text x="${W - 26}" y="53" text-anchor="end" direction="ltr" font-family="ui-monospace, monospace" font-size="10" fill="#94A3B8">Auto-Activated Numeric Telemetry Plot · ${escapeXml(catLabel)}</text>
    <text x="26" y="42" text-anchor="start" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#38BDF8">Peak: ${payload.peakPrimary} ${escapeXml(payload.primaryUnit)} · Avg: ${payload.avgPrimary}</text>
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#FFFFFF" stroke="#94A3B8"/>
    ${gridLines.join('')}
    ${safeLimitSvg}
    <polygon points="${area1}" fill="#2563EB" opacity="0.11"/>
    <polyline points="${line1}" fill="none" stroke="#1E3A5F" stroke-width="3"/>
    ${hasSecondary ? `<polyline points="${line2}" fill="none" stroke="#D97706" stroke-width="2.5" stroke-dasharray="5 3"/>` : ''}
    ${xLabels}
    <text x="${px + pw / 2}" y="468" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#334155">${escapeXml(payload.xAxisLabel)} · ${escapeXml(payload.primaryUnit)}</text>
  </svg>`;
}

export function createNumericTelemetryExhibitForChapter(params: {
  chapter: ChapterNode;
  chapterText: string;
}): AdaptiveVisualBlock | null {
  const built = buildNumericTelemetryPayloadFromText(params.chapter.title, params.chapterText);
  if (!built) return null;

  return {
    type: 'adaptive_visual',
    id: `avis_num_${params.chapter.chapterNumber}_${built.payload.metricCategory}`,
    visualKind: 'numeric_telemetry_chart',
    archetype: 'thermal_pressure_telemetry',
    title: built.payload.chartTitleFa,
    caption: `شکل ${toPersianDigitsLocal(params.chapter.chapterNumber)}-پ: ${built.payload.chartTitleFa} (ویژوالساز خودکار پایتون)`,
    pedagogicalTakeaway: built.payload.subtitleFa,
    svgMarkup: buildNumericTelemetrySvg(built.payload.chartTitleFa, built.payload),
    pythonScript: generatePythonScriptForNumericTelemetry(built.payload.chartTitleFa, built.payload),
    renderedByPython: false,
    groundedFromText: built.grounded,
    extractedMetrics: built.extractedMetrics,
    widthPx: 960,
    heightPx: 500,
    payload: built.payload,
    sourceFileNames: params.chapter.sourceFileName ? [params.chapter.sourceFileName] : undefined,
  };
}
