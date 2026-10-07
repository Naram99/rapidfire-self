import { describe, expect, it } from 'vitest';
import { createMatch, transitionMatch } from '../src/index.js';
import type { MatchEvent, MatchState } from '../src/index.js';
import {
  accepted,
  answer,
  answering,
  batch,
  chooseCategory,
  currentQuestion,
  freeze,
  input,
  nextQuestion,
  prepare,
  send,
  start,
  timer,
} from './helpers.js';

function answerEvent(
  state: MatchState,
  selectedOptionIds: readonly string[] = ['a'],
  receivedAt = state.phase.startedAt,
): MatchEvent {
  return {
    type: 'answer_submitted',
    matchId: state.id,
    participantId: 'p1',
    questionId: currentQuestion(state).id,
    selectedOptionIds,
    receivedAt,
  };
}

function leave(state: MatchState, participantId: string): MatchState {
  return send(state, {
    type: 'participant_left',
    matchId: state.id,
    participantId,
  }).state;
}

describe('match lifecycle', () => {
  it('handles the MVP limit of ten players and ten five-question rounds', () => {
    let state = answering(input(10, 10, 10));
    const closedQuestionIds = new Set<string>();
    for (let round = 1; round <= 10; round++) {
      for (let number = 1; number <= 5; number++) {
        for (let player = 1; player <= 10; player++) {
          const transition = answer(state, `p${player}`);
          for (const effect of transition.effects) {
            if (effect.type === 'question_closed') {
              expect(closedQuestionIds.has(effect.questionId)).toBe(false);
              closedQuestionIds.add(effect.questionId);
            }
          }
          state = transition.state;
        }
        if (number < 5) state = nextQuestion(state);
      }
      const advanced = timer(state);
      if (round < 10)
        state = timer(prepare(chooseCategory(advanced.state))).state;
      else {
        state = advanced.state;
        expect(
          advanced.effects.filter(
            (effect) => effect.type === 'match_completed',
          ),
        ).toHaveLength(1);
      }
    }
    expect(state.results).toHaveLength(500);
    expect(closedQuestionIds.size).toBe(50);
    expect(state.participants.every((p) => p.score === 50_000)).toBe(true);
    expect(state.phase).toMatchObject({
      type: 'finished',
      standings: expect.arrayContaining([
        expect.objectContaining({ participantId: 'p1', rank: 1 }),
        expect.objectContaining({ participantId: 'p10', rank: 1 }),
      ]),
    });
    expect(
      new Set(
        state.rounds.flatMap((round) =>
          round.status === 'choosing' ? [] : [round.selection.categoryId],
        ),
      ).size,
    ).toBe(10);
  });
  it('runs a complete solo match through all phases with controlled clock', () => {
    const initial = createMatch(input(), 1_000);
    if (!initial.ok) throw new Error(initial.error);
    expect(initial.effects).toEqual([
      {
        type: 'schedule_timer',
        matchId: 'match-1',
        phaseId: 'phase:1',
        deadline: 6_000,
      },
    ]);
    const started = timer(initial.state);
    expect(started.effects).toContainEqual({
      type: 'match_started',
      at: 6_000,
    });
    expect(started.state.phase.type).toBe('preparing_questions');
    expect(started.state.rounds[0]).toMatchObject({
      selection: { categoryId: 'c1', reason: 'single_option' },
    });
    let state = prepare(started.state);
    expect(state.phase).toMatchObject({
      type: 'question_countdown',
      startedAt: 6_000,
      deadline: 9_000,
    });
    state = timer(state).state;
    for (let number = 1; number <= 5; number++) {
      expect(state.phase).toMatchObject({
        type: 'answering',
        questionNumber: number,
        waitingParticipantIds: ['p1'],
      });
      const closed = answer(
        state,
        'p1',
        currentQuestion(state).correctOptionIds,
        10_000,
      );
      expect(closed.state.phase.type).toBe('evaluation');
      expect(
        closed.effects.filter((effect) => effect.type === 'question_closed'),
      ).toHaveLength(1);
      expect(closed.receipt).not.toHaveProperty('pointsAwarded');
      state =
        number < 5 ? nextQuestion(closed.state) : timer(closed.state).state;
    }
    expect(state.phase).toMatchObject({
      type: 'finished',
      standings: [{ participantId: 'p1', score: 3750, rank: 1 }],
    });
    expect(state.results).toHaveLength(5);
    const returned = timer(state);
    expect(returned.state.endedAt).toBe(state.endedAt);
    expect(returned.state.endedAt).toBe(state.phase.startedAt);
    expect(returned.state.phase).toMatchObject({
      type: 'returned',
      result: 'completed',
      standings: [{ participantId: 'p1', score: 3750, rank: 1 }],
    });
    expect(returned.effects).toContainEqual({
      type: 'return_requested',
      result: 'completed',
    });
  });

  it('runs two multiplayer rounds, chooses the lowest score, and excludes used categories', () => {
    let state = answering(input(3, 2, 2));
    for (let number = 1; number <= 5; number++) {
      state = answer(state, 'p1').state;
      state = answer(state, 'p2').state;
      state = answer(state, 'p3', ['d']).state;
      if (number < 5) state = nextQuestion(state);
    }
    const advanced = timer(state);
    expect(advanced.state.phase.type).toBe('preparing_questions');
    expect(advanced.state.rounds[1]).toMatchObject({
      offeredCategoryIds: ['c2'],
      selection: { categoryId: 'c2', reason: 'single_option' },
    });
    state = timer(prepare(advanced.state)).state;
    for (let number = 1; number <= 5; number++) {
      state = answer(state, 'p1').state;
      state = answer(state, 'p2').state;
      state = answer(state, 'p3', ['d']).state;
      if (number < 5) state = nextQuestion(state);
    }
    state = timer(state).state;
    expect(state.phase).toMatchObject({
      type: 'finished',
      standings: [
        { participantId: 'p1', score: 10000, rank: 1 },
        { participantId: 'p2', score: 10000, rank: 1 },
        { participantId: 'p3', score: 0, rank: 3 },
      ],
    });
    expect(state.results).toHaveLength(30);
    expect(
      new Set(
        state.results.map(
          (result) => `${result.participantId}:${result.questionId}`,
        ),
      ).size,
    ).toBe(30);
  });

  it('uses the lowest active score as next selector, including an offline participant', () => {
    let state = answering(input(2, 2, 3));
    for (let number = 1; number <= 5; number++) {
      state = answer(state, 'p1').state;
      state = answer(state, 'p2', ['d']).state;
      if (number < 5) state = nextQuestion(state);
    }
    state = send(state, {
      type: 'presence_changed',
      matchId: state.id,
      participantId: 'p2',
      presence: 'offline',
    }).state;
    state = timer(state).state;
    expect(state.phase.type).toBe('category_selection');
    expect(state.rounds[1]).toMatchObject({
      selectorId: 'p2',
      offeredCategoryIds: ['c2', 'c3'],
    });
  });

  it('does not mutate frozen states or input, and can replay a deterministic transition', () => {
    const state = freeze(start(freeze(input(2, 1, 6))));
    const phase = state.phase;
    if (!('deadline' in phase)) throw new Error('No timer');
    const event = {
      type: 'timer_elapsed' as const,
      matchId: state.id,
      phaseId: phase.id,
      deadline: phase.deadline,
    };
    const context = freeze({
      now: phase.deadline,
      random: [0.9, 0.2, 0.7, 0, 0.8],
    });
    expect(transitionMatch(state, event, context)).toEqual(
      transitionMatch(state, event, context),
    );
    const started = accepted(transitionMatch(state, event, context));
    expect(new Set(started.state.rounds[0]?.offeredCategoryIds).size).toBe(4);
    expect(started.state.rounds[0]?.selectorId).toBe('p2');
    freeze(started.state);
    freeze(prepare(chooseCategory(started.state)));
    freeze(answer(freeze(answering())).state);
    expect(state.rounds).toEqual([]);
  });
});

