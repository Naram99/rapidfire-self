import { useEffect, useId, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { t } from '../lib/copy';
import type { ClockAnchor } from '../lib/game-state';
import { remaining } from '../lib/game-state';

const paths = {
  flame:
    'M13 2c1 6-5 7-3 11 2-1 3-3 3-5 5 4 7 8 4 12-3 4-10 3-12-1-2-4 0-8 3-11-1 4 0 6 2 7-1-6 6-8 3-13Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 0a4 4 0 0 1 0 8',
  solo: 'M20 21v-2a7 7 0 0 0-14 0v2M13 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  check: 'm5 12 4 4L19 6',
  cross: 'm6 6 12 12M6 18 18 6',
  lock: 'M6 10h12v11H6Zm3 0V6a3 3 0 0 1 6 0v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  bolt: 'm13 2-9 12h7l-1 8 10-13h-7Z',
  copy: 'M9 9h11v12H9ZM5 15H3V3h12v2',
  reload: 'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 2M4 17l2 2a8 8 0 0 0 13-2',
  trophy:
    'M8 3h8v7a4 4 0 0 1-8 0Zm0 1H3v3a5 5 0 0 0 5 5m8-8h5v3a5 5 0 0 1-5 5m-4 2v7m-5 0h10',
  exit: 'M9 3H4v18h5m5-14 5 5-5 5m-6-5h11',
} as const;
export function Icon({
  name,
  ...props
}: ComponentProps<'svg'> & { name: keyof typeof paths }) {
  return (
    <svg
      {...props}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={name === 'flame' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
}) {
  return (
    <button {...props} className={`button button--${variant} ${className}`}>
      {children}
    </button>
  );
}
export function Notice({
  children,
  kind = 'info',
  action,
}: {
  children: ReactNode;
  kind?: 'info' | 'error' | 'success' | 'warning';
  action?: ReactNode;
}) {
  return (
    <div
      className={`notice notice--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}
export function Field({
  label,
  error,
  hint,
  id: suppliedId,
  type,
  ...props
}: ComponentProps<'input'> & {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const generated = useId();
  const id = suppliedId ?? generated;
  const [visible, setVisible] = useState(false);
  const password = type === 'password';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={password ? 'password-control' : undefined}>
        <input
          {...props}
          id={id}
          type={password && visible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? `${id}-help` : undefined}
        />
        {password ? (
          <button
            className="password-toggle"
            type="button"
            aria-label={t(visible ? 'hidePassword' : 'showPassword')}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {t(visible ? 'hidePassword' : 'showPassword')}
          </button>
        ) : null}
      </div>
      {hint || error !== undefined ? (
        <div id={`${id}-help`} className="field-feedback">
          {hint ? <p className="field-hint">{hint}</p> : null}
          <p className="field-error" aria-live="polite">
            {error ?? null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <Button
          variant="quiet"
          type="button"
          aria-label={t('stay')}
          onClick={close}
        >
          <Icon name="cross" />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function useDeadline(deadline: number, anchor: ClockAnchor) {
  const [tick, setTick] = useState(() => performance.now());
  useEffect(() => {
    const interval = setInterval(() => setTick(performance.now()), 200);
    return () => clearInterval(interval);
  }, []);
  const ms = remaining(deadline, anchor, tick);
  return { milliseconds: ms, seconds: Math.ceil(ms / 1000) };
}
export function Timer({
  deadline,
  clock,
  label = t('timeLeft'),
  large = false,
}: {
  deadline: number;
  clock: ClockAnchor;
  label?: string;
  large?: boolean;
}) {
  const { seconds } = useDeadline(deadline, clock);
  return (
    <div className={large ? 'countdown' : 'timer'}>
      <span>{label}</span>
      <strong aria-label={t('seconds', { seconds })}>
        {large ? seconds : t('seconds', { seconds })}
      </strong>
    </div>
  );
}
