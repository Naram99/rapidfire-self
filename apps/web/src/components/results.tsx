import type { PublicResult } from '@rapidfire/contracts';
import { numbers, t } from '../lib/copy';

export type ResultSummary = Pick<
  PublicResult,
  | 'roundNumber'
  | 'questionNumber'
  | 'outcome'
  | 'selectedCorrectCount'
  | 'correctOptionCount'
  | 'pointsAwarded'
>;
export function outcomeText(result: ResultSummary): string {
  return result.outcome === 'partial'
    ? t('resultPartial', {
        selected: result.selectedCorrectCount,
        total: result.correctOptionCount,
      })
    : t(
        result.outcome === 'correct'
          ? 'resultCorrect'
          : result.outcome === 'incorrect'
            ? 'resultIncorrect'
            : 'resultUnanswered',
      );
}
export function QuestionResults({
  results,
}: {
  results: readonly ResultSummary[];
}) {
  return (
    <ol className="question-results">
      {results.map((result) => (
        <li key={`${result.roundNumber}:${result.questionNumber}`}>
          <span>
            {t('questionSummary', {
              round: result.roundNumber,
              question: result.questionNumber,
            })}
          </span>
          <span className={`result-label result-label--${result.outcome}`}>
            {outcomeText(result)}
          </span>
          <strong>
            {t('points', { points: numbers.format(result.pointsAwarded) })}
          </strong>
        </li>
      ))}
    </ol>
  );
}
export function Standings({
  participants,
}: {
  participants: readonly Readonly<{
    id: string;
    name: string | null;
    score: number;
    rank: number | null;
    identityState: string;
  }>[];
}) {
  return (
    <div className="standings">
      <table>
        <caption>{t('resultIntro')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('place')}</th>
            <th scope="col">{t('players')}</th>
            <th scope="col">{t('score')}</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((player) => (
            <tr key={player.id}>
              <td>{player.rank ?? '—'}</td>
              <th scope="row">
                {player.identityState === 'deleted_user'
                  ? t('deletedUser')
                  : player.name}
              </th>
              <td>{numbers.format(player.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
