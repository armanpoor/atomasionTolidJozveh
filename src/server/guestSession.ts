import crypto from 'node:crypto';

const GUEST_TOKEN_PREFIX = 'guest.';
const GUEST_UID_PATTERN = /^guest_[a-f0-9]{16,32}$/;
const DEFAULT_GUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Ephemeral fallback secret in process memory if GUEST_SESSION_SECRET env var is unset
const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32);

function getSigningSecret(): Buffer {
  const configured = process.env.GUEST_SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return Buffer.from(configured, 'utf8');
  }
  return EPHEMERAL_FALLBACK_SECRET;
}

export interface GuestTokenPayload {
  uid: string;
  iat: number;
  exp: number;
  v: 1;
}

export interface IssuedGuestSession {
  token: string;
  uid: string;
  displayName: string;
  email: string;
  expiresAt: string;
  isGuest: true;
}

export interface VerifiedGuestUser {
  uid: string;
  email: string;
  name: string;
  picture: null;
  isGuest: true;
}

function signEncodedPayload(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(encodedPayload)
    .digest('base64url');
}

export function issueGuestSession(
  ttlMs: number = DEFAULT_GUEST_TTL_MS,
  nowMs: number = Date.now()
): IssuedGuestSession {
  const uid = `guest_${crypto.randomBytes(12).toString('hex')}`;
  const iat = Math.floor(nowMs);
  const exp = iat + Math.max(60_000, ttlMs);
  const payload: GuestTokenPayload = { uid, iat, exp, v: 1 };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signEncodedPayload(encodedPayload);
  return {
    token: `${GUEST_TOKEN_PREFIX}${encodedPayload}.${signature}`,
    uid,
    displayName: 'کاربر مهمان',
    email: `${uid}@guest.local`,
    expiresAt: new Date(exp).toISOString(),
    isGuest: true,
  };
}

export function isGuestBearerToken(token: string): boolean {
  return typeof token === 'string' && token.startsWith(GUEST_TOKEN_PREFIX);
}

export function verifyGuestToken(
  token: string,
  nowMs: number = Date.now()
): VerifiedGuestUser | null {
  if (!isGuestBearerToken(token)) return null;
  const remainder = token.slice(GUEST_TOKEN_PREFIX.length);
  const dotIdx = remainder.indexOf('.');
  if (dotIdx <= 0 || dotIdx !== remainder.lastIndexOf('.')) return null;

  const encodedPayload = remainder.slice(0, dotIdx);
  const providedSig = remainder.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = signEncodedPayload(encodedPayload);
  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const rawJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const parsed = JSON.parse(rawJson) as Partial<GuestTokenPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.uid !== 'string' ||
      !GUEST_UID_PATTERN.test(parsed.uid) ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number'
    ) {
      return null;
    }
    if (nowMs >= parsed.exp) return null;

    return {
      uid: parsed.uid,
      email: `${parsed.uid}@guest.local`,
      name: 'کاربر مهمان',
      picture: null,
      isGuest: true,
    };
  } catch {
    return null;
  }
}
