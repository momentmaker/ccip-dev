import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sheets from '../src/components/tg/Sheets';
import * as telegram from '../src/components/tg/use-telegram';
import { webCardUrl } from '../src/lib/marines';
import { mainButton } from '../src/lib/tg';
import { strictTelegram } from './fixtures/strict-telegram';

const react = vi.hoisted(() => ({ host: null as { useState: (initial: unknown) => unknown; useRef: (initial: unknown) => unknown; useEffect: (effect: () => unknown, deps?: readonly unknown[]) => void } | null, reducedMotion: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => react.host!.useState(initial),
    useRef: (initial: unknown) => react.host!.useRef(initial),
    useEffect: (effect: () => unknown, deps?: readonly unknown[]) => react.host!.useEffect(effect, deps),
  };
});
vi.mock('../src/components/hooks', () => ({ usePrefersReducedMotion: () => react.reducedMotion }));

interface MountedEffect {
  deps: readonly unknown[] | undefined;
  cleanup: (() => void) | undefined;
}

/**
 * React's hooks for one component, run by hand. Unlike React it renders again at once when state changes, and it fails the way React
 * does later: an effect that returns anything but nothing or a function throws, because React would call that value as its cleanup.
 */
class HookHost<T> {
  result!: T;
  setsAfterUnmount = 0;
  private slots: unknown[] = [];
  private cursor = 0;
  private effects: { effect: () => unknown; deps: readonly unknown[] | undefined }[] = [];
  private mounted: (MountedEffect | undefined)[] = [];
  private dirty = false;
  private busy = false;
  private unmounted = false;

  constructor(private readonly callback: () => T) {
    this.flush();
  }

