import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

const audit = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const userProfile = pgTable(
  'user_profile',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    elo: integer('elo').default(1000).notNull(),
    ...audit(),
  },
  (t) => [
    check(
      'profile_nickname_length',
      sql`char_length(${t.nickname}) BETWEEN 1 AND 40`,
    ),
    check('profile_elo', sql`${t.elo} >= 0`),
  ],
);

export const gameStatus = pgTable('game_status', {
  code: text('code').primaryKey(),
});
export const game = pgTable(
  'game',
  {
    id: uuid('id').primaryKey(),
    topicId: text('topic_id'),
    mode: text('mode', { enum: ['solo', 'multiplayer'] }).notNull(),
    statusCode: text('status_code', {
      enum: ['in_progress', 'completed', 'interrupted'],
    })
      .notNull()
      .references(() => gameStatus.code),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    interruptionReason: text('interruption_reason'),
    roundCount: integer('round_count').notNull(),
    questionsPerRound: integer('questions_per_round').notNull(),
    answerTimeMs: integer('answer_time_ms').notNull(),
    startCountdownMs: integer('start_countdown_ms').notNull(),
    categorySelectionMs: integer('category_selection_ms').notNull(),
    questionCountdownMs: integer('question_countdown_ms').notNull(),
    evaluationMs: integer('evaluation_ms').notNull(),
    finalResultsMs: integer('final_results_ms').notNull(),
    rulesVersion: text('rules_version').notNull(),
    scoringVersion: text('scoring_version').notNull(),
    checkpointQuestionNumber: integer('checkpoint_question_number').notNull(),
    persistenceRevision: bigint('persistence_revision', {
      mode: 'bigint',
    }).notNull(),
    ...audit(),
  },
  (t) => [
    index('game_status_idx').on(t.statusCode),
    check('game_mode', sql`${t.mode} IN ('solo', 'multiplayer')`),
    check('game_round_count', sql`${t.roundCount} BETWEEN 1 AND 10`),
    check('game_question_count', sql`${t.questionsPerRound} = 5`),
    check(
      'game_answer_time',
      sql`${t.answerTimeMs} BETWEEN 5000 AND 60000 AND ${t.answerTimeMs} % 1000 = 0`,
    ),
    check('game_revision', sql`${t.persistenceRevision} >= 1`),
    check(
      'game_checkpoint',
      sql`${t.checkpointQuestionNumber} BETWEEN 0 AND ${t.roundCount} * ${t.questionsPerRound}`,
    ),
    check(
      'game_times',
      sql`${t.startCountdownMs} > 0 AND ${t.categorySelectionMs} > 0 AND ${t.questionCountdownMs} > 0 AND ${t.evaluationMs} > 0 AND ${t.finalResultsMs} > 0`,
    ),
    check(
      'game_status_consistent',
      sql`(
    (${t.statusCode} = 'in_progress' AND ${t.endedAt} IS NULL AND ${t.interruptionReason} IS NULL) OR
    (${t.statusCode} = 'completed' AND ${t.endedAt} IS NOT NULL AND ${t.interruptionReason} IS NULL) OR
    (${t.statusCode} = 'interrupted' AND ${t.endedAt} IS NOT NULL AND ${t.interruptionReason} IS NOT NULL)
  ) AND (${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt})`,
    ),
  ],
);
export const gameParticipant = pgTable(
  'game_participant',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    identityState: text('identity_state', {
      enum: ['registered', 'deleted_user'],
    }).notNull(),
    participantOrder: integer('participant_order').notNull(),
    participationStatus: text('participation_status', {
      enum: ['participating', 'left'],
    }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    totalScore: integer('total_score').notNull(),
    finalRank: integer('final_rank'),
    ...audit(),
  },
  (t) => [
    unique('participant_game_order').on(t.gameId, t.participantOrder),
    unique('participant_game_id').on(t.gameId, t.id),
    index('participant_game_idx').on(t.gameId),
    check('participant_order_positive', sql`${t.participantOrder} > 0`),
    check(
      'participant_score_rank',
      sql`${t.totalScore} >= 0 AND (${t.finalRank} IS NULL OR ${t.finalRank} > 0)`,
    ),
    check(
      'participant_identity',
      sql`(${t.identityState} = 'registered' AND ${t.displayName} IS NOT NULL) OR (${t.identityState} = 'deleted_user' AND ${t.displayName} IS NULL)`,
    ),
    check(
      'participant_status',
      sql`(${t.participationStatus} = 'participating' AND ${t.leftAt} IS NULL) OR (${t.participationStatus} = 'left' AND ${t.leftAt} IS NOT NULL)`,
    ),
  ],
);
export const userGame = pgTable(
  'user_game',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id').notNull(),
    participantId: uuid('participant_id').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gameId] }),
    foreignKey({
      columns: [t.gameId, t.participantId],
      foreignColumns: [gameParticipant.gameId, gameParticipant.id],
    }).onDelete('cascade'),
    index('user_game_game_idx').on(t.gameId),
  ],
);
export const gameQuestionResult = pgTable(
  'game_question_result',
  {
    participantId: uuid('participant_id')
      .notNull()
      .references(() => gameParticipant.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    questionNumber: integer('question_number').notNull(),
    questionType: text('question_type', {
      enum: ['single', 'multiple'],
    }).notNull(),
    optionCount: integer('option_count').notNull(),
    outcome: text('outcome', {
      enum: ['correct', 'partial', 'incorrect', 'unanswered'],
    }).notNull(),
    correctOptionCount: integer('correct_option_count').notNull(),
    selectedCorrectCount: integer('selected_correct_count').notNull(),
    selectedIncorrectCount: integer('selected_incorrect_count').notNull(),
    pointsAwarded: integer('points_awarded').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.participantId, t.roundNumber, t.questionNumber] }),
    check(
      'result_numbers',
      sql`${t.roundNumber} BETWEEN 1 AND 10 AND ${t.questionNumber} BETWEEN 1 AND 5`,
    ),
    check(
      'result_counts',
      sql`${t.optionCount} IN (2,4,6) AND ${t.correctOptionCount} BETWEEN 1 AND ${t.optionCount} AND ${t.selectedCorrectCount} BETWEEN 0 AND ${t.correctOptionCount} AND ${t.selectedIncorrectCount} BETWEEN 0 AND (${t.optionCount} - ${t.correctOptionCount}) AND ${t.pointsAwarded} >= 0`,
    ),
    check(
      'result_type',
      sql`(${t.questionType} = 'single' AND ${t.correctOptionCount} = 1 AND ${t.selectedCorrectCount} + ${t.selectedIncorrectCount} <= 1) OR (${t.questionType} = 'multiple' AND ${t.correctOptionCount} < ${t.optionCount})`,
    ),
    check(
      'result_outcome',
      sql`${t.outcome} IN ('correct','partial','incorrect','unanswered') AND (${t.outcome} <> 'unanswered' OR (${t.selectedCorrectCount} = 0 AND ${t.selectedIncorrectCount} = 0 AND ${t.pointsAwarded} = 0))`,
    ),
  ],
);
