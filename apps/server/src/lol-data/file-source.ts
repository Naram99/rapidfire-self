import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LolImportError, LOL_LOCALE } from './model.js';
import type { LolSource } from './model.js';
import { object, sourceVersion } from './normalize.js';

// Operational CLI only: not an HTTP upload or a user-controlled network URL.
export function fileSource(directory: string): LolSource {
  async function load(filename: string, signal: AbortSignal): Promise<unknown> {
    try {
      if (signal.aborted) throw new LolImportError('IMPORT_ABORTED');
      const path = resolve(directory, filename);
      if ((await stat(path)).size > 10 * 1024 * 1024)
        throw new LolImportError('SOURCE_DATA_INVALID');
      const text = await readFile(path, { encoding: 'utf8', signal });
      try {
        const payload: unknown = JSON.parse(text);
        return payload;
      } catch {
        throw new LolImportError('SOURCE_DATA_INVALID');
      }
    } catch (error) {
      if (signal.aborted) throw new LolImportError('IMPORT_ABORTED');
      if (error instanceof LolImportError) throw error;
      throw new LolImportError('SOURCE_UNAVAILABLE');
    }
  }
  async function document(
    filename: string,
    version: string,
    signal: AbortSignal,
  ) {
    return {
      path: `/cdn/${sourceVersion(version)}/data/${LOL_LOCALE}/${filename}`,
      payload: await load(filename, signal),
    };
  }
  return {
    latest: async (signal) =>
      sourceVersion(object(await load('champion.json', signal)).version),
    summary: (version, signal) => document('champion.json', version, signal),
    full: (version, signal) => document('championFull.json', version, signal),
  };
}
