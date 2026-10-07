import { createMatch, transitionMatch } from '../src/index.js';
import type {
  MatchEvent,
  MatchInput,
  MatchState,
  Question,
  TransitionResult,
} from '../src/index.js';

export function input(
  players = 1,
  rounds = 1,
  categories = rounds,
): MatchInput {
  return {
    id: 'match-1',
    mode: players === 1 ? 'solo' : 'multiplayer',
    settings: { rounds, answerTimeMs: 20_000 },
    participants: Array.from({ length: players }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
      order: index + 1,
      presence: 'online',
    })),
    categories: Array.from({ length: categories }, (_, index) => ({
      id: `c${index + 1}`,
      name: `Category ${index + 1}`,
      language: 'en',
    })),
  };
}

export function start(data = input()): MatchState {
  const result = createMatch(data, 1_000);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

export function batch(categoryId = 'c1'): readonly Question[] {
  return Array.from({ length: 5 }, (_, index) => ({
    id: `${categoryId}-q${index + 1}`,
    categoryId,
    language: 'en',
    text: `Question ${index + 1}?`,
    type: index === 1 ? 'multiple' : 'single',
    options: [
      { id: 'a', text: 'Alpha' },
      { id: 'b', text: 'Beta' },
      { id: 'c', text: 'Gamma' },
      { id: 'd', text: 'Delta' },
    ],
    correctOptionIds: index === 1 ? ['a', 'b'] : ['a'],
  }));
}

export function accepted(
  result: TransitionResult,
): Extract<TransitionResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

export function send(
  state: MatchState,
  event: MatchEvent,
  now = state.updatedAt,
  random: readonly number[] = [0, 0, 0, 0, 0, 0],
): Extract<TransitionResult, { ok: true }> {
  return accepted(transitionMatch(state, event, { now, random }));
}

export function timer(
  state: MatchState,
  delay = 0,
  random?: readonly number[],
): Extract<TransitionResult, { ok: true }> {
  const phase = state.phase;
  if (!('deadline' in phase)) throw new Error('No timer in this phase');
  return send(
    state,
    {
      type: 'timer_elapsed',
      matchId: state.id,
      phaseId: phase.id,
      deadline: phase.deadline,
    },
    phase.deadline + delay,
    random,
  );
}

export function chooseCategory(state: MatchState): MatchState {
  const phase = state.phase;
  if (phase.type !== 'category_selection') return state;
  const round = state.rounds.find((item) => item.id === phase.roundId);
  const categoryId = round?.offeredCategoryIds[0];
  if (!round?.selectorId || !categoryId)
    throw new Error('No category selector');
  return send(state, {
    type: 'category_selected',
    matchId: state.id,
    phaseId: phase.id,
    participantId: round.selectorId,
    categoryId,
    receivedAt: state.updatedAt,
  }).state;
}

export function prepare(state: MatchState, questions?: unknown): MatchState {
  const phase = state.phase;
  if (phase.type !== 'preparing_questions') throw new Error('Not preparing');
  const round = state.rounds.find((item) => item.id === phase.roundId);
  if (!round || round.status === 'choosing')
    throw new Error('No category chosen');
  return send(state, {
    type: 'questions_prepared',
    matchId: state.id,
    phaseId: phase.id,
    receivedAt: state.updatedAt,
    questions: questions ?? batch(round.selection.categoryId),
  }).state;
}

export function answering(data = input()): MatchState {
  return timer(prepare(chooseCategory(timer(start(data)).state))).state;
}

export function currentQuestion(state: MatchState): Question {
  const phase = state.phase;
  if (
    phase.type !== 'answering' &&
    phase.type !== 'evaluation' &&
    phase.type !== 'question_countdown'
  )
    throw new Error('No current question');
  const round = state.rounds.find((item) => item.id === phase.roundId);
  const question =
    round?.status === 'prepared'
      ? round.questions[phase.questionNumber - 1]
      : undefined;
  if (!question) throw new Error('Question missing');
  return question;
}

export function answer(
  state: MatchState,
  participantId = 'p1',
  selectedOptionIds: readonly string[] = currentQuestion(state)
    .correctOptionIds,
  elapsed = 0,
): Extract<TransitionResult, { ok: true }> {
  const receivedAt = state.phase.startedAt + elapsed;
  return send(
    state,
    {
      type: 'answer_submitted',
      matchId: state.id,
      participantId,
      questionId: currentQuestion(state).id,
      selectedOptionIds,
      receivedAt,
    },
    Math.max(state.updatedAt, receivedAt),
  );
}

export function nextQuestion(state: MatchState): MatchState {
  return timer(timer(state).state).state;
}

export function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
