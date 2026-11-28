import type { AiModelId, ProjectStatus, ProjectSummaryDto } from './bookTypes.ts';
import { getGoogleModelMeta } from './aiProviderConfig.ts';
import {
  estimateWordPagesFromTokens,
  extractAiUsageFromCheckpoint,
  type QuotaStatusLevel,
} from './aiUsageMetrics.ts';
import type { BookWorkflowStageId } from './bookWorkflow.ts';

export type PortfolioStatusBucket = 'completed' | 'inProgress' | 'draft' | 'error';

export interface PortfolioStatusCounts {
  completed: number;
  inProgress: number;
  draft: number;
  error: number;
}

export interface PortfolioProjectRow {
  id: string;
  title: string;
  status: ProjectStatus;
  bucket: PortfolioStatusBucket;
  stage: BookWorkflowStageId;
  fileCount: number;
  wordCount: number;
  totalTokens: number;
  requestCount: number;
  updatedAt: string;
}

export interface PortfolioDashboardMetrics {
  totalProjects: number;
  statusCounts: PortfolioStatusCounts;
  stageCounts: Record<BookWorkflowStageId, number>;
  totalProcessedFiles: number;
  totalProcessedWords: number;
  totalTokensConsumed: number;
  totalPromptTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  totalAiRequests: number;
  totalGroundingCalls: number;
  totalDeepReviews: number;
  totalChatCalls: number;
  consumedPagesEquivalent: number;
  overallBudgetTokens: number;
  overallConsumedPercent: number;
  overallRemainingTokens: number;
  overallRemainingPercent: number;
  overallQuotaLevel: QuotaStatusLevel;
  overallQuotaLabel: string;
  tokenShareBreakdown: {
    promptPercent: number;
    outputPercent: number;
    thinkingPercent: number;
  };
  topProjects: PortfolioProjectRow[];
}

export function classifyProjectStatusBucket(
  status: ProjectStatus,
  pipelineStage: number
): PortfolioStatusBucket {
  if (status === 'error') return 'error';
  if (status === 'completed' || pipelineStage >= 5) return 'completed';
  if (
    status === 'ingesting' ||
    status === 'deduping' ||
    status === 'awaiting_outline' ||
    status === 'structuring' ||
    status === 'paused' ||
    pipelineStage >= 2
  ) {
    return 'inProgress';
  }
  return 'draft';
}

function clampStage(rawStage: number): BookWorkflowStageId {
  if (!Number.isFinite(rawStage) || rawStage <= 1) return 1;
  if (rawStage >= 5) return 5;
  return Math.round(rawStage) as BookWorkflowStageId;
}

function getProjectFileCount(project: ProjectSummaryDto): number {
  if (typeof project.sourceFileCount === 'number' && Number.isFinite(project.sourceFileCount)) {
    return Math.max(0, Math.round(project.sourceFileCount));
  }
  const cpCount = Number(
    (project.checkpointJson as { processedFileCount?: unknown } | null)?.processedFileCount
  );
  return Number.isFinite(cpCount) && cpCount > 0 ? Math.round(cpCount) : 0;
}

/**
 * Pure portfolio-wide aggregation across all user projects:
 * computes status distribution, 5-stage progress bars, total processed files/words,
 * and overall AI quota consumption for the main dashboard widget.
 */
