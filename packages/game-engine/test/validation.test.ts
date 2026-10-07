import { describe, expect, it } from 'vitest';
import { createMatch, parseQuestionBatch } from '../src/index.js';
import { batch, input } from './helpers.js';

describe('match validation', () => {
  it.each([0, 11, 1.5])('rejects invalid round count %s', (rounds) => {
    expect(
      createMatch(
        { ...input(), settings: { rounds, answerTimeMs: 20_000 } },
        0,
      ),
    ).toEqual({ ok: false, error: 'INVALID_SETTINGS' });
  });
  it.each([4999, 60_001, 5500, Number.NaN])(
    'rejects invalid answer duration %s',
    (answerTimeMs) => {
      expect(
        createMatch({ ...input(), settings: { rounds: 1, answerTimeMs } }, 0),
      ).toEqual({ ok: false, error: 'INVALID_SETTINGS' });
    },
  );
  it('requires enough unique categories and a unique player id/order', () => {
    expect(
      createMatch({ ...input(1, 2), categories: input().categories }, 0),
    ).toEqual({ ok: false, error: 'INVALID_CATEGORIES' });
    const player = input().participants[0];
    if (!player) throw new Error('Fixture missing');
    expect(
      createMatch({ ...input(2), participants: [player, player] }, 0),
    ).toEqual({ ok: false, error: 'INVALID_PARTICIPANTS' });
    expect(
      createMatch(
        { ...input(2), participants: [player, { ...player, id: 'p2' }] },
        0,
      ),
    ).toEqual({ ok: false, error: 'INVALID_PARTICIPANTS' });
    expect(createMatch({ ...input(2), mode: 'solo' }, 0)).toEqual({
      ok: false,
      error: 'INVALID_PARTICIPANTS',
    });
    expect(createMatch(input(11), 0)).toEqual({
      ok: false,
      error: 'INVALID_PARTICIPANTS',
    });
  });
  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'rejects unsafe time %s',
    (now) => {
      expect(createMatch(input(), now)).toEqual({
        ok: false,
        error: 'INVALID_TIME',
      });
    },
  );
});

describe('question provider validation', () => {
  it('accepts exactly five questions and detaches nested input', () => {
    const payload = batch();
    const parsed = parseQuestionBatch(payload, 'c1');
    expect(parsed).toEqual(payload);
    expect(parsed).not.toBe(payload);
    expect(parsed?.[0]?.options).not.toBe(payload[0]?.options);
    expect(parsed?.[0]?.correctOptionIds).not.toBe(
      payload[0]?.correctOptionIds,
    );
    expect(parseQuestionBatch(payload.slice(1), 'c1')).toBeNull();
    expect(parseQuestionBatch(null, 'c1')).toBeNull();
  });
  it.each([
    { type: 'single', correctOptionIds: [] },
    { type: 'single', correctOptionIds: ['a', 'b'] },
    { type: 'multiple', correctOptionIds: ['a', 'b', 'c', 'd'] },
    { type: 'multiple', correctOptionIds: [] },
    { correctOptionIds: ['unknown'] },
    { correctOptionIds: ['a', 'a'] },
    {
      options: [
        { id: 'a', text: 'A' },
        { id: 'a', text: 'B' },
      ],
    },
    { options: [{ id: 'a', text: 'A' }] },
    { options: [null, null] },
    { text: '' },
    { language: '' },
    { categoryId: 'other' },
    { type: 'unknown' },
  ])('rejects malformed question %j', (override) => {
    expect(
      parseQuestionBatch(
        batch().map((question, index) =>
          index === 0 ? { ...question, ...override } : question,
        ),
        'c1',
      ),
    ).toBeNull();
  });
  it('rejects repeated question ids both inside a batch and across rounds', () => {
    expect(
      parseQuestionBatch(
        batch().map((q) => ({ ...q, id: 'same' })),
        'c1',
      ),
    ).toBeNull();
    expect(parseQuestionBatch(batch(), 'c1', ['c1-q1'])).toBeNull();
  });
  it.each([2, 4, 6])('accepts %s options', (count) => {
    expect(
      parseQuestionBatch(
        batch().map((q) => ({
          ...q,
          type: 'single',
          options: Array.from({ length: count }, (_, i) => ({
            id: `${i}`,
            text: `${i}`,
          })),
          correctOptionIds: ['0'],
        })),
        'c1',
      ),
    ).not.toBeNull();
  });
});
