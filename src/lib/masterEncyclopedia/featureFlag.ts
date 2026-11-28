/**
 * Master Automotive Encyclopedia Feature Flag & Graceful Degradation Boundary.
 * Ensures the entire encyclopedia subsystem can be toggled off via ENABLE_MASTER_ENCYCLOPEDIA
 * and any runtime error inside the encyclopedia DB/queue/AI NEVER affects normal or guest users.
 */

export function isMasterEncyclopediaEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env.ENABLE_MASTER_ENCYCLOPEDIA;
  if (raw === undefined || raw === null || raw.trim() === '') {
    return true; // Enabled by default per architectural contract
  }
  const normalized = raw.trim().toLowerCase();
  return !['false', '0', 'off', 'no', 'disabled'].includes(normalized);
}

/**
 * Owner Feature Flag for Personal User Book Output (5-stage studio, personal merge/export, personal AI).
 * Strictly defaults to FALSE so ZERO AI tokens are spent on personal outputs while the team
 * collaboratively builds the automotive reference database & books.
 */
export function isUserPersonalOutputEnabledDefault(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env.ENABLE_USER_PERSONAL_OUTPUT;
  if (raw === undefined || raw === null || raw.trim() === '') {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return ['true', '1', 'on', 'yes', 'enabled'].includes(normalized);
}

export async function runEncyclopediaIsolated<T>(
  operationLabel: string,
  operation: () => Promise<T>,
  fallbackValue: T,
  env: Record<string, string | undefined> = process.env
): Promise<{ ok: boolean; value: T; skipped?: boolean; errorMessage?: string }> {
  if (!isMasterEncyclopediaEnabled(env)) {
    return { ok: true, value: fallbackValue, skipped: true };
  }
  try {
    const value = await operation();
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[MasterEncyclopedia Isolated Boundary] ${operationLabel} degraded safely:`, message);
    return { ok: false, value: fallbackValue, errorMessage: message };
  }
}
