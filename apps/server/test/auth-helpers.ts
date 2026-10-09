import { PROTOCOL_VERSION } from '@rapidfire/contracts';
import type {
  ClientEvents,
  ServerEvents,
  Snapshot,
} from '@rapidfire/contracts';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { EmailMessage } from '../src/email/types.js';
import { createApplication } from '../src/bootstrap/application.js';
import { runtimeDependencies } from '../src/infrastructure/runtime.js';
import { harness } from './game-helpers.js';
import { isolatedDatabase } from './isolated-database.js';

export class CookieJar {
  private readonly values = new Map<string, string>();
  accept(response: Response): void {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const token = pair.slice(separator + 1);
      if (/Max-Age=0(?:;|$)/i.test(value) || token === '')
        this.values.delete(name);
      else this.values.set(name, token);
    }
  }
  header(): string {
    return [...this.values]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

export async function authHarness(manual = false) {
  const database = await isolatedDatabase();
  const gameHarness = harness();
  gameHarness.timers.now = Date.now();
  const dependencies = manual
    ? gameHarness.dependencies
    : runtimeDependencies();
  const messages: EmailMessage[] = [];
  const app = createApplication({
    db: database.db,
    dependencies,
    emailPort: {
      send: async (message) => {
        messages.push(message);
        return 'accepted';
      },
    },
    secret: 'isolated-tests-only-secret-never-for-deployment-123456789',
    publicUrl: 'http://test.local',
    allowedOrigins: ['http://test.local'],
  });
  await new Promise<void>((resolve) =>
    app.httpServer.listen(0, '127.0.0.1', resolve),
  );
  const address = app.httpServer.address();
  if (!address || typeof address === 'string')
    throw new Error('No test server address');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  async function request(
    jar: CookieJar,
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) {
    const response = await fetch(`${url}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Origin: 'http://test.local',
        Cookie: jar.header(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    jar.accept(response);
    return response;
  }
  async function register(jar: CookieJar, email: string, name = 'Nickname') {
    const response = await request(jar, '/api/auth/sign-up/email', {
      email,
      name,
      password: 'Password1!',
      passwordConfirm: 'Password1!',
    });
    if (response.status !== 200)
      throw new Error(
        `Registration failed: ${response.status}, ${await response.text()}`,
      );
    const message = messages.findLast(
      (item) =>
        item.to === email.toLowerCase() && item.subject.includes('Verify'),
    );
    const link = message?.text
      .split('\n')
      .find((line) => line.startsWith('http://'));
    if (!link) throw new Error('No verification email');
    const verification = await request(
      jar,
      `${new URL(link).pathname}${new URL(link).search}`,
    );
    if (verification.status !== 200 && verification.status !== 302)
      throw new Error(`Verification failed: ${verification.status}`);
    return signIn(jar, email);
  }
  async function signIn(
    jar: CookieJar,
    email: string,
    password = 'Password1!',
  ) {
    const response = await request(jar, '/api/auth/sign-in/email', {
      email,
      password,
    });
    if (response.status !== 200)
      throw new Error(`Sign-in failed: ${response.status}`);
    const normal = await app.bridge.normal({ cookie: jar.header() });
    if (!normal.access || normal.access.type !== 'session')
      throw new Error('No trusted normal identity');
    return normal.access;
  }
  async function socket(jar: CookieJar) {
    const client: Socket<ServerEvents, ClientEvents> = io(url, {
      autoConnect: false,
      auth: { protocolVersion: PROTOCOL_VERSION },
      extraHeaders: { Cookie: jar.header(), Origin: 'http://test.local' },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(client);
    const snapshots: Snapshot[] = [];
    client.on('state:snapshot', (snapshot) => snapshots.push(snapshot));
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
      client.connect();
    });
    return {
      client,
      snapshots,
      latest: () => {
        const snapshot = snapshots.at(-1);
        if (!snapshot) throw new Error('No snapshot');
        return snapshot;
      },
    };
  }
  async function settle() {
    for (let count = 0; count < 8; count++) {
      await app.service.idle();
      await Promise.resolve();
    }
  }
  async function advance(ms: number) {
    gameHarness.timers.now += ms;
    for (let count = 0; count < 100; count++) {
      const due = [...gameHarness.timers.timers.entries()]
        .filter(([, t]) => t.deadline <= gameHarness.timers.now)
        .sort((a, b) => a[1].deadline - b[1].deadline)[0];
      if (!due) {
        await settle();
        return;
      }
      gameHarness.timers.timers.delete(due[0]);
      due[1].callback();
      await settle();
    }
    throw new Error('Too many test timers');
  }
  const close = async () => {
    for (const socket of sockets) socket.disconnect();
    app.email.close();
    await app.service.shutdown();
    await app.service.persistenceIdle();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
    await database.close();
  };
  return {
    ...app,
    database,
    url,
    messages,
    request,
    register,
    signIn,
    socket,
    close,
    advance,
    settle,
  };
}
