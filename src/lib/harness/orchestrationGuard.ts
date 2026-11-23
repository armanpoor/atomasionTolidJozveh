/**
 * Package C Red-Team Hardening:
 * Pure, deterministic orchestration guardrails for the ECU & WinOLS AI Harness:
 * 1. Concurrency Lease Lock (`activeStepLock` with `stepRunId` + Lease TTL + owner-only release)
 * 2. Cooperative AbortSignal cancellation guard (`HarnessRunAbortedError`)
 * 3. Cross-provider output truncation detector (`finishReason: length | max_tokens` -> `output_truncated`)
 * 4. Claim-by-Claim Anti-Rubber-Stamp Semantic Judge evaluator (`low_effort_judge_audit`)
 * 5. Post-patch mandatory dual-layer re-audit verification + Section Provenance builder
 */

import { deterministicHash } from '../zeroLossPipeline.ts';
import type {
  ActiveStepLock,
  HarnessSourceChunk,
  JudgeCheckedClaim,
  Layer1Issue,
  Layer2AuditResult,
  Layer2Issue,
  SectionProvenance,
  SemanticSectionIR,
} from './types.ts';

export const DEFAULT_STEP_LOCK_TTL_MS = 180_000; // 3 minutes lease TTL

// ============================================================================
// 1. CONCURRENCY LOCK WITH LEASE TTL & OWNER-ONLY RELEASE
// ============================================================================

export class HarnessStepConflictError extends Error {
  public readonly status = 409;
  public readonly code = 'step_already_running' as const;
  public readonly existingLock: ActiveStepLock;

  constructor(existingLock: ActiveStepLock, messageFa?: string) {
    super(
      messageFa ||
        `[step_already_running] گام زیربخش «${existingLock.sectionId}» هم‌اکنون توسط نشست دیگری در حال اجرا است. تا پایان آن یا انقضای قفل منتظر بمانید.`
    );
    this.name = 'HarnessStepConflictError';
    this.existingLock = existingLock;
  }
}

export class HarnessRunAbortedError extends Error {
  public readonly status = 499;
  public readonly code = 'step_aborted_by_user' as const;

  constructor(stageLabelFa?: string) {
    super(
      stageLabelFa
        ? `[step_aborted_by_user] اجرای هارنس با دستور توقف کاربر پیش از مرحله «${stageLabelFa}» متوقف شد.`
        : '[step_aborted_by_user] اجرای هارنس با دستور توقف کاربر متوقف شد.'
    );
    this.name = 'HarnessRunAbortedError';
  }
}

export function assertNotAborted(signal: AbortSignal | null | undefined, stageLabelFa?: string): void {
  if (signal?.aborted) {
    throw new HarnessRunAbortedError(stageLabelFa);
  }
}

export interface StepLockAcquireResult {
  acquired: boolean;
  code: 'acquired' | 'reclaimed_expired_lock' | 'step_already_running';
  lock: ActiveStepLock;
  reclaimedExpiredLock: boolean;
  messageFa?: string;
}

export function isStepLockExpired(
  lock: ActiveStepLock | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!lock) return true;
  const expiresMs = Date.parse(lock.lockExpiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return expiresMs <= nowMs;
}

/**
 * Attempts to acquire a concurrency lease lock for a harness step.
 * - Rejects with `step_already_running` if a non-expired lock is held by another `stepRunId`.
 * - Safely reclaims expired locks (e.g. after server crash / hard restart).
 */
export function acquireStepLock(params: {
  existingLock?: ActiveStepLock | null;
  stepRunId: string;
  sectionId: string;
  ttlMs?: number;
  nowMs?: number;
}): StepLockAcquireResult {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = Math.max(5_000, params.ttlMs ?? DEFAULT_STEP_LOCK_TTL_MS);
  const existing = params.existingLock || null;

  if (existing && existing.stepRunId !== params.stepRunId && !isStepLockExpired(existing, nowMs)) {
    return {
      acquired: false,
      code: 'step_already_running',
      lock: existing,
      reclaimedExpiredLock: false,
      messageFa: `[step_already_running] زیربخش «${existing.sectionId}» هم‌اکنون در حال پردازش است (شناسه قفل: ${existing.stepRunId}).`,
    };
  }

  const reclaimedExpiredLock = Boolean(existing && existing.stepRunId !== params.stepRunId);
  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + ttlMs).toISOString();
  const nextLock: ActiveStepLock = {
    stepRunId: params.stepRunId,
    sectionId: params.sectionId,
    acquiredAt: existing && existing.stepRunId === params.stepRunId ? existing.acquiredAt : nowIso,
    heartbeatAt: nowIso,
    lockExpiresAt: expiresIso,
  };

  return {
    acquired: true,
    code: reclaimedExpiredLock ? 'reclaimed_expired_lock' : 'acquired',
    lock: nextLock,
    reclaimedExpiredLock,
  };
}

