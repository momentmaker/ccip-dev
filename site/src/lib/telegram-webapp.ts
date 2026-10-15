/** The slice of Telegram's Mini App API (telegram-web-app.js; core.telegram.org/bots/webapps) the LinkMarines app uses. */
export interface BottomButtonParams {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
  has_shine_effect?: boolean;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  /** ios, android, android_x, tdesktop, macos, weba, webk, unigram, unknown. */
  platform: string;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  MainButton: { setParams(params: BottomButtonParams): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: { impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void; notificationOccurred(type: 'error' | 'success' | 'warning'): void };
  openTelegramLink(url: string): void;
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  DeviceOrientation?: { start(params: { refresh_rate?: number }, cb?: (started: boolean) => void): void; stop(): void; beta: number | null; gamma: number | null };
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
}

/** Telegram's Mini App object when the page runs inside Telegram with launch data; null in a plain browser, where the script still loads. */
export function telegramWebApp(win: { Telegram?: { WebApp?: TelegramWebApp } }): TelegramWebApp | null {
  const app = win.Telegram?.WebApp;
  return app && app.initData ? app : null;
}
