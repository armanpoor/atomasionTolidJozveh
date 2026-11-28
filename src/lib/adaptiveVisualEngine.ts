import type {
  AdaptiveProjectChange,
  AdaptiveProjectProfile,
  AdaptiveVisualBlock,
  AdaptiveVisualKind,
  AdaptiveVisualPayload,
  AfrIgnitionPayload,
  ChapterNode,
  ContentArchetypeId,
  ContentBlock,
  DetectedArchetypeScore,
  DiagnosticWaveformPayload,
  DocxExportConfig,
  DynoDataPoint,
  DynoVisualPayload,
  EcuPinoutPayload,
  EcuPinSpec,
  ParsedBook,
  WinolsHeatmapPayload,
} from './bookTypes.ts';
import { toAsciiDigits, toPersianDigits } from './formatParsers.ts';
import {
  analyzeUploadedFilesForPythonCharts,
  buildNumericTelemetrySvg,
  createNumericTelemetryExhibitForChapter,
  generatePythonScriptForNumericTelemetry,
} from './numericChartAnalyzer.ts';

const EXHIBIT_WIDTH = 960;
const EXHIBIT_HEIGHT = 500;

interface ArchetypeRule {
  id: ContentArchetypeId;
  labelFa: string;
  visualStylePreset: AdaptiveProjectProfile['visualStylePreset'];
  visualStyleLabelFa: string;
  recommendedVisualFa: string;
  visualModule?: AdaptiveVisualKind;
  pythonRecommended: boolean;
  patterns: Array<{ label: string; regex: RegExp; weight: number }>;
}

