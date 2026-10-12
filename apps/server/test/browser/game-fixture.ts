import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { EmailMessage } from '../../src/email/types.js';
import { createApplication } from '../../src/bootstrap/application.js';
import { harness } from '../game-helpers.js';
import { isolatedDatabase } from '../isolated-database.js';
import {
  fixtureSource,
  fullLolFixture,
  smallLolFixture,
} from '../lol-fixture.js';

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No E2E port');
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}
async function browserApplication(publishedQuestions: boolean) {
  const database = await isolatedDatabase();
  const controlled = harness();
  controlled.timers.now = Date.now();
  const url = `http://127.0.0.1:${await availablePort()}`;
  const messages: EmailMessage[] = [];
  const app = createApplication({
    questionMode: publishedQuestions ? 'published' : 'fixture',
    db: database.db,
    dependencies: controlled.dependencies,
    emailPort: {
      send: async (message) => {
        messages.push(message);
        return 'accepted';
      },
    },
    secret: 'browser-tests-only-secret-never-for-deployment-123456789',
    publicUrl: url,
    allowedOrigins: [url],
    webRoot: resolve('apps/web/dist'),
    lolSource: fixtureSource(
      publishedQuestions ? fullLolFixture() : smallLolFixture(),
    ),
  });
  const connections = new Set<Socket>();
  app.httpServer.on('connection', (connection) => {
    connections.add(connection);
    connection.once('close', () => connections.delete(connection));
  });
  await new Promise<void>((done) =>
    app.httpServer.listen(Number(new URL(url).port), '127.0.0.1', done),
  );
  async function settle() {
    for (let count = 0; count < 8; count++) {
      await app.service.idle();
      await Promise.resolve();
    }
  }
  async function advance(milliseconds: number) {
    controlled.timers.now += milliseconds;
    for (let count = 0; count < 100; count++) {
      const due = [...controlled.timers.timers.entries()]
        .filter(([, timer]) => timer.deadline <= controlled.timers.now)
        .sort((a, b) => a[1].deadline - b[1].deadline)[0];
      if (!due) {
        await settle();
        return;
      }
      controlled.timers.timers.delete(due[0]);
      due[1].callback();
      await settle();
    }
    throw new Error('Too many E2E timers');
  }
  function emailLink(email: string, purpose: 'Verify' | 'Reset') {
    const message = messages.findLast(
      (item) => item.to === email && item.subject.includes(purpose),
    );
    const link = message?.text
      .split('\n')
      .find((line) => line.startsWith(`${url}/`));
    if (!link) throw new Error('No captured email link');
    return link;
  }
  async function signIn(page: Page, email: string, password = 'Password1!') {
    await page.goto(`${url}/sign-in`);
    await page.getByLabel('Email address', { exact: true }).first().fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Profile', exact: true }),
    ).toBeVisible();
  }
  async function register(page: Page, name: string) {
    const email = `${randomUUID()}@example.com`;
    await page.goto(`${url}/sign-up`);
    await page.getByLabel('Nickname', { exact: true }).fill(name);
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password1!');
    await page
      .getByLabel('Confirm password', { exact: true })
      .fill('Password1!');
    await page
      .getByRole('button', { name: 'Create an account', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Check your inbox', exact: true }),
    ).toBeVisible();
    await page.goto(emailLink(email, 'Verify'));
    await expect(
      page.getByRole('heading', { name: 'Email verified', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    await signIn(page, email);
    return email;
  }
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await base.step('Stop test game and import tasks', async () => {
        app.email.close();
        await app.lolImporter.close();
        await app.service.shutdown();
        await app.service.persistenceIdle();
      });
      await base.step('Close test HTTP and Socket.IO server', async () => {
        const stopped = app.io.close();
        // Include incomplete HTTP requests and upgraded connections owned by this test.
        for (const connection of connections) connection.destroy();
        await stopped;
      });
      await base.step('Drop isolated test database', () => database.close());
    })();
    return closing;
  };
  return {
    ...app,
    database,
    url,
    messages,
    advance,
    emailLink,
    register,
    signIn,
    close,
  };
}
export const test = base.extend<{
  game: Awaited<ReturnType<typeof browserApplication>>;
  publishedQuestions: boolean;
}>({
  publishedQuestions: [false, { option: true }],
  game: async ({ publishedQuestions }, use) => {
    const game = await browserApplication(publishedQuestions);
    try {
      await use(game);
    } finally {
      await game.close();
    }
  },
});
export { expect };
