import { expect, test } from 'vitest';
import { dataDragonSource } from '../src/lol-data/source.js';
const signal = () => new AbortController().signal;
test('resolves numeric latest and pins version/locale to the fixed Data Dragon host', async () => {
  const urls: string[] = [];
  const source = dataDragonSource({
    fetch: async (url, options) => {
      urls.push(String(url));
      expect(options?.redirect).toBe('error');
      return Response.json(
        urls.length === 1 ? ['9.9.1', '16.20.1', '16.9.1'] : { data: {} },
      );
    },
  });
  const version = await source.latest(signal());
  expect(version).toBe('16.20.1');
  await source.full(version, signal());
  expect(urls).toEqual([
    'https://ddragon.leagueoflegends.com/api/versions.json',
    'https://ddragon.leagueoflegends.com/cdn/16.20.1/data/en_US/championFull.json',
  ]);
  await expect(source.full('../evil', signal())).rejects.toThrow(
    'SOURCE_DATA_INVALID',
  );
});
test('resolves a stable numeric patch even when the catalog includes historical names and build identifiers', async () => {
  const source = dataDragonSource({
    fetch: async () =>
      Response.json([
        'lolpatch_7.20',
        '10.10.3216176',
        '16.9.1',
        '3.04.3',
        '16.20.1',
        '10.10.3208608',
        'lolpatch_7.19',
      ]),
  });
  await expect(source.latest(signal())).resolves.toBe('16.20.1');
});
test.each([
  null,
  {},
  [],
  ['lolpatch_7.20'],
  ['10.10.3216176', '10.10.3208608'],
  ['16.20.1', null],
  ['16.20.1', 42],
  ['16.20.1', {}],
  ['16.20.1', ''],
  ['16.20.1', 'x'.repeat(100001)],
  Array.from({ length: 10001 }, () => '16.20.1'),
])(
  'rejects malformed catalogs and catalogs without a supported patch',
  async (catalog) => {
    const source = dataDragonSource({
      fetch: async () => Response.json(catalog),
    });
    await expect(source.latest(signal())).rejects.toThrow(
      'SOURCE_DATA_INVALID',
    );
  },
);
test('retries transient failures with bounded Retry-After and the same pinned URL', async () => {
  let calls = 0;
  const waits: number[] = [];
  const urls: string[] = [];
  const source = dataDragonSource({
    wait: async (ms) => {
      waits.push(ms);
    },
    fetch: async (url) => {
      calls++;
      urls.push(String(url));
      return calls === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '2' } })
        : calls === 2
          ? new Response('', { status: 503 })
          : Response.json({ ok: true });
    },
  });
  await source.summary('16.20.1', signal());
  expect(calls).toBe(3);
  expect(new Set(urls).size).toBe(1);
  expect(waits).toEqual([2000, 1000]);
});
test.each([
  new Response('not json'),
  new Response('123456', { headers: { 'Content-Length': '6' } }),
  new Response('123456'),
])('rejects malformed or oversized bodies', async (response) => {
  const source = dataDragonSource({ maxBytes: 5, fetch: async () => response });
  await expect(source.summary('16.20.1', signal())).rejects.toThrow(
    'SOURCE_DATA_INVALID',
  );
});
test('does not retry permanent denial and respects cancellation', async () => {
  let calls = 0;
  const source = dataDragonSource({
    fetch: async () => {
      calls++;
      return new Response('', { status: 403 });
    },
  });
  await expect(source.latest(signal())).rejects.toThrow('SOURCE_UNAVAILABLE');
  expect(calls).toBe(1);
  const controller = new AbortController();
  controller.abort();
  await expect(source.latest(controller.signal)).rejects.toThrow(
    'IMPORT_ABORTED',
  );
});
test('classifies repeated request timeouts without leaking fetch errors', async () => {
  const source = dataDragonSource({
    timeoutMs: 5,
    wait: async () => {},
    fetch: async (_url, options) => {
      const requestSignal = options?.signal;
      if (!requestSignal) throw new Error('Missing abort signal');
      await new Promise<never>((_resolve, reject) => {
        requestSignal.addEventListener(
          'abort',
          () => reject(new Error('Private provider detail')),
          { once: true },
        );
      });
      throw new Error('Unexpected completed download');
    },
  });
  await expect(source.latest(signal())).rejects.toThrow('SOURCE_TIMEOUT');
});
