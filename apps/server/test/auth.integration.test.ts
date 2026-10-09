import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { PASSWORD_RESET_REQUEST_MESSAGE } from '@rapidfire/contracts';
import { session, user } from '../src/database/auth-schema.js';
import { userProfile } from '../src/database/schema.js';
import { authHarness, CookieJar } from './auth-helpers.js';
import { success } from './game-helpers.js';

describe('Better Auth over real HTTP and PostgreSQL', () => {
  it('requires confirmation when changing password and replaces sessions on every device', async () => {
    const h = await authHarness();
    try {
      const jar = new CookieJar();
      const email = `${randomUUID()}@example.com`;
      const identity = await h.register(jar, email);
      const s = await h.socket(jar);
      success(
        await s.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'change-room',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      const wrong = await h.request(jar, '/api/auth/change-password', {
        currentPassword: 'Password1!',
        newPassword: 'Replacement2!',
        passwordConfirm: 'mismatch',
      });
      expect(wrong.status).toBe(400);
      const changed = await h.request(jar, '/api/auth/change-password', {
        currentPassword: 'Password1!',
        newPassword: 'Replacement2!',
        passwordConfirm: 'Replacement2!',
      });
      expect(changed.status).toBe(200);
      await vi.waitFor(() => expect(s.latest().phase.type).toBe('closed'));
      expect(
        await h.database.db
          .select()
          .from(session)
          .where(eq(session.userId, identity.person.id)),
      ).toEqual([]);
      expect(
        (
          await h.request(jar, '/api/auth/sign-in/email', {
            email,
            password: 'Password1!',
          })
        ).status,
      ).toBe(401);
      await h.signIn(jar, email, 'Replacement2!');
    } finally {
      await h.close();
    }
  });
  it('rejects a session lookup or socket admission overtaken by a sign-out', async () => {
    const h = await authHarness();
    try {
      const jar = new CookieJar();
      await h.register(jar, `${randomUUID()}@example.com`);
      const validated = await h.bridge.normal({ cookie: jar.header() });
      if (!validated.access) throw new Error('No identity');
      const original = h.accounts.profile.bind(h.accounts);
      let release: (() => void) | undefined;
      let started: (() => void) | undefined;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const spy = vi
        .spyOn(h.accounts, 'profile')
        .mockImplementation(async (id) => {
          const profile = await original(id);
          started?.();
          await gate;
          return profile;
        });
      const pending = h.bridge.authenticate(
        { cookie: jar.header() },
        new AbortController().signal,
      );
      await waiting;
      expect((await h.request(jar, '/api/auth/sign-out', {})).status).toBe(200);
      release?.();
      expect(await pending).toBeNull();
      spy.mockRestore();
      await expect(
        h.service.connect('late-socket', validated.access, () => undefined),
      ).rejects.toThrow('AUTH_REQUIRED');
    } finally {
      await h.close();
    }
  });
  it('requires password confirmation, complexity and email verification; profile owns nickname and ELO', async () => {
    const h = await authHarness();
    try {
      const jar = new CookieJar();
      const email = `${randomUUID()}@example.com`;
      expect(
        (
          await h.request(jar, '/api/auth/sign-up/email', {
            name: 'Name',
            email,
            password: 'Password1!',
            passwordConfirm: 'wrong',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await h.request(jar, '/api/auth/sign-up/email', {
            name: 'Name',
            email,
            password: 'password',
            passwordConfirm: 'password',
          })
        ).status,
      ).toBe(400);
      const signUp = await h.request(jar, '/api/auth/sign-up/email', {
        name: 'Name',
        email,
        password: 'Password1!',
        passwordConfirm: 'Password1!',
      });
      expect(signUp.status).toBe(200);
      expect(
        (
          await h.request(jar, '/api/auth/sign-in/email', {
            email,
            password: 'Password1!',
          })
        ).status,
      ).toBe(403);
      expect((await h.request(jar, '/api/profile')).status).toBe(401);
      const link = h.messages[0]?.text
        .split('\n')
        .find((line) => line.startsWith('http://'));
      if (!link) throw new Error('No verify link');
      const parsed = new URL(link);
      expect(
        (await h.request(jar, `${parsed.pathname}${parsed.search}`)).status,
      ).toBe(302);
      const identity = await h.signIn(jar, email);
      expect(await (await h.request(jar, '/api/profile')).json()).toEqual({
        userId: identity.person.id,
        email,
        nickname: 'Name',
        elo: 1000,
      });
      expect(
        (
          await h.request(
            jar,
            '/api/profile',
            { nickname: 'New nickname', elo: 2000 },
            'PATCH',
          )
        ).status,
      ).toBe(400);
      const updated = await h.request(
        jar,
        '/api/profile',
        { nickname: 'New nickname' },
        'PATCH',
      );
      expect(await updated.json()).toMatchObject({
        nickname: 'New nickname',
        elo: 1000,
      });
      expect(
        (
          await h.request(jar, '/api/auth/update-user', {
            name: 'Bypass',
            image: 'https://image.example',
          })
        ).status,
      ).toBe(403);
      const evil = await fetch(`${h.url}/api/profile`, {
        method: 'PATCH',
        headers: {
          Cookie: jar.header(),
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nickname: 'CSRF' }),
      });
      expect(evil.status).toBe(403);
    } finally {
      await h.close();
    }
  });
  it('renews after five minutes over HTTP only; socket checks do not refresh a session or expose its token', async () => {
    const h = await authHarness();
    try {
      const jar = new CookieJar();
      const identity = await h.register(jar, `${randomUUID()}@example.com`);
      const expiresAt = new Date(Date.now() + 1800000 - 301000);
      await h.database.db
        .update(session)
        .set({ expiresAt })
        .where(eq(session.id, identity.sessionId ?? ''));
      const socket = await h.socket(jar);
      const [unchanged] = await h.database.db
        .select()
        .from(session)
        .where(eq(session.id, identity.sessionId ?? ''));
      expect(unchanged?.expiresAt.getTime()).toBe(expiresAt.getTime());
      const response = await h.request(jar, '/api/auth/get-session');
      expect(response.headers.getSetCookie().join(';')).toContain('HttpOnly');
      const body: unknown = await response.json();
      expect(body).toMatchObject({ session: { renewAfterSeconds: 300 } });
      expect(JSON.stringify(body)).not.toContain(
        unchanged?.token ?? 'unexpected',
      );
      const [renewed] = await h.database.db
        .select()
        .from(session)
        .where(eq(session.id, identity.sessionId ?? ''));
      expect(renewed?.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 1790000,
      );
      success(
        await socket.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'after-refresh',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
    } finally {
      await h.close();
    }
  });
  it('normal sign-out revokes every session and delivers closed snapshots on both devices', async () => {
    const h = await authHarness();
    try {
      const a = new CookieJar(),
        b = new CookieJar();
      const email = `${randomUUID()}@example.com`;
      const identity = await h.register(a, email);
      await h.signIn(b, email);
      const first = await h.socket(a),
        second = await h.socket(b);
      success(
        await first.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'create',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      const response = await h.request(a, '/api/auth/sign-out', {});
      expect(response.status).toBe(200);
      await vi.waitFor(() => {
        expect(first.latest().phase).toMatchObject({
          type: 'closed',
          reason: 'access_revoked',
        });
        expect(second.latest().phase).toMatchObject({
          type: 'closed',
          reason: 'access_revoked',
        });
      });
      expect(
        await h.database.db
          .select()
          .from(session)
          .where(eq(session.userId, identity.person.id)),
      ).toEqual([]);
      expect(
        await (await h.request(b, '/api/auth/get-session')).json(),
      ).toBeNull();
      expect(
        await second.client.timeout(2000).emitWithAck('solo:start', {
          requestId: 'blocked',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      ).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    } finally {
      await h.close();
    }
  });
  it('returns a neutral reset response, throttles repeat mail and accepts a fifteen-minute link exactly once', async () => {
    const h = await authHarness();
    try {
      const a = new CookieJar(),
        b = new CookieJar();
      const email = `${randomUUID()}@example.com`;
      const identity = await h.register(a, email);
      await h.signIn(b, email);
      const first = await h.socket(a),
        second = await h.socket(b);
      success(
        await first.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'reset-room',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      const known = await h.request(a, '/api/auth/request-password-reset', {
        email,
      });
      const unknown = await h.request(
        new CookieJar(),
        '/api/auth/request-password-reset',
        { email: `${randomUUID()}@example.com` },
      );
      expect(await known.json()).toEqual({
        status: true,
        message: PASSWORD_RESET_REQUEST_MESSAGE,
      });
      expect(await unknown.json()).toEqual({
        status: true,
        message: PASSWORD_RESET_REQUEST_MESSAGE,
      });
      const before = h.messages.length;
      await h.request(a, '/api/auth/request-password-reset', {
        email: email.toUpperCase(),
      });
      expect(h.messages).toHaveLength(before);
      const message = h.messages.findLast((item) =>
        item.subject.includes('Reset'),
      );
      const link = message?.text
        .split('\n')
        .find((line) => line.startsWith('http://'));
      if (!link) throw new Error('No reset email');
      const parsed = new URL(link);
      const redirect = await h.request(a, `${parsed.pathname}${parsed.search}`);
      expect(redirect.status).toBe(302);
      const location = redirect.headers.get('location');
      if (!location) throw new Error('No reset redirect');
      const token = new URL(location).searchParams.get('token');
      expect(token).toBeTruthy();
      expect(
        (
          await h.request(a, '/api/auth/reset-password', {
            token,
            newPassword: 'Replacement2!',
            passwordConfirm: 'wrong',
          })
        ).status,
      ).toBe(400);
      const reset = await h.request(a, '/api/auth/reset-password', {
        token,
        newPassword: 'Replacement2!',
        passwordConfirm: 'Replacement2!',
      });
      expect(reset.status).toBe(200);
      await vi.waitFor(() => {
        expect(first.latest().phase.type).toBe('closed');
        expect(second.latest().phase.type).toBe('closed');
      });
      expect(
        (
          await h.request(a, '/api/auth/reset-password', {
            token,
            newPassword: 'Replacement3!',
            passwordConfirm: 'Replacement3!',
          })
        ).status,
      ).toBe(400);
      expect(
        await h.database.db
          .select()
          .from(session)
          .where(eq(session.userId, identity.person.id)),
      ).toEqual([]);
      expect((await h.request(b, '/api/profile')).status).toBe(401);
      await h.signIn(a, email, 'Replacement2!');
    } finally {
      await h.close();
    }
  });
  it('requires a password for atomic account deletion and revokes access on all devices', async () => {
    const h = await authHarness();
    try {
      const a = new CookieJar(),
        b = new CookieJar();
      const email = `${randomUUID()}@example.com`;
      const identity = await h.register(a, email);
      await h.signIn(b, email);
      expect(
        (await h.request(a, '/api/auth/delete-user', { password: 'wrong' }))
          .status,
      ).toBe(400);
      expect((await h.request(a, '/api/profile')).status).toBe(200);
      const deletion = await h.request(a, '/api/auth/delete-user', {
        password: 'Password1!',
      });
      expect(deletion.status).toBe(200);
      expect(
        await h.database.db
          .select()
          .from(user)
          .where(eq(user.id, identity.person.id)),
      ).toEqual([]);
      expect(
        await h.database.db
          .select()
          .from(userProfile)
          .where(eq(userProfile.userId, identity.person.id)),
      ).toEqual([]);
      expect(
        await h.database.db
          .select()
          .from(session)
          .where(eq(session.userId, identity.person.id)),
      ).toEqual([]);
      expect((await h.request(b, '/api/profile')).status).toBe(401);
      expect(a.header()).not.toContain('session_token');
    } finally {
      await h.close();
    }
  });
});
