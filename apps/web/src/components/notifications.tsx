import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { NoticeKind } from '../lib/client';
import { t } from '../lib/copy';
import { Button, Icon } from './ui';

type NotificationOptions = Readonly<{
  kind?: NoticeKind;
  key?: string;
}>;
type Notification = Readonly<{
  id: number;
  message: string;
  kind: NoticeKind;
  key: string | undefined;
}>;
const NotificationsContext = createContext<Readonly<{
  notify: (message: string, options?: NotificationOptions) => void;
  clear: (key: string) => void;
}> | null>(null);

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('NotificationsProvider is required');
  return context;
}

function Toast({
  notification,
  visible,
  dismiss,
}: {
  notification: Notification;
  visible: boolean;
  dismiss: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(notification.kind === 'error' ? 8000 : 5000);
  const paused = hovered || focused || !visible;
  useEffect(() => {
    if (paused) return;
    const started = performance.now();
    const timer = setTimeout(() => dismiss(notification.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - started),
      );
    };
  }, [paused, notification.id, dismiss]);
  const close = () => {
    if (ref.current?.contains(document.activeElement))
      previousFocus.current?.focus();
    dismiss(notification.id);
  };
  return (
    <div
      ref={ref}
      className={`toast toast--${notification.kind}`}
      role={notification.kind === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          previousFocus.current =
            event.relatedTarget instanceof HTMLElement
              ? event.relatedTarget
              : null;
          setFocused(true);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <span className="toast-icon">
        <Icon
          name={
            notification.kind === 'success'
              ? 'check'
              : notification.kind === 'info'
                ? 'info'
                : 'alert'
          }
        />
      </span>
      <p>{notification.message}</p>
      <Button
        className="toast-dismiss"
        variant="quiet"
        type="button"
        aria-label={t('dismiss')}
        onClick={close}
      >
        <Icon name="cross" />
      </Button>
    </div>
  );
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<readonly Notification[]>(
    [],
  );
  const [visible, setVisible] = useState(() => !document.hidden);
  const sequence = useRef(0);
  const notify = useCallback(
    (message: string, options: NotificationOptions = {}) => {
      const notification: Notification = {
        id: ++sequence.current,
        message,
        kind: options.kind ?? 'info',
        key: options.key,
      };
      setNotifications((current) =>
        [
          ...current.filter((item) => !options.key || item.key !== options.key),
          notification,
        ].slice(-3),
      );
    },
    [],
  );
  const dismiss = useCallback((id: number) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }, []);
  const clear = useCallback((key: string) => {
    setNotifications((current) => current.filter((item) => item.key !== key));
  }, []);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  return (
    <NotificationsContext.Provider value={{ notify, clear }}>
      {children}
      <section className="toast-region" aria-label={t('notifications')}>
        {notifications.map((notification) => (
          <Toast
            key={notification.id}
            notification={notification}
            visible={visible}
            dismiss={dismiss}
          />
        ))}
      </section>
    </NotificationsContext.Provider>
  );
}
