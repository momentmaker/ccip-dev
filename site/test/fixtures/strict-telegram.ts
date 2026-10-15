import type { BottomButtonParams, TelegramWebApp } from '../../src/lib/telegram-webapp';

type StoryParams = Parameters<NonNullable<TelegramWebApp['shareToStory']>>[1];

const compareVersions = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number)) as [number[], number[]];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};
const HEX = /^#[0-9a-f]{6}$/i;

const isHttps = (value: string) => /^https:\/\//i.test(value);
const STORY_TEXT_MAX = 200;
const STORY_WIDGET_NAME_MAX = 48;

/** Telegram's own script, as far as the hooks can tell: bottom buttons refuse blank text, colours have to be hex (or a key before 6.9), every button method hands the button back, DeviceOrientation reports radians, and shareToStory refuses what the script does. */
export function strictTelegram(version = '8.0', startParam?: string, platform = 'ios') {
  const atLeast = (v: string) => compareVersions(version, v) >= 0;
  const mainClicks = new Set<() => void>();
  const backClicks = new Set<() => void>();
  const events = new Map<string, Set<() => void>>();
  const mainOn: (() => void)[] = [];
  const mainOff: (() => void)[] = [];
  const backOn: (() => void)[] = [];
  const backOff: (() => void)[] = [];
  const sent: BottomButtonParams[] = [];
  const main = { text: '', visible: false, active: true, color: '', textColor: '' };
  const back = { visible: false };
  const colors = { header: '', background: '', bottomBar: '' };
  const haptics: string[] = [];
  const opened: string[] = [];
  const stories: { mediaUrl: string; params: StoryParams | undefined }[] = [];
  const orientation = { beta: null as number | null, gamma: null as number | null, started: 0, stopped: 0 };

  const mainButton = {
    setParams(params: BottomButtonParams) {
      sent.push(params);
      if (params.text !== undefined) {
        const text = params.text.trim();
        if (!text) throw new Error('WebAppBottomButtonParamInvalid');
        main.text = text;
      }
      if (params.color !== undefined) {
        if (!HEX.test(params.color)) throw new Error('WebAppBottomButtonParamInvalid');
        main.color = params.color;
      }
      if (params.text_color !== undefined) {
        if (!HEX.test(params.text_color)) throw new Error('WebAppBottomButtonParamInvalid');
        main.textColor = params.text_color;
      }
      if (params.is_visible !== undefined) {
        if (params.is_visible && !main.text) throw new Error('WebAppBottomButtonParamInvalid');
        main.visible = params.is_visible;
      }
      if (params.is_active !== undefined) main.active = params.is_active;
      return mainButton;
    },
    show: () => mainButton.setParams({ is_visible: true }),
    hide: () => mainButton.setParams({ is_visible: false }),
    onClick(cb: () => void) {
      mainOn.push(cb);
      mainClicks.add(cb);
      return mainButton;
    },
    offClick(cb: () => void) {
      mainOff.push(cb);
      mainClicks.delete(cb);
      return mainButton;
    },
  };
  const backButton = {
    show() {
      back.visible = true;
      return backButton;
    },
    hide() {
      back.visible = false;
      return backButton;
    },
    onClick(cb: () => void) {
      backOn.push(cb);
      backClicks.add(cb);
      return backButton;
    },
    offClick(cb: () => void) {
      backOff.push(cb);
      backClicks.delete(cb);
      return backButton;
    },
  };
  const deviceOrientation = {
    get beta() {
      return orientation.beta;
    },
    get gamma() {
      return orientation.gamma;
    },
    start() {
      orientation.started++;
      return deviceOrientation;
    },
    stop() {
      orientation.stopped++;
      return deviceOrientation;
    },
  };

  const app: TelegramWebApp = {
    initData: 'query_id=x',
    initDataUnsafe: startParam ? { start_param: startParam } : {},
    platform,
    isVersionAtLeast: atLeast,
    ready: () => undefined,
    expand: () => undefined,
    setHeaderColor(color) {
      if (!atLeast('6.1')) return;
      if (atLeast('6.9') ? !HEX.test(color) : color !== 'bg_color' && color !== 'secondary_bg_color') throw new Error('WebAppHeaderColorKeyInvalid');
      colors.header = color;
    },
    setBackgroundColor(color) {
      if (!atLeast('6.1')) return;
      if (!HEX.test(color)) throw new Error('WebAppBackgroundColorInvalid');
      colors.background = color;
    },
    setBottomBarColor(color) {
      if (!atLeast('7.10')) return;
      colors.bottomBar = color;
    },
    MainButton: mainButton,
    BackButton: backButton,
    HapticFeedback: {
      impactOccurred: (style) => void haptics.push(`impact:${style}`),
      notificationOccurred: (type) => void haptics.push(`notify:${type}`),
    },
    openTelegramLink: (url) => void opened.push(url),
    shareToStory(mediaUrl, params) {
      if (!atLeast('7.8')) return;
      if (!isHttps(mediaUrl)) throw new Error('WebAppMediaUrlInvalid');
      if (params?.text !== undefined && params.text.trim().length > STORY_TEXT_MAX) throw new Error('WebAppShareToStoryParamInvalid');
      if (params?.widget_link !== undefined && (!isHttps(params.widget_link.url) || (params.widget_link.name ?? '').trim().length > STORY_WIDGET_NAME_MAX)) throw new Error('WebAppShareToStoryParamInvalid');
      stories.push({ mediaUrl, params });
    },
    DeviceOrientation: deviceOrientation,
    onEvent(event, cb) {
      events.set(event, (events.get(event) ?? new Set()).add(cb));
    },
    offEvent(event, cb) {
      events.get(event)?.delete(cb);
    },
  };

  return {
    app,
    main,
    back,
    colors,
    sent,
    orientation,
    haptics,
    opened,
    stories,
    mainOn,
    mainOff,
    backOn,
    backOff,
    mainClickCount: () => mainClicks.size,
    backClickCount: () => backClicks.size,
    clickMain: () => [...mainClicks].forEach((cb) => cb()),
    clickBack: () => [...backClicks].forEach((cb) => cb()),
    listeners: (event: string) => events.get(event)?.size ?? 0,
    sense(beta: number | null, gamma: number | null) {
      if ((beta !== null && Math.abs(beta) > Math.PI) || (gamma !== null && Math.abs(gamma) > Math.PI / 2)) throw new Error(`DeviceOrientation reports radians, not degrees: beta ${beta}, gamma ${gamma}`);
      orientation.beta = beta;
      orientation.gamma = gamma;
      events.get('deviceOrientationChanged')?.forEach((cb) => cb());
    },
  };
}
