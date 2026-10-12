import type { Page, Request } from '@playwright/test';
import { test, expect } from './game-fixture.js';

test('notifications float without stealing focus, restart for new feedback, pause while reading and can be dismissed', async ({
  page,
  game,
}, testInfo) => {
  await game.register(page, 'Toast player');
  await pauseClock(page);
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save nickname', exact: true });
  const region = page.getByRole('region', {
    name: 'Notifications',
    exact: true,
  });
  const toast = region.getByRole('status');
  const close = toast.getByRole('button', {
    name: 'Dismiss message',
    exact: true,
  });
  const update = async (nickname: string) => {
    await page.getByLabel('Nickname', { exact: true }).fill(nickname);
    await save.click();
    await expect(toast).toHaveText('Nickname updated.');
    await expect(
      page.getByRole('heading', { name: nickname, exact: true }),
    ).toBeVisible();
    await expect(close).not.toBeFocused();
  };
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await update('First update');
  expect(await region.evaluate((node) => getComputedStyle(node).position)).toBe(
    'fixed',
  );
  expect(
    await toast.evaluate((node) => getComputedStyle(node).animationDuration),
  ).toBe('0s');
  const bounds = await close.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('toast-mobile-light.png'),
  });
  await page.clock.runFor(4000);
  await update('Second update');
  await expect(toast).toHaveCount(1);
  await page.clock.runFor(1500);
  await expect(toast).toBeVisible();
  await page.clock.runFor(3600);
  await expect(toast).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await update('Third update');
  await toast.hover();
  await page.clock.runFor(10000);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await save.focus();
  await close.focus();
  await page.clock.runFor(10000);
  await expect(toast).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('toast-desktop-dark.png'),
  });
  await page.keyboard.press('Escape');
  await expect(toast).toHaveCount(0);
  await expect(save).toBeFocused();
  await update('Fourth update');
  await close.click();
  await expect(toast).toHaveCount(0);
});

test('saved-match feedback stays dismissed after returning home and another match gets its own notification', async ({
  page,
  game,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await game.register(page, 'Saved games');
  await pauseClock(page);
  const region = page.getByRole('region', {
    name: 'Notifications',
    exact: true,
  });
  const saved = region
    .getByRole('status')
    .filter({ hasText: 'Results saved to your history.' });
  for (const dismissManually of [true, false]) {
    await finishSolo(page, game.advance);
    await game.service.persistenceIdle();
    await expect(saved).toBeVisible();
    if (dismissManually)
      await saved
        .getByRole('button', { name: 'Dismiss message', exact: true })
        .click();
    else await page.clock.runFor(5100);
    await expect(saved).toHaveCount(0);
    await game.advance(15000);
    await expect(
      page.getByRole('heading', { name: 'Think fast. Make it count.' }),
    ).toBeVisible();
    await expect(
      page.getByText('Results saved to your history.', { exact: true }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: 'Your rounds, remembered',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Rapidfire', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByText('Results saved to your history.', { exact: true }),
    ).toHaveCount(0);
  }
});

test('errors stay readable for eight seconds, pause in the background and fit enlarged text in both themes', async ({
  page,
  game,
}) => {
  await game.register(page, 'Error feedback');
  await pauseClock(page);
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'NETWORK_ERROR' },
    }),
  );
  await page
    .getByRole('button', { name: 'Sign out everywhere', exact: true })
    .click();
  const region = page.getByRole('region', {
    name: 'Notifications',
    exact: true,
  });
  const error = region.getByRole('alert').filter({
    hasText: 'Unable to reach the server. Check your connection and try again.',
  });
  await expect(error).toContainText('Unable to reach the server.');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 812, height: 375 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const bounds = await region.boundingBox();
      if (!bounds) throw new Error('Notification region is missing');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    }
  }
  await page.clock.runFor(5100);
  await expect(error).toBeVisible();
  const backgroundRequests: string[] = [];
  const recordRequest = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (['/api/game-config', '/api/auth/get-session'].includes(path))
      backgroundRequests.push(path);
  };
  page.on('request', recordRequest);
  await page.evaluate(() => {
    // Real background tabs change both properties. Leaving visibilityState
    // visible would incorrectly trigger foreground HTTP checks during runFor.
    Object.defineProperties(document, {
      hidden: { configurable: true, value: true },
      visibilityState: { configurable: true, value: 'hidden' },
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(20000);
  await expect(error).toBeVisible();
  page.off('request', recordRequest);
  expect(backgroundRequests).toEqual([]);
  // Foreground checks use real HTTP: finish them before advancing the clock
  // again so simulated time cannot race their network timeout.
  const restored = Promise.all([
    page
      .waitForResponse('**/api/game-config')
      .then((response) => response.finished()),
    page
      .waitForResponse('**/api/auth/get-session')
      .then((response) => response.finished()),
  ]);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await restored;
  await page.clock.runFor(3000);
  await expect(error).toHaveCount(0);
  await expect(region.getByRole('alert')).toHaveCount(0);
});

async function pauseClock(page: Page) {
  const start = new Date();
  await page.clock.install({ time: start });
  // Pin the browser's clock explicitly and pause ahead of it, independent of
  // host/browser clock skew or the time spent between Playwright commands.
  await page.clock.pauseAt(new Date(start.getTime() + 60000));
}

async function finishSolo(page: Page, advance: (ms: number) => Promise<void>) {
  await page
    .getByRole('button', { name: 'Start solo game', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Get ready', exact: true }),
  ).toBeVisible();
  await advance(5000);
  await page
    .getByRole('button', { name: 'Choose Category c1', exact: true })
    .click();
  for (let number = 1; number <= 5; number++) {
    await expect(
      page.getByRole('heading', { name: 'Get ready', exact: true }),
    ).toBeVisible();
    await advance(3000);
    await expect(
      page.getByRole('heading', {
        name: `Private question ${number}`,
        exact: true,
      }),
    ).toBeVisible();
    if (number === 2) {
      await page.getByLabel('Option a', { exact: true }).check();
      await page
        .getByRole('button', { name: 'Lock in answer', exact: true })
        .click();
    } else
      await page.getByRole('button', { name: 'Option a', exact: true }).click();
    await expect(page.locator('.evaluation-summary')).toBeVisible();
    await advance(5000);
  }
  await expect(
    page.getByRole('heading', { name: 'Game complete', exact: true }),
  ).toBeVisible();
}
