import { expect, test } from 'vitest';
import {
  datasetCounts,
  datasetHash,
  normalizeFull,
  normalizeSummary,
  object,
} from '../src/lol-data/normalize.js';
import { fullLolFixture, smallLolFixture, version } from './lol-fixture.js';

function normalize(fixture = smallLolFixture()) {
  return normalizeFull(
    fixture.full,
    version,
    normalizeSummary(fixture.summary, version),
  );
}
test('normalizes every uploaded champion and derives only the approved exclusions', () => {
  const fixture = fullLolFixture();
  const champions = normalizeFull(
    fixture.full,
    version,
    normalizeSummary(fixture.summary, version),
  );
  expect(datasetCounts(champions)).toEqual({
    champions: 173,
    skins: 1959,
    chromas: 7075,
    spells: 692,
    unverifiedChromaSkins: 6,
    unverifiedChromaChampions: 5,
    excludedCooldownSpells: 20,
  });
  const ahri = champions.find((c) => c.sourceId === 'Ahri');
  expect(ahri?.chromaCount).toBeNull();
  expect(ahri?.skinCount).toBeGreaterThan(0);
  const belveth = champions.find((c) => c.sourceId === 'Belveth');
  expect(belveth?.resourceType).toBe('unknown');
  expect(belveth?.resourceName).toBe('');
  expect(
    champions.flatMap((c) => c.spells).filter((s) => s.cooldownRank1 !== null),
  ).toHaveLength(672);
  expect(
    champions
      .flatMap((c) => c.skins)
      .filter((s) => s.sourceHasChromas === false && (s.chromaCount ?? 0) > 0),
  ).toHaveLength(127);
});
test('preserves decimal stats, real zero, parent num links, spell ranks and raw source', () => {
  const [champion] = normalize();
  expect(champion?.stats).toMatchObject({
    attackDamagePerLevel: '0',
    attackSpeed: '0.651',
    magicResistPerLevel: '2.05',
  });
  expect(champion?.resourceType).toBe('other');
  expect(champion?.skinCount).toBe(12);
  expect(champion?.chromaCount).toBe(28);
  expect(champion?.skins.find((s) => s.skinNum === 4)).toMatchObject({
    parentNum: 2,
    isChroma: true,
  });
  expect(champion?.spells[1]).toMatchObject({
    slot: 'W',
    cooldownRank1: '18',
    cooldownsByRank: ['18', '16.5', '15', '13.5', '12'],
  });
  expect(champion?.raw.tooltip).toBeUndefined();
  expect(champion?.raw.lore).toBeTypeOf('string');
});
test.each([
  'missing-parent',
  'chroma-parent',
  'duplicate-num',
  'null-parent',
  'missing-stat',
  'stat-string',
  'wrong-key',
  'wrong-version',
  'wrong-rank',
  'nonfinite-cooldown',
  'foreign-champion',
])('rejects %s without losing an invalid champion silently', (reason) => {
  const fixture = smallLolFixture(),
    champion = fixture.full.data.Aatrox;
  const skins = champion.skins;
  if (!Array.isArray(skins)) throw new Error('Fixture skins');
  const spells = champion.spells;
  if (!Array.isArray(spells)) throw new Error('Fixture spells');
  const stats = object(champion.stats);
  if (reason === 'missing-parent')
    skins.push({ id: 'bad', num: 10000, name: 'bad', parentSkin: 10001 });
  if (reason === 'chroma-parent')
    skins.push({ id: 'bad', num: 10000, name: 'bad', parentSkin: 4 });
  if (reason === 'duplicate-num')
    skins.push({ id: 'bad', num: 0, name: 'bad' });
  if (reason === 'null-parent') object(skins[1]).parentSkin = null;
  if (reason === 'missing-stat') delete stats.hp;
  if (reason === 'stat-string') stats.hp = '650';
  if (reason === 'wrong-key') champion.key = '999';
  if (reason === 'wrong-version') fixture.full.version = '16.19.1';
  if (reason === 'wrong-rank') object(spells[0]).maxrank = 6;
  if (reason === 'nonfinite-cooldown')
    object(spells[0]).cooldown = [NaN, 12, 10, 8, 6];
  if (reason === 'foreign-champion') champion.id = 'Ahri';
  expect(() => normalize(fixture)).toThrow('SOURCE_DATA_INVALID');
});
test('content hash ignores input object, champion and skin order but changes with content/version', () => {
  const fixture = smallLolFixture(),
    before = normalize(fixture);
  const skins = fixture.full.data.Aatrox.skins;
  if (!Array.isArray(skins)) throw new Error('Fixture skins');
  skins.reverse();
  fixture.full.data.Aatrox.stats = Object.fromEntries(
    Object.entries(object(fixture.full.data.Aatrox.stats)).reverse(),
  );
  expect(datasetHash(version, normalize(fixture))).toBe(
    datasetHash(version, before),
  );
  fixture.full.data.Aatrox.lore = 'Changed lore';
  expect(datasetHash(version, normalize(fixture))).not.toBe(
    datasetHash(version, before),
  );
  expect(datasetHash('16.21.1', before)).not.toBe(datasetHash(version, before));
});