/**
 * Renews heartbeat + Lease TTL ONLY if the caller owns the active lock.
 */
export function renewStepLockHeartbeat(params: {
  existingLock?: ActiveStepLock | null;
  stepRunId: string;
  ttlMs?: number;
  nowMs?: number;
}): { renewed: boolean; lock: ActiveStepLock | null } {
  const existing = params.existingLock || null;
  if (!existing || existing.stepRunId !== params.stepRunId) {
    return { renewed: false, lock: existing };
  }
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = Math.max(5_000, params.ttlMs ?? DEFAULT_STEP_LOCK_TTL_MS);
  return {
    renewed: true,
    lock: {
      ...existing,
      heartbeatAt: new Date(nowMs).toISOString(),
      lockExpiresAt: new Date(nowMs + ttlMs).toISOString(),
    },
  };
}

/**
 * Releases the concurrency lock ONLY if `stepRunId` matches the current owner.
 * Prevents a stale/zombie worker from accidentally releasing a reclaimed lock owned by another run.
 */
export function releaseStepLock(params: {
  existingLock?: ActiveStepLock | null;
  stepRunId: string;
}): { released: boolean; nextLock: ActiveStepLock | null } {
  const existing = params.existingLock || null;
  if (!existing) {
    return { released: true, nextLock: null };
  }
  if (existing.stepRunId !== params.stepRunId) {
    return { released: false, nextLock: existing };
  }
  return { released: true, nextLock: null };
}

// ============================================================================
// 2. CROSS-PROVIDER OUTPUT TRUNCATION DETECTION (`output_truncated`)
// ============================================================================

export type NormalizedFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'unknown';

export function normalizeProviderFinishReason(rawReason?: string | null): NormalizedFinishReason {
  const norm = String(rawReason || '')
    .trim()
    .toLowerCase();
  if (!norm) return 'unknown';
  if (
    norm === 'length' ||
    norm === 'max_tokens' ||
    norm === 'max_output_tokens' ||
    norm === 'model_context_window_exceeded'
  ) {
    return 'length';
  }
  if (
    norm === 'stop' ||
    norm === 'end_turn' ||
    norm === 'stop_sequence' ||
    norm === 'finish_reason_stop'
  ) {
    return 'stop';
  }
  if (
    norm === 'content_filter' ||
    norm === 'safety' ||
    norm === 'recitation' ||
    norm === 'prohibited_content' ||
    norm === 'blocklist'
  ) {
    return 'content_filter';
  }
  if (norm === 'tool_calls' || norm === 'tool_use' || norm === 'function_call') {
    return 'tool_calls';
  }
  return 'unknown';
}

export interface OutputTruncationEvaluation {
  truncated: boolean;
  code: 'output_truncated' | null;
  rawFinishReason: string | null;
  normalizedFinishReason: NormalizedFinishReason;
  issue: Layer1Issue | null;
}

/**
 * Deterministically flags truncated LLM outputs (`finishReason: length | max_tokens | MAX_TOKENS`)
 * and emits an error-severity Layer 1 issue (`output_truncated`) so a cut-off subsection
 * can NEVER be falsely verified as complete.
 */
export function evaluateOutputTruncation(params: {
  finishReason?: string | null;
  sectionId?: string;
}): OutputTruncationEvaluation {
  const raw = params.finishReason ? String(params.finishReason).trim() : null;
  const normalized = normalizeProviderFinishReason(raw);

  if (normalized === 'length') {
    return {
      truncated: true,
      code: 'output_truncated',
      rawFinishReason: raw,
      normalizedFinishReason: normalized,
      issue: {
        id: `l1-truncated-${params.sectionId || 'sec'}`,
        kind: 'output_truncated',
        severity: 'error',
        messageFa: `[output_truncated] خروجی مدل به دلیل رسیدن به سقف توکن خروجی (finishReason=${raw || 'length'}) در میانه متن بریده شده است و نمی‌تواند به‌عنوان زیربخش کامل تأیید شود.`,
        offendingToken: raw || 'length',
      },
    };
  }

  return {
    truncated: false,
    code: null,
    rawFinishReason: raw,
    normalizedFinishReason: normalized,
    issue: null,
  };
}

