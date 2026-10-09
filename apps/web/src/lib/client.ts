import { io } from 'socket.io-client';
import {
  ackSchema,
  gameConfigResponseSchema,
  gameTopicSchema,
  guestResponseSchema,
  parseCommand,
  PROTOCOL_VERSION,
  sessionResponseSchema,
  snapshotSchema,
} from '@rapidfire/contracts';
import type {
  Ack,
  CommandName,
  CommandPayload,
  GameTopic,
  Profile,
  Snapshot,
} from '@rapidfire/contracts';
import { ApiError, read, request } from './api';
import { acceptsSnapshot, applyReceipt, inGame } from './game-state';
import type { ClockAnchor } from './game-state';
import { emitCommand } from './socket';
import type { GameSocket } from './socket';
import { message, t } from './copy';

export type Identity =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'user'; profile: Profile; expiresAt: number }>
  | Readonly<{ kind: 'guest'; nickname: string; expiresAt: number }>;
export type ClientState = Readonly<{
  identity: Identity;
  session: 'loading' | 'ready' | 'unavailable';
  connection:
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'unauthenticated'
    | 'failed'
    | 'incompatible';
  snapshot: Snapshot | null;
  clock: ClockAnchor;
  pending: CommandName | null;
  notice: string | null;
  topics: readonly Readonly<{ id: GameTopic; maxRounds: number }>[];
}>;

export class GameClient {
  private state: ClientState = {
    identity: { kind: 'none' },
    session: 'loading',
    connection: 'connecting',
    snapshot: null,
    clock: { serverTime: Date.now(), monotonicTime: performance.now() },
    pending: null,
    notice: null,
    topics: gameTopicSchema.options.map((id) => ({ id, maxRounds: 10 })),
  };
  private readonly listeners = new Set<() => void>();
  private readonly socket: GameSocket = io({
    autoConnect: false,
    auth: { protocolVersion: PROTOCOL_VERSION },
    reconnectionDelayMax: 5000,
  });
  private controller: AbortController | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private checking: Promise<void> | null = null;
  private checkAt = 0;
  private activityAt = performance.now();
  private epoch = 0;
  private authEpoch = 0;
  private issuedMatch: string | null = null;
  private issuingMatch: string | null = null;
  private cookieAttemptAt = Number.NEGATIVE_INFINITY;

  getSnapshot = (): ClientState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  dismiss = (): void => this.update({ notice: null });
  notify = (notice: string): void => this.update({ notice });
  private activity = () => {
    this.activityAt = performance.now();
  };
  private foreground = () => {
    if (document.visibilityState === 'visible') {
      this.activity();
      void this.checkSession();
      if (!this.socket.connected && this.state.connection !== 'incompatible')
        this.socket.connect();
      else this.synchronize();
    }
  };
  private online = () => {
    this.foreground();
  };
  private offline = () => this.update({ connection: 'reconnecting' });
  private connected = () => {
    this.update({ connection: 'connected' });
    this.synchronize();
    void this.syncTime();
  };
  private disconnected = () => {
    if (
      this.controller &&
      !this.controller.signal.aborted &&
      this.state.connection !== 'incompatible'
    )
      this.update({ connection: 'reconnecting' });
  };
  private connectionError = (error: Error & { data?: unknown }) => {
    const data = error.data;
    const code =
      typeof data === 'object' &&
      data !== null &&
      'code' in data &&
      typeof data.code === 'string'
        ? data.code
        : 'NETWORK_ERROR';
    if (code === 'PROTOCOL_VERSION_UNSUPPORTED') {
      this.update({
        connection: 'incompatible',
        notice: message(new ApiError(code)),
      });
    } else if (code === 'AUTH_REQUIRED') {
      this.update({ connection: 'unauthenticated' });
    } else this.update({ connection: 'failed' });
  };
  private incoming = (candidate: unknown) => {
    const decoded = snapshotSchema.safeParse(candidate);
    if (!decoded.success) {
      this.update({ connection: 'incompatible', notice: t('invalidResponse') });
      this.socket.disconnect();
      return;
    }
    const snapshot = decoded.data;
    if (!acceptsSnapshot(this.state.snapshot, snapshot)) return;
    const guestEnded =
      snapshot.phase.type === 'closed' && this.state.identity.kind === 'guest';
    this.update({
      snapshot,
      clock: {
        serverTime: snapshot.serverTime,
        monotonicTime: performance.now(),
      },
      ...(guestEnded ? { identity: { kind: 'none' } as const } : {}),
    });
    if (
      snapshot.phase.type === 'closed' &&
      snapshot.phase.reason === 'access_revoked'
    )
      void this.checkSession();
    void this.issueMatchCookie();
  };

