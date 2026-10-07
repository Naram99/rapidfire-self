import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(
  'docker',
  [
    'compose',
    'exec',
    'postgres',
    'sh',
    '-c',
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
  ],
  {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
  },
);
child.once('error', () => {
  console.error('Cannot start Docker. Is Docker running?');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
