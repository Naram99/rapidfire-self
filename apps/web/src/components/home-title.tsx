import { useEffect, useState } from 'react';
import { t } from '../lib/copy';
import { Button } from './ui';

const titleWords = [
  'titleThink',
  'titleAnswer',
  'titleGuess',
  'titleLearn',
  'titlePlay',
  'titleWin',
] as const;

export function HomeTitle() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionChanged = () => setReducedMotion(preference.matches);
    const visibilityChanged = () => setVisible(!document.hidden);
    preference.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      preference.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  useEffect(() => {
    if (paused || focusPaused || reducedMotion || !visible) return;
    const interval = window.setInterval(
      () => setIndex((current) => (current + 1) % titleWords.length),
      2000,
    );
    return () => window.clearInterval(interval);
  }, [paused, focusPaused, reducedMotion, visible]);

  return (
    <div
      className="home-title"
      onFocusCapture={() => setFocusPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocusPaused(false);
      }}
    >
      <h1 aria-label={t('homeTitle')}>
        <span className="title-words" aria-hidden="true">
          {titleWords.map((word, wordIndex) => (
            <span
              key={word}
              data-active={wordIndex === (reducedMotion ? 0 : index)}
            >
              {t(word)}
            </span>
          ))}
        </span>
        <span className="title-fast" aria-hidden="true">
          {t('titleFast')}
        </span>
        <span className="title-tagline" aria-hidden="true">
          {t('titleTagline')}
        </span>
      </h1>
      {!reducedMotion ? (
        <Button
          variant="quiet"
          className="title-control"
          onClick={() => {
            setFocusPaused(false);
            setPaused((current) => !current);
          }}
        >
          {t(paused ? 'resumeTitle' : 'pauseTitle')}
        </Button>
      ) : null}
    </div>
  );
}
