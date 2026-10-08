import { test, expect } from './game-fixture.js';
import { guestResponseSchema } from '@rapidfire/contracts';

test('a lobby shows an offline member, releases the place after one minute and recovers without a sync loop', async ({
  browser,
  page,
  game,
}) => {
  test.setTimeout(60000);
  const offlineContext = await browser.newContext();
  try {
    const offline = await offlineContext.newPage();
    await game.register(page, 'Staying player');
    await game.register(offline, 'Offline player');
    await page
      .getByRole('button', { name: 'Create a room', exact: true })
      .click();
    const code = await page.locator('.room-code').innerText();
    await offline.getByLabel('Room code', { exact: true }).fill(code);
    await offline
      .getByRole('button', { name: 'Join room', exact: true })
      .click();
    await offline
      .getByRole('button', { name: 'I’m ready', exact: true })
      .click();
    const row = page
      .locator('.participant-list > li')
      .filter({ hasText: 'Offline player' });
    await expect(row.getByText('Ready', { exact: true })).toBeVisible();
    await offlineContext.setOffline(true);
    await expect(row.getByText('Offline', { exact: true })).toBeVisible();
    await expect(row.getByText('Not ready', { exact: true })).toBeVisible();
    await expect(row.getByText(/\d+s remaining/)).toBeVisible();
    await game.advance(60000);
    await expect(row).toHaveCount(0);
    let syncRequests = 0;
    offline.on('websocket', (socket) =>
      socket.on('framesent', (frame) => {
        if (String(frame.payload).includes('state:sync')) syncRequests++;
      }),
    );
    await offlineContext.setOffline(false);
    await expect(
      offline.getByRole('heading', { name: 'Think fast. Make it count.' }),
    ).toBeVisible();
    expect(syncRequests).toBeLessThanOrEqual(2);
    await offline.getByLabel('Room code', { exact: true }).fill(code);
    await offline
      .getByRole('button', { name: 'Join room', exact: true })
      .click();
    await expect(row).toBeVisible();
    await expect(row.getByText('Not ready', { exact: true })).toBeVisible();
  } finally {
    await offlineContext.close();
  }
});

test('an active guest renews through HTTP after five minutes while the match cookie keeps its fixed deadline', async ({
  page,
  context,
  game,
}) => {
  test.setTimeout(60000);
  await page.clock.install();
  await page.goto(game.url);
  await page.getByLabel('Your nickname').fill('Renewing guest');
  const creation = page.waitForResponse(
    (response) =>
      response.url() === `${game.url}/api/guest/session` &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Start solo game', exact: true })
    .click();
  const created = guestResponseSchema.parse(await (await creation).json());
  await expect(
    page.getByRole('heading', { name: 'Get ready', exact: true }),
  ).toBeVisible();
  await game.advance(5000);
  await page
    .getByRole('button', { name: 'Choose Category c1', exact: true })
    .click();
  await expect
    .poll(async () =>
      (await context.cookies()).some(
        (cookie) => cookie.name === 'rapidfire.match',
      ),
    )
    .toBe(true);
  const before = await context.cookies();
  const guest = before.find((cookie) => cookie.name === 'rapidfire.guest');
  const match = before.find((cookie) => cookie.name === 'rapidfire.match');
  if (!guest || !match) throw new Error('Guest/match cookies missing');
  await game.advance(300000);
  const renewal = page.waitForResponse(
    (response) =>
      response.url() === `${game.url}/api/guest/session/renew` &&
      response.request().method() === 'POST',
  );
  await page.clock.fastForward(300001);
  const renewed = await renewal;
  expect(renewed.status()).toBe(200);
  const renewedBody = guestResponseSchema.parse(await renewed.json());
  const after = await context.cookies();
  expect(
    Date.parse(renewedBody.expiresAt) - Date.parse(created.expiresAt),
  ).toBeGreaterThanOrEqual(300000);
  expect(
    after.find((cookie) => cookie.name === 'rapidfire.guest')?.httpOnly,
  ).toBe(true);
  expect(
    after.find((cookie) => cookie.name === 'rapidfire.match')?.expires,
  ).toBe(match.expires);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Private question 1', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.participant-list')).toContainText(
    'Renewing guest',
  );
});
