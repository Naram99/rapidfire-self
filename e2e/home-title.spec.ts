import { expect, test } from '@playwright/test';

test('the title cycles without moving the play form and can be paused and resumed', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 375, height: 812 });
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 60000);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const active = page.locator('.title-words [data-active="true"]');
  const form = page.locator('.home-play');
  const initial = await form.boundingBox();
  if (!initial) throw new Error('Home play form not visible');
  await expect(active).toHaveText('Think.');
  for (const word of [
    'Answer.',
    'Guess.',
    'Learn.',
    'Play.',
    'Win.',
    'Think.',
  ]) {
    await page.clock.runFor(2000);
    await expect(active).toHaveText(word);
    const bounds = await form.boundingBox();
    expect(bounds?.y).toBe(initial.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Pause title animation' }).click();
  await page.clock.runFor(10000);
  await expect(active).toHaveText('Think.');
  await page.getByRole('button', { name: 'Resume title animation' }).click();
  await page.clock.runFor(2000);
  await expect(active).toHaveText('Answer.');
  await page.screenshot({
    path: testInfo.outputPath('home-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Sign in', exact: true }).focus();
  await page.getByRole('button', { name: 'Pause title animation' }).focus();
  await page.clock.runFor(8000);
  await expect(active).toHaveText('Answer.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(active).toHaveText('Think.');
  await page.clock.runFor(8000);
  await expect(active).toHaveText('Think.');
  await expect(
    page.getByRole('heading', { name: 'Think fast. Make it count.' }),
  ).toBeVisible();
});

test('reduced motion keeps a static title across themes, screen sizes and enlarged text', async ({
  page,
}, testInfo) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 60000);
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 812, height: 375 },
      { width: 1440, height: 1000 },
    ]) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      if (viewport.width === 1440)
        await page.screenshot({
          path: testInfo.outputPath(`home-desktop-${colorScheme}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await page.clock.runFor(8000);
      const active = page.locator('.title-words [data-active="true"]');
      await expect(active).toHaveText('Think.');
      await expect(
        page.getByRole('button', { name: 'Pause title animation' }),
      ).toHaveCount(0);
      expect(
        await active.evaluate(
          (node) => getComputedStyle(node).transitionDuration,
        ),
      ).toBe('0s');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});
