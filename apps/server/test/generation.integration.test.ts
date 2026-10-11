import { manifest } from '../src/question-generation/catalog.js';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import {
  gameConfigResponseSchema,
  gameResultResponseSchema,
  historyResponseSchema,
} from '@rapidfire/contracts';
import type { Snapshot } from '@rapidfire/contracts';
import { authHarness, CookieJar } from './auth-helpers.js';
import {
  fixtureSource,
  fullLolFixture,
  smallLolFixture,
} from './lol-fixture.js';
import {
  questionDataset,
  questionGenerationRelease,
  questionTemplateManifest,
  lolChampionStats,
} from '../src/database/lol-schema.js';
import { game } from '../src/database/schema.js';
import { LolImporter } from '../src/lol-data/importer.js';
import { GenerationReleases } from '../src/question-generation/releases.js';
import { object } from '../src/lol-data/normalize.js';

test('validated imports automatically publish immutable releases, pin rooms, and save reproducible game metadata', async () => {
  const app = await authHarness(
    true,
    fixtureSource(fullLolFixture()),
    'published',
  );
  try {
    const jar = new CookieJar(),
      access = await app.register(jar, `${randomUUID()}@example.com`);
    const views: Snapshot[] = [];
    await app.service.connect('generation-test', access, (snapshot) =>
      views.push(snapshot),
    );
    const latest = () => {
      const snapshot = views.at(-1);
      if (!snapshot) throw new Error('No snapshot');
      return snapshot;
    };
    let requestId = 0;
    const command = (name: string, payload: Record<string, unknown>) =>
      app.service.handle('generation-test', name, {
        requestId: `r${++requestId}`,
        ...payload,
      });
    const settings = {
      topicId: 'league-of-legends',
      rounds: 1,
      answerTimeMs: 20000,
      releaseId: null,
      seed: null,
    };
    const empty = gameConfigResponseSchema.parse(
      await (await app.request(jar, '/api/game-config')).json(),
    );
    expect(empty.topics[0]).toMatchObject({
      releases: [],
      defaultReleaseId: null,
      maxRounds: 0,
    });
    expect(await command('solo:start', { settings })).toMatchObject({
      ok: false,
      error: { code: 'GENERATION_UNAVAILABLE' },
    });
    await app.lolRepository.setAdmin(access.person.id, true);
    const importResponse = await app.request(
      jar,
      '/api/admin/lol-data/imports',
      { mode: 'latest' },
    );
    expect(importResponse.status).toBe(202);
    await app.lolImporter.idle();
    const config = gameConfigResponseSchema.parse(
      await (await app.request(jar, '/api/game-config')).json(),
    );
    const release = config.topics[0]?.releases[0];
    if (!release) throw new Error('Publication failed');
    expect(release).toMatchObject({
      label: '16.20.1',
      revision: 1,
      categoryCount: 26,
      maxRounds: 10,
    });
    expect(
      await command('solo:start', {
        settings: { ...settings, releaseId: randomUUID() },
      }),
    ).toMatchObject({ ok: false, error: { code: 'RELEASE_UNAVAILABLE' } });
    expect((await command('solo:start', { settings })).ok).toBe(true);
    expect(latest().match?.generation).toMatchObject({
      releaseId: release.id,
      seed: null,
      seedOrigin: 'automatic',
      eloExclusionReason: null,
    });
    await app.advance(5000);
    const selection = latest().phase;
    if (selection.type !== 'category_selection')
      throw new Error('No category selection');
    const selected = selection.offeredCategories[0];
    if (!selected) throw new Error('No category');
    await command('category:select', {
      matchId: latest().match?.id,
      phaseId: selection.id,
      roundId: selection.roundId,
      categoryId: selected.id,
    });
    await app.settle();
    expect(latest().phase.type).toBe('question_countdown');
    expect(JSON.stringify(latest())).not.toContain('correctOptionIds');
    await app.service.persistenceIdle();
    const matchId = latest().match?.id;
    if (!matchId) throw new Error('No match');
    const inProgress = await (
      await app.request(jar, `/api/games/${matchId}`)
    ).json();
    expect(
      gameResultResponseSchema.parse(inProgress).game.generation?.seed,
    ).toBeNull();
    expect(JSON.stringify(inProgress)).not.toContain('generationSeed');
    for (let q = 0; q < 5; q++) {
      await app.advance(3000);
      await app.advance(20000);
      await app.advance(5000);
    }
    expect(latest().phase.type).toBe('finished');
    const finalSeed = latest().match?.generation?.seed;
    expect(finalSeed).toMatch(/^[A-Za-z0-9]{10}$/);
    await app.service.persistenceIdle();
    const result = gameResultResponseSchema.parse(
      await (await app.request(jar, `/api/games/${matchId}`)).json(),
    );
    expect(result.game.generation?.seed).toBe(finalSeed);
    expect(result.rounds).toMatchObject([
      { roundNumber: 1, categoryId: selected.id },
    ]);
    expect(result.rounds[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const history = historyResponseSchema.parse(
      await (await app.request(jar, '/api/games')).json(),
    );
    expect(history.games[0]?.generation?.seed).toBe(finalSeed);
    const stored = (
      await app.database.db.select().from(game).where(eq(game.id, matchId))
    )[0];
    expect(stored).toMatchObject({
      generationReleaseId: release.id,
      generationSeed: finalSeed,
      seedOrigin: 'automatic',
      eloExclusionReason: null,
    });
    await app.advance(15000);
    expect((await command('room:create', { settings })).ok).toBe(true);
    const originalRoom = latest().room;
    if (!originalRoom) throw new Error('No room');
    expect(originalRoom.settings.releaseId).toBe(release.id);
    expect(
      (
        await command('room:ready', {
          roomId: originalRoom.id,
          lobbyCycleId: originalRoom.lobbyCycleId,
          ready: true,
        })
      ).ok,
    ).toBe(true);
    expect(latest().phase.type).toBe('start_countdown');
    expect(
      (
        await command('room:settings:update', {
          roomId: originalRoom.id,
          expectedSettingsVersion: originalRoom.settingsVersion,
          settings: { ...originalRoom.settings, seed: '001Ab' },
        })
      ).ok,
    ).toBe(true);
    expect(latest().room?.members.every((m) => !m.ready)).toBe(true);
    expect(latest().phase.type).toBe('lobby');

    const fixture = fullLolFixture();
    const modified = structuredClone(fixture);
    object(object(object(modified.summary).data).Aatrox).title =
      'the Revised Darkin Blade';
    object(object(object(modified.full).data).Aatrox).title =
      'the Revised Darkin Blade';
    const reimporter = new LolImporter(
      app.lolRepository,
      fixtureSource(modified),
      (id, signal) => app.generationReleases.publish(id, signal),
    );
    const rerun = await reimporter.start(access.person.id, 'reimport');
    await reimporter.idle();
    expect(await app.lolRepository.run(rerun.id)).toMatchObject({
      status: 'succeeded',
    });
    const next = app.generationReleases.questions.releases()[0];
    expect(next).toMatchObject({ revision: 2, label: '16.20.1 · r2' });
    expect(next?.id).not.toBe(release.id);
    expect(latest().room?.settings.releaseId).toBe(release.id);
    const restored = new GenerationReleases(app.database.db);
    await restored.load();
    expect(restored.questions.releases().map((r) => r.id)).toEqual(
      app.generationReleases.questions.releases().map((r) => r.id),
    );
    const selectedSettings = { ...originalRoom.settings, seed: '001Ab' };
    const first =
        app.generationReleases.questions.createGeneration(selectedSettings),
      replay = restored.questions.createGeneration(selectedSettings);
    expect(replay.prepare(selected.id)).toEqual(first.prepare(selected.id));
    expect(first.metadata).toMatchObject({
      seedOrigin: 'custom',
      eloExclusionReason: 'custom_seed',
    });
    const revisedManifest = structuredClone(manifest);
    revisedManifest.texts['questions.title.identify'] =
      'Which champion owns the title “{{clue}}”?';
    const changedTemplates = new GenerationReleases(
      app.database.db,
      revisedManifest,
    );
    const activeDataset = await app.lolRepository.activeDataset();
    if (!activeDataset) throw new Error('No active dataset');
    await changedTemplates.publish(activeDataset.id);
    expect(changedTemplates.questions.releases()[0]).toMatchObject({
      revision: 3,
    });
    const afterTemplateRevision = new GenerationReleases(app.database.db);
    await afterTemplateRevision.load();
    expect(afterTemplateRevision.questions.releases()).toHaveLength(3);
    const oldTitle = afterTemplateRevision.questions
      .createGeneration(selectedSettings)
      .prepare('league-of-legends:title:easy');
    expect(oldTitle[0]?.text).toContain('has the title');
    const newId = changedTemplates.questions.defaultReleaseId();
    const newTitle = afterTemplateRevision.questions
      .createGeneration({ ...selectedSettings, releaseId: newId })
      .prepare('league-of-legends:title:easy');
    expect(newTitle[0]?.text).toContain('owns the title');
    await app.generationReleases.load();
    const defaultBeforeFailure =
      app.generationReleases.questions.defaultReleaseId();
    const insufficient = smallLolFixture();
    const onlyChampion = object(object(insufficient.full.data).Aatrox);
    if (
      !Array.isArray(onlyChampion.skins) ||
      !Array.isArray(onlyChampion.spells)
    )
      throw new Error('Invalid small fixture');
    onlyChampion.skins = onlyChampion.skins.filter(
      (skin: unknown) => object(skin).num === 0,
    );
    for (const value of onlyChampion.spells) {
      const spell = object(value);
      if (!Array.isArray(spell.cooldown)) throw new Error('No cooldown');
      spell.cooldown = spell.cooldown.map(() => 0);
    }
    const broken = new LolImporter(
      app.lolRepository,
      fixtureSource(insufficient),
      (id, signal) => app.generationReleases.publish(id, signal),
    );
    const failure = await broken.start(access.person.id, 'reimport');
    await broken.idle();
    expect(await app.lolRepository.run(failure.id)).toMatchObject({
      status: 'failed',
      errorCode: 'GENERATION_CHECK_FAILED',
    });
    expect(app.generationReleases.questions.defaultReleaseId()).toBe(
      defaultBeforeFailure,
    );
    const [published] = await app.database.db
      .select()
      .from(questionGenerationRelease)
      .where(eq(questionGenerationRelease.id, release.id));
    if (!published) throw new Error('Missing release');
    await expect(
      app.database.db
        .update(questionGenerationRelease)
        .set({ revision: 99 })
        .where(eq(questionGenerationRelease.id, release.id)),
    ).rejects.toThrow();
    await expect(
      app.database.db
        .delete(questionDataset)
        .where(eq(questionDataset.id, published.datasetId)),
    ).rejects.toThrow();
    await expect(
      app.database.db
        .update(questionTemplateManifest)
        .set({ language: 'hu' })
        .where(eq(questionTemplateManifest.id, published.manifestId)),
    ).rejects.toThrow();
    await expect(
      app.database.db.update(lolChampionStats).set({ hp: '1' }),
    ).rejects.toThrow();
    await reimporter.close();
    await broken.close();
  } finally {
    await app.close();
  }
}, 60000);
