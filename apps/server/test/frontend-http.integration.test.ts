import { describe, expect, it } from 'vitest';
import { guestResponseSchema } from '@rapidfire/contracts';
import { authHarness, CookieJar } from './auth-helpers.js';

describe('frontend HTTP integration boundaries', () => {
  it('recovers the guest nickname on renewal without exposing a credential or person ID', async () => {
    const h = await authHarness();
    try {
      const jar = new CookieJar();
      const config = await h.request(jar, '/api/game-config');
      expect(await config.json()).toEqual({ maxRounds: 3 });
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
