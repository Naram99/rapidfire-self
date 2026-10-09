import { eq, inArray, sql } from 'drizzle-orm';
import type { Checkpoint, PersistencePort } from '../application/ports.js';
import { user } from './auth-schema.js';
import type { Database } from './client.js';
import {
  game,
  gameParticipant,
  gameQuestionResult,
  userGame,
} from './schema.js';

export class PostgresPersistence implements PersistencePort {
  constructor(private readonly db: Database) {}
  async save({ match, revision }: Checkpoint): Promise<void> {
    if (match.participants.length === 0) return;
    if (
      match.startedAt === null ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      throw new Error('INVALID_CHECKPOINT');
    const startedAt = new Date(match.startedAt);
    await this.db.transaction(async (tx) => {
      // PostgreSQL 17 bounds the whole checkpoint, including lock waits and
      // many individually successful statements, rather than just one query.
      await tx.execute(
        sql`SELECT set_config('transaction_timeout', '5s', true)`,
      );
      // Lock existing identities before the match. User deletion then cannot race
      // between checking identity and creating its foreign-key relationship.
      const alive = await tx
        .select({ id: user.id })
        .from(user)
        .where(
          inArray(
            user.id,
            match.participants.map((p) => p.personId),
          ),
        )
        .orderBy(user.id)
        .for('key share');
      const identities = new Set(alive.map((row) => row.id));
      if (
        match.mode === 'solo' &&
        !identities.has(match.participants[0]?.personId ?? '')
      )
        return;
      // Serializes even the first insert, where no row exists to lock yet.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${match.id}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(game)
        .where(eq(game.id, match.id));
      if (
        existing &&
        (existing.persistenceRevision >= BigInt(revision) ||
          existing.statusCode !== 'in_progress')
      )
        return;
      const now = new Date();
      const values = {
        id: match.id,
        topicId: match.settings.topicId,
        mode: match.mode,
        statusCode: match.status,
        startedAt,
        endedAt: match.endedAt === null ? null : new Date(match.endedAt),
        interruptionReason: match.interruptionReason,
        roundCount: match.settings.rounds,
        questionsPerRound: 5,
        answerTimeMs: match.settings.answerTimeMs,
        startCountdownMs: 5000,
        categorySelectionMs: 15000,
        questionCountdownMs: 3000,
        evaluationMs: 5000,
        finalResultsMs: 15000,
        rulesVersion: '1',
        scoringVersion: '1',
        checkpointQuestionNumber: Math.max(
          0,
          ...match.results.map(
            (r) => (r.roundNumber - 1) * 5 + r.questionNumber,
          ),
        ),
        persistenceRevision: BigInt(revision),
        updatedAt: now,
      };
      await tx
        .insert(game)
        .values(values)
        .onConflictDoUpdate({ target: game.id, set: values });
      for (const participant of match.participants) {
        const registered = identities.has(participant.personId);
        const data = {
          id: participant.id,
          gameId: match.id,
          displayName: registered ? participant.name : null,
          identityState: registered ? 'registered' : 'deleted_user',
          participantOrder: participant.order,
          participationStatus:
            participant.participation === 'left' ? 'left' : 'participating',
          leftAt:
            participant.leftAt === null ? null : new Date(participant.leftAt),
          totalScore: participant.score,
          finalRank:
            match.standings.find((s) => s.participantId === participant.id)
              ?.rank ?? null,
          updatedAt: now,
        } satisfies typeof gameParticipant.$inferInsert;
        await tx
          .insert(gameParticipant)
          .values(data)
          .onConflictDoUpdate({ target: gameParticipant.id, set: data });
        if (registered)
          await tx
            .insert(userGame)
            .values({
              userId: participant.personId,
              gameId: match.id,
              participantId: participant.id,
            })
            .onConflictDoNothing();
      }
      const participantIds = new Set(match.participants.map((p) => p.id));
      // questionId, selected option IDs, text, options and response time never reach SQL.
      for (const result of match.results) {
        if (!participantIds.has(result.participantId)) continue;
        const { questionId: _questionId, ...summary } = result;
        await tx
          .insert(gameQuestionResult)
          .values(summary)
          .onConflictDoUpdate({
            target: [
              gameQuestionResult.participantId,
              gameQuestionResult.roundNumber,
              gameQuestionResult.questionNumber,
            ],
            set: summary,
          });
      }
    });
  }
}

export async function interruptAbandonedGames(
  db: Database,
  now = new Date(),
): Promise<number> {
  const rows = await db
    .update(game)
    .set({
      statusCode: 'interrupted',
      interruptionReason: 'server_restart',
      endedAt: now,
      updatedAt: now,
      persistenceRevision: sql`${game.persistenceRevision} + 1`,
    })
    .where(eq(game.statusCode, 'in_progress'))
    .returning({ id: game.id });
  return rows.length;
}
