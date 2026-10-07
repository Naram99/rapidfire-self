import type { AnswerReceipt } from './messages.js';
import type { GameSettings, Scope } from './commands.js';

export type PublicCategory = Readonly<{
  id: string;
  name: string;
  language: string;
}>;
export type PublicQuestion = Readonly<{
  id: string;
  text: string;
  language: string;
  type: 'single' | 'multiple';
  options: readonly Readonly<{ id: string; text: string }>[];
}>;
export type PublicResult = Readonly<{
  participantId: string;
  questionId: string;
  roundNumber: number;
  questionNumber: number;
  questionType: 'single' | 'multiple';
  optionCount: number;
  correctOptionCount: number;
  selectedCorrectCount: number;
  selectedIncorrectCount: number;
  outcome: 'correct' | 'partial' | 'incorrect' | 'unanswered';
  pointsAwarded: number;
}>;
export type PublicStanding = Readonly<{
  participantId: string;
  score: number;
  rank: number;
}>;
export type PersistenceStatus =
  | 'not_configured'
  | 'not_saved_guest'
  | 'pending'
  | 'retrying'
  | 'saved'
  | 'failed';
type PhaseBase = Readonly<{ id: string }>;
export type ClosureReason =
  | 'left'
  | 'room_deleted'
  | 'solo_returned'
  | 'offline_timeout'
  | 'authentication_timeout'
  | 'access_revoked';
type QuestionLocation = Readonly<{
  roundId: string;
  roundNumber: number;
  questionNumber: number;
  category: PublicCategory;
}>;
export type PublicPhase = PhaseBase &
  (
    | Readonly<{ type: 'lobby'; lobbyCycleId: string }>
    | Readonly<{ type: 'start_countdown'; deadline: number }>
    | Readonly<{
        type: 'category_selection';
        deadline: number;
        roundId: string;
        roundNumber: number;
        offeredCategories: readonly PublicCategory[];
        selectorParticipantId: string | null;
      }>
    | Readonly<{
        type: 'preparing_questions';
        deadline: number;
        category: PublicCategory;
        roundId: string;
        attempt: 1 | 2;
      }>
    | (QuestionLocation &
        Readonly<{ type: 'question_countdown'; deadline: number }>)
    | (QuestionLocation &
        Readonly<{
          type: 'answering';
          deadline: number;
          openedAt: number;
          question: PublicQuestion;
        }>)
    | (QuestionLocation &
        Readonly<{
          type: 'evaluation';
          deadline: number;
          question: PublicQuestion;
          correctOptionIds: readonly string[];
          results: readonly PublicResult[];
        }>)
    | Readonly<{
        type: 'finished';
        deadline: number;
        standings: readonly PublicStanding[];
        results: readonly PublicResult[];
      }>
    | Readonly<{
        type: 'interrupted';
        deadline: number;
        reason:
          'preparation_failed' | 'all_participants_left' | 'server_shutdown';
        results: readonly PublicResult[];
      }>
    | Readonly<{ type: 'closed'; reason: ClosureReason }>
  );
export type PublicRoom = Readonly<{
  id: string;
  code: string;
  ownerMemberId: string;
  settings: GameSettings;
  settingsVersion: number;
  lobbyCycleId: string;
  members: readonly Readonly<{
    id: string;
    name: string;
    order: number;
    ready: boolean;
    presence: 'online' | 'offline';
    authentication: 'valid' | 'required';
    graceDeadline: number | null;
  }>[];
}>;
export type PublicMatch = Readonly<{
  id: string;
  mode: 'solo' | 'multiplayer';
  settings: GameSettings;
  persistence: Readonly<{ status: PersistenceStatus; revision: number }>;
  participants: readonly Readonly<{
    id: string;
    name: string;
    order: number;
    score: number;
    presence: 'online' | 'offline';
    activity: 'active' | 'idle';
    participation: 'playing' | 'left';
    answered: boolean;
  }>[];
}>;
export type Permissions = Readonly<{
  canReady: boolean;
  canUpdateSettings: boolean;
  canSelectCategory: boolean;
  canSubmitAnswer: boolean;
  canLeave: boolean;
  requiresAuthentication: boolean;
}>;
export type Snapshot = Readonly<{
  protocolVersion: number;
  scope: Scope;
  stateVersion: number;
  serverTime: number;
  phase: PublicPhase;
  room: PublicRoom | null;
  match: PublicMatch | null;
  recentResult: Readonly<{
    matchId: string;
    persistence: Readonly<{ status: PersistenceStatus; revision: number }>;
  }> | null;
  self: Readonly<{
    memberId: string | null;
    participantId: string | null;
    answer: AnswerReceipt | null;
  }>;
  permissions: Permissions;
}>;
