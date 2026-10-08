import { useEffect, useState } from 'react';
import {
  emailRequestSchema,
  EMAIL_VERIFICATION_REQUEST_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from '@rapidfire/contracts';
import type { GameClient } from '../lib/client';
import { request } from '../lib/api';
import { message, t } from '../lib/copy';
import { Link, navigate } from '../lib/router';
import { DataForm } from '../components/data-form';
import { Button, Notice } from '../components/ui';

const emailField = {
  name: 'email',
  label: t('email'),
  type: 'email',
  autoComplete: 'email',
  maxLength: 254,
} as const;
const passwordField = {
  name: 'password',
  label: t('password'),
  type: 'password',
  autoComplete: 'current-password',
  maxLength: 128,
} as const;
const confirmField = {
  name: 'passwordConfirm',
  label: t('passwordConfirm'),
  type: 'password',
  autoComplete: 'new-password',
  maxLength: 128,
} as const;

function returnPath(route: URL): string {
  return route.searchParams.get('returnTo') === '/game' ? '/game' : '/';
}
export function AuthPage({
  route,
  client,
}: {
  route: URL;
  client: GameClient;
}) {
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  const signUp = route.pathname === '/sign-up';
  const forgot = route.pathname === '/forgot-password';
  const title = done
    ? t('signupSent')
    : forgot
      ? t('forgotTitle')
      : signUp
        ? t('signUp')
        : t('signIn');
  return (
    <section className="page page--form">
      <Link className="back-link" href="/">
        {t('back')}
      </Link>
      <h1>{title}</h1>
      <p className="page-intro">
        {done
          ? t('signupSentDetail')
          : forgot
            ? t('forgotIntro')
            : signUp
              ? t('signUpIntro')
              : t('signInIntro')}
      </p>
      {note ? <Notice>{note}</Notice> : null}
      {done ? (
        <div className="stack">
          <Button
            variant="secondary"
            disabled={resending || wait > 0}
            onClick={async () => {
              setResending(true);
              try {
                await request('/api/auth/send-verification-email', {
                  body: {
                    email,
                    callbackURL: `${window.location.origin}/verify-email`,
                  },
                });
                setNote(EMAIL_VERIFICATION_REQUEST_MESSAGE);
                setWait(60);
              } catch (error) {
                setNote(message(error));
              } finally {
                setResending(false);
              }
            }}
          >
            {t('resend')}
          </Button>
          {wait ? <p>{t('resendWait', { seconds: wait })}</p> : null}
          <Link className="button button--primary" href="/sign-in">
            {t('signIn')}
          </Link>
        </div>
      ) : forgot ? (
        <DataForm
          fields={[emailField]}
          validator={emailRequestSchema}
          submitLabel={t('sendReset')}
          submit={async (data, signal) => {
            await request('/api/auth/request-password-reset', {
              body: {
                ...data,
                redirectTo: `${window.location.origin}/reset-password`,
              },
              signal,
            });
            setNote(PASSWORD_RESET_REQUEST_MESSAGE);
          }}
        />
      ) : signUp ? (
        <>
          <DataForm
            fields={[
              {
                name: 'name',
                label: t('nickname'),
                autoComplete: 'nickname',
                maxLength: 40,
              },
              emailField,
              {
                ...passwordField,
                autoComplete: 'new-password',
                hint: t('passwordHint'),
              },
              confirmField,
            ]}
            validator={signUpSchema}
            submitLabel={t('signUp')}
            submit={async (data, signal) => {
              await request('/api/auth/sign-up/email', {
                body: {
                  ...data,
                  callbackURL: `${window.location.origin}/verify-email`,
                },
                signal,
              });
              setEmail(data.email);
            }}
            onSuccess={() => {
              setWait(60);
              setDone(true);
            }}
          />
          <p>
            {t('haveAccount')} <Link href="/sign-in">{t('signIn')}</Link>
          </p>
        </>
      ) : (
        <>
          <DataForm
            fields={[emailField, passwordField]}
            validator={signInSchema}
            submitLabel={t('signIn')}
            submit={async (data, signal) => {
              await request('/api/auth/sign-in/email', { body: data, signal });
              await client.signedIn();
            }}
            onSuccess={() => navigate(returnPath(route), true)}
          >
            <Link href="/forgot-password">{t('forgot')}</Link>
          </DataForm>
          <p>
            {t('noAccount')} <Link href="/sign-up">{t('signUp')}</Link>
          </p>
          <details>
            <summary>{t('resend')}</summary>
            <DataForm
              fields={[emailField]}
              validator={emailRequestSchema}
              submitLabel={t('resend')}
              submit={async (data, signal) => {
                await request('/api/auth/send-verification-email', {
                  body: {
                    ...data,
                    callbackURL: `${window.location.origin}/verify-email`,
                  },
                  signal,
                });
                setNote(EMAIL_VERIFICATION_REQUEST_MESSAGE);
              }}
            />
          </details>
        </>
      )}
    </section>
  );
}

export function ResetPage({
  route,
  client,
}: {
  route: URL;
  client: GameClient;
}) {
  const [token] = useState(() => route.searchParams.get('token'));
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (token) window.history.replaceState({}, '', '/reset-password');
  }, [token]);
  return (
    <section className="page page--form">
      <h1>{t('resetTitle')}</h1>
      <p className="page-intro">{t('resetIntro')}</p>
      {done ? (
        <>
          <Notice kind="success">{t('resetDone')}</Notice>
          <Link className="button button--primary" href="/sign-in">
            {t('signIn')}
          </Link>
        </>
      ) : token ? (
        <DataForm
          fields={[
            {
              name: 'newPassword',
              label: t('newPassword'),
              type: 'password',
              autoComplete: 'new-password',
              maxLength: 128,
              hint: t('passwordHint'),
            },
            confirmField,
          ]}
          validator={{
            safeParse: (value) =>
              resetPasswordSchema.safeParse(
                typeof value === 'object' && value !== null
                  ? { ...value, token }
                  : value,
              ),
          }}
          submitLabel={t('savePassword')}
          submit={async (data, signal) => {
            await request('/api/auth/reset-password', { body: data, signal });
            await client.signedOut();
          }}
          onSuccess={() => setDone(true)}
        />
      ) : (
        <>
          <Notice kind="error">{t('missingToken')}</Notice>
          <Link href="/forgot-password">{t('forgotTitle')}</Link>
        </>
      )}
    </section>
  );
}

export function VerificationPage({ route }: { route: URL }) {
  const [token] = useState(() => route.searchParams.get('token'));
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>(
    token ? 'checking' : 'invalid',
  );
  useEffect(() => {
    if (!token) return;
    window.history.replaceState({}, '', '/verify-email');
    const controller = new AbortController();
    void request(`/api/auth/verify-email?${new URLSearchParams({ token })}`, {
      signal: controller.signal,
    })
      .then(() => {
        if (!controller.signal.aborted) setStatus('valid');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('invalid');
      });
    return () => controller.abort();
  }, [token]);
  return (
    <section className="page page--form">
      <h1>
        {t(
          status === 'checking'
            ? 'loading'
            : status === 'valid'
              ? 'verified'
              : 'signupSent',
        )}
      </h1>
      {status === 'checking' ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          <Notice kind={status === 'valid' ? 'success' : 'error'}>
            {t(status === 'valid' ? 'verifiedDetail' : 'verificationFailed')}
          </Notice>
          <Link className="button button--primary" href="/sign-in">
            {t('signIn')}
          </Link>
        </>
      )}
    </section>
  );
}
