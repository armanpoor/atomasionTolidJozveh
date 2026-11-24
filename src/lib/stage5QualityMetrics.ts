import type {
  AuditReportDto,
  ConflictDto,
  DeepReviewReportDto,
  OutlineNodeDto,
  ParsedBook,
  ValidationDomain,
} from './bookTypes.ts';
import type { HarnessState } from './harness/types.ts';
import type { WinolsExtractionReport } from './winolsMapGuide.ts';

export interface Stage5QualityMetricsInput {
  book: ParsedBook;
  outlineNodes?: OutlineNodeDto[];
  auditReport?: AuditReportDto | null;
  conflicts?: ConflictDto[];
  winolsGuideReport?: WinolsExtractionReport | null;
  harnessState?: HarnessState | null;
  deepReviewReport?: DeepReviewReportDto | null;
  validationDomain?: ValidationDomain;
}

export type WinolsComplianceEvaluationMode =
  | 'evaluated'
  | 'no_maps_detected'
  | 'general_domain_not_applicable';

export interface Stage5QualityMetrics {
  // 1. Text Error Rate (نرخ خطاهای متنی)
  textErrorRatePercent: number;
  cleanTextPercent: number;
  openConflictsCount: number;
  unresolvedQuarantineCount: number;
  unverifiedSectionsCount: number;
  uncoveredPercent: number;
  emptySectionsCount: number;
  gapFlagCount: number;
  textErrorStatusLabelFa: string;

  // 2. Heading Cohesion (انسجام سرفصل‌ها)
  headingCohesionPercent: number;
  headingGapPercent: number;
  totalChapters: number;
  totalSections: number;
  outlineNodesCount: number;
  matchedChaptersCount: number;
  unassignedChunksCount: number;
  headingCohesionStatusLabelFa: string;

