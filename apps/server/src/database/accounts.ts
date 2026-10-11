import { questionGenerationRelease } from './lol-schema.js';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';
import type {
  HistoryEntry,
  HistoryParticipant,
  Profile,
} from '@rapidfire/contracts';
import { account, session, user } from './auth-schema.js';
import type { Database } from './client.js';
import {
  game,
  gameParticipant,
  gameQuestionResult,
  gameRoundGeneration,
  userGame,
  userProfile,
} from './schema.js';

export class AccountRepository {
  constructor(private readonly db: Database) {}
  async profile(userId: string): Promise<Profile | null> {
    const [row] = await this.db
      .select({
        userId: user.id,
        email: user.email,
        nickname: userProfile.nickname,
        elo: userProfile.elo,
      })
      .from(user)
      .innerJoin(userProfile, eq(userProfile.userId, user.id))
      .where(eq(user.id, userId));
    return row ?? null;
  }
  async updateNickname(userId: string, nickname: string): Promise<void> {
    await this.db
      .update(userProfile)
      .set({ nickname, updatedAt: new Date() })
      .where(eq(userProfile.userId, userId));
  }
  async revokeSessions(userId: string): Promise<void> {
    await this.db.delete(session).where(eq(session.userId, userId));
  }
  async remove(userId: string, password: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Lock the user first, matching the persistence lock order.
      const [identity] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for('update');
      if (!identity) return false;
      const [credential] = await tx
        .select({ password: account.password })
        .from(account)
        .where(
          and(eq(account.userId, userId), eq(account.providerId, 'credential')),
        )
        .for('update');
      if (
        !credential?.password ||
        !(await verifyPassword({ hash: credential.password, password }))
      )
        return false;
      // SQL trigger anonymizes multiplayer and removes solo games in this transaction;
      // FK cascades remove profile, session, account and user_game rows.
      await tx.delete(user).where(eq(user.id, userId));
      return true;
    });
  }
  async history(
    userId: string,
    limit: number,
    before?: string,
    beforeId?: string,
  ): Promise<readonly HistoryEntry[]> {
    const rows = await this.db
      .select({
        id: game.id,
        mode: game.mode,
        status: game.statusCode,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        score: gameParticipant.totalScore,
        rank: gameParticipant.finalRank,
        rounds: game.roundCount,
        topicId: game.topicId,
        answerTimeMs: game.answerTimeMs,
        releaseId: game.generationReleaseId,
        seed: game.generationSeed,
        seedOrigin: game.seedOrigin,
        eloExclusionReason: game.eloExclusionReason,
        sourceVersion: questionGenerationRelease.sourceVersion,
        releaseRevision: questionGenerationRelease.revision,
      })
      .from(userGame)
      .innerJoin(game, eq(game.id, userGame.gameId))
      .leftJoin(
        questionGenerationRelease,
        eq(questionGenerationRelease.id, game.generationReleaseId),
      )
      .innerJoin(
        gameParticipant,
        eq(gameParticipant.id, userGame.participantId),
      )
      .where(
        and(
          eq(userGame.userId, userId),
          before && beforeId
            ? or(
                lt(game.startedAt, new Date(before)),
                and(
                  eq(game.startedAt, new Date(before)),
                  lt(game.id, beforeId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(game.startedAt), desc(game.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      status: row.status,
      score: row.score,
      rank: row.rank,
      rounds: row.rounds,
      topicId: row.topicId,
      answerTimeMs: row.answerTimeMs,
      generation:
        row.releaseId &&
        row.seed &&
        row.seedOrigin &&
        row.sourceVersion &&
        row.releaseRevision
          ? {
              releaseId: row.releaseId,
              seed: row.status === 'in_progress' ? null : row.seed,
              seedOrigin: row.seedOrigin,
              eloExclusionReason: row.eloExclusionReason,
              releaseLabel:
                row.sourceVersion +
                (row.releaseRevision === 1 ? '' : ` · r${row.releaseRevision}`),
            }
          : null,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    }));
  }
  async result(userId: string, gameId: string) {
    const [membership] = await this.db
      .select()
      .from(userGame)
      .where(and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)));
    if (!membership) return null;
    const [match] = await this.db
      .select()
      .from(game)
      .where(eq(game.id, gameId));
    if (!match) return null;
    const rows = await this.db
      .select()
      .from(gameParticipant)
      .where(eq(gameParticipant.gameId, gameId))
      .orderBy(gameParticipant.participantOrder);
    const participants: HistoryParticipant[] = rows.map((p) => ({
      id: p.id,
      name: p.displayName,
      identityState: p.identityState,
      order: p.participantOrder,
      score: p.totalScore,
      rank: p.finalRank,
      participation: p.participationStatus,
    }));
    const questions = await this.db
      .select()
      .from(gameQuestionResult)
      .where(eq(gameQuestionResult.participantId, membership.participantId))
      .orderBy(
        gameQuestionResult.roundNumber,
        gameQuestionResult.questionNumber,
      );
    const [release] = match.generationReleaseId
      ? await this.db
          .select()
          .from(questionGenerationRelease)
          .where(eq(questionGenerationRelease.id, match.generationReleaseId))
      : [];
    const generation =
      release && match.generationSeed && match.seedOrigin
        ? {
            releaseId: release.id,
            releaseLabel:
              release.sourceVersion +
              (release.revision === 1 ? '' : ` · r${release.revision}`),
            seed:
              match.statusCode === 'in_progress' ? null : match.generationSeed,
            seedOrigin: match.seedOrigin,
            eloExclusionReason: match.eloExclusionReason,
          }
        : null;
    const rounds = await this.db
      .select({
        roundNumber: gameRoundGeneration.roundNumber,
        categoryId: gameRoundGeneration.categoryId,
        contentHash: gameRoundGeneration.contentHash,
      })
      .from(gameRoundGeneration)
      .where(eq(gameRoundGeneration.gameId, gameId))
      .orderBy(gameRoundGeneration.roundNumber);
    // BigInt is converted explicitly and auth IDs never appear in shared standings.
    return {
      game: {
        id: match.id,
        topicId: match.topicId,
        mode: match.mode,
        statusCode: match.statusCode,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
        roundCount: match.roundCount,
        answerTimeMs: match.answerTimeMs,
        generation,
      },
      participants,
      questions,
      rounds,
    };
  }
}
