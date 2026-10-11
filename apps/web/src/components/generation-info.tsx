import type { GenerationMetadata } from '@rapidfire/contracts';
import { t } from '../lib/copy';
export function GenerationInfo({
  generation,
}: {
  generation: GenerationMetadata | null;
}) {
  if (!generation) return null;
  return (
    <div className="generation-info">
      <dl>
        <div>
          <dt>{t('questionVersion')}</dt>
          <dd>{generation.releaseLabel}</dd>
        </div>
        {generation.seed !== null ? (
          <div>
            <dt>{t('seed')}</dt>
            <dd>
              <code translate="no">{generation.seed}</code>
            </dd>
          </div>
        ) : null}
      </dl>
      {generation.eloExclusionReason === 'custom_seed' ? (
        <p className="field-hint">{t('eloExcluded')}</p>
      ) : null}
    </div>
  );
}
