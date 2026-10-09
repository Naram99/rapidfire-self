import { describe, expect, it } from 'vitest';
import {
  harness,
  createRoom,
  ready,
  choose,
  submit,
  success,
} from './game-helpers.js';

describe('scope, identity and snapshot regressions', () => {
  it('does not persist a countdown interrupted before the match actually started', async () => {
    let saved = 0;
    const h = harness({
      persistence: {
        save: async () => {
          saved++;
        },
      },
    });
    const user = await h.client('u1');
    success(
      await user.send('solo:start', {
        settings: {
          topicId: 'league-of-legends',
          rounds: 1,
          answerTimeMs: 20000,
        },
      }),
    );
    await h.service.shutdown();
    await h.service.persistenceIdle();
    expect(saved).toBe(0);
    expect(h.errors).toEqual([]);
  });
  it('drains pending persistence after a match and its last connection have been disposed', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({ persistence: { save: async () => gate } });
    const user = await h.client('u1');
    success(
      await user.send('solo:start', {
        settings: {
          topicId: 'league-of-legends',
          rounds: 1,
          answerTimeMs: 20000,
        },
      }),
    );
    await h.advance(5000);
    success(
      await user.send('match:leave', {
        matchId: user.latest().match?.id ?? '',
      }),
    );
    await h.service.disconnect(user.id);
    let finished = false;
    const drain = h.service.persistenceIdle().then(() => {
      finished = true;
    });
    await h.settle();
    expect(finished).toBe(false);
    release?.();
    await drain;
    expect(finished).toBe(true);
  });
  it('does not expose a previous match result to a newly joined lobby member', async () => {
    const h = harness();
    const previous = await h.client('u1');
    const room = await createRoom(previous);
    await ready(previous);
    await h.advance(5000);
    await choose(previous);
    await h.settle();
    await h.advance(3000);
    for (let number = 1; number <= 5; number++) {
      await submit(previous, number === 2 ? ['a', 'b'] : ['a']);
      await h.advance(5000);
      if (number < 5) await h.advance(3000);
    }
    await h.advance(15000);
    expect(previous.latest().recentResult).not.toBeNull();
    const newcomer = await h.client('u2');
    success(await newcomer.send('room:join', { roomCode: room.code }));
    expect(newcomer.latest().recentResult).toBeNull();
    expect(previous.latest().recentResult).not.toBeNull();
  });
  it('allows a verified match credential only for its existing participation, then rejects it after explicit leave', async () => {
    const h = harness();
    const user = await h.client('u1');
    const second = await h.client('u2');
    const room = await createRoom(user);
    await second.send('room:join', { roomCode: room.code });
    await ready(user);
    await ready(second);
    await h.advance(5000);
    const matchId = user.latest().match?.id;
    if (!matchId) throw new Error('No match');
    const proof = {
      type: 'match' as const,
      person: user.access.person,
      expiresAt: h.timers.now + 1800000,
      matchId,
    };
    const reconnect = await h.client('u1', 'user', 0, proof);
    expect(reconnect.latest().phase.type).toBe('category_selection');
    expect(
      await reconnect.send('solo:start', {
        settings: {
          topicId: 'league-of-legends',
          rounds: 1,
          answerTimeMs: 20000,
        },
      }),
    ).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    await expect(
      h.client('u3', 'user', 0, {
        ...proof,
        person: { ...proof.person, id: 'u3' },
      }),
    ).rejects.toThrow('AUTH_REQUIRED');
    await expect(
      h.client('u1', 'user', 0, { ...proof, matchId: 'wrong-match' }),
    ).rejects.toThrow('AUTH_REQUIRED');
    success(await user.send('room:leave', { roomId: room.id }));
    await expect(h.client('u1', 'user', 0, proof)).rejects.toThrow(
      'AUTH_REQUIRED',
    );
  });
  it('clears the reauthentication hold on fresh proof without restoring ready automatically', async () => {
    const h = harness();
    const user = await h.client('u1', 'user', 2000);
    await createRoom(user);
    await h.advance(1000);
    expect(user.latest().room?.members[0]?.authentication).toBe('required');
    await h.advance(30000);
    await h.service.refresh(user.id, { ...user.access, expiresAt: 200000 });
    expect(user.latest().room?.members[0]).toMatchObject({
      authentication: 'valid',
      ready: false,
      graceDeadline: null,
    });
    await h.advance(30000);
    expect(user.latest().phase.type).toBe('lobby');
    success(await ready(user));
    expect(user.latest().phase.type).toBe('start_countdown');
  });
  it('never sends a former member later match ids, questions or lobby snapshots', async () => {
    const h = harness();
    const former = await h.client('u1');
    const remaining = await h.client('u2');
    const room = await createRoom(former);
    await remaining.send('room:join', { roomCode: room.code });
    await ready(former);
    await ready(remaining);
    await h.advance(5000);
    await choose(former);
    await h.settle();
    await h.advance(3000);
    await former.send('room:leave', { roomId: room.id });
    const count = former.snapshots.length;
    for (let number = 1; number <= 5; number++) {
      await submit(remaining, number === 2 ? ['a', 'b'] : ['a']);
      await h.advance(5000);
      if (number < 5) await h.advance(3000);
    }
    await h.advance(15000);
    await ready(remaining);
    await h.advance(5000);
    expect(former.snapshots).toHaveLength(count);
    expect(former.latest().phase.type).toBe('closed');
    expect(remaining.latest().phase.type).toBe('category_selection');
  });
  it('keeps snapshots detached from authoritative state and excludes auth identifiers', async () => {
    const h = harness();
    const user = await h.client('u1');
    const room = await createRoom(user);
    await ready(user);
    await h.advance(5000);
    await choose(user);
    await h.settle();
    await h.advance(3000);
    const received = user.latest();
    const participant = received.match?.participants[0];
    if (!participant) throw new Error('No participant');
    Reflect.set(participant, 'score', 900000);
    if (received.phase.type === 'answering')
      Reflect.set(received.phase.question.options[0] ?? {}, 'text', 'Tampered');
    success(
      await user.send('state:sync', { scope: { type: 'room', id: room.id } }),
    );
    expect(user.latest().match?.participants[0]?.score).toBe(0);
    expect(JSON.stringify(user.latest())).not.toContain('Tampered');
    expect(JSON.stringify(user.latest())).not.toMatch(
      /"(personId|access|grant|token|correctOptionIds)"/,
    );
  });
  it('last leave interrupts and publishes one coherent closed result to each device', async () => {
    const h = harness();
    const user = await h.client('u1');
    const duplicate = await h.client('u1');
    await createRoom(user);
    await ready(user);
    await h.advance(5000);
    const roomId = user.latest().room?.id;
    if (!roomId) throw new Error('No room');
    const before = duplicate.snapshots.length;
    success(await user.send('room:leave', { roomId }));
    expect(duplicate.snapshots.slice(before)).toHaveLength(1);
    expect(duplicate.latest().phase).toMatchObject({
      type: 'closed',
      reason: 'left',
    });
  });
});
