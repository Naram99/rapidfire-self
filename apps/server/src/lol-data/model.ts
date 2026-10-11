import type { LolImportErrorCode } from '@rapidfire/contracts';

export const NORMALIZATION_VERSION = 'lol-ddragon-v1';
export const LOL_LOCALE = 'en_US';
export const LOL_TOPIC = 'league-of-legends';
export const statFields = {
  hp: 'hp',
  hpperlevel: 'hpPerLevel',
  mp: 'mp',
  mpperlevel: 'mpPerLevel',
  movespeed: 'moveSpeed',
  armor: 'armor',
  armorperlevel: 'armorPerLevel',
  spellblock: 'magicResist',
  spellblockperlevel: 'magicResistPerLevel',
  attackrange: 'attackRange',
  hpregen: 'hpRegen',
  hpregenperlevel: 'hpRegenPerLevel',
  mpregen: 'mpRegen',
  mpregenperlevel: 'mpRegenPerLevel',
  crit: 'crit',
  critperlevel: 'critPerLevel',
  attackdamage: 'attackDamage',
  attackdamageperlevel: 'attackDamagePerLevel',
  attackspeedperlevel: 'attackSpeedPerLevel',
  attackspeed: 'attackSpeed',
} as const;
export type StatName = (typeof statFields)[keyof typeof statFields];
export type ChampionStats = Record<StatName, string>;
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ResourceType = 'mana' | 'energy' | 'none' | 'other' | 'unknown';
export type ChampionSummary = Readonly<{
  sourceId: string;
  riotKey: number;
  name: string;
  title: string;
  icon: string;
  resourceName: string;
  tags: readonly string[];
  stats: ChampionStats;
}>;
export type NormalizedSkin = Readonly<{
  sourceSkinId: string;
  skinNum: number;
  name: string;
  isChroma: boolean;
  parentNum: number | null;
  isBase: boolean;
  sourceHasChromas: boolean | null;
  chromaCount: number | null;
}>;
export type NormalizedSpell = Readonly<{
  sourceSpellId: string;
  slot: 'Q' | 'W' | 'E' | 'R';
  name: string;
  icon: string;
  maxRank: number;
  cooldownsByRank: readonly string[];
  cooldownRank1: string | null;
  cooldownDisplay: string;
  costDisplay: string;
  rangeDisplay: string;
  rawEffect: JsonValue;
}>;
export type NormalizedChampion = ChampionSummary &
  Readonly<{
    resourceType: ResourceType;
    skins: readonly NormalizedSkin[];
    skinCount: number;
    chromaCount: number | null;
    spells: readonly NormalizedSpell[];
    passive: Readonly<{ name: string; icon: string }>;
    raw: JsonObject;
  }>;
export type SourceDocument = Readonly<{ path: string; payload: unknown }>;
export type LolSource = Readonly<{
  latest: (signal: AbortSignal) => Promise<string>;
  summary: (version: string, signal: AbortSignal) => Promise<SourceDocument>;
  full: (version: string, signal: AbortSignal) => Promise<SourceDocument>;
}>;
export class LolImportError extends Error {
  constructor(readonly code: LolImportErrorCode) {
    super(code);
  }
}
