import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Checkpoint } from '../src/application/ports.js';
import { AccountRepository } from '../src/database/accounts.js';
import {
  account,
  session,
  user,
  verification,
} from '../src/database/auth-schema.js';
import { migrateDatabase } from '../src/database/migrate.js';
import {
  interruptAbandonedGames,
  PostgresPersistence,
} from '../src/database/persistence.js';
import {
  game,
  gameParticipant,
  gameQuestionResult,
  userGame,
  userProfile,
} from '../src/database/schema.js';
import { isolatedDatabase } from './isolated-database.js';

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  await database?.close();
});
async function identity() {
  const id = randomUUID();
  await database.db.insert(user).values({
    id,
    name: 'Original nickname',
    email: `${id}@example.com`,
    emailVerified: true,
  });
  await database.db.insert(account).values({
    id: randomUUID(),
    accountId: id,
    providerId: 'credential',
    userId: id,
    password: await hashPassword('Password1!'),
    updatedAt: new Date(),
  });
  return id;
}
function checkpoint(
  userIds: readonly string[],
  mode: 'solo' | 'multiplayer' = 'multiplayer',
): Checkpoint {
  return {
    revision: 1,
    kind: 'start',
    match: {
      id: randomUUID(),
      mode,
      settings: {
        topicId: 'league-of-legends',
        rounds: 1,
        answerTimeMs: 20000,
      },
      startedAt: Date.now() - 1000,
      endedAt: null,
      status: 'in_progress',
      interruptionReason: null,
      participants: userIds.map((personId, index) => ({
        id: randomUUID(),
        personId,
        name: 'Personal name',
        order: index + 1,
        score: 0,
        participation: 'playing',
        leftAt: null,
      })),
      results: [],
      standings: [],
    },
  };
}
function final(start: Checkpoint, revision = 2): Checkpoint {
  return {
    ...start,
    revision,
    kind: 'final',
    match: {
      ...start.match,
      status: 'completed',
      endedAt: Date.now(),
      participants: start.match.participants.map((p) => ({ ...p, score: 678 })),
      standings: start.match.participants.map((p) => ({
        participantId: p.id,
        score: 678,
        rank: 1,
      })),
      results: start.match.participants.map((p) => ({
        participantId: p.id,
        questionId: 'never-store-this-id',
        roundNumber: 1,
        questionNumber: 1,
        questionType: 'single',
        optionCount: 4,
        correctOptionCount: 1,
        selectedCorrectCount: 1,
        selectedIncorrectCount: 0,
        outcome: 'correct',
        pointsAwarded: 678,
      })),
    },
  };
}

