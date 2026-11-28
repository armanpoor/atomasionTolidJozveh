import type { NextFunction, Response } from 'express';
import type { AuthRequest, AuthenticatedUser } from './auth.ts';

const DEFAULT_PLATFORM_OWNER_EMAIL = 'hossein.roosta.90@gmail.com';

/**
 * Parses comma/semicolon-separated ADMIN_EMAILS into a normalized lowercase Set.
 * If ADMIN_EMAILS is explicitly provided (even empty string ""), it is honored strictly.
 * If ADMIN_EMAILS is completely unset (undefined), falls back to the platform owner email.
 */
export function resolveAdminEmailSet(rawEnv: string | undefined = process.env.ADMIN_EMAILS): Set<string> {
  if (rawEnv === undefined) {
    return new Set([DEFAULT_PLATFORM_OWNER_EMAIL]);
  }
  const entries = rawEnv
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 3 && s.includes('@'));
  return new Set(entries);
}

/**
 * Strictly checks whether an authenticated user is authorized as Platform Owner / Admin.
 * Guest sessions are ALWAYS rejected regardless of email string.
 */
export function isAdminUser(
  user?: AuthenticatedUser | null,
  rawEnv: string | undefined = process.env.ADMIN_EMAILS
): boolean {
  if (!user || user.isGuest) return false;
  const email = (user.email || '').trim().toLowerCase();
  if (!email) return false;
  const allowed = resolveAdminEmailSet(rawEnv);
  return allowed.has(email);
}

/**
 * Server-side Admin RBAC middleware.
 * Must be placed AFTER `requireAuth` on all `/api/admin/encyclopedia/*` endpoints.
 * Blocks guests and non-admin regular users with HTTP 403 Forbidden.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({
      error: 'احراز هویت برای دسترسی به این بخش الزامی است.',
    });
    return;
  }
  if (!isAdminUser(user)) {
    res.status(403).json({
      error: 'دسترسی غیرمجاز: این بخش صرفاً مخصوص مالک پلتفرم است.',
    });
    return;
  }
  next();
}
