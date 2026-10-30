import type {
  ErrorCode,
  GameSettings,
  GenerationMetadata,
  GenerationRelease,
  GenerationRound,
  GameTopic,
  Scope,
  Snapshot,
} from '@rapidfire/contracts';
import type {
  Category,
  ErrorCode as EngineError,
  MatchState,
  Participant,
  QuestionResult,
  Question,
  Standing,
} from '@rapidfire/game-engine';

export type Person = Readonly<{
  id: string;
  name: string;
  kind: 'user' | 'guest';
}>;
export type Access = Readonly<{
  person: Person;
  expiresAt: number;
  authEpoch?: number;
}> &
  (
    | Readonly<{ type: 'session'; emailVerified: boolean; sessionId?: string }>
    | Readonly<{ type: 'match'; matchId: string }>
  );
export type Clock = Readonly<{ now: () => number }>;
export type TimerPort = Readonly<{
  schedule: (key: string, deadline: number, callback: () => void) => void;
  cancel: (key: string) => void;
}>;
export type ResolvedGeneration = Omit<GenerationMetadata, 'seed'> &
  Readonly<{ seed: string }>;
export type MatchGeneration = Readonly<{
  metadata: ResolvedGeneration;
  prepare: (categoryId: string) => readonly Question[];
  categoryChoices: (
    state: MatchState,
  ) => (
    purpose: 'category-offer' | 'automatic-category',
    items: readonly string[],
  ) => number;
  rounds: (state: MatchState) => readonly GenerationRound[];
}>;
export type QuestionProvider = Readonly<{
  categories: (
    topicId: GameTopic,
    releaseId?: string | null,
  ) => readonly Category[];
  resolveSettings?: (settings: GameSettings) => GameSettings;
  createGeneration?: (settings: GameSettings) => MatchGeneration;
  releases?: () => readonly GenerationRelease[];
  defaultReleaseId?: () => string | null;
  prepare: (
    request: Readonly<{
      matchId: string;
      roundId: string;
      categoryId: string;
      topicId: GameTopic;
      attempt: 1 | 2;
      signal: AbortSignal;
    }>,
  ) => Promise<unknown>;
}>;
export type MatchRecord = Readonly<{
  id: string;
  mode: MatchState['mode'];
  settings: GameSettings;
  generation?: ResolvedGeneration | null;
  rounds?: readonly GenerationRound[];
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
export type CallbackErrorContext = Readonly<{
  scopeType: Scope['type'];
  phaseType: MatchState['phase']['type'] | 'lobby';
  phaseId: string | null;
  deadline: number | null;
  serverTime: number;
  errorCode: ErrorCode;
  engineCode?: EngineError;
}>;
export type Dependencies = Readonly<{
  clock: Clock;
  timers: TimerPort;
  questions: QuestionProvider;
  id: () => string;
  roomCode: () => string;
  random: () => readonly number[];
  persistence: PersistencePort | null;
  onError: (code: string, context?: CallbackErrorContext) => void;
  onMatchStarted: (matchId: string, personIds: readonly string[]) => void;
  onGuestFinished: (personId: string) => void;
  onMatchFinished?: (matchId: string) => void;
  onParticipantReleased?: (personId: string) => void;
  onLobbyReturned?: (personIds: readonly string[]) => void;
  onPersistenceWork?: (completion: Promise<void>) => void;
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
