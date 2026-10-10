import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { user } from '../src/database/auth-schema.js';
import { LolRepository } from '../src/lol-data/repository.js';
import { fileSource } from '../src/lol-data/file-source.js';
import { isolatedDatabase } from './isolated-database.js';
import { smallLolFixture } from './lol-fixture.js';
const execute = promisify(execFile);

test('documented root admin and file-import commands operate only on the selected isolated database', async () => {
  const database = await isolatedDatabase(),
    repository = new LolRepository(database.db);
  const directory = await mkdtemp(join(tmpdir(), 'rapidfire-lol-cli-'));
  const userId = randomUUID();
  try {
    await database.db.insert(user).values({
      id: userId,
      name: 'CLI admin',
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    const current = await database.db.execute<{ name: string }>(
      sql`SELECT current_database() AS name`,
    );
    const name = current.rows[0]?.name,
      baseUrl = process.env.DATABASE_URL;
    if (!name || !baseUrl || !name.startsWith('rapidfire_m3_test_'))
      throw new Error('Missing isolated database');
    const url = new URL(baseUrl);
    url.pathname = `/${name}`;
    const options = {
      env: { ...process.env, DATABASE_URL: url.href },
      maxBuffer: 16384,
      timeout: 20000,
    };
    await execute(
      'npm',
      ['run', 'admin:access', '--', 'grant', userId],
      options,
    );
    expect(await repository.isAdmin(userId)).toBe(true);
    const fixture = smallLolFixture();
    await writeFile(
      join(directory, 'champion.json'),
      JSON.stringify(fixture.summary),
    );
    await writeFile(
      join(directory, 'championFull.json'),
      JSON.stringify(fixture.full),
    );
    const imported = await execute(
      'npm',
      ['run', 'lol:import-files', '--', userId, directory],
      options,
    );
    expect(imported.stdout).toContain('succeeded');
    expect((await repository.activeDataset())?.counts).toMatchObject({
      champions: 1,
      skins: 12,
      chromas: 28,
    });
    const again = await execute(
      'npm',
      ['run', 'lol:import-files', '--', userId, directory, 'reimport'],
      options,
    );
    expect(again.stdout).toContain('unchanged');
    await execute(
      'npm',
      ['run', 'admin:access', '--', 'revoke', userId],
      options,
    );
    expect(await repository.isAdmin(userId)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await database.close();
  }
}, 30000);

test('local file source reports source failures, invalid JSON and aborted reads accurately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rapidfire-lol-files-'));
  const source = fileSource(directory),
    controller = new AbortController();
  try {
    await expect(source.latest(controller.signal)).rejects.toThrow(
      'SOURCE_UNAVAILABLE',
    );
    await writeFile(join(directory, 'champion.json'), 'invalid json');
    await expect(source.latest(controller.signal)).rejects.toThrow(
      'SOURCE_DATA_INVALID',
    );
    controller.abort();
    await expect(source.latest(controller.signal)).rejects.toThrow(
      'IMPORT_ABORTED',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