  useState(initial: unknown): [unknown, (next: unknown) => void] {
    const slot = this.cursor++;
    if (!(slot in this.slots)) this.slots[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    const set = (next: unknown) => {
      if (this.unmounted) {
        this.setsAfterUnmount++;
        return;
      }
      const value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(this.slots[slot]) : next;
      if (Object.is(value, this.slots[slot])) return;
      this.slots[slot] = value;
      this.dirty = true;
      if (!this.busy) this.flush();
    };
    return [this.slots[slot], set];
  }

  useRef(initial: unknown): { current: unknown } {
    const slot = this.cursor++;
    if (!(slot in this.slots)) this.slots[slot] = { current: initial };
    return this.slots[slot] as { current: unknown };
  }

  useEffect(effect: () => unknown, deps?: readonly unknown[]): void {
    this.effects.push({ effect, deps });
  }

  flush(): void {
    this.busy = true;
    try {
      for (let pass = 0; pass < 20; pass++) {
        this.dirty = false;
        react.host = this;
        this.cursor = 0;
        this.effects = [];
        this.result = this.callback();
        this.commit();
        if (!this.dirty) return;
      }
      throw new Error('the hook renders again and again');
    } finally {
      this.busy = false;
    }
  }

  unmount(): void {
    this.unmounted = true;
    for (const mounted of this.mounted.splice(0)) mounted?.cleanup?.();
  }

  private commit(): void {
    const changed = this.effects.map(({ deps }, i) => {
      const before = this.mounted[i];
      return !before || !deps || !before.deps || deps.length !== before.deps.length || deps.some((dep, j) => !Object.is(dep, before.deps![j]));
    });
    changed.forEach((isChanged, i) => {
      if (isChanged) this.mounted[i]?.cleanup?.();
    });
    changed.forEach((isChanged, i) => {
      if (!isChanged) return;
      const { effect, deps } = this.effects[i]!;
      const cleanup = effect();
      if (cleanup !== undefined && typeof cleanup !== 'function') throw new TypeError(`an effect returned ${typeof cleanup}, which React would call as its cleanup`);
      this.mounted[i] = { deps, cleanup: cleanup as (() => void) | undefined };
    });
  }
}

function renderHook<P, T>(callback: (props: P) => T, initial: P) {
  let props = initial;
  const host = new HookHost(() => callback(props));
  return {
    get result(): T {
      return host.result;
    },
    host,
    rerender(next: P) {
      props = next;
      host.flush();
    },
    unmount: () => host.unmount(),
  };
}

const noop = () => undefined;
const ON = { switch: 'on', marine: null, gate: 'ok' } as const;
const HIDDEN = mainButton('welcome', null);
const ENLIST = mainButton('welcome', ON);
const DRAWING = mainButton('draw', ON);

afterEach(() => {
  react.host = null;
  react.reducedMotion = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the hook harness', () => {
  it('fails an effect that returns something React would call as its cleanup', () => {
    // #then
    expect(() => renderHook(() => useEffect(() => ({ not: 'a function' }) as never), undefined)).toThrow('an effect returned object');
  });
});

describe('useMainButton', () => {
  it('hides the button without sending the blank text Telegram refuses, while LinkMarines on Telegram is off', () => {
    // #given
    const tg = strictTelegram();
    // #when
    renderHook(({ state }) => telegram.useMainButton(tg.app, state, noop), { state: HIDDEN });
    // #then
    expect({ visible: tg.main.visible, blankTexts: tg.sent.filter((p) => p.text !== undefined && p.text.trim() === '') }).toEqual({ visible: false, blankTexts: [] });
  });

  it('shows ENLIST in blue, holds the button inactive while drawing, and hides it again', () => {
    // #given
    const tg = strictTelegram();
    const hook = renderHook(({ state }) => telegram.useMainButton(tg.app, state, noop), { state: ENLIST });
    const shown = { ...tg.main };
    // #when
    hook.rerender({ state: DRAWING });
    const drawing = { ...tg.main };
    hook.rerender({ state: HIDDEN });
    // #then
    expect([shown, drawing, tg.main.visible]).toEqual([
      { text: 'ENLIST', visible: true, active: true, color: '#2f62df', textColor: '#ffffff' },
      { text: 'DRAWING…', visible: true, active: false, color: '#2f62df', textColor: '#ffffff' },
      false,
    ]);
  });

  it('shows the button again after it was hidden, with its text', () => {
    // #given
    const tg = strictTelegram();
    const hook = renderHook(({ state }) => telegram.useMainButton(tg.app, state, noop), { state: HIDDEN });
    // #when
    hook.rerender({ state: ENLIST });
    // #then
    expect([tg.main.visible, tg.main.text]).toEqual([true, 'ENLIST']);
  });

  it('calls the newest click handler, and takes off the very function it put on', () => {
    // #given
    const tg = strictTelegram();
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ onClick }) => telegram.useMainButton(tg.app, ENLIST, onClick), { onClick: first });
    // #when
    hook.rerender({ onClick: second });
    tg.clickMain();
    const whileMounted = tg.mainClickCount();
    hook.unmount();
    // #then
    expect({ calls: [first.mock.calls.length, second.mock.calls.length], whileMounted, afterUnmount: tg.mainClickCount(), added: tg.mainOn.length, sameFunction: tg.mainOff[0] === tg.mainOn[0] }).toEqual({
      calls: [0, 1],
      whileMounted: 1,
      afterUnmount: 0,
      added: 1,
      sameFunction: true,
    });
  });
});

describe('useBackButton', () => {
  it('shows and hides with the depth, leaving React no cleanup from that effect', () => {
    // #given
    const tg = strictTelegram();
    const hook = renderHook(({ visible }) => telegram.useBackButton(tg.app, visible, noop), { visible: false });
    const seen = [tg.back.visible];
    // #when
    hook.rerender({ visible: true });
    seen.push(tg.back.visible);
    hook.rerender({ visible: false });
    seen.push(tg.back.visible);
    // #then
    expect(seen).toEqual([false, true, false]);
  });

  it('calls the newest handler, and takes off the very function it put on', () => {
    // #given
    const tg = strictTelegram();
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ onBack }) => telegram.useBackButton(tg.app, true, onBack), { onBack: first });
    // #when
    hook.rerender({ onBack: second });
    tg.clickBack();
    hook.unmount();
    // #then
    expect({ calls: [first.mock.calls.length, second.mock.calls.length], afterUnmount: tg.backClickCount(), sameFunction: tg.backOff[0] === tg.backOn[0] }).toEqual({ calls: [0, 1], afterUnmount: 0, sameFunction: true });
  });
});

