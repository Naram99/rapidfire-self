import type { Question } from '@rapidfire/game-engine';
import type {
  CompiledCatalog,
  Descriptor,
  Subject,
  Variant,
} from './catalog.js';
import { difficulties, questionText } from './catalog.js';
import { decimalText } from './decimal.js';
import { stableCompare } from './random.js';
import type { RandomStreams, SeededRandom } from './random.js';

function take(
  items: readonly Subject[],
  count: number,
  random: SeededRandom,
  distinct: boolean,
): Subject[] {
  if (!distinct) return random.sample(items, count);
  const groups = new Map<bigint, Subject[]>();
  for (const item of items) {
    const group = groups.get(item.value) ?? [];
    group.push(item);
    groups.set(item.value, group);
  }
  const values = [...groups.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return random
    .sample(values, count)
    .map((value) => random.pick(groups.get(value) ?? []));
}
function select(d: Descriptor, count: number, random: SeededRandom): Subject[] {
  if (d.operator === 'lessThan' || d.operator === 'moreThan') {
    const first = [
      ...take(d.low, 1, random, true),
      ...take(d.high, 1, random, true),
    ];
    const used = new Set(first.map((s) => s.value));
    return [
      ...first,
      ...take(
        d.others.filter((s) => !used.has(s.value)),
        count - 2,
        random,
        true,
      ),
    ];
  }
  const correct = random.pick(d.owners);
  if (d.operator === 'min')
    return [correct, ...take(d.high, count - 1, random, d.distinct)];
  if (d.operator === 'max')
    return [correct, ...take(d.low, count - 1, random, d.distinct)];
  if (d.operator === 'min2nd')
    return [
      correct,
      ...take(d.low, 1, random, true),
      ...take(d.high, count - 2, random, true),
    ];
  if (d.operator === 'max2nd')
    return [
      correct,
      ...take(d.high, 1, random, true),
      ...take(d.low, count - 2, random, true),
    ];
  return [correct, ...take(d.others, count - 1, random, d.distinct)];
}
function descriptor(
  random: SeededRandom,
  remaining: readonly Descriptor[],
): Descriptor {
  const metrics = [...new Set(remaining.map((d) => d.metric))].sort(
    stableCompare,
  );
  const metric = random.pick(metrics);
  const operators = [
    ...new Set(
      remaining.filter((d) => d.metric === metric).map((d) => d.operator),
    ),
  ].sort(stableCompare);
  const operator = random.pick(operators);
  return random.pick(
    remaining.filter((d) => d.metric === metric && d.operator === operator),
  );
}
function numericPack(
  variant: Variant,
  streams: RandomStreams,
  prior: Map<string, Set<string>>,
): Question[] {
  const used = new Set<string>(),
    questions: Question[] = [];
  for (let slot = 1; slot <= 5; slot++) {
    const random = streams('question-slot', variant.id, slot);
    const d = descriptor(
      random,
      variant.descriptors.filter((candidate) => !used.has(candidate.prompt)),
    );
    let subjects: Subject[] | null = null;
    for (let attempt = 0; attempt < 128; attempt++) {
      const candidate = select(d, variant.profile.count, random);
      const key = JSON.stringify(
        candidate.map((s) => s.key).sort(stableCompare),
      );
      const sets = prior.get(d.prompt) ?? new Set<string>();
      if (!sets.has(key)) {
        subjects = candidate;
        sets.add(key);
        prior.set(d.prompt, sets);
        break;
      }
    }
    if (!subjects) throw new Error('OPTION_SET_BUDGET_EXHAUSTED');
    used.add(d.prompt);
    const ordered = streams('option-order', variant.id, slot).sample(
      subjects,
      subjects.length,
    );
    const multiple = d.operator === 'lessThan' || d.operator === 'moreThan';
    const correct = ordered
      .filter((s) =>
        d.operator === 'lessThan'
          ? s.value < d.reference
          : d.operator === 'moreThan'
            ? s.value > d.reference
            : s.value === d.reference,
      )
      .map((s) => s.key);
    if (
      (!multiple && correct.length !== 1) ||
      (multiple && (!correct.length || correct.length === ordered.length))
    )
      throw new Error('INVALID_GENERATED_ANSWER');
    const visible =
      multiple || d.operator === 'exactMatch'
        ? decimalText(d.reference, d.places)
        : null;
    questions.push({
      id: `${variant.id}:q${slot}`,
      categoryId: variant.id,
      language: 'en',
      type: multiple ? 'multiple' : 'single',
      text: questionText(
        variant.definition,
        variant.family,
        d.operator,
        d.metric,
        visible,
        null,
      ),
      options: ordered.map((s) => ({ id: s.key, text: s.text })),
      correctOptionIds: correct,
    });
  }
  return questions;
}
function lookupPack(variant: Variant, streams: RandomStreams): Question[] {
  let remaining = [...variant.clues];
  const questions: Question[] = [];
  for (let slot = 1; slot <= 5; slot++) {
    const random = streams('question-slot', variant.id, slot),
      clue = random.pick(remaining);
    remaining = remaining.filter((c) => c !== clue);
    const owner = variant.champions.find((c) => c.key === clue.owner);
    if (!owner) throw new Error('MISSING_CLUE_OWNER');
    const wrong = random.sample(
      variant.champions.filter((c) => c.key !== owner.key),
      variant.profile.count - 1,
    );
    const options = streams('option-order', variant.id, slot).sample(
      [owner, ...wrong],
      variant.profile.count,
    );
    questions.push({
      id: `${variant.id}:q${slot}`,
      categoryId: variant.id,
      language: 'en',
      type: 'single',
      text: questionText(
        variant.definition,
        variant.family,
        'identify',
        null,
        null,
        clue.clue,
      ),
      options: options.map((s) => ({ id: s.key, text: s.text })),
      correctOptionIds: [owner.key],
    });
  }
  return questions;
}
/** Pure generator; canonical family planning is independent of played round order. */
export class QuestionPlan {
  private readonly packs = new Map<string, readonly Question[]>();
  constructor(
    private readonly catalog: CompiledCatalog,
    private readonly streams: RandomStreams,
  ) {}
  pack(categoryId: string): readonly Question[] {
    const cached = this.packs.get(categoryId);
    if (cached) return cached;
    const variant = this.catalog.variants.find((v) => v.id === categoryId);
    if (!variant) throw new Error('CATEGORY_UNAVAILABLE');
    const prior = new Map<string, Set<string>>();
    for (const difficulty of difficulties) {
      const sibling = this.catalog.variants.find(
        (v) => v.family === variant.family && v.difficulty === difficulty,
      );
      if (!sibling) continue;
      this.packs.set(
        sibling.id,
        sibling.descriptors.length
          ? numericPack(sibling, this.streams, prior)
          : lookupPack(sibling, this.streams),
      );
    }
    const result = this.packs.get(categoryId);
    if (!result) throw new Error('CATEGORY_UNAVAILABLE');
    return result;
  }
}
