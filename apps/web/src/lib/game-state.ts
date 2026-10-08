import type { AnswerReceipt, Snapshot } from '@rapidfire/contracts';

export type ClockAnchor = Readonly<{
  serverTime: number;
  monotonicTime: number;
}>;
export const serverNow = (anchor: ClockAnchor, now: number) =>
  anchor.serverTime + Math.max(0, now - anchor.monotonicTime);
export const remaining = (deadline: number, anchor: ClockAnchor, now: number) =>
  Math.max(0, deadline - serverNow(anchor, now));

export function acceptsSnapshot(
  previous: Snapshot | null,
  incoming: Snapshot,
): boolean {
  if (!previous) return true;
  const same =
    previous.scope.id === incoming.scope.id &&
    previous.scope.type === incoming.scope.type;
  return same
    ? incoming.stateVersion >= previous.stateVersion
    : incoming.serverTime >= previous.serverTime;
}
export function applyReceipt(
  snapshot: Snapshot | null,
  answer: AnswerReceipt,
): Snapshot | null {
  if (
    !snapshot ||
    snapshot.phase.type !== 'answering' ||
    snapshot.phase.question.id !== answer.questionId ||
    snapshot.self.answer
  )
    return snapshot;
  return {
    ...snapshot,
    self: { ...snapshot.self, answer },
    permissions: { ...snapshot.permissions, canSubmitAnswer: false },
  };
}
export function inGame(snapshot: Snapshot | null): boolean {
  return Boolean(
    snapshot &&
    snapshot.phase.type !== 'lobby' &&
    snapshot.phase.type !== 'closed',
  );
}
