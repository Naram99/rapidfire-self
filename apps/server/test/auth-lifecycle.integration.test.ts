import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { session } from '../src/database/auth-schema.js';
import { game } from '../src/database/schema.js';
import { authHarness, CookieJar } from './auth-helpers.js';
import { success } from './game-helpers.js';

describe('real cookie, socket and match lifecycle', () => {
  it('revokes registered return proofs at finish and reidentifies in the next lobby before ready is allowed', async () => {
    const h = await authHarness(true);
    try {
      const jar = new CookieJar();
      const email = `${randomUUID()}@example.com`;
      const identity = await h.register(jar, email);
      const s = await h.socket(jar);
      const created = success(
        await s.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'room',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      if (!('scope' in created.data)) throw new Error('No scope');
      await vi.waitFor(() => expect(s.latest().room).not.toBeNull());
      success(
        await s.client.timeout(2000).emitWithAck('room:ready', {
          requestId: 'ready',
          roomId: created.data.scope.id,
          lobbyCycleId: s.latest().room?.lobbyCycleId ?? '',
          ready: true,
        }),
      );
      await h.advance(5000);
      expect((await h.request(jar, '/api/match-access', {})).status).toBe(200);
      const proof =
        jar
          .header()
          .split('; ')
          .find((part) => part.startsWith(h.bridge.cookies.names.match)) ?? '';
      await vi.waitFor(() =>
        expect(s.latest().phase.type).toBe('category_selection'),
      );
      const phase = s.latest().phase;
      if (phase.type !== 'category_selection') throw new Error('No category');
      success(
        await s.client.timeout(2000).emitWithAck('category:select', {
          requestId: 'category',
          matchId: s.latest().match?.id ?? '',
          phaseId: phase.id,
          roundId: phase.roundId,
          categoryId: phase.offeredCategories[0]?.id ?? '',
        }),
      );
      await h.settle();
      await h.database.db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(session.userId, identity.person.id));
      for (let i = 0; i < 5; i++) {
        await h.advance(3000);
        await vi.waitFor(() => expect(s.latest().phase.type).toBe('answering'));
        const phase = s.latest().phase;
        if (phase.type !== 'answering') throw new Error('No question');
        success(
          await s.client.timeout(2000).emitWithAck('answer:submit', {
            requestId: `answer-${i}`,
            matchId: s.latest().match?.id ?? '',
            questionId: phase.question.id,
            selectedOptionIds: ['a'],
          }),
        );
        await h.advance(5000);
      }
      await vi.waitFor(() => expect(s.latest().phase.type).toBe('finished'));
      await h.service.persistenceIdle();
      await vi.waitFor(() =>
        expect(s.latest().match?.persistence.status).toBe('saved'),
      );
      expect(
        await h.bridge.authenticate(
          { cookie: proof },
          new AbortController().signal,
        ),
      ).toBeNull();
      await h.advance(15000);
      await vi.waitFor(() =>
        expect(s.latest().room?.members[0]).toMatchObject({
          ready: false,
          authentication: 'required',
        }),
      );
      expect(
        await s.client.timeout(2000).emitWithAck('room:ready', {
          requestId: 'blocked',
          roomId: created.data.scope.id,
          lobbyCycleId: s.latest().room?.lobbyCycleId ?? '',
          ready: true,
        }),
      ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
      await h.signIn(jar, email);
      await h.request(jar, '/api/auth/get-session');
      const restored = await h.socket(jar);
      await vi.waitFor(() =>
        expect(restored.latest().room?.members[0]).toMatchObject({
          ready: false,
          authentication: 'valid',
        }),
      );
    } finally {
      await h.close();
    }
  });
  it('runs a guest solo match without auth rows or history and expires both proofs after the results screen', async () => {
    const h = await authHarness(true);
    try {
      const jar = new CookieJar();
      const created = await h.request(jar, '/api/guest/session', {
        nickname: 'Guest',
      });
      expect(created.status).toBe(200);
      expect(created.headers.getSetCookie()[0]).toContain(
        'HttpOnly; SameSite=Lax; Max-Age=900',
      );
      const s = await h.socket(jar);
      expect(
        await s.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'guest-room',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      ).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
      success(
        await s.client.timeout(2000).emitWithAck('solo:start', {
          requestId: 'guest-solo',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      expect((await h.request(jar, '/api/match-access', {})).status).toBe(404);
      await h.advance(5000);
      await vi.waitFor(() =>
        expect(s.latest().phase.type).toBe('category_selection'),
      );
      const proof = await h.request(jar, '/api/match-access', {});
      expect(proof.status).toBe(200);
      expect(proof.headers.getSetCookie()[0]).toContain('Max-Age=1800');
      const phase = s.latest().phase;
      if (phase.type !== 'category_selection' || !s.latest().match)
        throw new Error('No category selection');
      success(
        await s.client.timeout(2000).emitWithAck('category:select', {
          requestId: 'category',
          matchId: s.latest().match?.id ?? '',
          phaseId: phase.id,
          roundId: phase.roundId,
          categoryId: phase.offeredCategories[0]?.id ?? '',
        }),
      );
      await h.settle();
      for (let i = 0; i < 5; i++) {
        await h.advance(3000);
        await vi.waitFor(() => expect(s.latest().phase.type).toBe('answering'));
        const question = s.latest().phase;
        if (question.type !== 'answering') throw new Error('No question');
        success(
          await s.client.timeout(2000).emitWithAck('answer:submit', {
            requestId: `answer-${i}`,
            matchId: s.latest().match?.id ?? '',
            questionId: question.question.id,
            selectedOptionIds: ['a'],
          }),
        );
        await h.advance(5000);
      }
      await vi.waitFor(() => expect(s.latest().phase.type).toBe('finished'));
      expect(s.latest().match?.persistence.status).toBe('not_saved_guest');
      expect((await h.request(jar, '/api/games')).status).toBe(401);
      expect(await h.database.db.select().from(game)).toEqual([]);
      const identities = await h.database.db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM "user"`,
      );
      expect(identities.rows[0]?.count).toBe(0);
      await h.advance(15000);
      expect(
        (await h.request(jar, '/api/guest/session/renew', {})).status,
      ).toBe(401);
      await expect(h.socket(jar)).rejects.toThrow('AUTH_REQUIRED');
    } finally {
      await h.close();
    }
  });
  it('allows only the same live match after auth expiry; another signed-in identity never inherits the proof', async () => {
    const h = await authHarness(true);
    try {
      const jar = new CookieJar();
      const identity = await h.register(jar, `${randomUUID()}@example.com`);
      const s = await h.socket(jar);
      success(
        await s.client.timeout(2000).emitWithAck('solo:start', {
          requestId: 'solo',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      await h.advance(5000);
      const proof = await h.request(jar, '/api/match-access', {});
      expect(proof.status).toBe(200);
      const issued: unknown = await proof.json();
      expect(issued).toMatchObject({ matchId: s.latest().match?.id });
      await h.database.db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(session.userId, identity.person.id));
      const returning = await h.socket(jar);
      await vi.waitFor(() =>
        expect(returning.latest().phase.type).toBe('category_selection'),
      );
      expect(
        await returning.client.timeout(2000).emitWithAck('solo:start', {
          requestId: 'new-denied',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
      expect((await h.request(jar, '/api/profile')).status).toBe(401);
      expect((await h.request(jar, '/api/match-access', {})).status).toBe(401);
      const otherEmail = `${randomUUID()}@example.com`;
      const other = await h.register(jar, otherEmail);
      const authenticated = await h.bridge.authenticate(
        { cookie: jar.header() },
        new AbortController().signal,
      );
      expect(authenticated?.person.id).toBe(other.person.id);
      expect(authenticated?.person.id).not.toBe(identity.person.id);
      expect(authenticated?.type).toBe('session');
      success(
        await returning.client.timeout(2000).emitWithAck('match:leave', {
          requestId: 'leave',
          matchId: s.latest().match?.id ?? '',
        }),
      );
      expect(h.service.matchAccess(identity.person.id)).toBeNull();
      const matchCookie = jar
        .header()
        .split('; ')
        .find((part) => part.startsWith(h.bridge.cookies.names.match));
      expect(
        await h.bridge.authenticate(
          { cookie: matchCookie ?? '' },
          new AbortController().signal,
        ),
      ).toBeNull();
    } finally {
      await h.close();
    }
  });
  it('expired auth plus a live match proof can sign out and revokes other devices too', async () => {
    const h = await authHarness(true);
    try {
      const a = new CookieJar(),
        b = new CookieJar();
      const email = `${randomUUID()}@example.com`;
      const identity = await h.register(a, email);
      await h.signIn(b, email);
      const s = await h.socket(a),
        other = await h.socket(b);
      success(
        await s.client.timeout(2000).emitWithAck('solo:start', {
          requestId: 'solo',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      await h.advance(5000);
      expect((await h.request(a, '/api/match-access', {})).status).toBe(200);
      await h.database.db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(session.id, identity.sessionId ?? ''));
      const response = await h.request(a, '/api/auth/sign-out', {});
      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(other.latest().phase.type).toBe('closed'));
      expect(
        await h.database.db
          .select()
          .from(session)
          .where(eq(session.userId, identity.person.id)),
      ).toEqual([]);
      expect(
        await h.bridge.authenticate(
          { cookie: a.header() },
          new AbortController().signal,
        ),
      ).toBeNull();
    } finally {
      await h.close();
    }
  });
  it('signs out an expired guest through its live match proof and closes every connection', async () => {
    const h = await authHarness(true);
    try {
      const jar = new CookieJar();
      expect(
        (await h.request(jar, '/api/guest/session', { nickname: 'Guest' }))
          .status,
      ).toBe(200);
      const original = await h.socket(jar);
      success(
        await original.client.timeout(2000).emitWithAck('solo:start', {
          requestId: 'solo',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      await h.advance(5000);
      expect((await h.request(jar, '/api/match-access', {})).status).toBe(200);
      await h.advance(900000);
      expect(
        (await h.request(jar, '/api/guest/session/renew', {})).status,
      ).toBe(401);
      const returning = await h.socket(jar);
      const response = await h.request(jar, '/api/guest/sign-out', {});
      expect(response.status).toBe(200);
      await vi.waitFor(() => {
        expect(original.latest().phase.type).toBe('closed');
        expect(returning.latest().phase.type).toBe('closed');
      });
      expect(
        await h.bridge.authenticate(
          { cookie: jar.header() },
          new AbortController().signal,
        ),
      ).toBeNull();
      expect(await h.database.db.select().from(game)).toEqual([]);
    } finally {
      await h.close();
    }
  });
  it('anonymizes deleted participants in the live match and preserves other players history', async () => {
    const h = await authHarness(true);
    try {
      const a = new CookieJar(),
        b = new CookieJar();
      await h.register(a, `${randomUUID()}@example.com`, 'Must disappear');
      await h.register(b, `${randomUUID()}@example.com`, 'Other player');
      const first = await h.socket(a),
        other = await h.socket(b);
      const created = success(
        await first.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'room',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      if (!('scope' in created.data) || !created.data.roomCode)
        throw new Error('No room');
      success(
        await other.client.timeout(2000).emitWithAck('room:join', {
          requestId: 'join',
          roomCode: created.data.roomCode,
        }),
      );
      await vi.waitFor(() =>
        expect(other.latest().room?.members).toHaveLength(2),
      );
      for (const s of [first, other])
        success(
          await s.client.timeout(2000).emitWithAck('room:ready', {
            requestId: `ready-${s.client.id}`,
            roomId: created.data.scope.id,
            lobbyCycleId: s.latest().room?.lobbyCycleId ?? '',
            ready: true,
          }),
        );
      await h.advance(5000);
      await h.service.persistenceIdle();
      const matchId = other.latest().match?.id;
      expect(matchId).toBeTruthy();
      expect(
        (
          await h.request(a, '/api/auth/delete-user', {
            password: 'Password1!',
          })
        ).status,
      ).toBe(200);
      await vi.waitFor(() =>
        expect(other.latest().match?.participants[0]).toMatchObject({
          name: '',
          identityState: 'deleted_user',
          participation: 'left',
        }),
      );
      const history = await h.request(b, `/api/games/${matchId}`);
      expect(history.status).toBe(200);
      expect(await history.json()).toMatchObject({
        participants: [
          { name: null, identityState: 'deleted_user' },
          { name: 'Other player' },
        ],
      });
    } finally {
      await h.close();
    }
  });
});
