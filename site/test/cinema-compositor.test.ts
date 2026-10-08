import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it, vi } from 'vitest';
import { CinemaCompositor } from '../src/replay/cinema/compositor';
import { Show } from '../src/replay/director/show';
import { endTitleFont } from '../src/replay/story/draw';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const show = new Show({ replay, history, stars, length: 30, focus: null, eligible: () => true });
const assets = { names: new Map<string, string>(), ticks: [] };

function fake2d(calls: unknown[][], texts: string[] = []) {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'drawImage') return (...args: unknown[]) => calls.push(args);
        if (key === 'fillText') return (text: string) => texts.push(text);
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'measureText') return () => ({ width: 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set: () => true,
    },
  );
}
const createCanvas = (calls: unknown[][] = []) => () => ({ width: 1, height: 1, getContext: (kind: string) => (kind === '2d' ? fake2d(calls) : null) }) as never;
const fakeRenderer = (lost = false) => ({ render: vi.fn(), resize: vi.fn(), setAtlas: vi.fn(), destroy: vi.fn(), lost });

function inkCanvas(fonts: string[]) {
  return () => {
    const canvas = {
      width: 1,
      height: 1,
      getContext: (kind: string) =>
        kind === '2d'
          ? new Proxy(
              {},
              {
                get: (_t, key) => {
                  if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
                  if (key === 'measureText') return () => ({ width: 600 });
                  return () => {};
                },
                set: (_t, key, value) => {
                  if (key === 'font') fonts.push(value as string);
                  return true;
                },
              },
            )
          : null,
    };
    return canvas as never;
  };
}

describe('CinemaCompositor', () => {
  it('renders the GL scene, then draws it and the story layer onto the target', () => {
    const renderer = fakeRenderer();
    const calls: unknown[][] = [];
    const c = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => renderer as never });
    const frame = c.draw(15, fake2d(calls) as never, 640, 360);
    expect(frame.t).toBe(15);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('steps quality down on slow frames when auto, and stays High when recording', () => {
    const auto = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => fakeRenderer() as never });
    for (let t = 0; t < 2.1; t += 1 / 60) auto.noteFrame(25, t);
    expect(auto.tier).toBe('medium');
    const rec = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'high', reducedMotion: false, createRenderer: () => fakeRenderer() as never });
    for (let t = 0; t < 6; t += 1 / 60) rec.noteFrame(80, t);
    expect(rec.tier).toBe('high');
  });

  it('starts from the tier it is given and never steps back up', () => {
    const renderer = fakeRenderer();
    const c = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, startTier: 'medium', createRenderer: () => renderer as never });
    expect(c.tier).toBe('medium');
    for (let t = 0; t < 2.1; t += 1 / 60) c.noteFrame(10, t);
    c.draw(15, fake2d([]) as never, 640, 360);
    expect(c.tier).toBe('medium');
    expect(renderer.render.mock.calls[0]![0].bloom).toBe('half');
  });

  it('packs coin images into one atlas and uploads it', () => {
    const renderer = fakeRenderer();
    const calls: unknown[][] = [];
    const c = new CinemaCompositor(show, stars, assets, createCanvas(calls), { quality: 'auto', reducedMotion: false, createRenderer: () => renderer as never });
    c.setCoinImages(new Map([['a', {} as CanvasImageSource], ['b', {} as CanvasImageSource]]));
    expect(renderer.setAtlas).toHaveBeenCalledTimes(1);
    expect(calls.filter((args) => args.length === 5)).toHaveLength(2);
  });

  it('reports a lost context and throws when no renderer can be made', () => {
    const c = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => fakeRenderer(true) as never });
    expect(c.lost).toBe(true);
    expect(() => new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => null })).toThrow();
  });

  it.each([
    [undefined, true],
    [false, false],
  ])('draws the watermark only when chrome is on (%s)', (chrome, expected) => {
    const texts: string[] = [];
    const c = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, chrome, createRenderer: () => fakeRenderer() as never });
    c.draw(15, fake2d([], texts) as never, 640, 360);
    expect(texts.some((t) => t.includes('messages'))).toBe(true);
    expect(texts.includes('ccip.dev · @ccipdev')).toBe(expected);
  });

  it('samples the title particles only once asked, in the end title font', () => {
    const renderer = fakeRenderer();
    const fonts: string[] = [];
    const c = new CinemaCompositor(show, stars, assets, inkCanvas(fonts), { quality: 'auto', reducedMotion: false, createRenderer: () => renderer as never });
    c.draw(28.8, fake2d([]) as never, 1920, 1080);
    expect(fonts).toEqual([]);
    c.refreshTitle();
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((f) => f === endTitleFont(Number(/([\d.]+)px/.exec(f)![1])))).toBe(true);
    c.draw(28.8, fake2d([]) as never, 1920, 1080);
    const [before, after] = renderer.render.mock.calls.map(([scene]) => scene.quads.length);
    expect(after).toBeGreaterThan(before);
  });

  it('releases its WebGL2 probe context after checking support', () => {
    const loseContext = vi.fn();
    const probe = () => ({ getContext: (kind: string) => (kind === 'webgl2' ? { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null) } : null) }) as never;
    expect(CinemaCompositor.isSupported(probe)).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(CinemaCompositor.isSupported(createCanvas())).toBe(false);
  });

  it('rebuilds the cached opening frame after coin images load', () => {
    const make = vi.fn(createCanvas());
    const c = new CinemaCompositor(show, stars, assets, make, { quality: 'auto', reducedMotion: false, createRenderer: () => fakeRenderer() as never });
    const target = fake2d([]) as never;
    c.draw(29.8, target, 64, 36);
    const built = make.mock.calls.length;
    c.draw(29.9, target, 64, 36);
    expect(make).toHaveBeenCalledTimes(built);
    c.setCoinImages(new Map());
    c.draw(29.9, target, 64, 36);
    expect(make).toHaveBeenCalledTimes(built + 1);
  });

  it('warns once when it cannot build the loop crossfade', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noContext = () => ({ width: 1, height: 1, getContext: () => null }) as never;
    const c = new CinemaCompositor(show, stars, assets, noContext, { quality: 'auto', reducedMotion: false, createRenderer: () => fakeRenderer() as never });
    c.draw(29.8, fake2d([]) as never, 64, 36);
    c.draw(29.9, fake2d([]) as never, 64, 36);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('loop'))).toHaveLength(1);
    warn.mockRestore();
  });
});
