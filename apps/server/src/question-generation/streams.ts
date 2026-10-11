import { createHash, randomInt } from 'node:crypto';
import { SeededRandom } from './random.js';
import type { RandomStreams } from './random.js';
export const GENERATOR_VERSION = 'lol-text-v1';
export const SEED_VERSION = 'rapidfire-seed-v1';
export const PRNG_VERSION = 'xoshiro128starstar-v1';
export function seededStreams(
  seed: string,
  releaseHash: string,
): RandomStreams {
  if (!/^[A-Za-z0-9]{1,10}$/.test(seed) || !/^[a-f0-9]{64}$/.test(releaseHash))
    throw new Error('INVALID_GENERATION_CONTEXT');
  const root = createHash('sha256')
    .update(JSON.stringify([SEED_VERSION, seed, releaseHash]))
    .digest('hex');
  return (purpose, ...keys) => {
    const digest = createHash('sha256')
      .update(JSON.stringify(['rapidfire-stream-v1', root, purpose, ...keys]))
      .digest();
    return new SeededRandom(
      [0, 4, 8, 12].map((offset) => digest.readUInt32LE(offset)),
    );
  };
}
export function automaticSeed(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 10 }, () =>
    alphabet.charAt(randomInt(alphabet.length)),
  ).join('');
}
