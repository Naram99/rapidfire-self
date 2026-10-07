import { describe, expect, it } from 'vitest';
import {
  createRoom,
  harness,
  ready,
  scopeOf,
  submit,
  success,
  choose,
  receiptOf,
} from './game-helpers.js';

describe('lobby ownership, lifecycle and exclusive flow', () => {
  it('atomically reserves one flow across multiple devices and concurrent starts', async () => {
    const h = harness();
    const first = await h.client('u1');
    const other = await h.client('u1');
    const results = await Promise.all([
      first.send('room:create', {
        settings: { rounds: 1, answerTimeMs: 20_000 },
      }),
      other.send('solo:start', {
        settings: { rounds: 1, answerTimeMs: 20_000 },
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      error: { code: 'ALREADY_IN_ROOM' },
    });
    expect(first.latest().scope).toEqual(other.latest().scope);
  });
  it('new members cancel countdown; no-op settings preserve readiness and changed settings reset it', async () => {
    const h = harness();
    const owner = await h.client('owner');
    const member = await h.client('member');
    const room = await createRoom(owner);
    success(await ready(owner));
    expect(owner.latest().phase.type).toBe('start_countdown');
    await member.send('room:join', { roomCode: room.code });
    expect(owner.latest().phase.type).toBe('lobby');
    expect(owner.latest().room?.members[0]?.ready).toBe(true);
    const version = owner.latest().room?.settingsVersion;
    success(
      await owner.send('room:settings:update', {
        roomId: room.id,
        expectedSettingsVersion: version,
        settings: { rounds: 1, answerTimeMs: 20_000 },
      }),
    );
    expect(owner.latest().room?.members[0]?.ready).toBe(true);
    expect(
      await member.send('room:settings:update', {
        roomId: room.id,
        expectedSettingsVersion: version,
        settings: { rounds: 1, answerTimeMs: 10_000 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    success(await ready(member));
    expect(owner.latest().phase.type).toBe('start_countdown');
    success(
      await owner.send('room:settings:update', {
        roomId: room.id,
        expectedSettingsVersion: version,
        settings: { rounds: 2, answerTimeMs: 10_000 },
      }),
    );
    expect(owner.latest().phase.type).toBe('lobby');
    expect(owner.latest().room?.members.every((p) => !p.ready)).toBe(true);
    expect(
      await owner.send('room:settings:update', {
        roomId: room.id,
        expectedSettingsVersion: version,
        settings: { rounds: 1, answerTimeMs: 10_000 },
      }),
    ).toMatchObject({ error: { code: 'STALE_STATE', resyncRequired: true } });
    await h.advance(5_000);
    expect(h.started).toEqual([]);
    expect(h.errors).toEqual([]);
  });
  it('last connection loss clears readiness, reconnect keeps it false, and stale timers cannot remove the member', async () => {
    const h = harness();
    const owner = await h.client('u1');
    const second = await h.client('u1');
    await createRoom(owner);
    success(await ready(owner));
    await h.service.disconnect(owner.id);
    expect(second.latest().phase.type).toBe('start_countdown');
    await h.service.disconnect(second.id);
    const grace = [...h.timers.timers.values()].find(
      (timer) => timer.deadline === h.timers.now + 60_000,
    );
    expect(grace).toBeDefined();
    await h.advance(10_000);
    const reconnect = await h.client('u1');
    expect(reconnect.latest().phase.type).toBe('lobby');
    expect(reconnect.latest().room?.members[0]).toMatchObject({
      presence: 'online',
      ready: false,
      graceDeadline: null,
    });
    grace?.callback();
    await h.settle();
    expect(reconnect.latest().phase.type).toBe('lobby');
  });
  it('removes offline members after exactly 60 seconds and transfers ownership by join order', async () => {
    const h = harness();
    const owner = await h.client('u1');
    const second = await h.client('u2');
    const third = await h.client('u3');
    const room = await createRoom(owner);
    success(await second.send('room:join', { roomCode: room.code }));
    success(await third.send('room:join', { roomCode: room.code }));
    await h.service.disconnect(owner.id);
    await h.advance(59_999);
    expect(second.latest().room?.members).toHaveLength(3);
    await h.advance(1);
    expect(second.latest().room?.members).toHaveLength(2);
    expect(second.latest().room?.ownerMemberId).toBe(
      second.latest().self.memberId,
    );
    success(await second.send('room:leave', { roomId: room.id }));
    expect(second.latest().phase).toMatchObject({
      type: 'closed',
      reason: 'left',
    });
    expect(third.latest().room?.ownerMemberId).toBe(
      third.latest().self.memberId,
    );
    success(await third.send('room:leave', { roomId: room.id }));
    expect(
      await owner.send('room:join', { roomCode: room.code }),
    ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    const fresh = await h.client('u4');
    expect(
      await fresh.send('room:join', { roomCode: room.code }),
    ).toMatchObject({ error: { code: 'ROOM_NOT_FOUND' } });
  });
  it('enforces the room cap, guest permissions and cross-room authorization', async () => {
    const h = harness();
    const owner = await h.client('u1');
    const room = await createRoom(owner);
    for (let i = 2; i <= 10; i++)
      success(
        await (
          await h.client(`u${i}`)
        ).send('room:join', { roomCode: room.code }),
      );
    const extra = await h.client('u11');
    expect(
      await extra.send('room:join', { roomCode: room.code }),
    ).toMatchObject({ error: { code: 'ROOM_FULL' } });
    const guest = await h.client('g1', 'guest');
    expect(
      await guest.send('room:create', {
        settings: { rounds: 1, answerTimeMs: 20_000 },
      }),
    ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    const otherRoom = await createRoom(extra);
    expect(
      await extra.send('state:sync', { scope: { type: 'room', id: room.id } }),
    ).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(otherRoom.id).not.toBe(room.id);
    expect(h.errors).toEqual([]);
  });
});

describe('match, projections and multi-device commands', () => {
  it('runs a room match, publishes safe personal snapshots and returns to a fresh lobby cycle', async () => {
    const h = harness();
    const owner = await h.client('u1');
    const duplicate = await h.client('u1');
    const opponent = await h.client('u2');
    const outsider = await h.client('u3');
    const room = await createRoom(owner);
    success(await opponent.send('room:join', { roomCode: room.code }));
    success(await ready(owner));
    success(await ready(opponent));
    const initialCycle = owner.latest().room?.lobbyCycleId;
    await h.advance(5_000);
    success(await choose(owner));
    await h.settle();
    const countdown = owner.latest();
    expect(countdown.phase.type).toBe('question_countdown');
    expect(JSON.stringify(countdown)).not.toContain('Private question');
    expect(JSON.stringify(countdown)).not.toContain('correctOptionIds');
    expect(
      await outsider.send('room:join', { roomCode: room.code }),
    ).toMatchObject({ error: { code: 'ROOM_GAME_ACTIVE' } });
    await h.advance(3_000);
    for (let number = 1; number <= 5; number++) {
      const phase = owner.latest().phase;
      if (phase.type !== 'answering') throw new Error('Not answering');
      expect(phase.question.text).toBe(`Private question ${number}`);
      expect(JSON.stringify(owner.latest())).not.toContain('correctOptionIds');
      const original = success(
        await submit(
          owner,
          number === 2 ? ['b', 'a'] : ['a'],
          `answer-${number}`,
        ),
      );
      expect(duplicate.latest().self.answer?.selectedOptionIds).toEqual(
        number === 2 ? ['a', 'b'] : ['a'],
      );
      expect(opponent.latest().self.answer).toBeNull();
      expect(opponent.latest().match?.participants[0]?.answered).toBe(true);
      expect(opponent.latest().match?.participants[0]?.score).toBe(
        (number - 1) * 1000,
      );
      expect(JSON.stringify(opponent.latest())).not.toContain(
        'selectedOptionIds',
      );
      expect(
        await submit(
          duplicate,
          number === 2 ? ['a', 'b'] : ['a'],
          `answer-${number}`,
        ),
      ).toEqual(original);
      success(await submit(opponent, ['d']));
      expect(owner.latest().phase.type).toBe('evaluation');
      expect(owner.latest().phase).toMatchObject({
        correctOptionIds: number === 2 ? ['a', 'b'] : ['a'],
      });
      await h.advance(5_000);
      if (number < 5) await h.advance(3_000);
    }
    expect(owner.latest().phase.type).toBe('finished');
    expect(owner.latest().match?.participants[0]?.score).toBe(5000);
    await h.advance(15_000);
    expect(owner.latest().phase.type).toBe('lobby');
    expect(owner.latest().room?.lobbyCycleId).not.toBe(initialCycle);
    expect(owner.latest().room?.members.every((p) => !p.ready)).toBe(true);
    expect(
      await owner.send('room:ready', {
        roomId: room.id,
        lobbyCycleId: initialCycle,
        ready: true,
      }),
    ).toMatchObject({ error: { code: 'STALE_STATE' } });
    expect(h.errors).toEqual([]);
  });
  it('new request ids still preserve the first answer, including after close and reconnect', async () => {
    const h = harness();
    const first = await h.client('u1');
    const other = await h.client('u2');
    const room = await createRoom(first);
    await other.send('room:join', { roomCode: room.code });
    await ready(first);
    await ready(other);
    await h.advance(5000);
    await choose(first);
    await h.settle();
    await h.advance(3000);
    const snapshot = first.latest();
    const phase = snapshot.phase;
    if (phase.type !== 'answering' || !snapshot.match)
      throw new Error('Not answering');
    const original = receiptOf(await submit(first));
    expect(receiptOf(await submit(first, ['d']))).toEqual({
      ...original,
      repeated: true,
    });
    await h.service.disconnect(first.id);
    const back = await h.client('u1');
    expect(back.latest().self.answer?.selectedOptionIds).toEqual(['a']);
    await submit(other, ['d']);
    expect(
      receiptOf(
        await back.send('answer:submit', {
          matchId: snapshot.match.id,
          questionId: phase.question.id,
          selectedOptionIds: ['d'],
        }),
      ),
    ).toEqual({ ...original, repeated: true });
    await back.send('room:leave', { roomId: room.id });
    expect(
      await back.send('answer:submit', {
        matchId: snapshot.match.id,
        questionId: phase.question.id,
        selectedOptionIds: ['a'],
      }),
    ).toMatchObject({ error: { code: 'PARTICIPANT_LEFT' } });
    expect(await back.send('room:join', { roomCode: room.code })).toMatchObject(
      { error: { code: 'ROOM_GAME_ACTIVE' } },
    );
  });
  it('ends guest rights on solo return and never submits guest persistence', async () => {
    const saves: unknown[] = [];
    const h = harness({
      persistence: {
        save: async (job) => {
          saves.push(job);
        },
      },
    });
    const guest = await h.client('g1', 'guest');
    const scope = scopeOf(
      await guest.send('solo:start', {
        settings: { rounds: 1, answerTimeMs: 20_000 },
      }),
    );
    await h.advance(5000);
    await choose(guest);
    await h.settle();
    await h.advance(3000);
    for (let number = 1; number <= 5; number++) {
      await submit(guest, number === 2 ? ['a', 'b'] : ['a']);
      await h.advance(5000);
      if (number < 5) await h.advance(3000);
    }
    expect(guest.latest().match?.persistence.status).toBe('not_saved_guest');
    await h.advance(15000);
    expect(guest.latest().phase).toMatchObject({
      type: 'closed',
      reason: 'solo_returned',
    });
    expect(guest.latest().scope).toEqual(scope);
    expect(saves).toEqual([]);
    expect(h.guestsFinished).toEqual(['g1']);
    expect(
      await guest.send('solo:start', {
        settings: { rounds: 1, answerTimeMs: 20000 },
      }),
    ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });
});

describe('session expiry, explicit revocation and cache', () => {
  it('keeps an expired session in a match, reserves the next lobby for 60 seconds, then removes it', async () => {
    const h = harness();
    const user = await h.client('u1', 'user', 11_000);
    const room = await createRoom(user);
    await ready(user);
    await h.advance(5000);
    await choose(user);
    await h.settle();
    await h.advance(3000);
    await h.advance(2000);
    expect(user.latest().permissions.canSubmitAnswer).toBe(true);
    success(await submit(user));
    expect(
      await user.send('solo:start', {
        settings: { rounds: 1, answerTimeMs: 20000 },
      }),
    ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    for (let number = 2; number <= 5; number++) {
      await h.advance(5000);
      await h.advance(3000);
      await submit(user, number === 2 ? ['a', 'b'] : ['a']);
    }
    await h.advance(5000);
    await h.advance(15000);
    expect(user.latest().phase.type).toBe('lobby');
    expect(user.latest().permissions.requiresAuthentication).toBe(true);
    expect(user.latest().room?.members[0]?.authentication).toBe('required');
    await h.advance(59999);
    expect(user.latest().phase.type).toBe('lobby');
    await h.advance(1);
    expect(user.latest().phase).toMatchObject({
      type: 'closed',
      reason: 'authentication_timeout',
    });
    const fresh = await h.client('u2');
    expect(
      await fresh.send('room:join', { roomCode: room.code }),
    ).toMatchObject({ error: { code: 'ROOM_NOT_FOUND' } });
  });
  it('uses the earlier grace deadline without extending auth by reconnect', async () => {
    const h = harness();
    const owner = await h.client('u1', 'user', 11000);
    const other = await h.client('u2');
    const room = await createRoom(owner);
    await other.send('room:join', { roomCode: room.code });
    await h.service.disconnect(owner.id);
    await h.advance(10000);
    expect(other.latest().room?.members[0]?.graceDeadline).toBe(61000);
    await h.advance(49999);
    expect(other.latest().room?.members).toHaveLength(2);
    await h.advance(1);
    expect(other.latest().room?.members).toHaveLength(1);
  });
  it('refreshes only the same person and removes explicit logout from every device', async () => {
    const h = harness();
    const first = await h.client('u1');
    const second = await h.client('u1');
    const room = await createRoom(first);
    await expect(
      h.service.refresh(first.id, {
        ...first.access,
        person: { ...first.access.person, id: 'different' },
      }),
    ).rejects.toThrow();
    await h.service.revoke('u1');
    expect(first.latest().phase).toMatchObject({
      type: 'closed',
      reason: 'access_revoked',
    });
    expect(second.latest().phase).toMatchObject({
      type: 'closed',
      reason: 'access_revoked',
    });
    expect(await first.send('time:sync')).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(
      await second.send('room:join', { roomCode: room.code }),
    ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });
  it('deduplicates in-flight creation and rejects requestId content conflicts and client identity spoofing', async () => {
    const h = harness();
    const first = await h.client('u1');
    const second = await h.client('u1');
    const payload = { settings: { rounds: 1, answerTimeMs: 20000 } };
    const [a, b] = await Promise.all([
      first.send('room:create', payload, 'shared'),
      second.send('room:create', payload, 'shared'),
    ]);
    expect(a).toEqual(b);
    expect(await second.send('solo:start', payload, 'shared')).toMatchObject({
      error: { code: 'REQUEST_ID_CONFLICT' },
    });
    expect(
      await second.send('room:create', { ...payload, userId: 'u2' }),
    ).toMatchObject({ error: { code: 'INVALID_PAYLOAD' } });
    expect(await first.send('time:sync', {}, 'clock')).toMatchObject({
      ok: true,
    });
    await h.advance(600001);
    expect(await first.send('time:sync', {}, 'clock')).toMatchObject({
      serverTime: h.timers.now,
    });
    expect(h.errors).toEqual([]);
  });
});