describe('useLaunch', () => {
  it('readies and expands the app and paints its chrome where Telegram takes the colours', () => {
    // #given
    const tg = strictTelegram('8.0');
    // #when
    renderHook(() => telegram.useLaunch(tg.app), undefined);
    // #then
    expect(tg.colors).toEqual({ header: '#0a0f1e', background: '#0a0f1e', bottomBar: '#0a0f1e' });
  });

  it('leaves out a colour the client’s version would throw on, instead of blanking the app', () => {
    // #given
    const tg = strictTelegram('6.4');
    // #when
    renderHook(() => telegram.useLaunch(tg.app), undefined);
    // #then
    expect(tg.colors).toEqual({ header: '', background: '#0a0f1e', bottomBar: '' });
  });
});

describe('useOwnCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  const own = (card: () => Promise<Blob | null>, serial: number | null = 7) => renderHook(({ serial }) => telegram.useOwnCard(card, serial), { serial });

  it('polls a card that is never ready exactly CARD_POLLS times, then settles for the public card with no timer left', async () => {
    // #given
    const card = vi.fn(async () => null);
    // #when
    const hook = own(card);
    await vi.advanceTimersByTimeAsync(telegram.CARD_POLL_MS * telegram.CARD_POLLS * 2);
    // #then
    expect({ calls: card.mock.calls.length, found: hook.result, timers: vi.getTimerCount() }).toEqual({ calls: telegram.CARD_POLLS, found: { url: webCardUrl(7), own: false }, timers: 0 });
  });

  it('shows your own card the moment poll N delivers it, and stops polling', async () => {
    // #given
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:own');
    const card = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(new Blob(['png']));
    // #when
    const hook = own(card);
    await vi.advanceTimersByTimeAsync(telegram.CARD_POLL_MS * telegram.CARD_POLLS * 2);
    // #then
    expect({ calls: card.mock.calls.length, found: hook.result, timers: vi.getTimerCount() }).toEqual({ calls: 3, found: { url: 'blob:own', own: true }, timers: 0 });
  });

  it('falls back to the public card at once when the card is refused, with one warning', async () => {
    // #given
    const card = vi.fn().mockRejectedValue(new Error('card: HTTP 409'));
    // #when
    const hook = own(card);
    await vi.advanceTimersByTimeAsync(telegram.CARD_POLL_MS * telegram.CARD_POLLS * 2);
    // #then
    expect({ calls: card.mock.calls.length, found: hook.result, warnings: vi.mocked(console.warn).mock.calls, timers: vi.getTimerCount() }).toEqual({
      calls: 1,
      found: { url: webCardUrl(7), own: false },
      warnings: [['card: HTTP 409']],
      timers: 0,
    });
  });

  it('revokes your card’s object URL when you leave', async () => {
    // #given
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:own');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const hook = own(async () => new Blob(['png']));
    await vi.advanceTimersByTimeAsync(0);
    // #when
    hook.unmount();
    // #then
    expect(revoke.mock.calls).toEqual([['blob:own']]);
  });

  it('sets nothing and makes no object URL when the card lands after cleanup', async () => {
    // #given
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late');
    let land: (blob: Blob) => void = noop;
    const hook = own(() => new Promise<Blob>((resolve) => (land = resolve)));
    // #when
    hook.unmount();
    land(new Blob(['png']));
    await vi.advanceTimersByTimeAsync(telegram.CARD_POLL_MS * telegram.CARD_POLLS);
    // #then
    expect({ created: create.mock.calls.length, setsAfterCleanup: hook.host.setsAfterUnmount }).toEqual({ created: 0, setsAfterCleanup: 0 });
  });

  it('stops polling when you leave between two polls', async () => {
    // #given
    const card = vi.fn(async () => null);
    const hook = own(card);
    await vi.advanceTimersByTimeAsync(telegram.CARD_POLL_MS);
    const before = card.mock.calls.length;
    // #when
    hook.unmount();
    await vi.advanceTimersByTimeAsync(telegram.CARD_POLL_MS * telegram.CARD_POLLS);
    // #then
    expect({ extraCalls: card.mock.calls.length - before, timers: vi.getTimerCount() }).toEqual({ extraCalls: 0, timers: 0 });
  });

  it('gives null again once there is no Marine to show a card for, and revokes the old card', async () => {
    // #given
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:own');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const hook = own(async () => new Blob(['png']));
    await vi.advanceTimersByTimeAsync(0);
    const before = hook.result;
    // #when
    hook.rerender({ serial: null });
    // #then
    expect({ before, after: hook.result, revoked: revoke.mock.calls }).toEqual({ before: { url: 'blob:own', own: true }, after: null, revoked: [['blob:own']] });
  });
});

