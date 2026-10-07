import { randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Clock, Dependencies, TimerPort } from '../application/ports.js';
import { staticQuestions } from './static-questions.js';

export function monotonicClock(): Clock {
  const epoch = Date.now();
  const origin = performance.now();
  return { now: () => Math.floor(epoch + performance.now() - origin) };
}
export class NodeTimers implements TimerPort {
  private readonly handles = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly clock: Clock) {}
  schedule(key: string, deadline: number, callback: () => void): void {
    this.cancel(key);
    const handle = setTimeout(
      () => {
        this.handles.delete(key);
        callback();
      },
      Math.max(0, deadline - this.clock.now()),
    );
    handle.unref();
    this.handles.set(key, handle);
  }
  cancel(key: string): void {
    const handle = this.handles.get(key);
    if (handle) clearTimeout(handle);
    this.handles.delete(key);
  }
}
export function runtimeDependencies(): Dependencies {
  const clock = monotonicClock();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return {
    clock,
    timers: new NodeTimers(clock),
    questions: staticQuestions,
    id: randomUUID,
    roomCode: () =>
      Array.from({ length: 6 }, () =>
        alphabet.charAt(randomInt(alphabet.length)),
      ).join(''),
    random: () =>
      Array.from({ length: 5 }, () => randomInt(0x1_0000_0000) / 0x1_0000_0000),
    persistence: null,
    onError: (code) => console.warn(code),
    onMatchStarted: () => undefined,
    onGuestFinished: () => undefined,
  };
}
