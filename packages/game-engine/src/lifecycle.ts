import { rankParticipants, scoreAnswer } from './scoring.js';
import {
  choose,
  getQuestion,
  getRound,
  move,
  replaceRound,
} from './transition.js';
import type { Work } from './transition.js';
import type { InterruptionReason, QuestionResult, Selection } from './types.js';

export function beginRound(work: Work): void {
  const { state } = work;
  const used = state.rounds.flatMap((round) =>
    round.status === 'choosing' ? [] : [round.selection.categoryId],
  );
  const remaining = state.categories
    .filter((category) => !used.includes(category.id))
    .map((category) => category.id);
  const offered: string[] = [];
  if (remaining.length <= 4) offered.push(...remaining);
  else {
    const pool = [...remaining];
    for (let index = 0; index < 4; index++) {
      const category = choose(work, pool);
      offered.push(category);
      pool.splice(pool.indexOf(category), 1);
    }
  }
  const candidates = state.participants.filter(
    (p) => p.participation === 'playing' && p.activity === 'active',
  );
  const minimum = Math.min(...candidates.map((p) => p.score));
  const selector =
    offered.length > 1 && candidates.length > 0
      ? choose(
          work,
          candidates.filter((p) => p.score === minimum),
        )
      : null;
  const number = state.rounds.length + 1;
  const round = {
    id: `round:${number}`,
    number,
    offeredCategoryIds: offered,
    selectorId: selector?.id ?? null,
    status: 'choosing' as const,
  };
  work.state = { ...state, rounds: [...state.rounds, round] };
  if (offered.length === 1 || selector === null) {
    prepareRound(work, round.id, {
      categoryId: choose(work, offered),
      reason: offered.length === 1 ? 'single_option' : 'all_idle',
    });
  } else
    move(work, {
      type: 'category_selection',
      roundId: round.id,
      deadline: work.now + 15_000,
    });
}

export function prepareRound(
  work: Work,
  roundId: string,
  selection: Selection,
): void {
  const round = getRound(work.state, roundId);
  replaceRound(work, { ...round, status: 'preparing', selection });
  startPreparation(work, roundId, selection.categoryId, 1);
}

function startPreparation(
  work: Work,
  roundId: string,
  categoryId: string,
  attempt: 1 | 2,
): void {
  move(work, {
    type: 'preparing_questions',
    roundId,
    attempt,
    deadline: work.now + 15_000,
  });
  work.effects.push({
    type: 'prepare_questions',
    matchId: work.state.id,
    phaseId: work.state.phase.id,
    roundId,
    categoryId,
    attempt,
  });
}

export function failPreparation(work: Work): void {
  const phase = work.state.phase;
  if (phase.type !== 'preparing_questions')
    throw new Error('Engine invariant: preparation phase required');
  const round = getRound(work.state, phase.roundId);
  if (round.status !== 'preparing')
    throw new Error('Engine invariant: preparing round required');
  if (phase.attempt === 1)
    startPreparation(work, round.id, round.selection.categoryId, 2);
  else interrupt(work, 'preparation_failed');
}

export function countdownQuestion(
  work: Work,
  roundId: string,
  questionNumber: number,
): void {
  move(work, {
    type: 'question_countdown',
    roundId,
    questionNumber,
    deadline: work.now + 3_000,
  });
}

export function openQuestion(
  work: Work,
  roundId: string,
  questionNumber: number,
): void {
  const waitingParticipantIds = work.state.participants
    .filter((p) => p.participation === 'playing' && p.activity === 'active')
    .map((p) => p.id);
  move(work, {
    type: 'answering',
    roundId,
    questionNumber,
    waitingParticipantIds,
    deadline: work.now + work.state.settings.answerTimeMs,
  });
}

export function hasEveryWaitingAnswer(work: Work): boolean {
  const phase = work.state.phase;
  if (phase.type !== 'answering' || phase.waitingParticipantIds.length === 0)
    return false;
  const question = getQuestion(work.state, phase.roundId, phase.questionNumber);
  return phase.waitingParticipantIds.every((id) =>
    work.state.answers.some(
      (answer) =>
        answer.questionId === question.id && answer.participantId === id,
    ),
  );
}

/** Only this function awards points; closed phases cannot invoke it again. */
export function closeQuestion(work: Work): void {
  const { state } = work;
  const phase = state.phase;
  if (phase.type !== 'answering')
    throw new Error('Engine invariant: answering phase required');
  const round = getRound(state, phase.roundId);
  const question = getQuestion(state, round.id, phase.questionNumber);
  const results: QuestionResult[] = [];
  const participants = state.participants.map((participant) => {
    const answer = state.answers.find(
      (item) =>
        item.questionId === question.id &&
        item.participantId === participant.id,
    );
    if (participant.participation === 'left' && !answer) return participant;
    const score = scoreAnswer(
      question,
      answer,
      phase.startedAt,
      state.settings.answerTimeMs,
    );
    results.push({
      participantId: participant.id,
      questionId: question.id,
      roundNumber: round.number,
      questionNumber: phase.questionNumber,
      questionType: question.type,
      optionCount: question.options.length,
      correctOptionCount: question.correctOptionIds.length,
      ...score,
    });
    const missedQuestions = answer ? 0 : participant.missedQuestions + 1;
    return {
      ...participant,
      score: participant.score + score.pointsAwarded,
      missedQuestions,
      activity: missedQuestions >= 5 ? ('idle' as const) : ('active' as const),
    };
  });
  work.state = {
    ...state,
    participants,
    results: [...state.results, ...results],
  };
  work.effects.push({
    type: 'question_closed',
    roundId: round.id,
    questionId: question.id,
    results,
  });
  move(work, {
    type: 'evaluation',
    roundId: round.id,
    questionNumber: phase.questionNumber,
    deadline: work.now + 5_000,
  });
}

export function finishEvaluation(work: Work): void {
  const phase = work.state.phase;
  if (phase.type !== 'evaluation')
    throw new Error('Engine invariant: evaluation phase required');
  if (phase.questionNumber < 5)
    countdownQuestion(work, phase.roundId, phase.questionNumber + 1);
  else if (work.state.rounds.length < work.state.settings.rounds)
    beginRound(work);
  else {
    const standings = rankParticipants(work.state.participants);
    work.state = { ...work.state, endedAt: work.now };
    move(work, { type: 'finished', standings, deadline: work.now + 15_000 });
    work.effects.push({ type: 'match_completed', at: work.now, standings });
  }
}

export function interrupt(work: Work, reason: InterruptionReason): void {
  work.state = { ...work.state, endedAt: work.now };
  move(work, { type: 'interrupted', reason, deadline: work.now + 15_000 });
  work.effects.push({ type: 'match_interrupted', at: work.now, reason });
}
