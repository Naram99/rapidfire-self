export type Category = Readonly<{ id: string; name: string; language: string }>;
export type Option = Readonly<{ id: string; text: string }>;
export type Question = Readonly<{
  id: string;
  categoryId: string;
  language: string;
  text: string;
  type: 'single' | 'multiple';
  options: readonly Option[];
  correctOptionIds: readonly string[];
}>;
export type Settings = Readonly<{ rounds: number; answerTimeMs: number }>;
export type ParticipantSeed = Readonly<{
  id: string;
  name: string;
  order: number;
  presence: 'online' | 'offline';
}>;
export type Participant = ParticipantSeed &
  Readonly<{
    score: number;
    activity: 'active' | 'idle';
    missedQuestions: number;
  }> &
  (
    | Readonly<{ participation: 'playing'; leftAt: null }>
    | Readonly<{ participation: 'left'; leftAt: number }>
  );
export type Selection = Readonly<{
  categoryId: string;
  reason: 'player' | 'single_option' | 'all_idle' | 'timeout';
}>;
export type Round = Readonly<{
  id: string;
  number: number;
  offeredCategoryIds: readonly string[];
  selectorId: string | null;
}> &
  (
    | Readonly<{ status: 'choosing' }>
    | Readonly<{ status: 'preparing'; selection: Selection }>
    | Readonly<{
        status: 'prepared';
        selection: Selection;
        questions: readonly Question[];
      }>
  );
export type Standing = Readonly<{
  participantId: string;
  score: number;
  rank: number;
}>;
export type InterruptionReason =
  'preparation_failed' | 'all_participants_left' | 'server_shutdown';
type PhaseBase = Readonly<{ id: string; startedAt: number }>;
export type PhaseData =
  | Readonly<{ type: 'start_countdown'; deadline: number }>
  | Readonly<{ type: 'category_selection'; roundId: string; deadline: number }>
  | Readonly<{
      type: 'preparing_questions';
      roundId: string;
      attempt: 1 | 2;
      deadline: number;
    }>
  | Readonly<{
      type: 'question_countdown';
      roundId: string;
      questionNumber: number;
      deadline: number;
    }>
  | Readonly<{
      type: 'answering';
      roundId: string;
      questionNumber: number;
      deadline: number;
      waitingParticipantIds: readonly string[];
    }>
  | Readonly<{
      type: 'evaluation';
      roundId: string;
      questionNumber: number;
      deadline: number;
    }>
  | Readonly<{
      type: 'finished';
      standings: readonly Standing[];
      deadline: number;
    }>
  | Readonly<{
      type: 'interrupted';
      reason: InterruptionReason;
      deadline: number;
    }>
  | Readonly<{
      type: 'returned';
      result: 'completed';
      standings: readonly Standing[];
    }>
  | Readonly<{
      type: 'returned';
      result: 'interrupted';
      reason: InterruptionReason;
    }>;
export type Phase = PhaseBase & PhaseData;
export type AcceptedAnswer = Readonly<{
  participantId: string;
  questionId: string;
  selectedOptionIds: readonly string[];
  receivedAt: number;
}>;
export type Outcome = 'correct' | 'partial' | 'incorrect' | 'unanswered';
export type QuestionResult = Readonly<{
  participantId: string;
  questionId: string;
  roundNumber: number;
  questionNumber: number;
  questionType: Question['type'];
  optionCount: number;
  correctOptionCount: number;
  selectedCorrectCount: number;
  selectedIncorrectCount: number;
  outcome: Outcome;
  pointsAwarded: number;
}>;
export type MatchState = Readonly<{
  id: string;
  mode: 'solo' | 'multiplayer';
  settings: Settings;
  categories: readonly Category[];
  participants: readonly Participant[];
  rounds: readonly Round[];
  answers: readonly AcceptedAnswer[];
  results: readonly QuestionResult[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  phaseSequence: number;
  phase: Phase;
}>;
export type MatchInput = Readonly<{
  id: string;
  mode: MatchState['mode'];
  settings: Settings;
  categories: readonly Category[];
  participants: readonly ParticipantSeed[];
}>;
export type Context = Readonly<{ now: number; random?: readonly number[] }>;
type EventBase = Readonly<{ matchId: string }>;
type Received = Readonly<{ receivedAt: number }>;
export type MatchEvent = EventBase &
  (
    | Readonly<{ type: 'timer_elapsed'; phaseId: string; deadline: number }>
    | (Received &
        Readonly<{
          type: 'category_selected';
          phaseId: string;
          participantId: string;
          categoryId: string;
        }>)
    | (Received &
        Readonly<{
          type: 'questions_prepared';
          phaseId: string;
          questions: unknown;
        }>)
    | (Received & Readonly<{ type: 'preparation_failed'; phaseId: string }>)
    | (Received &
        Readonly<{
          type: 'answer_submitted';
          participantId: string;
          questionId: string;
          selectedOptionIds: readonly string[];
        }>)
    | Readonly<{ type: 'participant_left'; participantId: string }>
    | Readonly<{
        type: 'presence_changed';
        participantId: string;
        presence: Participant['presence'];
      }>
    | Readonly<{ type: 'match_interrupted'; reason: 'server_shutdown' }>
  );
export type Effect =
  | Readonly<{
      type: 'schedule_timer';
      matchId: string;
      phaseId: string;
      deadline: number;
    }>
  | Readonly<{ type: 'cancel_timer'; matchId: string; phaseId: string }>
  | Readonly<{
      type: 'prepare_questions';
      matchId: string;
      phaseId: string;
      roundId: string;
      categoryId: string;
      attempt: 1 | 2;
    }>
  | Readonly<{ type: 'match_started'; at: number }>
  | Readonly<{
      type: 'question_closed';
      roundId: string;
      questionId: string;
      results: readonly QuestionResult[];
    }>
  | Readonly<{
      type: 'match_completed';
      at: number;
      standings: readonly Standing[];
    }>
  | Readonly<{
      type: 'match_interrupted';
      at: number;
      reason: InterruptionReason;
    }>
  | Readonly<{ type: 'return_requested'; result: 'completed' | 'interrupted' }>;
export type ErrorCode =
  | 'INVALID_SETTINGS'
  | 'INVALID_PARTICIPANTS'
  | 'INVALID_CATEGORIES'
  | 'INVALID_TIME'
  | 'INVALID_RANDOM_INPUT'
  | 'INVALID_ANSWER'
  | 'PARTICIPANT_NOT_FOUND'
  | 'PARTICIPANT_LEFT'
  | 'FORBIDDEN'
  | 'STALE_PHASE'
  | 'DEADLINE_PASSED'
  | 'QUESTION_NOT_OPEN'
  | 'MATCH_ENDED';
export type AnswerReceipt = AcceptedAnswer & Readonly<{ repeated: boolean }>;
export type TransitionResult =
  | Readonly<{
      ok: true;
      state: MatchState;
      effects: readonly Effect[];
      receipt: AnswerReceipt | null;
    }>
  | Readonly<{
      ok: false;
      state: MatchState;
      effects: readonly [];
      error: ErrorCode;
    }>;
export type CreateResult =
  | Readonly<{ ok: true; state: MatchState; effects: readonly Effect[] }>
  | Readonly<{ ok: false; error: ErrorCode }>;
