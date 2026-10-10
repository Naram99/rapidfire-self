import { randomUUID } from 'node:crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { LolImporter } from '../src/lol-data/importer.js';
import { LolRepository } from '../src/lol-data/repository.js';
import { LolImportError } from '../src/lol-data/model.js';
import { user } from '../src/database/auth-schema.js';
import {
  appAdmin,
  lolChampion,
  lolChampionStats,
  lolImportRun,
  lolSkin,
  lolSourcePayload,
  lolSpell,
  questionDataset,
} from '../src/database/lol-schema.js';
import {
  fixtureSource,
  fullLolFixture,
  smallLolFixture,
  version,
} from './lol-fixture.js';
import { isolatedDatabase } from './isolated-database.js';
import { authHarness, CookieJar } from './auth-helpers.js';

async function admin(
  repository: LolRepository,
  database: Awaited<ReturnType<typeof isolatedDatabase>>,
) {
  const id = randomUUID();
  await database.db.insert(user).values({
    id,
    name: 'Admin',
    email: `${id}@example.com`,
    emailVerified: true,
  });
  await repository.setAdmin(id, true);
  return id;
}
test('imports the full snapshot into PostgreSQL with exact values, all rows and approved eligibility', async () => {
  const database = await isolatedDatabase(),
    repository = new LolRepository(database.db);
  const importer = new LolImporter(repository, fixtureSource(fullLolFixture()));
  try {
    const id = await admin(repository, database);
    const run = await importer.start(id, 'latest');
    await importer.idle();
    expect(await repository.run(run.id)).toMatchObject({
      status: 'succeeded',
      processedChampions: 173,
      totalChampions: 173,
    });
    const active = await repository.activeDataset();
    expect(active?.counts).toMatchObject({
      champions: 173,
      skins: 1959,
      chromas: 7075,
      spells: 692,
      unverifiedChromaSkins: 6,
      excludedCooldownSpells: 20,
    });
    expect(
      (await database.db.select({ count: count() }).from(lolSkin))[0]?.count,
    ).toBe(9207);
    expect(
      (await database.db.select({ count: count() }).from(lolSourcePayload))[0]
        ?.count,
    ).toBe(2);
    const [aatrox] = await database.db
      .select()
      .from(lolChampion)
      .where(eq(lolChampion.sourceId, 'Aatrox'));
    if (!aatrox) throw new Error('Missing Aatrox');
    expect(
      (
        await database.db
          .select()
          .from(lolChampionStats)
          .where(eq(lolChampionStats.championId, aatrox.id))
      )[0],
    ).toMatchObject({ attackSpeed: '0.651', attackDamagePerLevel: '0' });
    expect(
      (
        await database.db
          .select()
          .from(lolSpell)
          .where(
            and(eq(lolSpell.championId, aatrox.id), eq(lolSpell.slot, 'W')),
          )
      )[0],
    ).toMatchObject({
      cooldownRank1: '18',
      cooldownsByRank: ['18', '16.5', '15', '13.5', '12'],
      damage: {},
    });
    const orphans = await database.db.execute<{ count: string }>(
      sql`SELECT count(*)::text FROM lol_skin child JOIN lol_skin parent ON parent.id = child.parent_skin_id WHERE child.champion_id <> parent.champion_id OR parent.is_chroma`,
    );
    expect(orphans.rows[0]?.count).toBe('0');
    const zeroCooldown = await database.db
      .select({ count: count() })
      .from(lolSpell)
      .where(sql`${lolSpell.cooldownRank1} IS NULL`);
    expect(zeroCooldown[0]?.count).toBe(20);
  } finally {
    await importer.close();
    await database.close();
  }
}, 30000);