describe('useTilt', () => {
  it('stays still under reduced motion, and never starts the sensor', () => {
    // #given
    const tg = strictTelegram();
    react.reducedMotion = true;
    // #when
    const hook = renderHook(() => telegram.useTilt(tg.app, true), undefined);
    tg.sense(10, 10);
    // #then
    expect({ tilt: hook.result, started: tg.orientation.started, listeners: tg.listeners('deviceOrientationChanged') }).toEqual({ tilt: null, started: 0, listeners: 0 });
  });

  it('skips a sample the sensor has not read yet, rests where the phone was first held, and stops the sensor when it ends', () => {
    // #given
    const tg = strictTelegram();
    const hook = renderHook(() => telegram.useTilt(tg.app, true), undefined);
    // #when
    tg.sense(null, null);
    const unread = hook.result;
    tg.sense(40, 5);
    const atRest = hook.result;
    tg.sense(34, 11);
    const tilted = hook.result;
    hook.unmount();
    // #then
    expect({ unread, atRest, tilted, started: tg.orientation.started, stopped: tg.orientation.stopped, listeners: tg.listeners('deviceOrientationChanged') }).toEqual({
      unread: null,
      atRest: { x: 0, y: 0, streak: 50 },
      tilted: { x: 2, y: 2, streak: 63 },
      started: 1,
      stopped: 1,
      listeners: 0,
    });
  });

  it('listens to the browser’s own sensor before Bot API 8.0, and lets go of it when it ends', () => {
    // #given
    const tg = strictTelegram('7.0');
    const listeners = new Map<string, (e: { beta: number | null; gamma: number | null }) => void>();
    vi.stubGlobal('window', {
      DeviceOrientationEvent: class {},
      addEventListener: (type: string, fn: (e: { beta: number | null; gamma: number | null }) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    const hook = renderHook(() => telegram.useTilt(tg.app, true), undefined);
    // #when
    listeners.get('deviceorientation')?.({ beta: 10, gamma: 10 });
    const atRest = hook.result;
    hook.unmount();
    // #then
    expect({ atRest, listening: listeners.size, started: tg.orientation.started }).toEqual({ atRest: { x: 0, y: 0, streak: 50 }, listening: 0, started: 0 });
  });
});

describe('a sheet', () => {
  it('closes on Escape, and stops listening when it goes', () => {
    // #given
    const keys: ((e: { key: string }) => void)[] = [];
    vi.stubGlobal('document', {
      addEventListener: (_type: string, fn: (e: { key: string }) => void) => keys.push(fn),
      removeEventListener: (_type: string, fn: (e: { key: string }) => void) => keys.splice(keys.indexOf(fn), 1),
    });
    const onClose = vi.fn();
    const hook = renderHook(() => sheets.Sheet({ className: 'tg-sheet', label: 'A sheet', onClose, children: null }), undefined);
    // #when
    keys.forEach((fn) => fn({ key: 'a' }));
    keys.forEach((fn) => fn({ key: 'Escape' }));
    hook.unmount();
    // #then
    expect({ closed: onClose.mock.calls.length, listening: keys.length }).toEqual({ closed: 1, listening: 0 });
  });
});
