import { createMatch, transitionMatch } from '@rapidfire/game-engine';
import type {
  AnswerReceipt,
  MatchEvent,
  MatchInput,
  MatchState,
} from '@rapidfire/game-engine';
import type { GameSettings, PersistenceStatus } from '@rapidfire/contracts';
import { failEngine } from './errors.js';
import { checkpoint, PersistenceQueue } from './persistence.js';
import type { Binding, PersistenceView } from './projection.js';
import type { Dependencies } from './ports.js';

export type RunnerHooks = Readonly<{
  enqueue: (task: () => void) => void;
  changed: () => void;
  returned: () => void;
  started: (matchId: string) => void;
}>;
export class MatchRunner {
  state: MatchState;
  bindings: readonly Binding[];
  persistence: PersistenceView;
  private readonly saves: PersistenceQueue;
  private preparation: AbortController | null = null;
  private timerKey: string | null = null;
  private stopped = false;
  constructor(
    id: string,
    mode: MatchInput['mode'],
    settings: GameSettings,
    bindings: readonly Binding[],
    private readonly dependencies: Dependencies,
    private readonly hooks: RunnerHooks,
  ) {
    this.bindings = bindings;
    const result = createMatch(
      {
        id,
        mode,
        settings,
        categories: dependencies.questions.categories,
        participants: bindings.map((binding, index) => ({
          id: binding.participantId,
          name: binding.person.name,
          order: index + 1,
          presence: 'online',
        })),
      },
      dependencies.clock.now(),
    );
    if (!result.ok) failEngine(result.error);
    this.state = result.state;
    this.persistence = {
      status: bindings.every((binding) => binding.person.kind === 'guest')
        ? 'not_saved_guest'
        : dependencies.persistence
          ? 'pending'
          : 'not_configured',
      revision: 0,
    };
    this.saves = new PersistenceQueue(dependencies, (revision, status) =>
      hooks.enqueue(() => this.persistenceCompleted(revision, status)),
    );
    this.effects(result.effects);
  }
  apply(event: MatchEvent): AnswerReceipt | null {
    if (this.stopped) return null;
    const result = transitionMatch(this.state, event, {
      now: Math.max(this.state.updatedAt, this.dependencies.clock.now()),
      random: this.dependencies.random(),
    });
    if (!result.ok) failEngine(result.error);
    const changed = result.state !== this.state;
    this.state = result.state;
    this.effects(result.effects);
    if (changed && this.state.phase.type !== 'returned') this.hooks.changed();
    return result.receipt;
  }
  stop(): void {
    this.stopped = true;
    if (this.timerKey) this.dependencies.timers.cancel(this.timerKey);
    this.preparation?.abort();
    // Persistence continues independently, including after return/room disposal.
  }
  persistenceIdle(): Promise<void> {
    return this.saves.idle();
  }
  anonymize(personId: string): void {
    const binding = this.bindings.find((item) => item.person.id === personId);
    if (!binding) return;
    this.bindings = this.bindings.map((item) =>
      item === binding
        ? {
            ...item,
            person: { ...item.person, name: '' },
            identityState: 'deleted_user',
          }
        : item,
    );
    this.state = {
      ...this.state,
      participants: this.state.participants.map((p) =>
        p.id === binding.participantId ? { ...p, name: '' } : p,
      ),
    };
    this.hooks.changed();
  }
  private persistenceCompleted(
    revision: number,
    status: PersistenceStatus,
  ): void {
    if (revision < this.persistence.revision) return;
    this.persistence = { status, revision };
    this.hooks.changed();
  }
  private save(kind: 'start' | 'question' | 'final'): void {
    if (
      this.state.startedAt === null ||
      this.persistence.status === 'not_saved_guest' ||
      !this.dependencies.persistence
    )
      return;
    const revision = this.persistence.revision + 1;
    this.persistence = { ...this.persistence, revision };
    this.saves.submit(checkpoint(this.state, this.bindings, revision, kind));
  }
  private effects(
    effects: readonly import('@rapidfire/game-engine').Effect[],
  ): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'schedule_timer': {
          const key = `match:${effect.matchId}:${effect.phaseId}`;
          this.timerKey = key;
          this.dependencies.timers.schedule(key, effect.deadline, () =>
            this.hooks.enqueue(() => {
              if (!this.stopped)
                this.apply({
                  type: 'timer_elapsed',
                  matchId: effect.matchId,
                  phaseId: effect.phaseId,
                  deadline: effect.deadline,
                });
            }),
          );
          break;
        }
        case 'cancel_timer':
          this.dependencies.timers.cancel(
            `match:${effect.matchId}:${effect.phaseId}`,
          );
          this.preparation?.abort();
          this.preparation = null;
          break;
        case 'prepare_questions': {
          const abort = new AbortController();
          this.preparation = abort;
          void Promise.resolve()
            .then(() =>
              this.dependencies.questions.prepare({
                ...effect,
                signal: abort.signal,
              }),
            )
            .then(
              (questions) =>
                this.postPreparation({
                  type: 'questions_prepared',
                  matchId: effect.matchId,
                  phaseId: effect.phaseId,
                  receivedAt: this.dependencies.clock.now(),
                  questions,
                }),
              () =>
                this.postPreparation({
                  type: 'preparation_failed',
                  matchId: effect.matchId,
                  phaseId: effect.phaseId,
                  receivedAt: this.dependencies.clock.now(),
                }),
            )
            .catch(() =>
              this.dependencies.onError('PREPARATION_CALLBACK_FAILED'),
            );
          break;
        }
        case 'match_started':
          this.save('start');
          this.hooks.started(this.state.id);
          break;
        case 'question_closed':
          this.save('question');
          break;
        case 'match_completed':
        case 'match_interrupted':
          this.save('final');
          try {
            this.dependencies.onMatchFinished?.(this.state.id);
          } catch {
            this.dependencies.onError('MATCH_FINISHED_NOTIFICATION_FAILED');
          }
          break;
        case 'return_requested':
          this.hooks.returned();
          break;
      }
    }
  }
  private postPreparation(event: MatchEvent): void {
    if (!this.stopped)
      this.hooks.enqueue(() => {
        if (!this.stopped) this.apply(event);
      });
  }
}
