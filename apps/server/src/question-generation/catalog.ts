import catalogJson from './catalog-v1.json' with { type: 'json' };
import textsJson from './texts-en-v1.json' with { type: 'json' };
import { statFields } from '../lol-data/model.js';
import type { NormalizedChampion } from '../lol-data/model.js';
import {
  decimalParts,
  scaled,
  fitsDifference,
  decimalText,
} from './decimal.js';
import { stableCompare } from './random.js';

export const difficulties = ['easy', 'medium', 'hard', 'challenger'] as const;
export type Difficulty = (typeof difficulties)[number];
export const numericOperators = [
  'min',
  'max',
  'min2nd',
  'max2nd',
  'exactMatch',
  'lessThan',
  'moreThan',
] as const;
export type Operator = (typeof numericOperators)[number];
export const manifest = {
  catalog: catalogJson,
  texts: textsJson,
  eligibility: 'snapshot-derived-chroma-and-positive-cooldown-v1',
};
export type CatalogDefinition = Readonly<{
  catalog: Record<string, unknown>;
  texts: Record<string, unknown>;
}>;
export type Profile = Readonly<{
  count: number;
  distinct: boolean;
  minimum?: number;
  maximum?: number;
  operators: readonly Operator[];
}>;
export type Subject = Readonly<{ key: string; text: string; value: bigint }>;
export type Descriptor = Readonly<{
  metric: string;
  operator: Operator;
  reference: bigint;
  places: number;
  prompt: string;
  distinct: boolean;
  owners: readonly Subject[];
  low: readonly Subject[];
  high: readonly Subject[];
  others: readonly Subject[];
}>;
export type Variant = Readonly<{
  definition: CatalogDefinition;
  id: string;
  family: string;
  difficulty: Difficulty;
  name: string;
  profile: Profile;
  descriptors: readonly Descriptor[];
  clues: readonly Readonly<{ clue: string; owner: string }>[];
  champions: readonly Readonly<{ key: string; text: string }>[];
}>;
export type CompiledCatalog = Readonly<{
  variants: readonly Variant[];
  unavailable: readonly string[];
}>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('INVALID_CATALOG');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.length)
    throw new Error('INVALID_CATALOG');
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('INVALID_CATALOG');
  return value.map(string);
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('INVALID_CATALOG');
  return value;
}
export function text(definition: CatalogDefinition, key: string): string {
  return string(definition.texts[key]);
}
export function render(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{([A-Za-z]+)\}\}/g, (_, key: string) =>
    string(values[key]),
  );
}
export function questionText(
  definition: CatalogDefinition,
  family: string,
  operator: string,
  metric: string | null,
  visible: string | null,
  clue: string | null,
): string {
  const config = record(record(definition.catalog.families)[family]);
  const template =
    operator === 'identify'
      ? string(config.templateKey)
      : string(record(config.templateKeys)[operator]);
  let metricName = '',
    valueWithUnit = '';
  if (metric !== null) {
    const m = record(record(definition.catalog.metrics)[metric]);
    metricName = text(definition, string(m.nameKey));
    if (visible !== null) {
      const unit = record(record(definition.catalog.units)[string(m.unitId)]);
      valueWithUnit =
        visible +
        ' ' +
        text(
          definition,
          string(visible === '1' ? unit.singularKey : unit.pluralKey),
        );
    }
  }
  return render(text(definition, template), {
    metricName,
    valueWithUnit,
    thresholdWithUnit: valueWithUnit,
    clue: clue ?? '',
  });
}
function samePolicy(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value: unknown, index) => samePolicy(value, right[index]))
    );
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && samePolicy(left[key], right[key]),
    )
  );
}
function profile(
  definition: CatalogDefinition,
  difficulty: Difficulty,
): Profile {
  const p = record(record(definition.catalog.difficultyProfiles)[difficulty]);
  if (typeof p.requireDistinctOptionValues !== 'boolean')
    throw new Error('INVALID_CATALOG');
  const bounds = record(p.relativeDifference);
  const operators = strings(p.allowedNumericOperatorIds).map((id) => {
    const operator = numericOperators.find((candidate) => candidate === id);
    if (!operator) throw new Error('INVALID_CATALOG_OPERATOR');
    return operator;
  });
  return {
    count: number(p.optionCount),
    distinct: p.requireDistinctOptionValues === true,
    operators,
    ...(bounds.minimum === undefined
      ? {}
      : { minimum: number(bounds.minimum) }),
    ...(bounds.maximum === undefined
      ? {}
      : { maximum: number(bounds.maximum) }),
  };
}
function rawPool(
  definition: CatalogDefinition,
  metricId: string,
  champions: readonly NormalizedChampion[],
): Readonly<{ key: string; text: string; value: string }>[] {
  const metric = record(record(definition.catalog.metrics)[metricId]);
  const source = record(metric.source),
    filters = record(metric.filters);
  const values: { key: string; text: string; value: string }[] = [];
  for (const c of champions) {
    const key = String(c.riotKey);
    if (source.kind === 'championStat') {
      if (filters.resourceType === 'mana' && c.resourceType !== 'mana')
        continue;
      const field = Object.entries(statFields).find(
        ([raw]) => raw === source.statKey,
      )?.[1];
      if (!field) throw new Error('INVALID_CATALOG_STAT');
      values.push({ key, text: c.name, value: c.stats[field] });
    } else if (source.kind === 'championSkinCount') {
      if (
        source.excludeDefaultAppearance !== true ||
        source.excludeChromas !== true
      )
        throw new Error('UNSUPPORTED_SKIN_COUNT_POLICY');
      values.push({ key, text: c.name, value: String(c.skinCount) });
    } else if (source.kind === 'championChromaCount') {
      if (c.chromaCount !== null)
        values.push({ key, text: c.name, value: String(c.chromaCount) });
    } else if (source.kind === 'skinChromaCount') {
      for (const skin of c.skins)
        if (!skin.isChroma && skin.chromaCount !== null)
          values.push({
            key: `${key}:${skin.sourceSkinId}`,
            text: render(text(definition, 'options.skin'), {
              championName: c.name,
              skinName: skin.isBase ? 'Default appearance' : skin.name,
            }),
            value: String(skin.chromaCount),
          });
    } else if (source.kind === 'spellCooldown') {
      if (
        source.rank !== 1 ||
        source.modifiers !== 'none' ||
        !samePolicy(source.allowedSlots, ['Q', 'W', 'E', 'R'])
      )
        throw new Error('UNSUPPORTED_COOLDOWN_POLICY');
      for (const spell of c.spells)
        if (spell.cooldownRank1 !== null)
          values.push({
            key: `${key}:${spell.slot}:${spell.sourceSpellId}`,
            text: render(text(definition, 'options.spell'), {
              championName: c.name,
              spellSlot: spell.slot,
              spellName: spell.name,
            }),
            value: spell.cooldownRank1,
          });
    } else throw new Error('INVALID_CATALOG_SOURCE');
  }
  return values.sort((a, b) => stableCompare(a.key, b.key));
}
function descriptors(
  definition: CatalogDefinition,
  metric: string,
  p: Profile,
  champions: readonly NormalizedChampion[],
): Descriptor[] {
  const raw = rawPool(definition, metric, champions);
  if (!raw.length) return [];
  const stepText = String(
    number(record(record(definition.catalog.metrics)[metric]).thresholdStep),
  );
  const places = Math.max(
    decimalParts(stepText).places,
    ...raw.map((s) => decimalParts(s.value).places),
  );
  const subjects = raw.map((s) => ({ ...s, value: scaled(s.value, places) }));
  const groups = new Map<bigint, Subject[]>();
  for (const subject of subjects) {
    const group = groups.get(subject.value) ?? [];
    group.push(subject);
    groups.set(subject.value, group);
  }
  const values = [...groups.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const result: Descriptor[] = [];
  for (const operator of p.operators) {
    const distinct =
      p.distinct || operator === 'min2nd' || operator === 'max2nd';
    let references = values;
    if (operator === 'lessThan' || operator === 'moreThan') {
      const step = scaled(stepText, places),
        min = values[0],
        max = values.at(-1);
      if (step <= 0n || min === undefined || max === undefined)
        throw new Error('INVALID_THRESHOLD_GRID');
      references = [];
      let multiplier = (min + step - 1n) / step;
      if (multiplier < 1n) multiplier = 1n;
      if (max / step - multiplier > 100000n)
        throw new Error('THRESHOLD_BUDGET_EXHAUSTED');
      for (let ref = multiplier * step; ref <= max; ref += step)
        references.push(ref);
    }
    const count = (items: readonly Subject[]) =>
      distinct ? new Set(items.map((s) => s.value)).size : items.length;
    for (const reference of references) {
      if (reference === 0n) continue;
      const others = values
        .filter(
          (value) =>
            value !== reference &&
            fitsDifference(value, reference, p.minimum, p.maximum),
        )
        .flatMap((value) => groups.get(value) ?? []);
      const low = others.filter((s) => s.value < reference),
        high = others.filter((s) => s.value > reference);
      const valid =
        operator === 'min'
          ? count(high) >= p.count - 1
          : operator === 'max'
            ? count(low) >= p.count - 1
            : operator === 'min2nd'
              ? count(low) >= 1 && count(high) >= p.count - 2
              : operator === 'max2nd'
                ? count(high) >= 1 && count(low) >= p.count - 2
                : operator === 'exactMatch'
                  ? count(others) >= p.count - 1
                  : count(low) >= 1 &&
                    count(high) >= 1 &&
                    count(others) >= p.count;
      if (!valid) continue;
      const visible = ['exactMatch', 'lessThan', 'moreThan'].includes(operator)
        ? decimalText(reference, places)
        : null;
      result.push({
        metric,
        operator,
        reference,
        places,
        prompt: JSON.stringify([metric, operator, visible]),
        distinct,
        owners: groups.get(reference) ?? [],
        low,
        high,
        others,
      });
    }
  }
  return result;
}
export function compileCatalog(
  champions: readonly NormalizedChampion[],
  sourceManifest: unknown = manifest,
): CompiledCatalog {
  const input = record(sourceManifest),
    catalog = record(input.catalog);
  if (
    catalog.schemaVersion !== 1 ||
    catalog.topicId !== 'league-of-legends' ||
    catalog.language !== 'en' ||
    input.eligibility !== manifest.eligibility
  )
    throw new Error('UNSUPPORTED_CATALOG');
  const baseline = record(catalogJson);
  for (const key of [
    'rules',
    'valueFormat',
    'subjects',
    'operators',
    'supportedMedia',
    'categoryIdPattern',
    'excludedMetricIds',
    'deferredOperatorIds',
    'metricDifficultyOverrides',
  ]) {
    if (!samePolicy(catalog[key], baseline[key]))
      throw new Error('UNSUPPORTED_CATALOG_POLICY');
  }
  const definition = { catalog, texts: record(input.texts) };
  for (const difficulty of difficulties) {
    const p = profile(definition, difficulty);
    if (
      ![4, 6].includes(p.count) ||
      (p.minimum !== undefined && p.minimum < 0) ||
      (p.maximum !== undefined && p.maximum < (p.minimum ?? 0))
    )
      throw new Error('INVALID_DIFFICULTY_PROFILE');
  }
  const ordered = [...champions].sort((a, b) =>
    stableCompare(String(a.riotKey), String(b.riotKey)),
  );
  if (new Set(ordered.map((c) => c.riotKey)).size !== ordered.length)
    throw new Error('DUPLICATE_GENERATION_SUBJECT');
  const variants: Variant[] = [],
    unavailable: string[] = [];
  for (const [family, value] of Object.entries(
    record(definition.catalog.families),
  ).sort(([a], [b]) => stableCompare(a, b))) {
    const config = record(value);
    if (config.enabled !== true) continue;
    if (config.kind !== 'numeric' && config.kind !== 'lookup')
      throw new Error('INVALID_CATALOG_FAMILY');
    if (
      config.kind === 'lookup' &&
      !['spellName', 'passiveName', 'championTitle'].includes(
        string(config.clueKind),
      )
    )
      throw new Error('INVALID_CATALOG_CLUE');
    const permitted = strings(config.difficultyIds);
    if (permitted.some((id) => !difficulties.some((known) => known === id)))
      throw new Error('INVALID_CATALOG_DIFFICULTY');
    for (const difficulty of difficulties) {
      if (!permitted.includes(difficulty)) continue;
      const id = `league-of-legends:${family}:${difficulty}`,
        p = profile(definition, difficulty);
      const numeric =
        config.kind === 'numeric'
          ? strings(config.metricIds).flatMap((metric) =>
              descriptors(definition, metric, p, ordered),
            )
          : [];
      const owners = new Map<string, Set<string>>();
      if (config.kind === 'lookup')
        for (const c of ordered) {
          const clues =
            config.clueKind === 'spellName'
              ? c.spells.map((s) => s.name)
              : config.clueKind === 'passiveName'
                ? [c.passive.name]
                : config.clueKind === 'championTitle'
                  ? [c.title]
                  : [];
          for (const clue of clues) {
            const set = owners.get(clue) ?? new Set<string>();
            set.add(String(c.riotKey));
            owners.set(clue, set);
          }
        }
      const clues = [...owners]
        .filter(([, set]) => set.size === 1)
        .map(([clue, set]) => ({ clue, owner: string([...set][0]) }))
        .sort((a, b) => stableCompare(a.clue, b.clue));
      const capacity =
        config.kind === 'numeric'
          ? new Set(numeric.map((d) => d.prompt)).size
          : ordered.length >= p.count
            ? clues.length
            : 0;
      if (capacity < 5) {
        unavailable.push(id);
        continue;
      }
      const name = render(text(definition, 'category.variant'), {
        familyName: text(definition, string(config.nameKey)),
        difficultyName: text(definition, `difficulty.${difficulty}`),
      });
      variants.push({
        definition,
        id,
        family,
        difficulty,
        name,
        profile: p,
        descriptors: numeric,
        clues,
        champions: ordered.map((c) => ({
          key: String(c.riotKey),
          text: c.name,
        })),
      });
    }
  }
  return { variants, unavailable };
}
