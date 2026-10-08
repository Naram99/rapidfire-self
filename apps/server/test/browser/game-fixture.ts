import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { EmailMessage } from '../../src/email/types.js';
import { createApplication } from '../../src/bootstrap/application.js';
import { harness } from '../game-helpers.js';
import { isolatedDatabase } from '../isolated-database.js';

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
async function browserApplication() {
  const database = await isolatedDatabase();
  const controlled = harness();
  controlled.timers.now = Date.now();
  const url = `http://127.0.0.1:${await availablePort()}`;
  const messages: EmailMessage[] = [];
  const app = createApplication({
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
  return {
    ...app,
    database,
    url,
    messages,
    advance,
    emailLink,
    register,
    signIn,
    close: async () => {
      app.email.close();
      await app.service.shutdown();
      await app.service.persistenceIdle();
      await new Promise<void>((done) => app.io.close(() => done()));
      await database.close();
    },
  };
}
export const test = base.extend<{
  game: Awaited<ReturnType<typeof browserApplication>>;
}>({
  game: async ({}, use) => {
    const game = await browserApplication();
    try {
      await use(game);
    } finally {
      await game.close();
    }
  },
});
export { expect };
