import type { Clock, TimerPort } from '../application/ports.js';
import { renderEmail } from './template.js';
import type { EmailJob, EmailLog, EmailPort } from './types.js';

/** Provider work never holds the game or persistence queue. Logs contain no link or address. */
export class EmailQueue {
  private readonly waiting: EmailJob[] = [];
  private current: EmailJob | null = null;
  private abort: AbortController | null = null;
  private running = false;
  private closed = false;
  private attempt = 0;
  constructor(
    private readonly options: Readonly<{
      port: EmailPort;
      clock: Clock;
      timers: TimerPort;
      log: (event: EmailLog) => void;
      capacity?: number;
    }>,
  ) {}
  enqueue(job: EmailJob): boolean {
    if (
      this.closed ||
      this.waiting.length + Number(this.current !== null) >=
        (this.options.capacity ?? 100)
    ) {
      this.options.log({
        jobId: job.id,
        purpose: job.purpose,
        attempt: 0,
        code: 'queue_full',
      });
      return false;
    }
    this.waiting.push({ ...job });
    this.pump();
    return true;
  }
  cancelUser(userId: string): void {
    for (let index = this.waiting.length - 1; index >= 0; index--)
      if (this.waiting[index]?.userId === userId) this.waiting.splice(index, 1);
    if (this.current?.userId === userId) {
      this.abort?.abort();
      this.finish('cancelled');
    }
  }
  close(): void {
    this.closed = true;
    this.waiting.length = 0;
    this.abort?.abort();
    if (this.current) this.finish('cancelled');
  }
  private pump(): void {
    if (this.running || this.closed) return;
    const job = this.waiting.shift();
    if (!job) return;
    this.running = true;
    this.current = job;
    this.attempt = 1;
    this.send(job);
  }
  private send(job: EmailJob): void {
    if (this.current !== job || this.closed) return;
    if (job.expiresAt <= this.options.clock.now()) {
      this.finish('expired');
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    const key = `email:${job.id}:timeout`;
    const timeout = new Promise<'temporary_failure'>((resolve) =>
      this.options.timers.schedule(key, this.options.clock.now() + 5000, () => {
        abort.abort();
        resolve('temporary_failure');
      }),
    );
    void Promise.race([
      Promise.resolve()
        .then(() => this.options.port.send(renderEmail(job), abort.signal))
        .catch(() => 'temporary_failure' as const),
      timeout,
    ]).then((outcome) => {
      this.options.timers.cancel(key);
      if (this.current !== job || this.abort !== abort) return;
      if (outcome !== 'temporary_failure' || this.attempt === 3) {
        this.finish(outcome);
        return;
      }
      this.options.log({
        jobId: job.id,
        purpose: job.purpose,
        attempt: this.attempt,
        code: outcome,
      });
      const delay = this.attempt === 1 ? 2000 : 8000;
      this.attempt++;
      this.options.timers.schedule(
        `email:${job.id}:retry`,
        this.options.clock.now() + delay,
        () => this.send(job),
      );
    });
  }
  private finish(code: EmailLog['code']): void {
    const job = this.current;
    if (!job) return;
    this.options.log({
      jobId: job.id,
      purpose: job.purpose,
      attempt: this.attempt,
      code,
    });
    this.options.timers.cancel(`email:${job.id}:timeout`);
    this.options.timers.cancel(`email:${job.id}:retry`);
    this.current = null;
    this.abort = null;
    this.running = false;
    this.pump();
  }
}
