import type { LiveMessage, ReplayFile } from '@ccip-dev/core/public';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkyCanvas from '../src/components/home/SkyCanvas';
import { useStatus } from '../src/components/use-status';
import type { Planned } from '../src/lib/live-scheduler';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';
import status from './fixtures/status.json';

const runtime = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
  stateWrites: [] as unknown[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = runtime.cursor++;
      if (!(slot in runtime.slots)) runtime.slots[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [
        runtime.slots[slot],
        (next: unknown) => {
          runtime.stateWrites.push(next);
          runtime.slots[slot] = typeof next === 'function' ? (next as (v: unknown) => unknown)(runtime.slots[slot]) : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const slot = runtime.cursor++;
      if (!(slot in runtime.slots)) runtime.slots[slot] = { current: initial };
      return runtime.slots[slot];
    },
    useEffect: (effect: () => void | (() => void)) => {
      runtime.effects.push(effect);
    },
  };
});

vi.mock('../src/lib/analytics', () => ({ trackDataError: vi.fn() }));

const renderOnce = <T>(component: () => T): T => {
  runtime.cursor = 0;
  runtime.effects = [];
  return component();
};
const mount = () => {
  for (const effect of runtime.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') runtime.cleanups.push(cleanup);
  }
};
const unmount = () => {
  for (const cleanup of runtime.cleanups.splice(0)) cleanup();
};

function fakeDocument() {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    hidden: false,
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  };
  return {
    doc,
    count: (type: string) => listeners.get(type)?.size ?? 0,
    show: (visible: boolean) => {
      doc.hidden = !visible;
      doc.visibilityState = visible ? 'visible' : 'hidden';
      for (const fn of [...(listeners.get('visibilitychange') ?? [])]) fn();
    },
  };
}

const okResponse = { ok: true, status: 200, json: async () => status };
const failResponse = { ok: false, status: 500, json: async () => ({}) };

beforeEach(() => {
  runtime.slots = [];
  runtime.stateWrites = [];
  runtime.cleanups = [];
  vi.useFakeTimers();
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useStatus effect', () => {
  it('reports a failed poll, and a remount fetches again and recovers', async () => {
    const page = fakeDocument();
    vi.stubGlobal('document', page.doc);
    const fetchMock = vi.fn().mockResolvedValueOnce(failResponse).mockResolvedValue(okResponse);
    vi.stubGlobal('fetch', fetchMock);

    renderOnce(useStatus);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runtime.stateWrites).toEqual([1]);
    unmount();

    runtime.slots = [];
    runtime.stateWrites = [];
    renderOnce(useStatus);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runtime.stateWrites).toEqual([status, 0]);
  });

  it('leaves no timer and no listener behind when it unmounts', async () => {
    const page = fakeDocument();
    vi.stubGlobal('document', page.doc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse));

    renderOnce(useStatus);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    expect(page.count('visibilitychange')).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(page.count('visibilitychange')).toBe(0);
  });

  it('does not touch state when a poll that was in flight lands after unmount', async () => {
    vi.stubGlobal('document', fakeDocument().doc);
    let finish: (value: typeof okResponse) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve as typeof finish; })));

    renderOnce(useStatus);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    finish(okResponse);
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.stateWrites).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('SkyCanvas stale comet wiring', () => {
  const NOW = 100_000;
  const stars = buildLayout((replayJson as ReplayFile).chains);
  const planned = (id: string, at: number): Planned<LiveMessage> => ({ at, message: { id, send_ts: '2026-10-08T12:00:00.000Z', src: stars[0]!.selector, dst: stars[1]!.selector, usd: 1, token: null } as unknown as LiveMessage });
  let queue: Planned<LiveMessage>[];
  let page: ReturnType<typeof fakeDocument>;
  let intersect: (entries: { isIntersecting: boolean }[]) => void;
  let observers: { disconnect: ReturnType<typeof vi.fn> };
  let renderer: { resize: ReturnType<typeof vi.fn>; draw: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  let frames: ReturnType<typeof vi.fn>;
  let cancelled: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    page = fakeDocument();
    vi.stubGlobal('document', page.doc);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    frames = vi.fn(() => 7);
    cancelled = vi.fn();
    vi.stubGlobal('requestAnimationFrame', frames);
    vi.stubGlobal('cancelAnimationFrame', cancelled);
    observers = { disconnect: vi.fn() };
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = observers.disconnect; });
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: typeof intersect) { intersect = cb; }
      observe() {}
      disconnect = observers.disconnect;
    });
    vi.spyOn(performance, 'now').mockReturnValue(NOW);
    renderer = { resize: vi.fn(), draw: vi.fn(), destroy: vi.fn() };
    const rendererModule = await import('../src/sky/renderer');
    vi.spyOn(rendererModule, 'createRenderer').mockReturnValue(renderer as never);

    queue = [planned('stale', NOW - 5_000), planned('barely-late', NOW - 2_000), planned('late', NOW - 2_001), planned('soon', NOW + 3_000)];
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const wrap = { querySelector: () => canvas, clientWidth: 800, clientHeight: 600, parentElement: null };
    renderOnce(() => SkyCanvas({
      stars, chainValues: [], lanes: [], names: {}, queue: { current: queue }, reducedMotion: false, onLaunch: vi.fn(), onReady: vi.fn(),
    } as never));
    // Hook slots follow call order, so slot 0 is SkyCanvas's first useRef (the wrap ref); a hook added before it moves this.
    (runtime.slots[0] as { current: unknown }).current = wrap;
    mount();
  });

  const ids = () => queue.map((p) => p.message.id);

  it('keeps every queued comet while the tab stays hidden', () => {
    page.show(false);
    expect(ids()).toEqual(['stale', 'barely-late', 'late', 'soon']);
  });

  it('drops comets more than 2 s late when the tab becomes visible again, keeping the rest in order', () => {
    page.show(false);
    page.show(true);
    expect(ids()).toEqual(['barely-late', 'soon']);
  });

  it('drops the same comets when the sky scrolls back into view, and none while it stays off screen', () => {
    intersect([{ isIntersecting: false }]);
    expect(ids()).toEqual(['stale', 'barely-late', 'late', 'soon']);
    intersect([{ isIntersecting: true }]);
    expect(ids()).toEqual(['barely-late', 'soon']);
  });

  it('stops listening, cancels its frame and destroys the renderer on unmount', () => {
    expect(page.count('visibilitychange')).toBe(1);
    unmount();
    expect(page.count('visibilitychange')).toBe(0);
    expect(cancelled).toHaveBeenCalledWith(7);
    expect(observers.disconnect).toHaveBeenCalledTimes(2);
    expect(renderer.destroy).toHaveBeenCalledOnce();
    page.show(false);
    page.show(true);
    expect(ids()).toEqual(['stale', 'barely-late', 'late', 'soon']);
  });
});
