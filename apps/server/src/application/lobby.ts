import type { GameSettings } from '@rapidfire/contracts';
import type { Person } from './ports.js';

export type Member = Readonly<{
  id: string;
  person: Person;
  order: number;
  ready: boolean;
  presence: 'online' | 'offline';
  offlineDeadline: number | null;
  authDeadline: number | null;
}>;
export type RoomState = Readonly<{
  id: string;
  code: string;
  ownerId: string;
  members: readonly Member[];
  nextOrder: number;
  settings: GameSettings;
  settingsVersion: number;
  lobbyCycleId: string;
}>;
export function sameSettings(a: GameSettings, b: GameSettings): boolean {
  return a.rounds === b.rounds && a.answerTimeMs === b.answerTimeMs;
}
export function graceDeadline(member: Member): number | null {
  const deadlines = [member.offlineDeadline, member.authDeadline].filter(
    (value) => value !== null,
  );
  return deadlines.length ? Math.min(...deadlines) : null;
}