const ARCHETYPE_RULES: ArchetypeRule[] = [
  {
    id: 'dyno_graph_reading',
    labelFa: 'آموزش داینو و گراف‌خوانی',
    visualStylePreset: 'dyno_telemetry',
    visualStyleLabelFa: 'تله‌متری داینو و نمودارهای پایتون',
    recommendedVisualFa: 'منحنی توان/گشتاور داینو (پایتون + تعاملی) و گراف AFR/بوست',
    visualModule: 'dyno_chart',
    pythonRecommended: true,
    patterns: [
      { label: 'داینو / Dyno', regex: /\bdyno\b|داینو|داینامومتر|دینامومتر/gi, weight: 5 },
      { label: 'گراف‌خوانی / منحنی توان', regex: /گراف[\s‌]?خوانی|گراف\s+داینو|منحنی\s+(?:توان|گشتاور)|dyno\s*(?:graph|chart|sheet|pull)/gi, weight: 6 },
      { label: 'توان (HP/WHP/kW)', regex: /\b(?:whp|bhp|hp|ps)\b|اسب[\s‌]?بخار|توان\s+موتور|افت\s+توان/gi, weight: 3 },
      { label: 'گشتاور (Nm/Torque)', regex: /\b(?:torque|nm|lb-?ft)\b|گشتاور|نیوتن[\s‌]?متر/gi, weight: 3 },
      { label: 'نقطه تقاطع ۵۲۵۲ / دور موتور', regex: /5252|۵۲۵۲|7127|۷۱۲۷|دیتا[\s‌]?لاگ|datalog|لاگ[\s‌]?گیری/gi, weight: 4 },
      { label: 'استیج / فابریک در مقابل ریمپ', regex: /\bstage\s*[123]\b|استیج\s*[۱۲۳123]|قبل\s+و\s+بعد\s+ریمپ|فابریک\s+و\s+ریمپ/gi, weight: 3 },
    ],
  },
  {
    id: 'winols_hex_maps',
    labelFa: 'جداول، مپ‌ها و آدرس‌دهی WinOLS',
    visualStylePreset: 'winols_precision',
    visualStyleLabelFa: 'ماتریس حرارتی و نمای ۲بعدی/۳بعدی WinOLS',
    recommendedVisualFa: 'ماتریس حرارتی RPM×Load، سطح ۳بعدی و مقایسه Delta در WinOLS',
    visualModule: 'winols_heatmap',
    pythonRecommended: true,
    patterns: [
      { label: 'WinOLS / وینولز', regex: /\bwinols\b|وینولز|داموس|\bdamos\b|\.kp\b|\.a2l\b/gi, weight: 5 },
      { label: 'آدرس هگز / دامپ', regex: /\b0x[0-9a-f]{4,6}\b|آدرس\s+هگز|هگز\s+دامپ|\bhexdump\b|16\s*bit|hilo|lohi/gi, weight: 4 },
      { label: 'نقشه‌های استاندارد ECU', regex: /\b(?:kfzw|kfzw2|kfmiop|kfmirl|lamfa|ldrxn|kflbts|kfdhbn|kfped|kflf|iq|soi|rail)\b/gi, weight: 5 },
      { label: 'فکتور / آفست / چکسام', regex: /فکتور|\bfactor\b|آفست|\boffset\b|چکسام|\bchecksum\b|نمای\s*(?:2d|3d|۲بعدی|۳بعدی)/gi, weight: 3.5 },
      { label: 'جداول مپ RPM×Load', regex: /جدول\s+(?:مپ|جرقه|سوخت|گشتاور)|نقشه\s+(?:جرقه|سوخت|پدال|توربو|بار)/gi, weight: 3 },
    ],
  },
  {
    id: 'ecu_pinout_harness',
    labelFa: 'پین‌اوت، سیم‌کشی و سخت‌افزار ECU',
    visualStylePreset: 'ecu_schematic',
    visualStyleLabelFa: 'شماتیک پین‌اوت و نقشه سوکت ECU',
    recommendedVisualFa: 'نقشه تعاملی سوکت و پایه‌های ECU با تفکیک خطوط تغذیه/CAN/سنسور',
    visualModule: 'ecu_pinout',
    pythonRecommended: false,
    patterns: [
      { label: 'پین‌اوت / سوکت', regex: /\bpinout\b|پین[\s‌]?اوت|شماره\s+پایه|پایه\s+سوکت|کانکتور|\bconnector\b/gi, weight: 5 },
      { label: 'سیم‌کشی / دسته سیم', regex: /سیم[\s‌]?کشی|دسته[\s‌]?سیم|\bharness\b|نقشه\s+مدار|شماتیک/gi, weight: 4 },
      { label: 'شبکه CAN / K-Line / Boot', regex: /\bcan-?[hl]\b|\bk-?line\b|\bboot\s*pin\b|پین\s+بوت|\bjtag\b|\bbdm\b|مقاومت\s+بوت/gi, weight: 4 },
      { label: 'خطوط تغذیه و پایه برد', regex: /\+12v|12\s*ولت|بدنه\s+ایسیو|\bgnd\b|آی‌سی\s+تغذیه|برد\s+ایسیو|\bpcb\b/gi, weight: 2.5 },
    ],
  },
  {
    id: 'diagnostics_dtc_waveform',
    labelFa: 'عیب‌یابی، کد خطا (DTC) و اسیلوسکوپ',
    visualStylePreset: 'diagnostic_lab',
    visualStyleLabelFa: 'آزمایشگاه عیب‌یابی، موج سنسور و DTC',
    recommendedVisualFa: 'مقایسه شکل‌موج سالم/معیوب اسیلوسکوپ و درخت عیب‌یابی DTC',
    visualModule: 'diagnostic_waveform',
    pythonRecommended: true,
    patterns: [
      { label: 'کد خطا (DTC / P0xxx)', regex: /\b[pbc u]0[0-9]{3}\b|\bdtc\b|کد\s+خطا|خطای\s+سنسور/gi, weight: 5 },
      { label: 'اسیلوسکوپ / شکل موج', regex: /اسیلوسکوپ|\boscilloscope\b|شکل[\s‌]?موج|\bwaveform\b|پالس\s+سنسور|سیگنال\s+میل[\s‌]?لنگ/gi, weight: 5 },
      { label: 'عیب‌یابی / دیاگ', regex: /عیب[\s‌]?یابی|دیاگ|\bobd\b|تست\s+سنسور|میس[\s‌]?فایر|\bmisfire\b|دور\s+آرام/gi, weight: 3 },
      { label: 'ولتاژ و خطای پارامتر', regex: /میلی[\s‌]?ولت|\bmv\b|ولتاژ\s+مرجع|مدار\s+باز|اتصال\s+کوتاه|short\s+to/gi, weight: 2.5 },
    ],
  },
  {
    id: 'combustion_afr_ignition',
    labelFa: 'مبانی احتراق، نسبت سوخت/هوا (AFR) و آوانس جرقه',
    visualStylePreset: 'combustion_physics',
    visualStyleLabelFa: 'آزمایشگاه احتراق، لامبدا و آوانس جرقه',
    recommendedVisualFa: 'طیف AFR/لامبدا و منحنی آوانس MBT در برابر مرز ناک',
    visualModule: 'afr_ignition_curve',
    pythonRecommended: true,
    patterns: [
      { label: 'AFR / لامبدا / استوکیومتری', regex: /\bafr\b|\blambda\b|لامبدا|استوکیومتری|14\.7|۱۴\.۷|نسبت\s+سوخت\s+به\s+هوا/gi, weight: 5 },
      { label: 'آوانس جرقه / MBT / ناک', regex: /آوانس|اوانس|\bignition\s*advance\b|\bmbt\b|ناک|\bknock\b|کوبش|ریتارد|\bretard\b/gi, weight: 4.5 },
      { label: 'مخلوط غنی/فقیر و EGT', regex: /مخلوط\s+(?:غنی|فقیر)|دمای\s+اگزوز|\begt\b|اکتان|وایدبند|\bwideband\b/gi, weight: 3.5 },
    ],
  },
  {
    id: 'thermal_pressure_telemetry',
    labelFa: 'تله‌متری عددی دما، فشار و پارامترهای سنسور',
    visualStylePreset: 'dyno_telemetry',
    visualStyleLabelFa: 'ویژوالساز پایتون دما، فشار و داده‌های عددی',
    recommendedVisualFa: 'نمودار تحلیلی پایتون (دما °C / فشار Bar-kPa-PSI / آستانه ایمن)',
    visualModule: 'numeric_telemetry_chart',
    pythonRecommended: true,
    patterns: [
      { label: 'دما / سانتی‌گراد (°C / EGT / IAT)', regex: /دما(?:ی)?|سانتی[\s‌]?گراد|°\s*c\b|\begt\b|\biat\b|\bect\b|\btemp(?:erature)?\b/gi, weight: 4.5 },
      { label: 'فشار / بوست (Bar / kPa / PSI / ریل)', regex: /فشار(?:\s*(?:توربو|بوست|ریل|منیفولد|روغن|سوخت))?|\bboost\b|بوست|\bbar\b|\bmbar\b|\bkpa\b|\bpsi\b/gi, weight: 4.5 },
      { label: 'سری عددی و نمودار (نمودار / گراف / RPM)', regex: /نمودار|گراف|منحنی|دیتا[\s‌]?لاگ|\bdatalog\b|\brpm\b/gi, weight: 2.5 },
    ],
  },
];

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'paragraph':
        case 'subheading':
          return b.text;
        case 'list':
          return b.items.join('\n');
        case 'callout':
          return `${b.title}\n${b.paragraphs.join('\n')}`;
        case 'table':
          return `${b.caption || ''}\n${b.headers.join(' ')}\n${b.rows.map((r) => r.join(' ')).join('\n')}`;
        case 'equation':
          return `${b.readable} ${b.latex}`;
        case 'figure':
          return `${b.caption} ${b.description}`;
        case 'web_enrichment':
          return `${b.title} ${b.summary}`;
        case 'conflict_note':
          return `${b.topic} ${b.excerptA} ${b.excerptB}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

// ============================================================================
// 1. CONTENT NATURE ANALYZER & PROJECT SELF-ADAPTATION PLANNER
// ============================================================================

export function analyzeContentNatureForProject(params: {
  texts: string[];
  fileNames?: string[];
  fileCount?: number;
  unitCount?: number;
  existingChanges?: AdaptiveProjectChange[];
}): AdaptiveProjectProfile {
  const combined = toAsciiDigits(
    [...(params.fileNames || []), ...params.texts].join('\n')
  );
  const nowIso = new Date().toISOString();

  const scored: Array<DetectedArchetypeScore & { rule: ArchetypeRule }> = [];
  for (const rule of ARCHETYPE_RULES) {
    let score = 0;
    const matchedTerms: string[] = [];
    for (const pat of rule.patterns) {
      const matches = combined.match(pat.regex);
      if (matches && matches.length > 0) {
        // Diminishing returns so one repeated term doesn't drown out genuine multi-signal matches
        const capped = Math.min(matches.length, 14);
        score += pat.weight * (1 + Math.log2(capped));
        matchedTerms.push(pat.label);
      }
    }
    if (score > 0) {
      scored.push({
        id: rule.id,
        labelFa: rule.labelFa,
        score: round1(score),
        sharePercent: 0,
        matchedTerms: matchedTerms.slice(0, 5),
        recommendedVisualFa: rule.recommendedVisualFa,
        rule,
      });
    }
  }

  const numericChartReport = analyzeUploadedFilesForPythonCharts(
    params.texts.map((text, idx) => ({
      fileName: params.fileNames?.[idx] || `فایل_${idx + 1}.txt`,
      text,
    }))
  );

  scored.sort((a, b) => b.score - a.score);
  const totalScore = scored.reduce((s, item) => s + item.score, 0);

  if (scored.length === 0 || totalScore < 4) {
    return {
      dominantArchetype: numericChartReport.shouldActivatePythonVisualizer
        ? 'thermal_pressure_telemetry'
        : 'general_technical_pedagogy',
      dominantLabelFa: numericChartReport.shouldActivatePythonVisualizer
        ? 'تله‌متری عددی دما، فشار و پارامترهای فنی'
        : 'آموزش فنی و مهندسی ساختاریافته',
      visualStylePreset: numericChartReport.shouldActivatePythonVisualizer
        ? 'dyno_telemetry'
        : 'editorial_classic',
      visualStyleLabelFa: numericChartReport.shouldActivatePythonVisualizer
        ? 'ویژوالساز پایتون داده‌های عددی'
        : 'صفحه‌آرایی مهندسی استاندارد',
      archetypes: [
        {
          id: numericChartReport.shouldActivatePythonVisualizer
            ? 'thermal_pressure_telemetry'
            : 'general_technical_pedagogy',
          labelFa: numericChartReport.shouldActivatePythonVisualizer
            ? 'تله‌متری عددی دما، فشار و پارامترهای فنی'
            : 'آموزش فنی و مهندسی ساختاریافته',
          score: 1,
          sharePercent: 100,
          matchedTerms: numericChartReport.shouldActivatePythonVisualizer
            ? numericChartReport.keywordHits.map((h) => h.keywordToken)
            : ['متن آموزشی استاندارد'],
          recommendedVisualFa: numericChartReport.shouldActivatePythonVisualizer
            ? 'نمودار خودکار پایتون برای داده‌های عددی (دما، فشار، گشتاور)'
            : 'جداول مقایسه‌ای و نمودارهای ساختاری',
        },
      ],
      autoAppliedChanges: params.existingChanges || [],
      recommendedVisualModules: numericChartReport.recommendedVisualKinds,
      pythonChartingRecommended: numericChartReport.shouldActivatePythonVisualizer,
      numericChartReport,
      analyzedFileCount: params.fileCount ?? params.fileNames?.length ?? 0,
      analyzedUnitCount: params.unitCount ?? params.texts.length,
      summaryFa: numericChartReport.shouldActivatePythonVisualizer
        ? numericChartReport.summaryFa
        : 'ماهیت متن به‌عنوان محتوای آموزشی استاندارد تشخیص داده شد و قالب استاندارد فنی حفظ گردید.',
      analyzedAt: nowIso,
    };
  }

  const archetypes: DetectedArchetypeScore[] = scored.slice(0, 4).map((item) => ({
    id: item.id,
    labelFa: item.labelFa,
    score: item.score,
    sharePercent: Math.max(5, Math.round((item.score / totalScore) * 100)),
    matchedTerms: item.matchedTerms,
    recommendedVisualFa: item.recommendedVisualFa,
  }));

  // Normalize percentages so top detected sum to ~100
  const sumPct = archetypes.reduce((s, a) => s + a.sharePercent, 0);
  if (sumPct > 0 && archetypes.length > 0) {
    archetypes[0].sharePercent = Math.max(
      10,
      archetypes[0].sharePercent + (100 - sumPct)
    );
  }

  const dominant = scored[0];
  const recommendedVisualModules: AdaptiveVisualKind[] = [];
  for (const item of scored) {
    if (item.rule.visualModule && (item.score >= dominant.score * 0.28 || item.score >= 8)) {
      if (!recommendedVisualModules.includes(item.rule.visualModule)) {
        recommendedVisualModules.push(item.rule.visualModule);
      }
    }
  }
  for (const rec of numericChartReport.recommendedVisualKinds) {
    if (!recommendedVisualModules.includes(rec)) {
      recommendedVisualModules.push(rec);
    }
  }

  const pythonChartingRecommended =
    numericChartReport.shouldActivatePythonVisualizer ||
    scored.some((s) => s.rule.pythonRecommended && s.score >= dominant.score * 0.35);

  const secondaryNote =
    archetypes.length > 1
      ? ` همراه با محور مکمل «${archetypes[1].labelFa}» (${toPersianDigits(archetypes[1].sharePercent)}٪)`
      : '';

  return {
    dominantArchetype: dominant.id,
    dominantLabelFa: dominant.labelFa,
    visualStylePreset: dominant.rule.visualStylePreset,
    visualStyleLabelFa: dominant.rule.visualStyleLabelFa,
    archetypes,
    autoAppliedChanges: params.existingChanges || [],
    recommendedVisualModules,
    pythonChartingRecommended,
    numericChartReport,
    analyzedFileCount: params.fileCount ?? params.fileNames?.length ?? 0,
    analyzedUnitCount: params.unitCount ?? params.texts.length,
    summaryFa: `ماهیت اصلی فایل‌های پروژه «${dominant.labelFa}» (${toPersianDigits(archetypes[0].sharePercent)}٪)${secondaryNote} تشخیص داده شد.`,
    analyzedAt: nowIso,
  };
}

/**
 * Automatically evolves the project's settings based on the detected nature of uploaded files
 * so the studio adapts its visual modules, appendices, and Python charting automatically.
 */
export function applyAdaptiveProjectSettings(
  currentSettings: Partial<DocxExportConfig> | Record<string, unknown>,
  profile: AdaptiveProjectProfile
): {
  nextSettings: Record<string, unknown>;
  updatedProfile: AdaptiveProjectProfile;
  changes: AdaptiveProjectChange[];
} {
  const nowIso = new Date().toISOString();
  const next: Record<string, unknown> = { ...(currentSettings || {}) };
  const changes: AdaptiveProjectChange[] = [];

  const hasWinolsSignal = profile.archetypes.some(
    (a) => a.id === 'winols_hex_maps' && a.sharePercent >= 18
  );
  const hasDynoSignal = profile.archetypes.some(
    (a) => a.id === 'dyno_graph_reading' && a.sharePercent >= 20
  );
  const hasPinoutSignal = profile.archetypes.some(
    (a) => a.id === 'ecu_pinout_harness' && a.sharePercent >= 20
  );
  const hasDiagSignal = profile.archetypes.some(
    (a) => a.id === 'diagnostics_dtc_waveform' && a.sharePercent >= 20
  );
  const hasAfrSignal = profile.archetypes.some(
    (a) => a.id === 'combustion_afr_ignition' && a.sharePercent >= 20
  );

  // 1. Always enable adaptive visuals when specialized content is detected
  if (profile.recommendedVisualModules.length > 0) {
    next.adaptiveVisualsEnabled = true;
    const prevOpt =
      next.optimization && typeof next.optimization === 'object'
        ? (next.optimization as Record<string, unknown>)
        : {};
    next.optimization = {
      ...prevOpt,
      embedGeneratedTablesAndDiagrams: true,
      generateVisualSuggestions: true,
    };
    changes.push({
      field: 'adaptiveVisualsEnabled',
      labelFa: `فعال‌سازی ماژول بصری «${profile.visualStyleLabelFa}»`,
      detailFa: `${toPersianDigits(profile.recommendedVisualModules.length)} نوع نمایشگر خلاقانه اختصاصی بر اساس ماهیت فایل‌ها فعال شد.`,
      appliedAt: nowIso,
    });
  }

  // 2. Python charting engine activation for dyno / telemetry / combustion / maps
  if (profile.pythonChartingRecommended) {
    changes.push({
      field: 'pythonChartEngine',
      labelFa: 'فعال‌سازی موتور رسم نمودار پایتون (Python 3 + Matplotlib)',
      detailFa: hasDynoSignal
        ? 'برای فصل‌های داینو و گراف‌خوانی، منحنی توان/گشتاور، نقطه تقاطع و کد پایتون Matplotlib به‌طور خودکار تولید می‌شود.'
        : 'نمودارهای تحلیلی مهندسی و اسکریپت Matplotlib متناسب با داده‌های فایل تولید می‌شوند.',
      appliedAt: nowIso,
    });
  }

  // 3. Dynamically adapt WinOLS Action Tables appendix so non-WinOLS projects aren't rigid
  const prevWinolsTables = next.includeWinolsActionTables;
  if (hasWinolsSignal && prevWinolsTables !== true) {
    next.includeWinolsActionTables = true;
    changes.push({
      field: 'includeWinolsActionTables',
      labelFa: 'فعال‌سازی پیوست جداول عملیاتی و ماتریس حرارتی WinOLS',
      detailFa: 'به‌دلیل تشخیص مپ‌ها و آدرس‌های WinOLS در فایل‌های ورودی، پیوست راهنمای WinOLS و ماتریس ۲بعدی/۳بعدی فعال شد.',
      appliedAt: nowIso,
    });
  } else if (
    !hasWinolsSignal &&
    (hasDynoSignal || hasDiagSignal || hasPinoutSignal) &&
    prevWinolsTables !== false
  ) {
    next.includeWinolsActionTables = false;
    changes.push({
      field: 'includeWinolsActionTables',
      labelFa: 'تنظیم هوشمند پیوست‌ها (غیرفعال‌سازی پیوست غیرمرتبط WinOLS)',
      detailFa: 'چون فایل‌های این پروژه بیشتر بر داینو/عیب‌یابی/پین‌اوت متمرکزند، پیوست ثابت WinOLS خاموش شد تا خروجی متناسب با موضوع باشد.',
      appliedAt: nowIso,
    });
  }

  // 4. Adapt validation domain & master cheatsheet
  if (hasWinolsSignal || hasDynoSignal || hasPinoutSignal || hasDiagSignal || hasAfrSignal) {
    if (next.validationDomain !== 'ecu_winols') {
      next.validationDomain = 'ecu_winols';
      changes.push({
        field: 'validationDomain',
        labelFa: 'تنظیم دامنه اعتبارسنجی فنی روی مهندسی خودرو و ECU',
        detailFa: 'اصطلاحات فنی، کدهای DTC، آدرس‌های هگز و واحدهای داینو (HP/Nm/AFR) محافظت می‌شوند.',
        appliedAt: nowIso,
      });
    }
    if (next.includeMasterCheatSheet !== true) {
      next.includeMasterCheatSheet = true;
    }
  }

  // 5. Adapt output tone gently if still at default and strong academic/dyno physics detected
  if (
    (!next.outputTone || next.outputTone === 'workshop_practical') &&
    (profile.dominantArchetype === 'dyno_graph_reading' ||
      profile.dominantArchetype === 'combustion_afr_ignition')
  ) {
    changes.push({
      field: 'visualStylePreset',
      labelFa: `بروزرسانی هویت بصری پروژه به «${profile.visualStyleLabelFa}»`,
      detailFa: 'کارت‌های تحلیلی، محورهای دقیق مهندسی و راهنمای خواندن گراف در پیش‌نمایش و خروجی ورد اعمال شدند.',
      appliedAt: nowIso,
    });
  }

  const updatedProfile: AdaptiveProjectProfile = {
    ...profile,
    autoAppliedChanges: changes,
  };
  next.adaptiveVisualProfile = updatedProfile;

  return {
    nextSettings: next,
    updatedProfile,
    changes,
  };
}

// ============================================================================
// 2. GROUNDED PAYLOAD EXTRACTORS & PYTHON MATPLOTLIB SCRIPT GENERATORS
// ============================================================================

function buildDynoPayloadFromText(title: string, text: string): {
  payload: DynoVisualPayload;
  grounded: boolean;
  extractedMetrics: string[];
} {
  const ascii = toAsciiDigits(text);
  const metrics: string[] = [];

  // Extract peak HP mentions (realistic range 55 - 950 HP)
  const hpMatches = [...ascii.matchAll(/(\d{2,3}(?:\.\d)?)\s*(?:whp|bhp|hp|ps|اسب[\s‌]?بخار)/gi)]
    .map((m) => parseFloat(m[1]))
    .filter((v) => Number.isFinite(v) && v >= 55 && v <= 950);

  // Extract peak Torque Nm mentions (realistic range 80 - 1100 Nm)
  const nmMatches = [...ascii.matchAll(/(\d{2,4}(?:\.\d)?)\s*(?:nm|n\.m|نیوتن[\s‌]?متر)/gi)]
    .map((m) => parseFloat(m[1]))
    .filter((v) => Number.isFinite(v) && v >= 80 && v <= 1100);

  // Extract RPM redline / range mentions
  const rpmMatches = [...ascii.matchAll(/(\d{4})\s*(?:rpm|دور)/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((v) => Number.isFinite(v) && v >= 4500 && v <= 8500);

  // Extract AFR mentions
  const afrMatches = [...ascii.matchAll(/(?:afr|نسبت\s+سوخت)[^\d]{0,12}(\d{2}\.\d)/gi)]
    .map((m) => parseFloat(m[1]))
    .filter((v) => Number.isFinite(v) && v >= 10.5 && v <= 16.2);

  // Extract gain % mentions
  const gainMatch = ascii.match(/(?:\+|افزایش|رشد)[^\d]{0,8}(\d{1,2})\s*(?:%|درصد)/i);
  const parsedGainPct = gainMatch ? clamp(parseInt(gainMatch[1], 10), 6, 38) : null;

  let stockPeakNm = 165;
  let tunedPeakNm = 192;
  let grounded = false;

  if (nmMatches.length >= 2) {
    const sorted = [...nmMatches].sort((a, b) => a - b);
    stockPeakNm = sorted[0];
    tunedPeakNm = sorted[sorted.length - 1] > stockPeakNm * 1.03 ? sorted[sorted.length - 1] : round1(stockPeakNm * 1.15);
    grounded = true;
    metrics.push(`گشتاور استخراج‌شده: ${toPersianDigits(stockPeakNm)} → ${toPersianDigits(tunedPeakNm)} Nm`);
  } else if (nmMatches.length === 1) {
    stockPeakNm = nmMatches[0];
    tunedPeakNm = round1(stockPeakNm * (1 + (parsedGainPct ?? 14) / 100));
    grounded = true;
    metrics.push(`گشتاور مرجع متن: ${toPersianDigits(stockPeakNm)} Nm`);
  } else if (hpMatches.length >= 1) {
    const sortedHp = [...hpMatches].sort((a, b) => a - b);
    const targetStockHp = sortedHp[0];
    // Derive realistic Nm from HP around 5600 RPM: Nm = HP * 7127 / 5600 * 1.12
    stockPeakNm = round1((targetStockHp * 7127) / 5200);
    const targetTunedHp =
      sortedHp.length >= 2 && sortedHp[sortedHp.length - 1] > targetStockHp * 1.03
        ? sortedHp[sortedHp.length - 1]
        : round1(targetStockHp * (1 + (parsedGainPct ?? 14) / 100));
    tunedPeakNm = round1(stockPeakNm * (targetTunedHp / targetStockHp));
    grounded = true;
    metrics.push(`توان استخراج‌شده از متن: ${toPersianDigits(targetStockHp)} → ${toPersianDigits(targetTunedHp)} HP`);
  }

  const maxRpm = rpmMatches.length > 0 ? clamp(Math.max(...rpmMatches), 5500, 7500) : 6500;
  if (rpmMatches.length > 0) {
    metrics.push(`محدوده دور موتور: تا ${toPersianDigits(maxRpm)} RPM`);
  }
  const targetWotAfr = afrMatches.length > 0 ? clamp(Math.min(...afrMatches), 11.4, 13.4) : 12.6;
  if (afrMatches.length > 0) {
    metrics.push(`AFR هدف متن: ${toPersianDigits(targetWotAfr)}:1`);
  }

  const isTurbo = /توربو|turbo|boost|بوست|tfsi|tsi|ef7\s*tc|tc7/i.test(text);
  const stageLabel = /stage\s*2|استیج\s*[۲2]/i.test(text)
    ? 'Stage 2 Remap'
    : /stage\s*1|استیج\s*[۱1]/i.test(text)
      ? 'Stage 1 Remap'
      : 'ریمپ بهینه‌شده';

  // Generate physically accurate torque & horsepower curve points (HP = Nm * RPM / 7127)
  const step = 500;
  const points: DynoDataPoint[] = [];
  for (let rpm = 1500; rpm <= maxRpm; rpm += step) {
    const norm = (rpm - 1500) / Math.max(1, maxRpm - 1500); // 0..1
    // Smooth volumetric efficiency torque envelope
    const peakPos = isTurbo ? 0.36 : 0.52;
    const width = isTurbo ? 0.44 : 0.38;
    const bell = Math.exp(-Math.pow((norm - peakPos) / width, 2));
    const lowEndFactor = 0.62 + 0.38 * bell;
    const highEndRollOff = norm > 0.75 ? 1 - (norm - 0.75) * 0.42 : 1;

    const stockTorqueNm = round1(stockPeakNm * lowEndFactor * highEndRollOff);
    // Remap adds strongest midrange + top-end breathing
    const remapGainProfile =
      (tunedPeakNm / Math.max(1, stockPeakNm) - 1) *
      (0.55 + 0.45 * Math.sin(clamp(norm * Math.PI * 0.92, 0.2, Math.PI - 0.15)));
    const tunedTorqueNm = round1(stockTorqueNm * (1 + Math.max(0.03, remapGainProfile)));

    const stockHp = round1((stockTorqueNm * rpm) / 7127);
    const tunedHp = round1((tunedTorqueNm * rpm) / 7127);

    const stockAfr = round2(14.5 - norm * 1.4 + (norm > 0.7 ? -0.35 : 0));
    const tunedAfr = round2(
      14.3 - norm * (14.3 - targetWotAfr) + (norm > 0.8 ? -0.15 : 0)
    );
    const boostBar = isTurbo
      ? round2(0.25 + 0.95 * Math.sin(clamp(norm * Math.PI * 0.85, 0.1, Math.PI * 0.85)))
      : undefined;

    points.push({
      rpm,
      stockHp,
      tunedHp,
      stockTorqueNm,
      tunedTorqueNm,
      stockAfr,
      tunedAfr,
      boostBar,
    });
  }

  // Calibrate peaks accurately
  const peakStockHp = Math.max(...points.map((p) => p.stockHp));
  const peakTunedHp = Math.max(...points.map((p) => p.tunedHp));
  const peakStockTorqueNm = Math.max(...points.map((p) => p.stockTorqueNm));
  const peakTunedTorqueNm = Math.max(...points.map((p) => p.tunedTorqueNm));

  const peakTunedTqPt = points.reduce((best, p) => (p.tunedTorqueNm > best.tunedTorqueNm ? p : best), points[0]);
  const peakTunedHpPt = points.reduce((best, p) => (p.tunedHp > best.tunedHp ? p : best), points[0]);

  const annotations: DynoVisualPayload['annotations'] = [
    {
      rpm: peakTunedTqPt.rpm,
      label: `اوج گشتاور: ${toPersianDigits(peakTunedTqPt.tunedTorqueNm)} Nm`,
      tone: 'nominal',
    },
    {
      rpm: peakTunedHpPt.rpm,
      label: `اوج توان: ${toPersianDigits(peakTunedHpPt.tunedHp)} HP (+${toPersianDigits(round1(peakTunedHp - peakStockHp))})`,
      tone: 'gain',
    },
  ];
  if (maxRpm >= 5500) {
    annotations.push({
      rpm: 5250,
      label: 'ناحیه تقاطع ریاضی توان/گشتاور (5252 lb·ft)',
      tone: 'caution',
    });
  }

  return {
    payload: {
      kind: 'dyno_chart',
      subtitle: grounded
        ? `بازسازی فیزیکی نمودار داینو بر اساس ارقام استخراج‌شده از فصل «${truncateText(title, 34)}»`
        : `مدل آموزشی استاندارد گراف‌خوانی داینو (${isTurbo ? 'توربوشارژ' : 'تنفس طبیعی'}) — رابطه HP = (Nm × RPM) / 7127`,
      stageLabel,
      peakStockHp,
      peakTunedHp,
      peakStockTorqueNm,
      peakTunedTorqueNm,
      crossoverRpm: 5252,
      annotations,
      points,
    },
    grounded,
    extractedMetrics: metrics,
  };
}

function buildWinolsHeatmapFromText(title: string, text: string): {
  payload: WinolsHeatmapPayload;
  grounded: boolean;
  extractedMetrics: string[];
} {
  const ascii = toAsciiDigits(text);
  const metrics: string[] = [];

  const mapCodeMatch = ascii.match(/\b(KFZW2?|KFMIOP|KFMIRL|LAMFA|LDRXN|KFLBTS|KFPED|KFLF|SOI|RAIL)\b/i);
  const hexMatch = ascii.match(/\b(0x[0-9a-f]{4,6})\b/i);
  const deltaMatch = ascii.match(/([+-]?\d+(?:\.\d)?)\s*(?:%|درصد|درجه|°)/);

  const mapCode = mapCodeMatch ? mapCodeMatch[1].toUpperCase() : 'KFZW';
  const hexAddress = hexMatch ? hexMatch[1].toUpperCase() : '0x1C200';
  const isFuelMap = /LAMFA|KFLBTS|KFLF|سوخت|پاشش|afr/i.test(`${mapCode} ${text}`);
  const isBoostMap = /LDRXN|توربو|بوست|boost/i.test(`${mapCode} ${text}`);
  const isTorqueMap = /KFMIOP|KFMIRL|KFPED|گشتاور|پدال/i.test(`${mapCode} ${text}`);

  const grounded = Boolean(mapCodeMatch || hexMatch || deltaMatch);
  if (mapCodeMatch) metrics.push(`شناسه مپ: ${mapCode}`);
  if (hexMatch) metrics.push(`آدرس هگز: ${hexAddress}`);

  const rpmAxis = [1500, 2250, 3000, 3750, 4500, 5250, 6000];
  const loadAxis = [25, 45, 65, 80, 95, 100];

  let mapNameFa = 'نقشه آوانس جرقه پایه (Ignition Advance)';
  let unit = '° BTDC';
  let factorOffset = 'Factor: 0.75 | Offset: 0 | 8-bit';
  let dataFormat = '8-bit LoHi (WinOLS 2.24)';
  let highlightZoneLabel = 'ناحیه هدف ریمپ: بار ۶۵٪ تا ۱۰۰٪ و دور ۲۵۰۰ تا ۵۵۰۰ RPM';

  if (isFuelMap) {
    mapNameFa = 'نقشه نسبت سوخت هدف (Target Lambda / Fueling)';
    unit = 'λ';
    factorOffset = 'Factor: 0.007813 | Offset: 0 | 8-bit';
    dataFormat = '8-bit Decimal (WinOLS 2.24)';
    highlightZoneLabel = 'ناحیه غنی‌سازی تمام‌گاز (WOT): بار ۸۰٪ تا ۱۰۰٪ (λ ≈ 0.84–0.86)';
  } else if (isBoostMap) {
    mapNameFa = 'نقشه محدودکننده بار و فشار توربو (Load / Boost Limiter)';
    unit = '% Load';
    factorOffset = 'Factor: 0.023438 | Offset: 0 | 16-bit';
    dataFormat = '16-bit HiLo (WinOLS 2.24)';
    highlightZoneLabel = 'ناحیه افزایش ایمن بوست: دور ۲۲۵۰ تا ۵۲۵۰ RPM (+۸٪ تا +۱۴٪)';
  } else if (isTorqueMap) {
    mapNameFa = 'نقشه درخواست گشتاور و پاسخ پدال (Torque / Pedal Map)';
    unit = '% Trq';
    factorOffset = 'Factor: 0.003052 | Offset: 0 | 16-bit';
    dataFormat = '16-bit LoHi (WinOLS 2.24)';
    highlightZoneLabel = 'بهبود خطی‌سازی پدال در بار ۴۵٪ تا ۹۵٪ برای شتاب‌گیری نرم';
  }

  const stockMatrix: number[][] = [];
  const tunedMatrix: number[][] = [];

  for (let r = 0; r < loadAxis.length; r++) {
    const load = loadAxis[r];
    const stockRow: number[] = [];
    const tunedRow: number[] = [];
    for (let c = 0; c < rpmAxis.length; c++) {
      const rpm = rpmAxis[c];
      const inTargetZone = load >= 65 && rpm >= 2250 && rpm <= 5500;
      if (isFuelMap) {
        const base = round2(1.0 - (load > 75 ? (load - 70) * 0.0042 : 0) - (rpm > 4500 ? 0.02 : 0));
        const tuned = inTargetZone ? round2(Math.max(0.8, base - 0.03)) : base;
        stockRow.push(base);
        tunedRow.push(tuned);
      } else if (isBoostMap) {
        const base = round1(88 + (load / 100) * 58 + Math.sin((c / 6) * Math.PI) * 26);
        const tuned = inTargetZone ? round1(base * 1.11) : round1(base * 1.02);
        stockRow.push(base);
        tunedRow.push(tuned);
      } else if (isTorqueMap) {
        const base = round1(16 + (load / 100) * 68 + (c / 6) * 10);
        const tuned = load >= 45 ? round1(Math.min(100, base * 1.09)) : base;
        stockRow.push(base);
        tunedRow.push(tuned);
      } else {
        // Ignition timing BTDC (higher advance at high RPM & lower load; lower advance at high load)
        const base = round1(12 + (rpm / 6000) * 24 - (load / 100) * 14);
        const deltaDeg = inTargetZone ? (load >= 95 ? 1.5 : 2.5) : 0;
        stockRow.push(base);
        tunedRow.push(round1(base + deltaDeg));
      }
    }
    stockMatrix.push(stockRow);
    tunedMatrix.push(tunedRow);
  }

  return {
    payload: {
      kind: 'winols_heatmap',
      mapCode,
      mapNameFa: `${mapNameFa} — ${truncateText(title, 34)}`,
      hexAddress,
      dataFormat,
      factorOffset,
      unit,
      rpmAxis,
      loadAxis,
      stockMatrix,
      tunedMatrix,
      highlightZoneLabel,
    },
    grounded,
    extractedMetrics: metrics,
  };
}

function buildEcuPinoutFromText(title: string, text: string): {
  payload: EcuPinoutPayload;
  grounded: boolean;
  extractedMetrics: string[];
} {
  const ascii = toAsciiDigits(text);
  const ecuMatch = ascii.match(/\b(ME7\.4\.[459]|ME17(?:\.\d+)*|MED17(?:\.\d+)*|SIM2K-?\d+|S2000|SL96|VALEO\s*J34|BOSCH\s*M7\.9\.7|MAW|LZNF|SSAT|EDC17)\b/i);
  const ecuName = ecuMatch ? ecuMatch[1].toUpperCase() : 'ECU استاندارد (Bosch / Siemens)';
  const grounded = Boolean(ecuMatch);
  const metrics = ecuMatch ? [`خانواده ایسیو: ${ecuName}`] : [];

  const pins: EcuPinSpec[] = [
    { pin: 'A1', label: 'تغذیه دائم باتری (+30)', rail: 'power', signalSpec: 'Constant +12V Battery', voltageRange: '12.4 – 14.2 V' },
    { pin: 'A2', label: 'تغذیه سوئیچ (+15 IGN)', rail: 'power', signalSpec: 'Switched Ignition Feed', voltageRange: '12.0 – 14.0 V' },
    { pin: 'A4', label: 'رله دوبل / تغذیه اصلی', rail: 'power', signalSpec: 'Main Relay Output', voltageRange: '12.2 – 14.2 V' },
    { pin: 'B1', label: 'بدنه قدرت (Power GND)', rail: 'ground', signalSpec: 'Chassis Ground', voltageRange: '< 0.05 V' },
    { pin: 'B2', label: 'بدنه سنسورها (Sensor GND)', rail: 'ground', signalSpec: 'Analog Reference GND', voltageRange: '< 0.02 V' },
    { pin: 'C1', label: 'شبکه CAN-High', rail: 'can_comm', signalSpec: 'Differential Bus 500kbps', voltageRange: '2.5 – 3.5 V' },
    { pin: 'C2', label: 'شبکه CAN-Low', rail: 'can_comm', signalSpec: 'Differential Bus 500kbps', voltageRange: '1.5 – 2.5 V' },
    { pin: 'C3', label: 'خط ارتباطی K-Line / OBD', rail: 'can_comm', signalSpec: 'ISO 9141 / KWP2000', voltageRange: '0 – 12 V Pulse' },
    { pin: 'D1', label: 'سنسور دور موتور (CKP)', rail: 'sensor', signalSpec: '60-2 Inductive / Hall', voltageRange: '0.5 – 5.0 V AC/Sq' },
    { pin: 'D2', label: 'سنسور فشار منیفولد (MAP)', rail: 'sensor', signalSpec: 'Analog Linear 5V Ref', voltageRange: '0.4 – 4.6 V' },
    { pin: 'D3', label: 'سنسور اکسیژن (O2 / Lambda)', rail: 'sensor', signalSpec: 'Narrow / Wideband Signal', voltageRange: '0.1 – 0.9 V' },
    { pin: 'E1', label: 'درایور کویل و انژکتور', rail: 'actuator', signalSpec: 'Low-Side PWM / Dwell', voltageRange: '0 – 12 V Peak' },
  ];

  return {
    payload: {
      kind: 'ecu_pinout',
      ecuName,
      connectorLabel: `نقشه شماتیک پایه‌های کلیدی (${truncateText(title, 34)})`,
      totalPinsLabel: 'تفکیک ۵ ریل اصلی: تغذیه، بدنه، شبکه، سنسور، عملگر',
      pins,
    },
    grounded,
    extractedMetrics: metrics,
  };
}

function buildDiagnosticWaveformFromText(title: string, text: string): {
  payload: DiagnosticWaveformPayload;
  grounded: boolean;
  extractedMetrics: string[];
} {
  const ascii = toAsciiDigits(text);
  const dtcMatches = Array.from(
    new Set((ascii.match(/\b[PBCU][0-3][0-9A-F]{3}\b/gi) || []).map((c) => c.toUpperCase()))
  ).slice(0, 4);
  const isO2 = /اکسیژن|o2|lambda|لامبدا/i.test(text);
  const isMap = /\bmap\b|فشار\s+منیفولد/i.test(text);
  const isCkp = /میل[\s‌]?لنگ|دور\s+موتور|\bckp\b/i.test(text);

  const sensorName = isO2
    ? 'سنسور اکسیژن (O2 Voltage Oscillation)'
    : isMap
      ? 'سنسور فشار منیفولد (MAP Sensor)'
      : isCkp
        ? 'سنسور دور موتور (CKP Inductive Signal)'
        : 'سیگنال سنسور مرجع موتور (Oscilloscope Trace)';

  const samples: Array<{ tMs: number; nominal: number; faulty: number }> = [];
  for (let i = 0; i <= 24; i++) {
    const tMs = i * 50;
    const rad = (i / 24) * Math.PI * 4;
    if (isO2) {
      const nominal = round2(0.48 + 0.36 * Math.sin(rad));
      // Faulty lazy/stuck lean O2 sensor
      const faulty = round2(0.22 + 0.08 * Math.sin(rad * 0.5) + (i > 15 ? -0.06 : 0));
      samples.push({ tMs, nominal, faulty });
    } else if (isCkp) {
      const missingTooth = i === 12 ? 0.1 : 1;
      const nominal = round2(2.5 + 2.1 * Math.sin(rad * 1.5) * missingTooth);
      const faulty = round2(2.5 + (i >= 9 && i <= 15 ? 0.25 : 1.7 * Math.sin(rad * 1.5)));
      samples.push({ tMs, nominal, faulty });
    } else {
      const nominal = round2(1.4 + 2.6 * Math.pow(Math.sin((i / 24) * Math.PI), 1.3));
      const faulty = round2(i >= 10 && i <= 16 ? 0.35 : nominal * 0.72);
      samples.push({ tMs, nominal, faulty });
    }
  }

  return {
    payload: {
      kind: 'diagnostic_waveform',
      sensorName,
      dtcCodes: dtcMatches.length > 0 ? dtcMatches : ['P0130', 'P0171'],
      unit: 'V',
      thresholdValue: isO2 ? 0.45 : 1.0,
      thresholdLabel: isO2 ? 'آستانه سوئیچ استوکیومتری (0.45V)' : 'حد پایین ولتاژ سالم (1.0V)',
      faultSummaryFa: `مقایسه موج سالم در برابر افت/قطعی سیگنال ثبت‌شده در فصل «${truncateText(title, 34)}»`,
      diagnosticSteps: [
        'بررسی تغذیه مرجع ۵ ولت و اتصال بدنه سنسور (Sensor GND < 0.05V)',
        'مقایسه دامنه و فرکانس موج زنده اسیلوسکوپ با منحنی مرجع (سبز)',
        'تست دسته سیم زیر لرزش برای کشف افت ولتاژ لحظه‌ای (Intermittent Drop)',
      ],
      samples,
    },
    grounded: dtcMatches.length > 0 || isO2 || isMap || isCkp,
    extractedMetrics: dtcMatches.length > 0 ? [`کدهای خطا: ${dtcMatches.join('، ')}`] : [],
  };
}

function buildAfrIgnitionFromText(title: string, text: string): {
  payload: AfrIgnitionPayload;
  grounded: boolean;
  extractedMetrics: string[];
} {
  const ascii = toAsciiDigits(text);
  const afrMatch = ascii.match(/(?:afr|لامبدا)[^\d]{0,12}(\d{2}\.\d)/i);
  const targetWotAfr = afrMatch ? clamp(parseFloat(afrMatch[1]), 11.2, 13.5) : 12.6;
  const fuelOctaneLabel = /95|۹۵|سوپر/.test(text)
    ? 'بنزین سوپر / اکتان ۹۵'
    : /87|۸۷|معمولی/.test(text)
      ? 'بنزین معمولی (حساس به ناک)'
      : 'بنزین استاندارد شهری (اکتان ۹۱–۹۵)';

  const rpms = [1500, 2250, 3000, 3750, 4500, 5250, 6000];
  const points = rpms.map((rpm, i) => {
    const stockAdvanceDeg = round1(11 + i * 3.1);
    const knockLimitDeg = round1(stockAdvanceDeg + (i >= 2 && i <= 4 ? 3.8 : 4.5));
    const tunedAdvanceDeg = round1(Math.min(knockLimitDeg - 1.5, stockAdvanceDeg + (i >= 1 && i <= 5 ? 2.2 : 1.0)));
    const afr = round2(14.6 - (i / 6) * (14.6 - targetWotAfr));
    return { rpm, stockAdvanceDeg, tunedAdvanceDeg, knockLimitDeg, afr };
  });

  return {
    payload: {
      kind: 'afr_ignition_curve',
      fuelOctaneLabel: `${fuelOctaneLabel} · ${truncateText(title, 30)}`,
      targetWotAfr,
      stoichAfr: 14.7,
      points,
    },
    grounded: Boolean(afrMatch),
    extractedMetrics: afrMatch ? [`AFR هدف تمام‌گاز: ${toPersianDigits(targetWotAfr)}:1`] : [],
  };
}

export function generatePythonScriptForVisual(
  title: string,
  payload: AdaptiveVisualPayload
): string {
  if (payload.kind === 'dyno_chart') {
    const rpms = payload.points.map((p) => p.rpm).join(', ');
    const stockHp = payload.points.map((p) => p.stockHp).join(', ');
    const tunedHp = payload.points.map((p) => p.tunedHp).join(', ');
    const stockTq = payload.points.map((p) => p.stockTorqueNm).join(', ');
    const tunedTq = payload.points.map((p) => p.tunedTorqueNm).join(', ');
    const tunedAfr = payload.points.map((p) => p.tunedAfr ?? 13.0).join(', ');
    return `import numpy as np