  // 3. WinOLS Standards Compliance (درصد تطبیق با استانداردهای WinOLS)
  winolsCompliancePercent: number;
  winolsGapPercent: number;
  winolsMode: WinolsComplianceEvaluationMode;
  winolsDomainActive: boolean;
  mapsDetected: number;
  mapsWithHexCount: number;
  mapsWithZoneMatrixCount: number;
  mapsWithDamosMetaCount: number;
  highConfidenceMapsCount: number;
  hasWinolsAppendixChapter: boolean;
  ecuIssueCount: number;
  winolsStatusLabelFa: string;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeTitleKey(value: string): string {
  return value
    .replace(/^فصل\s*[\d۰-۹]+\s*[:.\-–—]?\s*/i, '')
    .replace(/^[\d۰-۹]+\s*[-–—.)]\s*/, '')
    .replace(/[‌\u200c]/g, ' ')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const GENERIC_HEADING_TOKENS = new Set([
  'بدون عنوان',
  'سایر',
  'سایر مطالب',
  'متفرقه',
  'untitled',
  'section',
  'chapter',
]);

const ECU_VIOLATION_KINDS = new Set([
  'ecu_platform_mismatch',
  'sign_inversion_detected',
  'unit_mismatch_or_conversion',
  'missing_safety_warning',
  'missing_technical_anchor',
]);

export function computeStage5QualityMetrics(
  input: Stage5QualityMetricsInput
): Stage5QualityMetrics {
  const {
    book,
    outlineNodes = [],
    auditReport = null,
    conflicts = [],
    winolsGuideReport = null,
    harnessState = null,
    deepReviewReport = null,
    validationDomain = 'ecu_winols',
  } = input;

  const chapters = Array.isArray(book?.chapters) ? book.chapters : [];
  const allSections = chapters.flatMap((ch) =>
    Array.isArray(ch.sections) ? ch.sections : []
  );
  const contentChapters = chapters.filter(
    (ch) => ch.id !== 'ch_winols_quick_guide'
  );
  const hasWinolsAppendixChapter = chapters.some(
    (ch) => ch.id === 'ch_winols_quick_guide'
  );

  // ---------------------------------------------------------------------------
  // 1. Text Error Rate (نرخ خطاهای متنی)
  // ---------------------------------------------------------------------------
  const openConflictsCount = conflicts.filter((c) => c.status === 'open').length;
  const coveragePercent =
    typeof auditReport?.coveragePercent === 'number'
      ? clampPercent(auditReport.coveragePercent)
      : 100;
  const uncoveredPercent = Math.max(0, 100 - coveragePercent);

  const quarantineItems = harnessState?.quarantineQueue ?? [];
  const unresolvedQuarantine = quarantineItems.filter((q) => !q.resolved);
  const unresolvedQuarantineCount = unresolvedQuarantine.length;

  const ledgerSections = Object.values(
    harnessState?.coverageLedger?.bySectionId ?? {}
  );
  const totalLedgerSections = ledgerSections.length;
  const unverifiedSectionsCount = ledgerSections.filter(
    (s) => s.status !== 'verified' || !s.layer1Passed || !s.layer2Passed
  ).length;

  let emptySectionsCount = 0;
  let gapFlagCount = 0;

  for (const sec of allSections) {
    const blocks = Array.isArray(sec.blocks) ? sec.blocks : [];
    const hasMeaningfulBlock = blocks.some((b) => {
      if (b.type === 'paragraph' || b.type === 'subheading') {
        return Boolean(b.text?.trim());
      }
      if (b.type === 'list') return (b.items?.length ?? 0) > 0;
      if (b.type === 'table') return (b.rows?.length ?? 0) > 0;
      if (b.type === 'callout') return (b.paragraphs?.length ?? 0) > 0;
      return true;
    });
    if (!hasMeaningfulBlock) {
      emptySectionsCount += 1;
    }

    for (const b of blocks) {
      if (
        b.type === 'callout' &&
        (b.title.includes('نقص منبع') || b.title.includes('قرنطینه'))
      ) {
        gapFlagCount += 1;
      }
    }
  }

  let errorPenalty = 0;
  // Unresolved conflicts risk (up to 25 pts)
  errorPenalty += Math.min(25, openConflictsCount * 5);
  // Uncovered source words risk (up to 40 pts)
  errorPenalty += Math.min(40, uncoveredPercent * 1.1);
  // Harness audit/quarantine risk (up to 45 pts)
  if (totalLedgerSections > 0) {
    const failedRatio =
      (unresolvedQuarantineCount + unverifiedSectionsCount * 0.5) /
      totalLedgerSections;
    errorPenalty += Math.min(45, failedRatio * 55);
  } else if (unresolvedQuarantineCount > 0) {
    errorPenalty += Math.min(45, unresolvedQuarantineCount * 12);
  }
  // Empty sections & residual gap flags in book snapshot (up to 25 pts)
  if (allSections.length > 0) {
    const structuralIssueRatio =
      (emptySectionsCount + gapFlagCount * 0.6) / allSections.length;
    errorPenalty += Math.min(25, structuralIssueRatio * 35);
  } else {
    errorPenalty += 30;
  }
  // Anti-drift audit penalty if Deep AI Review ran and reported drift below 100
  if (
    deepReviewReport &&
    typeof deepReviewReport.antiDriftIntegrityScore === 'number' &&
    deepReviewReport.antiDriftIntegrityScore < 100
  ) {
    errorPenalty += Math.min(
      20,
      (100 - clampPercent(deepReviewReport.antiDriftIntegrityScore)) * 0.5
    );
  }

  const textErrorRatePercent = clampPercent(errorPenalty);
  const cleanTextPercent = 100 - textErrorRatePercent;
  const textErrorStatusLabelFa =
    textErrorRatePercent <= 2
      ? 'سالم و بدون خطای باز'
      : textErrorRatePercent <= 10
        ? 'مطلوب با هشدار جزئی'
        : 'نیازمند بازبینی پیش از انتشار';

  // ---------------------------------------------------------------------------
  // 2. Heading Cohesion (انسجام سرفصل‌ها)
  // ---------------------------------------------------------------------------
  const topLevelOutline = outlineNodes.filter((n) => !n.parentId || n.level <= 1);
  const effectiveOutlineNodes =
    topLevelOutline.length > 0 ? topLevelOutline : outlineNodes;
  const outlineNodesCount = effectiveOutlineNodes.length;

  let matchedChaptersCount = contentChapters.length;
  let outlineAlignmentScore = 40;

  if (outlineNodesCount > 0) {
    const chapterTitleKeys = contentChapters.map((c) => normalizeTitleKey(c.title));
    let matched = 0;
    for (const node of effectiveOutlineNodes) {
      const nKey = normalizeTitleKey(node.title);
      if (!nKey) continue;
      const exactOrPartial = chapterTitleKeys.some(
        (ck) => ck === nKey || ck.includes(nKey) || nKey.includes(ck)
      );
      if (exactOrPartial) matched += 1;
    }
    matchedChaptersCount = matched;
    const countParity =
      Math.min(contentChapters.length, outlineNodesCount) /
      Math.max(1, Math.max(contentChapters.length, outlineNodesCount));
    const titleMatchRatio = matched / outlineNodesCount;
    outlineAlignmentScore = (titleMatchRatio * 0.65 + countParity * 0.35) * 40;
  } else if (contentChapters.length === 0) {
    outlineAlignmentScore = 0;
  }

  // Section & Heading structural quality (35 pts)
  let titleAndSectionScore = 0;
  if (chapters.length > 0) {
    const validChapterTitles = chapters.filter((ch) => {
      const key = normalizeTitleKey(ch.title);
      return key.length >= 2 && !GENERIC_HEADING_TOKENS.has(key);
    }).length;
    const chapterTitleRatio = validChapterTitles / chapters.length;

    const validSections = allSections.filter((sec) => {
      const key = normalizeTitleKey(sec.title);
      const hasBlocks = Array.isArray(sec.blocks) && sec.blocks.length > 0;
      return key.length >= 2 && !GENERIC_HEADING_TOKENS.has(key) && hasBlocks;
    }).length;
    const sectionRatio =
      allSections.length > 0 ? validSections / allSections.length : 0;

    titleAndSectionScore = (chapterTitleRatio * 0.45 + sectionRatio * 0.55) * 35;
  }

  // Blueprint & chapter balance health (25 pts)
  const blueprintAudit = harnessState?.blueprint?.blueprintAudit;
  const unassignedChunksCount = blueprintAudit?.unassignedChunkIds?.length ?? 0;
  let structuralBalanceScore = 25;

  if (blueprintAudit) {
    const totalChunks = Math.max(
      1,
      harnessState?.blueprint?.totalChunks ?? 1
    );
    const brokenContinuity = blueprintAudit.brokenContinuityChunkIds?.length ?? 0;
    const duplicatedChunks = blueprintAudit.duplicatedChunkIds?.length ?? 0;
    const anomalyRatio =
      (unassignedChunksCount + brokenContinuity + duplicatedChunks * 0.5) /
      totalChunks;
    structuralBalanceScore = Math.max(0, 25 - anomalyRatio * 50);
  } else if (chapters.length > 0) {
    const chaptersWithSections = chapters.filter(
      (c) => (c.sections?.length ?? 0) > 0
    ).length;
    structuralBalanceScore = (chaptersWithSections / chapters.length) * 25;
  } else {
    structuralBalanceScore = 0;
  }

  let headingCohesionPercent = clampPercent(
    outlineAlignmentScore + titleAndSectionScore + structuralBalanceScore
  );

  // Subtle calibration with Deep Review overallScore if available
  if (
    deepReviewReport &&
    typeof deepReviewReport.overallScore === 'number' &&
    chapters.length > 0
  ) {
    headingCohesionPercent = clampPercent(
      headingCohesionPercent * 0.8 + clampPercent(deepReviewReport.overallScore) * 0.2
    );
  }

  const headingGapPercent = 100 - headingCohesionPercent;
  const headingCohesionStatusLabelFa =
    headingCohesionPercent >= 85
      ? 'ساختار و سرفصل‌ها یکپارچه'
      : headingCohesionPercent >= 65
        ? 'انسجام قابل قبول'
        : 'نیازمند مرتب‌سازی سرفصل‌ها';

  // ---------------------------------------------------------------------------
  // 3. WinOLS Standards Compliance (درصد تطبیق با استانداردهای WinOLS)
  // ---------------------------------------------------------------------------
  const winolsDomainActive = validationDomain !== 'general_persian_technical';
  const entries = winolsGuideReport?.entries ?? [];
  const mapsDetected = winolsGuideReport?.mapsDetected ?? entries.length;

  let mapsWithHexCount = 0;
  let mapsWithZoneMatrixCount = 0;
  let mapsWithDamosMetaCount = 0;
  let highConfidenceMapsCount = 0;

  let perMapScoreSum = 0;
  for (const entry of entries) {
    const hasHex =
      (entry.hexAddresses?.length ?? 0) > 0 ||
      Boolean(entry.damosMeta?.baseAddressHex);
    const hasZoneOrScalar =
      entry.isScalar ||
      (entry.zoneMatrix !== null &&
        (entry.targetRpmRange !== null || entry.targetLoadRange !== null));
    const hasDamosMeta =
      entry.damosMeta?.factor !== undefined ||
      entry.ecuModels.length > 0 ||
      entry.numericValuesDetected.length > 0;
    const hasSafetyAndSteps =
      Boolean(entry.safetyChecklistFa?.trim()) &&
      (entry.winolsStepsFa?.length ?? 0) > 0;
    const isHighConfidence = entry.confidence === 'high';

    if (hasHex) mapsWithHexCount += 1;
    if (hasZoneOrScalar) mapsWithZoneMatrixCount += 1;
    if (hasDamosMeta) mapsWithDamosMetaCount += 1;
    if (isHighConfidence) highConfidenceMapsCount += 1;

    // Score each detected map out of 100:
    // 25 pts: Hex / Base address
    // 25 pts: 2D Axis / Zone matrix or scalar spec
    // 20 pts: DAMOS factor / ECU model / numeric anchors
    // 20 pts: Safety checklist & WinOLS steps
    // 10 pts: High extraction confidence
    const mapScore =
      (hasHex ? 25 : 8) +
      (hasZoneOrScalar ? 25 : 0) +
      (hasDamosMeta ? 20 : 0) +
      (hasSafetyAndSteps ? 20 : 0) +
      (isHighConfidence ? 10 : 4);
    perMapScoreSum += mapScore;
  }

  let ecuIssueCount = 0;
  for (const q of unresolvedQuarantine) {
    for (const issue of q.layer1Issues ?? []) {
      if (ECU_VIOLATION_KINDS.has(issue.kind)) {
        ecuIssueCount += 1;
      }
    }
  }

  let winolsMode: WinolsComplianceEvaluationMode = 'evaluated';
  let winolsCompliancePercent = 0;

  if (mapsDetected === 0) {
    if (!winolsDomainActive) {
      winolsMode = 'general_domain_not_applicable';
      winolsCompliancePercent = 100;
    } else {
      winolsMode = 'no_maps_detected';
      winolsCompliancePercent = 0;
    }
  } else {
    winolsMode = 'evaluated';
    const avgMapScore = perMapScoreSum / mapsDetected;
    const appendixBonus = hasWinolsAppendixChapter ? 5 : 0;
    const ecuIssuePenalty = Math.min(35, ecuIssueCount * 8);
    winolsCompliancePercent = clampPercent(
      avgMapScore + appendixBonus - ecuIssuePenalty
    );
  }

  const winolsGapPercent = 100 - winolsCompliancePercent;
  const winolsStatusLabelFa =
    winolsMode === 'general_domain_not_applicable'
      ? 'دامنه عمومی فارسی (بدون الزام WinOLS)'
      : winolsMode === 'no_maps_detected'
        ? 'نقشه WinOLS در متن شناسایی نشد'
        : winolsCompliancePercent >= 85
          ? 'تطبیق بالا با استاندارد WinOLS / DAMOS'
          : winolsCompliancePercent >= 60
            ? 'تطبیق متوسط (تکمیل آدرس هگز توصیه می‌شود)'
            : 'تطبیق پایین یا نیازمند ممیزی فنی ECU';

  return {
    textErrorRatePercent,
    cleanTextPercent,
    openConflictsCount,
    unresolvedQuarantineCount,
    unverifiedSectionsCount,
    uncoveredPercent,
    emptySectionsCount,
    gapFlagCount,
    textErrorStatusLabelFa,

    headingCohesionPercent,
    headingGapPercent,
    totalChapters: chapters.length,
    totalSections: allSections.length,
    outlineNodesCount,
    matchedChaptersCount,
    unassignedChunksCount,
    headingCohesionStatusLabelFa,

    winolsCompliancePercent,
    winolsGapPercent,
    winolsMode,
    winolsDomainActive,
    mapsDetected,
    mapsWithHexCount,
    mapsWithZoneMatrixCount,
    mapsWithDamosMetaCount,
    highConfidenceMapsCount,
    hasWinolsAppendixChapter,
    ecuIssueCount,
    winolsStatusLabelFa,
  };
}

export interface Stage5ComparativePieItem {
  id: 'text_errors' | 'heading_cohesion' | 'winols_compliance';
  name: string;
  shortLabel: string;
  value: number;
  color: string;
  unit: string;
  description: string;
  statusLabelFa: string;
}

export function buildStage5ComparativePieChartData(
  metrics: Stage5QualityMetrics
): Stage5ComparativePieItem[] {
  const errorColor =
    metrics.textErrorRatePercent <= 2
      ? '#16A34A'
      : metrics.textErrorRatePercent <= 10
        ? '#D97706'
        : '#DC2626';

  const cohesionColor =
    metrics.headingCohesionPercent >= 85
      ? '#1E3A5F'
      : metrics.headingCohesionPercent >= 65
        ? '#D97706'
        : '#DC2626';

  const winolsColor =
    metrics.winolsMode === 'general_domain_not_applicable'
      ? '#64748B'
      : metrics.winolsCompliancePercent >= 85
        ? '#14532D'
        : metrics.winolsCompliancePercent >= 60
          ? '#D97706'
          : '#DC2626';

  return [
    {
      id: 'text_errors',
      name: 'نرخ خطاهای متنی',
      shortLabel: 'خطای متنی',
      value: metrics.textErrorRatePercent,
      color: errorColor,
      unit: '٪',
      description: 'تناقض‌های باز، قرنطینه و افت پوشش کلمات',
      statusLabelFa: metrics.textErrorStatusLabelFa,
    },
    {
      id: 'heading_cohesion',
      name: 'امتیاز انسجام سرفصل‌ها',
      shortLabel: 'انسجام سرفصل‌ها',
      value: metrics.headingCohesionPercent,
      color: cohesionColor,
      unit: '٪',
      description: 'انطباق ساختار درختی فصول و زیربخش‌ها با فهرست مصوب',
      statusLabelFa: metrics.headingCohesionStatusLabelFa,
    },
    {
      id: 'winols_compliance',
      name: 'تطبیق با استانداردهای WinOLS',
      shortLabel: 'تطبیق WinOLS',
      value:
        metrics.winolsMode === 'general_domain_not_applicable'
          ? 100
          : metrics.winolsCompliancePercent,
      color: winolsColor,
      unit: '٪',
      description:
        metrics.winolsMode === 'general_domain_not_applicable'
          ? 'معاف از ضوابط WinOLS در دامنه عمومی فارسی'
          : 'صحت آدرس هگز، ماتریس RPM×بار، و ضرایب DAMOS / A2L',
      statusLabelFa: metrics.winolsStatusLabelFa,
    },
  ];
}
