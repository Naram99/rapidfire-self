import { describe, expect, it, vi } from 'vitest';
import { parseQuestionBatch } from '@rapidfire/game-engine';
import type { Checkpoint, QuestionProvider } from '../src/application/ports.js';
import { staticQuestions } from '../src/infrastructure/static-questions.js';
import {
  choose,
  createRoom,
  harness,
  questionBatch,
  success,
} from './game-helpers.js';

describe('game topics', () => {
  it('keeps the selected topic in snapshots, preparation and checkpoints', async () => {
    const saves: Checkpoint[] = [];
    const prepare = vi.fn<QuestionProvider['prepare']>(async (request) =>
      questionBatch(request.matchId, request.categoryId),
    );
    const h = harness({
      prepare,
      persistence: {
        save: async (job) => {
          saves.push(job);
        },
      },
    });
    const player = await h.client('u1');
    success(
      await player.send('solo:start', {
        settings: {
          topicId: 'league-of-legends',
          rounds: 1,
          answerTimeMs: 20000,
        },
      }),
    );
    expect(player.latest().match?.settings.topicId).toBe('league-of-legends');
    await h.advance(5000);
    await choose(player);
    await h.settle();
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 'league-of-legends',
        categoryId: 'c1',
      }),
    );
    expect(saves[0]?.match.settings.topicId).toBe('league-of-legends');
  });

  it('rejects unknown topics before creating a room', async () => {
    const h = harness();
    const player = await h.client('u1');
    const ack = await player.send('room:create', {
      settings: { topicId: 'unknown', rounds: 1, answerTimeMs: 20000 },
    });
    expect(ack).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    expect(player.snapshots).toHaveLength(0);
  });

  it('limits creation and settings updates to the selected topic category count', async () => {
    const categories = vi.fn<QuestionProvider['categories']>(() => [
      { id: 'c1', name: 'One category', language: 'en' },
    ]);
    const h = harness({ categories });
    const player = await h.client('u1');
    expect(
      await player.send('solo:start', {
        settings: {
          topicId: 'league-of-legends',
          rounds: 2,
          answerTimeMs: 20000,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    const room = await createRoom(player);
    expect(
      await player.send('room:settings:update', {
        roomId: room.id,
        expectedSettingsVersion: 1,
        settings: {
          topicId: 'league-of-legends',
          rounds: 2,
          answerTimeMs: 20000,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect(categories).toHaveBeenCalledWith('league-of-legends');
    expect(player.latest().room?.settings.rounds).toBe(1);
  });

  it('provides valid fixed League of Legends examples for each round category', async () => {
    const categories = staticQuestions.categories('league-of-legends');
    expect(categories.map((category) => category.id)).toEqual([
      'champions',
      'summoners-rift',
      'items-and-spells',
    ]);
    for (const category of categories) {
      const questions = await staticQuestions.prepare({
        topicId: 'league-of-legends',
        matchId: 'm1',
        roundId: 'r1',
        categoryId: category.id,
        attempt: 1,
        signal: new AbortController().signal,
      });
      expect(parseQuestionBatch(questions, category.id, [])).not.toBeNull();
    }
  });
});
