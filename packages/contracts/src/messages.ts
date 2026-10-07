import type { CommandName, CommandPayload, Scope } from './commands.js';
import type { Snapshot, PersistenceStatus } from './snapshots.js';

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_PAYLOAD'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_GAME_ACTIVE'
  | 'ALREADY_IN_ROOM'
  | 'ALREADY_IN_MATCH'
  | 'FORBIDDEN'
  | 'STALE_STATE'
  | 'DEADLINE_EXCEEDED'
  | 'QUESTION_NOT_OPEN'
  | 'PARTICIPANT_LEFT'
  | 'REQUEST_ID_CONFLICT'
  | 'MATCH_INTERRUPTED'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'RATE_LIMITED'
  | 'SERVER_UNAVAILABLE';
export type CommandError = Readonly<{
  code: ErrorCode;
  params: Readonly<Record<string, string | number>>;
  resyncRequired: boolean;
}>;
export type ConnectionErrorData = Readonly<{
  code: ErrorCode;
  supportedProtocolVersion: number;
}>;
export type AnswerReceipt = Readonly<{
  questionId: string;
  selectedOptionIds: readonly string[];
  receivedAt: number;
  repeated: boolean;
}>;
export type AckData =
  | Readonly<{
      scope: Scope;
      stateVersion: number;
      roomCode?: string;
      matchId?: string;
      answer?: AnswerReceipt;
    }>
  | Readonly<{ serverTime: number }>;
export type Ack = Readonly<{ requestId: string | null; serverTime: number }> &
  (
    | Readonly<{ ok: true; data: AckData }>
    | Readonly<{ ok: false; error: CommandError }>
  );
export type ClientEvents = {
  [Name in CommandName]: (
    payload: CommandPayload<Name>,
    acknowledge: (ack: Ack) => void,
  ) => void;
};
export type ServerEvents = { 'state:snapshot': (snapshot: Snapshot) => void };
export const ENGLISH_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: 'Sign in to continue.',
  INVALID_PAYLOAD: 'The request contains invalid data.',
  ROOM_NOT_FOUND: 'This room is no longer available.',
  ROOM_FULL: 'This room is full.',
  ROOM_GAME_ACTIVE:
    'A game is in progress in this room. You can join once the room returns to the lobby.',
  ALREADY_IN_ROOM: 'Leave your current room before starting another game.',
  ALREADY_IN_MATCH: 'Leave your current game before starting another game.',
  FORBIDDEN: 'You cannot perform this action.',
  STALE_STATE: 'The game has changed. Synchronize and try again.',
  DEADLINE_EXCEEDED: 'The deadline has passed.',
  QUESTION_NOT_OPEN: 'This question is not open for answers.',
  PARTICIPANT_LEFT: 'You have left this game.',
  REQUEST_ID_CONFLICT:
    'This request ID was already used for a different request.',
  MATCH_INTERRUPTED: 'The game was interrupted.',
  PROTOCOL_VERSION_UNSUPPORTED: 'Refresh the page to use the current version.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  SERVER_UNAVAILABLE: 'The server is temporarily unavailable.',
};
export function errorMessage(code: string): string {
  return isErrorCode(code) ? ENGLISH_MESSAGES[code] : 'Something went wrong.';
}
function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(ENGLISH_MESSAGES, code);
}
export const ENGLISH_PERSISTENCE_MESSAGES: Readonly<
  Record<PersistenceStatus, string>
> = {
  not_configured: 'Result storage is not available yet.',
  not_saved_guest: 'Sign in before your next game to save your results.',
  pending: 'Saving results...',
  retrying: 'Retrying result storage...',
  saved: 'Results saved.',
  failed: 'Results could not be saved to your history.',
};
export const ENGLISH_OUTCOME_MESSAGES = {
  correct: 'Correct',
  partial: 'Partially correct',
  incorrect: 'Incorrect',
  unanswered: 'Unanswered',
} as const;
export const ENGLISH_INTERRUPTION_MESSAGES = {
  preparation_failed:
    'Questions could not be prepared. The game was interrupted.',
  all_participants_left: 'All participants have left the game.',
  server_shutdown: 'The server stopped. The game was interrupted.',
} as const;
