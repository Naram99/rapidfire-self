import { describe, expect, it } from 'vitest';
import type { Checkpoint } from '../src/application/ports.js';
import { RequestCache } from '../src/application/request-cache.js';
import { parseCommand } from '@rapidfire/contracts';
import {
  harness,
  success,
  createRoom,
  ready,
  choose,
  submit,
} from './game-helpers.js';

describe('asynchronous adapters and intake ordering', () => {
  it('isolates adapter notification failures from match timers and guest cleanup', async () => {
    const h = harness({
      onMatchStarted: () => {
        throw new Error('Notification unavailable');
      },
      onGuestFinished: () => {
        throw new Error('Notification unavailable');
      },
    });
    const guest = await h.client('guest1', 'guest');
    success(
      await guest.send('solo:start', {
        settings: { rounds: 1, answerTimeMs: 20000 },
      }),
    );
    await h.advance(5000);
    expect(guest.latest().phase.type).toBe('category_selection');
    await choose(guest);
    await h.settle();
    await h.advance(3000);
    expect(guest.latest().phase.type).toBe('answering');
    const matchId = guest.latest().match?.id;
    success(await guest.send('match:leave', { matchId }));
    expect(guest.latest().phase.type).toBe('closed');
    await expect(h.client('guest1', 'guest')).rejects.toThrow('AUTH_REQUIRED');
    const other = await h.client('u1');
    await createRoom(other);
    expect(other.latest().phase.type).toBe('lobby');
    expect(h.errors).toEqual([
      'MATCH_STARTED_NOTIFICATION_FAILED',
      'GUEST_FINISHED_NOTIFICATION_FAILED',
    ]);
  });
  it('reports a final failed save after all three attempts while intermediate failures leave gameplay running', async () => {
    let finals = 0;
    const h = harness({
      persistence: {
        save: async (job) => {
          if (job.kind === 'final') finals++;
          throw new Error('Unavailable');
        },
      },
    });
    const user = await h.client('u1');
    await user.send('solo:start', {
      settings: { rounds: 1, answerTimeMs: 20000 },
    });
    await h.advance(5000);
    await choose(user);
    await h.settle();
    await h.advance(3000);
    for (let number = 1; number <= 5; number++) {
      await submit(user, number === 2 ? ['a', 'b'] : ['a']);
      await h.advance(5000);
      if (number < 5) await h.advance(3000);
    }
    expect(user.latest().phase.type).toBe('finished');
    expect(user.latest().match?.participants[0]?.score).toBe(5000);
    await h.advance(2000);
    await h.advance(2000);
    expect(finals).toBe(3);
    expect(user.latest().match?.persistence.status).toBe('failed');
    await h.advance(11000);
    expect(user.latest().recentResult?.persistence.status).toBe('failed');
  });
  it('slow preparation in one room does not block another room and stale preparations have no effect', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let calls = 0;
    const h = harness({
      prepare: async () => {
        calls++;
        if (calls === 1)
          return new Promise<unknown>((resolve) => {
            resolveFirst = resolve;
          });
        return [];
      },
    });
    const first = await h.client('u1');
    const second = await h.client('u2');
    await createRoom(first);
    await createRoom(second);
    await ready(first);
    await ready(second);
    await h.advance(5000);
    await choose(first);
    await choose(second);
    await h.settle();
    expect(first.latest().phase).toMatchObject({
      type: 'preparing_questions',
      attempt: 1,
    });
    expect(second.latest().phase.type).toBe('interrupted');
    await h.advance(15000);
    expect(first.latest().phase.type).toBe('interrupted');
    const version = first.latest().stateVersion;
    resolveFirst?.([]);
    await h.settle();
    expect(first.latest().stateVersion).toBe(version);
  });
  it('uses the captured receive time even if queue execution occurs after the answer deadline', async () => {
    const h = harness();
    const user = await h.client('u1');
    await createRoom(user);
    await ready(user);
    await h.advance(5000);
    await choose(user);
    await h.settle();
    await h.advance(3000);
    const opened = user.latest();
    if (opened.phase.type !== 'answering' || !opened.match)
      throw new Error('No question');
    const deadline = opened.phase.deadline;
    h.timers.now = deadline - 1;
    const pending = user.send('answer:submit', {
      matchId: opened.match.id,
      questionId: opened.phase.question.id,
      selectedOptionIds: ['a'],
    });
    h.timers.now = deadline + 5000;
    const timer = [...h.timers.timers.values()].find(
      (timer) => timer.deadline === deadline,
    );
    timer?.callback();
    success(await pending);
    await h.settle();
    expect(user.latest().phase).toMatchObject({
      type: 'evaluation',
      deadline: h.timers.now + 5000,
    });
    expect(user.latest().match?.participants[0]?.score).toBe(500);
    expect(h.errors).toEqual([]);
  });
  it('keeps save jobs off the game queue, strips questions/answers, retries final save three times and reports after return', async () => {
    let release: (() => void) | undefined;
    const jobs: Checkpoint[] = [];
    let attempts = 0;
    const h = harness({
      persistence: {
        save: async (job) => {
          jobs.push(job);
          if (job.kind === 'start')
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          if (job.kind === 'final') {
            attempts++;
            if (attempts < 3) throw new Error('Transient');
          }
        },
      },
    });
    const user = await h.client('u1');
    success(
      await user.send('solo:start', {
        settings: { rounds: 1, answerTimeMs: 20000 },
      }),
    );
    await h.advance(5000);
    await choose(user);
    await h.settle();
    await h.advance(3000);
    for (let number = 1; number <= 5; number++) {
      await submit(user, number === 2 ? ['a', 'b'] : ['a']);
      await h.advance(5000);
      if (number < 5) await h.advance(3000);
    }
    expect(user.latest().phase.type).toBe('finished');
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(jobs)).not.toContain('Private question');
    expect(JSON.stringify(jobs)).not.toContain('selectedOptionIds');
    await h.advance(15000);
    expect(user.latest().phase.type).toBe('closed');
    release?.();
    await h.settle();
    expect(user.latest().recentResult?.persistence.status).toBe('retrying');
    await h.advance(2000);
    expect(attempts).toBe(2);
    await h.advance(2000);
    expect(attempts).toBe(3);
    expect(user.latest().recentResult?.persistence.status).toBe('saved');
    expect(
      jobs.filter((job) => job.kind === 'final').map((job) => job.revision),
    ).toEqual([7, 7, 7]);
    expect(jobs.at(-1)?.match.results).toHaveLength(5);
    expect(jobs.at(-1)?.match.status).toBe('completed');
  });
  it('bounds cache capacity without evicting unexpired results and starts TTL when a result finishes', async () => {
    const clock = {
      value: 0,
      now() {
        return this.value;
      },
    };
    const cache = new RequestCache(clock, 1, 1);
    const first = parseCommand('time:sync', { requestId: 'first' });
    const second = parseCommand('time:sync', { requestId: 'second' });
    if (!first.success || !second.success) throw new Error('Invalid fixture');
    let resolve:
      ((value: Awaited<ReturnType<typeof cache.execute>>) => void) | undefined;
    const original = cache.execute(
      'u',
      first.data,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    clock.value = 700000;
    expect(
      cache.execute('u', first.data, () => {
        throw new Error('Must not execute twice');
      }),
    ).toBe(original);
    expect(() => cache.execute('u', second.data, () => original)).toThrow(
      'RATE_LIMITED',
    );
    resolve?.({
      requestId: 'first',
      serverTime: clock.value,
      ok: true,
      data: { serverTime: clock.value },
    });
    await original;
    await Promise.resolve();
    clock.value += 599999;
    expect(() => cache.execute('u', second.data, () => original)).toThrow(
      'RATE_LIMITED',
    );
    clock.value++;
    expect(cache.execute('u', second.data, () => original)).toBe(original);
  });
});