export function computePortfolioDashboardMetrics(
  projects: ProjectSummaryDto[],
  activeAiModel: AiModelId | string = 'gemini-4-hydrogen'
): PortfolioDashboardMetrics {
  const statusCounts: PortfolioStatusCounts = {
    completed: 0,
    inProgress: 0,
    draft: 0,
    error: 0,
  };

  const stageCounts: Record<BookWorkflowStageId, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  let totalProcessedFiles = 0;
  let totalProcessedWords = 0;
  let totalTokensConsumed = 0;
  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let totalThinkingTokens = 0;
  let totalAiRequests = 0;
  let totalGroundingCalls = 0;
  let totalDeepReviews = 0;
  let totalChatCalls = 0;

  const rows: PortfolioProjectRow[] = projects.map((p) => {
    const stage = clampStage(p.pipelineStage);
    const bucket = classifyProjectStatusBucket(p.status, p.pipelineStage);
    const fileCount = getProjectFileCount(p);
    const wordCount =
      typeof p.totalWordCount === 'number' && Number.isFinite(p.totalWordCount)
        ? Math.max(0, Math.round(p.totalWordCount))
        : 0;
    const usage = extractAiUsageFromCheckpoint(p.checkpointJson);

    statusCounts[bucket] += 1;
    stageCounts[stage] += 1;
    totalProcessedFiles += fileCount;
    totalProcessedWords += wordCount;
    totalTokensConsumed += usage.totalTokens;
    totalPromptTokens += usage.promptTokens;
    totalOutputTokens += usage.outputTokens;
    totalThinkingTokens += usage.thinkingTokens;
    totalAiRequests += usage.requestCount;
    totalGroundingCalls += usage.groundingCallCount;
    totalDeepReviews += usage.deepReviewCount;
    totalChatCalls += usage.chatCallCount;

    return {
      id: p.id,
      title: p.title,
      status: p.status,
      bucket,
      stage,
      fileCount,
      wordCount,
      totalTokens: usage.totalTokens,
      requestCount: usage.requestCount,
      updatedAt: p.updatedAt,
    };
  });

  const modelMeta = getGoogleModelMeta(activeAiModel);
  // Portfolio-wide soft quota scales reasonably with project count (at least 1x model soft budget,
  // capped cleanly so overall gauge always reflects realistic workspace capacity).
  const projectMultiplier = Math.max(1, Math.min(5, projects.length || 1));
  const overallBudgetTokens = modelMeta.softBudgetTokens * projectMultiplier;
  const overallConsumedPercent =
    overallBudgetTokens > 0
      ? Math.min(100, Math.round((totalTokensConsumed / overallBudgetTokens) * 100))
      : 0;
  const overallRemainingTokens = Math.max(0, overallBudgetTokens - totalTokensConsumed);
  const overallRemainingPercent = Math.max(0, 100 - overallConsumedPercent);

  let overallQuotaLevel: QuotaStatusLevel = 'normal';
  let overallQuotaLabel = totalTokensConsumed === 0 ? 'سهمیه کامل و آماده' : 'مصرف بهینه و متعادل';
  if (overallConsumedPercent >= 85) {
    overallQuotaLevel = 'critical';
    overallQuotaLabel = 'نزدیک به سقف سهمیه کل';
  } else if (overallConsumedPercent >= 60) {
    overallQuotaLevel = 'warning';
    overallQuotaLabel = 'مصرف متوسط به بالا';
  }

  const componentSum = totalPromptTokens + totalOutputTokens + totalThinkingTokens;
  const tokenShareBreakdown =
    componentSum > 0
      ? {
          promptPercent: Math.round((totalPromptTokens / componentSum) * 100),
          outputPercent: Math.round((totalOutputTokens / componentSum) * 100),
          thinkingPercent: Math.max(
            0,
            100 -
              Math.round((totalPromptTokens / componentSum) * 100) -
              Math.round((totalOutputTokens / componentSum) * 100)
          ),
        }
      : { promptPercent: 0, outputPercent: 0, thinkingPercent: 0 };

  const topProjects = [...rows]
    .sort((a, b) => {
      if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
      if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, 4);

  return {
    totalProjects: projects.length,
    statusCounts,
    stageCounts,
    totalProcessedFiles,
    totalProcessedWords,
    totalTokensConsumed,
    totalPromptTokens,
    totalOutputTokens,
    totalThinkingTokens,
    totalAiRequests,
    totalGroundingCalls,
    totalDeepReviews,
    totalChatCalls,
    consumedPagesEquivalent: estimateWordPagesFromTokens(totalTokensConsumed),
    overallBudgetTokens,
    overallConsumedPercent,
    overallRemainingTokens,
    overallRemainingPercent,
    overallQuotaLevel,
    overallQuotaLabel,
    tokenShareBreakdown,
    topProjects,
  };
}
