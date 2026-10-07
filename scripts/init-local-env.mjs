import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const target = new URL('.env', root);
if (existsSync(target)) {
  console.log('Existing .env preserved.');
} else {
  const password = randomBytes(32).toString('hex');
  const browser = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : '';
  const contents = readFileSync(new URL('.env.example', root), 'utf8')
    .replace('GENERATE_LOCAL_PASSWORD', password)
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
