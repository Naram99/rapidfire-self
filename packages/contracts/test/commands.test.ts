import { describe, expect, it } from 'vitest';
import { errorMessage, parseCommand, PROTOCOL_VERSION } from '../src/index.js';

describe('public command schemas', () => {
  it('requires requestId and rejects unknown/identity/time/score fields', () => {
    expect(parseCommand('time:sync', {}).success).toBe(false);
    expect(parseCommand('unknown', { requestId: 'r' }).success).toBe(false);
    const data = {
      requestId: 'r',
      matchId: 'm',
      questionId: 'q',
      selectedOptionIds: ['a'],
    };
    expect(parseCommand('answer:submit', data).success).toBe(true);
    for (const extra of [
      { userId: 'u' },
      { receivedAt: 0 },
      { points: 1000 },
      { correct: true },
    ])
      expect(parseCommand('answer:submit', { ...data, ...extra }).success).toBe(
        false,
      );
  });
  it.each([[], ['a', 'a'], Array.from({ length: 7 }, (_, i) => `${i}`)])(
    'rejects invalid option selection %j',
    (...selection) => {
      expect(
        parseCommand('answer:submit', {
          requestId: 'r',
          matchId: 'm',
          questionId: 'q',
          selectedOptionIds: selection,
        }).success,
      ).toBe(false);
    },
  );
  it('validates integer settings and rejects extra nested settings', () => {
    for (const settings of [
      { topicId: 'league-of-legends', rounds: 0, answerTimeMs: 20000 },
      { topicId: 'league-of-legends', rounds: 1, answerTimeMs: 5500 },
      { topicId: 'league-of-legends', rounds: 11, answerTimeMs: 20000 },
      {
        topicId: 'league-of-legends',
        rounds: 1,
        answerTimeMs: 20000,
        cheat: true,
      },
      { topicId: 'unsupported-topic', rounds: 1, answerTimeMs: 20000 },
      { rounds: 1, answerTimeMs: 20000 },
    ])
      expect(
        parseCommand('solo:start', { requestId: 'r', settings }).success,
      ).toBe(false);
    expect(
      parseCommand('solo:start', {
        requestId: 'r',
        settings: {
          topicId: 'league-of-legends',
          rounds: 10,
          answerTimeMs: 60000,
        },
      }).success,
    ).toBe(true);
  });
  it('exposes stable protocol version and an English fallback for future codes', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(errorMessage('AUTH_REQUIRED')).toBe('Sign in to continue.');
    expect(errorMessage('FUTURE_CODE')).toBe('Something went wrong.');
  });
});
