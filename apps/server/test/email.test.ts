import { describe, expect, it } from 'vitest';
import { EmailQueue } from '../src/email/queue.js';
import { renderEmail } from '../src/email/template.js';
import { smtpEmailPort } from '../src/email/smtp.js';
import type {
  EmailJob,
  EmailLog,
  EmailMessage,
  EmailPort,
} from '../src/email/types.js';
import { ManualTimers } from './game-helpers.js';

function job(id = 'job-1', userId = 'user-1'): EmailJob {
  return {
    id,
    userId,
    purpose: 'reset_password',
    recipient: 'test@example.invalid',
    locale: 'en',
    templateVersion: 1,
    actionUrl: 'https://test.invalid/reset?token=test-only&next="quoted"',
    createdAt: 1000,
    expiresAt: 901000,
  };
}
function queue(port: EmailPort, capacity = 100) {
  const timers = new ManualTimers();
  const logs: EmailLog[] = [];
  const emails = new EmailQueue({
    port,
    clock: { now: () => timers.now },
    timers,
    log: (event) => logs.push(event),
    capacity,
  });
  async function settle() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }
  async function advance(ms: number) {
    timers.now += ms;
    for (let i = 0; i < 20; i++) {
      await settle();
      const due = [...timers.timers.entries()].find(
        ([, timer]) => timer.deadline <= timers.now,
      );
      if (!due) return;
      timers.timers.delete(due[0]);
      due[1].callback();
    }
    throw new Error('Too many email timers');
  }
  return { emails, timers, logs, settle, advance };
}
describe('replaceable email delivery', () => {
  it('renders text and escaped HTML with a stable message id and no password', () => {
    const rendered = renderEmail(job());
    expect(rendered.subject).toBe('Reset your Rapidfire password');
    expect(rendered.text).toContain(job().actionUrl);
    expect(rendered.html).toContain('&amp;next=&quot;quoted&quot;');
    expect(rendered.messageId).toBe('<job-1@rapidfire.local>');
    expect(renderEmail({ ...job(), purpose: 'verify_email' }).text).toContain(
      '24 hours',
    );
  });
  it('retries temporary failures after 2 and 8 seconds with the same link and job id', async () => {
    const messages: EmailMessage[] = [];
    const h = queue({
      send: async (message) => {
        messages.push(message);
        return messages.length < 3 ? 'temporary_failure' : 'accepted';
      },
    });
    expect(h.emails.enqueue(job())).toBe(true);
    await h.settle();
    expect(messages).toHaveLength(1);
    await h.advance(1999);
    expect(messages).toHaveLength(1);
    await h.advance(1);
    expect(messages).toHaveLength(2);
    await h.advance(8000);
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual(messages[0]);
    expect(messages[2]).toEqual(messages[0]);
    expect(h.logs.map((log) => log.code)).toEqual([
      'temporary_failure',
      'temporary_failure',
      'accepted',
    ]);
    expect(JSON.stringify(h.logs)).not.toMatch(
      /test-only|recipient|actionUrl|test@example/,
    );
  });
  it('stops permanently failing delivery without retry and continues the next job', async () => {
    const ids: string[] = [];
    const h = queue({
      send: async (message) => {
        ids.push(message.messageId);
        return 'permanent_failure';
      },
    });
    h.emails.enqueue(job('first'));
    h.emails.enqueue(job('second'));
    await h.settle();
    expect(ids).toEqual([
      '<first@rapidfire.local>',
      '<second@rapidfire.local>',
    ]);
    expect(h.timers.timers.size).toBe(0);
  });
  it('times out a hung provider after five seconds and aborts each of the three attempts', async () => {
    const signals: AbortSignal[] = [];
    const h = queue({
      send: async (_message, signal) => {
        signals.push(signal);
        return new Promise(() => undefined);
      },
    });
    h.emails.enqueue(job());
    await h.settle();
    await h.advance(5000);
    expect(signals[0]?.aborted).toBe(true);
    await h.advance(2000);
    await h.advance(5000);
    await h.advance(8000);
    await h.advance(5000);
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(h.logs.at(-1)).toMatchObject({
      attempt: 3,
      code: 'temporary_failure',
    });
  });
  it('does not send a link that expires before its retry', async () => {
    let calls = 0;
    const h = queue({
      send: async () => {
        calls++;
        return 'temporary_failure';
      },
    });
    h.emails.enqueue({ ...job(), expiresAt: 2000 });
    await h.settle();
    await h.advance(2000);
    expect(calls).toBe(1);
    expect(h.logs.at(-1)?.code).toBe('expired');
  });
  it('cancels a deleted user running and waiting jobs without preventing another user delivery', async () => {
    const recipients: string[] = [];
    let signal: AbortSignal | undefined;
    const h = queue({
      send: async (message, abort) => {
        recipients.push(message.messageId);
        if (message.messageId.startsWith('<running')) {
          signal = abort;
          return new Promise(() => undefined);
        }
        return 'accepted';
      },
    });
    h.emails.enqueue(job('running'));
    h.emails.enqueue(job('waiting'));
    h.emails.enqueue(job('other', 'user-2'));
    await h.settle();
    h.emails.cancelUser('user-1');
    await h.settle();
    expect(signal?.aborted).toBe(true);
    expect(recipients).toEqual([
      '<running@rapidfire.local>',
      '<other@rapidfire.local>',
    ]);
    expect(h.logs.at(-1)?.code).toBe('accepted');
  });
  it('bounds the queue including its in-flight job and rejects new jobs after close', async () => {
    const h = queue({ send: async () => new Promise(() => undefined) }, 1);
    expect(h.emails.enqueue(job('first'))).toBe(true);
    expect(h.emails.enqueue(job('second'))).toBe(false);
    h.emails.close();
    expect(h.emails.enqueue(job('third'))).toBe(false);
    expect(h.timers.timers.size).toBe(0);
  });
  it('reports missing SMTP configuration as permanent failure without connecting', async () => {
    const result = await smtpEmailPort(null).send(
      renderEmail(job()),
      new AbortController().signal,
    );
    expect(result).toBe('permanent_failure');
  });
});
