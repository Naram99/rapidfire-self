import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const target = new URL('.env', root);
if (existsSync(target)) {
  const contents = readFileSync(target, 'utf8');
  if (
    !process.env.BETTER_AUTH_SECRET &&
    !/^BETTER_AUTH_SECRET=.+$/m.test(contents)
  ) {
    const secret = randomBytes(32).toString('base64url');
    const updated = /^BETTER_AUTH_SECRET=$/m.test(contents)
      ? contents.replace(
          /^BETTER_AUTH_SECRET=$/m,
          `BETTER_AUTH_SECRET=${secret}`,
        )
      : `${contents.replace(/\s*$/, '')}\nBETTER_AUTH_SECRET=${secret}\n`;
    writeFileSync(target, updated, { mode: 0o600 });
    console.log(
      'Missing local auth secret generated. Existing configuration preserved.',
    );
  } else console.log('Existing .env preserved.');
} else {
  const password = randomBytes(32).toString('hex');
  const browser = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : '';
  const contents = readFileSync(new URL('.env.example', root), 'utf8')
    .replace('GENERATE_LOCAL_PASSWORD', password)
    .replace(
      'BETTER_AUTH_SECRET=',
      `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}`,
    )
    .replace(
      'GENERATE_LOCAL_DATABASE_URL',
      `postgresql://rapidfire:${password}@127.0.0.1:5432/rapidfire`,
    )
    .replace(
      'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=',
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=${browser}`,
    );
  writeFileSync(target, contents, { flag: 'wx', mode: 0o600 });
  console.log(
    `Local configuration created at ${fileURLToPath(target)}. No credential values printed.`,
  );
}
