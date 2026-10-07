import {
  beginRound,
  closeQuestion,
  countdownQuestion,
  failPreparation,
  finishEvaluation,
  hasEveryWaitingAnswer,
  interrupt,
  openQuestion,
  prepareRound,
} from './lifecycle.js';
import {
  createWork,
  getParticipant,
  getQuestion,
  getRound,
  isEnded,
  move,
  replaceParticipant,
  replaceRound,
  choose,
} from './transition.js';
import type { Work } from './transition.js';
import type {
  Context,
  CreateResult,
  MatchEvent,
  MatchInput,
  MatchState,
  TransitionResult,
} from './types.js';
import {
  isTimestamp,
  parseQuestionBatch,
  requireRule,
  RuleViolation,
  validateAnswer,
  validateMatchInput,
} from './validation.js';

export function createMatch(input: MatchInput, now: number): CreateResult {
  try {
    requireRule(isTimestamp(now), 'INVALID_TIME');
    validateMatchInput(input);
    const state: MatchState = {
      id: input.id,
      mode: input.mode,
      settings: { ...input.settings },
      categories: input.categories.map((category) => ({ ...category })),
      participants: input.participants.map((participant) => ({
        ...participant,
        score: 0,
        activity: 'active',
        participation: 'playing',
        leftAt: null,
        missedQuestions: 0,
      })),
      rounds: [],
      answers: [],
      results: [],
      createdAt: now,
      startedAt: null,
      endedAt: null,
      updatedAt: now,
      phaseSequence: 1,
      phase: {
        type: 'start_countdown',
        id: 'phase:1',
        startedAt: now,
        deadline: now + 5_000,
      },
    };
    return {
      ok: true,
      state,
      effects: [
        {
          type: 'schedule_timer',
          matchId: state.id,
          phaseId: state.phase.id,
          deadline: now + 5_000,
        },
      ],
    };
  } catch (error) {
    if (error instanceof RuleViolation) return { ok: false, error: error.code };
    throw error;
  }
}

/** The caller owns serialization, trusted receive timestamps, timers and randomness. */
export function transitionMatch(
  state: MatchState,
  event: MatchEvent,
  context: Context,
): TransitionResult {
  try {
    requireRule(
      isTimestamp(context.now) && context.now >= state.updatedAt,
      'INVALID_TIME',
    );
    if ('receivedAt' in event)
      requireRule(
        isTimestamp(event.receivedAt) && event.receivedAt <= context.now,
        'INVALID_TIME',
      );
    const work = createWork(state, context);
    // Stale callbacks are deliberately harmless, including those from an old match.
    if (event.matchId !== state.id) {
      if (
        event.type === 'timer_elapsed' ||
        event.type === 'questions_prepared' ||
        event.type === 'preparation_failed'
      )
        return success(work, state);
      requireRule(false, 'STALE_PHASE');
    }
    applyEvent(work, event);
    return success(work, state);
  } catch (error) {
    if (error instanceof RuleViolation)
      return { ok: false, state, effects: [], error: error.code };
    throw error;
  }
}

function success(work: Work, original: MatchState): TransitionResult {
  return {
    ok: true,
    state:
      work.state === original
        ? original
        : { ...work.state, updatedAt: work.now },
    effects: work.effects,
    receipt: work.receipt,
  };
}

function applyEvent(work: Work, event: MatchEvent): void {
  switch (event.type) {
    case 'timer_elapsed':
      return handleTimer(work, event);
    case 'questions_prepared':
    case 'preparation_failed':
      return handlePreparation(work, event);
    case 'category_selected':
      return selectCategory(work, event);
    case 'answer_submitted':
      return submitAnswer(work, event);
    case 'participant_left':
      return leave(work, event.participantId);
    case 'presence_changed': {
      requireRule(!isEnded(work.state), 'MATCH_ENDED');
      requireRule(
        event.presence === 'online' || event.presence === 'offline',
        'INVALID_PARTICIPANTS',
      );
      const participant = getParticipant(work.state, event.participantId);
      if (participant.presence !== event.presence)
        replaceParticipant(work, { ...participant, presence: event.presence });
      return;
    }
    case 'match_interrupted':
      if (!isEnded(work.state)) interrupt(work, event.reason);
      return;
  }
}

function handleTimer(
  work: Work,
  event: Extract<MatchEvent, { type: 'timer_elapsed' }>,
): void {
  const phase = work.state.phase;
  if (
    !('deadline' in phase) ||
    event.phaseId !== phase.id ||
    event.deadline !== phase.deadline
  )
    return;
  requireRule(work.now >= phase.deadline, 'INVALID_TIME');
  switch (phase.type) {
    case 'start_countdown':
      work.state = { ...work.state, startedAt: work.now };
      work.effects.push({ type: 'match_started', at: work.now });
      return beginRound(work);
    case 'category_selection': {
      const round = getRound(work.state, phase.roundId);
      return prepareRound(work, round.id, {
        categoryId: choose(work, round.offeredCategoryIds),
        reason: 'timeout',
      });
    }
    case 'preparing_questions':
      return failPreparation(work);
    case 'question_countdown':
      return openQuestion(work, phase.roundId, phase.questionNumber);
    case 'answering':
      return closeQuestion(work);
    case 'evaluation':
      return finishEvaluation(work);
    case 'finished':
    case 'interrupted': {
      const result = phase.type === 'finished' ? 'completed' : 'interrupted';
      if (phase.type === 'finished')
        move(work, {
          type: 'returned',
          result: 'completed',
          standings: phase.standings,
        });
      else
        move(work, {
          type: 'returned',
          result: 'interrupted',
          reason: phase.reason,
        });
      work.effects.push({ type: 'return_requested', result });
      return;
    }
  }
}

