import type {
  AnswerReceipt,
  Context,
  Effect,
  MatchState,
  Participant,
  PhaseData,
  Question,
  Round,
} from './types.js';
import { requireRule } from './validation.js';

/** Mutable scratch space belongs to one call; all published state is readonly. */
export type Work = {
  state: MatchState;
  now: number;
  random: readonly number[];
  randomIndex: number;
  effects: Effect[];
  receipt: AnswerReceipt | null;
};

export function createWork(state: MatchState, context: Context): Work {
  return {
    state,
    now: context.now,
    random: context.random ?? [],
    randomIndex: 0,
    effects: [],
    receipt: null,
  };
}

export function move(work: Work, data: PhaseData): void {
  const { state } = work;
  if ('deadline' in state.phase)
    work.effects.push({
      type: 'cancel_timer',
      matchId: state.id,
      phaseId: state.phase.id,
    });
  const phaseSequence = state.phaseSequence + 1;
  const phase = { ...data, id: `phase:${phaseSequence}`, startedAt: work.now };
  work.state = { ...state, phaseSequence, phase };
  if ('deadline' in phase)
    work.effects.push({
      type: 'schedule_timer',
      matchId: state.id,
      phaseId: phase.id,
      deadline: phase.deadline,
    });
}

export function choose<T>(work: Work, items: readonly T[]): T {
  if (items.length === 0)
    throw new Error('Engine invariant: cannot choose from an empty list');
  let index = 0;
  if (items.length > 1) {
    const draw = work.random[work.randomIndex++];
    requireRule(
      draw !== undefined && Number.isFinite(draw) && draw >= 0 && draw < 1,
      'INVALID_RANDOM_INPUT',
    );
    index = Math.floor(draw * items.length);
  }
  const item = items[index];
  if (item === undefined)
    throw new Error('Engine invariant: selected item missing');
  return item;
}

export function getRound(state: MatchState, id: string): Round {
  const round = state.rounds.find((item) => item.id === id);
  if (!round) throw new Error('Engine invariant: round missing');
  return round;
}

export function getQuestion(
  state: MatchState,
  roundId: string,
  number: number,
): Question {
  const round = getRound(state, roundId);
  if (round.status !== 'prepared')
    throw new Error('Engine invariant: questions not prepared');
  const question = round.questions[number - 1];
  if (!question) throw new Error('Engine invariant: question missing');
  return question;
}

export function replaceRound(work: Work, round: Round): void {
  work.state = {
    ...work.state,
    rounds: work.state.rounds.map((item) =>
      item.id === round.id ? round : item,
    ),
  };
}

export function getParticipant(state: MatchState, id: string): Participant {
  const participant = state.participants.find((item) => item.id === id);
  requireRule(participant !== undefined, 'PARTICIPANT_NOT_FOUND');
  requireRule(participant.participation !== 'left', 'PARTICIPANT_LEFT');
  return participant;
}

export function replaceParticipant(work: Work, participant: Participant): void {
  work.state = {
    ...work.state,
    participants: work.state.participants.map((item) =>
      item.id === participant.id ? participant : item,
    ),
  };
}

export function isEnded(state: MatchState): boolean {
  return (
    state.phase.type === 'finished' ||
    state.phase.type === 'interrupted' ||
    state.phase.type === 'returned'
  );
}
