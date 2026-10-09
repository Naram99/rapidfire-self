import { z } from 'zod';
import {
  gameTopicSchema,
  PROTOCOL_VERSION,
  settingsSchema,
} from './commands.js';
import type { Ack, ErrorCode } from './messages.js';
import type { Snapshot } from './snapshots.js';

const id = z.string().min(1).max(128);
const time = z.number().finite();
const count = z.number().int().nonnegative();
const scope = z.object({ type: z.enum(['room', 'match']), id });
const persistence = z.object({
  status: z.enum([
    'not_configured',
    'not_saved_guest',
    'pending',
    'retrying',
    'saved',
    'failed',
  ]),
  revision: count,
});
const category = z.object({ id, name: z.string(), language: z.string() });
const question = z.object({
  id,
  text: z.string(),
  language: z.string(),
  type: z.enum(['single', 'multiple']),
  options: z
    .array(z.object({ id, text: z.string() }))
    .min(2)
    .max(6),
});
const outcome = z.enum(['correct', 'partial', 'incorrect', 'unanswered']);
const result = z.object({
  participantId: id,
  questionId: id,
  roundNumber: count,
  questionNumber: count,
  questionType: z.enum(['single', 'multiple']),
  optionCount: count,
  correctOptionCount: count,
  selectedCorrectCount: count,
  selectedIncorrectCount: count,
  outcome,
  pointsAwarded: count,
});
const standing = z.object({
  participantId: id,
  score: count,
  rank: z.number().int().positive(),
});
const receipt = z.object({
  questionId: id,
  selectedOptionIds: z.array(id).min(1).max(6),
  receivedAt: time,
  repeated: z.boolean(),
});
const location = {
  roundId: id,
  roundNumber: count,
  questionNumber: count,
  category,
};
const timed = { id, deadline: time };

export const snapshotSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  scope,
  stateVersion: count,
  serverTime: time,
  phase: z.discriminatedUnion('type', [
    z.object({ type: z.literal('lobby'), id, lobbyCycleId: id }),
    z.object({ type: z.literal('start_countdown'), ...timed }),
    z.object({
      type: z.literal('category_selection'),
      ...timed,
      roundId: id,
      roundNumber: count,
      offeredCategories: z.array(category),
      selectorParticipantId: id.nullable(),
    }),
    z.object({
      type: z.literal('preparing_questions'),
      ...timed,
      roundId: id,
      category,
      attempt: z.union([z.literal(1), z.literal(2)]),
    }),
    z.object({ type: z.literal('question_countdown'), ...timed, ...location }),
    z.object({
      type: z.literal('answering'),
      ...timed,
      ...location,
      openedAt: time,
      question,
    }),
    z.object({
      type: z.literal('evaluation'),
      ...timed,
      ...location,
      question,
      correctOptionIds: z.array(id),
      results: z.array(result),
    }),
    z.object({
      type: z.literal('finished'),
      ...timed,
      standings: z.array(standing),
      results: z.array(result),
    }),
    z.object({
      type: z.literal('interrupted'),
      ...timed,
      reason: z.enum([
        'preparation_failed',
        'all_participants_left',
        'server_shutdown',
      ]),
      results: z.array(result),
    }),
    z.object({
      type: z.literal('closed'),
      id,
      reason: z.enum([
        'left',
        'room_deleted',
        'solo_returned',
        'offline_timeout',
        'authentication_timeout',
        'access_revoked',
      ]),
    }),
  ]),
  room: z
    .object({
      id,
      code: z.string().regex(/^[A-Z2-9]{6}$/),
      ownerMemberId: id,
      settings: settingsSchema,
      settingsVersion: count,
      lobbyCycleId: id,
      members: z
        .array(
          z.object({
            id,
            name: z.string(),
            order: count,
            ready: z.boolean(),
            presence: z.enum(['online', 'offline']),
            authentication: z.enum(['valid', 'required']),
            graceDeadline: time.nullable(),
          }),
        )
        .max(10),
    })
    .nullable(),
  match: z
    .object({
      id,
      mode: z.enum(['solo', 'multiplayer']),
      settings: settingsSchema,
      persistence,
      participants: z
        .array(
          z.object({
            id,
            name: z.string(),
            identityState: z.enum(['registered', 'guest', 'deleted_user']),
            order: count,
            score: count,
            presence: z.enum(['online', 'offline']),
            activity: z.enum(['active', 'idle']),
            participation: z.enum(['playing', 'left']),
            answered: z.boolean(),
          }),
        )
        .max(10),
    })
    .nullable(),
  recentResult: z.object({ matchId: id, persistence }).nullable(),
  self: z.object({
    memberId: id.nullable(),
    participantId: id.nullable(),
    answer: receipt.nullable(),
  }),
  permissions: z.object({
    canReady: z.boolean(),
    canUpdateSettings: z.boolean(),
    canSelectCategory: z.boolean(),
    canSubmitAnswer: z.boolean(),
    canLeave: z.boolean(),
    requiresAuthentication: z.boolean(),
  }),
}) satisfies z.ZodType<Snapshot>;

