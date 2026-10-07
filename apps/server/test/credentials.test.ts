import { describe, expect, it } from 'vitest';
import {
  cookieToken,
  credentialCookies,
  Credentials,
} from '../src/auth/credentials.js';
import { EmailRateLimit, RequestRateLimit } from '../src/auth/rate-limit.js';

describe('opaque session and match credentials', () => {
  it('renews a guest only after five minutes, for fifteen minutes, and never resurrects an expired guest', () => {
    let now = 1000;
    const bank = new Credentials({ now: () => now });
    const { token, credential } = bank.createGuest('Nickname');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    now += 299999;
    expect(bank.renewGuest(token)?.expiresAt).toBe(credential.expiresAt);
    now++;
    expect(bank.renewGuest(token)?.expiresAt).toBe(now + 900000);
    now += 900000;
    expect(bank.renewGuest(token)).toBeNull();
  });
  it('fixes match expiry to its start, reuses its cookie, retains concurrent-tab proofs and revokes all devices', () => {
    let now = 1000;
    const bank = new Credentials({ now: () => now });
    const person = { id: 'u', name: 'Name', kind: 'user' as const };
    const first = bank.issueMatch(person, 'm', now, null);
    const second = bank.issueMatch(person, 'm', now, null);
    if (!first || !second) throw new Error('No proof');
    now += 600000;
    expect(bank.issueMatch(person, 'm', 1000, first.token)?.token).toBe(
      first.token,
    );
    expect(bank.match(second.token)?.expiresAt).toBe(1801000);
    bank.revokePerson(person.id);
    expect(bank.match(first.token)).toBeNull();
    expect(bank.match(second.token)).toBeNull();
    now = 1801000;
    expect(bank.issueMatch(person, 'm', 1000, null)).toBeNull();
  });
  it('revokes registered proofs on finish while guests can return to their final result', () => {
    const bank = new Credentials({ now: () => 1000 });
    const guest = bank.createGuest('Guest');
    const a = bank.issueMatch(
      { id: 'user', name: 'User', kind: 'user' },
      'm',
      1000,
      null,
    );
    const b = bank.issueMatch(guest.credential.person, 'm', 1000, null);
    bank.finishMatch('m');
    expect(bank.match(a?.token ?? null)).toBeNull();
    expect(bank.match(b?.token ?? null)).not.toBeNull();
    bank.revokePerson(guest.credential.person.id);
    expect(bank.guest(guest.token)).toBeNull();
    expect(bank.match(b?.token ?? null)).toBeNull();
  });
  it('enforces capacity, rejects duplicate/malformed cookies and sets exact host cookie attributes', () => {
    const clock = { now: () => 1000 };
    const bank = new Credentials(clock, 1);
    const guest = bank.createGuest('Guest');
    expect(() => bank.createGuest('Second')).toThrow('CREDENTIAL_CAPACITY');
    expect(cookieToken(`g=${guest.token}; g=${guest.token}`, 'g')).toBeNull();
    expect(cookieToken('g=bad%20token', 'g')).toBeNull();
    expect(cookieToken(`other=x; g=${guest.token}`, 'g')).toBe(guest.token);
    const cookies = credentialCookies('https://quiz.example', clock);
    expect(cookies.serialize('match', guest.token, 1801000)).toContain(
      '__Host-rapidfire.match=',
    );
    expect(cookies.serialize('match', guest.token, 1801000)).toContain(
      'Path=/; HttpOnly; SameSite=Lax; Max-Age=1800',
    );
    expect(cookies.serialize('match', guest.token, 1801000)).toContain(
      '; Secure',
    );
    expect(cookies.clear('match')).toContain('Max-Age=0');
  });
  it('rate limits known and unknown normalized emails identically, separately by purpose', () => {
    let now = 0;
    const limit = new EmailRateLimit({ now: () => now }, 2);
    expect(limit.allow('reset', 'USER@example.com')).toBe(true);
    expect(limit.allow('reset', 'user@example.com')).toBe(false);
    expect(limit.allow('verify', 'user@example.com')).toBe(true);
    expect(limit.allow('reset', 'unknown@example.com')).toBe(false);
    now = 60000;
    expect(limit.allow('reset', 'user@example.com')).toBe(true);
  });
  it('increments request limits atomically across concurrent requests and expires capacity entries', async () => {
    let now = 1000;
    const limit = new RequestRateLimit({ now: () => now }, 1);
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        limit.consume('ip/path', { window: 60, max: 3 }),
      ),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect(await limit.consume('other/path', { window: 60, max: 3 })).toEqual({
      allowed: false,
      retryAfter: 60,
    });
    now += 60000;
    expect(await limit.consume('other/path', { window: 60, max: 3 })).toEqual({
      allowed: true,
      retryAfter: null,
    });
  });
});