import matplotlib.pyplot as plt
from scipy.interpolate import make_interp_spline

# Dyno Telemetry Chart — ${title}
rpm = np.array([${rpms}])
stock_hp = np.array([${stockHp}])
tuned_hp = np.array([${tunedHp}])
stock_tq = np.array([${stockTq}])
tuned_tq = np.array([${tunedTq}])
tuned_afr = np.array([${tunedAfr}])

rpm_smooth = np.linspace(rpm.min(), rpm.max(), 240)
s_hp = make_interp_spline(rpm, stock_hp, k=3)(rpm_smooth)
t_hp = make_interp_spline(rpm, tuned_hp, k=3)(rpm_smooth)
s_tq = make_interp_spline(rpm, stock_tq, k=3)(rpm_smooth)
t_tq = make_interp_spline(rpm, tuned_tq, k=3)(rpm_smooth)
t_afr = make_interp_spline(rpm, tuned_afr, k=3)(rpm_smooth)

fig, (ax1, ax_afr) = plt.subplots(
    2, 1, figsize=(10.5, 6.2), sharex=True, gridspec_kw={'height_ratios': [3.4, 1.1]}
)
ax2 = ax1.twinx()

ax1.plot(rpm_smooth, s_hp, '--', color='#64748B', lw=1.8, label='Stock HP')
ax1.plot(rpm_smooth, t_hp, '-', color='#1E3A5F', lw=2.6, label='${payload.stageLabel} HP')
ax1.fill_between(rpm_smooth, s_hp, t_hp, color='#2563EB', alpha=0.12, label='Power Gain')