  start(): void {
    if (this.controller) return;
    this.controller = new AbortController();
    this.epoch++;
    this.socket.on('connect', this.connected);
    this.socket.on('disconnect', this.disconnected);
    this.socket.on('connect_error', this.connectionError);
    this.socket.on('state:snapshot', this.incoming);
    window.addEventListener('focus', this.foreground);
    document.addEventListener('visibilitychange', this.foreground);
    window.addEventListener('online', this.online);
    window.addEventListener('offline', this.offline);
    window.addEventListener('pointerdown', this.activity, { passive: true });
    window.addEventListener('keydown', this.activity);
    this.interval = setInterval(() => {
      const active =
        inGame(this.state.snapshot) ||
        performance.now() - this.activityAt < 300000;
      if (
        document.visibilityState === 'visible' &&
        active &&
        performance.now() - this.checkAt >= 300000
      )
        void this.checkSession();
      if (this.socket.connected && document.visibilityState === 'visible')
        void this.syncTime();
    }, 60000);
    const epoch = this.epoch;
    void read(
      '/api/game-config',
      gameConfigResponseSchema,
      this.controller.signal,
    )
      .then((config) => {
        if (epoch === this.epoch) this.update({ topics: config.topics });
      })
      .catch(() => {
        /* The server also validates settings if configuration cannot be loaded. */
      });
    void this.checkSession().then(() => {
      if (
        epoch === this.epoch &&
        this.controller &&
        !this.controller.signal.aborted
      )
        this.socket.connect();
    });
  }
  stop(): void {
    this.epoch++;
    this.controller?.abort();
    this.controller = null;
    this.checking = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.socket.off('connect', this.connected);
    this.socket.off('disconnect', this.disconnected);
    this.socket.off('connect_error', this.connectionError);
    this.socket.off('state:snapshot', this.incoming);
    this.socket.disconnect();
    window.removeEventListener('focus', this.foreground);
    document.removeEventListener('visibilitychange', this.foreground);
    window.removeEventListener('online', this.online);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('pointerdown', this.activity);
    window.removeEventListener('keydown', this.activity);
  }
  checkSession(): Promise<void> {
    if (this.checking) return this.checking;
    const epoch = this.epoch,
      authEpoch = this.authEpoch;
    const signal = this.controller?.signal;
    const valid = () =>
      epoch === this.epoch && authEpoch === this.authEpoch && !signal?.aborted;
    const work = (async () => {
      try {
        const normal = sessionResponseSchema.parse(
          await request('/api/auth/get-session', signal ? { signal } : {}),
        );
        if (!valid()) return;
        if (normal) {
          this.update({
            identity: {
              kind: 'user',
              profile: normal.user,
              expiresAt: Date.parse(normal.session.expiresAt),
            },
            session: 'ready',
          });
        } else {
          try {
            const guest = guestResponseSchema.parse(
              await request('/api/guest/session/renew', {
                body: {},
                ...(signal ? { signal } : {}),
              }),
            );
            if (!valid()) return;
            this.update({
              identity: {
                kind: 'guest',
                nickname:
                  guest.guest?.nickname ??
                  (this.state.identity.kind === 'guest'
                    ? this.state.identity.nickname
                    : t('guest')),
                expiresAt: Date.parse(guest.expiresAt),
              },
              session: 'ready',
            });
          } catch (error) {
            if (!valid()) return;
            if (!(error instanceof ApiError) || error.status !== 401)
              throw error;
            this.update({ identity: { kind: 'none' }, session: 'ready' });
          }
        }
        this.checkAt = performance.now();
        if (
          this.state.connection === 'unauthenticated' &&
          this.state.identity.kind !== 'none'
        )
          this.socket.connect();
        void this.issueMatchCookie();
      } catch {
        if (valid()) this.update({ session: 'unavailable' });
      }
    })();
    this.checking = work;
    void work.finally(() => {
      if (this.checking === work) this.checking = null;
    });
    return work;
  }
  async signedIn(): Promise<void> {
    this.authEpoch++;
    if (this.checking) await this.checking;
    await this.checkSession();
    if (this.state.identity.kind !== 'user')
      throw new ApiError('AUTH_REQUIRED');
    this.reconnect();
  }
  async guest(nickname: string): Promise<void> {
    const body = guestResponseSchema.parse(
      await request('/api/guest/session', { body: { nickname } }),
    );
    this.authEpoch++;
    this.update({
      identity: {
        kind: 'guest',
        nickname: body.guest?.nickname ?? nickname,
        expiresAt: Date.parse(body.expiresAt),
      },
      session: 'ready',
    });
    this.reconnect();
    await this.ready();
  }
  async logout(): Promise<void> {
    if (inGame(this.state.snapshot)) throw new ApiError('FORBIDDEN');
    await request(
      this.state.identity.kind === 'guest'
        ? '/api/guest/sign-out'
        : '/api/auth/sign-out',
      { body: {} },
    );
    await this.signedOut();
  }
  async signedOut(): Promise<void> {
    this.authEpoch++;
    this.update({
      identity: { kind: 'none' },
      snapshot: null,
      pending: null,
      session: 'ready',
    });
    this.socket.disconnect();
    this.update({ connection: 'unauthenticated' });
  }
  reconnect = (): void => {
    this.update({ connection: 'connecting', notice: null });
    this.socket.disconnect();
    this.socket.connect();
  };
  private ready(): Promise<void> {
    if (this.state.connection === 'incompatible')
      return Promise.reject(new ApiError('PROTOCOL_VERSION_UNSUPPORTED'));
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        this.socket.off('connect', connected);
        this.socket.off('connect_error', failed);
        if (error) reject(error);
        else resolve();
      };
      const connected = () => finish();
      const failed = () => finish(new ApiError('AUTH_REQUIRED'));
      const timeout = setTimeout(
        () => finish(new ApiError('NETWORK_ERROR')),
        5000,
      );
      this.socket.once('connect', connected);
      this.socket.once('connect_error', failed);
    });
  }
  async command<Name extends CommandName>(
    name: Name,
    payload: Omit<CommandPayload<Name>, 'requestId'>,
  ): Promise<Ack> {
    if (this.state.pending) throw new ApiError('RATE_LIMITED');
    await this.ready();
    if (this.state.pending) throw new ApiError('RATE_LIMITED');
    const parsed = parseCommand(name, {
      ...payload,
      requestId: crypto.randomUUID(),
    });
    if (!parsed.success) throw new ApiError('INVALID_PAYLOAD');
    this.update({ pending: name, notice: null });
    try {
      return await this.send(parsed.data);
    } finally {
      this.update({ pending: null });
    }
  }
  private send(command: Parameters<typeof emitCommand>[1]): Promise<Ack> {
    if (!this.socket.connected)
      return Promise.reject(new ApiError('NETWORK_ERROR'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ApiError('ACK_TIMEOUT'));
        this.synchronize();
      }, 5000);
      const acknowledge = (candidate: unknown) => {
        clearTimeout(timeout);
        const parsed = ackSchema.safeParse(candidate);
        if (
          !parsed.success ||
          parsed.data.requestId !== command.payload.requestId
        ) {
          reject(new ApiError('INVALID_RESPONSE'));
          return;
        }
        const ack = parsed.data;
        if (!ack.ok) {
          if (ack.error.resyncRequired && command.type !== 'state:sync')
            this.synchronize();
          reject(new ApiError(ack.error.code));
          return;
        }
        if ('answer' in ack.data && ack.data.answer)
          this.update({
            snapshot: applyReceipt(this.state.snapshot, ack.data.answer),
          });
        resolve(ack);
      };
      emitCommand(this.socket, command, acknowledge);
    });
  }
  private synchronize(): void {
    const snapshot = this.state.snapshot;
    if (!this.socket.connected || !snapshot || snapshot.phase.type === 'closed')
      return;
    void this.send({
      type: 'state:sync',
      payload: { requestId: crypto.randomUUID(), scope: snapshot.scope },
    }).catch((error: unknown) => {
      if (
        this.state.snapshot === snapshot &&
        error instanceof ApiError &&
        ['ROOM_NOT_FOUND', 'STALE_STATE', 'FORBIDDEN'].includes(error.code)
      )
        this.update({ snapshot: null, notice: t('noActiveGame') });
    });
  }
  private async syncTime(): Promise<void> {
    const epoch = this.epoch;
    const sent = performance.now();
    try {
      const ack = await this.send({
        type: 'time:sync',
        payload: { requestId: crypto.randomUUID() },
      });
      if (ack.ok && epoch === this.epoch)
        this.update({
          clock: {
            serverTime: ack.serverTime + (performance.now() - sent) / 2,
            monotonicTime: performance.now(),
          },
        });
    } catch {
      /* A failed clock sample does not revoke an existing game. */
    }
  }
  private async issueMatchCookie(): Promise<void> {
    const snapshot = this.state.snapshot;
    const match = snapshot?.match;
    if (
      !match ||
      !snapshot ||
      ['start_countdown', 'finished', 'interrupted', 'closed'].includes(
        snapshot.phase.type,
      ) ||
      this.state.identity.kind === 'none' ||
      this.issuedMatch === match.id ||
      this.issuingMatch === match.id ||
      performance.now() - this.cookieAttemptAt < 10000
    )
      return;
    this.issuingMatch = match.id;
    this.cookieAttemptAt = performance.now();
    try {
      await request('/api/match-access', {
        body: {},
        ...(this.controller ? { signal: this.controller.signal } : {}),
      });
      this.issuedMatch = match.id;
    } catch {
      /* Normal auth still allows reconnect; retry after the next sync. */
    } finally {
      if (this.issuingMatch === match.id) this.issuingMatch = null;
    }
  }
}
