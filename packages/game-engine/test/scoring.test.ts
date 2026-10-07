import { describe, expect, it } from 'vitest';
import { scoreAnswer, rankParticipants } from '../src/scoring.js';
import type { AcceptedAnswer, Participant, Question } from '../src/index.js';

const multiple: Question = {
  id: 'q',
  categoryId: 'c',
  language: 'en',
  text: 'Select the correct options',
  type: 'multiple',
  options: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, text: id })),
  correctOptionIds: ['a', 'b', 'c'],
};
function submission(ids: readonly string[], receivedAt = 0): AcceptedAnswer {
  return {
    participantId: 'p',
    questionId: 'q',
    selectedOptionIds: ids,
    receivedAt,
  };
}

describe('scoring', () => {
  it.each([
    {
      ids: ['a', 'b', 'c'],
      elapsed: 0,
      points: 1000,
      outcome: 'correct',
      good: 3,
      bad: 0,
    },
    {
      ids: ['a', 'b', 'c'],
      elapsed: 10_000,
      points: 750,
      outcome: 'correct',
      good: 3,
      bad: 0,
    },
    {
      ids: ['a', 'b'],
      elapsed: 10_000,
      points: 500,
      outcome: 'partial',
      good: 2,
      bad: 0,
    },
    {
      ids: ['a', 'b', 'd'],
      elapsed: 10_000,
      points: 250,
      outcome: 'partial',
      good: 2,
      bad: 1,
    },
    {
      ids: ['a', 'd', 'e'],
      elapsed: 0,
      points: 0,
      outcome: 'partial',
      good: 1,
      bad: 2,
    },
    {
      ids: ['a', 'b', 'c', 'd', 'e', 'f'],
      elapsed: 0,
      points: 0,
      outcome: 'partial',
      good: 3,
      bad: 3,
    },
    {
      ids: ['d'],
      elapsed: 0,
      points: 0,
      outcome: 'incorrect',
      good: 0,
      bad: 1,
    },
  ])(
    'scores $ids at $elapsed ms',
    ({ ids, elapsed, points, outcome, good, bad }) => {
      expect(
        scoreAnswer(multiple, submission(ids, elapsed), 0, 20_000),
      ).toEqual({
        outcome,
        pointsAwarded: points,
        selectedCorrectCount: good,
        selectedIncorrectCount: bad,
      });
    },
  );

  it('rounds the final product and gives no points for no answer', () => {
    expect(
      scoreAnswer(multiple, submission(['a'], 0), 0, 20_000).pointsAwarded,
    ).toBe(333);
    expect(scoreAnswer(multiple, undefined, 0, 20_000)).toEqual({
      outcome: 'unanswered',
      pointsAwarded: 0,
      selectedCorrectCount: 0,
      selectedIncorrectCount: 0,
    });
  });

  it('scores single-choice speed and rejects wrong answers through zero quality', () => {
    const single = {
      ...multiple,
      type: 'single' as const,
      correctOptionIds: ['a'],
    };
    expect(
      scoreAnswer(single, submission(['a'], 19_999), 0, 20_000).pointsAwarded,
    ).toBe(500);
    expect(scoreAnswer(single, submission(['d']), 0, 20_000).outcome).toBe(
      'incorrect',
    );
    expect(
      scoreAnswer(single, submission(['d']), 0, 20_000).pointsAwarded,
    ).toBe(0);
  });

  it('ranks equal scores as 1, 1, 3 with display order from participant order', () => {
    const participants: Participant[] = [
      { id: 'p3', order: 3, score: 500 },
      { id: 'p2', order: 2, score: 1000 },
      { id: 'p1', order: 1, score: 1000 },
    ].map((p) => ({
      ...p,
      name: p.id,
      presence: 'online',
      participation: 'playing',
      leftAt: null,
      activity: 'active',
      missedQuestions: 0,
    }));
    expect(rankParticipants(participants)).toEqual([
      { participantId: 'p1', score: 1000, rank: 1 },
      { participantId: 'p2', score: 1000, rank: 1 },
      { participantId: 'p3', score: 500, rank: 3 },
    ]);
  });
});
