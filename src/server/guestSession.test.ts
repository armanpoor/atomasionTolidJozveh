import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGuestBearerToken,
  issueGuestSession,
  verifyGuestToken,
} from './guestSession';

test('issues a signed guest session token and verifies it with valid payload', () => {
  const now = 1_800_000_000_000;
  const session = issueGuestSession(60 * 60 * 1000, now);

  assert.equal(session.isGuest, true);
  assert.match(session.uid, /^guest_[a-f0-9]{24}$/);
  assert.equal(isGuestBearerToken(session.token), true);

  const verified = verifyGuestToken(session.token, now + 5_000);
  assert.ok(verified);
  assert.equal(verified.uid, session.uid);
  assert.equal(verified.isGuest, true);
  assert.equal(verified.name, 'کاربر مهمان');
});

test('rejects tampered, expired, or malformed guest tokens', () => {
  const now = 1_800_000_000_000;
  const session = issueGuestSession(120_000, now);

  // Tampered signature
  const tamperedSig = `${session.token.slice(0, -4)}AAAA`;
  assert.equal(verifyGuestToken(tamperedSig, now + 1000), null);

  // Expired token
  assert.equal(verifyGuestToken(session.token, now + 200_000), null);

  // Non-guest token
  assert.equal(isGuestBearerToken('eyJhbGciOiJSUzI1NiJ9.abc.def'), false);
  assert.equal(verifyGuestToken('eyJhbGciOiJSUzI1NiJ9.abc.def', now), null);
  assert.equal(verifyGuestToken('guest.invalid_no_dot', now), null);
});
