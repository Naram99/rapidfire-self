import { parseCommand } from '@rapidfire/contracts';
import type {
  Ack,
  AckData,
  ClosureReason,
  Command,
  Scope,
} from '@rapidfire/contracts';
import { FlowController } from './controller.js';
import { CommandFailure, failedAck, requireCommand } from './errors.js';
import type {
  Access,
  Connection,
  Delivery,
  Dependencies,
  Viewer,
} from './ports.js';
import { StateQueue } from './queue.js';
import { RequestCache } from './request-cache.js';
import type { MatchRunner } from './match-runner.js';

export class GameService {
  private readonly controllers = new Map<string, FlowController>();
  private readonly codes = new Map<string, FlowController>();
  private readonly flows = new Map<string, FlowController>();
  private readonly connections = new Map<string, Connection>();
  private readonly closedViews = new Map<
    string,
    {
      controller: FlowController;
      reason: ClosureReason;
      runner: MatchRunner | null;
      lastPersistence: string;
    }
  >();
  private readonly registryQueue = new StateQueue();
  private readonly cache: RequestCache;
  private readonly retiredGuests = new Map<string, number>();
  private readonly knownSessions = new Map<string, number>();
  private readonly pendingSaves = new Set<Promise<void>>();
  readonly dependencies: Dependencies;
  private revocationEpoch = 0;
  private closing = false;
  constructor(dependencies: Dependencies) {
    this.dependencies = {
      ...dependencies,
      onPersistenceWork: (completion) => {
        this.pendingSaves.add(completion);
        void completion.then(() => this.pendingSaves.delete(completion));
        dependencies.onPersistenceWork?.(completion);
      },
    };
    this.cache = new RequestCache(dependencies.clock);
  }
  async connect(id: string, access: Access, deliver: Delivery): Promise<void> {
    requireCommand(
      !this.closing && !this.connections.has(id),
      'SERVER_UNAVAILABLE',
    );
    requireCommand(
      access.expiresAt > this.dependencies.clock.now(),
      'AUTH_REQUIRED',
    );
    requireCommand(
      access.authEpoch === undefined ||
        access.authEpoch === this.revocationEpoch,
      'AUTH_REQUIRED',
    );
    if (access.person.kind === 'user' && access.type === 'session')
      requireCommand(access.emailVerified, 'AUTH_REQUIRED');
    const retiredAt = this.retiredGuests.get(access.person.id);
    requireCommand(
      retiredAt === undefined || retiredAt <= this.dependencies.clock.now(),
      'AUTH_REQUIRED',
    );
    const controller = this.flows.get(access.person.id);
    if (access.type === 'match')
      requireCommand(
        controller !== undefined &&
          controller.isPlaying(access.person.id, access.matchId) &&
          controller.activeMatchId() === access.matchId,
        'AUTH_REQUIRED',
      );
    const connection: Connection = {
      revoked: false,
      id,
      access: { ...access, person: { ...access.person } },
      deliver,
      grant: controller?.activeMatchId()
        ? { scope: controller.scope, matchId: controller.activeMatchId() ?? '' }
        : null,
    };
    this.connections.set(id, connection);
    this.rememberSession(connection.access);
    this.scheduleExpiry(connection);
    if (controller)
      await controller.run(() => {
        controller.reconcile(access.person.id);
        this.publish(controller);
      });
  }
  disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection) return Promise.resolve();
    this.connections.delete(id);
    this.closedViews.delete(id);
    this.dependencies.timers.cancel(`session:${id}`);
    const controller = this.flows.get(connection.access.person.id);
    return controller
      ? controller.run(() => {
          controller.reconcile(connection.access.person.id);
          this.publish(controller);
        })
      : Promise.resolve();
  }
  async refresh(id: string, access: Access): Promise<void> {
    requireCommand(
      access.authEpoch === undefined ||
        access.authEpoch === this.revocationEpoch,
      'AUTH_REQUIRED',
    );
    const connection = this.connections.get(id);
    requireCommand(
      connection !== undefined &&
        connection.access.person.id === access.person.id &&
        connection.access.person.kind === access.person.kind,
      'FORBIDDEN',
    );
    requireCommand(
      access.type === 'session' &&
        access.expiresAt > this.dependencies.clock.now() &&
        (access.person.kind === 'guest' || access.emailVerified),
      'AUTH_REQUIRED',
    );
    connection.access = { ...access, person: { ...access.person } };
    connection.revoked = false;
    this.rememberSession(connection.access);
    this.scheduleExpiry(connection);
    const controller = this.flows.get(access.person.id);
    return controller
      ? controller.run(() => {
          controller.updatePerson(access.person);
          controller.reconcile(access.person.id);
          this.publish(controller);
        })
      : Promise.resolve();
  }
  revoke(personId: string): Promise<void> {
    this.revocationEpoch++;
    // Revocation is immediate at ingress, before queued state work or cached replay.
    for (const connection of this.connections.values())
      if (connection.access.person.id === personId) {
        connection.access = { ...connection.access, expiresAt: 0 };
        connection.revoked = true;
        connection.grant = null;
      }
    this.cache.clearPerson(personId);
    this.knownSessions.delete(personId);
    this.dependencies.timers.cancel(`person-session:${personId}`);
    const controller = this.flows.get(personId);
    return controller
      ? controller.run(() => controller.leave(personId, 'access_revoked'))
      : Promise.resolve();
  }
  handle(
    connectionId: string,
    name: string,
    payload: unknown,
    receivedAt = this.dependencies.clock.now(),
  ): Promise<Ack> {
    const parsed = parseCommand(name, payload);
    const requestId = parsed.success
      ? parsed.data.payload.requestId
      : typeof payload === 'object' &&
          payload !== null &&
          'requestId' in payload &&
          typeof payload.requestId === 'string' &&
          payload.requestId.length <= 128
        ? payload.requestId
        : null;
    if (!parsed.success)
      return Promise.resolve(
        failedAck(requestId, this.dependencies.clock.now(), 'INVALID_PAYLOAD'),
      );
    const command = parsed.data;
    try {
      requireCommand(!this.closing, 'SERVER_UNAVAILABLE');
      for (const [personId, until] of this.retiredGuests)
        if (until <= this.dependencies.clock.now())
          this.retiredGuests.delete(personId);
      const connection = this.connections.get(connectionId);
      requireCommand(connection !== undefined, 'AUTH_REQUIRED');
      this.authorize(connection, command);
      return this.cache.execute(connection.access.person.id, command, () => {
        const controller = this.target(connection, command);
        const queue = controller ?? this.registryQueue;
        return queue
          .run(() => {
            requireCommand(
              this.connections.get(connectionId) === connection,
              'AUTH_REQUIRED',
            );
            this.authorize(connection, command);
            const data = this.perform(
              connection,
              controller,
              command,
              receivedAt,
            );
            return {
              requestId: command.payload.requestId,
              serverTime: this.dependencies.clock.now(),
              ok: true as const,
              data,
            };
          })
          .catch((error) => this.failure(command.payload.requestId, error));
      });
    } catch (error) {
      return Promise.resolve(this.failure(requestId, error));
    }
  }
  async idle(): Promise<void> {
    await this.registryQueue.idle();
    await Promise.all(
      [...this.controllers.values()].map((controller) =>
        controller.queue.idle(),
      ),
    );
  }
  matchAccess(personId: string, matchId?: string) {
    const controller = this.flows.get(personId);
    const runner = controller?.runner;
    const binding = runner?.bindings.find((b) => b.person.id === personId);
    if (
      !controller ||
      !runner ||
      !binding ||
      runner.state.startedAt === null ||
      (matchId !== undefined && runner.state.id !== matchId) ||
      !controller.isPlaying(personId, runner.state.id)
    )
      return null;
    const phase = runner.state.phase.type;
    if (
      binding.person.kind === 'user' &&
      ['finished', 'interrupted', 'returned'].includes(phase)
    )
      return null;
    return {
      person: binding.person,
      matchId: runner.state.id,
      startedAt: runner.state.startedAt,
      scope: controller.scope,
    };
  }
  async refreshSession(access: Access): Promise<void> {
    if (access.type !== 'session') return;
    requireCommand(
      access.authEpoch === undefined ||
        access.authEpoch === this.revocationEpoch,
      'AUTH_REQUIRED',
    );
    this.rememberSession(access);
    await Promise.all(
      [...this.connections.values()]
        .filter(
          (c) =>
            !c.revoked &&
            c.access.person.id === access.person.id &&
            (c.access.type === 'match' ||
              access.person.kind === 'guest' ||
              c.access.sessionId === access.sessionId),
        )
        .map((c) => this.refresh(c.id, access)),
    );
  }
  sessionIds(personId: string): readonly string[] {
    return [
      ...new Set(
        [...this.connections.values()].flatMap((c) =>
          !c.revoked &&
          c.access.person.id === personId &&
          c.access.type === 'session' &&
          c.access.sessionId
            ? [c.access.sessionId]
            : [],
        ),
      ),
    ];
  }
  accessEpoch(): number {
    return this.revocationEpoch;
  }
  async anonymize(personId: string): Promise<void> {
    const controllers = new Set([
      ...this.controllers.values(),
      ...[...this.closedViews.values()].map((view) => view.controller),
    ]);
    await Promise.all(
      [...controllers].map((controller) =>
        controller.run(() => {
          controller.updatePerson({ id: personId, name: '', kind: 'user' });
          controller.runner?.anonymize(personId);
          controller.lastRunner?.anonymize(personId);
        }),
      ),
    );
  }
  async persistenceIdle(): Promise<void> {
    while (this.pendingSaves.size > 0)
      await Promise.all([...this.pendingSaves]);
  }
  async shutdown(): Promise<void> {
    this.closing = true;
    await Promise.all(
      [...this.controllers.values()].map((controller) =>
        controller.run(() => controller.shutdown()),
      ),
    );
    for (const id of this.connections.keys())
      this.dependencies.timers.cancel(`session:${id}`);
    for (const id of this.knownSessions.keys())
      this.dependencies.timers.cancel(`person-session:${id}`);
  }
  private target(
    connection: Connection,
    command: Command,
  ): FlowController | null {
    if (
      command.type === 'room:create' ||
      command.type === 'solo:start' ||
      command.type === 'time:sync'
    )
      return null;
    if (command.type === 'room:join')
      return this.codes.get(command.payload.roomCode) ?? null;
    return this.flows.get(connection.access.person.id) ?? null;
  }
  private perform(
    connection: Connection,
    controller: FlowController | null,
    command: Command,
    receivedAt: number,
  ): AckData {
    const person = connection.access.person;
    if (command.type === 'time:sync')
      return { serverTime: this.dependencies.clock.now() };
    if (command.type === 'room:create' || command.type === 'solo:start') {
      const previous = this.flows.get(person.id);
      requireCommand(
        !previous,
        previous?.scope.type === 'room'
          ? 'ALREADY_IN_ROOM'
          : 'ALREADY_IN_MATCH',
      );
      requireCommand(
        command.payload.settings.rounds <=
          this.dependencies.questions.categories.length,
        'INVALID_PAYLOAD',
      );
      const scope: Scope = {
        type: command.type === 'room:create' ? 'room' : 'match',
        id: this.dependencies.id(),
      };
      let code: string | null = null;
      if (scope.type === 'room') {
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = this.dependencies.roomCode();
          if (!this.codes.has(candidate)) {
            code = candidate;
            break;
          }
        }
        requireCommand(code !== null, 'SERVER_UNAVAILABLE');
      }
      const created = new FlowController(
        scope,
        person,
        command.payload.settings,
        code,
        this.dependencies,
        this.hooks(),
      );
      this.controllers.set(scope.id, created);
      if (code) this.codes.set(code, created);
      this.flows.set(person.id, created);
      this.clearClosedPerson(person.id);
      this.publish(created);
      return code ? { ...created.ack(), roomCode: code } : created.ack();
    }
    requireCommand(
      controller !== null,
      command.type === 'room:join' ? 'ROOM_NOT_FOUND' : 'STALE_STATE',
      command.type !== 'room:join',
    );
    if (command.type === 'room:join') {
      const previous = this.flows.get(person.id);
      requireCommand(
        !previous || previous === controller,
        previous?.scope.type === 'room'
          ? 'ALREADY_IN_ROOM'
          : 'ALREADY_IN_MATCH',
      );
      controller.join(person);
      this.flows.set(person.id, controller);
      this.clearClosedPerson(person.id);
      this.publish(controller);
      return controller.ack();
    }
    this.checkTarget(controller, command);
    return controller.execute(
      this.viewer(connection, controller),
      command,
      receivedAt,
    );
  }
  private checkTarget(controller: FlowController, command: Command): void {
    if ('roomId' in command.payload)
      requireCommand(
        controller.scope.type === 'room' &&
          controller.scope.id === command.payload.roomId,
        'FORBIDDEN',
      );
    if (command.type === 'match:leave')
      requireCommand(
        controller.scope.type === 'match' &&
          controller.runner?.state.id === command.payload.matchId,
        'FORBIDDEN',
      );
    if (command.type === 'state:sync')
      requireCommand(
        controller.scope.type === command.payload.scope.type &&
          controller.scope.id === command.payload.scope.id,
        'FORBIDDEN',
      );
  }
  private authorize(connection: Connection, command: Command): void {
    requireCommand(!connection.revoked, 'AUTH_REQUIRED');
    const fresh = this.freshConnection(connection);
    const person = connection.access.person;
    if (command.type === 'room:create' || command.type === 'room:join') {
      requireCommand(person.kind === 'user' && fresh, 'AUTH_REQUIRED');
      return;
    }
    if (
      command.type === 'solo:start' ||
      command.type === 'room:ready' ||
      command.type === 'room:settings:update'
    ) {
      requireCommand(fresh, 'AUTH_REQUIRED');
      return;
    }
    const controller = this.flows.get(person.id);
    requireCommand(
      fresh ||
        (controller !== undefined &&
          this.viewer(connection, controller).canRead),
      'AUTH_REQUIRED',
    );
    if (
      command.type === 'answer:submit' ||
      command.type === 'category:select'
    ) {
      requireCommand(
        controller !== undefined &&
          controller.isPlaying(person.id, command.payload.matchId),
        'PARTICIPANT_LEFT',
      );
    }
  }
  private viewer(connection: Connection, controller: FlowController): Viewer {
    const personId = connection.access.person.id;
    const freshSession = this.freshConnection(connection);
    const grant = connection.grant;
    const granted =
      grant !== null &&
      grant.scope.id === controller.scope.id &&
      controller.isPlaying(personId, grant.matchId);
    return {
      personId,
      freshSession,
      canRead:
        !connection.revoked &&
        controller.contains(personId) &&
        (freshSession || granted || controller.heldForAuthentication(personId)),
    };
  }
  private freshConnection(connection: Connection): boolean {
    return (
      !connection.revoked &&
      connection.access.type === 'session' &&
      connection.access.expiresAt > this.dependencies.clock.now() &&
      (connection.access.person.kind === 'guest' ||
        connection.access.emailVerified)
    );
  }
  private hooks() {
    return {
      publish: (controller: FlowController) => this.publish(controller),
      released: (
        controller: FlowController,
        personId: string,
        reason: ClosureReason,
      ) => {
        try {
          this.dependencies.onParticipantReleased?.(personId);
        } catch {
          this.dependencies.onError('PARTICIPANT_RELEASE_NOTIFICATION_FAILED');
        }
        if (this.flows.get(personId) === controller)
          this.flows.delete(personId);
        for (const connection of this.connections.values())
          if (connection.access.person.id === personId) {
            connection.grant = null;
            const candidate = controller.runner ?? controller.lastRunner;
            const runner = candidate?.bindings.some(
              (binding) => binding.person.id === personId,
            )
              ? candidate
              : null;
            const closed = {
              controller,
              reason,
              runner,
              lastPersistence: JSON.stringify(runner?.persistence ?? null),
            };
            this.closedViews.set(connection.id, closed);
            this.deliver(connection, this.closedSnapshot(closed));
            if (connection.access.person.kind === 'guest')
              connection.access = { ...connection.access, expiresAt: 0 };
          }
        if (
          (controller.scope.type === 'match' &&
            controller.runner?.bindings.some(
              (binding) =>
                binding.person.id === personId &&
                binding.person.kind === 'guest',
            )) ||
          controller.lastRunner?.bindings.some(
            (binding) =>
              binding.person.id === personId && binding.person.kind === 'guest',
          )
        ) {
          this.retiredGuests.set(
            personId,
            this.dependencies.clock.now() + 900_000,
          );
          try {
            this.dependencies.onGuestFinished(personId);
          } catch {
            this.dependencies.onError('GUEST_FINISHED_NOTIFICATION_FAILED');
          }
        }
      },
      removed: (controller: FlowController) => {
        this.controllers.delete(controller.scope.id);
        if (controller.room) this.codes.delete(controller.room.code);
      },
      started: (controller: FlowController, matchId: string) => {
        const people =
          controller.runner?.bindings.map((binding) => binding.person.id) ?? [];
        for (const connection of this.connections.values())
          if (people.includes(connection.access.person.id))
            connection.grant = { scope: controller.scope, matchId };
        try {
          this.dependencies.onMatchStarted(matchId, people);
        } catch {
          this.dependencies.onError('MATCH_STARTED_NOTIFICATION_FAILED');
        }
      },
      lobbyReturned: (personIds: readonly string[]) => {
        if (!this.dependencies.onLobbyReturned) return;
        // Hold ready until a fresh database check completes; no I/O holds this queue.
        for (const personId of personIds) {
          this.knownSessions.delete(personId);
          this.dependencies.timers.cancel(`person-session:${personId}`);
          for (const connection of this.connections.values())
            if (connection.access.person.id === personId)
              connection.access = { ...connection.access, expiresAt: 0 };
        }
        try {
          this.dependencies.onLobbyReturned(personIds);
        } catch {
          this.dependencies.onError('LOBBY_AUTH_CHECK_FAILED');
        }
      },
      online: (personId: string) =>
        [...this.connections.values()].some(
          (connection) => connection.access.person.id === personId,
        ),
      fresh: (personId: string) =>
        (this.knownSessions.get(personId) ?? 0) >
          this.dependencies.clock.now() ||
        [...this.connections.values()].some(
          (connection) =>
            connection.access.person.id === personId &&
            this.freshConnection(connection),
        ),
    };
  }
  private publish(controller: FlowController): void {
    for (const connection of this.connections.values()) {
      if (this.flows.get(connection.access.person.id) === controller) {
        const viewer = this.viewer(connection, controller);
        if (viewer.canRead)
          this.deliver(connection, controller.snapshot(viewer));
      } else {
        const closed = this.closedViews.get(connection.id);
        if (
          closed?.controller === controller &&
          closed.runner &&
          !connection.revoked
        ) {
          const signature = JSON.stringify(closed.runner.persistence);
          if (signature !== closed.lastPersistence) {
            closed.lastPersistence = signature;
            this.deliver(connection, this.closedSnapshot(closed));
          }
        }
      }
    }
  }
  private deliver(
    connection: Connection,
    snapshot: Parameters<Delivery>[0],
  ): void {
    try {
      connection.deliver(snapshot);
    } catch {
      this.dependencies.onError('SNAPSHOT_DELIVERY_FAILED');
    }
  }
  private clearClosedPerson(personId: string): void {
    for (const connection of this.connections.values())
      if (connection.access.person.id === personId)
        this.closedViews.delete(connection.id);
  }
  private closedSnapshot(
    closed: Readonly<{
      controller: FlowController;
      reason: ClosureReason;
      runner: MatchRunner | null;
    }>,
  ) {
    return {
      ...closed.controller.closed(closed.reason),
      recentResult: closed.runner
        ? {
            matchId: closed.runner.state.id,
            persistence: { ...closed.runner.persistence },
          }
        : null,
    };
  }
  private scheduleExpiry(connection: Connection): void {
    const access = connection.access;
    this.dependencies.timers.schedule(
      `session:${connection.id}`,
      access.expiresAt,
      () => {
        if (this.connections.get(connection.id)?.access !== access) return;
        const controller = this.flows.get(access.person.id);
        if (controller)
          void controller
            .run(() => {
              controller.reconcile(access.person.id);
              this.publish(controller);
            })
            .catch(() => this.dependencies.onError('SESSION_EXPIRY_FAILED'));
      },
    );
  }
  private rememberSession(access: Access): void {
    if (access.type !== 'session') return;
    const deadline = Math.max(
      this.knownSessions.get(access.person.id) ?? 0,
      access.expiresAt,
    );
    this.knownSessions.set(access.person.id, deadline);
    this.dependencies.timers.schedule(
      `person-session:${access.person.id}`,
      deadline,
      () => {
        if (this.knownSessions.get(access.person.id) !== deadline) return;
        this.knownSessions.delete(access.person.id);
        const controller = this.flows.get(access.person.id);
        if (controller)
          void controller
            .run(() => controller.reconcile(access.person.id))
            .catch(() => this.dependencies.onError('SESSION_EXPIRY_FAILED'));
      },
    );
  }
  private failure(requestId: string | null, error: unknown): Ack {
    if (error instanceof CommandFailure)
      return failedAck(
        requestId,
        this.dependencies.clock.now(),
        error.code,
        error.resyncRequired,
      );
    this.dependencies.onError('COMMAND_EXECUTION_FAILED');
    return failedAck(
      requestId,
      this.dependencies.clock.now(),
      'SERVER_UNAVAILABLE',
    );
  }
}