test('deduplicates concurrent starts and identical reimports, preserves previous datasets on failure/restart', async () => {
  const database = await isolatedDatabase(),
    repository = new LolRepository(database.db);
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = smallLolFixture(),
    source = fixtureSource(fixture);
  let mode: 'ok' | 'fail' | 'changed' = 'ok';
  const importer = new LolImporter(repository, {
    ...source,
    latest: async () => {
      await blocked;
      return version;
    },
    full: async (version, signal) => {
      if (mode === 'fail') throw new LolImportError('SOURCE_UNAVAILABLE');
      if (mode === 'changed')
        fixture.full.data.Aatrox.lore = 'New source content';
      return source.full(version, signal);
    },
  });
  try {
    const id = await admin(repository, database);
    const runs = await Promise.all(
      Array.from({ length: 8 }, () => importer.start(id, 'latest')),
    );
    expect(new Set(runs.map((run) => run.id)).size).toBe(1);
    release?.();
    await importer.idle();
    const first = await repository.activeDataset();
    expect(first).not.toBeNull();
    const normal = await importer.start(id, 'latest');
    await importer.idle();
    expect(await repository.run(normal.id)).toMatchObject({
      status: 'unchanged',
      datasetId: first?.id,
    });
    const same = await importer.start(id, 'reimport');
    await importer.idle();
    expect(await repository.run(same.id)).toMatchObject({
      status: 'unchanged',
      datasetId: first?.id,
    });
    expect(
      (await database.db.select({ count: count() }).from(questionDataset))[0]
        ?.count,
    ).toBe(1);
    mode = 'fail';
    const failed = await importer.start(id, 'reimport');
    await importer.idle();
    expect(await repository.run(failed.id)).toMatchObject({
      status: 'failed',
      errorCode: 'SOURCE_UNAVAILABLE',
    });
    expect((await repository.activeDataset())?.id).toBe(first?.id);
    // A database error rolls the entire current chunk back; the published data stays active.
    await database.db.execute(
      sql`CREATE FUNCTION reject_lol_spell() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected storage failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER reject_lol_spell BEFORE INSERT ON lol_spell FOR EACH ROW EXECUTE FUNCTION reject_lol_spell()`,
    );
    mode = 'ok';
    const storageFailed = await importer.start(id, 'reimport');
    await importer.idle();
    const storageRun = await repository.run(storageFailed.id);
    expect(storageRun).toMatchObject({
      status: 'failed',
      errorCode: 'IMPORT_STORAGE_FAILED',
      processedChampions: 0,
    });
    if (!storageRun?.datasetId)
      throw new Error('Missing failed staging dataset');
    expect(
      await database.db
        .select()
        .from(lolChampion)
        .where(eq(lolChampion.datasetId, storageRun.datasetId)),
    ).toHaveLength(0);
    expect((await repository.activeDataset())?.id).toBe(first?.id);
    await database.db.execute(sql`DROP TRIGGER reject_lol_spell ON lol_spell`);
    await database.db.execute(sql`DROP FUNCTION reject_lol_spell()`);
    mode = 'changed';
    const changed = await importer.start(id, 'reimport');
    await importer.idle();
    const second = await repository.activeDataset();
    expect(second?.id).not.toBe(first?.id);
    expect(second?.contentHash).not.toBe(first?.contentHash);
    expect(await repository.run(changed.id)).toMatchObject({
      status: 'succeeded',
    });
    const pending = await repository.createRun(id, 'latest');
    const staged = await repository.stage(pending.run.id, version, 1, [
      await source.summary(version, new AbortController().signal),
    ]);
    expect(await repository.recover()).toBe(1);
    expect(await repository.run(pending.run.id)).toMatchObject({
      status: 'aborted',
      errorCode: 'IMPORT_ABORTED',
    });
    expect(
      (
        await database.db
          .select()
          .from(questionDataset)
          .where(eq(questionDataset.id, staged))
      )[0]?.status,
    ).toBe('failed');
    expect((await repository.activeDataset())?.id).toBe(second?.id);
    await database.db.delete(user).where(eq(user.id, id));
    expect(await database.db.select().from(appAdmin)).toHaveLength(0);
    expect(
      (await database.db.select().from(lolImportRun)).every(
        (run) => run.requestedByUserId === null,
      ),
    ).toBe(true);
    expect((await repository.activeDataset())?.id).toBe(second?.id);
  } finally {
    release?.();
    await importer.close();
    await database.close();
  }
});

test('HTTP admin access requires a verified normal session, explicit grant and a valid same-origin request', async () => {
  const app = await authHarness(false, fixtureSource());
  const jar = new CookieJar(),
    guest = new CookieJar();
  try {
    expect((await app.request(jar, '/api/admin/lol-data')).status).toBe(401);
    await app.request(guest, '/api/guest/session', { nickname: 'Guest' });
    expect((await app.request(guest, '/api/admin/lol-data')).status).toBe(401);
    const identity = await app.register(jar, 'admin@example.com');
    expect((await app.request(jar, '/api/admin/lol-data')).status).toBe(403);
    await app.lolRepository.setAdmin(identity.person.id, true);
    expect(await (await app.request(jar, '/api/admin/access')).json()).toEqual({
      isAdmin: true,
    });
    expect(
      (
        await app.request(jar, '/api/admin/lol-data/imports', {
          mode: 'latest',
          url: 'https://evil.test',
        })
      ).status,
    ).toBe(400);
    const csrf = await fetch(`${app.url}/api/admin/lol-data/imports`, {
      method: 'POST',
      headers: {
        Cookie: jar.header(),
        Origin: 'https://evil.test',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(csrf.status).toBe(403);
    const started = await app.request(jar, '/api/admin/lol-data/imports', {
      mode: 'latest',
    });
    expect(started.status).toBe(202);
    await app.lolImporter.idle();
    const data = await app.lolRepository.overview();
    expect(data.activeDataset?.counts.champions).toBe(1);
    expect(
      (
        await app.request(
          jar,
          `/api/admin/lol-data/imports/${data.runs[0]?.id}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await app.request(jar, '/api/admin/lol-data/imports/invalid')).status,
    ).toBe(400);
    await app.lolRepository.setAdmin(identity.person.id, false);
    expect((await app.request(jar, '/api/admin/lol-data')).status).toBe(403);
  } finally {
    await app.close();
  }
});
