import type { Dependencies } from '../application/ports.js';
import { GameService } from '../application/game-service.js';
import { AuthBridge } from '../auth/bridge.js';
import { createAuth } from '../auth/create-auth.js';
import {
  cookieToken,
  credentialCookies,
  Credentials,
} from '../auth/credentials.js';
import { AccountRepository } from '../database/accounts.js';
import type { Database } from '../database/client.js';
import { PostgresPersistence } from '../database/persistence.js';
import { EmailQueue } from '../email/queue.js';
import type { EmailPort } from '../email/types.js';
import { createApiRouter } from '../transport/http.js';
import { createGameServer } from './create-server.js';

export function createApplication(
  options: Readonly<{
    db: Database;
    dependencies: Dependencies;
    emailPort: EmailPort;
    publicUrl: string;
    secret: string;
    allowedOrigins: readonly string[];
    webRoot?: string;
  }>,
) {
  const { clock, timers } = options.dependencies;
  const credentials = new Credentials(clock);
  const accounts = new AccountRepository(options.db);
  const email = new EmailQueue({
    clock,
    timers,
    port: options.emailPort,
    log: (event) =>
      console.info(
        'EMAIL_JOB',
        event.jobId,
        event.purpose,
        event.attempt,
        event.code,
      ),
  });
  let bridge: AuthBridge | null = null;
  const service = new GameService({
    ...options.dependencies,
    persistence: new PostgresPersistence(options.db),
    onMatchFinished: (matchId) => credentials.finishMatch(matchId),
    onParticipantReleased: (personId) =>
      credentials.revokePerson(personId, false),
    onGuestFinished: (personId) => credentials.revokePerson(personId),
    onLobbyReturned: (personIds) => bridge?.recheckLobby(personIds),
  });
  const auth = createAuth({
    db: options.db,
    secret: options.secret,
    publicUrl: options.publicUrl,
    allowedOrigins: options.allowedOrigins,
    clock,
    email,
    returningUser: (cookie) => {
      const names = credentialCookies(options.publicUrl, clock).names;
      const proof = credentials.match(
        cookieToken(cookie ?? undefined, names.match),
      );
      return proof?.person.kind === 'user' &&
        service.matchAccess(proof.person.id, proof.matchId)
        ? proof.person.id
        : null;
    },
    revokeUser: async (userId) => {
      credentials.revokePerson(userId);
      // Immediately rejects queued socket commands while the SQL revocation runs.
      const leaving = service.revoke(userId);
      await Promise.all([accounts.revokeSessions(userId), leaving]);
    },
  });
  bridge = new AuthBridge({
    auth,
    db: options.db,
    accounts,
    credentials,
    service,
    clock,
    publicUrl: options.publicUrl,
  });
  const api = createApiRouter({
    auth,
    bridge,
    accounts,
    credentials,
    service,
    email,
    clock,
    allowedOrigins: options.allowedOrigins,
  });
  const server = createGameServer({
    service,
    api,
    allowedOrigins: options.allowedOrigins,
    authenticate: (headers, signal) =>
      bridge?.authenticate(headers, signal) ?? Promise.resolve(null),
    ...(options.webRoot ? { webRoot: options.webRoot } : {}),
  });
  return { ...server, service, auth, bridge, credentials, accounts, email };
}
