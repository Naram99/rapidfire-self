import type {
  AckData,
  ClosureReason,
  Command,
  GameSettings,
  Scope,
  Snapshot,
} from '@rapidfire/contracts';
import type { MatchEvent } from '@rapidfire/game-engine';
import { requireCommand } from './errors.js';
import { graceDeadline, sameSettings } from './lobby.js';
import type { Member, RoomState } from './lobby.js';
import { MatchRunner } from './match-runner.js';
import { closedSnapshot, projectSnapshot } from './projection.js';
import type { Binding } from './projection.js';
import type { Dependencies, Person, Viewer } from './ports.js';
import { StateQueue } from './queue.js';

export type ControllerHooks = Readonly<{
  publish: (controller: FlowController) => void;
  released: (
    controller: FlowController,
    personId: string,
    reason: ClosureReason,
  ) => void;
  removed: (controller: FlowController) => void;
  started: (controller: FlowController, matchId: string) => void;
  online: (personId: string) => boolean;
  fresh: (personId: string) => boolean;
}>;

/** A room and its match share this single queue/owner; the runner owns no queue. */
export class FlowController {
  readonly queue = new StateQueue();
  readonly scope: Scope;
  room: RoomState | null;
  runner: MatchRunner | null = null;
  lastRunner: MatchRunner | null = null;
  version = 1;
  private readonly soloPerson: Person | null;
  private readonly graceKeys = new Set<string>();
  private disposed = false;
  private mutationDepth = 0;
  private dirty = false;
  private closureReason: ClosureReason = 'solo_returned';
  constructor(
    scope: Scope,
    person: Person,
    settings: GameSettings,
    code: string | null,
    private readonly dependencies: Dependencies,
    private readonly hooks: ControllerHooks,
  ) {
    this.scope = scope;
    this.soloPerson = scope.type === 'match' ? person : null;
    const member: Member = {
      id: dependencies.id(),
      person: { ...person },
      order: 1,
      ready: false,
      presence: 'online',
      offlineDeadline: null,
      authDeadline: null,
    };
    this.room =
      scope.type === 'room'
        ? {
            id: scope.id,
            code: code ?? '',
            ownerId: member.id,
            members: [member],
            nextOrder: 2,
            settings: { ...settings },
            settingsVersion: 1,
            lobbyCycleId: dependencies.id(),
          }
        : null;
    if (scope.type === 'match') this.startMatch(settings, [person], scope.id);
  }
  run<T>(task: () => T): Promise<T> {
    return this.queue.run(() => {
      this.mutationDepth++;
      try {
        return task();
      } finally {
        this.mutationDepth--;
        if (this.mutationDepth === 0) this.flush();
      }
    });
  }
  contains(personId: string): boolean {
    return this.room
      ? this.room.members.some((member) => member.person.id === personId)
      : !this.disposed && this.soloPerson?.id === personId;
  }
  activeMatchId(): string | null {
    return this.runner && this.runner.state.startedAt !== null
      ? this.runner.state.id
      : null;
  }
  isPlaying(personId: string, matchId: string): boolean {
    const runner = this.runner;
    const binding = runner?.bindings.find(
      (item) => item.person.id === personId,
    );
    return Boolean(
      runner &&
      runner.state.id === matchId &&
      binding &&
      runner.state.participants.some(
        (p) => p.id === binding.participantId && p.participation === 'playing',
      ),
    );
  }
  heldForAuthentication(personId: string): boolean {
    const member = this.room?.members.find(
      (item) => item.person.id === personId,
    );
    return Boolean(
      member?.authDeadline &&
      member.authDeadline > this.dependencies.clock.now(),
    );
  }
  join(person: Person): void {
    requireCommand(!this.disposed && this.room !== null, 'ROOM_NOT_FOUND');
    if (this.contains(person.id)) return;
    requireCommand(
      !this.runner || this.runner.state.startedAt === null,
      'ROOM_GAME_ACTIVE',
    );
    requireCommand(this.room.members.length < 10, 'ROOM_FULL');
    this.cancelCountdown();
    const member: Member = {
      id: this.dependencies.id(),
      person: { ...person },
      order: this.room.nextOrder,
      ready: false,
      presence: 'online',
      offlineDeadline: null,
      authDeadline: null,
    };
    this.room = {
      ...this.room,
      members: [...this.room.members, member],
      nextOrder: this.room.nextOrder + 1,
    };
    this.changed();
  }
  execute(viewer: Viewer, command: Command, receivedAt: number): AckData {
    requireCommand(!this.disposed, 'STALE_STATE', true);
    requireCommand(this.contains(viewer.personId), 'FORBIDDEN');
    if (command.type === 'state:sync') {
      this.hooks.publish(this);
      return this.ack();
    }
    switch (command.type) {
      case 'room:leave':
      case 'match:leave':
        this.leave(viewer.personId, 'left');
        return this.ack();
      case 'room:settings:update': {
        requireCommand(
          this.room !== null && this.isLobby() && viewer.freshSession,
          'FORBIDDEN',
        );
        const member = this.room.members.find(
          (item) => item.person.id === viewer.personId,
        );
        requireCommand(member?.id === this.room.ownerId, 'FORBIDDEN');
        requireCommand(
          command.payload.expectedSettingsVersion === this.room.settingsVersion,
          'STALE_STATE',
          true,
        );
        this.checkSettings(command.payload.settings);
        if (!sameSettings(this.room.settings, command.payload.settings)) {
          this.cancelCountdown();
          this.room = {
            ...this.room,
            settings: { ...command.payload.settings },
            settingsVersion: this.room.settingsVersion + 1,
            members: this.room.members.map((item) => ({
              ...item,
              ready: false,
            })),
          };
          this.changed();
        }
        return this.ack();
      }
      case 'room:ready': {
        requireCommand(
          this.room !== null && this.isLobby() && viewer.freshSession,
          'FORBIDDEN',
        );
        requireCommand(
          command.payload.lobbyCycleId === this.room.lobbyCycleId,
          'STALE_STATE',
          true,
        );
        const member = this.room.members.find(
          (item) => item.person.id === viewer.personId,
        );
        requireCommand(member !== undefined, 'FORBIDDEN');
        if (member.ready !== command.payload.ready) {
          if (!command.payload.ready) this.cancelCountdown();
          this.room = {
            ...this.room,
            members: this.room.members.map((item) =>
              item.id === member.id
                ? { ...item, ready: command.payload.ready }
                : item,
            ),
          };
          this.maybeStart();
          this.changed();
        }
        return this.ack();
      }
      case 'category:select':
      case 'answer:submit': {
        const runner = this.runner;
        requireCommand(
          runner !== null && runner.state.id === command.payload.matchId,
          'STALE_STATE',
          true,
        );
        const binding = runner.bindings.find(
          (item) => item.person.id === viewer.personId,
        );
        requireCommand(binding !== undefined, 'FORBIDDEN');
        let event: MatchEvent;
        if (command.type === 'category:select') {
          const phase = runner.state.phase;
          requireCommand(
            'roundId' in phase && phase.roundId === command.payload.roundId,
            'STALE_STATE',
            true,
          );
          event = {
            type: 'category_selected',
            matchId: runner.state.id,
            phaseId: command.payload.phaseId,
            categoryId: command.payload.categoryId,
            participantId: binding.participantId,
            receivedAt,
          };
        } else
          event = {
            type: 'answer_submitted',
            matchId: runner.state.id,
            participantId: binding.participantId,
            questionId: command.payload.questionId,
            selectedOptionIds: command.payload.selectedOptionIds,
            receivedAt,
          };
        const receipt = runner.apply(event);
        return receipt
          ? {
              ...this.ack(),
              answer: {
                questionId: receipt.questionId,
                selectedOptionIds: [...receipt.selectedOptionIds],
                receivedAt: receipt.receivedAt,
                repeated: receipt.repeated,
              },
            }
          : this.ack();
      }
      default:
        requireCommand(false, 'FORBIDDEN');
    }
  }
  reconcile(personId: string): void {
    if (this.disposed || !this.contains(personId)) return;
    const online = this.hooks.online(personId);
    if (!this.room) {
      this.updateMatchPresence(personId, online);
      return;
    }
    const member = this.room.members.find(
      (item) => item.person.id === personId,
    );
    if (!member) return;
    const now = this.dependencies.clock.now();
    const previousDeadline = graceDeadline(member);
    if (
      this.isLobby() &&
      previousDeadline !== null &&
      now >= previousDeadline
    ) {
      this.leave(
        personId,
        member.authDeadline !== null && member.authDeadline === previousDeadline
          ? 'authentication_timeout'
          : 'offline_timeout',
      );
      return;
    }
    const lobby = this.isLobby();
    const fresh = this.hooks.fresh(personId);
    const updated: Member = {
      ...member,
      presence: online ? 'online' : 'offline',
      ready: lobby && (!online || !fresh) ? false : member.ready,
      offlineDeadline:
        lobby && !online ? (member.offlineDeadline ?? now + 60_000) : null,
      authDeadline:
        lobby && !fresh ? (member.authDeadline ?? now + 60_000) : null,
    };
    if (
      updated.presence === member.presence &&
      updated.ready === member.ready &&
      updated.offlineDeadline === member.offlineDeadline &&
      updated.authDeadline === member.authDeadline
    )
      return;
    if (lobby && !updated.ready) this.cancelCountdown();
    this.room = {
      ...this.room,
      members: this.room.members.map((item) =>
        item.id === member.id ? updated : item,
      ),
    };
    this.scheduleGrace(updated);
    this.updateMatchPresence(personId, online);
    this.changed();
  }
  leave(personId: string, reason: ClosureReason): void {
    if (!this.contains(personId) || this.disposed) return;
    this.cancelCountdown();
    const runner = this.runner;
    const participantId = runner?.bindings.find(
      (binding) => binding.person.id === personId,
    )?.participantId;
    if (
      runner &&
      participantId &&
      !['finished', 'interrupted', 'returned'].includes(runner.state.phase.type)
    )
      runner.apply({
        type: 'participant_left',
        matchId: runner.state.id,
        participantId,
      });
    this.dependencies.timers.cancel(`grace:${this.scope.id}:${personId}`);
    if (this.room) {
      const members = this.room.members.filter(
        (member) => member.person.id !== personId,
      );
      this.room = {
        ...this.room,
        members,
        ownerId: members.some((member) => member.id === this.room?.ownerId)
          ? this.room.ownerId
          : (members[0]?.id ?? ''),
      };
      this.version++;
      this.dirty = false;
      if (!members.length && runner) this.lastRunner = runner;
      this.hooks.released(this, personId, reason);
      if (!members.length) this.dispose('room_deleted');
      else {
        this.maybeStart();
        this.hooks.publish(this);
      }
    } else {
      this.version++;
      this.dirty = false;
      if (runner) this.lastRunner = runner;
      this.hooks.released(this, personId, reason);
      this.dispose(reason);
    }
  }
  snapshot(viewer: Viewer): Snapshot {
    if (this.disposed) return this.closed(this.closureReason);
    const runner = this.runner;
    const snapshot = projectSnapshot(
      this.scope,
      this.currentVersion(),
      this.dependencies.clock.now(),
      viewer,
      this.room,
      runner?.state ?? null,
      runner?.bindings ?? [],
      runner?.persistence ?? { status: 'not_configured', revision: 0 },
    );
    return {
      ...snapshot,
      recentResult: this.lastRunner?.bindings.some(
        (binding) => binding.person.id === viewer.personId,
      )
        ? {
            matchId: this.lastRunner.state.id,
            persistence: { ...this.lastRunner.persistence },
          }
        : null,
    };
  }
  closed(reason: ClosureReason): Snapshot {
    return {
      ...closedSnapshot(
        this.scope,
        this.currentVersion(),
        this.dependencies.clock.now(),
        reason,
      ),
      recentResult: this.lastRunner
        ? {
            matchId: this.lastRunner.state.id,
            persistence: { ...this.lastRunner.persistence },
          }
        : null,
    };
  }
  ack(): Readonly<{ scope: Scope; stateVersion: number; matchId?: string }> {
    return this.runner
      ? {
          scope: this.scope,
          stateVersion: this.currentVersion(),
          matchId: this.runner.state.id,
        }
      : { scope: this.scope, stateVersion: this.currentVersion() };
  }
  shutdown(): void {
    const runner = this.runner;
    if (
      runner &&
      !['finished', 'interrupted', 'returned'].includes(runner.state.phase.type)
    )
      runner.apply({
        type: 'match_interrupted',
        matchId: runner.state.id,
        reason: 'server_shutdown',
      });
    runner?.stop();
    for (const key of this.graceKeys) this.dependencies.timers.cancel(key);
  }
  private isLobby(): boolean {
    return !this.runner || this.runner.state.startedAt === null;
  }
  private checkSettings(settings: GameSettings): void {
    requireCommand(
      settings.rounds <= this.dependencies.questions.categories.length,
      'INVALID_PAYLOAD',
    );
  }
  private cancelCountdown(): void {
    if (this.runner?.state.startedAt === null) {
      this.runner.stop();
      this.runner = null;
    }
  }
  private maybeStart(): void {
    if (
      !this.room ||
      this.runner ||
      !this.room.members.length ||
      !this.room.members.every(
        (member) =>
          member.ready &&
          member.presence === 'online' &&
          this.hooks.fresh(member.person.id),
      )
    )
      return;
    this.startMatch(
      this.room.settings,
      this.room.members.map((member) => member.person),
      this.dependencies.id(),
    );
  }
  private startMatch(
    settings: GameSettings,
    people: readonly Person[],
    id: string,
  ): void {
    const bindings: Binding[] = people.map((person) => ({
      person: { ...person },
      participantId: this.dependencies.id(),
    }));
    this.runner = new MatchRunner(
      id,
      this.room ? 'multiplayer' : 'solo',
      settings,
      bindings,
      this.dependencies,
      {
        enqueue: (task) =>
          this.post(() => {
            if (this.room && this.isLobby())
              for (const member of this.room.members)
                this.reconcile(member.person.id);
            task();
          }),
        changed: () => this.changed(),
        returned: () => this.returned(),
        started: (matchId) => this.hooks.started(this, matchId),
      },
    );
  }
  private returned(): void {
    const runner = this.runner;
    if (!runner) return;
    runner.stop();
    this.lastRunner = runner;
    this.runner = null;
    if (this.room) {
      this.room = {
        ...this.room,
        lobbyCycleId: this.dependencies.id(),
        members: this.room.members.map((member) => ({
          ...member,
          ready: false,
          offlineDeadline: null,
          authDeadline: null,
        })),
      };
      for (const member of this.room.members) this.reconcile(member.person.id);
      this.changed();
    } else if (this.soloPerson) {
      this.version++;
      this.dirty = false;
      this.hooks.released(this, this.soloPerson.id, 'solo_returned');
      this.dispose('solo_returned');
    }
  }
  private updateMatchPresence(personId: string, online: boolean): void {
    const runner = this.runner;
    const binding = runner?.bindings.find(
      (item) => item.person.id === personId,
    );
    if (
      runner &&
      binding &&
      !['finished', 'interrupted', 'returned'].includes(runner.state.phase.type)
    )
      runner.apply({
        type: 'presence_changed',
        matchId: runner.state.id,
        participantId: binding.participantId,
        presence: online ? 'online' : 'offline',
      });
  }
  private scheduleGrace(member: Member): void {
    const key = `grace:${this.scope.id}:${member.person.id}`;
    this.graceKeys.add(key);
    this.dependencies.timers.cancel(key);
    const deadline = graceDeadline(member);
    const cycleId = this.room?.lobbyCycleId;
    if (deadline !== null)
      this.dependencies.timers.schedule(key, deadline, () =>
        this.post(() => {
          const current = this.room?.members.find(
            (item) => item.id === member.id,
          );
          if (
            current &&
            this.room?.lobbyCycleId === cycleId &&
            graceDeadline(current) === deadline
          )
            this.reconcile(member.person.id);
        }),
      );
  }
  private changed(): void {
    this.dirty = true;
    if (this.mutationDepth === 0) this.flush();
  }
  private currentVersion(): number {
    return this.version + Number(this.dirty);
  }
  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.version++;
    this.hooks.publish(this);
  }
  private dispose(reason: ClosureReason): void {
    this.closureReason = reason;
    this.disposed = true;
    this.runner?.stop();
    for (const key of this.graceKeys) this.dependencies.timers.cancel(key);
    this.hooks.removed(this);
  }
  private post(task: () => void): void {
    void this.run(task).catch(() =>
      this.dependencies.onError('CONTROLLER_CALLBACK_FAILED'),
    );
  }
}
