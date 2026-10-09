import { PROTOCOL_VERSION } from '@rapidfire/contracts';
import type { GameSettings } from '@rapidfire/contracts';
import type {
  ClosureReason,
  PersistenceStatus,
  PublicCategory,
  PublicMatch,
  PublicPhase,
  PublicQuestion,
  Scope,
  Snapshot,
} from '@rapidfire/contracts';
import type { MatchState, Question } from '@rapidfire/game-engine';
import { graceDeadline } from './lobby.js';
import type { RoomState } from './lobby.js';
import type { Person, Viewer } from './ports.js';

export type Binding = Readonly<{
  person: Person;
  participantId: string;
  identityState?: 'deleted_user';
}>;
export type PersistenceView = Readonly<{
  status: PersistenceStatus;
  revision: number;
}>;
function publicQuestion(question: Question): PublicQuestion {
  return {
    id: question.id,
    text: question.text,
    language: question.language,
    type: question.type,
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
    })),
  };
}
function category(state: MatchState, id: string): PublicCategory {
  const item = state.categories.find((entry) => entry.id === id);
  if (!item) throw new Error('Projection invariant: category missing');
  return { id: item.id, name: item.name, language: item.language };
}
export function matchPhase(state: MatchState): PublicPhase {
  const phase = state.phase;
  switch (phase.type) {
    case 'start_countdown':
      return { type: phase.type, id: phase.id, deadline: phase.deadline };
    case 'finished':
      return {
        type: phase.type,
        id: phase.id,
        deadline: phase.deadline,
        standings: phase.standings.map((standing) => ({ ...standing })),
        results: state.results.map((result) => ({ ...result })),
      };
    case 'interrupted':
      return {
        type: phase.type,
        id: phase.id,
        deadline: phase.deadline,
        reason: phase.reason,
        results: state.results.map((result) => ({ ...result })),
      };
    case 'returned':
      throw new Error('Projection invariant: controller must handle return');
  }
  const round = state.rounds.find((item) => item.id === phase.roundId);
  if (!round) throw new Error('Projection invariant: round missing');
  if (phase.type === 'category_selection')
    return {
      type: phase.type,
      id: phase.id,
      deadline: phase.deadline,
      roundId: round.id,
      roundNumber: round.number,
      offeredCategories: round.offeredCategoryIds.map((id) =>
        category(state, id),
      ),
      selectorParticipantId: round.selectorId,
    };
  if (round.status === 'choosing')
    throw new Error('Projection invariant: category not selected');
  const chosenCategory = category(state, round.selection.categoryId);
  if (phase.type === 'preparing_questions')
    return {
      type: phase.type,
      id: phase.id,
      deadline: phase.deadline,
      roundId: round.id,
      category: chosenCategory,
      attempt: phase.attempt,
    };
  const location = {
    roundId: round.id,
    roundNumber: round.number,
    questionNumber: phase.questionNumber,
    category: chosenCategory,
  };
  if (phase.type === 'question_countdown')
    return {
      ...location,
      type: phase.type,
      id: phase.id,
      deadline: phase.deadline,
    };
  if (round.status !== 'prepared')
    throw new Error('Projection invariant: round not prepared');
  const question = round.questions[phase.questionNumber - 1];
  if (!question) throw new Error('Projection invariant: question missing');
  if (phase.type === 'answering')
    return {
      ...location,
      type: phase.type,
      id: phase.id,
      deadline: phase.deadline,
      openedAt: phase.startedAt,
      question: publicQuestion(question),
    };
  return {
    ...location,
    type: phase.type,
    id: phase.id,
    deadline: phase.deadline,
    question: publicQuestion(question),
    correctOptionIds: [...question.correctOptionIds],
    results: state.results
      .filter((result) => result.questionId === question.id)
      .map((result) => ({ ...result })),
  };
}
export function projectSnapshot(
  scope: Scope,
  version: number,
  now: number,
  viewer: Viewer,
  room: RoomState | null,
  state: MatchState | null,
  bindings: readonly Binding[],
  persistence: PersistenceView,
  settings: GameSettings | null,
): Snapshot {
  if (state && !settings)
    throw new Error('Projection invariant: match settings missing');
  const member = room?.members.find(
    (item) => item.person.id === viewer.personId,
  );
  const participantId =
    bindings.find((binding) => binding.person.id === viewer.personId)
      ?.participantId ?? null;
  const phase: PublicPhase = state
    ? matchPhase(state)
    : {
        type: 'lobby',
        id: room?.lobbyCycleId ?? '',
        lobbyCycleId: room?.lobbyCycleId ?? '',
      };
  const questionId =
    phase.type === 'answering' || phase.type === 'evaluation'
      ? phase.question.id
      : null;
  const ownAnswer = state?.answers.find(
    (answer) =>
      answer.participantId === participantId &&
      answer.questionId === questionId,
  );
  const match: PublicMatch | null =
    state && settings
      ? {
          id: state.id,
          mode: state.mode,
          settings: { ...settings },
          persistence: { ...persistence },
          participants: state.participants.map((participant) => ({
            id: participant.id,
            name: participant.name,
            identityState:
              bindings.find((b) => b.participantId === participant.id)
                ?.identityState ??
              (bindings.find((b) => b.participantId === participant.id)?.person
                .kind === 'guest'
                ? 'guest'
                : 'registered'),
            order: participant.order,
            score: participant.score,
            presence: participant.presence,
            activity: participant.activity,
            participation: participant.participation,
            answered: state.answers.some(
              (answer) =>
                answer.participantId === participant.id &&
                answer.questionId === questionId,
            ),
          })),
        }
      : null;
  const lobby = !state || state.phase.type === 'start_countdown';
  return {
    protocolVersion: PROTOCOL_VERSION,
    scope: { ...scope },
    stateVersion: version,
    serverTime: now,
    phase,
    room: room
      ? {
          id: room.id,
          code: room.code,
          ownerMemberId: room.ownerId,
          settings: { ...room.settings },
          settingsVersion: room.settingsVersion,
          lobbyCycleId: room.lobbyCycleId,
          members: room.members.map((item) => ({
            id: item.id,
            name: item.person.name,
            order: item.order,
            ready: item.ready,
            presence: item.presence,
            authentication: item.authDeadline === null ? 'valid' : 'required',
            graceDeadline: graceDeadline(item),
          })),
        }
      : null,
    match,
    recentResult: null,
    self: {
      memberId: member?.id ?? null,
      participantId,
      answer: ownAnswer
        ? {
            questionId: ownAnswer.questionId,
            selectedOptionIds: [...ownAnswer.selectedOptionIds],
            receivedAt: ownAnswer.receivedAt,
            repeated: true,
          }
        : null,
    },
    permissions: {
      canReady: Boolean(room && lobby && viewer.freshSession),
      canUpdateSettings: Boolean(
        room && lobby && member?.id === room.ownerId && viewer.freshSession,
      ),
      canSelectCategory:
        phase.type === 'category_selection' &&
        phase.deadline > now &&
        phase.selectorParticipantId === participantId &&
        viewer.canRead,
      canSubmitAnswer:
        phase.type === 'answering' &&
        phase.deadline > now &&
        !ownAnswer &&
        viewer.canRead,
      canLeave: viewer.canRead,
      requiresAuthentication: lobby && !viewer.freshSession,
    },
  };
}
export function closedSnapshot(
  scope: Scope,
  version: number,
  now: number,
  reason: ClosureReason,
): Snapshot {
  return {
    protocolVersion: PROTOCOL_VERSION,
    scope: { ...scope },
    stateVersion: version,
    serverTime: now,
    phase: { id: `closed:${version}`, type: 'closed', reason },
    room: null,
    match: null,
    recentResult: null,
    self: { memberId: null, participantId: null, answer: null },
    permissions: {
      canReady: false,
      canUpdateSettings: false,
      canSelectCategory: false,
      canSubmitAnswer: false,
      canLeave: false,
      requiresAuthentication: false,
    },
  };
}