describe('real PostgreSQL domain transactions', () => {
  it('bounds a blocked checkpoint and recovers on a later attempt', async () => {
    const start = checkpoint([await identity()]);
    let locked: (() => void) | undefined;
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('idle_in_transaction_session_timeout', '10s', true)`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${start.match.id}, 0))`,
      );
      locked?.();
      await gate;
    });
    await ready;
    const adapter = new PostgresPersistence(database.db);
    try {
      await expect(adapter.save(start)).rejects.toThrow();
    } finally {
      release?.();
      await blocker;
    }
    expect(
      await database.db.select().from(game).where(eq(game.id, start.match.id)),
    ).toEqual([]);
    await adapter.save(start);
    expect(
      await database.db.select().from(game).where(eq(game.id, start.match.id)),
    ).toHaveLength(1);
  });
  it('migrates repeatedly, creates a profile atomically and enforces composite ownership', async () => {
    await migrateDatabase(database.db);
    const id = await identity();
    expect(await new AccountRepository(database.db).profile(id)).toEqual({
      userId: id,
      email: `${id}@example.com`,
      nickname: 'Original nickname',
      elo: 1000,
    });
    await expect(
      database.db.insert(user).values({
        id: randomUUID(),
        name: 'x'.repeat(41),
        email: `${randomUUID()}@example.com`,
      }),
    ).rejects.toThrow();
    const start = checkpoint([id]);
    const other = checkpoint([id]);
    const adapter = new PostgresPersistence(database.db);
    await adapter.save(start);
    await adapter.save(other);
    const p = start.match.participants[0];
    if (!p) throw new Error('No participant');
    await expect(
      database.db.insert(userGame).values({
        userId: await identity(),
        gameId: other.match.id,
        participantId: p.id,
      }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(gameParticipant).values({
        id: randomUUID(),
        gameId: start.match.id,
        displayName: 'duplicate',
        identityState: 'registered',
        participantOrder: p.order,
        participationStatus: 'participating',
        totalScore: 0,
      }),
    ).rejects.toThrow();
  });
  it('saves final snapshots without earlier checkpoints, is idempotent and rejects stale or post-final saves', async () => {
    const start = checkpoint([await identity(), await identity()]);
    const adapter = new PostgresPersistence(database.db);
    await Promise.all([
      adapter.save(final(start, 5)),
      adapter.save(final(start, 5)),
    ]);
    await adapter.save(start);
    await adapter.save({ ...start, revision: 99 });
    const [saved] = await database.db
      .select()
      .from(game)
      .where(eq(game.id, start.match.id));
    expect(saved).toMatchObject({
      statusCode: 'completed',
      topicId: 'league-of-legends',
      persistenceRevision: 5n,
      checkpointQuestionNumber: 1,
    });
    const participants = await database.db
      .select()
      .from(gameParticipant)
      .where(eq(gameParticipant.gameId, start.match.id));
    expect(participants.map((p) => [p.totalScore, p.finalRank])).toEqual([
      [678, 1],
      [678, 1],
    ]);
    const result = await new AccountRepository(database.db).result(
      start.match.participants[0]?.personId ?? '',
      start.match.id,
    );
    expect(result?.questions).toHaveLength(1);
    expect(result?.game.topicId).toBe('league-of-legends');
    const repository = new AccountRepository(database.db);
    const ownerId = start.match.participants[0]?.personId ?? '';
    expect((await repository.history(ownerId, 20))[0]?.topicId).toBe(
      'league-of-legends',
    );
    // Old sample matches have no topic; displaying history must preserve that distinction.
    await database.db
      .update(game)
      .set({ topicId: null })
      .where(eq(game.id, start.match.id));
    expect((await repository.history(ownerId, 20))[0]?.topicId).toBeNull();
    expect(
      (await repository.result(ownerId, start.match.id))?.game.topicId,
    ).toBeNull();
    expect(JSON.stringify(result)).not.toContain('never-store-this-id');
    expect(
      await new AccountRepository(database.db).result(
        await identity(),
        start.match.id,
      ),
    ).toBeNull();
  });
  it('rolls back every row on an invalid result; a subsequent valid snapshot can repair a missing checkpoint', async () => {
    const start = checkpoint([await identity()]);
    const valid = final(start);
    const adapter = new PostgresPersistence(database.db);
    const invalid: Checkpoint = {
      ...valid,
      match: {
        ...valid.match,
        results: valid.match.results.map((r) => ({
          ...r,
          selectedCorrectCount: 3,
        })),
      },
    };
    await expect(adapter.save(invalid)).rejects.toThrow();
    expect(
      await database.db.select().from(game).where(eq(game.id, start.match.id)),
    ).toEqual([]);
    await adapter.save(valid);
    expect(
      await database.db.select().from(game).where(eq(game.id, start.match.id)),
    ).toHaveLength(1);
  });
  it('deletes auth/profile/solo data and anonymizes multiplayer; late checkpoints cannot restore names or solo games', async () => {
    const deleted = await identity();
    const other = await identity();
    const multi = checkpoint([deleted, other]);
    const solo = checkpoint([deleted], 'solo');
    const adapter = new PostgresPersistence(database.db);
    await adapter.save(multi);
    await adapter.save(solo);
    await database.db.insert(session).values({
      id: randomUUID(),
      userId: deleted,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 100000),
      updatedAt: new Date(),
    });
    await database.db.insert(verification).values({
      identifier: `reset-password:${randomUUID()}`,
      value: deleted,
      expiresAt: new Date(Date.now() + 100000),
    });
    const repository = new AccountRepository(database.db);
    expect(await repository.remove(deleted, 'wrong-password')).toBe(false);
    expect(await repository.remove(deleted, 'Password1!')).toBe(true);
    await Promise.all([adapter.save(final(multi)), adapter.save(final(solo))]);
    expect(
      await database.db.select().from(user).where(eq(user.id, deleted)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(userProfile)
        .where(eq(userProfile.userId, deleted)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(account)
        .where(eq(account.userId, deleted)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(session)
        .where(eq(session.userId, deleted)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(verification)
        .where(eq(verification.value, deleted)),
    ).toEqual([]);
    expect(
      await database.db.select().from(game).where(eq(game.id, solo.match.id)),
    ).toEqual([]);
    const result = await repository.result(other, multi.match.id);
    expect(result?.participants[0]).toMatchObject({
      identityState: 'deleted_user',
      name: null,
      score: 678,
    });
    expect(await repository.result(deleted, multi.match.id)).toBeNull();
    const p = multi.match.participants[0];
    expect(
      await database.db
        .select()
        .from(gameQuestionResult)
        .where(eq(gameQuestionResult.participantId, p?.id ?? '')),
    ).toHaveLength(1);
  });
  it('serializes deletion against concurrent persistence and interrupts abandoned games only once', async () => {
    const id = await identity();
    const multi = checkpoint([id, await identity()]);
    const adapter = new PostgresPersistence(database.db);
    await adapter.save(multi);
    await Promise.all([
      adapter.save({ ...multi, revision: 2, kind: 'question' }),
      new AccountRepository(database.db).remove(id, 'Password1!'),
    ]);
    const rows = await database.db
      .select()
      .from(gameParticipant)
      .where(eq(gameParticipant.id, multi.match.participants[0]?.id ?? ''));
    expect(rows[0]).toMatchObject({
      displayName: null,
      identityState: 'deleted_user',
    });
    expect(await interruptAbandonedGames(database.db)).toBeGreaterThan(0);
    expect(await interruptAbandonedGames(database.db)).toBe(0);
    await adapter.save(final(multi, 100));
    const [saved] = await database.db
      .select()
      .from(game)
      .where(eq(game.id, multi.match.id));
    expect(saved).toMatchObject({
      statusCode: 'interrupted',
      interruptionReason: 'server_restart',
    });
    const invalidNames = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM game_participant WHERE identity_state = 'deleted_user' AND display_name IS NOT NULL`,
    );
    expect(invalidNames.rows[0]?.count).toBe(0);
  });
});
