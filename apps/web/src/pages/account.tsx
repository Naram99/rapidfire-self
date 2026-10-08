import { useState } from 'react';
import {
  changePasswordSchema,
  deleteAccountSchema,
  profileUpdateSchema,
} from '@rapidfire/contracts';
import type { Profile } from '@rapidfire/contracts';
import type { GameClient } from '../lib/client';
import { request } from '../lib/api';
import { numbers, t } from '../lib/copy';
import { navigate } from '../lib/router';
import { DataForm } from '../components/data-form';
import { Button, Dialog, Notice } from '../components/ui';

export function AccountPage({
  profile,
  client,
}: {
  profile: Profile;
  client: GameClient;
}) {
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <section className="page">
      <h1>{t('profile')}</h1>
      <p className="page-intro">{t('profileIntro')}</p>
      <div className="account-layout">
        <section className="surface">
          <h2>{profile.nickname}</h2>
          <p className="email-address">{profile.email}</p>
          {saved ? <Notice kind="success">{t('profileSaved')}</Notice> : null}
          <DataForm
            key={profile.nickname}
            fields={[
              {
                name: 'nickname',
                label: t('nickname'),
                autoComplete: 'nickname',
                defaultValue: profile.nickname,
                maxLength: 40,
              },
            ]}
            validator={profileUpdateSchema}
            submitLabel={t('saveProfile')}
            submit={async (data, signal) => {
              await request('/api/profile', {
                method: 'PATCH',
                body: data,
                signal,
              });
            }}
            onSuccess={() => {
              setSaved(true);
              void client.checkSession();
            }}
          />
          <div className="elo">
            <span>{t('elo')}</span>
            <strong>{numbers.format(profile.elo)}</strong>
            <p>{t('eloHint')}</p>
          </div>
        </section>
        <section className="surface">
          <h2>{t('security')}</h2>
          <details>
            <summary>{t('changePassword')}</summary>
            <DataForm
              fields={[
                {
                  name: 'currentPassword',
                  label: t('currentPassword'),
                  type: 'password',
                  autoComplete: 'current-password',
                  maxLength: 128,
                },
                {
                  name: 'newPassword',
                  label: t('newPassword'),
                  type: 'password',
                  autoComplete: 'new-password',
                  maxLength: 128,
                  hint: t('passwordHint'),
                },
                {
                  name: 'passwordConfirm',
                  label: t('passwordConfirm'),
                  type: 'password',
                  autoComplete: 'new-password',
                  maxLength: 128,
                },
              ]}
              validator={changePasswordSchema}
              submitLabel={t('savePassword')}
              submit={async (data, signal) => {
                await request('/api/auth/change-password', {
                  body: data,
                  signal,
                });
              }}
              onSuccess={() => {
                void client.signedOut();
                client.notify(t('passwordChanged'));
                navigate('/sign-in');
              }}
            />
          </details>
          <div className="danger-zone">
            <Button
              variant="danger"
              type="button"
              onClick={() => setDeleting(true)}
            >
              {t('deleteAccount')}
            </Button>
          </div>
        </section>
      </div>
      {deleting ? (
        <Dialog title={t('deleteTitle')} close={() => setDeleting(false)}>
          <p>{t('deleteDetail')}</p>
          <DataForm
            fields={[
              {
                name: 'password',
                label: t('currentPassword'),
                type: 'password',
                autoComplete: 'current-password',
                maxLength: 128,
              },
            ]}
            validator={deleteAccountSchema}
            danger
            submitLabel={t('confirmDelete')}
            submit={async (data, signal) => {
              await request('/api/auth/delete-user', { body: data, signal });
            }}
            onSuccess={() => {
              void client.signedOut();
              client.notify(t('accountDeleted'));
              navigate('/');
            }}
          />
          <Button
            variant="quiet"
            type="button"
            onClick={() => setDeleting(false)}
          >
            {t('stay')}
          </Button>
        </Dialog>
      ) : null}
    </section>
  );
}
