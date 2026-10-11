import { useEffect, useRef, useState } from 'react';
import {
  lolAdminDataSchema,
  lolImportRunSchema,
  LOL_IMPORT_ENGLISH_MESSAGES,
} from '@rapidfire/contracts';
import type { LolAdminData, LolImportRunView } from '@rapidfire/contracts';
import { Button, Notice } from '../components/ui';
import { read, request } from '../lib/api';
import { message, t } from '../lib/copy';
import type { CopyKey } from '../lib/copy';

const dates = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const stages: Readonly<Record<LolImportRunView['stage'], CopyKey>> = {
  queued: 'importQueued',
  resolving: 'importResolving',
  downloading: 'importDownloading',
  normalizing: 'importNormalizing',
  publishing: 'importPublishing',
  finished: 'importSucceeded',
};
const statuses: Readonly<Record<LolImportRunView['status'], CopyKey>> = {
  queued: 'importQueued',
  running: 'importNormalizing',
  succeeded: 'importSucceeded',
  unchanged: 'importUnchanged',
  failed: 'importFailed',
  aborted: 'importAborted',
};
const isRunning = (run: LolImportRunView) =>
  run.status === 'queued' || run.status === 'running';

export function AdminLolDataPage() {
  const [data, setData] = useState<LolAdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const action = useRef<AbortController | null>(null);
  const active = data?.runs.find(isRunning);
  const activeId = active?.id ?? null;
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    async function refresh() {
      if (
        polling ||
        controller.signal.aborted ||
        document.visibilityState !== 'visible'
      )
        return;
      polling = true;
      let again = Boolean(activeId);
      try {
        const next = await read(
          '/api/admin/lol-data',
          lolAdminDataSchema,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setData(next);
          setError(null);
        }
        again = next.runs.some(isRunning);
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error));
      } finally {
        polling = false;
        if (
          again &&
          !controller.signal.aborted &&
          document.visibilityState === 'visible'
        )
          timer = setTimeout(() => {
            void refresh();
          }, 2000);
      }
    }
    function foreground() {
      if (timer) clearTimeout(timer);
      if (document.visibilityState === 'visible') void refresh();
    }
    document.addEventListener('visibilitychange', foreground);
    void refresh();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [revision, activeId]);

  async function start(mode: 'latest' | 'reimport') {
    if (busy || active) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    action.current = controller;
    try {
      const run = lolImportRunSchema.parse(
        await request('/api/admin/lol-data/imports', {
          body: { mode },
          signal: controller.signal,
        }),
      );
      if (controller.signal.aborted) return;
      setData((current) =>
        current
          ? {
              ...current,
              runs: [
                run,
                ...current.runs.filter((item) => item.id !== run.id),
              ].slice(0, 20),
            }
          : { activeDataset: null, runs: [run] },
      );
      setRevision((value) => value + 1);
    } catch (error) {
      if (!controller.signal.aborted) setError(message(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const dataset = data?.activeDataset;
  return (
    <section className="page admin-data">
      <div className="admin-data-heading">
        <div>
          <h1>{t('championData')}</h1>
          <p className="page-intro">{t('championDataIntro')}</p>
        </div>
        <Button
          disabled={!data || busy || Boolean(active)}
          onClick={() => {
            void start('latest');
          }}
        >
          {t('championDataUpdate')}
        </Button>
      </div>
      {error ? (
        <Notice
          kind="error"
          action={
            <Button
              variant="quiet"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t('retry')}
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      {!data && !error ? <p role="status">{t('loading')}</p> : null}
      {active ? (
        <div className="admin-data-progress" role="status">
          <h2>{t(stages[active.stage])}</h2>
          <p>
            {active.sourceVersion
              ? `${t('championDataPatch')} ${active.sourceVersion}`
              : t('championDataPreviousSafe')}
          </p>
          {active.totalChampions > 0 ? (
            <>
              <progress
                aria-label={t('championDataProgress', {
                  done: active.processedChampions,
                  total: active.totalChampions,
                })}
                value={active.processedChampions}
                max={active.totalChampions}
              />
              <p>
                {t('championDataProgress', {
                  done: active.processedChampions,
                  total: active.totalChampions,
                })}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {dataset ? (
        <div className="admin-data-current">
          <div className="admin-data-version">
            <h2>
              {t('championDataPatch')} {dataset.sourceVersion}
            </h2>
            <p>{t('championDataReady')}</p>
          </div>
          <dl className="admin-data-counts">
            <div>
              <dt>{t('championDataChampions')}</dt>
              <dd>{dataset.counts.champions}</dd>
            </div>
            <div>
              <dt>{t('championDataSkins')}</dt>
              <dd>{dataset.counts.skins}</dd>
            </div>
            <div>
              <dt>{t('championDataChromas')}</dt>
              <dd>{dataset.counts.chromas}</dd>
            </div>
            <div>
              <dt>{t('championDataSpells')}</dt>
              <dd>{dataset.counts.spells}</dd>
            </div>
          </dl>
          <p>
            {t('championDataImported')}:{' '}
            <time dateTime={dataset.completedAt}>
              {dates.format(new Date(dataset.completedAt))}
            </time>
          </p>
          <p>{t('championDataLocale')}: English (en_US)</p>
          <p className="field-hint">
            {t('championDataExclusions', {
              skins: dataset.counts.unverifiedChromaSkins,
              champions: dataset.counts.unverifiedChromaChampions,
              spells: dataset.counts.excludedCooldownSpells,
            })}
          </p>
          <p className="field-hint">{t('championDataPending')}</p>
          <details>
            <summary>{t('championDataReimport')}</summary>
            <p>{t('championDataReimportHint')}</p>
            <Button
              variant="secondary"
              disabled={busy || Boolean(active)}
              onClick={() => {
                void start('reimport');
              }}
            >
              {t('championDataReimport')}
            </Button>
          </details>
        </div>
      ) : data ? (
        <div className="empty-state">
          <h2>{t('championDataEmpty')}</h2>
          <p>{t('championDataEmptyDetail')}</p>
        </div>
      ) : null}
      {data ? (
        <section className="admin-data-history" aria-labelledby="imports-title">
          <h2 id="imports-title">{t('championDataHistory')}</h2>
          {data.runs.length ? (
            <ul>
              {data.runs.map((run) => (
                <li key={run.id}>
                  <div>
                    <strong>
                      {run.sourceVersion
                        ? `${t('championDataPatch')} ${run.sourceVersion}`
                        : t('championDataUpdate')}
                    </strong>
                    <time dateTime={run.createdAt}>
                      {dates.format(new Date(run.createdAt))}
                    </time>
                  </div>
                  <span>{t(statuses[run.status])}</span>
                  {run.errorCode ? (
                    <p className="field-error">
                      {LOL_IMPORT_ENGLISH_MESSAGES[run.errorCode]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('championDataNoRuns')}</p>
          )}
        </section>
      ) : null}
    </section>
  );
}
