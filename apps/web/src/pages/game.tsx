import { useRef, useState } from 'react';
import {
  ENGLISH_INTERRUPTION_MESSAGES,
  settingsSchema,
} from '@rapidfire/contracts';
import type {
  GameSettings,
  PublicPhase,
  PublicRoom,
  Snapshot,
} from '@rapidfire/contracts';
import type { ClientState, GameClient } from '../lib/client';
import { message, numbers, t } from '../lib/copy';
import { Link, navigate } from '../lib/router';
import { Button, Icon, Notice, Timer, useDeadline } from '../components/ui';
import { Settings } from '../components/settings';
import { outcomeText, QuestionResults, Standings } from '../components/results';

type GameProps = Readonly<{
  client: GameClient;
  state: ClientState;
  snapshot: Snapshot;
}>;
type Phase<Type extends PublicPhase['type']> = Extract<
  PublicPhase,
  { type: Type }
>;
const playerName = (
  player: Readonly<{ name: string; identityState: string }>,
) => (player.identityState === 'deleted_user' ? t('deletedUser') : player.name);

function Grace({ deadline, state }: { deadline: number; state: ClientState }) {
  const { seconds } = useDeadline(deadline, state.clock);
  return <span className="status-tag">{t('grace', { seconds })}</span>;
}
function LobbySettings({
  room,
  client,
  state,
  canUpdate,
}: {
  room: PublicRoom;
  client: GameClient;
  state: ClientState;
  canUpdate: boolean;
}) {
  const [settings, setSettings] = useState<GameSettings>(room.settings);
  const [error, setError] = useState<string | null>(null);
  if (!canUpdate)
    return (
      <p className="room-settings">
        {t('roundSettings', {
          rounds: room.settings.rounds,
          seconds: room.settings.answerTimeMs / 1000,
        })}
      </p>
    );
  return (
    <details>
      <summary>{t('settings')}</summary>
      <form
        className="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          const parsed = settingsSchema.safeParse(settings);
          if (!parsed.success || settings.rounds > state.maxRounds) {
            setError(t('invalidSettings', { rounds: state.maxRounds }));
            return;
          }
          try {
            await client.command('room:settings:update', {
              roomId: room.id,
              expectedSettingsVersion: room.settingsVersion,
              settings: parsed.data,
            });
            client.notify(t('settingsSaved'));
            setError(null);
          } catch (error) {
            setError(message(error));
          }
        }}
      >
        <Settings
          value={settings}
          change={setSettings}
          maxRounds={state.maxRounds}
          disabled={state.pending !== null || state.connection !== 'connected'}
        />
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Button
          variant="secondary"
          type="submit"
          disabled={state.pending !== null || state.connection !== 'connected'}
        >
          {t('updateSettings')}
        </Button>
      </form>
    </details>
  );
}
export function LobbyPage({ client, state, snapshot }: GameProps) {
  const room = snapshot.room;
  const [copyError, setCopyError] = useState<string | null>(null);
  if (!room) return null;
  const self = room.members.find(
    (member) => member.id === snapshot.self.memberId,
  );
  return (
    <section className="page lobby-page">
      <h1>{t('lobby')}</h1>
      <p className="page-intro">{t('lobbyIntro')}</p>
      <div className="lobby-layout">
        <section className="room-controls surface">
          <span>{t('roomCode')}</span>
          <strong className="room-code" translate="no">
            {room.code}
          </strong>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(room.code);
                client.notify(t('copied'));
                setCopyError(null);
              } catch {
                setCopyError(t('copyFailed'));
              }
            }}
          >
            <Icon name="copy" />
            {t('copyCode')}
          </Button>
          {copyError ? <Notice>{copyError}</Notice> : null}
          <LobbySettings
            key={room.settingsVersion}
            room={room}
            client={client}
            state={state}
            canUpdate={snapshot.permissions.canUpdateSettings}
          />
          {snapshot.permissions.requiresAuthentication ? (
            <Notice
              kind="warning"
              action={
                <Link
                  className="button button--secondary"
                  href="/sign-in?returnTo=/game"
                >
                  {t('signIn')}
                </Link>
              }
            >
              {t('lobbyAuth')}
            </Notice>
          ) : null}
          <Button
            disabled={
              !snapshot.permissions.canReady ||
              state.connection !== 'connected' ||
              state.pending !== null
            }
            variant={self?.ready ? 'secondary' : 'primary'}
            onClick={() => {
              void client
                .command('room:ready', {
                  roomId: room.id,
                  lobbyCycleId: room.lobbyCycleId,
                  ready: !self?.ready,
                })
                .catch((error: unknown) => client.notify(message(error)));
            }}
          >
            <Icon name="check" />
            {t(self?.ready ? 'cancelReady' : 'readyButton')}
          </Button>
          {snapshot.phase.type === 'start_countdown' ? (
            <Timer
              deadline={snapshot.phase.deadline}
              clock={state.clock}
              label={t('starting')}
              large
            />
          ) : (
            <p className="field-hint">{t('waitingPlayers')}</p>
          )}
        </section>
        <section className="players-panel">
          <h2>
            {t('players')}{' '}
            <span className="count">{room.members.length}/10</span>
          </h2>
          <ol className="participant-list">
            {room.members.map((member) => (
              <li key={member.id}>
                <span className="avatar" aria-hidden="true">
                  {Array.from(member.name)[0]?.toLocaleUpperCase('en') ?? '?'}
                </span>
                <div className="player-info">
                  <strong>
                    {member.name}
                    {member.id === snapshot.self.memberId ? (
                      <span className="self-label"> {t('you')}</span>
                    ) : null}
                  </strong>
                  <div className="player-tags">
                    {member.id === room.ownerMemberId ? (
                      <span className="status-tag">{t('owner')}</span>
                    ) : null}
                    <span
                      className={`status-tag ${member.ready ? 'status-tag--success' : ''}`}
                    >
                      {t(member.ready ? 'ready' : 'notReady')}
                    </span>
                    {member.presence === 'offline' ? (
                      <span className="status-tag status-tag--warning">
                        {t('offline')}
                      </span>
                    ) : null}
                    {member.authentication === 'required' ? (
                      <span className="status-tag status-tag--warning">
                        {t('authenticationRequired')}
                      </span>
                    ) : null}
                    {member.graceDeadline !== null ? (
                      <Grace deadline={member.graceDeadline} state={state} />
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function Participants({ snapshot }: { snapshot: Snapshot }) {
  return (
    <aside className="players-panel">
      <h2>{t('players')}</h2>
      <ol className="participant-list">
        {snapshot.match?.participants.map((player) => (
          <li key={player.id}>
            <span className="avatar" aria-hidden="true">
              {Array.from(playerName(player))[0]?.toLocaleUpperCase('en') ??
                '?'}
            </span>
            <div className="player-info">
              <strong>
                {playerName(player)}
                {player.id === snapshot.self.participantId ? (
                  <span className="self-label"> {t('you')}</span>
                ) : null}
              </strong>
              <div className="player-tags">
                {player.answered ? (
                  <span className="status-tag status-tag--success">
                    <Icon name="check" />
                    {t('answered')}
                  </span>
                ) : null}
                {player.activity === 'idle' ? (
                  <span className="status-tag status-tag--warning">
                    {t('idle')}
                  </span>
                ) : null}
                {player.presence === 'offline' ? (
                  <span className="status-tag status-tag--warning">
                    {t('offline')}
                  </span>
                ) : null}
                {player.participation === 'left' ? (
                  <span className="status-tag">{t('left')}</span>
                ) : null}
              </div>
            </div>
            <strong className="player-score">
              {numbers.format(player.score)}
            </strong>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function CategorySelection({
  client,
  state,
  snapshot,
  phase,
}: GameProps & { phase: Phase<'category_selection'> }) {
  const selector = snapshot.match?.participants.find(
    (player) => player.id === phase.selectorParticipantId,
  );
  const { seconds } = useDeadline(phase.deadline, state.clock);
  return (
    <div className="category-selection">
      <h1>{t('categoryTitle')}</h1>
      <p className="page-intro">
        {snapshot.permissions.canSelectCategory
          ? t('categoryHint')
          : selector
            ? t('categoryWaiting', { name: playerName(selector) })
            : t('categoryAuto')}
      </p>
      <div className="category-options">
        {phase.offeredCategories.map((category) => (
          <Button
            key={category.id}
            variant="secondary"
            disabled={
              !snapshot.permissions.canSelectCategory ||
              state.pending !== null ||
              state.connection !== 'connected' ||
              seconds === 0
            }
            aria-label={t('chooseCategory', { category: category.name })}
            onClick={() => {
              const match = snapshot.match;
              if (!match) return;
              void client
                .command('category:select', {
                  matchId: match.id,
                  phaseId: phase.id,
                  roundId: phase.roundId,
                  categoryId: category.id,
                })
                .catch((error: unknown) => client.notify(message(error)));
            }}
          >
            <span lang={category.language}>{category.name}</span>
            <Icon name="arrow" />
          </Button>
        ))}
      </div>
    </div>
  );
}

function Answering({
  client,
  state,
  snapshot,
  phase,
}: GameProps & { phase: Phase<'answering'> }) {
  const [draft, setDraft] = useState<readonly string[]>([]);
  const submitting = useRef(false);
  const { milliseconds } = useDeadline(phase.deadline, state.clock);
  const receipt = snapshot.self.answer;
  const selected = receipt?.selectedOptionIds ?? draft;
  const pending = state.pending === 'answer:submit';
  const locked =
    Boolean(receipt) ||
    pending ||
    !snapshot.permissions.canSubmitAnswer ||
    milliseconds === 0 ||
    state.connection !== 'connected';
  const progress = Math.min(
    1,
    milliseconds / Math.max(1, phase.deadline - phase.openedAt),
  );
  const submit = (optionIds: readonly string[]) => {
    const match = snapshot.match;
    if (!match || locked || submitting.current || optionIds.length === 0)
      return;
    submitting.current = true;
    setDraft(optionIds);
    void client
      .command('answer:submit', {
        matchId: match.id,
        questionId: phase.question.id,
        selectedOptionIds: [...optionIds],
      })
      .catch((error: unknown) => client.notify(message(error)))
      .finally(() => {
        submitting.current = false;
      });
  };
  return (
    <div className="question-panel">
      <div className="time-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <h1 lang={phase.question.language} className="question-heading">
        {phase.question.text}
      </h1>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(selected);
        }}
      >
        <fieldset className="answers" disabled={locked}>
          <legend>
            {t(phase.question.type === 'single' ? 'selectOne' : 'selectMany')}
          </legend>
          {phase.question.options.map((option) =>
            phase.question.type === 'single' ? (
              <button
                type="button"
                className="answer-option"
                key={option.id}
                aria-pressed={selected.includes(option.id)}
                onClick={() => submit([option.id])}
              >
                <span lang={phase.question.language}>{option.text}</span>
                <Icon name="check" />
              </button>
            ) : (
              <label className="answer-option" key={option.id}>
                <input
                  type="checkbox"
                  name="answer"
                  value={option.id}
                  checked={selected.includes(option.id)}
                  onChange={() =>
                    setDraft((current) =>
                      current.includes(option.id)
                        ? current.filter((id) => id !== option.id)
                        : [...current, option.id],
                    )
                  }
                />
                <span lang={phase.question.language}>{option.text}</span>
                <Icon name="check" />
              </label>
            ),
          )}
        </fieldset>
        {receipt ? (
          <p className="answer-status" role="status">
            <Icon name="lock" />
            {t('answerLocked')}
          </p>
        ) : pending ? (
          <p className="answer-status" role="status">
            {t('answerPending')}
          </p>
        ) : milliseconds === 0 ? (
          <p className="answer-status" role="status">
            {t('timeUp')}
          </p>
        ) : phase.question.type === 'multiple' ? (
          <Button
            className="answer-submit"
            type="submit"
            disabled={locked || selected.length === 0}
          >
            <Icon name="lock" />
            {t('lockAnswer')}
          </Button>
        ) : null}
        {receipt ? <p className="field-hint">{t('awaitingResults')}</p> : null}
      </form>
    </div>
  );
}

function Evaluation({
  snapshot,
  state,
  phase,
}: GameProps & { phase: Phase<'evaluation'> }) {
  const result = phase.results.find(
    (item) => item.participantId === snapshot.self.participantId,
  );
  return (
    <div className="question-panel">
      <h1 lang={phase.question.language} className="question-heading">
        {phase.question.text}
      </h1>
      <div className="evaluated-answers">
        {phase.question.options.map((option) => {
          const correct = phase.correctOptionIds.includes(option.id);
          const selected = snapshot.self.answer?.selectedOptionIds.includes(
            option.id,
          );
          return (
            <div
              key={option.id}
              className={`evaluated-option ${correct ? 'evaluated-option--correct' : selected ? 'evaluated-option--incorrect' : ''}`}
            >
              <span lang={phase.question.language}>{option.text}</span>
              <div className="player-tags">
                {selected ? <span>{t('yourAnswer')}</span> : null}
                {correct ? (
                  <span>
                    <Icon name="check" />
                    {t('correctAnswer')}
                  </span>
                ) : selected ? (
                  <Icon name="cross" />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {result ? (
        <div
          className={`evaluation-summary evaluation-summary--${result.outcome}`}
          role="status"
        >
          <strong>{outcomeText(result)}</strong>
          <span>
            {t('points', { points: numbers.format(result.pointsAwarded) })}
          </span>
        </div>
      ) : (
        <p>{t('noResult')}</p>
      )}
      <Timer
        deadline={phase.deadline}
        clock={state.clock}
        label={t('nextQuestion')}
      />
    </div>
  );
}

export function PersistenceNotice({
  status,
}: {
  status: NonNullable<Snapshot['match']>['persistence']['status'];
}) {
  const key =
    status === 'saved'
      ? 'resultHistory'
      : status === 'pending'
        ? 'persistencePending'
        : status === 'retrying'
          ? 'persistenceRetrying'
          : status === 'failed'
            ? 'persistenceFailed'
            : status === 'not_saved_guest'
              ? 'notSavedGuest'
              : 'persistenceUnavailable';
  return (
    <Notice
      kind={
        status === 'saved' ? 'success' : status === 'failed' ? 'error' : 'info'
      }
    >
      {t(key)}
    </Notice>
  );
}
function Finished({
  client,
  state,
  snapshot,
  phase,
}: GameProps & { phase: Phase<'finished'> }) {
  const { seconds } = useDeadline(phase.deadline, state.clock);
  const own = phase.standings.find(
    (standing) => standing.participantId === snapshot.self.participantId,
  );
  const participants = phase.standings.map((standing) => {
    const player = snapshot.match?.participants.find(
      (participant) => participant.id === standing.participantId,
    );
    return {
      ...standing,
      id: standing.participantId,
      name: player?.name ?? '',
      identityState: player?.identityState ?? 'deleted_user',
    };
  });
  const guest = snapshot.match?.persistence.status === 'not_saved_guest';
  return (
    <div className="finished">
      <h1>{t('resultsTitle')}</h1>
      <div className="final-score">
        <span>{t('yourScore')}</span>
        <strong>{numbers.format(own?.score ?? 0)}</strong>
        <Icon name="trophy" />
      </div>
      {snapshot.match ? (
        <PersistenceNotice status={snapshot.match.persistence.status} />
      ) : null}
      <Standings participants={participants} />
      <h2>{t('yourAnswers')}</h2>
      <QuestionResults
        results={phase.results.filter(
          (result) => result.participantId === snapshot.self.participantId,
        )}
      />
      {guest ? (
        <div className="guest-results">
          <p>{t('guestSave')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              const match = snapshot.match;
              if (!match) return;
              void client
                .command('match:leave', { matchId: match.id })
                .then(() => navigate('/sign-in'))
                .catch((error: unknown) => client.notify(message(error)));
            }}
          >
            {t('signInNext')}
          </Button>
        </div>
      ) : null}
      <p className="returning">{t('returning', { seconds })}</p>
    </div>
  );
}

function PhaseView(props: GameProps) {
  const { phase } = props.snapshot;
  switch (phase.type) {
    case 'category_selection':
      return <CategorySelection {...props} phase={phase} />;
    case 'start_countdown':
      return (
        <div className="countdown-panel">
          <h1>{t('getReady')}</h1>
          <Timer
            deadline={phase.deadline}
            clock={props.state.clock}
            label={t('starting')}
            large
          />
        </div>
      );
    case 'preparing_questions':
      return (
        <div className="countdown-panel">
          <p className="category-name" lang={phase.category.language}>
            {phase.category.name}
          </p>
          <h1>{t('preparing')}</h1>
        </div>
      );
    case 'question_countdown':
      return (
        <div className="countdown-panel">
          <p className="category-name" lang={phase.category.language}>
            {phase.category.name}
          </p>
          <h1>{t('getReady')}</h1>
          <Timer deadline={phase.deadline} clock={props.state.clock} large />
        </div>
      );
    case 'answering':
      return <Answering {...props} key={phase.question.id} phase={phase} />;
    case 'evaluation':
      return <Evaluation {...props} phase={phase} />;
    case 'finished':
      return <Finished {...props} phase={phase} />;
    case 'interrupted':
      return (
        <div className="interrupted">
          <h1>{t('interrupted')}</h1>
          <Notice kind="error">
            {ENGLISH_INTERRUPTION_MESSAGES[phase.reason]}
          </Notice>
          {props.snapshot.match ? (
            <PersistenceNotice
              status={props.snapshot.match.persistence.status}
            />
          ) : null}
          <Timer
            deadline={phase.deadline}
            clock={props.state.clock}
            label={t('back')}
          />
        </div>
      );
    case 'lobby':
    case 'closed':
      return null;
  }
}
export function GamePage(props: GameProps) {
  const { snapshot, state } = props;
  const phase = snapshot.phase;
  if (
    (phase.type === 'lobby' || phase.type === 'start_countdown') &&
    snapshot.room
  )
    return <LobbyPage {...props} />;
  const final = phase.type === 'finished' || phase.type === 'interrupted';
  return (
    <section className="game-page">
      <div className="game-meta">
        <div>
          {'roundNumber' in phase ? (
            <span>
              {t('round', {
                number: phase.roundNumber,
                total: snapshot.match?.settings.rounds ?? 1,
              })}
            </span>
          ) : null}
          {'questionNumber' in phase ? (
            <span>{t('question', { number: phase.questionNumber })}</span>
          ) : null}
          {'category' in phase && phase.type !== 'question_countdown' ? (
            <strong lang={phase.category.language}>
              {phase.category.name}
            </strong>
          ) : null}
        </div>
        {'deadline' in phase && !final ? (
          <Timer deadline={phase.deadline} clock={state.clock} />
        ) : null}
      </div>
      {state.identity.kind === 'none' &&
      snapshot.match?.participants.find(
        (player) => player.id === snapshot.self.participantId,
      )?.identityState === 'registered' ? (
        <Notice kind="warning">{t('authExpired')}</Notice>
      ) : null}
      <div className={final ? 'game-layout game-layout--final' : 'game-layout'}>
        <div className="game-main">
          <PhaseView {...props} />
        </div>
        {!final ? <Participants snapshot={snapshot} /> : null}
      </div>
    </section>
  );
}
