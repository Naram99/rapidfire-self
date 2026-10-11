import { eq } from 'drizzle-orm';
import { user } from '../../src/database/auth-schema.js';
import { game as gameTable } from '../../src/database/schema.js';
import { test, expect } from './game-fixture.js';

test.use({ publishedQuestions: true });
test('mobile lobby uses published versions and a custom seed, and history retains replay information', async ({
  page,
  game,
}, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(game.url);
  await expect(
    page.getByRole('button', { name: 'Start solo game' }),
  ).toBeDisabled();
  await expect(
    page.getByText('Questions are not ready yet.', { exact: false }),
  ).toBeVisible();
  const email = await game.register(page, 'Seed tester');
  const [identity] = await game.database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  if (!identity) throw new Error('Missing user');
  await game.lolRepository.setAdmin(identity.id, true);
  await page.goto(`${game.url}/admin/lol-data`);
  await page
    .getByRole('button', { name: 'Update champion data', exact: true })
    .click();
  // Full-snapshot publication validates 207 seeds before the version appears.
  await expect(
    page.getByRole('heading', { name: 'Playable question versions' }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('26 categories', { exact: false })).toBeVisible();
  await page.goto(game.url);
  await page
    .getByRole('button', { name: 'Create a room', exact: true })
    .click();
  await expect(page.locator('.room-code')).toBeVisible();
  await page.locator('.room-controls summary').click();
  await expect(
    page.getByRole('combobox', { name: 'Question version' }).locator('option'),
  ).toHaveText('16.20.1');
  await page.getByLabel('Use a custom seed').check();
  await page.getByLabel('Seed', { exact: true }).fill('Ab1');
  await page.screenshot({
    path: testInfo.outputPath('generation-lobby-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath('generation-lobby-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Save game settings' }).click();
  await expect(
    page.getByText('Settings updated. Everyone needs to get ready again.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'I’m ready', exact: true }).click();
  await game.advance(5000);
  const offered = page.getByRole('button', { name: /^Choose / });
  await expect(offered).toHaveCount(4);
  await offered.first().click();
  await expect(page.locator('.category-name')).toBeVisible();
  await expect(page.locator('.answer-option')).toHaveCount(0);
  for (let index = 0; index < 5; index++) {
    await game.advance(3000);
    await expect(
      page.locator('.question-panel .question-heading'),
    ).toBeVisible();
    await game.advance(20000);
    await expect(page.locator('.evaluation-summary')).toBeVisible();
    await game.advance(5000);
  }
  await expect(
    page.getByRole('heading', { name: 'Game complete' }),
  ).toBeVisible();
  await expect(page.locator('.generation-info')).toContainText('16.20.1');
  await expect(page.locator('.generation-info code')).toHaveText('Ab1');
  await expect(page.locator('.generation-info')).toContainText(
    'rating changes disabled',
  );
  await game.service.persistenceIdle();
  const [stored] = await game.database.db.select().from(gameTable);
  expect(stored).toMatchObject({
    generationSeed: 'Ab1',
    seedOrigin: 'custom',
    eloExclusionReason: 'custom_seed',
  });
  if (!stored) throw new Error('No saved match');
  await page.goto(`${game.url}/history/${stored.id}`);
  await expect(page.locator('.generation-info code')).toHaveText('Ab1');
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
