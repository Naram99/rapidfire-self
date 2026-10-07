import type { Ack, Snapshot } from '@rapidfire/contracts';
import type {
  Access,
  Checkpoint,
  Dependencies,
  PersistencePort,
  QuestionProvider,
  TimerPort,
} from '../src/application/ports.js';
import { GameService } from '../src/application/game-service.js';

export class ManualTimers implements TimerPort {
  now = 1_000;
  readonly timers = new Map<
    string,
    Readonly<{ deadline: number; callback: () => void }>
  >();
  schedule(key: string, deadline: number, callback: () => void): void {
    this.timers.set(key, { deadline, callback });
  }
  cancel(key: string): void {
    this.timers.delete(key);
  }
}
export function questionBatch(matchId: string, categoryId: string) {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `${matchId}:${categoryId}:q${i + 1}`,
    categoryId,
    language: 'en',
    text: `Private question ${i + 1}`,
    type: i === 1 ? 'multiple' : 'single',
    options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Option ${id}` })),
    correctOptionIds: i === 1 ? ['a', 'b'] : ['a'],
  }));
}
export function success(ack: Ack): Extract<Ack, { ok: true }> {
  if (!ack.ok) throw new Error(ack.error.code);
  return ack;
}
export function scopeOf(ack: Ack) {
  const good = success(ack);
  if (!('scope' in good.data)) throw new Error('No scope');
  return good.data.scope;
}
export function receiptOf(ack: Ack) {
  const good = success(ack);
  if (!('scope' in good.data)) throw new Error('No answer data');
  return good.data.answer;
}
export type TestClient = Readonly<{
  id: string;
  access: Access;
  snapshots: Snapshot[];
  latest: () => Snapshot;
  send: (
    name: string,
    payload?: Record<string, unknown>,
    requestId?: string,
  ) => Promise<Ack>;
}>;
export function harness(
  options: Readonly<{
    persistence?: PersistencePort;
    prepare?: QuestionProvider['prepare'];
    onMatchStarted?: Dependencies['onMatchStarted'];
    onGuestFinished?: Dependencies['onGuestFinished'];
  }> = {},
) {
  const timers = new ManualTimers();
  let id = 0;
  let connectionId = 0;
  let requestId = 0;
  let roomCode = 0;
  const errors: string[] = [];
  const saves: Checkpoint[] = [];
  const guestsFinished: string[] = [];
  const started: string[] = [];
  const dependencies: Dependencies = {
    clock: { now: () => timers.now },
    timers,
    questions: {
      categories: ['c1', 'c2', 'c3'].map((id) => ({
        id,
        name: `Category ${id}`,
        language: 'en',
      })),
      prepare:
        options.prepare ??
        (async (request) => questionBatch(request.matchId, request.categoryId)),
    },
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    roomCode: () => `AAAAA${String.fromCharCode(65 + roomCode++)}`,
    random: () => [0, 0, 0, 0, 0],
    persistence: options.persistence ?? null,
    onError: (code) => errors.push(code),
    onMatchStarted: (id, people) => {
      started.push(id);
      options.onMatchStarted?.(id, people);
    },
    onGuestFinished: (id) => {
      guestsFinished.push(id);
      options.onGuestFinished?.(id);
    },
  };
  const service = new GameService(dependencies);
  async function settle() {
    for (let i = 0; i < 8; i++) {
      await service.idle();
      await Promise.resolve();
    }
  }
  async function advance(ms: number) {
    timers.now += ms;
    for (let i = 0; i < 100; i++) {
      const due = [...timers.timers.entries()]
        .filter(([, timer]) => timer.deadline <= timers.now)
        .sort((a, b) => a[1].deadline - b[1].deadline)[0];
      if (!due) {
        await settle();
        return;
      }
      timers.timers.delete(due[0]);
      due[1].callback();
      await settle();
    }
    throw new Error('Too many due timers');
  }
  async function client(
    personId: string,
    kind: 'user' | 'guest' = 'user',
    expiresAt = 2_000_000,
    override?: Access,
  ): Promise<TestClient> {
    const access: Access = override ?? {
      type: 'session',
      person: { id: personId, name: `Name ${personId}`, kind },
      expiresAt,
      emailVerified: kind === 'user',
    };
    const snapshots: Snapshot[] = [];
    const clientId = `connection-${++connectionId}`;
    await service.connect(clientId, access, (snapshot) =>
      snapshots.push(snapshot),
    );
    return {
      id: clientId,
      access,
      snapshots,
      latest: () => {
        const latest = snapshots.at(-1);
        if (!latest) throw new Error('No snapshot');
        return latest;
      },
      send: (name, payload = {}, givenId) =>
        service.handle(clientId, name, {
          requestId: givenId ?? `request-${++requestId}`,
          ...payload,
        }),
    };
  }
  return {
    timers,
    service,
    dependencies,
    errors,
    saves,
    guestsFinished,
    started,
    client,
    advance,
    settle,
  };
}
export async function createRoom(client: TestClient) {
  const ack = success(
    await client.send('room:create', {
      settings: { rounds: 1, answerTimeMs: 20_000 },
    }),
  );
  if (!('scope' in ack.data) || !ack.data.roomCode)
    throw new Error('Room not created');
  return { id: ack.data.scope.id, code: ack.data.roomCode };
}
export async function ready(client: TestClient) {
  const room = client.latest().room;
  if (!room) throw new Error('No room');
  return client.send('room:ready', {
    roomId: room.id,
    lobbyCycleId: room.lobbyCycleId,
    ready: true,
  });
}
export async function submit(
  client: TestClient,
  selectedOptionIds: readonly string[] = ['a'],
  requestId?: string,
) {
  const snapshot = client.latest();
  const phase = snapshot.phase;
  if (phase.type !== 'answering' || !snapshot.match)
    throw new Error('Question not open');
  return client.send(
    'answer:submit',
    {
      matchId: snapshot.match.id,
      questionId: phase.question.id,
      selectedOptionIds,
    },
    requestId,
  );
}
export async function choose(client: TestClient) {
  const snapshot = client.latest();
  const phase = snapshot.phase;
  if (phase.type !== 'category_selection' || !snapshot.match)
    throw new Error('No category choice');
  return client.send('category:select', {
    matchId: snapshot.match.id,
    phaseId: phase.id,
    roundId: phase.roundId,
    categoryId: phase.offeredCategories[0]?.id,
  });
}