describe('answer acceptance and time', () => {
  it.each(
    [[], ['a', 'a'], ['unknown'], ['a', 'b']].map((selection) => ({
      selection,
    })),
  )(
    'rejects invalid single selection $selection atomically',
    ({ selection }) => {
      const state = freeze(answering());
      expect(
        transitionMatch(state, answerEvent(state, selection), {
          now: state.updatedAt,
        }),
      ).toEqual({ ok: false, state, effects: [], error: 'INVALID_ANSWER' });
    },
  );

  it('locks the first answer across devices and hides new points until close', () => {
    const state = answering(input(2));
    const first = answer(state, 'p1', ['a'], 500);
    expect(first.state.phase.type).toBe('answering');
    expect(first.state.participants.every((p) => p.score === 0)).toBe(true);
    expect(first.state.results).toEqual([]);
    const repeated = answer(first.state, 'p1', ['d'], 1000);
    expect(repeated.state).toBe(first.state);
    expect(repeated.receipt).toEqual({ ...first.receipt, repeated: true });
    expect(repeated.effects).toEqual([]);
    const closed = answer(repeated.state, 'p2', ['d'], 1000).state;
    expect(closed.participants.find((p) => p.id === 'p1')?.score).toBe(988);
    const pastRepeat = accepted(
      transitionMatch(closed, answerEvent(state, ['d'], closed.updatedAt), {
        now: closed.updatedAt,
      }),
    );
    expect(pastRepeat.receipt).toEqual({ ...first.receipt, repeated: true });
    expect(pastRepeat.state).toBe(closed);
  });

  it('accepts queued predeadline input using receive time and starts evaluation at processing time', () => {
    const state = answering();
    const phase = state.phase;
    if (phase.type !== 'answering') throw new Error('Not answering');
    const result = accepted(
      transitionMatch(state, answerEvent(state, ['a'], phase.deadline - 1), {
        now: phase.deadline + 5000,
      }),
    );
    expect(result.state.phase).toMatchObject({
      type: 'evaluation',
      startedAt: phase.deadline + 5000,
      deadline: phase.deadline + 10000,
    });
    expect(result.state.results[0]?.pointsAwarded).toBe(500);
  });

  it.each([0, 1])('rejects deadline + %s ms exactly', (offset) => {
    const state = answering();
    const phase = state.phase;
    if (phase.type !== 'answering') throw new Error('Not answering');
    expect(
      transitionMatch(
        state,
        answerEvent(state, ['a'], phase.deadline + offset),
        { now: phase.deadline + offset },
      ),
    ).toEqual({ ok: false, state, effects: [], error: 'DEADLINE_PASSED' });
  });

  it('rejects future, backdated and unsafe timestamps and answers before opening', () => {
    const state = answering();
    expect(
      transitionMatch(state, answerEvent(state, ['a'], state.updatedAt + 1), {
        now: state.updatedAt,
      }),
    ).toMatchObject({ ok: false, error: 'INVALID_TIME' });
    expect(
      transitionMatch(
        state,
        answerEvent(state, ['a'], state.phase.startedAt - 1),
        { now: state.updatedAt },
      ),
    ).toMatchObject({ ok: false, error: 'INVALID_TIME' });
    expect(
      transitionMatch(state, answerEvent(state), { now: Number.NaN }),
    ).toMatchObject({ ok: false, error: 'INVALID_TIME' });
    const countdown = prepare(timer(start()).state);
    expect(
      transitionMatch(countdown, answerEvent(countdown), {
        now: countdown.updatedAt,
      }),
    ).toMatchObject({ ok: false, error: 'QUESTION_NOT_OPEN' });
  });

  it('canonicalizes multiple-choice sets and validates ids', () => {
    let state = nextQuestion(answer(answering()).state);
    expect(answer(state, 'p1', ['b', 'a']).receipt?.selectedOptionIds).toEqual([
      'a',
      'b',
    ]);
    for (const invalid of [[], ['a', 'a'], ['x']]) {
      expect(
        transitionMatch(state, answerEvent(state, invalid), {
          now: state.updatedAt,
        }),
      ).toMatchObject({ ok: false, error: 'INVALID_ANSWER' });
    }
    state = answer(state, 'p1', ['a', 'b', 'c', 'd']).state;
    expect(state.results.at(-1)).toMatchObject({
      outcome: 'partial',
      pointsAwarded: 0,
    });
  });
});

