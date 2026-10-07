import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Clock, Person } from '../application/ports.js';

export type GuestCredential = Readonly<{
  person: Person;
  expiresAt: number;
  renewedAt: number;
}>;
export type MatchCredential = Readonly<{
  person: Person;
  matchId: string;
  expiresAt: number;
}>;
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** Opaque tokens never reach the retained records, logs or database. */
export class Credentials {
  private readonly guests = new Map<string, GuestCredential>();
  private readonly matches = new Map<string, MatchCredential>();
  constructor(
    private readonly clock: Clock,
    private readonly capacity = 10000,
  ) {}
  createGuest(
    name: string,
  ): Readonly<{ token: string; credential: GuestCredential }> {
    this.prune();
    if (this.guests.size + this.matches.size >= this.capacity)
      throw new Error('CREDENTIAL_CAPACITY');
    const token = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    const credential = {
      person: { id: randomUUID(), name, kind: 'guest' as const },
      renewedAt: now,
      expiresAt: now + 900000,
    };
    this.guests.set(digest(token), credential);
    return { token, credential };
  }
  guest(token: string | null): GuestCredential | null {
    if (!token) return null;
    const key = digest(token);
    const value = this.guests.get(key);
    if (value && value.expiresAt > this.clock.now()) return value;
    this.guests.delete(key);
    return null;
  }
  renewGuest(token: string | null): GuestCredential | null {
    const current = this.guest(token);
    if (!current || !token) return null;
    if (this.clock.now() - current.renewedAt < 300000) return current;
    const value = {
      ...current,
      renewedAt: this.clock.now(),
      expiresAt: this.clock.now() + 900000,
    };
    this.guests.set(digest(token), value);
    return value;
  }
  issueMatch(
    person: Person,
    matchId: string,
    startedAt: number,
    currentToken: string | null,
  ) {
    const expiresAt = startedAt + 1800000;
    if (expiresAt <= this.clock.now()) return null;
    const current = this.match(currentToken);
    // Concurrent tabs can retain separate proofs; do not rotate away another tab's proof.
    if (
      current &&
      currentToken &&
      current.matchId === matchId &&
      current.person.id === person.id
    )
      return { token: currentToken, credential: current };
    this.prune();
    if (this.guests.size + this.matches.size >= this.capacity)
      throw new Error('CREDENTIAL_CAPACITY');
    const token = randomBytes(32).toString('base64url');
    const credential = { person: { ...person }, matchId, expiresAt };
    this.matches.set(digest(token), credential);
    return { token, credential };
  }
  match(token: string | null): MatchCredential | null {
    if (!token) return null;
    const key = digest(token);
    const value = this.matches.get(key);
    if (value && value.expiresAt > this.clock.now()) return value;
    this.matches.delete(key);
    return null;
  }
  revokePerson(personId: string, includeGuest = true): void {
    for (const [key, value] of this.matches)
      if (value.person.id === personId) this.matches.delete(key);
    if (includeGuest)
      for (const [key, value] of this.guests)
        if (value.person.id === personId) this.guests.delete(key);
  }
  finishMatch(matchId: string): void {
    for (const [key, value] of this.matches)
      if (value.matchId === matchId && value.person.kind === 'user')
        this.matches.delete(key);
  }
  private prune(): void {
    for (const [key, value] of this.matches)
      if (value.expiresAt <= this.clock.now()) this.matches.delete(key);
    for (const [key, value] of this.guests)
      if (value.expiresAt <= this.clock.now()) this.guests.delete(key);
  }
}

export function cookieToken(
  header: string | undefined,
  name: string,
): string | null {
  const values =
    header?.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      return part.slice(0, separator).trim() === name
        ? [part.slice(separator + 1).trim()]
        : [];
    }) ?? [];
  const token = values[0];
  return values.length === 1 && token && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? token
    : null;
}

export function credentialCookies(publicUrl: string, clock: Clock) {
  const secure = new URL(publicUrl).protocol === 'https:';
  const names = {
    guest: `${secure ? '__Host-' : ''}rapidfire.guest`,
    match: `${secure ? '__Host-' : ''}rapidfire.match`,
  };
  return {
    names,
    serialize: (kind: 'guest' | 'match', token: string, expiresAt: number) =>
      `${names[kind]}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt - clock.now()) / 1000))}; Expires=${new Date(expiresAt).toUTCString()}${secure ? '; Secure' : ''}`,
    clear: (kind: 'guest' | 'match') =>
      `${names[kind]}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
  };
}
