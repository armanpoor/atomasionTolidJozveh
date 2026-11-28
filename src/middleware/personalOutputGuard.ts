import type { NextFunction, Request, Response } from 'express';
import {
  getPlatformSettings,
  recordTokenLedgerDelta,
} from '../db/collaborationRepository.ts';

export const PERSONAL_OUTPUT_DISABLED_MESSAGE_FA =
  'در این فاز، خروجی کتاب شخصی و پردازش هوش مصنوعی برای استفاده شخصی کاربر توسط مالک پلتفرم موقتاً غیرفعال شده است تا صفر توکن بابت خروجی شخصی مصرف شود. لطفاً فایل‌های خود را از بخش «مشارکت و تکمیل دیتابیس مرجع» بارگذاری کنید.';

/**
 * Zero-Token-Waste Guard for Personal User Book Output routes (e.g. /api/ai/analyze).
 * Checks the persisted Platform Settings (`enableUserPersonalOutput`, defaulted from
 * ENABLE_USER_PERSONAL_OUTPUT=false). When disabled, blocks the request with HTTP 403
 * BEFORE any LLM call is made and records the blocked call in the token ledger.
 */
export async function requirePersonalOutputEnabled(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const settings = await getPlatformSettings();
    if (!settings.enableUserPersonalOutput) {
      await recordTokenLedgerDelta({ zeroTokenBlockedPersonalCalls: 1 }).catch(() => undefined);
      res.status(403).json({
        error: PERSONAL_OUTPUT_DISABLED_MESSAGE_FA,
        code: 'PERSONAL_OUTPUT_DISABLED',
        enableUserPersonalOutput: false,
      });
      return;
    }
    next();
  } catch (err) {
    console.warn('[PersonalOutputGuard] Failed to read platform settings; failing closed:', err);
    res.status(403).json({
      error: PERSONAL_OUTPUT_DISABLED_MESSAGE_FA,
      code: 'PERSONAL_OUTPUT_DISABLED',
      enableUserPersonalOutput: false,
    });
  }
}

const PERSONAL_AI_SUBPATH_PATTERNS: RegExp[] = [
  /^\/ai-quota-probe\/?$/i,
  /^\/probe-models\/?$/i,
  /^\/[^/]+\/(dedup|quick-draft|finalize|grounding|transcribe-audio|deep-review|chat|rescan-conflicts)\/?$/i,
  /^\/[^/]+\/harness\/.+$/i,
];

/**
 * Router-level guard for `/api/projects/*`.
 * Preserves ALL existing 5-stage project code & read-only access untouched, while guaranteeing
 * ZERO AI tokens can be spent on personal user book workflows while `enableUserPersonalOutput=false`.
 */
export async function guardPersonalProjectAiRoutes(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    next();
    return;
  }

  const subPath = req.path || '';
  const isPersonalAiRoute = PERSONAL_AI_SUBPATH_PATTERNS.some((rx) => rx.test(subPath));
  if (!isPersonalAiRoute) {
    next();
    return;
  }

  await requirePersonalOutputEnabled(req, res, next);
}
