import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectQuotaTechnicalSpec,
  computeProjectQuotaSnapshot,
  EMPTY_AI_USAGE,
  estimatePersianTokensFromWords,
  extractAiUsageFromCheckpoint,
  formatCompactTokensFa,
  mergeAiUsageDelta,
} from './aiUsageMetrics.ts';

test('extractAiUsageFromCheckpoint handles missing, malformed, and populated ledgers safely', () => {
  assert.deepEqual(extractAiUsageFromCheckpoint(null), EMPTY_AI_USAGE);
  assert.deepEqual(extractAiUsageFromCheckpoint({}), EMPTY_AI_USAGE);

  const parsed = extractAiUsageFromCheckpoint({
    aiUsage: {
      promptTokens: 4200,
      outputTokens: 1100,
      thinkingTokens: 800,
      totalTokens: 6100,
      requestCount: 3,
      groundingCallCount: 1,
      deepReviewCount: 1,
      chatCallCount: 1,
      lastModelUsed: 'gemini-4-hydrogen',
    },
  });
  assert.equal(parsed.totalTokens, 6100);
  assert.equal(parsed.requestCount, 3);
  assert.equal(parsed.groundingCallCount, 1);
  assert.equal(parsed.lastModelUsed, 'gemini-4-hydrogen');
});

test('mergeAiUsageDelta accumulates token counts and request counters accurately', () => {
  const step1 = mergeAiUsageDelta(EMPTY_AI_USAGE, {
    promptTokens: 3000,
    outputTokens: 700,
    thinkingTokens: 500,
    requestCount: 1,
    groundingCallCount: 1,
    modelUsed: 'gemini-4-hydrogen',
  });
  assert.equal(step1.totalTokens, 4200);
  assert.equal(step1.requestCount, 1);
  assert.equal(step1.groundingCallCount, 1);

  const step2 = mergeAiUsageDelta(step1, {
    promptTokens: 5000,
    outputTokens: 1200,
    thinkingTokens: 1800,
    requestCount: 1,
    deepReviewCount: 1,
    modelUsed: 'gemini-4-hydrogen',
  });
  assert.equal(step2.promptTokens, 8000);
  assert.equal(step2.outputTokens, 1900);
  assert.equal(step2.thinkingTokens, 2300);
  assert.equal(step2.totalTokens, 12200);
  assert.equal(step2.requestCount, 2);
  assert.equal(step2.deepReviewCount, 1);
  assert.equal(step2.groundingCallCount, 1);
});

test('computeProjectQuotaSnapshot transitions status levels cleanly from normal to warning to critical', () => {
  const fresh = computeProjectQuotaSnapshot({
    usage: EMPTY_AI_USAGE,
    ingestedWordCount: 5000,
    queuedBytesCount: 0,
    chapterCount: 4,
    aiModel: 'gemini-4-hydrogen',
    googleSearchMode: 'conflicts_only',
    useAiBackend: true,
  });
  assert.equal(fresh.consumedTokens, 0);
  assert.equal(fresh.consumedPercent, 0);
  assert.equal(fresh.estimatedDocumentTokens, estimatePersianTokensFromWords(5000));
  assert.equal(fresh.statusLevel, 'normal');
  assert.equal(fresh.formattedCostUsd, '$0.00');

  const warn = computeProjectQuotaSnapshot({
    usage: {
      ...EMPTY_AI_USAGE,
      promptTokens: 120_000,
      outputTokens: 30_000,
      thinkingTokens: 15_000,
      totalTokens: 165_000,
      requestCount: 12,
    },
    ingestedWordCount: 12000,
    queuedBytesCount: 0,
    chapterCount: 8,
    aiModel: 'gemini-4-hydrogen',
    googleSearchMode: 'conflicts_only',
    useAiBackend: true,
  });
  assert.equal(warn.consumedPercent, 66);
  assert.equal(warn.statusLevel, 'warning');
  assert.ok(warn.estimatedPaidCostUsd > 0.1);

  const critical = computeProjectQuotaSnapshot({
    usage: {
      ...EMPTY_AI_USAGE,
      promptTokens: 180_000,
      outputTokens: 35_000,
      thinkingTokens: 15_000,
      totalTokens: 230_000,
      requestCount: 22,
    },
    ingestedWordCount: 15000,
    queuedBytesCount: 0,
    chapterCount: 10,
    aiModel: 'gemini-4-hydrogen',
    googleSearchMode: 'full_document_enrichment',
    useAiBackend: true,
  });
  assert.equal(critical.statusLevel, 'critical');
  assert.equal(critical.consumedPercent, 92);
});

test('formatCompactTokensFa formats small, thousand, and million token counts in Persian digits', () => {
  assert.equal(formatCompactTokensFa(0), '۰');
  assert.equal(formatCompactTokensFa(850), '۸۵۰');
  assert.equal(formatCompactTokensFa(12400), '۱۲.۴ هزار');
  assert.equal(formatCompactTokensFa(1_250_000), '۱.۲۵ میلیون');
});

test('buildProjectQuotaTechnicalSpec computes model rates, shares, remaining budgets, and grounding labels accurately', () => {
  const hydro = buildProjectQuotaTechnicalSpec({
    usage: {
      ...EMPTY_AI_USAGE,
      promptTokens: 60_000,
      outputTokens: 25_000,
      thinkingTokens: 15_000,
      totalTokens: 100_000,
      requestCount: 10,
    },
    ingestedWordCount: 8000,
    queuedBytesCount: 0,
    chapterCount: 6,
    aiModel: 'gemini-4-hydrogen',
    googleSearchMode: 'full_document_enrichment',
    useAiBackend: true,
  });
  assert.equal(hydro.softBudgetTokens, 250_000);
  assert.equal(hydro.remainingBudgetTokens, 150_000);
  assert.equal(hydro.remainingSoftRequests, 15);
  assert.equal(hydro.requestPercent, 40);
  assert.equal(hydro.promptSharePercent, 60);
  assert.equal(hydro.thinkingSharePercent, 15);
  assert.equal(hydro.outputSharePercent, 25);
  assert.equal(hydro.inputRatePerMillionUsd, 0.3);
  assert.equal(hydro.outputRatePerMillionUsd, 2.5);
  assert.equal(hydro.httpPayloadLimitMb, 30);
  assert.ok(hydro.groundingModeLabel.includes('کل سند'));

  const lite = buildProjectQuotaTechnicalSpec({
    usage: EMPTY_AI_USAGE,
    ingestedWordCount: 0,
    queuedBytesCount: 50_000,
    chapterCount: 2,
    aiModel: 'gemini-3.1-flash-lite',
    googleSearchMode: 'conflicts_only',
    useAiBackend: false,
  });
  assert.equal(lite.softBudgetTokens, 400_000);
  assert.equal(lite.softRequestCap, 40);
  assert.equal(lite.estimatedNextPassTokens, 0);
  assert.equal(lite.promptSharePercent, 0);
  assert.equal(lite.inputRatePerMillionUsd, 0.1);
  assert.equal(lite.outputRatePerMillionUsd, 0.4);
});

