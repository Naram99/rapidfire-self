import { useRef, useState } from 'react';
import { nicknameSchema, settingsSchema } from '@rapidfire/contracts';
import type { GameSettings } from '@rapidfire/contracts';
import type { ClientState, GameClient } from '../lib/client';
import { message, t } from '../lib/copy';
import { Link, navigate } from '../lib/router';
import { Settings } from '../components/settings';
import { Button, Field, Icon, Notice } from '../components/ui';
import { HomeTitle } from '../components/home-title';

export function HomePage({
  client,
  state,
}: {
  client: GameClient;
  state: ClientState;
}) {
  const [settings, setSettings] = useState<GameSettings>({
    rounds: 1,
    answerTimeMs: 20000,
  });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const loading = state.session === 'loading';
  const pending = busy || state.pending !== null;
  const fail = (error: string) => {
    setError(error);
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const run = async (action: () => Promise<void>) => {
    if (pending) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      fail(message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="home-layout">
      <section className="home-intro">
        <HomeTitle />
        <p className="page-intro">{t('homeIntro')}</p>
        <div className="brand-moment" aria-hidden="true">
          <Icon name="flame" />
          <span>Rapidfire</span>
        </div>
        <p className="game-principle">
          <Icon name="bolt" />
          {t('accuracy')}
        </p>
      </section>
      <div className="home-play">
        {error ? (
          <div
            ref={errorRef}
            tabIndex={-1}
            className="error-summary"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        <section className="play-section">
          <div className="section-heading">
            <Icon name="solo" />
            <h2>{t('soloTitle')}</h2>
          </div>
          <p>{t('soloIntro')}</p>
          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = settingsSchema.safeParse(settings);
              if (!parsed.success || settings.rounds > state.maxRounds) {
                fail(t('invalidSettings', { rounds: state.maxRounds }));
                return;
              }
              if (
                state.identity.kind === 'none' &&
                !nicknameSchema.safeParse(name).success
              ) {
                fail(t('invalidNickname'));
                return;
              }
              void run(async () => {
                if (state.identity.kind === 'none')
                  await client.guest(name.trim());
                await client.command('solo:start', { settings: parsed.data });
                navigate('/game');
              });
            }}
          >
            {state.identity.kind === 'none' ? (
              <Field
                label={t('guestName')}
                name="nickname"
                autoComplete="nickname"
                maxLength={40}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                spellCheck={false}
                disabled={pending || loading}
              />
            ) : null}
            <details>
              <summary>{t('settings')}</summary>
              <Settings
                value={settings}
                change={setSettings}
                maxRounds={state.maxRounds}
                disabled={pending}
              />
            </details>
            <Button
              type="submit"
              disabled={pending || loading}
              aria-busy={pending}
            >
              <Icon name="bolt" />
              {pending ? t('working') : t('startSolo')}
              <Icon name="arrow" />
            </Button>
          </form>
          {state.identity.kind !== 'user' ? (
            <p className="field-hint">{t('guestNote')}</p>
          ) : null}
        </section>
        <section className="play-section friends-section">
          <div className="section-heading">
            <Icon name="users" />
            <h2>{t('friendsTitle')}</h2>
          </div>
          <p>{t('friendsIntro')}</p>
          {state.identity.kind === 'user' ? (
            <div className="stack">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  const parsed = settingsSchema.safeParse(settings);
                  if (!parsed.success || settings.rounds > state.maxRounds) {
                    fail(t('invalidSettings', { rounds: state.maxRounds }));
                    return;
                  }
                  void run(async () => {
                    await client.command('room:create', {
                      settings: parsed.data,
                    });
                    navigate('/game');
                  });
                }}
              >
                {t('createRoom')}
              </Button>
              <form
                className="join-form"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!/^[A-Z2-9]{6}$/.test(code.trim().toUpperCase())) {
                    fail(t('invalidCode'));
                    return;
                  }
                  void run(async () => {
                    await client.command('room:join', {
                      roomCode: code.trim().toUpperCase(),
                    });
                    navigate('/game');
                  });
                }}
              >
                <Field
                  label={t('roomCode')}
                  name="roomCode"
                  maxLength={6}
                  autoComplete="off"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                  spellCheck={false}
                  required
                  disabled={pending}
                />
                <Button variant="secondary" type="submit" disabled={pending}>
                  {t('joinRoom')}
                </Button>
              </form>
            </div>
          ) : (
            <Link className="button button--secondary" href="/sign-in">
              {t('friendsSignIn')}
            </Link>
          )}
        </section>
        {state.session === 'unavailable' ? (
          <Notice
            kind="warning"
            action={
              <Button
                variant="quiet"
                onClick={() => void client.checkSession()}
              >
                {t('retry')}
              </Button>
            }
          >
            {t('sessionUnavailable')}
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