describe('timers, preparation and category rules', () => {
  it('ignores duplicate and mismatched timers so they cannot close another question', () => {
    const state = answering();
    const phase = state.phase;
    if (phase.type !== 'answering') throw new Error('Not answering');
    const event: MatchEvent = {
      type: 'timer_elapsed',
      matchId: state.id,
      phaseId: phase.id,
      deadline: phase.deadline,
    };
    const closed = answer(state).state;
    const duplicate = send(closed, event, phase.deadline);
    expect(duplicate.state).toBe(closed);
    expect(duplicate.effects).toEqual([]);
    const next = nextQuestion(closed);
    expect(send(next, event).state).toBe(next);
    expect(send(state, { ...event, matchId: 'old-match' }).state).toBe(state);
    expect(send(state, { ...event, deadline: phase.deadline + 1 }).state).toBe(
      state,
    );
    expect(
      transitionMatch(state, event, { now: phase.deadline - 1 }),
    ).toMatchObject({ ok: false, error: 'INVALID_TIME' });
  });

  it('gives late timers a new full phase duration instead of backdating the opening', () => {
    const state = prepare(timer(start()).state);
    const late = timer(state, 10_000).state;
    expect(late.phase).toMatchObject({
      type: 'answering',
      startedAt: 19_000,
      deadline: 39_000,
    });
  });

  it('retries preparation once, ignores the old response and aborts without a winner', () => {
    const state = timer(start()).state;
    const oldPhaseId = state.phase.id;
    const retry = timer(state);
    expect(retry.state.phase).toMatchObject({
      type: 'preparing_questions',
      attempt: 2,
    });
    expect(retry.effects).toContainEqual(
      expect.objectContaining({ type: 'prepare_questions', attempt: 2 }),
    );
    const stale = send(retry.state, {
      type: 'questions_prepared',
      matchId: state.id,
      phaseId: oldPhaseId,
      receivedAt: retry.state.updatedAt,
      questions: batch(),
    });
    expect(stale.state).toBe(retry.state);
    const aborted = timer(retry.state);
    expect(aborted.state.phase).toMatchObject({
      type: 'interrupted',
      reason: 'preparation_failed',
    });
    expect(aborted.state.phase).not.toHaveProperty('standings');
    expect(aborted.effects).toContainEqual(
      expect.objectContaining({
        type: 'match_interrupted',
        reason: 'preparation_failed',
      }),
    );
    expect(timer(aborted.state).effects).toContainEqual({
      type: 'return_requested',
      result: 'interrupted',
    });
  });

  it('invalid, late and explicit failed preparation consume attempts', () => {
    const state = timer(start()).state;
    const malformed = prepare(state, [null]);
    expect(malformed.phase).toMatchObject({
      type: 'preparing_questions',
      attempt: 2,
    });
    const phase = state.phase;
    if (phase.type !== 'preparing_questions') throw new Error('Not preparing');
    const late = send(
      state,
      {
        type: 'questions_prepared',
        matchId: state.id,
        phaseId: phase.id,
        receivedAt: phase.deadline,
        questions: batch(),
      },
      phase.deadline,
    ).state;
    expect(late.phase).toMatchObject({ attempt: 2 });
    expect(
      send(malformed, {
        type: 'preparation_failed',
        matchId: state.id,
        phaseId: malformed.phase.id,
        receivedAt: malformed.updatedAt,
      }).state.phase,
    ).toMatchObject({ type: 'interrupted', reason: 'preparation_failed' });
  });

  it('keeps category timeout after the selector leaves and chooses only from the offer', () => {
    const state = timer(start(input(2, 1, 3))).state;
    expect(state.rounds[0]?.selectorId).toBe('p1');
    const left = leave(state, 'p1');
    expect(left.phase).toBe(state.phase);
    const timedOut = timer(left, 0, [0.99]).state;
    expect(timedOut.rounds[0]).toMatchObject({
      selection: { categoryId: 'c3', reason: 'timeout' },
    });
  });

  it('checks selector permission, offered categories and strict category deadline', () => {
    const state = timer(start(input(2, 1, 3))).state;
    const phase = state.phase;
    if (phase.type !== 'category_selection') throw new Error('Not selecting');
    const event: MatchEvent = {
      type: 'category_selected',
      matchId: state.id,
      phaseId: phase.id,
      participantId: 'p1',
      categoryId: 'c1',
      receivedAt: phase.startedAt,
    };
    expect(
      transitionMatch(
        state,
        { ...event, participantId: 'p2' },
        { now: state.updatedAt },
      ),
    ).toMatchObject({ ok: false, error: 'FORBIDDEN' });
    expect(
      transitionMatch(
        state,
        { ...event, categoryId: 'missing' },
        { now: state.updatedAt },
      ),
    ).toMatchObject({ ok: false, error: 'INVALID_CATEGORIES' });
    expect(
      transitionMatch(
        state,
        { ...event, receivedAt: phase.deadline },
        { now: phase.deadline },
      ),
    ).toMatchObject({ ok: false, error: 'DEADLINE_PASSED' });
    expect(
      accepted(
        transitionMatch(
          state,
          { ...event, receivedAt: phase.deadline - 1 },
          { now: phase.deadline + 1000 },
        ),
      ).state.phase.type,
    ).toBe('preparing_questions');
  });

  it.each(
    [[], [1], [-0.1], [Number.NaN], [0, 0, 0, 0]].map((random) => ({ random })),
  )(
    'rejects invalid or missing randomness $random without partial state/effects',
    ({ random }) => {
      const state = start(input(2, 1, 6));
      const phase = state.phase;
      if (!('deadline' in phase)) throw new Error('No timer');
      expect(
        transitionMatch(
          state,
          {
            type: 'timer_elapsed',
            matchId: state.id,
            phaseId: phase.id,
            deadline: phase.deadline,
          },
          { now: phase.deadline, random },
        ),
      ).toEqual({
        ok: false,
        state,
        effects: [],
        error: 'INVALID_RANDOM_INPUT',
      });
    },
  );
});

