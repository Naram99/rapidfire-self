import { PASSWORD_RESET_REQUEST_MESSAGE } from '@rapidfire/contracts';
import { test, expect } from './game-fixture.js';

test('registration, nickname changes, neutral recovery and password replacement work on every device', async ({
  browser,
  page,
  game,
}) => {
  test.setTimeout(90000);
  const email = await game.register(page, 'Before edit');
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Nickname', { exact: true }).fill('After edit');
  await page
    .getByRole('button', { name: 'Save nickname', exact: true })
    .click();
  await expect(
    page.getByText('Nickname updated.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Nickname', { exact: true })).toHaveValue(
    'After edit',
  );
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await game.signIn(second, email);
    await page.goto(`${game.url}/forgot-password`);
    await page
      .getByLabel('Email address', { exact: true })
      .fill('unknown@example.com');
    await page
      .getByRole('button', { name: 'Send recovery link', exact: true })
      .click();
    await expect(
      page.getByText(PASSWORD_RESET_REQUEST_MESSAGE, { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page
      .getByRole('button', { name: 'Send recovery link', exact: true })
      .click();
    await expect
      .poll(
        () =>
          game.messages.filter(
            (message) =>
              message.to === email && message.subject.includes('Reset'),
          ).length,
      )
      .toBe(1);
    await second
      .getByRole('button', { name: 'Create a room', exact: true })
      .click();
    await expect(
      second.getByRole('heading', { name: 'Your room', exact: true }),
    ).toBeVisible();
    await page.goto(game.emailLink(email, 'Reset'));
    await expect(
      page.getByRole('heading', { name: 'Choose a new password', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    await page
      .getByLabel('New password', { exact: true })
      .fill('Replacement2!');
    await page
      .getByLabel('Confirm password', { exact: true })
      .fill('Wrong confirmation');
    await page
      .getByRole('button', { name: 'Save new password', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'Check the highlighted fields.',
    );
    await page
      .getByLabel('Confirm password', { exact: true })
      .fill('Replacement2!');
    await page
      .getByRole('button', { name: 'Save new password', exact: true })
      .click();
    await expect(
      page.getByText('Password updated. Sign in with your new password.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      second.getByRole('heading', { name: 'Think fast. Make it count.' }),
    ).toBeVisible();
    await game.signIn(page, email, 'Replacement2!');
    await expect(
      page.getByRole('link', { name: 'Profile', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Sign out everywhere', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Profile', exact: true }),
    ).toHaveCount(0);
    await page.goto(`${game.url}/verify-email`);
    await expect(
      page.getByText(
        'This verification link is invalid or has expired. Request a new email.',
        { exact: true },
      ),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test('layout, keyboard focus, reduced motion and validation remain usable across screen sizes and themes', async ({
  page,
  game,
}) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 812, height: 375 },
      { width: 768, height: 1024 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto(`${game.url}/sign-up`);
      await expect(
        page.getByRole('heading', { name: 'Create an account', exact: true }),
      ).toBeVisible();
      const linkColors = await page
        .getByRole('link', { name: 'Back to play', exact: true })
        .evaluate((node) => ({
          color: getComputedStyle(node).color,
          background: getComputedStyle(document.documentElement)
            .backgroundColor,
        }));
      const actionColors = await page
        .getByRole('button', { name: 'Create an account', exact: true })
        .evaluate((node) => ({
          color: getComputedStyle(node).color,
          background: getComputedStyle(node).backgroundColor,
        }));
      expect(contrast(linkColors)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(actionColors)).toBeGreaterThanOrEqual(4.5);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .getByRole('button', { name: 'Create an account', exact: true })
          .evaluate((node) => node.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await page
          .getByRole('button', { name: 'Create an account', exact: true })
          .evaluate((node) => getComputedStyle(node).transitionDuration),
      ).toBe('0s');
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Create an account', exact: true })
    .click();
  await expect(page.getByRole('alert')).toBeFocused();
  await page.getByLabel('Nickname', { exact: true }).fill('Keyboard player');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('keyboard@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password1!');
  await page
    .getByRole('button', { name: 'Show password', exact: true })
    .first()
    .click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByLabel('Confirm password', { exact: true }).fill('Password1!');
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(
      () =>
        getComputedStyle(document.activeElement ?? document.body).outlineStyle,
    ),
  ).toBe('solid');
});

function contrast(
  colors: Readonly<{ color: string; background: string }>,
): number {
  function luminance(color: string): number {
    if (!/^rgba?\(/.test(color))
      throw new Error('Expected an sRGB contrast sample');
    const components = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const weights = [0.2126, 0.7152, 0.0722];
    return components.reduce((sum, component, index) => {
      const value = component / 255;
      const linear =
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return sum + linear * (weights[index] ?? 0);
    }, 0);
  }
  const foreground = luminance(colors.color),
    background = luminance(colors.background);
  return (
    (Math.max(foreground, background) + 0.05) /
    (Math.min(foreground, background) + 0.05)
  );
}
