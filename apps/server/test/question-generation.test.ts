import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { SeededRandom } from '../src/question-generation/random.js';
import { seededStreams } from '../src/question-generation/streams.js';
import { compileCatalog } from '../src/question-generation/catalog.js';
import { QuestionPlan } from '../src/question-generation/generate.js';
import {
  normalizeFull,
  normalizeSummary,
  object,
} from '../src/lol-data/normalize.js';
import { fullLolFixture } from './lol-fixture.js';
import { parseQuestionBatch } from '@rapidfire/game-engine';

describe('deterministic LoL generation', () => {
  it('matches independent raw-state and hashed stream vectors', async () => {
    const data: unknown = JSON.parse(
      await readFile(
        new URL(
          '../../../docs/question-catalog-draft/full-prng-test-vectors.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    // The external fixture is validated before its numbers reach the PRNG.
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);
    const object = (value: unknown): Record<string, unknown> => {
      if (!isRecord(value)) throw new Error('invalid fixture');
      return value;
    };
    const numbers = (value: unknown): number[] => {
      if (
        !Array.isArray(value) ||
        !value.every((n: unknown) => typeof n === 'number')
      )
        throw new Error('invalid fixture');
      return value;
    };
    const vectors = object(data);
    if (
      !Array.isArray(vectors.rawStateVectors) ||
      !Array.isArray(vectors.streamVectors) ||
      typeof vectors.fixtureReleaseContentHash !== 'string'
    )
      throw new Error('invalid fixture');
    for (const raw of vectors.rawStateVectors) {
      const v = object(raw),
        rng = new SeededRandom(numbers(v.inputState)),
        expected = numbers(v.outputs);
      expect(expected.map(() => rng.next())).toEqual(expected);
    }
    for (const raw of vectors.streamVectors) {
      const v = object(raw);
      if (
        typeof v.seed !== 'string' ||
        typeof v.purpose !== 'string' ||
        !Array.isArray(v.keys) ||
        !v.keys.every(
          (key: unknown) => typeof key === 'string' || typeof key === 'number',
        )
      )
        throw new Error('invalid fixture');
      const rng = seededStreams(v.seed, vectors.fixtureReleaseContentHash)(
          v.purpose,
          ...v.keys,
        ),
        expected = numbers(v.outputs);
      expect(expected.map(() => rng.next())).toEqual(expected);
    }
    expect(new SeededRandom([0, 0, 0, 0]).next()).toBe(
      new SeededRandom([0, 0, 0, 1]).next(),
    );
    expect(() => new SeededRandom([1, 2, 3, 4]).index(0)).toThrow();
    if (!Array.isArray(vectors.subsetSamplingVectors))
      throw new Error('Missing sampling vectors');
    for (const raw of vectors.subsetSamplingVectors) {
      const v = object(raw);
      if (typeof v.count !== 'number') throw new Error('Invalid count');
      expect(
        new SeededRandom(numbers(v.inputState)).sample(
          numbers(v.input),
          v.count,
        ),
      ).toEqual(numbers(v.output));
    }
    class RejectingRandom extends SeededRandom {
      override next() {
        return 0xffffffff;
      }
    }
    expect(() => new RejectingRandom([1, 2, 3, 4]).index(0x80000001)).toThrow(
      'RANDOM_BUDGET_EXHAUSTED',
    );
  });
  it('publishes 26 viable variants and reproduces canonical packs across all approved seed cases', async () => {
    const fixture = await fullLolFixture();
    const champions = normalizeFull(
      fixture.full,
      '16.20.1',
      normalizeSummary(fixture.summary, '16.20.1'),
    );
    const catalog = compileCatalog(champions);
    expect(catalog.variants).toHaveLength(26);
    expect(catalog.unavailable).toEqual([
      'league-of-legends:chromaPerSkin:hard',
    ]);
    const hash =
      '2af7bbc3eab1c278615244d42ec868d7c99275b732bc4810f176ce417f81ac40';
    for (const seed of [
      'A',
      'a',
      '001',
      '1',
      'Ab1',
      'ab1',
      '0123456789',
      ...Array.from({ length: 200 }, (_, i) => `Check${i}`),
    ]) {
      const plan = new QuestionPlan(catalog, seededStreams(seed, hash));
      for (const variant of catalog.variants) {
        const pack = plan.pack(variant.id);
        expect(parseQuestionBatch(pack, variant.id)).not.toBeNull();
        expect(new Set(pack.map((q) => q.text)).size).toBe(5);
        expect(
          pack.every((q) => q.options.length === variant.profile.count),
        ).toBe(true);
      }
    }
    const forward = new QuestionPlan(catalog, seededStreams('Ab1', hash)),
      backward = new QuestionPlan(catalog, seededStreams('Ab1', hash));
    for (const variant of [...catalog.variants].reverse())
      expect(backward.pack(variant.id)).toEqual(forward.pack(variant.id));
    const witnessInput: unknown = JSON.parse(
      await readFile(
        new URL(
          '../../../docs/question-catalog-draft/full-pack-witnesses.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    for (const [family, difficultyPacks] of Object.entries(
      object(object(witnessInput).packs),
    )) {
      for (const [difficulty, witnessPack] of Object.entries(
        object(difficultyPacks),
      )) {
        if (!Array.isArray(witnessPack))
          throw new Error('Invalid witness pack');
        const actual = forward.pack(
          `league-of-legends:${family}:${difficulty}`,
        );
        witnessPack.forEach((raw: unknown, index: number) => {
          const q = object(raw);
          if (!Array.isArray(q.options))
            throw new Error('Invalid witness options');
          const options = q.options.map((option: unknown) => object(option));
          expect(actual[index]?.options.map((option) => option.id)).toEqual(
            options.map((option) => option.subjectKey),
          );
          expect(actual[index]?.correctOptionIds).toEqual(
            options
              .filter((option) => option.isCorrect === true)
              .map((option) => option.subjectKey),
          );
        });
      }
    }
    const reordered = compileCatalog([...champions].reverse());
    expect(
      new QuestionPlan(reordered, seededStreams('Ab1', hash)).pack(
        catalog.variants[0]?.id ?? '',
      ),
    ).toEqual(forward.pack(catalog.variants[0]?.id ?? ''));
  }, 60000);
});
