import type { DeepReviewFinding, DeepReviewReportDto, ProjectBundleDto } from './bookTypes.ts';

export interface DeepReviewProgressEvent {
  type: 'progress';
  percent: number;
  stage: string;
  detail?: string;
  model?: string;
  thinkingLevel?: string;
  attempt?: number;
  totalAttempts?: number;
}

export interface DeepReviewCompleteEvent {
  type: 'complete';
  review: DeepReviewReportDto;
  bundle?: ProjectBundleDto | null;
}

export interface DeepReviewErrorEvent {
  type: 'error';
  error: string;
}

export type DeepReviewStreamEvent =
  | DeepReviewProgressEvent
  | DeepReviewCompleteEvent
  | DeepReviewErrorEvent;

function safeInt(val: unknown, fallback = 0): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

/**
 * Defensively normalizes any DeepReviewReportDto payload coming from the server
 * or loaded from legacy checkpoints so `appliedCounts` and `findings` are ALWAYS
 * safe to read and can never throw `Cannot read properties of undefined`.
 */
export function normalizeDeepReviewReport(raw: unknown): DeepReviewReportDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawCounts =
    obj.appliedCounts && typeof obj.appliedCounts === 'object'
      ? (obj.appliedCounts as Record<string, unknown>)
      : {};

  const rawLevel = String(obj.thinkingLevel || 'HIGH').toUpperCase();
  const thinkingLevel: DeepReviewReportDto['thinkingLevel'] =
    rawLevel === 'XHIGH' || rawLevel === 'HIGH' || rawLevel === 'MEDIUM'
      ? rawLevel
      : 'HIGH';

  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: DeepReviewFinding[] = rawFindings
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((f) => ({
      severity:
        f.severity === 'high' || f.severity === 'low' || f.severity === 'medium'
          ? f.severity
          : 'medium',
      category: String(f.category || 'بهبود ساختاری'),
      chapterTitle: String(f.chapterTitle || 'کل سند'),
      issue: String(f.issue || ''),
      fixApplied: String(f.fixApplied || 'در نسخه جدید سند اعمال شد'),
    }));

  const rawScore = Number(obj.overallScore);
  const overallScore = Number.isFinite(rawScore)
    ? Math.max(1, Math.min(100, Math.round(rawScore)))
    : 90;

  return {
    reviewedAt:
      typeof obj.reviewedAt === 'string' && obj.reviewedAt
        ? obj.reviewedAt
        : new Date().toISOString(),
    modelUsed:
      typeof obj.modelUsed === 'string' && obj.modelUsed
        ? obj.modelUsed
        : 'gemini-4-hydrogen',
    thinkingLevel,
    overallScore,
    overallAssessment:
      typeof obj.overallAssessment === 'string' && obj.overallAssessment.trim()
        ? obj.overallAssessment.trim()
        : 'بازبینی عمیق سند با موفقیت انجام شد و بهبودهای بدون افت روی سند اعمال گردید.',
    appliedCounts: {
      titlesRefined: safeInt(rawCounts.titlesRefined),
      calloutsAdded: safeInt(rawCounts.calloutsAdded),
      tablesAdded: safeInt(rawCounts.tablesAdded),
      paragraphsAdded: safeInt(rawCounts.paragraphsAdded),
    },
    findings,
  };
}

/**
 * Parses complete NDJSON lines from a streaming text buffer and returns any
 * incomplete trailing line as `remainder` for the next chunk.
 */
export function parseNdjsonBuffer(buffer: string): {
  events: DeepReviewStreamEvent[];
  remainder: string;
} {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  const events: DeepReviewStreamEvent[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed.type === 'progress') {
        events.push({
          type: 'progress',
          percent: Math.max(0, Math.min(100, safeInt(parsed.percent))),
          stage: String(parsed.stage || 'در حال بازبینی عمیق...'),
          detail: typeof parsed.detail === 'string' ? parsed.detail : undefined,
          model: typeof parsed.model === 'string' ? parsed.model : undefined,
          thinkingLevel:
            typeof parsed.thinkingLevel === 'string' ? parsed.thinkingLevel : undefined,
          attempt: typeof parsed.attempt === 'number' ? parsed.attempt : undefined,
          totalAttempts:
            typeof parsed.totalAttempts === 'number' ? parsed.totalAttempts : undefined,
        });
      } else if (parsed.type === 'complete') {
        const review = normalizeDeepReviewReport(parsed.review);
        if (review) {
          events.push({
            type: 'complete',
            review,
            bundle: (parsed.bundle as ProjectBundleDto | null | undefined) ?? null,
          });
        } else {
          events.push({
            type: 'error',
            error: 'گزارش نهایی بازبینی عمیق به‌صورت ناقص از سرور دریافت شد. لطفاً مجدداً تلاش کنید.',
          });
        }
      } else if (parsed.type === 'error') {
        events.push({
          type: 'error',
          error: String(parsed.error || 'خطا در اجرای بازبینی عمیق هوش مصنوعی.'),
        });
      }
    } catch {
      // Ignore malformed/keepalive line
    }
  }

  return { events, remainder };
}
