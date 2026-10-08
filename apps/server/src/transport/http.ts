import express from 'express';
import type { Request, Response } from 'express';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import {
  deleteAccountSchema,
  historyQuerySchema,
  nicknameSchema,
  profileUpdateSchema,
} from '@rapidfire/contracts';
import type { GameService } from '../application/game-service.js';
import type { Clock } from '../application/ports.js';
import type { AccountRepository } from '../database/accounts.js';
import type { EmailQueue } from '../email/queue.js';
import type { AuthBridge } from '../auth/bridge.js';
import type { Auth } from '../auth/create-auth.js';
import { cookieToken } from '../auth/credentials.js';
import type { Credentials } from '../auth/credentials.js';

function cookies(response: Response, headers: Headers): void {
  for (const value of headers.getSetCookie())
    response.append('Set-Cookie', value);
  response.set('Cache-Control', 'no-store');
}
const failure = (response: Response, status: number, code: string) =>
  response.status(status).json({ code });
const payload = (request: Request): unknown => request.body;

export function createApiRouter(
  options: Readonly<{
    auth: Auth;
    bridge: AuthBridge;
    credentials: Credentials;
    service: GameService;
    accounts: AccountRepository;
    email: EmailQueue;
    clock: Clock;
    allowedOrigins: readonly string[];
  }>,
) {
  const router = express.Router();
  const json = express.json({ limit: '16kb', strict: true });
  const { bridge, service, credentials, accounts } = options;
  const limits = new Map<string, { start: number; count: number }>();
  router.use('/api', (request, response, next) => {
    // The server supplies this header; forwarded/client-provided IPs are never trusted.
    request.headers['x-rapidfire-client-ip'] =
      request.socket.remoteAddress ?? '127.0.0.1';
    response.set('Cache-Control', 'no-store');
    response.set('Referrer-Policy', 'no-referrer');
    const now = options.clock.now();
    for (const [key, value] of limits)
      if (value.start + 60000 <= now) limits.delete(key);
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const current = limits.get(key) ?? { start: now, count: 0 };
    if (!limits.has(key) && limits.size >= 10000) {
      failure(response, 429, 'RATE_LIMITED');
      return;
    }
    current.count++;
    limits.set(key, current);
    if (current.count > 120) {
      failure(response, 429, 'RATE_LIMITED');
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        (origin !== undefined && !options.allowedOrigins.includes(origin)) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      ) {
        failure(response, 403, 'FORBIDDEN');
        return;
      }
    }
    next();
  });
  router.get('/api/auth/get-session', async (request, response) => {
    const normal = await bridge.renew(request.headers);
    cookies(response, normal.headers);
    response.json(
      normal.access
        ? {
            user: normal.profile,
            session: {
              id:
                normal.access.type === 'session'
                  ? normal.access.sessionId
                  : undefined,
              expiresAt: new Date(normal.access.expiresAt).toISOString(),
              renewAfterSeconds: 300,
            },
          }
        : null,
    );
  });
  router.get('/api/game-config', (_request, response) => {
    response.json({
      maxRounds: Math.min(10, service.dependencies.questions.categories.length),
    });
  });
  router.get('/api/auth/verify-email', (request, response, next) => {
    // An email-link navigation gets the app's verification screen; API clients
    // still use Better Auth directly with a JSON request.
    const token = request.query.token;
    if (
      !request.headers.accept?.includes('text/html') ||
      typeof token !== 'string'
    ) {
      next();
      return;
    }
    response.redirect(302, `/verify-email?${new URLSearchParams({ token })}`);
  });
  router.post('/api/auth/delete-user', json, async (request, response) => {
    const body = deleteAccountSchema.safeParse(payload(request));
    if (!body.success) {
      failure(response, 400, 'INVALID_PAYLOAD');
      return;
    }
    const { access } = await bridge.normal(request.headers);
    if (!access) {
      failure(response, 401, 'AUTH_REQUIRED');
      return;
    }
    if (!(await accounts.remove(access.person.id, body.data.password))) {
      failure(response, 400, 'INVALID_PASSWORD');
      return;
    }
    credentials.revokePerson(access.person.id);
    options.email.cancelUser(access.person.id);
    await service.anonymize(access.person.id);
    await service.revoke(access.person.id);
    // The application owns the deletion transaction; BA still owns its cookie format.
    const signedOut = await options.auth.api.signOut({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    cookies(response, signedOut.headers);
    response.append('Set-Cookie', bridge.cookies.clear('match'));
    response.append('Set-Cookie', bridge.cookies.clear('guest'));
    response.json({ success: true });
  });
  router.all(
    '/api/auth/{*path}',
    toNodeHandler(async (request) => {
      const result = await options.auth.handler(request);
      if (result.status < 400) return result;
      let body: unknown = null;
      try {
        body = await result.clone().json();
      } catch {
        /* Empty upstream error. */
      }
      const code =
        result.status === 429
          ? 'RATE_LIMITED'
          : typeof body === 'object' &&
              body !== null &&
              'code' in body &&
              typeof body.code === 'string'
            ? body.code
            : result.status >= 500
              ? 'SERVER_UNAVAILABLE'
              : 'INVALID_PAYLOAD';
      // Clients translate codes; framework English text is not a wire contract.
      const headers = new Headers(result.headers);
      headers.delete('content-length');
      return Response.json({ code }, { status: result.status, headers });
    }),
  );
  router.post('/api/guest/session', json, async (request, response) => {
    const body = payload(request);
    const name =
      typeof body === 'object' && body !== null && 'nickname' in body
        ? nicknameSchema.safeParse(body.nickname)
        : null;
    if (
      !name?.success ||
      Object.keys(body ?? {}).some((key) => key !== 'nickname')
    ) {
      failure(response, 400, 'INVALID_PAYLOAD');
      return;
    }
    const normal = await bridge.normal(request.headers);
    if (normal.access || normal.unverified) {
      failure(response, 409, 'FORBIDDEN');
      return;
    }
    const previous = credentials.guest(
      cookieToken(request.headers.cookie, bridge.cookies.names.guest),
    );
    if (previous) {
      failure(response, 409, 'FORBIDDEN');
      return;
    }
    const proof = credentials.match(
      cookieToken(request.headers.cookie, bridge.cookies.names.match),
    );
    if (proof && service.matchAccess(proof.person.id, proof.matchId)) {
      failure(response, 409, 'ALREADY_IN_MATCH');
      return;
    }
    const { token, credential } = credentials.createGuest(name.data);
    response.append(
      'Set-Cookie',
      bridge.cookies.serialize('guest', token, credential.expiresAt),
    );
    response.json({
      guest: { nickname: credential.person.name },
      expiresAt: new Date(credential.expiresAt).toISOString(),
      renewAfterSeconds: 300,
    });
  });
  router.post('/api/guest/session/renew', json, async (request, response) => {
    const token = cookieToken(
      request.headers.cookie,
      bridge.cookies.names.guest,
    );
    const guest = credentials.renewGuest(token);
    if (!guest || !token) {
      response.append('Set-Cookie', bridge.cookies.clear('guest'));
      failure(response, 401, 'AUTH_REQUIRED');
      return;
    }
    await service.refreshSession({
      type: 'session',
      person: guest.person,
      emailVerified: true,
      expiresAt: guest.expiresAt,
    });
    response.append(
      'Set-Cookie',
      bridge.cookies.serialize('guest', token, guest.expiresAt),
    );
    response.json({
      guest: { nickname: guest.person.name },
      expiresAt: new Date(guest.expiresAt).toISOString(),
      renewAfterSeconds: 300,
    });
  });
  router.post('/api/guest/sign-out', json, async (request, response) => {
    const token = cookieToken(
      request.headers.cookie,
      bridge.cookies.names.guest,
    );
    const guest = credentials.guest(token);
    const proof = credentials.match(
      cookieToken(request.headers.cookie, bridge.cookies.names.match),
    );
    const person =
      guest?.person ??
      (proof?.person.kind === 'guest' &&
      service.matchAccess(proof.person.id, proof.matchId)
        ? proof.person
        : null);
    if (person) {
      credentials.revokePerson(person.id);
      await service.revoke(person.id);
    }
    response.append('Set-Cookie', bridge.cookies.clear('guest'));
    response.append('Set-Cookie', bridge.cookies.clear('match'));
    response.json({ success: true });
  });
  router.post('/api/match-access', json, async (request, response) => {
    const normal = await bridge.normal(request.headers);
    const guest =
      normal.access || normal.unverified
        ? null
        : credentials.guest(
            cookieToken(request.headers.cookie, bridge.cookies.names.guest),
          );
    const person = normal.access?.person ?? guest?.person;
    if (!person) {
      failure(response, 401, 'AUTH_REQUIRED');
      return;
    }
    const match = service.matchAccess(person.id);
    if (!match) {
      response.append('Set-Cookie', bridge.cookies.clear('match'));
      failure(response, 404, 'NOT_FOUND');
      return;
    }
    const issued = credentials.issueMatch(
      match.person,
      match.matchId,
      match.startedAt,
      cookieToken(request.headers.cookie, bridge.cookies.names.match),
    );
    if (!issued) {
      failure(response, 401, 'MATCH_ACCESS_EXPIRED');
      return;
    }
    response.append(
      'Set-Cookie',
      bridge.cookies.serialize(
        'match',
        issued.token,
        issued.credential.expiresAt,
      ),
    );
    response.json({
      matchId: match.matchId,
      scope: match.scope,
      expiresAt: new Date(issued.credential.expiresAt).toISOString(),
    });
  });
  router.get('/api/profile', async (request, response) => {
    const normal = await bridge.normal(request.headers);
    if (!normal.access || !normal.profile) {
      failure(response, 401, 'AUTH_REQUIRED');
      return;
    }
    response.json(normal.profile);
  });
  router.patch('/api/profile', json, async (request, response) => {
    const body = profileUpdateSchema.safeParse(payload(request));
    if (!body.success) {
      failure(response, 400, 'INVALID_PAYLOAD');
      return;
    }
    const normal = await bridge.normal(request.headers);
    if (!normal.access) {
      failure(response, 401, 'AUTH_REQUIRED');
      return;
    }
    await accounts.updateNickname(normal.access.person.id, body.data.nickname);
    const updated = await bridge.normal(request.headers);
    if (updated.access) await service.refreshSession(updated.access);
    response.json(updated.profile);
  });
  router.get('/api/games', async (request, response) => {
    const query = historyQuerySchema.safeParse(request.query);
    if (!query.success) {
      failure(response, 400, 'INVALID_PAYLOAD');
      return;
    }
    const { access } = await bridge.normal(request.headers);
    if (!access) {
      failure(response, 401, 'AUTH_REQUIRED');
      return;
    }
    response.json({
      games: await accounts.history(
        access.person.id,
        query.data.limit,
        query.data.before,
        query.data.beforeId,
      ),
    });
  });
  router.get('/api/games/:id', async (request, response) => {
    const id = request.params.id;
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      failure(response, 400, 'INVALID_PAYLOAD');
      return;
    }
    const { access } = await bridge.normal(request.headers);
    if (!access) {
      failure(response, 401, 'AUTH_REQUIRED');
      return;
    }
    const result = await accounts.result(access.person.id, id);
    if (!result) {
      failure(response, 404, 'NOT_FOUND');
      return;
    }
    response.json(result);
  });
  router.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: express.NextFunction,
    ) => {
      if (response.headersSent) return;
      const badBody =
        error instanceof SyntaxError ||
        (typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          (error.status === 400 || error.status === 413));
      if (!badBody) console.warn('HTTP_REQUEST_FAILED');
      failure(
        response,
        badBody ? 400 : 503,
        badBody ? 'INVALID_PAYLOAD' : 'SERVER_UNAVAILABLE',
      );
    },
  );
  return router;
}
