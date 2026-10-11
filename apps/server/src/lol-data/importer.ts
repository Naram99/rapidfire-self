import type { LolImportRunView } from '@rapidfire/contracts';
import { LolImportError, NORMALIZATION_VERSION } from './model.js';
import type { LolSource } from './model.js';
import {
  datasetCounts,
  datasetHash,
  normalizeFull,
  normalizeSummary,
} from './normalize.js';
import type { LolRepository } from './repository.js';

export class LolImporter {
  private readonly tasks = new Set<Promise<void>>();
  private readonly controller = new AbortController();
  constructor(
    private readonly repository: LolRepository,
    private readonly source: LolSource,
  ) {}
  async start(
    userId: string,
    mode: 'latest' | 'reimport',
  ): Promise<LolImportRunView> {
    if (this.controller.signal.aborted)
      throw new LolImportError('IMPORT_ABORTED');
    const { run, created } = await this.repository.createRun(userId, mode);
    if (created) {
      const task = this.execute(run);
      this.tasks.add(task);
      void task.finally(() => this.tasks.delete(task));
    }
    return run;
  }
  async idle(): Promise<void> {
    await Promise.all([...this.tasks]);
  }
  async close(): Promise<void> {
    this.controller.abort();
    await this.idle();
  }
  private async execute(run: LolImportRunView): Promise<void> {
    const deadline = AbortSignal.timeout(120000);
    const signal = AbortSignal.any([this.controller.signal, deadline]);
    const check = () => {
      if (this.controller.signal.aborted)
        throw new LolImportError('IMPORT_ABORTED');
      if (deadline.aborted) throw new LolImportError('SOURCE_TIMEOUT');
    };
    try {
      await this.repository.progress(run.id, {
        status: 'running',
        stage: 'resolving',
      });
      check();
      const active = await this.repository.activeDataset();
      const version =
        run.mode === 'reimport' && active
          ? active.sourceVersion
          : await this.source.latest(signal);
      if (
        run.mode === 'latest' &&
        active?.sourceVersion === version &&
        active.normalizationVersion === NORMALIZATION_VERSION
      ) {
        check();
        await this.repository.unchanged(run.id, active);
        return;
      }
      await this.repository.progress(run.id, {
        sourceVersion: version,
        stage: 'downloading',
      });
      const summary = await this.source.summary(version, signal);
      check();
      const expected = normalizeSummary(summary.payload, version);
      await this.repository.progress(run.id, {
        totalChampions: expected.length,
      });
      const full = await this.source.full(version, signal);
      check();
      const champions = normalizeFull(full.payload, version, expected);
      const counts = datasetCounts(champions);
      const hash = datasetHash(version, champions);
      check();
      const datasetId = await this.repository.stage(
        run.id,
        version,
        expected.length,
        [summary, full],
      );
      for (let offset = 0; offset < champions.length; offset += 10) {
        check();
        await this.repository.writeChunk(
          run.id,
          datasetId,
          champions.slice(offset, offset + 10),
        );
      }
      check();
      await this.repository.progress(run.id, { stage: 'publishing' });
      await this.repository.publish(run.id, datasetId, hash, counts);
    } catch (error) {
      const code = this.controller.signal.aborted
        ? 'IMPORT_ABORTED'
        : deadline.aborted
          ? 'SOURCE_TIMEOUT'
          : error instanceof LolImportError
            ? error.code
            : 'IMPORT_STORAGE_FAILED';
      try {
        await this.repository.fail(run.id, code);
      } catch {
        console.warn('LOL_IMPORT_STATUS_WRITE_FAILED', run.id);
      }
    }
  }
}
