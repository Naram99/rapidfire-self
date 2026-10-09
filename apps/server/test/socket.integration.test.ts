import { PROTOCOL_VERSION } from '@rapidfire/contracts';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { io as clientSocket } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type {
  ClientEvents,
  ServerEvents,
  Snapshot,
} from '@rapidfire/contracts';
import type { Access } from '../src/application/ports.js';
import { createGameServer } from '../src/bootstrap/create-server.js';
import { harness, success } from './game-helpers.js';

type Client = Socket<ServerEvents, ClientEvents>;
async function network() {
  const h = harness();
  const credentials = new Map<string, Access>();
  let authCalls = 0;
  const server = createGameServer({
    service: h.service,
    allowedOrigins: ['http://test.local'],
    authenticate: async (headers) => {
      authCalls++;
      return credentials.get(headers.authorization ?? '') ?? null;
    },
  });
  await new Promise<void>((resolve) =>
    server.httpServer.listen(0, '127.0.0.1', resolve),
  );
  const address = server.httpServer.address();
  if (!address || typeof address === 'string')
    throw new Error('No server address');
  const url = `http://127.0.0.1:${address.port}`;
  const clients: Client[] = [];
  function socket(personId?: string, version = PROTOCOL_VERSION) {
    const credential = `Bearer ${randomUUID()}`;
    if (personId)
      credentials.set(credential, {
        type: 'session',
        person: { id: personId, name: `Name ${personId}`, kind: 'user' },
        expiresAt: 2_000_000,
        emailVerified: true,
      });
    const client: Client = clientSocket(url, {
      autoConnect: false,
      auth: { protocolVersion: version },
      extraHeaders: { authorization: credential },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    const snapshots: Snapshot[] = [];
    client.on('state:snapshot', (snapshot) => snapshots.push(snapshot));
    clients.push(client);
    return {
      client,
      snapshots,
      latest: () => {
        const result = snapshots.at(-1);
        if (!result) throw new Error('No snapshot');
        return result;
      },
    };
  }
  async function connected(personId: string) {
    const result = socket(personId);
    await new Promise<void>((resolve, reject) => {
      result.client.once('connect', resolve);
      result.client.once('connect_error', reject);
      result.client.connect();
    });
    return result;
  }
  async function cleanup() {
    for (const client of clients) client.disconnect();
    await h.service.shutdown();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  }
  return { ...h, url, socket, connected, cleanup, authCalls: () => authCalls };
}

describe('actual Socket.IO transport', () => {
  it('rejects mismatched protocol, missing credentials and untrusted browser origins', async () => {
    const n = await network();
    try {
      const mismatch = n.socket('u1', 1);
      const before = n.authCalls();
      const versionError = new Promise<string>((resolve) =>
        mismatch.client.once('connect_error', (error) =>
          resolve(error.message),
        ),
      );
      mismatch.client.connect();
      expect(await versionError).toBe('PROTOCOL_VERSION_UNSUPPORTED');
      expect(n.authCalls()).toBe(before);
      const anonymous = n.socket();
      const authError = new Promise<string>((resolve) =>
        anonymous.client.once('connect_error', (error) =>
          resolve(error.message),
        ),
      );
      anonymous.client.connect();
      expect(await authError).toBe('AUTH_REQUIRED');
      const response = await fetch(
        `${n.url}/socket.io/?EIO=4&transport=polling`,
        { headers: { Origin: 'https://untrusted.example' } },
      );
      expect(response.status).toBe(403);
    } finally {
      await n.cleanup();
    }
  });

  it('runs a whole match over sockets; two devices share answers and receive authorized reconnect snapshots', async () => {
    const n = await network();
    try {
      const first = await n.connected('u1');
      const second = await n.connected('u1');
      const opponent = await n.connected('u2');
      const created = success(
        await first.client.timeout(2000).emitWithAck('room:create', {
          requestId: 'create',
          settings: {
            topicId: 'league-of-legends',
            rounds: 1,
            answerTimeMs: 20000,
          },
        }),
      );
      if (!('scope' in created.data) || !created.data.roomCode)
        throw new Error('No room');
      success(
        await opponent.client.timeout(2000).emitWithAck('room:join', {
          requestId: 'join',
          roomCode: created.data.roomCode,
        }),
      );
      await expect
        .poll(() => first.snapshots.at(-1)?.room?.members.length)
        .toBe(2);
      const room = first.latest().room;
      if (!room) throw new Error('No lobby');
      success(
        await first.client.timeout(2000).emitWithAck('room:ready', {
          requestId: 'ready-1',
          roomId: room.id,
          lobbyCycleId: room.lobbyCycleId,
          ready: true,
        }),
      );
      success(
        await opponent.client.timeout(2000).emitWithAck('room:ready', {
          requestId: 'ready-2',
          roomId: room.id,
          lobbyCycleId: room.lobbyCycleId,
          ready: true,
        }),
      );
      await n.advance(5000);
      await expect
        .poll(() => first.snapshots.at(-1)?.phase.type)
        .toBe('category_selection');
      const picking = first.latest();
      if (picking.phase.type !== 'category_selection' || !picking.match)
        throw new Error('No choice');
      const offered = picking.phase.offeredCategories[0];
      if (!offered) throw new Error('No categories');
      success(
        await first.client.timeout(2000).emitWithAck('category:select', {
          requestId: 'pick',
          matchId: picking.match.id,
          phaseId: picking.phase.id,
          roundId: picking.phase.roundId,
          categoryId: offered.id,
        }),
      );
      await expect
        .poll(() => first.snapshots.at(-1)?.phase.type)
        .toBe('question_countdown');
      expect(JSON.stringify(first.latest())).not.toContain('Private question');
      await n.advance(3000);
      for (let number = 1; number <= 5; number++) {
        await expect
          .poll(() => first.snapshots.at(-1)?.phase.type)
          .toBe('answering');
        const opened = first.latest();
        if (opened.phase.type !== 'answering' || !opened.match)
          throw new Error('Question not open');
        expect(JSON.stringify(opened)).not.toContain('correctOptionIds');
        const selectedOptionIds = number === 2 ? ['a', 'b'] : ['a'];
        const original = success(
          await first.client.timeout(2000).emitWithAck('answer:submit', {
            requestId: `answer-${number}`,
            matchId: opened.match.id,
            questionId: opened.phase.question.id,
            selectedOptionIds,
          }),
        );
        await expect
          .poll(() => second.snapshots.at(-1)?.self.answer?.selectedOptionIds)
          .toEqual(selectedOptionIds);
        expect(opponent.latest().self.answer).toBeNull();
        expect(
          await second.client.timeout(2000).emitWithAck('answer:submit', {
            requestId: `answer-${number}`,
            matchId: opened.match.id,
            questionId: opened.phase.question.id,
            selectedOptionIds: [...selectedOptionIds].reverse(),
          }),
        ).toEqual(original);
        success(
          await opponent.client.timeout(2000).emitWithAck('answer:submit', {
            requestId: `wrong-${number}`,
            matchId: opened.match.id,
            questionId: opened.phase.question.id,
            selectedOptionIds: ['d'],
          }),
        );
        await expect
          .poll(() => first.snapshots.at(-1)?.phase.type)
          .toBe('evaluation');
        await n.advance(5000);
        if (number < 5) await n.advance(3000);
      }
      await expect
        .poll(() => first.snapshots.at(-1)?.phase.type)
        .toBe('finished');
      expect(first.latest().match?.participants[0]?.score).toBe(5000);
      first.client.disconnect();
      const back = await n.connected('u1');
      await expect
        .poll(() => back.snapshots.at(-1)?.phase.type)
        .toBe('finished');
      await n.advance(15000);
      await expect.poll(() => back.snapshots.at(-1)?.phase.type).toBe('lobby');
      success(
        await back.client
          .timeout(2000)
          .emitWithAck('room:leave', { requestId: 'leave', roomId: room.id }),
      );
      await expect
        .poll(() => second.snapshots.at(-1)?.phase.type)
        .toBe('closed');
      expect(second.latest().phase).toMatchObject({ reason: 'left' });
      expect(n.errors).toEqual([]);
    } finally {
      await n.cleanup();
    }
  });
});