ax2.plot(rpm_smooth, s_tq, ':', color='#B45309', lw=1.7, label='Stock Torque (Nm)')
ax2.plot(rpm_smooth, t_tq, '-', color='#D97706', lw=2.4, label='${payload.stageLabel} Torque (Nm)')

ax1.axvline(5252, color='#DC2626', linestyle='-.', alpha=0.55, lw=1.2)
ax1.set_ylabel('Horsepower (HP)', color='#1E3A5F', fontweight='bold')
ax2.set_ylabel('Torque (Nm)', color='#B45309', fontweight='bold')
ax1.grid(True, linestyle='--', alpha=0.3)
ax1.set_title('Dyno Graph Analysis — Peak: ${payload.peakTunedHp} HP / ${payload.peakTunedTorqueNm} Nm')

ax_afr.plot(rpm_smooth, t_afr, color='#059669', lw=2.2, label='Tuned AFR')
ax_afr.axhline(14.7, color='#64748B', linestyle=':', lw=1.1, label='Stoich 14.7')
ax_afr.set_ylabel('AFR (:1)', fontweight='bold')
ax_afr.set_xlabel('Engine Speed (RPM)', fontweight='bold')
ax_afr.grid(True, linestyle='--', alpha=0.3)

plt.tight_layout()
plt.savefig('dyno_chart.png', dpi=220)
plt.show()
`;
  }

  if (payload.kind === 'winols_heatmap') {
    const stockRows = payload.stockMatrix.map((r) => `    [${r.join(', ')}]`).join(',\n');
    const tunedRows = payload.tunedMatrix.map((r) => `    [${r.join(', ')}]`).join(',\n');
    return `import numpy as np