function selectCategory(
  work: Work,
  event: Extract<MatchEvent, { type: 'category_selected' }>,
): void {
  requireRule(!isEnded(work.state), 'MATCH_ENDED');
  const phase = work.state.phase;
  requireRule(
    phase.type === 'category_selection' && phase.id === event.phaseId,
    'STALE_PHASE',
  );
  requireRule(event.receivedAt >= phase.startedAt, 'INVALID_TIME');
  requireRule(event.receivedAt < phase.deadline, 'DEADLINE_PASSED');
  getParticipant(work.state, event.participantId);
  const round = getRound(work.state, phase.roundId);
  requireRule(round.selectorId === event.participantId, 'FORBIDDEN');
  requireRule(
    round.offeredCategoryIds.includes(event.categoryId),
    'INVALID_CATEGORIES',
  );
  prepareRound(work, round.id, {
    categoryId: event.categoryId,
    reason: 'player',
  });
}

function handlePreparation(
  work: Work,
  event: Extract<
    MatchEvent,
    { type: 'questions_prepared' | 'preparation_failed' }
  >,
): void {
  const phase = work.state.phase;
  if (phase.type !== 'preparing_questions' || phase.id !== event.phaseId)
    return;
  requireRule(event.receivedAt >= phase.startedAt, 'INVALID_TIME');
  // Expired results count as a failed attempt even if the timer callback is queued later.
  if (event.receivedAt >= phase.deadline || event.type === 'preparation_failed')
    return failPreparation(work);
  const round = getRound(work.state, phase.roundId);
  if (round.status !== 'preparing')
    throw new Error('Engine invariant: preparing round required');
  const existingIds = work.state.rounds.flatMap((item) =>
    item.status === 'prepared'
      ? item.questions.map((question) => question.id)
      : [],
  );
  const questions = parseQuestionBatch(
    event.questions,
    round.selection.categoryId,
    existingIds,
  );
  if (!questions) return failPreparation(work);
  replaceRound(work, { ...round, status: 'prepared', questions });
  countdownQuestion(work, round.id, 1);
}

function submitAnswer(
  work: Work,
  event: Extract<MatchEvent, { type: 'answer_submitted' }>,
): void {
  const participant = getParticipant(work.state, event.participantId);
  const original = work.state.answers.find(
    (answer) =>
      answer.participantId === participant.id &&
      answer.questionId === event.questionId,
  );
  if (original) {
    work.receipt = { ...original, repeated: true };
    return;
  }
  requireRule(!isEnded(work.state), 'MATCH_ENDED');
  const phase = work.state.phase;
  requireRule(phase.type === 'answering', 'QUESTION_NOT_OPEN');
  const question = getQuestion(work.state, phase.roundId, phase.questionNumber);
  requireRule(question.id === event.questionId, 'QUESTION_NOT_OPEN');
  requireRule(event.receivedAt >= phase.startedAt, 'INVALID_TIME');
  requireRule(event.receivedAt < phase.deadline, 'DEADLINE_PASSED');
  const selectedOptionIds = validateAnswer(question, event.selectedOptionIds);
  const answer = {
    participantId: participant.id,
    questionId: question.id,
    selectedOptionIds,
    receivedAt: event.receivedAt,
  };
  work.state = { ...work.state, answers: [...work.state.answers, answer] };
  replaceParticipant(work, {
    ...participant,
    activity: 'active',
    missedQuestions: 0,
  });
  work.receipt = { ...answer, repeated: false };
  if (hasEveryWaitingAnswer(work)) closeQuestion(work);
}

function leave(work: Work, participantId: string): void {
  requireRule(!isEnded(work.state), 'MATCH_ENDED');
  const known = work.state.participants.find(
    (participant) => participant.id === participantId,
  );
  requireRule(known !== undefined, 'PARTICIPANT_NOT_FOUND');
  if (known.participation === 'left') return;
  replaceParticipant(work, {
    ...known,
    participation: 'left',
    leftAt: work.now,
  });
  if (work.state.phase.type === 'answering') {
    work.state = {
      ...work.state,
      phase: {
        ...work.state.phase,
        waitingParticipantIds: work.state.phase.waitingParticipantIds.filter(
          (id) => id !== participantId,
        ),
      },
    };
  }
  if (
    work.state.participants.every(
      (participant) => participant.participation === 'left',
    )
  ) {
    // Accepted answers survive explicit leave, including the last player's leave.
    const phase = work.state.phase;
    if (phase.type === 'answering') {
      const question = getQuestion(
        work.state,
        phase.roundId,
        phase.questionNumber,
      );
      if (
        work.state.answers.some((answer) => answer.questionId === question.id)
      )
        closeQuestion(work);
    }
    interrupt(work, 'all_participants_left');
  } else if (hasEveryWaitingAnswer(work)) closeQuestion(work);
}
