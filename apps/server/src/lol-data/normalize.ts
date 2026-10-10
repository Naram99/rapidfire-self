import { createHash } from 'node:crypto';
import type { LolCounts } from '@rapidfire/contracts';
import {
  LolImportError,
  NORMALIZATION_VERSION,
  LOL_LOCALE,
  statFields,
} from './model.js';
import type {
  ChampionStats,
  ChampionSummary,
  JsonObject,
  JsonValue,
  NormalizedChampion,
  NormalizedSkin,
  NormalizedSpell,
  ResourceType,
} from './model.js';

const invalid = (): never => {
  throw new LolImportError('SOURCE_DATA_INVALID');
};
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return invalid();
  return value;
}
function string(value: unknown, empty = false): string {
  if (
    typeof value !== 'string' ||
    (!empty && !value.length) ||
    value.length > 100000
  )
    return invalid();
  return value;
}
function integer(value: unknown, min = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > 2147483647
  )
    return invalid();
  return value;
}
function decimal(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid();
  return String(value);
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalid();
  return value;
}
function icon(value: unknown): string {
  const filename = string(object(value).full);
  if (!/^[A-Za-z0-9_-]+\.png$/.test(filename)) return invalid();
  return filename;
}
function unique(values: readonly (string | number)[]): void {
  if (new Set(values).size !== values.length) invalid();
}
export function sourceVersion(value: unknown): string {
  const version = string(value);
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) return invalid();
  return version;
}
export function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(object(value))) {
    // Define own properties safely even for an external __proto__ key.
    Object.defineProperty(result, key, {
      value: jsonValue(child),
      enumerable: true,
      writable: true,
    });
  }
  return result;
}
export function jsonObject(value: unknown): JsonObject {
  object(value);
  const result = jsonValue(value);
  if (typeof result !== 'object' || result === null || Array.isArray(result))
    return invalid();
  return result;
}
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}
export const hashJson = (value: JsonValue): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
function summary(value: unknown): ChampionSummary {
  const row = object(value);
  const sourceId = string(row.id);
  if (!/^[A-Za-z0-9]+$/.test(sourceId)) return invalid();
  const key = string(row.key);
  if (!/^[1-9]\d*$/.test(key)) return invalid();
  const riotKey = integer(Number(key), 1);
  const stats = object(row.stats);
  // Explicit keys keep the source -> SQL mapping complete under strict TS.
  const fields = statFields;
  const normalized: ChampionStats = {
    hp: decimal(stats.hp),
    hpPerLevel: decimal(stats.hpperlevel),
    mp: decimal(stats.mp),
    mpPerLevel: decimal(stats.mpperlevel),
    moveSpeed: decimal(stats.movespeed),
    armor: decimal(stats.armor),
    armorPerLevel: decimal(stats.armorperlevel),
    magicResist: decimal(stats.spellblock),
    magicResistPerLevel: decimal(stats.spellblockperlevel),
    attackRange: decimal(stats.attackrange),
    hpRegen: decimal(stats.hpregen),
    hpRegenPerLevel: decimal(stats.hpregenperlevel),
    mpRegen: decimal(stats.mpregen),
    mpRegenPerLevel: decimal(stats.mpregenperlevel),
    crit: decimal(stats.crit),
    critPerLevel: decimal(stats.critperlevel),
    attackDamage: decimal(stats.attackdamage),
    attackDamagePerLevel: decimal(stats.attackdamageperlevel),
    attackSpeedPerLevel: decimal(stats.attackspeedperlevel),
    attackSpeed: decimal(stats.attackspeed),
  };
  for (const [source, target] of Object.entries(fields))
    if (normalized[target] !== decimal(stats[source])) invalid();
  const tags = array(row.tags).map((value) => string(value));
  unique(tags);
  return {
    sourceId,
    riotKey,
    name: string(row.name),
    title: string(row.title),
    icon: icon(row.image),
    resourceName: string(row.partype, true),
    tags: tags.sort(),
    stats: normalized,
  };
}
function envelope(
  value: unknown,
  version: string,
  format: string,
): Record<string, unknown> {
  const root = object(value);
  if (
    root.type !== 'champion' ||
    root.format !== format ||
    root.version !== version
  )
    return invalid();
  const data = object(root.data);
  if (!Object.keys(data).length || Object.keys(data).length > 2000)
    return invalid();
  return data;
}
export function normalizeSummary(
  value: unknown,
  version: string,
): readonly ChampionSummary[] {
  sourceVersion(version);
  const data = envelope(value, version, 'standAloneComplex');
  const rows = Object.entries(data).map(([id, value]) => {
    const row = summary(value);
    if (row.sourceId !== id || object(value).version !== version)
      return invalid();
    return row;
  });
  unique(rows.map((row) => row.riotKey));
  return rows.sort((a, b) => a.riotKey - b.riotKey);
}
const otherResources = new Set([
  'Blood Well',
  'BloodWell',
  'Fury',
  'Rage',
  'Courage',
  'Shield',
  'Ferocity',
  'Heat',
  'Grit',
  'Crimson Rush',
  'Flow',
]);
function resourceType(name: string): ResourceType {
  if (name === 'Mana') return 'mana';
  if (name === 'Energy') return 'energy';
  if (name === 'None') return 'none';
  return otherResources.has(name) ? 'other' : 'unknown';
}
function skins(value: unknown): readonly NormalizedSkin[] {
  const rows = array(value).map((item) => {
    const row = object(item);
    if (row.chromas !== undefined && typeof row.chromas !== 'boolean')
      return invalid();
    const parentNum =
      row.parentSkin === undefined ? null : integer(row.parentSkin);
    return {
      sourceSkinId: string(row.id),
      skinNum: integer(row.num),
      name: string(row.name),
      parentNum,
      isChroma: parentNum !== null,
      isBase: parentNum === null && row.num === 0,
      sourceHasChromas: row.chromas ?? null,
    };
  });
  if (
    !rows.length ||
    rows.length > 10000 ||
    rows.filter((row) => row.isBase).length !== 1
  )
    return invalid();
  unique(rows.map((row) => row.sourceSkinId));
  unique(rows.map((row) => row.skinNum));
  const byNum = new Map(rows.map((row) => [row.skinNum, row]));
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.parentNum === null) continue;
    const parent = byNum.get(row.parentNum);
    if (
      !parent ||
      parent.isChroma ||
      parent.skinNum === row.skinNum ||
      row.skinNum === 0
    )
      return invalid();
    counts.set(parent.skinNum, (counts.get(parent.skinNum) ?? 0) + 1);
  }
  return rows
    .map((row) => {
      const count = counts.get(row.skinNum) ?? 0;
      return {
        ...row,
        chromaCount:
          row.isChroma || (row.sourceHasChromas === true && count === 0)
            ? null
            : count,
      };
    })
    .sort((a, b) => a.skinNum - b.skinNum);
}
const slots = ['Q', 'W', 'E', 'R'] as const;
function spells(value: unknown): readonly NormalizedSpell[] {
  const entries = array(value);
  if (entries.length !== slots.length) return invalid();
  const rows = entries.map((item, index) => {
    const row = object(item);
    const slot = slots[index];
    if (!slot) return invalid();
    const maxRank = integer(row.maxrank, 1);
    if (maxRank > 100) return invalid();
    const cooldowns = array(row.cooldown);
    if (
      cooldowns.length !== maxRank ||
      cooldowns.some((v) => typeof v !== 'number' || v < 0)
    )
      return invalid();
    const cooldownsByRank = cooldowns.map(decimal);
    const rank1 = cooldownsByRank[0];
    if (rank1 === undefined) return invalid();
    return {
      sourceSpellId: string(row.id),
      slot,
      name: string(row.name),
      icon: icon(row.image),
      maxRank,
      cooldownsByRank,
      // A zero rank-one value cannot be a verified positive MVP cooldown.
      cooldownRank1: Number(rank1) > 0 ? rank1 : null,
      cooldownDisplay: string(row.cooldownBurn, true),
      costDisplay: string(row.costBurn, true),
      rangeDisplay: string(row.rangeBurn, true),
      rawEffect: jsonValue(row.effect),
    };
  });
  unique(rows.map((row) => row.sourceSpellId));
  return rows;
}
export function normalizeFull(
  value: unknown,
  version: string,
  expected: readonly ChampionSummary[],
): readonly NormalizedChampion[] {
  const data = envelope(value, version, 'full');
  if (Object.keys(data).length !== expected.length) return invalid();
  const keys = object(object(value).keys);
  if (Object.keys(keys).length !== expected.length) return invalid();
  return expected.map((reference) => {
    const raw = object(data[reference.sourceId]);
    const base = summary(raw);
    if (
      hashJson(jsonObject(base)) !== hashJson(jsonObject(reference)) ||
      keys[String(base.riotKey)] !== base.sourceId ||
      (raw.version !== undefined && raw.version !== version)
    )
      return invalid();
    const skinRows = skins(raw.skins);
    const passive = object(raw.passive);
    const hasUnverified = skinRows.some(
      (s) => !s.isChroma && s.chromaCount === null,
    );
    return {
      ...base,
      resourceType: resourceType(base.resourceName),
      skins: skinRows,
      skinCount: skinRows.filter((s) => !s.isChroma && !s.isBase).length,
      chromaCount: hasUnverified
        ? null
        : skinRows.filter((s) => s.isChroma).length,
      spells: spells(raw.spells),
      passive: { name: string(passive.name), icon: icon(passive.image) },
      raw: jsonObject(raw),
    };
  });
}
export function datasetCounts(
  champions: readonly NormalizedChampion[],
): LolCounts {
  return {
    champions: champions.length,
    skins: champions.reduce((n, c) => n + c.skinCount, 0),
    chromas: champions.reduce(
      (n, c) => n + c.skins.filter((s) => s.isChroma).length,
      0,
    ),
    spells: champions.reduce((n, c) => n + c.spells.length, 0),
    unverifiedChromaSkins: champions.reduce(
      (n, c) =>
        n + c.skins.filter((s) => !s.isChroma && s.chromaCount === null).length,
      0,
    ),
    unverifiedChromaChampions: champions.filter((c) => c.chromaCount === null)
      .length,
    excludedCooldownSpells: champions.reduce(
      (n, c) => n + c.spells.filter((s) => s.cooldownRank1 === null).length,
      0,
    ),
  };
}
export function datasetHash(
  version: string,
  champions: readonly NormalizedChampion[],
): string {
  // Includes preserved raw content; canonical object ordering and normalized arrays
  // exclude row UUIDs, clocks, import IDs and source download order.
  return hashJson(
    jsonObject({
      version,
      locale: LOL_LOCALE,
      normalizationVersion: NORMALIZATION_VERSION,
      champions: [...champions]
        .sort((a, b) => a.riotKey - b.riotKey)
        .map((c) => {
          const rawSkins = new Map(
            array(c.raw.skins).map((value) => {
              const skin = jsonObject(value);
              return [skin.id, skin] as const;
            }),
          );
          return {
            ...c,
            raw: {
              ...c.raw,
              tags: [...c.tags],
              skins: c.skins
                .map((s) => s.sourceSkinId)
                .map((id) => {
                  return jsonObject(rawSkins.get(id));
                }),
            },
          };
        }),
    }),
  );
}
