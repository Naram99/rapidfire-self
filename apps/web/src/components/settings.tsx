import { useId } from 'react';
import { gameTopicSchema } from '@rapidfire/contracts';
import type { GameSettings, GenerationRelease } from '@rapidfire/contracts';
import { t, topicName } from '../lib/copy';
import { Field } from './ui';

export function Settings({
  value,
  change,
  maxRounds,
  releases = [],
  defaultReleaseId = null,
  disabled = false,
}: {
  value: GameSettings;
  change: (settings: GameSettings) => void;
  maxRounds: number;
  releases?: readonly GenerationRelease[];
  defaultReleaseId?: string | null;
  disabled?: boolean;
}) {
  const topicSelectId = useId();
  const releaseSelectId = useId();
  const customSeedId = useId();
  return (
    <fieldset className="settings-fields" disabled={disabled}>
      <legend>{t('settings')}</legend>
      <div className="field settings-topic">
        <label htmlFor={topicSelectId}>{t('gameTopic')}</label>
        <select
          id={topicSelectId}
          name="topicId"
          value={value.topicId}
          required
          onChange={(event) => {
            const topic = gameTopicSchema.safeParse(event.target.value);
            if (topic.success) change({ ...value, topicId: topic.data });
          }}
        >
          {gameTopicSchema.options.map((topicId) => (
            <option key={topicId} value={topicId}>
              {topicName(topicId)}
            </option>
          ))}
        </select>
      </div>
      <Field
        label={t('rounds')}
        name="rounds"
        type="number"
        inputMode="numeric"
        min={1}
        max={maxRounds}
        step={1}
        value={value.rounds}
        onChange={(event) =>
          change({ ...value, rounds: Number(event.target.value) })
        }
        autoComplete="off"
        required
        hint={t('availableRounds', { rounds: maxRounds })}
      />
      <Field
        label={t('answerTime')}
        name="answerTime"
        type="number"
        inputMode="numeric"
        min={5}
        max={60}
        step={1}
        value={value.answerTimeMs / 1000}
        onChange={(event) =>
          change({ ...value, answerTimeMs: Number(event.target.value) * 1000 })
        }
        autoComplete="off"
        required
      />

      <div className="field settings-version">
        <label htmlFor={releaseSelectId}>{t('questionVersion')}</label>
        <select
          id={releaseSelectId}
          name="releaseId"
          value={value.releaseId ?? defaultReleaseId ?? ''}
          onChange={(event) =>
            change({ ...value, releaseId: event.target.value || null })
          }
        >
          {!releases.length ? (
            <option value="">{t('noQuestionVersion')}</option>
          ) : null}
          {value.releaseId &&
          !releases.some((release) => release.id === value.releaseId) ? (
            <option value={value.releaseId}>{t('unavailableVersion')}</option>
          ) : null}
          {releases.map((release) => (
            <option key={release.id} value={release.id}>
              {release.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field settings-seed">
        <label className="checkbox-label" htmlFor={customSeedId}>
          <input
            id={customSeedId}
            type="checkbox"
            checked={value.seed !== null}
            onChange={(event) =>
              change({ ...value, seed: event.target.checked ? '' : null })
            }
          />
          {t('customSeed')}
        </label>
        {value.seed !== null ? (
          <Field
            label={t('seed')}
            name="seed"
            value={value.seed}
            minLength={1}
            maxLength={10}
            pattern="[A-Za-z0-9]{1,10}"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            onChange={(event) => change({ ...value, seed: event.target.value })}
            hint={t('seedHint')}
          />
        ) : (
          <p className="field-hint">{t('automaticSeedHint')}</p>
        )}
      </div>
      <p className="field-hint">{t('questionsPerRound')}</p>
    </fieldset>
  );
}
