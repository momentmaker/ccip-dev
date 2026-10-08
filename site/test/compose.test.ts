import { describe, expect, it, vi } from 'vitest';
import { ReplayCompositor, drawCoins } from '../src/replay/compose';
import type { ReplayFrameState } from '../src/replay/timeline';

const { renderer, createRenderer } = vi.hoisted(() => {
  const renderer = { draw: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
  return { renderer, createRenderer: vi.fn(() => renderer) };
});
vi.mock('../src/sky/renderer', () => ({ createRenderer }));

const state = (endCard: boolean): ReplayFrameState => ({
  t: 10,
  dayIndex: 1,
  day: '2023-07-07',
  endCard,
  cumulativeMessages: 1_565_729,
  cumulativeUsd: 25_300_000_000,
  activeChains: 95,
  captions: ['Base joins'],
  extent: 1,
  coins: [],
  arrivals: [],
  sky: { stars: [], lanes: [], comets: [], rings: [] },
});

const showFrame = (base = state(false)) => ({
  t: 10, phase: 'story' as const, base, camera: { cx: 0, cy: 0, extent: 1, rotation: 0 },
  card: null, slam: null, story: { usd: 0, messages: 0, chains: 0, day: '2023-07-07', timeline: 0.3 },
  board: [], hook: null, finale: 0, loop: 0, punch: 0, focus: null, focusStar: -1,
});
const showStub = (frame: ReturnType<typeof showFrame>) =>
  ({ frameAt: () => frame, timing: { hook: 2, finale: 3 }, length: 30, warp: { start: 2, end: 27 } }) as never;
const assets = { names: new Map<string, string>(), ticks: [] };
const storyMethods = {
  beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), translate: vi.fn(), scale: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
  measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop() {} }),
};

describe('ReplayCompositor', () => {
  it('stops drawing once destroyed', () => {
    const frame = showFrame();
    const gradient = { addColorStop: vi.fn() };
    const target = {
      ...storyMethods, fillRect: vi.fn(), drawImage: vi.fn(), createRadialGradient: () => gradient,
      save: vi.fn(), restore: vi.fn(), fillText: vi.fn(),
      set font(_v: string) {}, set fillStyle(_v: unknown) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    const compositor = new ReplayCompositor(showStub(frame), [], assets, () => ({ width: 10, height: 10 }) as never);
    compositor.draw(1, target, 10, 10);
    expect(renderer.draw).toHaveBeenCalledTimes(1);
    compositor.destroy();
    expect(compositor.draw(1, target, 10, 10)).toBe(frame);
    expect(renderer.draw).toHaveBeenCalledTimes(1);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, true],
    [{ chrome: false }, false],
  ])('draws the watermark only when chrome is on (%j)', (options, expected) => {
    const texts: string[] = [];
    const target = {
      ...storyMethods, fillRect: vi.fn(), drawImage: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }),
      save: vi.fn(), restore: vi.fn(), fillText: (s: string) => texts.push(s),
      set font(_v: string) {}, set fillStyle(_v: unknown) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    const compositor = new ReplayCompositor(showStub(showFrame()), [], assets, () => ({ width: 10, height: 10 }) as never, options);
    compositor.draw(10, target, 100, 100);
    expect(texts.includes('ccip.dev · @ccipdev')).toBe(expected);
  });

  it('retries on a fresh canvas without WebGL when the first renderer throws', () => {
    createRenderer.mockReset();
    createRenderer.mockImplementationOnce(() => {
      throw new Error('webgl unavailable');
    });
    createRenderer.mockImplementationOnce(() => renderer);
    const createCanvas = vi.fn(() => ({ width: 10, height: 10 }) as never);
    expect(() => new ReplayCompositor(showStub(showFrame()), [], assets, createCanvas)).not.toThrow();
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(createRenderer).toHaveBeenLastCalledWith(expect.anything(), { preferGl: false });
    createRenderer.mockImplementation(() => renderer);
  });

  it('starts on the 2D sky when asked, so it never depends on a GPU context', () => {
    createRenderer.mockClear();
    new ReplayCompositor(showStub(showFrame()), [], assets, () => ({ width: 10, height: 10 }) as never, { preferGl: false });
    expect(createRenderer).toHaveBeenCalledTimes(1);
    expect(createRenderer).toHaveBeenCalledWith(expect.anything(), { preferGl: false });
  });
});

const coinTarget = (drawn: unknown[][], alphas: number[]) =>
  ({
    ...storyMethods, fillRect: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }),
    save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(),
    drawImage: (...args: unknown[]) => drawn.push(args),
    set globalAlpha(v: number) { alphas.push(v); },
    set font(_v: string) {}, set fillStyle(_v: unknown) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
  }) as unknown as CanvasRenderingContext2D;

