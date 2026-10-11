import { setTimeout as delay } from 'node:timers/promises';
import { LolImportError, LOL_LOCALE } from './model.js';
import type { LolSource } from './model.js';
import { sourceVersion } from './normalize.js';

const origin = 'https://ddragon.leagueoflegends.com';
export function dataDragonSource(
  options: Readonly<{
    fetch?: typeof fetch;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    timeoutMs?: number;
    maxBytes?: number;
  }> = {},
): LolSource {
  const download = options.fetch ?? fetch;
  const wait =
    options.wait ??
    (async (ms, signal) => {
      await delay(ms, undefined, { signal });
    });
  async function json(path: string, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new LolImportError('IMPORT_ABORTED');
    for (let attempt = 0; attempt < 3; attempt++) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 15000);
      const requestSignal = AbortSignal.any([signal, timeout]);
      try {
        const response = await download(`${origin}${path}`, {
          signal: requestSignal,
          redirect: 'error',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (
            (response.status === 429 || response.status >= 500) &&
            attempt < 2
          ) {
            const retry = response.headers.get('Retry-After');
            const requested =
              retry === null
                ? 0
                : /^\d+$/.test(retry)
                  ? Number(retry) * 1000
                  : Date.parse(retry) - Date.now();
            // Never retry before a long provider-requested wait: fail for manual retry instead.
            if (requested > 10000)
              throw new LolImportError('SOURCE_UNAVAILABLE');
            await wait(
              Math.max(
                500 * 2 ** attempt,
                Number.isFinite(requested) ? requested : 0,
              ),
              signal,
            );
            continue;
          }
          throw new LolImportError('SOURCE_UNAVAILABLE');
        }
        const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
        const length = response.headers.get('Content-Length');
        if ((length !== null && Number(length) > maxBytes) || !response.body) {
          await response.body?.cancel();
          throw new LolImportError('SOURCE_DATA_INVALID');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > maxBytes) {
              await reader.cancel();
              throw new LolImportError('SOURCE_DATA_INVALID');
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        try {
          const value: unknown = JSON.parse(
            Buffer.concat(chunks).toString('utf8'),
          );
          return value;
        } catch {
          throw new LolImportError('SOURCE_DATA_INVALID');
        }
      } catch (error) {
        if (signal.aborted) throw new LolImportError('IMPORT_ABORTED');
        if (error instanceof LolImportError) throw error;
        if (attempt === 2)
          throw new LolImportError(
            timeout.aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNAVAILABLE',
          );
        await wait(500 * 2 ** attempt, signal);
      }
    }
    throw new LolImportError('SOURCE_UNAVAILABLE');
  }
  const document = async (
    version: string,
    filename: string,
    signal: AbortSignal,
  ) => {
    const path = `/cdn/${sourceVersion(version)}/data/${LOL_LOCALE}/${filename}`;
    return { path, payload: await json(path, signal) };
  };
  return {
    latest: async (signal) => {
      const value = await json('/api/versions.json', signal);
      if (!Array.isArray(value) || !value.length || value.length > 10000)
        throw new LolImportError('SOURCE_DATA_INVALID');
      const versions = value.map(sourceVersion);
      // Numeric comparison, independent of provider ordering or string lexicography.
      versions.sort((a, b) => {
        const left = a.split('.').map(Number),
          right = b.split('.').map(Number);
        for (let index = 0; index < 3; index++) {
          const difference = (right[index] ?? 0) - (left[index] ?? 0);
          if (difference) return difference;
        }
        return 0;
      });
      const version = versions[0];
      if (!version) throw new LolImportError('SOURCE_DATA_INVALID');
      return version;
    },
    summary: (version, signal) => document(version, 'champion.json', signal),
    full: (version, signal) => document(version, 'championFull.json', signal),
  };
}
