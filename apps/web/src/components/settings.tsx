import { useId } from 'react';
import { gameTopicSchema } from '@rapidfire/contracts';
import type { GameSettings } from '@rapidfire/contracts';
import { t, topicName } from '../lib/copy';
import { Field } from './ui';

export function Settings({
  value,
  change,
  maxRounds,
  disabled = false,
}: {
  value: GameSettings;
  change: (settings: GameSettings) => void;
  maxRounds: number;
  disabled?: boolean;
}) {
  const topicSelectId = useId();
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
      <p className="field-hint">{t('questionsPerRound')}</p>
    </fieldset>
  );
}