describe('drawCoins', () => {
  it('draws each coin centered at its alpha with a ring', () => {
    const drawn: unknown[][] = [];
    const alphas: number[] = [];
    const image = { tag: 'coin' } as unknown as CanvasImageSource;
    drawCoins(coinTarget(drawn, alphas), [{ x: 100, y: 50, d: 20, alpha: 0.5, image }]);
    expect(drawn).toEqual([[image, 90, 40, 20, 20]]);
    expect(alphas).toEqual([0.5]);
  });
});

describe('ReplayCompositor coins', () => {
  it('draws a coin over its star once its image is set', () => {
    const frame = showFrame({
      ...state(false),
      coins: [{ star: 0, selector: 'a', alpha: 1 }],
      sky: { stars: [{ x: 0, y: 0, radius: 10, brightness: 1, flash: 0 }], lanes: [], comets: [], rings: [] },
    });
    const drawn: unknown[][] = [];
    const target = coinTarget(drawn, []);
    const compositor = new ReplayCompositor(showStub(frame), [{ selector: 'a', x: 0, y: 0 }], assets, () => ({ width: 800, height: 800 }) as never);
    compositor.draw(1, target, 800, 800);
    expect(drawn).toHaveLength(1);
    const image = { tag: 'coin' } as unknown as CanvasImageSource;
    compositor.setCoinImages(new Map([['a', image]]));
    compositor.draw(1, target, 800, 800);
    expect(drawn.find((args) => args[0] === image)).toEqual([image, 388, 388, 24, 24]);
  });
});

describe('ReplayCompositor loop crossfade', () => {
  const setup = () => {
    const open = showFrame();
    const closing = { ...showFrame(), loop: 0.5 };
    const stub = { frameAt: (t: number) => (t > 0 ? closing : open), timing: { hook: 2, finale: 3 }, length: 30, warp: { start: 2, end: 27 } } as never;
    let alpha = 1;
    const overlays: { image: unknown; alpha: number }[] = [];
    const target = {
      ...storyMethods, fillRect: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }),
      save: vi.fn(), restore: vi.fn(), fillText: vi.fn(),
      drawImage: (image: unknown) => overlays.push({ image, alpha }),
      get globalAlpha() { return alpha; }, set globalAlpha(v: number) { alpha = v; },
      set font(_v: string) {}, set fillStyle(_v: unknown) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
      set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
    } as unknown as CanvasRenderingContext2D;
    const canvases: { width: number; height: number; getContext: () => unknown }[] = [];
    const createCanvas = vi.fn(() => {
      const canvas = { width: 10, height: 10, getContext: () => target };
      canvases.push(canvas);
      return canvas as never;
    });
    return { compositor: new ReplayCompositor(stub, [], assets, createCanvas), target, overlays, canvases, createCanvas };
  };

  it('lays the cached opening frame over the closing frame at the loop alpha', () => {
    const { compositor, target, overlays, canvases } = setup();
    compositor.draw(29.8, target, 10, 10);
    const overlay = overlays.find((o) => o.image !== canvases[0] && o.alpha === 0.5);
    expect(overlay?.image).toBe(canvases[1]);
  });

  it('rebuilds the cached opening frame after coin images load', () => {
    const { compositor, target, createCanvas } = setup();
    compositor.draw(29.8, target, 10, 10);
    const before = createCanvas.mock.calls.length;
    compositor.draw(29.9, target, 10, 10);
    expect(createCanvas).toHaveBeenCalledTimes(before);
    compositor.setCoinImages(new Map([['a', { tag: 'coin' } as unknown as CanvasImageSource]]));
    compositor.draw(29.9, target, 10, 10);
    expect(createCanvas).toHaveBeenCalledTimes(before + 1);
  });
});

describe('ReplayCompositor loop cache without a 2D context', () => {
  it('warns once when it cannot build the loop crossfade', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const closing = { ...showFrame(), loop: 0.5 };
    const stub = { frameAt: () => closing, timing: { hook: 2, finale: 3 }, length: 30, warp: { start: 2, end: 27 } } as never;
    const target = {
      ...storyMethods, fillRect: vi.fn(), drawImage: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }),
      save: vi.fn(), restore: vi.fn(), fillText: vi.fn(),
      set globalAlpha(_v: number) {}, set font(_v: string) {}, set fillStyle(_v: unknown) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
      set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
    } as unknown as CanvasRenderingContext2D;
    const compositor = new ReplayCompositor(stub, [], assets, () => ({ width: 10, height: 10, getContext: () => null }) as never);
    compositor.draw(29.8, target, 10, 10);
    compositor.draw(29.9, target, 10, 10);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('loop'))).toHaveLength(1);
    warn.mockRestore();
  });
});