// ============================================================================
// 3. CLAIM-BY-CLAIM ANTI-RUBBER-STAMP SEMANTIC JUDGE EVALUATOR
// ============================================================================

export interface RawJudgeResponsePayload {
  passed?: boolean;
  score?: number;
  summaryFa?: string;
  checkedClaims?: Array<Partial<JudgeCheckedClaim>>;
  missingTechnicalFacts?: unknown[];
  issues?: Array<Partial<Layer2Issue>>;
}

const TECHNICAL_ANCHOR_RX =
  /\b(?:0x[0-9a-fA-F]{2,}|P[0-9A-F]{4}|[A-Z]{2,}[0-9A-Z_.-]{1,}|[0-9]+(?:\.[0-9]+)?\s*(?:ms|bar|kPa|rpm|deg|V|mV|Ω|ohm|°C|%)|\d{1,3}\s*[x×]\s*\d{1,3})\b/g;

function countTechnicalSubstance(sectionIR: SemanticSectionIR, sourceChunks: HarnessSourceChunk[]): {
  wordCount: number;
  substantiveBlocks: number;
  technicalAnchorsCount: number;
} {
  const blockTexts = sectionIR.blocks
    .map((b) => [b.title, b.text, ...(b.items || []), ...(b.headers || []), ...(b.rows?.flat() || []), b.latex].filter(Boolean).join(' '))
    .filter(Boolean);
  const combined = blockTexts.join(' ');
  const wordCount = combined.split(/\s+/).filter(Boolean).length;
  const substantiveBlocks = sectionIR.blocks.filter(
    (b) => b.kind !== 'heading' && b.kind !== 'figure_ref'
  ).length;
  const sourceText = sourceChunks.map((c) => c.text).join(' ');
  const anchors = new Set([
    ...(combined.match(TECHNICAL_ANCHOR_RX) || []),
    ...(sourceText.match(TECHNICAL_ANCHOR_RX) || []),
  ]);
  return {
    wordCount,
    substantiveBlocks,
    technicalAnchorsCount: anchors.size,
  };
}

/**
 * Validates raw Layer 2 Judge JSON and catches rubber-stamp / low-effort approvals:
 * - Parses structured `checkedClaims` and `missingTechnicalFacts`
 * - Flags `low_effort_judge_audit` if a rich technical section receives `passed: true`
 *   with zero/insufficient verified claims or an empty/generic summary
 * - Converts any `missingTechnicalFacts` or unsupported claims into concrete Layer 2 issues
 */
