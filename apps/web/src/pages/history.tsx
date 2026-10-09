import { useEffect, useState } from 'react';
import {
  gameResultResponseSchema,
  historyResponseSchema,
} from '@rapidfire/contracts';
import type { GameResultResponse, HistoryEntry } from '@rapidfire/contracts';
import { read } from '../lib/api';
import { dates, message, numbers, t, topicName } from '../lib/copy';
import { Link } from '../lib/router';
import { Button, Notice } from '../components/ui';
import { QuestionResults, Standings } from '../components/results';

const gameStatus = (status: HistoryEntry['status']) =>
  t(
    status === 'completed'
      ? 'completed'
      : status === 'interrupted'
        ? 'interruptedStatus'
        : 'inProgress',
  );

export function HistoryPage() {
  const [games, setGames] = useState<readonly HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void read('/api/games', historyResponseSchema, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setGames(data.games);
          setMore(data.games.length === 20);
          setError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [revision]);
  return (
    <section className="page">
      <h1>{t('historyTitle')}</h1>
      <p className="page-intro">{t('historyIntro')}</p>
      {error ? (
        <Notice
          kind="error"
          action={
            <Button variant="quiet" onClick={() => setRevision(revision + 1)}>
              {t('retry')}
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      {!games && !error ? <p role="status">{t('loading')}</p> : null}
      {games?.length === 0 ? (
        <div className="empty-state">
          <h2>{t('historyEmpty')}</h2>
          <p>{t('historyEmptyDetail')}</p>
          <Link className="button button--primary" href="/">
            {t('startSolo')}
          </Link>
        </div>
      ) : null}
      {games?.length ? (
        <ul className="history-list">
          {games.map((game) => (
            <li key={game.id}>
              <Link
                href={`/history/${game.id}`}
                aria-label={`${t('viewGame')}: ${dates.format(new Date(game.startedAt))}`}
              >
                <div>
                  <span className="history-mode">
                    {t(game.mode === 'solo' ? 'solo' : 'multiplayer')}
                  </span>
                  <h2>{dates.format(new Date(game.startedAt))}</h2>
                  <p>
                    {game.topicId ? (
                      <>
                        {topicName(game.topicId)}
                        {' · '}
                      </>
                    ) : null}
                    {t('roundSettings', {
                      rounds: game.rounds,
                      seconds: game.answerTimeMs / 1000,
                    })}
                  </p>
                </div>
                <div className="history-score">
                  <strong>{numbers.format(game.score)}</strong>
                  <span>{gameStatus(game.status)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {more && games ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            const last = games.at(-1);
            if (!last) return;
            setBusy(true);
            try {
              const data = await read(
                `/api/games?${new URLSearchParams({ before: last.startedAt, beforeId: last.id })}`,
                historyResponseSchema,
              );
              setGames((current) => [
                ...(current ?? []),
                ...data.games.filter(
                  (game) => !current?.some((entry) => entry.id === game.id),
                ),
              ]);
              setMore(data.games.length === 20);
              setError(null);
            } catch (error) {
              setError(message(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('loading') : t('historyMore')}
        </Button>
      ) : null}
    </section>
  );
}

export function HistoryDetailPage({ id }: { id: string }) {
  const [game, setGame] = useState<GameResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void read(
      `/api/games/${encodeURIComponent(id)}`,
      gameResultResponseSchema,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setGame(data);
          setError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [id, revision]);
  return (
    <section className="page">
      <Link className="back-link" href="/history">
        {t('history')}
      </Link>
      <h1>{t('gameDetail')}</h1>
      {error ? (
        <Notice
          kind="error"
          action={
            <Button variant="quiet" onClick={() => setRevision(revision + 1)}>
              {t('retry')}
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      {!game && !error ? <p role="status">{t('loading')}</p> : null}
      {game ? (
        <>
          <p className="page-intro">
            {dates.format(new Date(game.game.startedAt))}
          </p>
          <p>
            {game.game.topicId ? (
              <>
                {topicName(game.game.topicId)}
                {' · '}
              </>
            ) : null}
            {t('roundSettings', {
              rounds: game.game.roundCount,
              seconds: game.game.answerTimeMs / 1000,
            })}{' '}
            · {gameStatus(game.game.statusCode)}
          </p>
          <Standings participants={game.participants} />
          <h2>{t('yourAnswers')}</h2>
          <QuestionResults results={game.questions} />
        </>
      ) : null}
    </section>
  );
}
