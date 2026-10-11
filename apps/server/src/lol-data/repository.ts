import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { lolImportRunSchema, lolDatasetSchema } from '@rapidfire/contracts';
import type {
  LolCounts,
  LolDatasetView,
  LolImportErrorCode,
  LolImportRunView,
} from '@rapidfire/contracts';
import type { Database } from '../database/client.js';
import {
  appAdmin,
  lolChampion,
  lolChampionStats,
  lolChampionTag,
  lolImportRun,
  lolPassive,
  lolSkin,
  lolSourcePayload,
  lolSpell,
  questionCatalog,
  questionDataset,
} from '../database/lol-schema.js';
import { user } from '../database/auth-schema.js';
import {
  LOL_LOCALE,
  LOL_TOPIC,
  NORMALIZATION_VERSION,
  LolImportError,
} from './model.js';
import type { NormalizedChampion, SourceDocument } from './model.js';
import { hashJson, jsonObject } from './normalize.js';

const activeStatus = ['queued', 'running'] as const;
export class LolRepository {
  constructor(private readonly db: Database) {}
  async isAdmin(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: appAdmin.userId })
      .from(appAdmin)
      .innerJoin(user, eq(user.id, appAdmin.userId))
      .where(and(eq(appAdmin.userId, userId), eq(user.emailVerified, true)));
    return Boolean(row);
  }
  async setAdmin(userId: string, grant: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select()
        .from(user)
        .where(eq(user.id, userId))
        .for('update');
      if (!identity?.emailVerified)
        throw new Error('A verified existing user ID is required.');
      if (grant)
        await tx.insert(appAdmin).values({ userId }).onConflictDoNothing();
      else await tx.delete(appAdmin).where(eq(appAdmin.userId, userId));
    });
  }
  async activeDataset(): Promise<LolDatasetView | null> {
    const [row] = await this.db
      .select({ dataset: questionDataset })
      .from(questionCatalog)
      .innerJoin(
        questionDataset,
        eq(questionDataset.id, questionCatalog.activeDatasetId),
      )
      .where(
        and(
          eq(questionCatalog.topicId, LOL_TOPIC),
          eq(questionCatalog.locale, LOL_LOCALE),
          eq(questionDataset.status, 'ready'),
        ),
      );
    if (!row) return null;
    return lolDatasetSchema.parse({
      locale: LOL_LOCALE,
      completedAt: row.dataset.completedAt?.toISOString(),
      // Only public metadata crosses HTTP; raw source and operational user IDs stay here.
      id: row.dataset.id,
      sourceVersion: row.dataset.sourceVersion,
      normalizationVersion: row.dataset.normalizationVersion,
      contentHash: row.dataset.contentHash,
      counts: row.dataset.counts,
    });
  }
  private view(row: typeof lolImportRun.$inferSelect): LolImportRunView {
    return lolImportRunSchema.parse({
      id: row.id,
      mode: row.mode,
      status: row.status,
      stage: row.stage,
      sourceVersion: row.sourceVersion,
      datasetId: row.datasetId,
      processedChampions: row.processedChampions,
      totalChampions: row.totalChampions,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      errorCode: row.errorCode,
    });
  }
  async run(id: string): Promise<LolImportRunView | null> {
    const [row] = await this.db
      .select()
      .from(lolImportRun)
      .where(eq(lolImportRun.id, id));
    return row ? this.view(row) : null;
  }
  async overview() {
    const [activeDataset, runs] = await Promise.all([
      this.activeDataset(),
      this.db
        .select()
        .from(lolImportRun)
        .where(eq(lolImportRun.locale, LOL_LOCALE))
        .orderBy(desc(lolImportRun.createdAt), desc(lolImportRun.id))
        .limit(20),
    ]);
    return { activeDataset, runs: runs.map((row) => this.view(row)) };
  }
  async createRun(
    userId: string,
    mode: 'latest' | 'reimport',
  ): Promise<{ run: LolImportRunView; created: boolean }> {
    return this.db.transaction(async (tx) => {
      // Serialize starts in SQL, including the transition where the preceding
      // import finishes between a unique-index conflict and a follow-up read.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`lol-import:${LOL_LOCALE}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(lolImportRun)
        .where(
          and(
            eq(lolImportRun.locale, LOL_LOCALE),
            inArray(lolImportRun.status, [...activeStatus]),
          ),
        );
      if (existing) return { run: this.view(existing), created: false };
      const [inserted] = await tx
        .insert(lolImportRun)
        .values({
          id: randomUUID(),
          requestedByUserId: userId,
          locale: LOL_LOCALE,
          mode,
          status: 'queued',
          stage: 'queued',
        })
        .returning();
      if (inserted) return { run: this.view(inserted), created: true };
      throw new LolImportError('IMPORT_STORAGE_FAILED');
    });
  }
  async progress(
    id: string,
    values: Pick<
      Partial<typeof lolImportRun.$inferInsert>,
      | 'status'
      | 'stage'
      | 'sourceVersion'
      | 'datasetId'
      | 'processedChampions'
      | 'totalChampions'
    >,
  ): Promise<void> {
    const rows = await this.db
      .update(lolImportRun)
      .set(values)
      .where(
        and(
          eq(lolImportRun.id, id),
          inArray(lolImportRun.status, [...activeStatus]),
        ),
      )
      .returning({ id: lolImportRun.id });
    if (!rows.length) throw new LolImportError('IMPORT_ABORTED');
  }
  async unchanged(id: string, dataset: LolDatasetView): Promise<void> {
    await this.db
      .update(lolImportRun)
      .set({
        status: 'unchanged',
        stage: 'finished',
        sourceVersion: dataset.sourceVersion,
        datasetId: dataset.id,
        processedChampions: dataset.counts.champions,
        totalChampions: dataset.counts.champions,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(lolImportRun.id, id),
          inArray(lolImportRun.status, [...activeStatus]),
        ),
      );
  }
  async stage(
    runId: string,
    version: string,
    total: number,
    documents: readonly SourceDocument[],
  ): Promise<string> {
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.insert(questionDataset).values({
        id,
        topicId: LOL_TOPIC,
        source: 'ddragon',
        sourceVersion: version,
        locale: LOL_LOCALE,
        normalizationVersion: NORMALIZATION_VERSION,
        status: 'staging',
        expectedChampions: total,
      });
      await tx.insert(lolSourcePayload).values(
        documents.map((doc) => {
          const payload = jsonObject(doc.payload);
          return {
            id: randomUUID(),
            datasetId: id,
            resourceKey: doc.path,
            sourcePath: doc.path,
            sha256: hashJson(payload),
            payload,
          };
        }),
      );
      await tx
        .update(lolImportRun)
        .set({ datasetId: id, totalChampions: total, stage: 'normalizing' })
        .where(eq(lolImportRun.id, runId));
    });
    return id;
  }
  async writeChunk(
    runId: string,
    datasetId: string,
    champions: readonly NormalizedChampion[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const champion of champions) {
        const championId = randomUUID();
        await tx.insert(lolChampion).values({
          id: championId,
          datasetId,
          sourceId: champion.sourceId,
          riotKey: champion.riotKey,
          name: champion.name,
          title: champion.title,
          icon: champion.icon,
          resourceName: champion.resourceName,
          resourceType: champion.resourceType,
          skinCount: champion.skinCount,
          chromaCount: champion.chromaCount,
          raw: champion.raw,
        });
        await tx
          .insert(lolChampionStats)
          .values({ championId, ...champion.stats });
        await tx.insert(lolPassive).values({ championId, ...champion.passive });
        if (champion.tags.length)
          await tx.insert(lolChampionTag).values(
            champion.tags.map((tag) => ({
              id: randomUUID(),
              championId,
              tag,
            })),
          );
        const skinIds = new Map(
          champion.skins.map((skin) => [skin.skinNum, randomUUID()]),
        );
        const skinRows = champion.skins.map((skin) => {
          const id = skinIds.get(skin.skinNum);
          const parentSkinId =
            skin.parentNum === null ? null : skinIds.get(skin.parentNum);
          if (!id || parentSkinId === undefined)
            throw new LolImportError('SOURCE_DATA_INVALID');
          return {
            id,
            championId,
            sourceSkinId: skin.sourceSkinId,
            skinNum: skin.skinNum,
            name: skin.name,
            isChroma: skin.isChroma,
            isBase: skin.isBase,
            sourceHasChromas: skin.sourceHasChromas,
            parentSkinId,
            chromaCount: skin.chromaCount,
          };
        });
        // Parents exist before their chromas even when the source lists children first.
        await tx
          .insert(lolSkin)
          .values(skinRows.filter((skin) => !skin.isChroma));
        const chromas = skinRows.filter((skin) => skin.isChroma);
        if (chromas.length) await tx.insert(lolSkin).values(chromas);
        await tx.insert(lolSpell).values(
          champion.spells.map((spell) => ({
            id: randomUUID(),
            championId,
            ...spell,
            damage: {},
          })),
        );
      }
      const [dataset] = await tx
        .select()
        .from(questionDataset)
        .where(eq(questionDataset.id, datasetId))
        .for('update');
      if (!dataset || dataset.status !== 'staging')
        throw new LolImportError('IMPORT_ABORTED');
      const importedChampions = dataset.importedChampions + champions.length;
      await tx
        .update(questionDataset)
        .set({ importedChampions })
        .where(eq(questionDataset.id, datasetId));
      await tx
        .update(lolImportRun)
        .set({ processedChampions: importedChampions })
        .where(eq(lolImportRun.id, runId));
    });
  }
  async publish(
    runId: string,
    datasetId: string,
    hash: string,
    counts: LolCounts,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(questionCatalog)
        .values({ id: randomUUID(), topicId: LOL_TOPIC, locale: LOL_LOCALE })
        .onConflictDoNothing();
      const [catalog] = await tx
        .select()
        .from(questionCatalog)
        .where(
          and(
            eq(questionCatalog.topicId, LOL_TOPIC),
            eq(questionCatalog.locale, LOL_LOCALE),
          ),
        )
        .for('update');
      const [run] = await tx
        .select()
        .from(lolImportRun)
        .where(eq(lolImportRun.id, runId))
        .for('update');
      const [dataset] = await tx
        .select()
        .from(questionDataset)
        .where(eq(questionDataset.id, datasetId))
        .for('update');
      if (
        !catalog ||
        !run ||
        run.status !== 'running' ||
        !dataset ||
        dataset.status !== 'staging' ||
        dataset.importedChampions !== dataset.expectedChampions ||
        counts.champions !== dataset.expectedChampions
      )
        throw new LolImportError('IMPORT_ABORTED');
      const [duplicate] = await tx
        .select()
        .from(questionDataset)
        .where(
          and(
            eq(questionDataset.topicId, LOL_TOPIC),
            eq(questionDataset.locale, LOL_LOCALE),
            eq(questionDataset.sourceVersion, dataset.sourceVersion),
            eq(questionDataset.normalizationVersion, NORMALIZATION_VERSION),
            eq(questionDataset.contentHash, hash),
            eq(questionDataset.status, 'ready'),
          ),
        );
      const publishedId = duplicate?.id ?? datasetId;
      if (!duplicate)
        await tx
          .update(questionDataset)
          .set({
            status: 'ready',
            contentHash: hash,
            counts,
            completedAt: new Date(),
          })
          .where(eq(questionDataset.id, datasetId));
      await tx
        .update(questionCatalog)
        .set({ activeDatasetId: publishedId, updatedAt: new Date() })
        .where(eq(questionCatalog.id, catalog.id));
      await tx
        .update(lolImportRun)
        .set({
          status: duplicate ? 'unchanged' : 'succeeded',
          stage: 'finished',
          datasetId: publishedId,
          completedAt: new Date(),
        })
        .where(eq(lolImportRun.id, runId));
      if (duplicate)
        await tx
          .delete(questionDataset)
          .where(eq(questionDataset.id, datasetId));
    });
  }
  async fail(id: string, code: LolImportErrorCode): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .update(lolImportRun)
        .set({
          status: code === 'IMPORT_ABORTED' ? 'aborted' : 'failed',
          stage: 'finished',
          errorCode: code,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(lolImportRun.id, id),
            inArray(lolImportRun.status, [...activeStatus]),
          ),
        )
        .returning();
      if (run?.datasetId)
        await tx
          .update(questionDataset)
          .set({ status: 'failed', completedAt: new Date() })
          .where(
            and(
              eq(questionDataset.id, run.datasetId),
              eq(questionDataset.status, 'staging'),
            ),
          );
    });
  }
  async recover(): Promise<number> {
    const runs = await this.db
      .select({ id: lolImportRun.id })
      .from(lolImportRun)
      .where(inArray(lolImportRun.status, [...activeStatus]));
    for (const run of runs) await this.fail(run.id, 'IMPORT_ABORTED');
    return runs.length;
  }
}