export function evaluateJudgeAuditRigorous(params: {
  parsed: RawJudgeResponsePayload | null;
  sectionIR: SemanticSectionIR;
  sourceChunks: HarnessSourceChunk[];
  modelUsed: string;
}): Layer2AuditResult {
  const { parsed, sectionIR, sourceChunks, modelUsed } = params;
  const substance = countTechnicalSubstance(sectionIR, sourceChunks);
  const isSubstantiveTechnicalSection =
    substance.wordCount >= 45 ||
    substance.substantiveBlocks >= 2 ||
    substance.technicalAnchorsCount >= 2;

  if (!parsed) {
    return {
      passed: false,
      score: 40,
      summaryFa:
        '[low_effort_judge_audit] پاسخ داور معنایی قابل پارس نبود؛ برای جلوگیری از تأیید صوری، بازبینی الزامی ثبت شد.',
      issues: [
        {
          id: 'l2-unparseable-judge',
          category: 'structure',
          severity: 'error',
          messageFa:
            'پاسخ داور معنایی لایه ۲ قالب JSON معتبر نداشت و از عبور کورکورانه جلوگیری شد.',
        },
      ],
      invalidBlockIds: [],
      modelUsed,
      checkedClaims: [],
      missingTechnicalFacts: [],
      lowEffortJudgeAudit: true,
      flagCode: 'low_effort_judge_audit',
    };
  }

  const checkedClaims: JudgeCheckedClaim[] = Array.isArray(parsed.checkedClaims)
    ? parsed.checkedClaims
        .filter((c) => c && typeof c.claimFa === 'string' && c.claimFa.trim().length >= 4)
        .map((c) => ({
          blockId: typeof c.blockId === 'string' && c.blockId.trim() ? c.blockId.trim() : undefined,
          claimFa: String(c.claimFa).trim(),
          supported: Boolean(c.supported),
          sourceChunkId:
            typeof c.sourceChunkId === 'string' && c.sourceChunkId.trim()
              ? c.sourceChunkId.trim()
              : undefined,
          noteFa: typeof c.noteFa === 'string' && c.noteFa.trim() ? c.noteFa.trim() : undefined,
        }))
    : [];

  const missingTechnicalFacts: string[] = Array.isArray(parsed.missingTechnicalFacts)
    ? parsed.missingTechnicalFacts
        .map((f) => String(f || '').trim())
        .filter((f) => f.length >= 3)
    : [];

  const issues: Layer2Issue[] = Array.isArray(parsed.issues)
    ? parsed.issues
        .filter((x) => x && typeof x.messageFa === 'string' && x.messageFa.trim())
        .map((x, idx) => ({
          id: x.id || `l2-${idx + 1}`,
          blockId:
            typeof x.blockId === 'string' && x.blockId.trim() ? x.blockId.trim() : undefined,
          category:
            x.category === 'hallucination' ||
            x.category === 'omission' ||
            x.category === 'terminology' ||
            x.category === 'clarity' ||
            x.category === 'structure'
              ? x.category
              : 'clarity',
          severity: x.severity === 'warning' ? 'warning' : 'error',
          messageFa: String(x.messageFa).trim(),
          suggestedFixFa:
            typeof x.suggestedFixFa === 'string' ? x.suggestedFixFa.trim() : undefined,
        }))
    : [];

  // Convert unsupported claims from Claim-by-Claim table into explicit hallucination errors
  for (let i = 0; i < checkedClaims.length; i++) {
    const claim = checkedClaims[i];
    if (!claim.supported) {
      const alreadyReported = issues.some(
        (iss) => iss.blockId === claim.blockId && iss.messageFa.includes(claim.claimFa.slice(0, 18))
      );
      if (!alreadyReported) {
        issues.push({
          id: `l2-claim-${i + 1}`,
          blockId: claim.blockId,
          category: 'hallucination',
          severity: 'error',
          messageFa: `ادعای بدون پشتوانه در ممیزی ادعا-به-ادعا: ${claim.claimFa}${claim.noteFa ? ` (${claim.noteFa})` : ''}`,
        });
      }
    }
  }

  // Convert omitted technical facts into explicit omission errors
  for (let i = 0; i < missingTechnicalFacts.length; i++) {
    const fact = missingTechnicalFacts[i];
    const alreadyReported = issues.some(
      (iss) => iss.category === 'omission' && iss.messageFa.includes(fact.slice(0, 18))
    );
    if (!alreadyReported) {
      issues.push({
        id: `l2-missing-${i + 1}`,
        category: 'omission',
        severity: 'error',
        messageFa: `حذف داده فنی کلیدی منبع: ${fact}`,
      });
    }
  }

  const summaryFaRaw = typeof parsed.summaryFa === 'string' ? parsed.summaryFa.trim() : '';
  const hasExplicitErrors = issues.some((i) => i.severity === 'error');
  const rawPassed = typeof parsed.passed === 'boolean' ? parsed.passed : !hasExplicitErrors;

  // Anti-Rubber-Stamp detection:
  // If the judge approves a substantive technical section WITHOUT listing real checkedClaims,
  // OR with an ultra-short generic summary (< 20 chars) and < 2 claims -> flag `low_effort_judge_audit`!
  const missingClaimEvidence = isSubstantiveTechnicalSection && checkedClaims.length === 0;
  const thinAuditOnRichSection =
    isSubstantiveTechnicalSection &&
    substance.technicalAnchorsCount >= 3 &&
    checkedClaims.length < 2 &&
    summaryFaRaw.length < 24;

  const lowEffortJudgeAudit = rawPassed && !hasExplicitErrors && (missingClaimEvidence || thinAuditOnRichSection);

  if (lowEffortJudgeAudit) {
    issues.push({
      id: 'l2-low-effort-rubber-stamp',
      category: 'structure',
      severity: 'error',
      messageFa:
        '[low_effort_judge_audit] داور معنایی بدون ثبت لیست ادعاهای بررسی‌شده (checkedClaims) تأیید صوری صادر کرد؛ برای حفظ دقت علمی، تأیید صوری مسدود شد.',
      suggestedFixFa: 'بازبینی دقیق ادعا-به-ادعا نسبت به قطعات منبع XML.',
    });
  }

  const finalHasErrors = issues.some((i) => i.severity === 'error');
  const finalPassed = rawPassed && !finalHasErrors && !lowEffortJudgeAudit;
  const invalidBlockIds = Array.from(
    new Set(issues.filter((i) => i.severity === 'error' && i.blockId).map((i) => i.blockId!))
  );

  const score = lowEffortJudgeAudit
    ? Math.min(55, typeof parsed.score === 'number' ? Math.round(parsed.score) : 55)
    : typeof parsed.score === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : finalPassed
        ? 92
        : 58;

  return {
    passed: finalPassed,
    score,
    summaryFa: lowEffortJudgeAudit
      ? '[low_effort_judge_audit] تأیید صوری داور بدون شواهد ادعا-به-ادعا مسدود شد.'
      : summaryFaRaw ||
        (finalPassed
          ? 'ممیزی معنایی ادعا-به-ادعا در لایه ۲ تأیید شد.'
          : 'ممیزی معنایی لایه ۲ نیازمند ترمیم جراحی است.'),
    issues,
    invalidBlockIds,
    modelUsed,
    checkedClaims,
    missingTechnicalFacts,
    lowEffortJudgeAudit,
    flagCode: lowEffortJudgeAudit ? 'low_effort_judge_audit' : null,
  };
}

