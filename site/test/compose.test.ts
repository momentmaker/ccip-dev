import { describe, expect, it, vi } from 'vitest';
import { ReplayCompositor, drawCoins, drawOverlay, overlayText } from '../src/replay/compose';
import type { ReplayFrameState, ReplayModel } from '../src/replay/timeline';

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
  sky: { stars: [], lanes: [], comets: [], rings: [] },
});

describe('overlayText', () => {
  it('describes the frame', () => {
    expect(overlayText(state(false), '2023-07-06', '2026-10-06')).toEqual({
      date: 'Jul 7, 2023',
      totals: '1,565,729 messages · $25.3B moved',
      chains: '95 chains',
      captions: ['Base joins'],
      watermark: 'ccip.dev · 2023-07-06 → 2026-10-06',
      endCard: null,
    });
  });

  it('says "1 chain" for a single chain', () => {
    expect(overlayText({ ...state(false), activeChains: 1 }, '2023-07-06', '2026-10-06').chains).toBe('1 chain');
  });

  it('adds the end card after the last day', () => {
    expect(overlayText(state(true), '2023-07-06', '2026-10-06').endCard).toEqual({
      title: 'ccip.dev',
      lines: ['1,565,729 CCIP messages', '$25.3B moved across 95 chains', 'Live CCIP stats at ccip.dev'],
    });
  });
});

describe('drawOverlay', () => {
  it('writes the date, totals, captions and watermark, plus the end card when present', () => {
    const texts: string[] = [];
    const ctx = {
      save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(),
      fillText: (t: string) => texts.push(t),
      set font(_v: string) {}, set fillStyle(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    drawOverlay(ctx, overlayText(state(true), '2023-07-06', '2026-10-06'), 1920, 1080);
    expect(texts).toEqual([
      'Jul 7, 2023',
      '1,565,729 messages · $25.3B moved',
      '95 chains',
      'Base joins',
      'ccip.dev · 2023-07-06 → 2026-10-06',
      'ccip.dev',
      '1,565,729 CCIP messages',
      '$25.3B moved across 95 chains',
      'Live CCIP stats at ccip.dev',
    ]);
  });
});

describe('ReplayCompositor', () => {
  it('stops drawing once destroyed', () => {
    const frame = state(false);
    const model = { frameAt: () => frame } as unknown as ReplayModel;
    const gradient = { addColorStop: vi.fn() };
    const target = {
      fillRect: vi.fn(), drawImage: vi.fn(), createRadialGradient: () => gradient,
      save: vi.fn(), restore: vi.fn(), fillText: vi.fn(),
      set font(_v: string) {}, set fillStyle(_v: unknown) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    const compositor = new ReplayCompositor(model, [], '2023-07-06', '2026-10-06', () => ({ width: 10, height: 10 }) as never);
    compositor.draw(1, target, 10, 10);
    expect(renderer.draw).toHaveBeenCalledTimes(1);
    compositor.destroy();
    expect(compositor.draw(1, target, 10, 10)).toBe(frame);
    expect(renderer.draw).toHaveBeenCalledTimes(1);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('retries on a fresh canvas without WebGL when the first renderer throws', () => {
    createRenderer.mockReset();
    createRenderer.mockImplementationOnce(() => {
      throw new Error('webgl unavailable');
    });
    createRenderer.mockImplementationOnce(() => renderer);
    const createCanvas = vi.fn(() => ({ width: 10, height: 10 }) as never);
    const model = { frameAt: () => state(false) } as unknown as ReplayModel;
    expect(() => new ReplayCompositor(model, [], '2023-07-06', '2026-10-06', createCanvas)).not.toThrow();
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(createRenderer).toHaveBeenLastCalledWith(expect.anything(), { preferGl: false });
    createRenderer.mockImplementation(() => renderer);
  });
});

const coinTarget = (drawn: unknown[][], alphas: number[]) =>
  ({
    fillRect: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }),
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
    const frame: ReplayFrameState = {
      ...state(false),
      coins: [{ star: 0, selector: 'a', alpha: 1 }],
      sky: { stars: [{ x: 0, y: 0, radius: 10, brightness: 1, flash: 0 }], lanes: [], comets: [], rings: [] },
    };
    const model = { frameAt: () => frame } as unknown as ReplayModel;
    const drawn: unknown[][] = [];
    const target = coinTarget(drawn, []);
    const compositor = new ReplayCompositor(model, [{ selector: 'a', x: 0, y: 0 }], '2023-07-06', '2026-10-06', () => ({ width: 800, height: 800 }) as never);
    compositor.draw(1, target, 800, 800);
    expect(drawn).toHaveLength(1);
    const image = { tag: 'coin' } as unknown as CanvasImageSource;
    compositor.setCoinImages(new Map([['a', image]]));
    compositor.draw(1, target, 800, 800);
    expect(drawn.find((args) => args[0] === image)).toEqual([image, 388, 388, 24, 24]);
  });
});