import matplotlib.pyplot as plt

# WinOLS Map Thermal Matrix & 3D Surface — ${payload.mapCode} (${payload.hexAddress})
rpm_axis = np.array([${payload.rpmAxis.join(', ')}])
load_axis = np.array([${payload.loadAxis.join(', ')}])
stock_map = np.array([\n${stockRows}\n])
tuned_map = np.array([\n${tunedRows}\n])
delta_map = tuned_map - stock_map

fig = plt.figure(figsize=(11.5, 4.8))
ax1 = fig.add_subplot(1, 2, 1)
im = ax1.imshow(tuned_map, cmap='coolwarm', aspect='auto', origin='lower')
ax1.set_xticks(range(len(rpm_axis)), rpm_axis)
ax1.set_yticks(range(len(load_axis)), [f'{x}%' for x in load_axis])
ax1.set_xlabel('RPM')
ax1.set_ylabel('Engine Load (%)')
ax1.set_title('${payload.mapCode} @ ${payload.hexAddress} (${payload.unit})')
plt.colorbar(im, ax=ax1, label='${payload.unit}')

ax2 = fig.add_subplot(1, 2, 2, projection='3d')
X, Y = np.meshgrid(rpm_axis, load_axis)
ax2.plot_surface(X, Y, tuned_map, cmap='viridis', edgecolor='none', alpha=0.92)
ax2.set_xlabel('RPM')
ax2.set_ylabel('Load %')
ax2.set_zlabel('${payload.unit}')
ax2.set_title('3D Surface View (WinOLS)')

plt.tight_layout()
plt.savefig('winols_${payload.mapCode.toLowerCase()}.png', dpi=220)
plt.show()
`;
  }

  if (payload.kind === 'diagnostic_waveform') {
    const tMs = payload.samples.map((s) => s.tMs).join(', ');
    const nom = payload.samples.map((s) => s.nominal).join(', ');
    const flt = payload.samples.map((s) => s.faulty).join(', ');
    return `import numpy as np
import matplotlib.pyplot as plt

# Diagnostic Oscilloscope Trace — ${payload.sensorName} (${payload.dtcCodes.join(', ')})
t_ms = np.array([${tMs}])
nominal = np.array([${nom}])
faulty = np.array([${flt}])

plt.figure(figsize=(9.5, 4.5))
plt.plot(t_ms, nominal, color='#059669', lw=2.4, label='Nominal Signal')
plt.plot(t_ms, faulty, '--', color='#DC2626', lw=2.2, label='Faulty / Dropout Trace')
plt.axhline(${payload.thresholdValue}, color='#D97706', ls=':', lw=1.4, label='Threshold (${payload.thresholdValue}${payload.unit})')
plt.xlabel('Time (ms)')
plt.ylabel('Signal (${payload.unit})')
plt.title('${payload.sensorName}')
plt.grid(True, alpha=0.3)
plt.legend()
plt.tight_layout()
plt.savefig('diagnostic_waveform.png', dpi=200)
plt.show()
`;
  }

  if (payload.kind === 'afr_ignition_curve') {
    const rpms = payload.points.map((p) => p.rpm).join(', ');
    const stockAdv = payload.points.map((p) => p.stockAdvanceDeg).join(', ');
    const tunedAdv = payload.points.map((p) => p.tunedAdvanceDeg).join(', ');
    const knockLim = payload.points.map((p) => p.knockLimitDeg).join(', ');
    return `import numpy as np
import matplotlib.pyplot as plt

# Combustion Ignition Advance vs Knock Margin — ${title}
rpm = np.array([${rpms}])
stock_adv = np.array([${stockAdv}])
tuned_adv = np.array([${tunedAdv}])
knock_lim = np.array([${knockLim}])

plt.figure(figsize=(9.5, 4.6))
plt.plot(rpm, knock_lim, '-.', color='#DC2626', lw=2.0, label='Knock Boundary (deg BTDC)')
plt.fill_between(rpm, tuned_adv, knock_lim, color='#F59E0B', alpha=0.14, label='Safety Knock Margin')
plt.plot(rpm, stock_adv, '--', color='#64748B', lw=1.8, label='Stock Ignition')
plt.plot(rpm, tuned_adv, '-', color='#1E3A5F', lw=2.6, label='Tuned MBT Advance')
plt.xlabel('RPM')
plt.ylabel('Ignition Advance (deg BTDC)')
plt.title('Spark Advance vs Knock Threshold (Target WOT AFR: ${payload.targetWotAfr}:1)')
plt.grid(True, alpha=0.3)
plt.legend()
plt.tight_layout()
plt.savefig('afr_ignition.png', dpi=200)
plt.show()
`;
  }

  if (payload.kind === 'numeric_telemetry_chart') {
    return generatePythonScriptForNumericTelemetry(title, payload);
  }

  return `# ECU Pinout Verification Script — ${title}
pins = ${JSON.stringify(payload.pins, null, 2)}
for p in pins:
    print(f"{p['pin']:>4} | {p['rail']:<10} | {p['voltageRange']:<16} | {p['label']}")
