import { useSyncExternalStore } from 'react';
import type { ComponentProps } from 'react';

const event = 'rapidfire:navigation';
const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback);
  window.addEventListener(event, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(event, callback);
  };
};
const location = () => window.location.pathname + window.location.search;
export function navigate(path: string, replace = false): void {
  const target = new URL(path, window.location.origin);
  if (target.origin !== window.location.origin) return;
  if (
    !window.dispatchEvent(
      new Event('rapidfire:before-navigation', { cancelable: true }),
    )
  )
    return;
  window.history[replace ? 'replaceState' : 'pushState'](
    {},
    '',
    target.pathname + target.search,
  );
  window.dispatchEvent(new Event(event));
}
export function useRoute() {
  const path = useSyncExternalStore(subscribe, location);
  return new URL(path, window.location.origin);
}
export function Link({
  href,
  onClick,
  ...props
}: ComponentProps<'a'> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          !props.target
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
