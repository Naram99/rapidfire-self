import type { GameSettings } from '@rapidfire/contracts';
import { t } from '../lib/copy';
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
  return (
    <fieldset className="settings-fields" disabled={disabled}>
      <legend>{t('settings')}</legend>
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
