import type { GameSettings, PersistenceStatus } from '@rapidfire/contracts';
import type { MatchState } from '@rapidfire/game-engine';
import type { Binding } from './projection.js';
import type { Checkpoint, Dependencies } from './ports.js';

export function checkpoint(
  state: MatchState,
  bindings: readonly Binding[],
  revision: number,
  kind: Checkpoint['kind'],
  settings: GameSettings,
): Checkpoint {
  const phase = state.phase;
  const completed =
    phase.type === 'finished' ||
    (phase.type === 'returned' && phase.result === 'completed');
  const interrupted =
    phase.type === 'interrupted' ||
    (phase.type === 'returned' && phase.result === 'interrupted');
  return {
    revision,
    kind,
    match: {
      id: state.id,
      mode: state.mode,
      settings: { ...settings },
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      status: completed
        ? 'completed'
        : interrupted
          ? 'interrupted'
          : 'in_progress',
      interruptionReason: interrupted ? phase.reason : null,
      participants: state.participants.flatMap((participant) => {
        const binding = bindings.find(
          (item) => item.participantId === participant.id,
        );
        return binding?.person.kind === 'user'
          ? [
              {
                id: participant.id,
                personId: binding.person.id,
                name: participant.name,
                order: participant.order,
                score: participant.score,
                participation: participant.participation,
                leftAt: participant.leftAt,
              },
            ]
          : [];
      }),
      results: state.results.map((result) => ({ ...result })),
      standings: completed ? phase.standings.map((item) => ({ ...item })) : [],
    },
  };
}

/** One independent chain per match. Completion is always posted back to the state owner. */
export class PersistenceQueue {
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly dependencies: Dependencies,
    private readonly report: (
      revision: number,
      status: PersistenceStatus,
    ) => void,
  ) {}
  submit(job: Checkpoint): void {
    const final = job.kind === 'final';
    if (final) this.report(job.revision, 'pending');
    this.tail = this.tail
      .then(async () => {
        const save = this.dependencies.persistence;
        if (!save) return;
        for (let attempt = 1; attempt <= (final ? 3 : 1); attempt++) {
          try {
            // Every attempt receives a detached payload; adapter mutation cannot affect live state.
            await save.save(structuredClone(job));
            if (final) this.report(job.revision, 'saved');
            return;
          } catch {
            this.dependencies.onError('PERSISTENCE_SAVE_FAILED');
            if (final && attempt < 3) {
              this.report(job.revision, 'retrying');
              await new Promise<void>((resolve) =>
                this.dependencies.timers.schedule(
                  `save:${job.match.id}:${job.revision}:${attempt}`,
                  this.dependencies.clock.now() + 2_000,
                  resolve,
                ),
              );
            } else if (final) this.report(job.revision, 'failed');
          }
        }
      })
      .catch(() => this.dependencies.onError('PERSISTENCE_QUEUE_FAILED'));
    this.dependencies.onPersistenceWork?.(this.tail);
  }
  idle(): Promise<void> {
    return this.tail;
  }
}