`;
}

// ============================================================================
// 3. PUBLICATION-GRADE DETERMINISTIC SVG RENDERERS (INSTANT & DOCX READY)
// ============================================================================

function buildSmoothPath(coords: Array<{ x: number; y: number }>): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function heatColor(ratio: number): string {
  const t = clamp(ratio, 0, 1);
  // Crisp scientific coolwarm ramp: Slate-Blue -> Cyan -> Warm Amber -> Crimson
  if (t < 0.33) {
    const u = t / 0.33;
    const r = Math.round(30 + u * 26);
    const g = Math.round(64 + u * 114);
    const b = Math.round(145 + u * 65);
    return `rgb(${r},${g},${b})`;
  }
  if (t < 0.66) {
    const u = (t - 0.33) / 0.33;
    const r = Math.round(56 + u * 182);
    const g = Math.round(178 - u * 30);
    const b = Math.round(210 - u * 165);
    return `rgb(${r},${g},${b})`;
  }
  const u = (t - 0.66) / 0.34;
  const r = Math.round(238 - u * 26);
  const g = Math.round(148 - u * 102);
  const b = Math.round(45 - u * 9);
  return `rgb(${r},${g},${b})`;
}

export function buildAdaptiveVisualSvg(
  title: string,
  payload: AdaptiveVisualPayload
): string {
  const fontStack = 'Vazirmatn, Vazir Medium, Tahoma, sans-serif';
  const monoStack = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

  if (payload.kind === 'numeric_telemetry_chart') {
    return buildNumericTelemetrySvg(title, payload);
  }

  if (payload.kind === 'dyno_chart') {
    const pts = payload.points;
    const plotX = 76;
    const plotY = 86;
    const plotW = 790;
    const plotH = 264;
    const afrY = 372;
    const afrH = 74;

    const minRpm = pts[0]?.rpm ?? 1500;
    const maxRpm = pts[pts.length - 1]?.rpm ?? 6500;
    const maxHp = Math.ceil(Math.max(...pts.map((p) => p.tunedHp)) * 1.15);
    const maxTq = Math.ceil(Math.max(...pts.map((p) => p.tunedTorqueNm)) * 1.15);

    const xOf = (rpm: number) =>
      plotX + ((rpm - minRpm) / Math.max(1, maxRpm - minRpm)) * plotW;
    const yHp = (hp: number) => plotY + plotH - (hp / Math.max(1, maxHp)) * plotH;
    const yTq = (tq: number) => plotY + plotH - (tq / Math.max(1, maxTq)) * plotH;
    const yAfr = (afr: number) => afrY + afrH - ((clamp(afr, 10.5, 16) - 10.5) / 5.5) * afrH;

    const stockHpPts = pts.map((p) => ({ x: xOf(p.rpm), y: yHp(p.stockHp) }));
    const tunedHpPts = pts.map((p) => ({ x: xOf(p.rpm), y: yHp(p.tunedHp) }));
    const stockTqPts = pts.map((p) => ({ x: xOf(p.rpm), y: yTq(p.stockTorqueNm) }));
    const tunedTqPts = pts.map((p) => ({ x: xOf(p.rpm), y: yTq(p.tunedTorqueNm) }));
    const afrPts = pts.map((p) => ({ x: xOf(p.rpm), y: yAfr(p.tunedAfr ?? 13.0) }));

    const gainPolygon = [
      ...tunedHpPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      ...[...stockHpPts].reverse().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    ].join(' ');

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((frac) => {
        const y = plotY + plotH * (1 - frac);
        const hpTick = Math.round(maxHp * frac);
        const tqTick = Math.round(maxTq * frac);
        return `
          <line x1="${plotX}" y1="${y.toFixed(1)}" x2="${plotX + plotW}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-dasharray="3 3" stroke-width="1"/>
          <text x="${plotX - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="${monoStack}" font-size="11" fill="#1E3A5F">${hpTick}</text>
          <text x="${plotX + plotW + 10}" y="${(y + 4).toFixed(1)}" text-anchor="start" font-family="${monoStack}" font-size="11" fill="#B45309">${tqTick}</text>
        `;
      })
      .join('');

    const rpmTicks = pts
      .filter((_p, idx) => idx % 2 === 0 || idx === pts.length - 1)
      .map((p) => {
        const x = xOf(p.rpm);
        return `
          <line x1="${x.toFixed(1)}" y1="${plotY}" x2="${x.toFixed(1)}" y2="${plotY + plotH}" stroke="#F1F5F9" stroke-width="1"/>
          <text x="${x.toFixed(1)}" y="${afrY + afrH + 18}" text-anchor="middle" font-family="${monoStack}" font-size="11" fill="#475569">${p.rpm}</text>
        `;
      })
      .join('');

    const crossX = payload.crossoverRpm >= minRpm && payload.crossoverRpm <= maxRpm ? xOf(payload.crossoverRpm) : null;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXHIBIT_WIDTH}" height="${EXHIBIT_HEIGHT}" viewBox="0 0 ${EXHIBIT_WIDTH} ${EXHIBIT_HEIGHT}">
      <rect width="100%" height="100%" fill="#FFFFFF"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="${EXHIBIT_HEIGHT - 24}" rx="6" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="52" rx="6" fill="#0F172A"/>
      <text x="${EXHIBIT_WIDTH - 28}" y="35" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="15.5" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(title, 62))}</text>
      <text x="${EXHIBIT_WIDTH - 28}" y="53" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="10.5" fill="#CBD5E1">${escapeXml(truncateText(payload.subtitle, 82))}</text>
      <text x="28" y="42" text-anchor="start" font-family="${monoStack}" font-size="11.5" font-weight="700" fill="#38BDF8">PEAK: ${payload.peakTunedHp} HP / ${payload.peakTunedTorqueNm} Nm</text>

      <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
      ${gridLines}
      ${rpmTicks}
      ${crossX ? `<line x1="${crossX.toFixed(1)}" y1="${plotY}" x2="${crossX.toFixed(1)}" y2="${plotY + plotH}" stroke="#DC2626" stroke-dasharray="5 4" stroke-width="1.2" opacity="0.7"/>
      <text x="${(crossX - 6).toFixed(1)}" y="${plotY + 16}" text-anchor="end" font-family="${monoStack}" font-size="10" fill="#DC2626">5252 RPM</text>` : ''}

      <polygon points="${gainPolygon}" fill="#2563EB" opacity="0.11"/>
      <path d="${buildSmoothPath(stockHpPts)}" fill="none" stroke="#64748B" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="${buildSmoothPath(tunedHpPts)}" fill="none" stroke="#1E3A5F" stroke-width="3"/>
      <path d="${buildSmoothPath(stockTqPts)}" fill="none" stroke="#D97706" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.7"/>
      <path d="${buildSmoothPath(tunedTqPts)}" fill="none" stroke="#D97706" stroke-width="2.6"/>

      <text x="20" y="${plotY + plotH / 2}" text-anchor="middle" transform="rotate(-90 20 ${plotY + plotH / 2})" font-family="${monoStack}" font-size="11" font-weight="700" fill="#1E3A5F">HORSEPOWER (HP)</text>
      <text x="${EXHIBIT_WIDTH - 22}" y="${plotY + plotH / 2}" text-anchor="middle" transform="rotate(90 ${EXHIBIT_WIDTH - 22} ${plotY + plotH / 2})" font-family="${monoStack}" font-size="11" font-weight="700" fill="#B45309">TORQUE (Nm)</text>

      <!-- AFR Subplot -->
      <rect x="${plotX}" y="${afrY}" width="${plotW}" height="${afrH}" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
      <line x1="${plotX}" y1="${yAfr(14.7).toFixed(1)}" x2="${plotX + plotW}" y2="${yAfr(14.7).toFixed(1)}" stroke="#64748B" stroke-dasharray="2 3" stroke-width="1"/>
      <path d="${buildSmoothPath(afrPts)}" fill="none" stroke="#059669" stroke-width="2.4"/>
      <text x="${plotX - 8}" y="${afrY + 20}" text-anchor="end" font-family="${monoStack}" font-size="10" fill="#059669">AFR</text>
      <text x="${plotX + plotW - 6}" y="${(yAfr(14.7) - 3).toFixed(1)}" text-anchor="end" font-family="${monoStack}" font-size="9.5" fill="#64748B">Stoich 14.7</text>

      <!-- Legend -->
      <g font-family="${fontStack}" font-size="11" fill="#1E293B">
        <line x1="90" y1="477" x2="112" y2="477" stroke="#1E3A5F" stroke-width="3"/>
        <text x="118" y="481">توان ریمپ (HP)</text>
        <line x1="226" y1="477" x2="248" y2="477" stroke="#64748B" stroke-width="2" stroke-dasharray="4 3"/>
        <text x="254" y="481">توان فابریک</text>
        <line x1="350" y1="477" x2="372" y2="477" stroke="#D97706" stroke-width="2.6"/>
        <text x="378" y="481">گشتاور ریمپ (Nm)</text>
        <line x1="504" y1="477" x2="526" y2="477" stroke="#059669" stroke-width="2.4"/>
        <text x="532" y="481">نسبت سوخت (AFR)</text>
        <text x="${EXHIBIT_WIDTH - 28}" y="481" text-anchor="end" font-family="${monoStack}" font-size="10.5" fill="#475569">Engine Speed (RPM)</text>
      </g>
    </svg>`;
  }

  if (payload.kind === 'winols_heatmap') {
    const rows = payload.loadAxis.length;
    const cols = payload.rpmAxis.length;
    const allVals = payload.tunedMatrix.flat();
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const span = Math.max(0.001, maxV - minV);

    const gridX = 88;
    const gridY = 104;
    const cellW = 72;
    const cellH = 44;

    const cellsSvg = payload.tunedMatrix
      .map((row, rIdx) =>
        row
          .map((val, cIdx) => {
            const stock = payload.stockMatrix[rIdx]?.[cIdx] ?? val;
            const delta = round2(val - stock);
            const ratio = (val - minV) / span;
            const x = gridX + cIdx * cellW;
            const y = gridY + (rows - 1 - rIdx) * cellH;
            const fill = heatColor(ratio);
            const txtColor = ratio > 0.25 && ratio < 0.72 ? '#0F172A' : '#FFFFFF';
            const deltaStr = delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`;
            return `
              <rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="3" fill="${fill}"/>
              <text x="${x + cellW / 2}" y="${y + 20}" text-anchor="middle" font-family="${monoStack}" font-size="12" font-weight="700" fill="${txtColor}">${val}</text>
              ${deltaStr ? `<text x="${x + cellW / 2}" y="${y + 35}" text-anchor="middle" font-family="${monoStack}" font-size="9.5" fill="${txtColor}" opacity="0.92">${deltaStr}</text>` : ''}
            `;
          })
          .join('')
      )
      .join('');

    const rpmLabels = payload.rpmAxis
      .map((rpm, cIdx) => {
        const x = gridX + cIdx * cellW + cellW / 2;
        return `<text x="${x}" y="${gridY + rows * cellH + 20}" text-anchor="middle" font-family="${monoStack}" font-size="11" font-weight="700" fill="#334155">${rpm}</text>`;
      })
      .join('');

    const loadLabels = payload.loadAxis
      .map((load, rIdx) => {
        const y = gridY + (rows - 1 - rIdx) * cellH + cellH / 2 + 4;
        return `<text x="${gridX - 10}" y="${y}" text-anchor="end" font-family="${monoStack}" font-size="11" font-weight="700" fill="#334155">${load}%</text>`;
      })
      .join('');

    // Isometric 3D mini surface on right side (x: 622..930)
    const isoOriginX = 776;
    const isoOriginY = 308;
    const isoLines: string[] = [];
    for (let r = 0; r < rows; r++) {
      const linePts: string[] = [];
      for (let c = 0; c < cols; c++) {
        const val = payload.tunedMatrix[r][c];
        const z = ((val - minV) / span) * 86;
        const ix = isoOriginX + (c - r) * 20;
        const iy = isoOriginY + (c + r) * 9 - z - 44;
        linePts.push(`${ix.toFixed(1)},${iy.toFixed(1)}`);
      }
      isoLines.push(`<polyline points="${linePts.join(' ')}" fill="none" stroke="${heatColor(r / Math.max(1, rows - 1))}" stroke-width="2"/>`);
    }
    for (let c = 0; c < cols; c++) {
      const linePts: string[] = [];
      for (let r = 0; r < rows; r++) {
        const val = payload.tunedMatrix[r][c];
        const z = ((val - minV) / span) * 86;
        const ix = isoOriginX + (c - r) * 20;
        const iy = isoOriginY + (c + r) * 9 - z - 44;
        linePts.push(`${ix.toFixed(1)},${iy.toFixed(1)}`);
      }
      isoLines.push(`<polyline points="${linePts.join(' ')}" fill="none" stroke="#1E3A5F" stroke-width="1.1" opacity="0.55"/>`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXHIBIT_WIDTH}" height="${EXHIBIT_HEIGHT}" viewBox="0 0 ${EXHIBIT_WIDTH} ${EXHIBIT_HEIGHT}">
      <rect width="100%" height="100%" fill="#FFFFFF"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="${EXHIBIT_HEIGHT - 24}" rx="6" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="56" rx="6" fill="#0F172A"/>
      <text x="${EXHIBIT_WIDTH - 28}" y="36" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="15" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(payload.mapNameFa, 60))}</text>
      <text x="${EXHIBIT_WIDTH - 28}" y="55" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="10.5" fill="#CBD5E1">${escapeXml(payload.highlightZoneLabel)}</text>
      <text x="28" y="36" text-anchor="start" font-family="${monoStack}" font-size="12" font-weight="700" fill="#F59E0B">${escapeXml(payload.mapCode)} @ ${escapeXml(payload.hexAddress)}</text>
      <text x="28" y="54" text-anchor="start" font-family="${monoStack}" font-size="10" fill="#94A3B8">${escapeXml(payload.factorOffset)}</text>

      <text x="${gridX + (cols * cellW) / 2}" y="92" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="12" font-weight="700" fill="#1E3A5F">ماتریس حرارتی WinOLS (مقدار جدید و اختلاف Delta)</text>
      ${cellsSvg}
      ${rpmLabels}
      ${loadLabels}
      <text x="${gridX + (cols * cellW) / 2}" y="${gridY + rows * cellH + 40}" text-anchor="middle" font-family="${monoStack}" font-size="11" fill="#475569">Engine Speed (RPM)</text>
      <text x="28" y="${gridY + (rows * cellH) / 2}" text-anchor="middle" transform="rotate(-90 28 ${gridY + (rows * cellH) / 2})" font-family="${monoStack}" font-size="11" fill="#475569">LOAD (%)</text>

      <rect x="614" y="104" width="320" height="264" rx="5" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
      <text x="774" y="128" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="12" font-weight="700" fill="#1E3A5F">پیش‌نمایش سطح ۳بعدی (3D Surface)</text>
      ${isoLines.join('')}
      <text x="774" y="352" text-anchor="middle" font-family="${monoStack}" font-size="10" fill="#64748B">Unit: ${escapeXml(payload.unit)} · ${escapeXml(payload.dataFormat)}</text>

      <text x="${EXHIBIT_WIDTH / 2}" y="476" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="11" fill="#475569">تولیدشده به‌صورت خودکار بر اساس ماهیت نقشه WinOLS در محتوای فصل</text>
    </svg>`;
  }

  if (payload.kind === 'ecu_pinout') {
    const railColors: Record<EcuPinSpec['rail'], { bg: string; border: string; fg: string; nameFa: string }> = {
      power: { bg: '#FEF2F2', border: '#DC2626', fg: '#991B1B', nameFa: 'تغذیه +12V' },
      ground: { bg: '#F1F5F9', border: '#334155', fg: '#0F172A', nameFa: 'بدنه GND' },
      can_comm: { bg: '#EFF6FF', border: '#2563EB', fg: '#1E40AF', nameFa: 'شبکه CAN/K-Line' },
      sensor: { bg: '#ECFDF5', border: '#059669', fg: '#065F46', nameFa: 'سنسور ورودی' },
      actuator: { bg: '#FFFBEB', border: '#D97706', fg: '#92400E', nameFa: 'عملگر خروجی' },
    };

    const cols = 3;
    const cardW = 286;
    const cardH = 74;
    const gapX = 18;
    const gapY = 14;
    const startX = 32;
    const startY = 92;

    const cards = payload.pins
      .slice(0, 12)
      .map((pin, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = startX + c * (cardW + gapX);
        const y = startY + r * (cardH + gapY);
        const st = railColors[pin.rail];
        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="5" fill="${st.bg}" stroke="${st.border}" stroke-width="1.2"/>
            <rect x="${x + 10}" y="${y + 12}" width="44" height="24" rx="3" fill="${st.border}"/>
            <text x="${x + 32}" y="${y + 28}" text-anchor="middle" font-family="${monoStack}" font-size="11.5" font-weight="700" fill="#FFFFFF">${escapeXml(pin.pin)}</text>
            <text x="${x + cardW - 12}" y="${y + 28}" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="12" font-weight="700" fill="${st.fg}">${escapeXml(truncateText(pin.label, 24))}</text>
            <text x="${x + 12}" y="${y + 56}" text-anchor="start" font-family="${monoStack}" font-size="10" fill="#475569">${escapeXml(pin.voltageRange)}</text>
            <text x="${x + cardW - 12}" y="${y + 56}" text-anchor="end" font-family="${monoStack}" font-size="9.5" fill="#64748B">${escapeXml(truncateText(pin.signalSpec, 24))}</text>
          </g>
        `;
      })
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXHIBIT_WIDTH}" height="${EXHIBIT_HEIGHT}" viewBox="0 0 ${EXHIBIT_WIDTH} ${EXHIBIT_HEIGHT}">
      <rect width="100%" height="100%" fill="#FFFFFF"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="${EXHIBIT_HEIGHT - 24}" rx="6" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="56" rx="6" fill="#0F172A"/>
      <text x="${EXHIBIT_WIDTH - 28}" y="36" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="15" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(title, 60))}</text>
      <text x="${EXHIBIT_WIDTH - 28}" y="55" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="10.5" fill="#CBD5E1">${escapeXml(payload.totalPinsLabel)}</text>
      <text x="28" y="44" text-anchor="start" font-family="${monoStack}" font-size="12.5" font-weight="700" fill="#38BDF8">${escapeXml(payload.ecuName)}</text>
      ${cards}
      <text x="${EXHIBIT_WIDTH / 2}" y="476" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="11" fill="#475569">شماتیک تفکیک ریل‌های سوکت ECU — پیش از تست حتماً با مولتی‌متر/اهم‌متر صحت بدنه را بررسی کنید</text>
    </svg>`;
  }

  if (payload.kind === 'diagnostic_waveform') {
    const plotX = 78;
    const plotY = 92;
    const plotW = 830;
    const plotH = 290;
    const maxT = Math.max(...payload.samples.map((s) => s.tMs), 1);
    const maxV = Math.max(...payload.samples.flatMap((s) => [s.nominal, s.faulty]), payload.thresholdValue) * 1.15;
    const xOf = (t: number) => plotX + (t / maxT) * plotW;
    const yOf = (v: number) => plotY + plotH - (v / Math.max(0.1, maxV)) * plotH;

    const nomPts = payload.samples.map((s) => ({ x: xOf(s.tMs), y: yOf(s.nominal) }));
    const fltPts = payload.samples.map((s) => ({ x: xOf(s.tMs), y: yOf(s.faulty) }));
    const thY = yOf(payload.thresholdValue);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXHIBIT_WIDTH}" height="${EXHIBIT_HEIGHT}" viewBox="0 0 ${EXHIBIT_WIDTH} ${EXHIBIT_HEIGHT}">
      <rect width="100%" height="100%" fill="#FFFFFF"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="${EXHIBIT_HEIGHT - 24}" rx="6" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
      <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="56" rx="6" fill="#0F172A"/>
      <text x="${EXHIBIT_WIDTH - 28}" y="36" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="15" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(title, 60))}</text>
      <text x="${EXHIBIT_WIDTH - 28}" y="55" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="10.5" fill="#CBD5E1">${escapeXml(payload.sensorName)}</text>
      <text x="28" y="44" text-anchor="start" font-family="${monoStack}" font-size="12" font-weight="700" fill="#F87171">DTC: ${escapeXml(payload.dtcCodes.join(' · '))}</text>

      <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="#0B1220" stroke="#334155" stroke-width="1.2"/>
      ${[0.2, 0.4, 0.6, 0.8].map((f) => `<line x1="${plotX}" y1="${(plotY + plotH * f).toFixed(1)}" x2="${plotX + plotW}" y2="${(plotY + plotH * f).toFixed(1)}" stroke="#1E293B" stroke-width="1"/>`).join('')}
      ${[0.2, 0.4, 0.6, 0.8].map((f) => `<line x1="${(plotX + plotW * f).toFixed(1)}" y1="${plotY}" x2="${(plotX + plotW * f).toFixed(1)}" y2="${plotY + plotH}" stroke="#1E293B" stroke-width="1"/>`).join('')}

      <line x1="${plotX}" y1="${thY.toFixed(1)}" x2="${plotX + plotW}" y2="${thY.toFixed(1)}" stroke="#F59E0B" stroke-dasharray="6 4" stroke-width="1.4"/>
      <text x="${plotX + plotW - 10}" y="${(thY - 6).toFixed(1)}" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="10.5" fill="#FCD34D">${escapeXml(payload.thresholdLabel)}</text>

      <path d="${buildSmoothPath(nomPts)}" fill="none" stroke="#10B981" stroke-width="2.8"/>
      <path d="${buildSmoothPath(fltPts)}" fill="none" stroke="#EF4444" stroke-width="2.4" stroke-dasharray="6 4"/>

      <text x="24" y="${plotY + plotH / 2}" text-anchor="middle" transform="rotate(-90 24 ${plotY + plotH / 2})" font-family="${monoStack}" font-size="11" fill="#334155">Voltage (${escapeXml(payload.unit)})</text>
      <text x="${plotX + plotW / 2}" y="406" text-anchor="middle" font-family="${monoStack}" font-size="11" fill="#475569">Time (ms) · 0 — ${maxT} ms</text>

      <g font-family="${fontStack}" font-size="11.5" fill="#1E293B">
        <line x1="90" y1="450" x2="116" y2="450" stroke="#10B981" stroke-width="3"/>
        <text x="122" y="454">شکل‌موج سالم (مرجع)</text>
        <line x1="276" y1="450" x2="302" y2="450" stroke="#EF4444" stroke-width="2.4" stroke-dasharray="5 3"/>
        <text x="308" y="454">موج معیوب / افت سیگنال</text>
        <text x="${EXHIBIT_WIDTH - 28}" y="454" text-anchor="end" direction="rtl" font-size="11" fill="#475569">${escapeXml(truncateText(payload.faultSummaryFa, 58))}</text>
      </g>
    </svg>`;
  }

  // afr_ignition_curve
  const plotX = 78;
  const plotY = 90;
  const plotW = 826;
  const plotH = 266;
  const pts = payload.points;
  const minRpm = pts[0]?.rpm ?? 1500;
  const maxRpm = pts[pts.length - 1]?.rpm ?? 6000;
  const maxDeg = Math.ceil(Math.max(...pts.map((p) => p.knockLimitDeg)) * 1.15);
  const xOf = (rpm: number) => plotX + ((rpm - minRpm) / Math.max(1, maxRpm - minRpm)) * plotW;
  const yOf = (deg: number) => plotY + plotH - (deg / Math.max(1, maxDeg)) * plotH;

  const stockPts = pts.map((p) => ({ x: xOf(p.rpm), y: yOf(p.stockAdvanceDeg) }));
  const tunedPts = pts.map((p) => ({ x: xOf(p.rpm), y: yOf(p.tunedAdvanceDeg) }));
  const knockPts = pts.map((p) => ({ x: xOf(p.rpm), y: yOf(p.knockLimitDeg) }));

  const marginPoly = [
    ...knockPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    ...[...tunedPts].reverse().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
  ].join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${EXHIBIT_WIDTH}" height="${EXHIBIT_HEIGHT}" viewBox="0 0 ${EXHIBIT_WIDTH} ${EXHIBIT_HEIGHT}">
    <rect width="100%" height="100%" fill="#FFFFFF"/>
    <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="${EXHIBIT_HEIGHT - 24}" rx="6" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
    <rect x="12" y="12" width="${EXHIBIT_WIDTH - 24}" height="56" rx="6" fill="#0F172A"/>
    <text x="${EXHIBIT_WIDTH - 28}" y="36" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="15" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(title, 60))}</text>
    <text x="${EXHIBIT_WIDTH - 28}" y="55" text-anchor="end" direction="rtl" font-family="${fontStack}" font-size="10.5" fill="#CBD5E1">${escapeXml(payload.fuelOctaneLabel)}</text>
    <text x="28" y="44" text-anchor="start" font-family="${monoStack}" font-size="12" font-weight="700" fill="#34D399">WOT AFR: ${payload.targetWotAfr}:1</text>

    <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
    <polygon points="${marginPoly}" fill="#F59E0B" opacity="0.16"/>
    <path d="${buildSmoothPath(knockPts)}" fill="none" stroke="#DC2626" stroke-width="2.2" stroke-dasharray="6 4"/>
    <path d="${buildSmoothPath(stockPts)}" fill="none" stroke="#64748B" stroke-width="2" stroke-dasharray="4 4"/>
    <path d="${buildSmoothPath(tunedPts)}" fill="none" stroke="#1E3A5F" stroke-width="3"/>

    <!-- AFR Zone Strip -->
    <rect x="${plotX}" y="382" width="${plotW * 0.28}" height="34" fill="#1D4ED8" opacity="0.88"/>
    <rect x="${plotX + plotW * 0.28}" y="382" width="${plotW * 0.27}" height="34" fill="#059669" opacity="0.9"/>
    <rect x="${plotX + plotW * 0.55}" y="382" width="${plotW * 0.2}" height="34" fill="#D97706" opacity="0.9"/>
    <rect x="${plotX + plotW * 0.75}" y="382" width="${plotW * 0.25}" height="34" fill="#DC2626" opacity="0.9"/>
    <text x="${plotX + plotW * 0.14}" y="403" text-anchor="middle" font-family="${fontStack}" font-size="11" font-weight="700" fill="#FFFFFF">غنی خنک‌کاری (&lt;12.0)</text>
    <text x="${plotX + plotW * 0.415}" y="403" text-anchor="middle" font-family="${fontStack}" font-size="11" font-weight="700" fill="#FFFFFF">حداکثر توان (12.2–13.0)</text>
    <text x="${plotX + plotW * 0.65}" y="403" text-anchor="middle" font-family="${fontStack}" font-size="11" font-weight="700" fill="#FFFFFF">استوکیومتری (14.7)</text>
    <text x="${plotX + plotW * 0.875}" y="403" text-anchor="middle" font-family="${fontStack}" font-size="11" font-weight="700" fill="#FFFFFF">مخلوط فقیر · خطر ناک (&gt;15.2)</text>

    <text x="26" y="${plotY + plotH / 2}" text-anchor="middle" transform="rotate(-90 26 ${plotY + plotH / 2})" font-family="${monoStack}" font-size="11" fill="#1E3A5F">Advance (° BTDC)</text>
    <g font-family="${fontStack}" font-size="11.5" fill="#1E293B">
      <line x1="90" y1="460" x2="116" y2="460" stroke="#1E3A5F" stroke-width="3"/>
      <text x="122" y="464">آوانس بهینه (MBT)</text>
      <line x1="256" y1="460" x2="282" y2="460" stroke="#DC2626" stroke-width="2.2" stroke-dasharray="5 3"/>
      <text x="288" y="464">مرز ناک (Knock Limit)</text>
      <line x1="440" y1="460" x2="466" y2="460" stroke="#64748B" stroke-width="2" stroke-dasharray="4 3"/>
      <text x="472" y="464">آوانس فابریک</text>
    </g>
  </svg>`;
}

// ============================================================================
// 4. AUTOMATIC CHAPTER-BY-CHAPTER VISUAL EXHIBIT INJECTION
// ============================================================================

export function createAdaptiveVisualBlockForChapter(params: {
  chapter: ChapterNode;
  archetype: ContentArchetypeId;
  chapterText: string;
}): AdaptiveVisualBlock | null {
  const { chapter, archetype, chapterText } = params;
  const baseId = `advis_ch${chapter.chapterNumber}_${archetype}`;

  if (archetype === 'dyno_graph_reading') {
    const built = buildDynoPayloadFromText(chapter.title, chapterText);
    const title = `نمودار تحلیلی داینو و گراف‌خوانی — ${truncateText(chapter.title, 48)}`;
    return {
      type: 'adaptive_visual',
      id: baseId,
      visualKind: 'dyno_chart',
      archetype,
      title,
      caption: `شکل خلاقانه ${toPersianDigits(chapter.chapterNumber)}: ${title}`,
      pedagogicalTakeaway: `تفاوت سطح زیر منحنی توان فابریک (${toPersianDigits(built.payload.peakStockHp)} HP) و نسخه ریمپ (${toPersianDigits(built.payload.peakTunedHp)} HP) را همراه با روند AFR در تمام‌گاز بررسی کنید. کد کامل پایتون Matplotlib برای بازتولید یا ویرایش دقیق همین گراف آماده است.`,
      svgMarkup: buildAdaptiveVisualSvg(title, built.payload),
      pythonScript: generatePythonScriptForVisual(title, built.payload),
      renderedByPython: false,
      groundedFromText: built.grounded,
      extractedMetrics: built.extractedMetrics,
      widthPx: EXHIBIT_WIDTH,
      heightPx: EXHIBIT_HEIGHT,
      payload: built.payload,
      sourceFileNames: chapter.sourceFileName ? [chapter.sourceFileName] : undefined,
    };
  }

  if (archetype === 'winols_hex_maps') {
    const built = buildWinolsHeatmapFromText(chapter.title, chapterText);
    const title = `ماتریس حرارتی و سطح ۳بعدی WinOLS (${built.payload.mapCode})`;
    return {
      type: 'adaptive_visual',
      id: baseId,
      visualKind: 'winols_heatmap',
      archetype,
      title,
      caption: `شکل خلاقانه ${toPersianDigits(chapter.chapterNumber)}: ${title} در آدرس ${built.payload.hexAddress}`,
      pedagogicalTakeaway: `${built.payload.highlightZoneLabel}. روی هر سلول جدول کلیک کنید تا مقدار فابریک، مقدار اصلاح‌شده و درصد تغییر (Delta) را ببینید یا نمای ۳بعدی و کد پایتون آن را بررسی کنید.`,
      svgMarkup: buildAdaptiveVisualSvg(title, built.payload),
      pythonScript: generatePythonScriptForVisual(title, built.payload),
      renderedByPython: false,
      groundedFromText: built.grounded,
      extractedMetrics: built.extractedMetrics,
      widthPx: EXHIBIT_WIDTH,
      heightPx: EXHIBIT_HEIGHT,
      payload: built.payload,
      sourceFileNames: chapter.sourceFileName ? [chapter.sourceFileName] : undefined,
    };
  }

  if (archetype === 'ecu_pinout_harness') {
    const built = buildEcuPinoutFromText(chapter.title, chapterText);
    const title = `نقشه تعاملی پین‌اوت و ریل‌های سوکت ${built.payload.ecuName}`;
    return {
      type: 'adaptive_visual',
      id: baseId,
      visualKind: 'ecu_pinout',
      archetype,
      title,
      caption: `شکل خلاقانه ${toPersianDigits(chapter.chapterNumber)}: ${title}`,
      pedagogicalTakeaway: 'پایه‌های کلیدی به ۵ گروه رنگی تفکیک شده‌اند تا پیش از اتصال پروگرامر یا عیب‌یابی سیم‌کشی، خطوط تغذیه +12V، بدنه، شبکه CAN/K-Line و سنسورها بدون خطا تفکیک شوند.',
      svgMarkup: buildAdaptiveVisualSvg(title, built.payload),
      pythonScript: generatePythonScriptForVisual(title, built.payload),
      renderedByPython: false,
      groundedFromText: built.grounded,
      extractedMetrics: built.extractedMetrics,
      widthPx: EXHIBIT_WIDTH,
      heightPx: EXHIBIT_HEIGHT,
      payload: built.payload,
      sourceFileNames: chapter.sourceFileName ? [chapter.sourceFileName] : undefined,
    };
  }

  if (archetype === 'diagnostics_dtc_waveform') {
    const built = buildDiagnosticWaveformFromText(chapter.title, chapterText);
    const title = `آزمایشگاه اسیلوسکوپ و مقایسه شکل‌موج — ${built.payload.sensorName}`;
    return {
      type: 'adaptive_visual',
      id: baseId,
      visualKind: 'diagnostic_waveform',
      archetype,
      title,
      caption: `شکل خلاقانه ${toPersianDigits(chapter.chapterNumber)}: ${title}`,
      pedagogicalTakeaway: `مقایسه هم‌زمان موج مرجع سالم (سبز) و موج معیوب (قرمز) همراه با آستانه ثبت کد خطای ${built.payload.dtcCodes.join(' / ')} برای یادگیری عیب‌یابی دقیق بدون تعویض قطعه‌محور.`,
      svgMarkup: buildAdaptiveVisualSvg(title, built.payload),
      pythonScript: generatePythonScriptForVisual(title, built.payload),
      renderedByPython: false,
      groundedFromText: built.grounded,
      extractedMetrics: built.extractedMetrics,
      widthPx: EXHIBIT_WIDTH,
      heightPx: EXHIBIT_HEIGHT,
      payload: built.payload,
      sourceFileNames: chapter.sourceFileName ? [chapter.sourceFileName] : undefined,
    };
  }

  if (archetype === 'combustion_afr_ignition') {
    const built = buildAfrIgnitionFromText(chapter.title, chapterText);
    const title = `منحنی آوانس جرقه (MBT)، حاشیه ناک و طیف AFR`;
    return {
      type: 'adaptive_visual',
      id: baseId,
      visualKind: 'afr_ignition_curve',
      archetype,
      title,
      caption: `شکل خلاقانه ${toPersianDigits(chapter.chapterNumber)}: ${title}`,
      pedagogicalTakeaway: `نگه‌داشتن آوانس جرقه در حاشیه امن زیر مرز ناک همراه با هدف AFR=${toPersianDigits(built.payload.targetWotAfr)}:1 در تمام‌گاز، بیشترین گشتاور را بدون افزایش خطرناک دمای احتراق تضمین می‌کند.`,
      svgMarkup: buildAdaptiveVisualSvg(title, built.payload),
      pythonScript: generatePythonScriptForVisual(title, built.payload),
      renderedByPython: false,
      groundedFromText: built.grounded,
      extractedMetrics: built.extractedMetrics,
      widthPx: EXHIBIT_WIDTH,
      heightPx: EXHIBIT_HEIGHT,
      payload: built.payload,
      sourceFileNames: chapter.sourceFileName ? [chapter.sourceFileName] : undefined,
    };
  }

  if (archetype === 'thermal_pressure_telemetry') {
    return createNumericTelemetryExhibitForChapter({ chapter, chapterText });
  }

  return null;
}

export interface AdaptiveVisualInjectionSummary {
  profile: AdaptiveProjectProfile;
  injectedCount: number;
  byVisualKind: Record<string, number>;
}

/**
 * Inspects every chapter of a ParsedBook and injects tailored, domain-specific
 * creative visual exhibits (Dyno Python charts, WinOLS heatmaps/3D surfaces,
 * ECU pinout matrices, Diagnostic waveforms, AFR/Ignition labs) with zero duplication.
 */
export function injectAdaptiveVisualExhibitsIntoBook(
  book: ParsedBook,
  config: DocxExportConfig,
  existingProfile?: AdaptiveProjectProfile
): AdaptiveVisualInjectionSummary {
  const chapterTexts = book.chapters.map((ch) => {
    const intro = extractTextFromBlocks(ch.introBlocks);
    const secs = ch.sections.map((s) => `${s.title}\n${extractTextFromBlocks(s.blocks)}`).join('\n');
    return `${ch.title}\n${intro}\n${secs}`;
  });

  const computedProfile = analyzeContentNatureForProject({
    texts: chapterTexts,
    fileNames: book.sourceFiles,
    fileCount: book.sourceFiles.length,
    unitCount: chapterTexts.length,
    existingChanges: existingProfile?.autoAppliedChanges,
  });

  const mergedProfile: AdaptiveProjectProfile = {
    ...computedProfile,
    autoAppliedChanges:
      existingProfile?.autoAppliedChanges && existingProfile.autoAppliedChanges.length > 0
        ? existingProfile.autoAppliedChanges
        : applyAdaptiveProjectSettings(config, computedProfile).changes,
  };

  book.adaptiveVisualProfile = mergedProfile;

  const byVisualKind: Record<string, number> = {};
  let injectedCount = 0;

  if (config.adaptiveVisualsEnabled === false) {
    return { profile: mergedProfile, injectedCount: 0, byVisualKind };
  }

  for (let idx = 0; idx < book.chapters.length; idx++) {
    const ch = book.chapters[idx];
    // Skip synthetic WinOLS appendix chapter
    if (ch.id === 'ch_winols_action_guide') continue;

    // Strip any older auto-generated adaptive_visual blocks so re-running stays idempotent
    ch.introBlocks = ch.introBlocks.filter((b) => b.type !== 'adaptive_visual');
    for (const sec of ch.sections) {
      sec.blocks = sec.blocks.filter((b) => b.type !== 'adaptive_visual');
    }

    const chText = chapterTexts[idx] || '';
    const chProfile = analyzeContentNatureForProject({
      texts: [chText],
      fileNames: ch.sourceFileName ? [ch.sourceFileName] : [],
    });

    if (chProfile.dominantArchetype === 'general_technical_pedagogy') continue;

    // Pick top 1 (or 2 if strong secondary domain >= 30%) creative exhibits for this chapter
    const targetArchetypes: ContentArchetypeId[] = [chProfile.dominantArchetype];
    if (
      chProfile.archetypes.length >= 2 &&
      chProfile.archetypes[1].sharePercent >= 30 &&
      chProfile.archetypes[1].score >= 8 &&
      chProfile.archetypes[1].id !== 'general_technical_pedagogy'
    ) {
      targetArchetypes.push(chProfile.archetypes[1].id);
    }

    // If chapter mentions temperature ('دما') or pressure ('فشار') keywords, ensure
    // the auto-activated Python numeric telemetry visualizer is included in Stage 4!
    const hasTempOrPressure = /دما(?:ی)?|فشار|سانتی[\s‌]?گراد|°\s*c\b|\bbar\b|\bkpa\b|\bpsi\b|\begt\b|\biat\b/i.test(
      toAsciiDigits(chText)
    );
    if (
      hasTempOrPressure &&
      !targetArchetypes.includes('thermal_pressure_telemetry') &&
      targetArchetypes.length < 3
    ) {
      targetArchetypes.push('thermal_pressure_telemetry');
    }

    for (let aIdx = 0; aIdx < targetArchetypes.length; aIdx++) {
      const archetype = targetArchetypes[aIdx];
      const exhibit = createAdaptiveVisualBlockForChapter({
        chapter: ch,
        archetype,
        chapterText: chText,
      });
      if (!exhibit) continue;

      if (ch.sections.length > 0) {
        const targetSec = ch.sections[Math.min(aIdx, ch.sections.length - 1)];
        targetSec.blocks.push(exhibit);
      } else {
        ch.introBlocks.push(exhibit);
      }

      injectedCount += 1;
      byVisualKind[exhibit.visualKind] = (byVisualKind[exhibit.visualKind] || 0) + 1;
    }
  }

  if (book.audit) {
    book.audit.generatedDiagramsInserted =
      (book.audit.generatedDiagramsInserted || 0) + injectedCount;
  }

  return {
    profile: mergedProfile,
    injectedCount,
    byVisualKind,
  };
}
