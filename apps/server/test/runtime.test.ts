import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeTimers } from '../src/infrastructure/runtime.js';

afterEach(() => vi.useRealTimers());

describe('Node timers and the application clock', () => {
  it('waits for the deadline when the native timeout wakes up early', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const timers = new NodeTimers({ now: () => now });
    const callback = vi.fn();
    timers.schedule('question', 4000, callback);

    now = 3999;
    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    now = 4000;
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a timeout rescheduled after an early wake-up', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const timers = new NodeTimers({ now: () => now });
    const callback = vi.fn();
    timers.schedule('question', 4000, callback);

    now = 3999;
    await vi.advanceTimersByTimeAsync(3000);
    timers.cancel('question');
    now = 5000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs a delayed callback once even when the event loop missed the deadline', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const timers = new NodeTimers({ now: () => now });
    const callback = vi.fn();
    timers.schedule('question', 4000, callback);

    now = 9000;
    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces an early timeout without delivering the old callback', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const timers = new NodeTimers({ now: () => now });
    const original = vi.fn();
    const replacement = vi.fn();
    timers.schedule('question', 4000, original);

    now = 3999;
    await vi.advanceTimersByTimeAsync(3000);
    timers.schedule('question', 8000, replacement);
    now = 8000;
    await vi.advanceTimersByTimeAsync(4001);
    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
