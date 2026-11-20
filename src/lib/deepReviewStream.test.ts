import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeepReviewReport, parseNdjsonBuffer } from './deepReviewStream.ts';

test('normalizeDeepReviewReport returns null for missing/invalid input and defaults appliedCounts safely', () => {
  assert.equal(normalizeDeepReviewReport(undefined), null);
  assert.equal(normalizeDeepReviewReport(null), null);
  assert.equal(normalizeDeepReviewReport('invalid'), null);

  // Even if appliedCounts is missing from a partial object, never throw and default counts to 0
  const partial = normalizeDeepReviewReport({
    overallScore: 94,
    overallAssessment: 'ساختار سند یکدست است.',
    thinkingLevel: 'XHIGH',
  });
  assert.ok(partial);
  assert.equal(partial.overallScore, 94);
  assert.equal(partial.thinkingLevel, 'XHIGH');
  assert.deepEqual(partial.appliedCounts, {
    titlesRefined: 0,
    calloutsAdded: 0,
    tablesAdded: 0,
    paragraphsAdded: 0,
  });
  assert.deepEqual(partial.findings, []);
});

test('parseNdjsonBuffer parses progress, complete, and error events across split chunks', () => {
  const chunk1 =
    '{"type":"progress","percent":18,"stage":"آماده‌سازی فصل‌ها"}\n' +
    '{"type":"progress","percent":45,"stage":"استدلال عمیق","model":"gemini-4-hydrogen"';
  const res1 = parseNdjsonBuffer(chunk1);
  assert.equal(res1.events.length, 1);
  assert.equal(res1.events[0].type, 'progress');
  if (res1.events[0].type === 'progress') {
    assert.equal(res1.events[0].percent, 18);
  }
  assert.ok(res1.remainder.includes('"percent":45'));

  const chunk2 =
    res1.remainder +
    ',"thinkingLevel":"XHIGH"}\n' +
    '{"type":"complete","review":{"overallScore":92,"thinkingLevel":"XHIGH","appliedCounts":{"titlesRefined":2,"calloutsAdded":3,"tablesAdded":1,"paragraphsAdded":1},"findings":[]}}\n';
  const res2 = parseNdjsonBuffer(chunk2);
  assert.equal(res2.remainder, '');
  assert.equal(res2.events.length, 2);
  assert.equal(res2.events[0].type, 'progress');
  assert.equal(res2.events[1].type, 'complete');
  if (res2.events[1].type === 'complete') {
    assert.equal(res2.events[1].review.appliedCounts.calloutsAdded, 3);
    assert.equal(res2.events[1].review.overallScore, 92);
  }
});

test('parseNdjsonBuffer turns a complete event with missing review into a clean error event', () => {
  const res = parseNdjsonBuffer('{"type":"complete"}\n');
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].type, 'error');
});
