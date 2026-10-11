import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { LolCounts } from '@rapidfire/contracts';
import type { JsonObject, JsonValue } from '../lol-data/model.js';
import { user } from './auth-schema.js';

const date = (name: string) => timestamp(name, { withTimezone: true });
export const appAdmin = pgTable('app_admin', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  grantedAt: date('granted_at').notNull().defaultNow(),
});
export const questionDataset = pgTable(
  'question_dataset',
  {
    id: uuid('id').primaryKey(),
    topicId: text('topic_id').notNull(),
    source: text('source').notNull(),
    sourceVersion: text('source_version').notNull(),
    locale: text('locale').notNull(),
    normalizationVersion: text('normalization_version').notNull(),
    contentHash: text('content_hash'),
    status: text('status', { enum: ['staging', 'ready', 'failed'] }).notNull(),
    createdAt: date('created_at').notNull().defaultNow(),
    completedAt: date('completed_at'),
    expectedChampions: integer('expected_champions').notNull(),
    importedChampions: integer('imported_champions').notNull().default(0),
    counts: jsonb('counts').$type<LolCounts>(),
  },
  (t) => [
    unique('dataset_content_unique').on(
      t.topicId,
      t.source,
      t.sourceVersion,
      t.locale,
      t.normalizationVersion,
      t.contentHash,
    ),
    unique('dataset_catalog_target').on(t.id, t.topicId, t.locale),
    check('dataset_status', sql`${t.status} IN ('staging','ready','failed')`),
    check(
      'dataset_counts',
      sql`${t.expectedChampions} > 0 AND ${t.importedChampions} BETWEEN 0 AND ${t.expectedChampions}`,
    ),
    check(
      'dataset_ready',
      sql`${t.status} <> 'ready' OR (${t.contentHash} IS NOT NULL AND ${t.completedAt} IS NOT NULL AND ${t.counts} IS NOT NULL AND ${t.importedChampions} = ${t.expectedChampions})`,
    ),
  ],
);
export const questionCatalog = pgTable(
  'question_catalog',
  {
    id: uuid('id').primaryKey(),
    topicId: text('topic_id').notNull(),
    locale: text('locale').notNull(),
    activeDatasetId: uuid('active_dataset_id'),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('catalog_topic_locale').on(t.topicId, t.locale),
    foreignKey({
      columns: [t.activeDatasetId, t.topicId, t.locale],
      foreignColumns: [
        questionDataset.id,
        questionDataset.topicId,
        questionDataset.locale,
      ],
      name: 'catalog_dataset_fk',
    }),
  ],
);
export const lolImportRun = pgTable(
  'lol_import_run',
  {
    id: uuid('id').primaryKey(),
    requestedByUserId: uuid('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    locale: text('locale').notNull(),
    mode: text('mode', { enum: ['latest', 'reimport'] }).notNull(),
    sourceVersion: text('source_version'),
    datasetId: uuid('dataset_id').references(() => questionDataset.id),
    status: text('status', {
      enum: [
        'queued',
        'running',
        'unchanged',
        'succeeded',
        'failed',
        'aborted',
      ],
    }).notNull(),
    stage: text('stage', {
      enum: [
        'queued',
        'resolving',
        'downloading',
        'normalizing',
        'publishing',
        'finished',
      ],
    }).notNull(),
    processedChampions: integer('processed_champions').notNull().default(0),
    totalChampions: integer('total_champions').notNull().default(0),
    createdAt: date('created_at').notNull().defaultNow(),
    completedAt: date('completed_at'),
    errorCode: text('error_code'),
  },
  (t) => [
    uniqueIndex('lol_one_active_import')
      .on(t.locale)
      .where(sql`${t.status} IN ('queued','running')`),
    index('lol_import_recent').on(t.createdAt),
    check(
      'lol_import_status',
      sql`${t.status} IN ('queued','running','unchanged','succeeded','failed','aborted')`,
    ),
    check('lol_import_mode', sql`${t.mode} IN ('latest','reimport')`),
    check(
      'lol_import_progress',
      sql`${t.processedChampions} BETWEEN 0 AND ${t.totalChampions}`,
    ),
  ],
);
export const lolSourcePayload = pgTable(
  'lol_source_payload',
  {
    id: uuid('id').primaryKey(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => questionDataset.id, { onDelete: 'cascade' }),
    resourceKey: text('resource_key').notNull(),
    sourcePath: text('source_path').notNull(),
    sha256: text('sha256').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
  },
  (t) => [unique('lol_payload_resource').on(t.datasetId, t.resourceKey)],
);
export const lolChampion = pgTable(
  'lol_champion',
  {
    id: uuid('id').primaryKey(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => questionDataset.id, { onDelete: 'cascade' }),
    riotKey: integer('riot_key').notNull(),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    title: text('title').notNull(),
    icon: text('icon').notNull(),
    resourceName: text('resource_name').notNull(),
    resourceType: text('resource_type', {
      enum: ['mana', 'energy', 'none', 'other', 'unknown'],
    }).notNull(),
    skinCount: integer('skin_count').notNull(),
    chromaCount: integer('chroma_count'),
    raw: jsonb('raw').$type<JsonObject>().notNull(),
  },
  (t) => [
    unique('lol_champion_riot').on(t.datasetId, t.riotKey),
    unique('lol_champion_source').on(t.datasetId, t.sourceId),
    check(
      'lol_champion_counts',
      sql`${t.skinCount} >= 0 AND (${t.chromaCount} IS NULL OR ${t.chromaCount} >= 0)`,
    ),
  ],
);
export const lolSkin = pgTable(
  'lol_skin',
  {
    id: uuid('id').primaryKey(),
    championId: uuid('champion_id')
      .notNull()
      .references(() => lolChampion.id, { onDelete: 'cascade' }),
    sourceSkinId: text('source_skin_id').notNull(),
    skinNum: integer('skin_num').notNull(),
    name: text('name').notNull(),
    isChroma: boolean('is_chroma').notNull(),
    parentSkinId: uuid('parent_skin_id').references(
      (): AnyPgColumn => lolSkin.id,
    ),
    isBase: boolean('is_base').notNull(),
    sourceHasChromas: boolean('source_has_chromas'),
    chromaCount: integer('chroma_count'),
  },
  (t) => [
    unique('lol_skin_source').on(t.championId, t.sourceSkinId),
    unique('lol_skin_num').on(t.championId, t.skinNum),
    unique('lol_skin_parent_target').on(t.championId, t.id),
    foreignKey({
      columns: [t.championId, t.parentSkinId],
      foreignColumns: [t.championId, t.id],
      name: 'lol_skin_same_champion_parent',
    }),
    index('lol_skin_children').on(t.championId, t.parentSkinId),
    check(
      'lol_skin_parent',
      sql`(${t.isChroma} = (${t.parentSkinId} IS NOT NULL)) AND (${t.parentSkinId} IS NULL OR ${t.parentSkinId} <> ${t.id})`,
    ),
    check(
      'lol_skin_base',
      sql`${t.isBase} = (NOT ${t.isChroma} AND ${t.skinNum} = 0) AND (NOT ${t.isChroma} OR ${t.skinNum} > 0)`,
    ),
    check(
      'lol_skin_count',
      sql`${t.skinNum} >= 0 AND (${t.chromaCount} IS NULL OR ${t.chromaCount} >= 0)`,
    ),
  ],
);
export const lolChampionStats = pgTable('lol_champion_stats', {
  championId: uuid('champion_id')
    .primaryKey()
    .references(() => lolChampion.id, { onDelete: 'cascade' }),
  hp: numeric('hp').notNull(),
  hpPerLevel: numeric('hp_per_level').notNull(),
  mp: numeric('mp').notNull(),
  mpPerLevel: numeric('mp_per_level').notNull(),
  moveSpeed: numeric('move_speed').notNull(),
  armor: numeric('armor').notNull(),
  armorPerLevel: numeric('armor_per_level').notNull(),
  magicResist: numeric('magic_resist').notNull(),
  magicResistPerLevel: numeric('magic_resist_per_level').notNull(),
  attackRange: numeric('attack_range').notNull(),
  hpRegen: numeric('hp_regen').notNull(),
  hpRegenPerLevel: numeric('hp_regen_per_level').notNull(),
  mpRegen: numeric('mp_regen').notNull(),
  mpRegenPerLevel: numeric('mp_regen_per_level').notNull(),
  crit: numeric('crit').notNull(),
  critPerLevel: numeric('crit_per_level').notNull(),
  attackDamage: numeric('attack_damage').notNull(),
  attackDamagePerLevel: numeric('attack_damage_per_level').notNull(),
  attackSpeed: numeric('attack_speed').notNull(),
  attackSpeedPerLevel: numeric('attack_speed_per_level').notNull(),
});
export const lolSpell = pgTable(
  'lol_spell',
  {
    id: uuid('id').primaryKey(),
    championId: uuid('champion_id')
      .notNull()
      .references(() => lolChampion.id, { onDelete: 'cascade' }),
    sourceSpellId: text('source_spell_id').notNull(),
    slot: text('slot', { enum: ['Q', 'W', 'E', 'R'] }).notNull(),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    maxRank: integer('max_rank').notNull(),
    cooldownsByRank: jsonb('cooldowns_by_rank')
      .$type<readonly string[]>()
      .notNull(),
    cooldownRank1: numeric('cooldown_rank_1'),
    cooldownDisplay: text('cooldown_display').notNull(),
    costDisplay: text('cost_display').notNull(),
    rangeDisplay: text('range_display').notNull(),
    damage: jsonb('damage').$type<JsonObject>().notNull().default({}),
    rawEffect: jsonb('raw_effect').$type<JsonValue>(),
  },
  (t) => [
    unique('lol_spell_slot').on(t.championId, t.slot),
    unique('lol_spell_source').on(t.championId, t.sourceSpellId),
    check('lol_spell_slot_check', sql`${t.slot} IN ('Q','W','E','R')`),
    check(
      'lol_spell_rank',
      sql`${t.maxRank} > 0 AND jsonb_array_length(${t.cooldownsByRank}) = ${t.maxRank} AND (${t.cooldownRank1} IS NULL OR ${t.cooldownRank1} > 0)`,
    ),
  ],
);
export const lolPassive = pgTable('lol_passive', {
  championId: uuid('champion_id')
    .primaryKey()
    .references(() => lolChampion.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
});
export const lolChampionTag = pgTable(
  'lol_champion_tag',
  {
    id: uuid('id').primaryKey(),
    championId: uuid('champion_id')
      .notNull()
      .references(() => lolChampion.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [
    unique('lol_tag_champion').on(t.championId, t.tag),
    index('lol_tag_lookup').on(t.tag, t.championId),
  ],
);
