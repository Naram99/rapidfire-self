import { user } from '../../src/database/auth-schema.js';
import { eq } from 'drizzle-orm';
import { test, expect } from './game-fixture.js';

test('only an admin can import champion data and inspect the result on mobile and desktop', async ({
  page,
  game,
}) => {
  const email = await game.register(page, 'Data admin');
  await expect(
    page.getByRole('link', { name: 'Admin', exact: true }),
  ).toHaveCount(0);
  await page.goto(`${game.url}/admin/lol-data`);
  await expect(page.getByRole('alert')).toContainText(
    'You cannot perform this action.',
  );
  const [identity] = await game.database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  if (!identity) throw new Error('Missing browser account');
  await game.lolRepository.setAdmin(identity.id, true);
  await page.goto(game.url);
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No champion data yet', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Update champion data', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Patch 16.20.1', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1', { exact: true })).toBeVisible();
  await expect(page.getByText('28', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Imported', { exact: true }).first(),
  ).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole('button', { name: 'Update champion data', exact: true }),
      ).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({
    path: '.cache/lol-admin-mobile.png',
    fullPage: true,
  });
  await page
    .getByText('Re-import current version', { exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Re-import current version', exact: true })
    .click();
  await expect(
    page.getByText('Already up to date', { exact: true }),
  ).toBeVisible();
  await game.lolRepository.setAdmin(identity.id, false);
  await page
    .getByRole('button', { name: 'Update champion data', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'You cannot perform this action.',
  );
});
