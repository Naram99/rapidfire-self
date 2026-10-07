import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, gt } from 'drizzle-orm';
import type { GameService } from '../application/game-service.js';
import type { Access, Clock } from '../application/ports.js';
import type { AccountRepository } from '../database/accounts.js';
import { session, user } from '../database/auth-schema.js';
import type { Database } from '../database/client.js';
import type { Auth } from './create-auth.js';
import { cookieToken, credentialCookies } from './credentials.js';
import type { Credentials } from './credentials.js';

export class AuthBridge {
  readonly cookies;
  constructor(
    private readonly options: Readonly<{
      auth: Auth;
      db: Database;
      accounts: AccountRepository;
      credentials: Credentials;
      service: GameService;
      clock: Clock;
      publicUrl: string;
    }>,
  ) {
    this.cookies = credentialCookies(options.publicUrl, options.clock);
  }
  async normal(headers: IncomingHttpHeaders, renew = false) {
    const epoch = this.options.service.accessEpoch();
    const result = await this.options.auth.api.getSession({
      headers: fromNodeHeaders(headers),
      query: { disableRefresh: !renew },
      returnHeaders: true,
    });
    const identity = result.response;
    if (!identity || epoch !== this.options.service.accessEpoch())
      return { access: null, headers: result.headers };
    if (!identity.user.emailVerified)
      return { access: null, headers: result.headers, unverified: true };
    const profile = await this.options.accounts.profile(identity.user.id);
    const access: Access | null =
      profile && epoch === this.options.service.accessEpoch()
        ? {
            authEpoch: epoch,
            type: 'session',
            sessionId: identity.session.id,
            person: {
              id: profile.userId,
              name: profile.nickname,
              kind: 'user',
            },
            expiresAt: identity.session.expiresAt.getTime(),
            emailVerified: true,
          }
        : null;
    return { access, profile, headers: result.headers };
  }
  async authenticate(
    headers: IncomingHttpHeaders,
    signal: AbortSignal,
  ): Promise<Access | null> {
    const epoch = this.options.service.accessEpoch();
    const normal = await this.normal(headers);
    if (signal.aborted || epoch !== this.options.service.accessEpoch())
      return null;
    if (normal.access) return normal.access;
    if (normal.unverified) return null;
    const guest = this.options.credentials.guest(
      cookieToken(headers.cookie, this.cookies.names.guest),
    );
    if (guest)
      return {
        type: 'session',
        person: guest.person,
        expiresAt: guest.expiresAt,
        emailVerified: true,
        authEpoch: epoch,
      };
    const proof = this.options.credentials.match(
      cookieToken(headers.cookie, this.cookies.names.match),
    );
    if (
      !proof ||
      !this.options.service.matchAccess(proof.person.id, proof.matchId)
    )
      return null;
    // Read the retained participant identity, not an old name from its cookie record.
    const match = this.options.service.matchAccess(
      proof.person.id,
      proof.matchId,
    );
    return match
      ? {
          type: 'match',
          person: match.person,
          matchId: match.matchId,
          expiresAt: proof.expiresAt,
          authEpoch: epoch,
        }
      : null;
  }
  async renew(headers: IncomingHttpHeaders) {
    const normal = await this.normal(headers, true);
    if (normal.access) await this.options.service.refreshSession(normal.access);
    return normal;
  }
  recheckLobby(personIds: readonly string[]): void {
    for (const personId of personIds) {
      const ids = this.options.service.sessionIds(personId);
      void this.recheck(personId, ids).catch(() =>
        console.warn('LOBBY_AUTH_CHECK_FAILED'),
      );
    }
  }
  private async recheck(
    personId: string,
    sessionIds: readonly string[],
  ): Promise<void> {
    const epoch = this.options.service.accessEpoch();
    // This checks identity without extending database expiry or browser cookies.
    const profile = await this.options.accounts.profile(personId);
    if (!profile) return;
    for (const id of sessionIds) {
      const [row] = await this.options.db
        .select({ expiresAt: session.expiresAt, verified: user.emailVerified })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(
          and(
            eq(session.id, id),
            eq(session.userId, personId),
            gt(session.expiresAt, new Date(this.options.clock.now())),
          ),
        );
      if (row?.verified)
        await this.options.service.refreshSession({
          type: 'session',
          sessionId: id,
          authEpoch: epoch,
          person: { id: personId, name: profile.nickname, kind: 'user' },
          emailVerified: true,
          expiresAt: row.expiresAt.getTime(),
        });
    }
  }
}
