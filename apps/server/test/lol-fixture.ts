import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { object } from '../src/lol-data/normalize.js';
import type { LolSource } from '../src/lol-data/model.js';

export const version = '16.20.1';
export function smallLolFixture() {
  const list: unknown = JSON.parse(
    readFileSync('docs/question-generation-input/champions.json', 'utf8'),
  );
  const detail: unknown = JSON.parse(
    readFileSync('docs/question-generation-input/aatrox.json', 'utf8'),
  );
  const champion = object(object(object(detail).data).Aatrox);
  return {
    summary: {
      ...object(list),
      data: { Aatrox: object(object(list).data).Aatrox },
    },
    full: {
      type: 'champion',
      format: 'full',
      version,
      keys: { '266': 'Aatrox' },
      data: { Aatrox: champion },
    },
  };
}
export function fixtureSource(
  fixture: Readonly<{ summary: unknown; full: unknown }> = smallLolFixture(),
): LolSource {
  return {
    latest: async () => version,
    summary: async () => ({
      path: `/cdn/${version}/data/en_US/champion.json`,
      payload: fixture.summary,
    }),
    full: async () => ({
      path: `/cdn/${version}/data/en_US/championFull.json`,
      payload: fixture.full,
    }),
  };
}
// Reads two members of this hash-pinned, repository-owned ZIP fixture only.
// Not a production archive reader; avoids adding a ZIP dependency or Python to CI.
export function fullLolFixture() {
  const zip = readFileSync('docs/question-generation-input/16.20.1.zip');
  if (
    createHash('sha256').update(zip).digest('hex') !==
    'd141119a2070a594c6fb3c895449daa9d22e007fda806526506cc4aab16e7619'
  )
    throw new Error('Source fixture hash changed');
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let cursor = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  const members = new Map<string, unknown>();
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('Invalid fixture directory');
    const method = zip.readUInt16LE(cursor + 10),
      size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28),
      extraLength = zip.readUInt16LE(cursor + 30),
      commentLength = zip.readUInt16LE(cursor + 32);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const local = zip.readUInt32LE(cursor + 42);
    if (
      name === `${version}/champion.json` ||
      name === `${version}/championFull.json`
    ) {
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const compressed = zip.subarray(start, start + size);
      const data =
        method === 8
          ? inflateRawSync(compressed, { maxOutputLength: 10 * 1024 * 1024 })
          : method === 0
            ? compressed
            : null;
      if (!data) throw new Error('Unsupported fixture compression');
      const payload: unknown = JSON.parse(data.toString('utf8'));
      members.set(name, payload);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const summary = members.get(`${version}/champion.json`),
    full = members.get(`${version}/championFull.json`);
  if (!summary || !full) throw new Error('Full fixture members missing');
  return { summary, full };
}
