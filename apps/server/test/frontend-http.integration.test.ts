import { describe, expect, it } from 'vitest';
import { guestResponseSchema } from '@rapidfire/contracts';
import { authHarness, CookieJar } from './auth-helpers.js';

describe('frontend HTTP integration boundaries', () => {
  it('recovers the guest nickname on renewal without exposing a credential or person ID', async () => {
    const h = await authHarness();
    try {
      const jar = new CookieJar();
      const config = await h.request(jar, '/api/game-config');
      expect(await config.json()).toEqual({
        topics: [{ id: 'league-of-legends', maxRounds: 3 }],
      });
      expect(
        (
          await h.request(jar, '/api/guest/session', {
            nickname: 'Returning guest',
          })
        ).status,
      ).toBe(200);
      const response = await h.request(jar, '/api/guest/session/renew', {});
      const body: unknown = await response.json();
      expect(response.status).toBe(200);
      expect(guestResponseSchema.parse(body).guest).toEqual({
        nickname: 'Returning guest',
      });
      expect(Object.keys(body ?? {}).sort()).toEqual([
        'expiresAt',
        'guest',
        'renewAfterSeconds',
      ]);
    } finally {
      await h.close();
    }
  });
  it.each(['missing', 'invalid', 'expired', 'revoked'] as const)(
    'rejects a %s guest credential without clearing a newer browser session',
    async (state) => {
      const h = await authHarness(true);
      try {
        const stale = new CookieJar();
        if (state === 'invalid') {
          stale.accept(
            new Response(null, {
              headers: {
                'Set-Cookie': `${h.bridge.cookies.names.guest}=invalid; Path=/`,
              },
            }),
          );
        } else if (state === 'expired' || state === 'revoked') {
          const created = await h.request(stale, '/api/guest/session', {
            nickname: 'Old guest',
          });
          expect(created.status).toBe(200);
          if (state === 'expired') await h.advance(900000);
          else {
            const signingOut = new CookieJar();
            signingOut.accept(created);
            expect(
              (await h.request(signingOut, '/api/guest/sign-out', {})).status,
            ).toBe(200);
          }
        }

        const failed = await h.request(stale, '/api/guest/session/renew', {});
        expect(failed.status).toBe(401);
        expect(await failed.json()).toEqual({ code: 'AUTH_REQUIRED' });
        expect(failed.headers.getSetCookie()).toEqual([]);

        const current = new CookieJar();
        expect(
          (
            await h.request(current, '/api/guest/session', {
              nickname: 'New guest',
            })
          ).status,
        ).toBe(200);
        const credential = current.header();
        // A response from an earlier request can arrive after session creation.
        current.accept(failed);
        expect(current.header() === credential).toBe(true);
        const renewed = await h.request(
          current,
          '/api/guest/session/renew',
          {},
        );
        expect(renewed.status).toBe(200);
        expect(guestResponseSchema.parse(await renewed.json()).guest).toEqual({
          nickname: 'New guest',
        });
      } finally {
        await h.close();
      }
    },
  );
  it('explicit guest sign-out clears browser cookies and revokes the previous credential', async () => {
    const h = await authHarness();
    try {
      const current = new CookieJar();
      const created = await h.request(current, '/api/guest/session', {
        nickname: 'Leaving guest',
      });
      expect(created.status).toBe(200);
      const previous = new CookieJar();
      previous.accept(created);

      const signedOut = await h.request(current, '/api/guest/sign-out', {});
      expect(signedOut.status).toBe(200);
      expect(signedOut.headers.getSetCookie()).toEqual([
        h.bridge.cookies.clear('guest'),
        h.bridge.cookies.clear('match'),
      ]);
      expect(current.header()).toBe('');
      const renewed = await h.request(previous, '/api/guest/session/renew', {});
      expect(renewed.status).toBe(401);
      expect(await renewed.json()).toEqual({ code: 'AUTH_REQUIRED' });
      expect(renewed.headers.getSetCookie()).toEqual([]);
      expect(
        await h.bridge.authenticate(
          { cookie: previous.header() },
          new AbortController().signal,
        ),
      ).toBeNull();
    } finally {
      await h.close();
    }
  });
  it('sends browser verification navigations to a relative app URL and leaves JSON verification with Better Auth', async () => {
    const h = await authHarness();
    try {
      const path =
        '/api/auth/verify-email?token=synthetic-invalid-token&callbackURL=https://example.org';
      const browser = await fetch(`${h.url}${path}`, {
        redirect: 'manual',
        headers: { Accept: 'text/html' },
      });
      expect(browser.status).toBe(302);
      expect(browser.headers.get('location')).toBe(
        '/verify-email?token=synthetic-invalid-token',
      );
      expect(browser.headers.get('referrer-policy')).toBe('no-referrer');
      const json = await fetch(
        `${h.url}/api/auth/verify-email?token=synthetic-invalid-token`,
        { redirect: 'manual', headers: { Accept: 'application/json' } },
      );
      expect(json.status).toBe(401);
      expect(await json.json()).toHaveProperty('code');
    } finally {
      await h.close();
    }
  });
});
