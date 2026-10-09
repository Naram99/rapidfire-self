import type { Page } from '@playwright/test';
import { inArray } from 'drizzle-orm';
import { sessionResponseSchema } from '@rapidfire/contracts';
import { session } from '../../src/database/auth-schema.js';
import { game as gameTable } from '../../src/database/schema.js';
import { test, expect } from './game-fixture.js';

test.describe('complete browser game flows', () => {
  test.setTimeout(90000);
  test.use({ hasTouch: true });

  test('a mobile guest completes solo, receives partial scores, and cannot backfill results after registration', async ({
    page,
    game,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(game.url);
    await page.getByLabel('Your nickname').fill('Mobile guest');
    await page.locator('.home-play summary').click();
    await expect(
      page.getByRole('combobox', { name: 'Game topic' }),
    ).toHaveValue('league-of-legends');
    await page.getByRole('button', { name: 'Start solo game' }).click();
    await expect(
      page.getByRole('heading', { name: 'Get ready' }),
    ).toBeVisible();
    await game.advance(5000);
    await page
      .getByRole('button', { name: 'Choose Category c1', exact: true })
      .click();
    await expect(page.locator('.category-name')).toHaveText('Category c1');
    await expect(
      page.getByText('Private question 1', { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Option a', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Option a', exact: true }),
    ).toHaveCount(0);
    for (let number = 1; number <= 5; number++) {
      await expect(
        page.getByRole('heading', { name: 'Get ready' }),
      ).toBeVisible();
      await game.advance(3000);
      await expect(
        page.getByRole('heading', {
          name: `Private question ${number}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Sign out everywhere' }),
      ).toHaveCount(0);
      if (number === 3) await game.advance(20000);
      else if (number === 2) {
        await page.getByLabel('Option a', { exact: true }).check();
        await expect(page.locator('.evaluation-summary')).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: 'Lock in answer' }),
        ).toBeEnabled();
        await page.getByRole('button', { name: 'Lock in answer' }).click();
      } else {
        await expect(
          page.getByRole('button', { name: 'Lock in answer' }),
        ).toHaveCount(0);
        const option = page.getByRole('button', {
          name: 'Option a',
          exact: true,
        });
        if (number === 4) {
          await option.focus();
          await page.keyboard.press('Enter');
        } else await option.tap();
      }
      await expect(page.locator('.evaluation-summary')).toContainText(
        number === 2
          ? '1 of 2 correct'
          : number === 3
            ? 'No answer'
            : 'Correct',
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await game.advance(5000);
    }
    await expect(
      page.getByRole('heading', { name: 'Game complete' }),
    ).toBeVisible();
    await expect(page.locator('.question-results > li')).toHaveCount(5);
    await expect(
      page.getByText('This guest game cannot be added later.', {
        exact: false,
      }),
    ).toBeVisible();
    expect(await game.database.db.select().from(gameTable)).toEqual([]);
    await page
      .getByRole('button', { name: 'Sign in for your next game' })
      .click();
    await game.register(page, 'Former guest');
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your first result starts here.' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('two players finish multiplayer, share answer locks between tabs, reconnect and retain anonymous shared history after deletion', async ({
    browser,
    game,
  }, testInfo) => {
    const aliceContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const bobContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const alice = await aliceContext.newPage(),
        bob = await bobContext.newPage();
      const errors: string[] = [];
      for (const page of [alice, bob])
        page.on('pageerror', (error) => errors.push(error.message));
      const aliceEmail = await game.register(alice, 'Alice');
      const bobEmail = await game.register(bob, 'Bob');
      const aliceSession = sessionResponseSchema.parse(
        await (
          await alice.request.get(`${game.url}/api/auth/get-session`)
        ).json(),
      );
      const bobSession = sessionResponseSchema.parse(
        await (
          await bob.request.get(`${game.url}/api/auth/get-session`)
        ).json(),
      );
      if (!aliceSession || !bobSession)
        throw new Error('Player sessions missing');
      await alice
        .getByRole('button', { name: 'Create a room', exact: true })
        .click();
      await expect(alice.locator('.room-code')).toBeVisible();
      await alice.locator('.room-controls summary').click();
      const topic = alice.getByRole('combobox', { name: 'Game topic' });
      await expect(topic).toHaveValue('league-of-legends');
      await expect(topic.locator('option')).toHaveCount(1);
      await expect(topic.locator('option')).toHaveText('League of Legends');
      const topicBounds = await topic.boundingBox();
      expect(topicBounds?.width).toBeGreaterThan(250);
      await topic.selectOption('league-of-legends');
      await alice
        .getByRole('button', { name: 'Save game settings', exact: true })
        .click();
      const code = await alice.locator('.room-code').innerText();
      await bob.getByLabel('Room code', { exact: true }).fill(code);
      await bob.getByRole('button', { name: 'Join room', exact: true }).click();
      await expect(alice.locator('.participant-list > li')).toHaveCount(2);
      await expect(bob.locator('.room-settings')).toContainText(
        'League of Legends',
      );
      await topic.focus();
      await alice.screenshot({
        path: testInfo.outputPath('lobby-topic-mobile.png'),
        fullPage: true,
        animations: 'disabled',
      });
      const mirror = await aliceContext.newPage();
      mirror.on('pageerror', (error) => errors.push(error.message));
      await mirror.goto(`${game.url}/game`);
      await expect(mirror.locator('.room-code')).toHaveText(code);
      await alice
        .getByRole('button', { name: 'I’m ready', exact: true })
        .click();
      await bob.getByRole('button', { name: 'I’m ready', exact: true }).click();
      await expect(
        alice.getByText('Game starts in', { exact: true }),
      ).toBeVisible();
      await game.advance(5000);
      await alice
        .getByRole('button', { name: 'Choose Category c1', exact: true })
        .click();
      await expect(bob.locator('.category-name')).toHaveText('Category c1');
      await expect(
        mirror.getByText('Private question 1', { exact: true }),
      ).toHaveCount(0);
      for (let number = 1; number <= 5; number++) {
        await expect(
          alice.getByRole('heading', { name: 'Get ready' }),
        ).toBeVisible();
        await game.advance(3000);
        await expect(
          alice.getByRole('heading', {
            name: `Private question ${number}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          bob.getByRole('heading', {
            name: `Private question ${number}`,
            exact: true,
          }),
        ).toBeVisible();
        if (number === 2) {
          await alice.screenshot({
            path: testInfo.outputPath('question-mobile.png'),
            fullPage: true,
          });
          await bob.screenshot({
            path: testInfo.outputPath('question-desktop.png'),
            fullPage: true,
          });
        }
        if (number === 3) {
          await aliceContext.setOffline(true);
          await expect(
            alice.getByText('Connection lost. Reconnecting…', { exact: true }),
          ).toBeVisible();
          await aliceContext.setOffline(false);
          await expect(
            alice.getByRole('button', { name: 'Option a', exact: true }),
          ).toBeEnabled();
        }
        if (number === 5) {
          await game.database.db
            .update(session)
            .set({ expiresAt: new Date(0) })
            .where(
              inArray(session.userId, [
                aliceSession.user.userId,
                bobSession.user.userId,
              ]),
            );
          for (const page of [alice, bob]) {
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await expect(
              page.getByText(
                'Your session has expired. You can finish this game; sign in again before your next one.',
                { exact: true },
              ),
            ).toBeVisible();
          }
        }
        await answer(alice, ['a']);
        await expect(
          mirror.getByText('Answer locked on every device', { exact: true }),
        ).toBeVisible();
        if (number === 2) {
          await expect(
            mirror.getByRole('checkbox', { name: 'Option a', exact: true }),
          ).toBeChecked();
          await expect(
            mirror.getByRole('checkbox', { name: 'Option b', exact: true }),
          ).toBeDisabled();
        } else {
          await expect(
            mirror.getByRole('button', { name: 'Option a', exact: true }),
          ).toHaveAttribute('aria-pressed', 'true');
          await expect(
            mirror.getByRole('button', { name: 'Option b', exact: true }),
          ).toBeDisabled();
        }
        await answer(bob, number === 2 ? ['a', 'b'] : ['a']);
        await expect(alice.locator('.evaluation-summary')).toContainText(
          number === 2 ? '1 of 2 correct' : 'Correct',
        );
        await expect(bob.locator('.evaluation-summary')).toContainText(
          'Correct',
        );
        await game.advance(5000);
      }
      await expect(
        alice.getByRole('heading', { name: 'Game complete' }),
      ).toBeVisible();
      await game.service.persistenceIdle();
      await expect(
        alice.getByText('Results saved to your history.', { exact: true }),
      ).toBeVisible();
      await expect(alice.locator('.standings tbody tr')).toHaveCount(2);
      await game.advance(15000);
      await expect(
        alice.getByRole('heading', { name: 'Your room', exact: true }),
      ).toBeVisible();
      await expect(
        alice.getByRole('button', { name: 'I’m ready', exact: true }),
      ).toBeDisabled();
      await expect(
        bob.getByRole('button', { name: 'I’m ready', exact: true }),
      ).toBeDisabled();
      await alice.getByRole('link', { name: 'Sign in', exact: true }).click();
      await alice
        .getByLabel('Email address', { exact: true })
        .first()
        .fill(aliceEmail);
      await alice.getByLabel('Password', { exact: true }).fill('Password1!');
      await alice.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(
        alice.getByRole('heading', { name: 'Your room', exact: true }),
      ).toBeVisible();
      await expect(alice.locator('.room-code')).toHaveText(code);
      await expect(
        alice.getByRole('button', { name: 'I’m ready', exact: true }),
      ).toBeEnabled();
      await leave(alice);
      await expect(
        mirror.getByRole('heading', { name: 'Think fast. Make it count.' }),
      ).toBeVisible();
      await game.advance(60000);
      await expect(
        bob.getByRole('heading', { name: 'Think fast. Make it count.' }),
      ).toBeVisible();
      await expect(
        bob.getByText(
          'Your place was released because sign-in was not renewed.',
          { exact: true },
        ),
      ).toBeVisible();
      await game.signIn(bob, bobEmail);
      await alice.getByRole('link', { name: 'History', exact: true }).click();
      await expect(alice.locator('.history-list > li')).toHaveCount(1);
      await alice.locator('.history-list a').click();
      await expect(alice.locator('.question-results > li')).toHaveCount(5);
      await bob.getByRole('link', { name: 'Profile', exact: true }).click();
      await bob
        .getByRole('button', { name: 'Delete account', exact: true })
        .click();
      await bob
        .getByRole('dialog')
        .getByLabel('Current password', { exact: true })
        .fill('Password1!');
      await bob
        .getByRole('button', { name: 'Delete permanently', exact: true })
        .click();
      await expect(
        bob.getByText('Your account has been deleted.', { exact: true }),
      ).toBeVisible();
      await alice.reload();
      await expect(alice.locator('.standings')).toContainText('Deleted user');
      await expect(alice.locator('.standings')).toContainText('Alice');
      expect(await game.database.db.select().from(gameTable)).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });
});

async function answer(page: Page, options: readonly string[]) {
  const single = page.getByRole('button', {
    name: `Option ${options[0]}`,
    exact: true,
  });
  if (await single.count()) {
    expect(options).toHaveLength(1);
    await expect(
      page.getByRole('button', { name: 'Lock in answer' }),
    ).toHaveCount(0);
    await single.click();
    return;
  }
  for (const option of options)
    await page.getByLabel(`Option ${option}`, { exact: true }).check();
  await page.getByRole('button', { name: 'Lock in answer' }).click();
}
async function leave(page: Page) {
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Leave', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Think fast. Make it count.' }),
  ).toBeVisible();
}