const errorCode = z.enum([
  'AUTH_REQUIRED',
  'INVALID_PAYLOAD',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_GAME_ACTIVE',
  'ALREADY_IN_ROOM',
  'ALREADY_IN_MATCH',
  'FORBIDDEN',
  'STALE_STATE',
  'DEADLINE_EXCEEDED',
  'QUESTION_NOT_OPEN',
  'PARTICIPANT_LEFT',
  'REQUEST_ID_CONFLICT',
  'MATCH_INTERRUPTED',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'RATE_LIMITED',
  'SERVER_UNAVAILABLE',
]) satisfies z.ZodType<ErrorCode>;
const ackBase = { requestId: id.nullable(), serverTime: time };
export const ackSchema = z.discriminatedUnion('ok', [
  z.object({
    ...ackBase,
    ok: z.literal(true),
    data: z.union([
      z
        .object({
          scope,
          stateVersion: count,
          roomCode: z.string().optional(),
          matchId: id.optional(),
          answer: receipt.optional(),
        })
        .transform(({ roomCode, matchId, answer, ...value }) => ({
          ...value,
          ...(roomCode === undefined ? {} : { roomCode }),
          ...(matchId === undefined ? {} : { matchId }),
          ...(answer === undefined ? {} : { answer }),
        })),
      z.object({ serverTime: time }),
    ]),
  }),
  z.object({
    ...ackBase,
    ok: z.literal(false),
    error: z.object({
      code: errorCode,
      params: z.record(z.string(), z.union([z.string(), z.number()])),
      resyncRequired: z.boolean(),
    }),
  }),
]) satisfies z.ZodType<Ack>;

export const profileSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  nickname: z.string().min(1).max(40),
  elo: count,
});
export const gameConfigResponseSchema = z.object({
  topics: z
    .array(
      z.object({
        id: gameTopicSchema,
        maxRounds: z.number().int().min(1).max(10),
      }),
    )
    .min(1),
});
export const sessionResponseSchema = z
  .object({
    user: profileSchema,
    session: z.object({
      id: z.uuid(),
      expiresAt: z.iso.datetime(),
      renewAfterSeconds: z.number().positive(),
    }),
  })
  .nullable();
export const guestResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  renewAfterSeconds: z.number().positive(),
  guest: z.object({ nickname: z.string() }).optional(),
});
export const historyEntrySchema = z.object({
  topicId: id.nullable(),
  id: z.uuid(),
  mode: z.enum(['solo', 'multiplayer']),
  status: z.enum(['in_progress', 'completed', 'interrupted']),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  score: count,
  rank: z.number().int().positive().nullable(),
  rounds: count,
  answerTimeMs: count,
});
export const historyResponseSchema = z.object({
  games: z.array(historyEntrySchema),
});
export const gameResultResponseSchema = z.object({
  game: z.object({
    topicId: id.nullable(),
    id: z.uuid(),
    mode: z.enum(['solo', 'multiplayer']),
    statusCode: z.enum(['in_progress', 'completed', 'interrupted']),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    roundCount: count,
    answerTimeMs: count,
  }),
  participants: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().nullable(),
      identityState: z.enum(['registered', 'deleted_user']),
      order: count,
      score: count,
      rank: z.number().int().positive().nullable(),
      participation: z.enum(['participating', 'left']),
    }),
  ),
  questions: z.array(
    z.object({
      participantId: z.uuid(),
      roundNumber: count,
      questionNumber: count,
      questionType: z.enum(['single', 'multiple']),
      optionCount: count,
      outcome,
      correctOptionCount: count,
      selectedCorrectCount: count,
      selectedIncorrectCount: count,
      pointsAwarded: count,
    }),
  ),
});
export type GameResultResponse = z.infer<typeof gameResultResponseSchema>;
