import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@rapidfire/contracts';
import { snapshotSchema, ackSchema } from '@rapidfire/contracts';
import {
  acceptsSnapshot,
  applyReceipt,
  remaining,
  serverNow,
} from '../src/lib/game-state';

const answering: Snapshot = {
  protocolVersion: 1,
  scope: { type: 'match', id: 'match1' },
  stateVersion: 10,
  serverTime: 1000,
  phase: {
    type: 'answering',
    id: 'phase1',
    deadline: 21000,
    openedAt: 1000,
    roundId: 'round1',
    roundNumber: 1,
    questionNumber: 1,
    category: { id: 'category1', name: 'Science', language: 'en' },
    question: {
      id: 'question1',
      text: 'A question?',
      type: 'single',
      language: 'en',
      options: [
        { id: 'a', text: 'First' },
        { id: 'b', text: 'Second' },
      ],
    },
  },
  room: null,
  match: null,
  recentResult: null,
  self: { memberId: null, participantId: 'player1', answer: null },
  permissions: {
    canReady: false,
    canUpdateSettings: false,
    canSelectCategory: false,
    canSubmitAnswer: true,
    canLeave: true,
    requiresAuthentication: false,
  },
};
const receipt = {
  questionId: 'question1',
  selectedOptionIds: ['a'],
  receivedAt: 1500,
  repeated: false,
};

describe('browser canonical game state', () => {
  it('derives deadlines from monotonic time and never shows negative time', () => {
    const anchor = { serverTime: 1000, monotonicTime: 200 };
    expect(serverNow(anchor, 1200)).toBe(2000);
    expect(remaining(2500, anchor, 1200)).toBe(500);
    expect(remaining(1500, anchor, 1200)).toBe(0);
    expect(serverNow(anchor, 100)).toBe(1000);
  });
  it('rejects older versions in the same scope and older snapshots from another scope', () => {
    expect(
      acceptsSnapshot(answering, {
        ...answering,
        stateVersion: 9,
        serverTime: 2000,
      }),
    ).toBe(false);
    expect(acceptsSnapshot(answering, { ...answering, stateVersion: 10 })).toBe(
      true,
    );
    expect(
      acceptsSnapshot(answering, {
        ...answering,
        scope: { type: 'room', id: 'room1' },
        serverTime: 999,
      }),
    ).toBe(false);
    expect(acceptsSnapshot(null, answering)).toBe(true);
  });
  it('locks the first accepted answer without letting a repeated or late acknowledgement replace it', () => {
    const locked = applyReceipt(answering, receipt);
    expect(locked?.permissions.canSubmitAnswer).toBe(false);
    expect(locked?.self.answer?.selectedOptionIds).toEqual(['a']);
    expect(
      applyReceipt(locked, {
        ...receipt,
        selectedOptionIds: ['b'],
        repeated: true,
      }),
    ).toBe(locked);
    expect(
      applyReceipt(answering, { ...receipt, questionId: 'previous-question' }),
    ).toBe(answering);
    const next: Snapshot = {
      ...answering,
      phase: { type: 'closed', id: 'closed1', reason: 'left' },
    };
    expect(applyReceipt(next, receipt)).toBe(next);
  });
});
describe('server response validation', () => {
  it('rejects incompatible versions, missing permissions and malformed questions', () => {
    expect(snapshotSchema.safeParse(answering).success).toBe(true);
    expect(
      snapshotSchema.safeParse({ ...answering, protocolVersion: 2 }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({ ...answering, permissions: {} }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({
        ...answering,
        phase: { ...answering.phase, question: {} },
      }).success,
    ).toBe(false);
  });
  it('drops question payloads during the countdown and hidden answer keys during answering', () => {
    const countdown = snapshotSchema.parse({
      ...answering,
      phase: { ...answering.phase, type: 'question_countdown' },
    });
    expect(countdown.phase).not.toHaveProperty('question');
    const decoded = snapshotSchema.parse({
      ...answering,
      phase: { ...answering.phase, correctOptionIds: ['a'] },
    });
    expect(decoded.phase).not.toHaveProperty('correctOptionIds');
  });
  it('validates acknowledgement data without accepting arbitrary error codes', () => {
    const accepted = {
      requestId: 'request1',
      serverTime: 1000,
      ok: true,
      data: { scope: answering.scope, stateVersion: 10, answer: receipt },
    };
    expect(ackSchema.safeParse(accepted).success).toBe(true);
    expect(ackSchema.safeParse({ ...accepted, data: {} }).success).toBe(false);
    expect(
      ackSchema.safeParse({
        ...accepted,
        ok: false,
        error: { code: 'UNKNOWN', params: {}, resyncRequired: false },
      }).success,
    ).toBe(false);
  });
});