// ============================================================================
// 4. POST-PATCH MANDATORY DUAL-LAYER AUDIT GATE & SECTION PROVENANCE
// ============================================================================

export function canMarkSectionVerified(params: {
  layer1Passed: boolean;
  layer2Passed: boolean;
  outputTruncated: boolean;
  patchAttempts: number;
  reAuditedAfterLastPatch: boolean;
}): { allowed: boolean; reasonFa?: string } {
  if (params.outputTruncated) {
    return {
      allowed: false,
      reasonFa: 'خروجی زیربخش بریده شده (output_truncated) و قابل تأیید نیست.',
    };
  }
  if (params.patchAttempts > 0 && !params.reAuditedAfterLastPatch) {
    return {
      allowed: false,
      reasonFa: 'بازممیزی اجباری لایه ۱ و لایه ۲ پس از آخرین ترمیم جراحی تکمیل نشده است.',
    };
  }
  if (!params.layer1Passed || !params.layer2Passed) {
    return {
      allowed: false,
      reasonFa: 'زیربخش باید پیش از تأیید از هر دو لایه ممیزی (L1 قطعی و L2 معنایی) عبور کند.',
    };
  }
  return { allowed: true };
}

export function buildSectionProvenance(params: {
  prefixHash?: string | null;
  authorModelUsed: string;
  judgeModelUsed?: string | null;
  patchAttempts: number;
  finishReason?: string | null;
  outputTruncated?: boolean;
  lowEffortJudgeFlagged?: boolean;
  sourceChunks: HarnessSourceChunk[];
  auditedAt?: string;
}): SectionProvenance {
  const sourceChunkHashes: Record<string, string> = {};
  for (const chunk of params.sourceChunks) {
    sourceChunkHashes[chunk.id] =
      chunk.contentHash || `chk_${deterministicHash(`${chunk.id}:${chunk.text}`)}`;
  }

  return {
    prefixHash: params.prefixHash ?? null,
    authorModelUsed: params.authorModelUsed,
    judgeModelUsed: params.judgeModelUsed ?? null,
    patchAttempts: Math.max(0, Math.round(params.patchAttempts)),
    finishReason: params.finishReason ?? null,
    outputTruncated: Boolean(params.outputTruncated),
    lowEffortJudgeFlagged: Boolean(params.lowEffortJudgeFlagged),
    sourceChunkHashes,
    auditedAt: params.auditedAt || new Date().toISOString(),
  };
}
