import type { Ack, Command } from '@rapidfire/contracts';
import type { Clock } from './ports.js';
import { CommandFailure } from './errors.js';

type Entry = {
  fingerprint: string;
  result: Promise<Ack>;
  expiresAt: number;
};
export class RequestCache {
  private readonly people = new Map<string, Map<string, Entry>>();
  private size = 0;
  constructor(
    private readonly clock: Clock,
    private readonly maximum = 20_000,
    private readonly perPerson = 2_000,
  ) {}
  execute(
    personId: string,
    command: Command,
    run: () => Promise<Ack>,
  ): Promise<Ack> {
    this.prune();
    let entries = this.people.get(personId);
    const payload =
      command.type === 'answer:submit'
        ? {
            ...command.payload,
            selectedOptionIds: [...command.payload.selectedOptionIds].sort(),
          }
        : command.payload;
    const fingerprint = JSON.stringify({ type: command.type, payload });
    const previous = entries?.get(command.payload.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new CommandFailure('REQUEST_ID_CONFLICT');
      return previous.result;
    }
    if (this.size >= this.maximum || (entries?.size ?? 0) >= this.perPerson)
      throw new CommandFailure('RATE_LIMITED');
    if (!entries) {
      entries = new Map();
      this.people.set(personId, entries);
    }
    const result = run();
    const entry: Entry = {
      fingerprint,
      result,
      expiresAt: Number.POSITIVE_INFINITY,
    };
    entries.set(command.payload.requestId, entry);
    this.size++;
    void result.then(
      () => {
        entry.expiresAt = this.clock.now() + 600_000;
      },
      () => {
        entry.expiresAt = this.clock.now();
      },
    );
    return result;
  }
  clearPerson(personId: string): void {
    this.size -= this.people.get(personId)?.size ?? 0;
    this.people.delete(personId);
  }
  private prune(): void {
    const now = this.clock.now();
    for (const [personId, entries] of this.people) {
      for (const [requestId, entry] of entries)
        if (entry.expiresAt <= now) {
          entries.delete(requestId);
          this.size--;
        }
      if (!entries.size) this.people.delete(personId);
    }
  }
}
