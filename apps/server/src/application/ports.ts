import type { Scope, Snapshot } from '@rapidfire/contracts';
import type {
  Category,
  MatchState,
  Participant,
  QuestionResult,
  Standing,
} from '@rapidfire/game-engine';

export type Person = Readonly<{
  id: string;
  name: string;
  kind: 'user' | 'guest';
}>;
export type Access = Readonly<{ person: Person; expiresAt: number }> &
  (
    | Readonly<{ type: 'session'; emailVerified: boolean }>
    | Readonly<{ type: 'match'; matchId: string }>
  );
export type Clock = Readonly<{ now: () => number }>;
export type TimerPort = Readonly<{
  schedule: (key: string, deadline: number, callback: () => void) => void;
  cancel: (key: string) => void;
}>;
export type QuestionProvider = Readonly<{
  categories: readonly Category[];
  prepare: (
    request: Readonly<{
      matchId: string;
      roundId: string;
      categoryId: string;
      attempt: 1 | 2;
      signal: AbortSignal;
    }>,
  ) => Promise<unknown>;
}>;
export type MatchRecord = Readonly<{
  id: string;
  mode: MatchState['mode'];
  settings: MatchState['settings'];
  startedAt: number | null;
  endedAt: number | null;
  status: 'in_progress' | 'completed' | 'interrupted';
  interruptionReason: string | null;
  participants: readonly Readonly<{
    id: string;
    personId: string;
    name: string;
    order: number;
    score: number;
    participation: Participant['participation'];
    leftAt: number | null;
  }>[];
  results: readonly QuestionResult[];
  standings: readonly Standing[];
}>;
export type Checkpoint = Readonly<{
  match: MatchRecord;
  revision: number;
  kind: 'start' | 'question' | 'final';
}>;
export type PersistencePort = Readonly<{
  save: (checkpoint: Checkpoint) => Promise<void>;
}>;
export type Dependencies = Readonly<{
  clock: Clock;
  timers: TimerPort;
  questions: QuestionProvider;
  id: () => string;
  roomCode: () => string;
  random: () => readonly number[];
  persistence: PersistencePort | null;
  onError: (code: string) => void;
  onMatchStarted: (matchId: string, personIds: readonly string[]) => void;
  onGuestFinished: (personId: string) => void;
}>;
export type Delivery = (snapshot: Snapshot) => void;
export type Connection = {
  revoked: boolean;
  id: string;
  access: Access;
  deliver: Delivery;
  grant: Readonly<{ scope: Scope; matchId: string }> | null;
};
export type Viewer = Readonly<{
  personId: string;
  freshSession: boolean;
  canRead: boolean;
}>;
