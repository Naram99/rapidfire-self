import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { and, eq, sql } from 'drizzle-orm';
import { parseQuestionBatch } from '@rapidfire/game-engine';
import type { Database } from '../database/client.js';
import {
  lolSourcePayload,
  questionCatalog,
  questionDataset,
  questionGenerationRelease,
  questionTemplateManifest,
} from '../database/lol-schema.js';
import {
  hashJson,
  jsonObject,
  normalizeFull,
  normalizeSummary,
  datasetHash,
} from '../lol-data/normalize.js';
import {
  LOL_LOCALE,
  LOL_TOPIC,
  NORMALIZATION_VERSION,
  LolImportError,
} from '../lol-data/model.js';
import { compileCatalog, manifest } from './catalog.js';
import type { JsonObject } from '../lol-data/model.js';
import type { CompiledCatalog } from './catalog.js';
import { QuestionPlan } from './generate.js';
import { compareReleases, GeneratedQuestions } from './provider.js';
import {
  GENERATOR_VERSION,
  SEED_VERSION,
  PRNG_VERSION,
  seededStreams,
} from './streams.js';

type ReleaseRow = typeof questionGenerationRelease.$inferSelect;
export class GenerationReleases {
  readonly questions = new GeneratedQuestions();
  private readonly known = new Set<string>();
  private loading: Promise<void> | null = null;
  private readonly compiled = new Map<string, CompiledCatalog>();
  private readonly manifestContent: JsonObject;
  private readonly manifestHash: string;
  constructor(
    private readonly db: Database,
    sourceManifest: unknown = manifest,
  ) {
    this.manifestContent = jsonObject(sourceManifest);
    this.manifestHash = hashJson(this.manifestContent);
  }
  private async dataset(
    id: string,
    sourceManifest: JsonObject = this.manifestContent,
  ) {
    const [row] = await this.db
      .select()
      .from(questionDataset)
      .where(eq(questionDataset.id, id));
    if (
      !row ||
      row.status !== 'ready' ||
      !row.contentHash ||
      row.topicId !== LOL_TOPIC ||
      row.locale !== LOL_LOCALE ||
      row.normalizationVersion !== NORMALIZATION_VERSION
    )
      throw new Error('DATASET_UNAVAILABLE');
    const cacheKey = id + ':' + hashJson(sourceManifest);
    let catalog = this.compiled.get(cacheKey);
    if (!catalog) {
      const payloads = await this.db
        .select()
        .from(lolSourcePayload)
        .where(eq(lolSourcePayload.datasetId, id));
      const summary = payloads.find((p) =>
        p.sourcePath.endsWith('/champion.json'),
      );
      const full = payloads.find((p) =>
        p.sourcePath.endsWith('/championFull.json'),
      );
      if (
        !summary ||
        !full ||
        hashJson(summary.payload) !== summary.sha256 ||
        hashJson(full.payload) !== full.sha256
      )
        throw new Error('DATASET_HASH_MISMATCH');
      const champions = normalizeFull(
        full.payload,
        row.sourceVersion,
        normalizeSummary(summary.payload, row.sourceVersion),
      );
      if (datasetHash(row.sourceVersion, champions) !== row.contentHash)
        throw new Error('DATASET_HASH_MISMATCH');
      catalog = compileCatalog(champions, sourceManifest);
      this.compiled.set(cacheKey, catalog);
    }
    return { row, catalog };
  }
  private hash(
    datasetContentHash: string,
    manifestHash: string = this.manifestHash,
  ): string {
    return hashJson(
      jsonObject({
        topicId: LOL_TOPIC,
        locale: LOL_LOCALE,
        language: 'en',
        datasetContentHash,
        manifestHash,
        normalizationVersion: NORMALIZATION_VERSION,
        generatorVersion: GENERATOR_VERSION,
        seedVersion: SEED_VERSION,
        prngVersion: PRNG_VERSION,
      }),
    );
  }
  private register(row: ReleaseRow, catalog: CompiledCatalog): void {
    if (
      row.categoryCount !== catalog.variants.length ||
      !catalog.variants.length
    )
      throw new Error('RELEASE_CAPACITY_MISMATCH');
    this.questions.add({
      hash: row.contentHash,
      catalog,
      public: {
        id: row.id,
        topicId: LOL_TOPIC,
        sourceVersion: row.sourceVersion,
        revision: row.revision,
        label:
          row.sourceVersion + (row.revision === 1 ? '' : ` · r${row.revision}`),
        categoryCount: row.categoryCount,
        maxRounds: Math.min(10, row.categoryCount),
      },
    });
    this.known.add(row.id);
  }
  load(): Promise<void> {
    if (this.loading) return this.loading;
    const task = this.loadUncached().finally(() => {
      if (this.loading === task) this.loading = null;
    });
    this.loading = task;
    return task;
  }
  private async loadUncached(): Promise<void> {
    const releases = await this.db.select().from(questionGenerationRelease);
    for (const release of releases) {
      if (this.known.has(release.id)) continue;
      try {
        if (
          release.topicId !== LOL_TOPIC ||
          release.generatorVersion !== GENERATOR_VERSION ||
          release.seedVersion !== SEED_VERSION ||
          release.prngVersion !== PRNG_VERSION ||
          release.locale !== LOL_LOCALE ||
          release.language !== 'en'
        )
          continue;
        const [template] = await this.db
          .select()
          .from(questionTemplateManifest)
          .where(eq(questionTemplateManifest.id, release.manifestId));
        if (!template || hashJson(template.content) !== template.contentHash)
          continue;
        const { row, catalog } = await this.dataset(
          release.datasetId,
          template.content,
        );
        if (
          row.sourceVersion !== release.sourceVersion ||
          !row.contentHash ||
          this.hash(row.contentHash, template.contentHash) !==
            release.contentHash
        )
          throw new Error('RELEASE_HASH_MISMATCH');
        this.register(release, catalog);
      } catch {
        console.warn('GENERATION_RELEASE_UNAVAILABLE', release.id);
      }
    }
  }
  async publish(datasetId: string, signal?: AbortSignal): Promise<void> {
    try {
      const { row: dataset, catalog } = await this.dataset(datasetId);
      if (!dataset.contentHash || !catalog.variants.length)
        throw new Error('NO_PLAYABLE_CATEGORIES');
      const contentHash = this.hash(dataset.contentHash);
      const [existing] = await this.db
        .select()
        .from(questionGenerationRelease)
        .where(eq(questionGenerationRelease.contentHash, contentHash));
      if (existing) {
        this.register(existing, catalog);
        return;
      }
      const seeds = [
        'A',
        'a',
        '001',
        '1',
        'Ab1',
        'ab1',
        '0123456789',
        ...Array.from({ length: 200 }, (_, i) => `Check${i}`),
      ];
      for (const seed of seeds) {
        signal?.throwIfAborted();
        const plan = new QuestionPlan(
          catalog,
          seededStreams(seed, contentHash),
        );
        for (const variant of catalog.variants) {
          const pack = plan.pack(variant.id);
          if (
            !parseQuestionBatch(pack, variant.id) ||
            new Set(pack.map((q) => q.text)).size !== 5
          )
            throw new Error('GENERATION_VALIDATION_FAILED');
        }
        // Publication is background work; socket timers and HTTP requests can proceed.
        await setImmediate();
      }
      signal?.throwIfAborted();
      const published = await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('rapidfire-generation-publication', 0))`,
        );
        const [duplicate] = await tx
          .select()
          .from(questionGenerationRelease)
          .where(eq(questionGenerationRelease.contentHash, contentHash));
        if (duplicate) return duplicate;
        await tx
          .insert(questionTemplateManifest)
          .values({
            id: randomUUID(),
            schemaVersion: 1,
            language: 'en',
            contentHash: this.manifestHash,
            content: this.manifestContent,
          })
          .onConflictDoNothing();
        const [template] = await tx
          .select()
          .from(questionTemplateManifest)
          .where(eq(questionTemplateManifest.contentHash, this.manifestHash));
        if (!template) throw new Error('MANIFEST_WRITE_FAILED');
        const previous = await tx
          .select()
          .from(questionGenerationRelease)
          .where(
            and(
              eq(questionGenerationRelease.topicId, LOL_TOPIC),
              eq(questionGenerationRelease.locale, LOL_LOCALE),
              eq(questionGenerationRelease.language, 'en'),
            ),
          );
        const revision =
          Math.max(
            0,
            ...previous
              .filter((r) => r.sourceVersion === dataset.sourceVersion)
              .map((r) => r.revision),
          ) + 1;
        const [release] = await tx
          .insert(questionGenerationRelease)
          .values({
            id: randomUUID(),
            topicId: LOL_TOPIC,
            locale: LOL_LOCALE,
            language: 'en',
            sourceVersion: dataset.sourceVersion,
            revision,
            datasetId,
            manifestId: template.id,
            generatorVersion: GENERATOR_VERSION,
            seedVersion: SEED_VERSION,
            prngVersion: PRNG_VERSION,
            contentHash,
            categoryCount: catalog.variants.length,
          })
          .returning();
        if (!release) throw new Error('RELEASE_WRITE_FAILED');
        const newest = [...previous, release].sort((a, b) =>
          compareReleases(b, a),
        )[0];
        if (!newest) throw new Error('RELEASE_WRITE_FAILED');
        await tx
          .update(questionCatalog)
          .set({ defaultReleaseId: newest.id, updatedAt: new Date() })
          .where(
            and(
              eq(questionCatalog.topicId, LOL_TOPIC),
              eq(questionCatalog.locale, LOL_LOCALE),
            ),
          );
        return release;
      });
      this.register(published, catalog);
    } catch (error) {
      if (signal?.aborted) throw new LolImportError('IMPORT_ABORTED');
      if (error instanceof LolImportError) throw error;
      throw new LolImportError('GENERATION_CHECK_FAILED');
    }
  }
}
