import type { Ack, ErrorCode } from '@rapidfire/contracts';
import type { ErrorCode as EngineError } from '@rapidfire/game-engine';

export class CommandFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly resyncRequired = false,
  ) {
    super(code);
  }
}
export function requireCommand(
  condition: boolean,
  code: ErrorCode,
  resync = false,
): asserts condition {
  if (!condition) throw new CommandFailure(code, resync);
}
export function failedAck(
  requestId: string | null,
  now: number,
  code: ErrorCode,
  resyncRequired = false,
): Ack {
  return {
    requestId,
    serverTime: now,
    ok: false,
    error: { code, params: {}, resyncRequired },
  };
}
const engineErrors: Readonly<Record<EngineError, ErrorCode>> = {
  INVALID_SETTINGS: 'INVALID_PAYLOAD',
  INVALID_PARTICIPANTS: 'INVALID_PAYLOAD',
  INVALID_CATEGORIES: 'INVALID_PAYLOAD',
  INVALID_TIME: 'SERVER_UNAVAILABLE',
  INVALID_RANDOM_INPUT: 'SERVER_UNAVAILABLE',
  INVALID_ANSWER: 'INVALID_PAYLOAD',
  PARTICIPANT_NOT_FOUND: 'FORBIDDEN',
  PARTICIPANT_LEFT: 'PARTICIPANT_LEFT',
  FORBIDDEN: 'FORBIDDEN',
  STALE_PHASE: 'STALE_STATE',
  DEADLINE_PASSED: 'DEADLINE_EXCEEDED',
  QUESTION_NOT_OPEN: 'QUESTION_NOT_OPEN',
  MATCH_ENDED: 'STALE_STATE',
};
export function failEngine(code: EngineError): never {
  throw new CommandFailure(
    engineErrors[code],
    code === 'STALE_PHASE' || code === 'MATCH_ENDED',
  );
}
