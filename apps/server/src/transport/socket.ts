import type { IncomingHttpHeaders } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import {
  COMMAND_NAMES,
  PROTOCOL_VERSION,
  handshakeSchema,
} from '@rapidfire/contracts';
import type {
  Ack,
  CommandName,
  ConnectionErrorData,
  ErrorCode,
  ServerEvents,
} from '@rapidfire/contracts';
import { CommandFailure } from '../application/errors.js';
import type { GameService } from '../application/game-service.js';
import type { Access } from '../application/ports.js';

type IncomingEvents = {
  [Name in CommandName]: (payload: unknown, acknowledge: unknown) => void;
};
type SocketData = { access: Access };
type GameSocket = Socket<
  IncomingEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
export type GameSocketServer = Server<
  IncomingEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
export type Authenticate = (
  headers: IncomingHttpHeaders,
  signal: AbortSignal,
) => Promise<Access | null>;
function protocolVersion(auth: unknown): unknown {
  return typeof auth === 'object' && auth !== null && 'protocolVersion' in auth
    ? auth.protocolVersion
    : undefined;
}
function connectionError(code: ErrorCode): Error & {
  data: ConnectionErrorData;
} {
  return Object.assign(new Error(code), {
    data: { code, supportedProtocolVersion: PROTOCOL_VERSION },
  });
}
function isAcknowledgement(value: unknown): value is (ack: Ack) => void {
  return typeof value === 'function';
}

export function bindGameSocket(
  io: GameSocketServer,
  service: GameService,
  authenticate: Authenticate,
): void {
  io.use((socket, next) => {
    if (protocolVersion(socket.handshake.auth) !== PROTOCOL_VERSION) {
      next(connectionError('PROTOCOL_VERSION_UNSUPPORTED'));
      return;
    }
    if (!handshakeSchema.safeParse(socket.handshake.auth).success) {
      next(connectionError('INVALID_PAYLOAD'));
      return;
    }
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5_000);
    timeout.unref();
    const timedOut = new Promise<null>((resolve) =>
      abort.signal.addEventListener('abort', () => resolve(null), {
        once: true,
      }),
    );
    void Promise.race([
      Promise.resolve().then(() =>
        authenticate(socket.handshake.headers, abort.signal),
      ),
      timedOut,
    ])
      .then((access) => {
        if (
          !access ||
          abort.signal.aborted ||
          access.expiresAt <= service.dependencies.clock.now() ||
          (access.type === 'session' &&
            access.person.kind === 'user' &&
            !access.emailVerified)
        ) {
          next(connectionError('AUTH_REQUIRED'));
          return;
        }
        socket.data.access = access;
        next();
      })
      .catch(() => next(connectionError('AUTH_REQUIRED')))
      .finally(() => clearTimeout(timeout));
  });
  io.on('connection', (socket: GameSocket) => {
    for (const name of COMMAND_NAMES)
      socket.on(name, (payload, acknowledge) => {
        // Capture time and enqueue before any asynchronous session/provider work.
        const receivedAt = service.dependencies.clock.now();
        if (!isAcknowledgement(acknowledge)) return;
        void service
          .handle(socket.id, name, payload, receivedAt)
          .then((ack) => acknowledge(ack))
          .catch(() => service.dependencies.onError('SOCKET_ACK_FAILED'));
      });
    socket.on('disconnect', () => {
      void service
        .disconnect(socket.id)
        .catch(() => service.dependencies.onError('SOCKET_DISCONNECT_FAILED'));
    });
    void service
      .connect(socket.id, socket.data.access, (snapshot) =>
        socket.emit('state:snapshot', snapshot),
      )
      .catch((error) => {
        const code =
          error instanceof CommandFailure ? error.code : 'AUTH_REQUIRED';
        service.dependencies.onError(code);
        socket.disconnect(true);
      });
  });
}
