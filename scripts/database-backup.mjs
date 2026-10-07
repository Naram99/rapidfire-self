import { spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL('../backups/', import.meta.url);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const name = `rapidfire_${new Date().toISOString().replaceAll(':', '-')}.dump`;
const target = new URL(name, directory);
const partial = new URL(`${name}.partial`, directory);
const descriptor = openSync(partial, 'wx', 0o600);
const child = spawn(
  'docker',
  [
    'compose',
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges',
  ],
  {
    cwd: root,
    stdio: ['ignore', descriptor, 'inherit'],
  },
);
let completed = false;
function finish(success) {
  if (completed) return;
  completed = true;
  closeSync(descriptor);
  if (success) {
    renameSync(partial, target);
    console.log(`Backup saved to backups/${name}. Keep it private.`);
  } else {
    unlinkSync(partial);
    console.error('Backup failed. Is PostgreSQL running?');
    process.exitCode = 1;
  }
}
child.once('error', () => finish(false));
child.once('exit', (code) => finish(code === 0));