describe('idle, presence and irreversible leave', () => {
  it('keeps the question open when the last waited player leaves but an idle participant remains', () => {
    let state = answering(input(2, 2, 3));
    for (let number = 1; number <= 5; number++) {
      state = timer(answer(state, 'p1').state).state;
      if (number < 5) state = nextQuestion(state);
    }
    state = timer(prepare(chooseCategory(timer(state).state))).state;
    state = leave(state, 'p1');
    expect(state.participants.find((p) => p.id === 'p1')?.leftAt).toBe(
      state.updatedAt,
    );
    expect(state.phase).toMatchObject({
      type: 'answering',
      waitingParticipantIds: [],
    });
    const resumed = answer(state, 'p2');
    expect(resumed.state.phase.type).toBe('answering');
    const closed = timer(resumed.state).state;
    expect(closed.results.at(-1)).toMatchObject({
      participantId: 'p2',
      pointsAwarded: 1000,
    });
    expect(nextQuestion(closed).phase).toMatchObject({
      waitingParticipantIds: ['p2'],
    });
  });
  it('becomes idle after five unanswered questions; empty wait list stays open through reactivation', () => {
    let state = answering(input(1, 2, 3));
    for (let number = 1; number <= 5; number++) {
      state = timer(state).state;
      if (number < 5) state = nextQuestion(state);
    }
    expect(state.participants[0]).toMatchObject({
      activity: 'idle',
      missedQuestions: 5,
    });
    state = send(state, {
      type: 'presence_changed',
      matchId: state.id,
      participantId: 'p1',
      presence: 'offline',
    }).state;
    state = send(state, {
      type: 'presence_changed',
      matchId: state.id,
      participantId: 'p1',
      presence: 'online',
    }).state;
    expect(state.participants[0]?.activity).toBe('idle');
    state = timer(state).state;
    expect(state.phase.type).toBe('preparing_questions');
    expect(state.rounds[1]).toMatchObject({
      selectorId: null,
      selection: { reason: 'all_idle' },
    });
    state = timer(prepare(state)).state;
    expect(state.phase).toMatchObject({
      type: 'answering',
      waitingParticipantIds: [],
    });
    const submitted = answer(state, 'p1', ['a'], 1000);
    expect(submitted.state.phase).toMatchObject({
      type: 'answering',
      waitingParticipantIds: [],
    });
    expect(submitted.state.participants[0]).toMatchObject({
      activity: 'active',
      missedQuestions: 0,
      score: 0,
    });
    const closed = timer(submitted.state).state;
    expect(closed.results.at(-1)?.pointsAwarded).toBe(975);
    expect(nextQuestion(closed).phase).toMatchObject({
      type: 'answering',
      waitingParticipantIds: ['p1'],
    });
  });

  it('does not add an idle responder to a nonempty wait list during the current question', () => {
    let state = answering(input(2, 2, 3));
    for (let number = 1; number <= 5; number++) {
      state = answer(state, 'p1').state;
      state = timer(state).state;
      if (number < 5) state = nextQuestion(state);
    }
    state = timer(prepare(chooseCategory(timer(state).state))).state;
    expect(state.phase).toMatchObject({ waitingParticipantIds: ['p1'] });
    state = answer(state, 'p2').state;
    expect(state.phase).toMatchObject({
      type: 'answering',
      waitingParticipantIds: ['p1'],
    });
    const closed = answer(state, 'p1').state;
    expect(closed.phase.type).toBe('evaluation');
    expect(nextQuestion(closed).phase).toMatchObject({
      waitingParticipantIds: ['p1', 'p2'],
    });
  });

  it('preserves accepted answers on leave, records no future results and prohibits return', () => {
    let state = answering(input(3));
    state = answer(state, 'p1').state;
    state = leave(state, 'p1');
    const unchanged = leave(state, 'p1');
    expect(unchanged).toBe(state);
    expect(
      transitionMatch(state, answerEvent(state), { now: state.updatedAt }),
    ).toMatchObject({ ok: false, error: 'PARTICIPANT_LEFT' });
    state = leave(state, 'p2');
    expect(state.phase).toMatchObject({ waitingParticipantIds: ['p3'] });
    state = answer(state, 'p3', ['d']).state;
    expect(
      state.results.filter((result) => result.participantId === 'p1'),
    ).toHaveLength(1);
    expect(state.participants.find((p) => p.id === 'p1')?.score).toBe(1000);
    expect(state.results.some((result) => result.participantId === 'p2')).toBe(
      false,
    );
    for (let number = 2; number <= 5; number++)
      state = answer(nextQuestion(state), 'p3').state;
    state = timer(state).state;
    expect(
      state.results.filter((result) => result.participantId === 'p1'),
    ).toHaveLength(1);
    expect(state.participants.find((p) => p.id === 'p2')?.missedQuestions).toBe(
      0,
    );
    expect(state.phase).toMatchObject({
      type: 'finished',
      standings: expect.arrayContaining([
        expect.objectContaining({ participantId: 'p1', score: 1000 }),
      ]),
    });
  });

  it('last leave interrupts, preserves previously accepted answers and never declares a winner', () => {
    let state = answer(answering(input(2)), 'p1').state;
    state = leave(state, 'p1');
    state = leave(state, 'p2');
    expect(state.phase).toMatchObject({
      type: 'interrupted',
      reason: 'all_participants_left',
    });
    expect(state.phase).not.toHaveProperty('standings');
    expect(state.results).toHaveLength(1);
    expect(state.results[0]).toMatchObject({
      participantId: 'p1',
      pointsAwarded: 1000,
    });
    expect(timer(state).state.phase).toMatchObject({
      type: 'returned',
      result: 'interrupted',
      reason: 'all_participants_left',
    });
    expect(leave(answering(), 'p1').results).toEqual([]);
  });

  it('offline participants still count; presence does not change waiting or activity', () => {
    const state = answering(input(2));
    const offline = send(state, {
      type: 'presence_changed',
      matchId: state.id,
      participantId: 'p2',
      presence: 'offline',
    }).state;
    expect(offline.phase).toBe(state.phase);
    expect(answer(offline, 'p1').state.phase.type).toBe('answering');
    const interrupted = send(offline, {
      type: 'match_interrupted',
      matchId: state.id,
      reason: 'server_shutdown',
    }).state;
    expect(interrupted.phase).toMatchObject({
      type: 'interrupted',
      reason: 'server_shutdown',
    });
    expect(
      send(interrupted, {
        type: 'match_interrupted',
        matchId: state.id,
        reason: 'server_shutdown',
      }).effects,
    ).toEqual([]);
  });
});
