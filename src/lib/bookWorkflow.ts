import type { ProjectBundleDto } from './bookTypes.ts';

export type BookWorkflowStageId = 1 | 2 | 3 | 4 | 5;

export interface BookWorkflowStageMeta {
  stage: BookWorkflowStageId;
  key: 'ingest' | 'dedup' | 'outline' | 'preview' | 'export';
  titleFa: string;
  shortTitleFa: string;
  singleResponsibilityFa: string;
  nextActionLabelFa: string;
}

/**
 * 5 discrete, single-responsibility book authoring stages so each step performs
 * ONE focused job and waits for the author's review before moving forward.
 */
export const BOOK_WORKFLOW_STAGES: readonly BookWorkflowStageMeta[] = [
  {
    stage: 1,
    key: 'ingest',
    titleFa: '۱. دریافت و استخراج فایل‌ها',
    shortTitleFa: '۱. دریافت',
    singleResponsibilityFa:
      'فقط خواندن فایل‌های ورودی و استخراج دقیق واحدهای متنی (بدون ادغام یا تغییر ساختار).',
    nextActionLabelFa: 'اجرای مرحله ۲: ادغام بدون افت و کشف تناقض‌ها',
  },
  {
    stage: 2,
    key: 'dedup',
    titleFa: '۲. ادغام بدون افت و بررسی تناقض',
    shortTitleFa: '۲. ممیزی و ادغام',
    singleResponsibilityFa:
      'فقط حذف تکرارهای عینی/معنایی و شناسایی تناقض‌های واقعی برای تصمیم‌گیری شما.',
    nextActionLabelFa: 'ادامه به مرحله ۳: چیدمان و ویرایش فصل‌ها',
  },
  {
    stage: 3,
    key: 'outline',
    titleFa: '۳. چیدمان و ویرایش فصل‌بندی',
    shortTitleFa: '۳. فصل‌بندی',
    singleResponsibilityFa:
      'فقط مرتب‌سازی، نام‌گذاری و ادغام فصل‌ها پیش از ساخت و صفحه‌آرایی نهایی کتاب.',
    nextActionLabelFa: 'اجرای مرحله ۴: صفحه‌آرایی و ساخت پیش‌نمایش کتاب',
  },
  {
    stage: 4,
    key: 'preview',
    titleFa: '۴. صفحه‌آرایی، کادربندی و غنی‌سازی',
    shortTitleFa: '۴. صفحه‌آرایی',
    singleResponsibilityFa:
      'بازبینی پیش‌نمایش کادربندی‌شده کتاب و اجرای اختیاری و جداگانه «بازبینی عمیق» یا «تکمیل گوگل».',
    nextActionLabelFa: 'ادامه به مرحله ۵: تأیید نهایی و دریافت خروجی',
  },
  {
    stage: 5,
    key: 'export',
    titleFa: '۵. تأیید نهایی و خروجی ورد / چاپ',
    shortTitleFa: '۵. خروجی',
    singleResponsibilityFa:
      'بررسی چک‌لیست نهایی پوشش ۱۰۰٪ و دریافت فایل استاندارد Word (.docx)، Markdown یا چاپ.',
    nextActionLabelFa: 'دانلود فایل ورد استاندارد (.docx)',
  },
] as const;

export interface WorkflowProgressSnapshot {
  hasIngestedFiles: boolean;
  hasDedupResults: boolean;
  hasOutline: boolean;
  hasFinalBook: boolean;
  highestUnlockedStage: BookWorkflowStageId;
  recommendedStage: BookWorkflowStageId;
  completedStages: Record<BookWorkflowStageId, boolean>;
  unlockedStages: Record<BookWorkflowStageId, boolean>;
}

/**
 * Computes which workflow stages are completed, unlocked, and currently recommended
 * strictly from the persisted project bundle state.
 */
export function computeWorkflowProgress(params: {
  bundle: ProjectBundleDto | null;
  queuedFilesCount?: number;
}): WorkflowProgressSnapshot {
  const { bundle } = params;
  const sourceCount = bundle?.sourceFiles.length ?? 0;
  const unitCount = bundle?.contentUnits.length ?? 0;
  const outlineCount = bundle?.outlineNodes.length ?? 0;
  const hasFinalBook = Boolean(bundle?.project.bookSnapshotJson);
  const pipelineStage = bundle?.project.pipelineStage ?? 1;

  const hasIngestedFiles = sourceCount > 0 && unitCount > 0;
  const hasDedupResults =
    hasIngestedFiles &&
    (pipelineStage >= 2 ||
      outlineCount > 0 ||
      (bundle?.dedupClusters.length ?? 0) > 0 ||
      (bundle?.conflicts.length ?? 0) > 0);
  const hasOutline = outlineCount > 0;

  const completedStages: Record<BookWorkflowStageId, boolean> = {
    1: hasIngestedFiles,
    2: hasDedupResults && hasOutline,
    3: hasOutline && (hasFinalBook || pipelineStage >= 4),
    4: hasFinalBook,
    5: hasFinalBook && bundle?.project.status === 'completed',
  };

  const unlockedStages: Record<BookWorkflowStageId, boolean> = {
    1: true,
    2: hasIngestedFiles,
    3: hasOutline,
    4: hasFinalBook,
    5: hasFinalBook,
  };

  let highestUnlockedStage: BookWorkflowStageId = 1;
  if (unlockedStages[5]) highestUnlockedStage = 5;
  else if (unlockedStages[4]) highestUnlockedStage = 4;
  else if (unlockedStages[3]) highestUnlockedStage = 3;
  else if (unlockedStages[2]) highestUnlockedStage = 2;

  let recommendedStage: BookWorkflowStageId = 1;
  if (!hasIngestedFiles) {
    recommendedStage = 1;
  } else if (!hasDedupResults || !hasOutline) {
    recommendedStage = 2;
  } else if (!hasFinalBook) {
    recommendedStage = 3;
  } else {
    recommendedStage = 4;
  }

  return {
    hasIngestedFiles,
    hasDedupResults,
    hasOutline,
    hasFinalBook,
    highestUnlockedStage,
    recommendedStage,
    completedStages,
    unlockedStages,
  };
}

export function getStageMeta(stage: BookWorkflowStageId): BookWorkflowStageMeta {
  return BOOK_WORKFLOW_STAGES.find((s) => s.stage === stage) || BOOK_WORKFLOW_STAGES[0];
}
