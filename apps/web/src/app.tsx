import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ClosureReason } from '@rapidfire/contracts';
import { GameClient } from './lib/client';
import { message, t } from './lib/copy';
import type { CopyKey } from './lib/copy';
import { Link, navigate, useRoute } from './lib/router';
import { Button, Dialog, Icon, Notice } from './components/ui';
import { HomePage } from './pages/home';
import { AuthPage, ResetPage, VerificationPage } from './pages/auth';
import { AccountPage } from './pages/account';
import { HistoryDetailPage, HistoryPage } from './pages/history';
import { GamePage, PersistenceNotice } from './pages/game';

const closure: Readonly<Record<ClosureReason, CopyKey | null>> = {
  left: 'closedLeft',
  room_deleted: 'closedRoomDeleted',
  solo_returned: null,
  offline_timeout: 'closedOffline',
  authentication_timeout: 'closedAuth',
  access_revoked: 'closedRevoked',
};
export function App() {
  const [client] = useState(() => new GameClient());
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  const [leavingScope, setLeavingScope] = useState<string | null>(null);
  const previousFlow = useRef<string | null>(null);
  const [leavingBusy, setLeavingBusy] = useState(false);
  const snapshot = state.snapshot;
  const flow = snapshot && snapshot.phase.type !== 'closed' ? snapshot : null;
  const lobby =
    flow?.phase.type === 'lobby' ||
    (flow?.phase.type === 'start_countdown' && Boolean(flow.room));
  const authLink =
    route.pathname === '/reset-password' || route.pathname === '/verify-email';
  const reauth =
    route.pathname === '/sign-in' &&
    Boolean(flow?.permissions.requiresAuthentication);
  const showGame = Boolean(flow && !authLink && !reauth);
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  useEffect(() => {
    if (showGame && window.location.pathname !== '/game')
      navigate('/game', true);
    else if (
      snapshot?.phase.type === 'closed' &&
      window.location.pathname === '/game'
    ) {
      const key = closure[snapshot.phase.reason];
      if (key) client.notify(t(key));
      navigate('/', true);
    } else if (
      !snapshot &&
      previousFlow.current &&
      window.location.pathname === '/game'
    ) {
      navigate('/', true);
    }
    previousFlow.current = flow?.scope.id ?? null;
  }, [
    showGame,
    snapshot?.phase.type,
    snapshot?.phase.id,
    flow?.scope.id,
    client,
  ]);
  const phaseId = showGame ? snapshot?.phase.id : null;
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [route.pathname, phaseId]);

  let page;
  if (showGame && flow)
    page = <GamePage client={client} state={state} snapshot={flow} />;
  else if (route.pathname === '/reset-password')
    page = <ResetPage route={route} client={client} />;
  else if (route.pathname === '/verify-email')
    page = <VerificationPage route={route} />;
  else if (
    ['/sign-in', '/sign-up', '/forgot-password'].includes(route.pathname)
  )
    page = <AuthPage key={route.pathname} route={route} client={client} />;
  else if (
    route.pathname === '/profile' ||
    route.pathname.startsWith('/history')
  ) {
    const identity = state.identity;
    if (state.session === 'loading') page = <p role="status">{t('loading')}</p>;
    else if (identity.kind !== 'user')
      page = (
        <section className="page page--form">
          <h1>{t('signIn')}</h1>
          <p>{t('noAccess')}</p>
          <Link className="button button--primary" href="/sign-in">
            {t('signIn')}
          </Link>
        </section>
      );
    else if (route.pathname === '/profile')
      page = (
        <AccountPage
          key={identity.profile.userId}
          profile={identity.profile}
          client={client}
        />
      );
    else if (route.pathname === '/history')
      page = <HistoryPage key={identity.profile.userId} />;
    else
      page = (
        <HistoryDetailPage
          key={`${identity.profile.userId}:${route.pathname}`}
          id={route.pathname.slice('/history/'.length)}
        />
      );
  } else if (route.pathname === '/game')
    page = (
      <section className="page page--form">
        <h1>
          {t(
            state.session === 'loading' || state.connection === 'connecting'
              ? 'connecting'
              : 'noActiveGame',
          )}
        </h1>
        <Link className="button button--secondary" href="/">
          {t('back')}
        </Link>
        {state.identity.kind === 'none' ? (
          <Link href="/sign-in?returnTo=/game">{t('signIn')}</Link>
        ) : null}
      </section>
    );
  else if (route.pathname === '/')
    page = <HomePage client={client} state={state} />;
  else
    page = (
      <section className="page page--form">
        <h1>{t('notFound')}</h1>
        <Link href="/">{t('back')}</Link>
      </section>
    );

  const disconnected = flow && state.connection !== 'connected';
  return (
    <>
      <a className="skip-link" href="#main-content">
        {t('skip')}
      </a>
      <header className="site-header">
        <div className="header-inner">
          {flow ? (
            <span className="wordmark" translate="no">
              <Icon name="flame" />
              Rapidfire
            </span>
          ) : (
            <Link className="wordmark" href="/" translate="no">
              <Icon name="flame" />
              Rapidfire
            </Link>
          )}
          {flow ? (
            <Button
              variant="quiet"
              onClick={() => setLeavingScope(flow.scope.id)}
            >
              <Icon name="exit" />
              {t(lobby ? 'leaveRoom' : 'leaveGame')}
            </Button>
          ) : (
            <nav aria-label="Main navigation">
              {state.identity.kind === 'user' ? (
                <>
                  <Link
                    href="/history"
                    aria-current={
                      route.pathname.startsWith('/history') ? 'page' : undefined
                    }
                  >
                    {t('history')}
                  </Link>
                  <Link
                    href="/profile"
                    aria-current={
                      route.pathname === '/profile' ? 'page' : undefined
                    }
                  >
                    {t('profile')}
                  </Link>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      void client
                        .logout()
                        .then(() => navigate('/'))
                        .catch((error: unknown) =>
                          client.notify(message(error)),
                        );
                    }}
                  >
                    {t('signOut')}
                  </Button>
                </>
              ) : (
                <Link className="button button--secondary" href="/sign-in">
                  {t('signIn')}
                </Link>
              )}
            </nav>
          )}
        </div>
      </header>
      <main id="main-content" ref={main} tabIndex={-1} className="app-main">
        {state.notice ? (
          <Notice
            action={
              <Button
                variant="quiet"
                onClick={client.dismiss}
                aria-label={t('dismiss')}
              >
                <Icon name="cross" />
              </Button>
            }
          >
            {state.notice}
          </Notice>
        ) : null}
        {state.connection === 'incompatible' ? (
          <Notice
            kind="error"
            action={
              <Button
                variant="secondary"
                onClick={() => window.location.reload()}
              >
                {t('refresh')}
              </Button>
            }
          >
            {t('invalidResponse')}
          </Notice>
        ) : disconnected ? (
          <Notice
            kind="warning"
            action={
              <Button variant="secondary" onClick={client.reconnect}>
                <Icon name="reload" />
                {t('reconnect')}
              </Button>
            }
          >
            {t(
              state.connection === 'unauthenticated'
                ? 'authenticationRequired'
                : 'reconnecting',
            )}
          </Notice>
        ) : null}
        {state.snapshot?.recentResult && !flow ? (
          <PersistenceNotice
            status={state.snapshot.recentResult.persistence.status}
          />
        ) : null}
        {page}
      </main>
      {flow && leavingScope === flow.scope.id ? (
        <Dialog
          title={t('leaveTitle')}
          close={() => {
            if (!leavingBusy) setLeavingScope(null);
          }}
        >
          <p>{t(flow.room ? 'leaveRoomDetail' : 'leaveDetail')}</p>
          <div className="dialog-actions">
            <Button
              variant="secondary"
              disabled={leavingBusy}
              onClick={() => setLeavingScope(null)}
            >
              {t('stay')}
            </Button>
            <Button
              variant="danger"
              disabled={leavingBusy || state.connection !== 'connected'}
              onClick={async () => {
                setLeavingBusy(true);
                try {
                  if (flow.room)
                    await client.command('room:leave', {
                      roomId: flow.room.id,
                    });
                  else if (flow.match)
                    await client.command('match:leave', {
                      matchId: flow.match.id,
                    });
                  setLeavingScope(null);
                  navigate('/');
                } catch (error) {
                  client.notify(message(error));
                } finally {
                  setLeavingBusy(false);
                }
              }}
            >
              {leavingBusy ? t('working') : t('leave')}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
