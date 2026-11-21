import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyProjectStatusBucket,
  computePortfolioDashboardMetrics,
} from './dashboardMetrics.ts';
import type { ProjectSummaryDto } from './bookTypes.ts';

function makeProject(overrides: Partial<ProjectSummaryDto>): ProjectSummaryDto {
  return {
    id: overrides.id || 'p1',
    title: overrides.title || 'پروژه تستی',
    workflowMode: overrides.workflowMode || 'multi_merge',
    pipelineStage: overrides.pipelineStage ?? 1,
    status: overrides.status || 'draft',
    settingsJson: overrides.settingsJson || {},
    checkpointJson: overrides.checkpointJson || {},
    sourceFileCount: overrides.sourceFileCount,
    totalWordCount: overrides.totalWordCount,
    createdAt: overrides.createdAt || '2026-11-20T10:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-11-21T10:00:00.000Z',
  };
}

test('computePortfolioDashboardMetrics handles empty projects array cleanly', () => {
  const m = computePortfolioDashboardMetrics([], 'gemini-4-hydrogen');
  assert.equal(m.totalProjects, 0);
  assert.equal(m.totalProcessedFiles, 0);
  assert.equal(m.totalTokensConsumed, 0);
  assert.equal(m.overallConsumedPercent, 0);
  assert.equal(m.overallRemainingPercent, 100);
  assert.equal(m.overallQuotaLevel, 'normal');
  assert.equal(m.topProjects.length, 0);
});

test('computePortfolioDashboardMetrics accurately aggregates statuses, stages, files, and overall AI quota across projects', () => {
  const projects: ProjectSummaryDto[] = [
    makeProject({
      id: 'p_done',
      title: 'کتاب مرجع کالیبراسیون',
      status: 'completed',
      pipelineStage: 5,
      sourceFileCount: 12,
      totalWordCount: 42000,
      checkpointJson: {
        aiUsage: {
          promptTokens: 80000,
          outputTokens: 30000,
          thinkingTokens: 10000,
          totalTokens: 120000,
          requestCount: 14,
          groundingCallCount: 4,
          deepReviewCount: 1,
          chatCallCount: 3,
        },
      },
    }),
    makeProject({
      id: 'p_outline',
      title: 'جزوه سیستم سوخت',
      status: 'awaiting_outline',
      pipelineStage: 3,
      sourceFileCount: 5,
      totalWordCount: 14500,
      checkpointJson: {
        aiUsage: {
          promptTokens: 20000,
          outputTokens: 10000,
          thinkingTokens: 0,
          totalTokens: 30000,
          requestCount: 4,
        },
      },
    }),
    makeProject({
      id: 'p_draft',
      title: 'پروژه جدید',
      status: 'draft',
      pipelineStage: 1,
      sourceFileCount: 0,
      totalWordCount: 0,
      checkpointJson: {},
    }),
    makeProject({
      id: 'p_err',
      title: 'پروژه با خطا',
      status: 'error',
      pipelineStage: 2,
      sourceFileCount: 3,
      totalWordCount: 6000,
      checkpointJson: {},
    }),
  ];

  const m = computePortfolioDashboardMetrics(projects, 'gemini-4-hydrogen');
  assert.equal(m.totalProjects, 4);
  assert.deepEqual(m.statusCounts, {
    completed: 1,
    inProgress: 1,
    draft: 1,
    error: 1,
  });
  assert.deepEqual(m.stageCounts, {
    1: 1,
    2: 1,
    3: 1,
    4: 0,
    5: 1,
  });
  assert.equal(m.totalProcessedFiles, 20);
  assert.equal(m.totalProcessedWords, 62500);
  assert.equal(m.totalTokensConsumed, 150000);
  assert.equal(m.totalAiRequests, 18);
  assert.equal(m.totalGroundingCalls, 4);
  assert.equal(m.totalDeepReviews, 1);
  assert.equal(m.totalChatCalls, 3);
  assert.equal(m.topProjects[0].id, 'p_done');
  assert.equal(
    m.tokenShareBreakdown.promptPercent +
      m.tokenShareBreakdown.outputPercent +
      m.tokenShareBreakdown.thinkingPercent,
    100
  );
  assert.equal(classifyProjectStatusBucket('paused', 2), 'inProgress');
});
