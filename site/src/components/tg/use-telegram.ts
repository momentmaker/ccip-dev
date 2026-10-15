import { useEffect, useRef, useState } from 'react';
import { webCardUrl } from '../../lib/marines';
import { failureText, TG_BACKGROUND, tilt, tiltOn, type MainButtonState } from '../../lib/tg';
import type { TelegramWebApp } from '../../lib/telegram-webapp';
import { usePrefersReducedMotion } from '../hooks';
import type { Tilt } from './DogTagScreen';

/** Tells Telegram the app is up, takes the full height and paints its chrome; a colour waits for the Bot API version whose script takes it, because an older script throws. */
export function useLaunch(app: TelegramWebApp): void {
  useEffect(() => {
    app.ready();
    app.expand();
    if (app.isVersionAtLeast('6.9')) app.setHeaderColor(TG_BACKGROUND);
    if (app.isVersionAtLeast('6.1')) app.setBackgroundColor(TG_BACKGROUND);
    if (app.isVersionAtLeast('7.10')) app.setBottomBarColor?.(TG_BACKGROUND);
  }, [app]);
}

/** Telegram's bottom button, set for the screen; one click handler, kept current, and hidden again when the app goes. A hidden button is hidden, never given blank text, which Telegram refuses. */
export function useMainButton(app: TelegramWebApp, state: MainButtonState, onClick: () => void): void {
  const click = useRef(onClick);
  click.current = onClick;
  useEffect(() => {
    if (!state.visible) {
      app.MainButton.hide();
      return;
    }
    app.MainButton.setParams({ text: state.text, color: state.color, text_color: state.textColor, is_active: state.active, is_visible: true });
  }, [app, state.text, state.color, state.textColor, state.active, state.visible]);
  useEffect(() => {
    const handler = () => click.current();
    app.MainButton.onClick(handler);
    return () => {
      app.MainButton.offClick(handler);
    };
  }, [app]);
  useEffect(
    () => () => {
      app.MainButton.hide();
    },
    [app],
  );
}

/** Telegram's back button, shown while there is somewhere to go back to, and hidden when the app goes. */
export function useBackButton(app: TelegramWebApp, visible: boolean, onBack: () => void): void {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const handler = () => back.current();
    app.BackButton.onClick(handler);
    return () => {
      app.BackButton.offClick(handler);
    };
  }, [app]);
  useEffect(() => {
    if (visible) app.BackButton.show();
    else app.BackButton.hide();
  }, [app, visible]);
  useEffect(
    () => () => {
      app.BackButton.hide();
    },
    [app],
  );
}

export const CARD_POLL_MS = 2_000;
/** About a minute of polling; after that the public web card stands in. */
export const CARD_POLLS = 30;

export interface OwnCard {
  url: string;
  /** True for the user's own card, which carries their name and photo; false for the public web card that stands in. */
  own: boolean;
}

/** Your own card as an object URL, polled while it is being stamped; the public web card if it never comes or the Worker refuses it. */
export function useOwnCard(card: () => Promise<Blob | null>, serial: number | null): OwnCard | null {
  const [found, setFound] = useState<OwnCard | null>(null);
  useEffect(() => {
    setFound(null);
    if (serial === null) return;
    let stopped = false;
    let made: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (left: number) => {
      let blob: Blob | null;
      try {
        blob = await card();
      } catch (err) {
        if (stopped) return;
        console.warn(failureText(err));
        setFound({ url: webCardUrl(serial), own: false });
        return;
      }
      if (stopped) return;
      if (blob) {
        made = URL.createObjectURL(blob);
        setFound({ url: made, own: true });
      } else if (left <= 1) {
        setFound({ url: webCardUrl(serial), own: false });
      } else {
        timer = setTimeout(() => void poll(left - 1), CARD_POLL_MS);
      }
    };
    void poll(CARD_POLLS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (made) URL.revokeObjectURL(made);
    };
  }, [card, serial]);
  return found;
}

const toDegrees = (radians: number | null) => (radians === null ? null : (radians * 180) / Math.PI);

/** The tilt shimmer: Telegram's DeviceOrientation where it has one (Bot API 8.0, which reports radians), else the browser's, which reports degrees; never under reduced motion. */
export function useTilt(app: TelegramWebApp, active: boolean): Tilt | null {
  const reducedMotion = usePrefersReducedMotion();
  const [state, setState] = useState<Tilt | null>(null);
  useEffect(() => {
    setState(null);
    if (!active) return;
    const telegram = app.isVersionAtLeast('8.0') ? app.DeviceOrientation : undefined;
    if (!tiltOn(reducedMotion, Boolean(telegram) || 'DeviceOrientationEvent' in window)) return;
    let rest: { beta: number; gamma: number } | null = null;
    const apply = (beta: number | null, gamma: number | null) => {
      if (beta === null || gamma === null) return;
      rest ??= { beta, gamma };
      setState(tilt(beta, gamma, rest));
    };
    if (telegram) {
      const changed = () => apply(toDegrees(telegram.beta), toDegrees(telegram.gamma));
      app.onEvent('deviceOrientationChanged', changed);
      telegram.start({ refresh_rate: 50 });
      return () => {
        app.offEvent('deviceOrientationChanged', changed);
        telegram.stop();
      };
    }
    const changed = (e: DeviceOrientationEvent) => apply(e.beta, e.gamma);
    window.addEventListener('deviceorientation', changed);
    return () => window.removeEventListener('deviceorientation', changed);
  }, [app, active, reducedMotion]);
  return state;
}
