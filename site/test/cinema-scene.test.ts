import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/replay/cinema/quality';
import {
  buildScene,
  titleAssembly,
  titleParticleFade,
  CINEMA_SHAPE,
  COIN_FLOATS,
  dustField,
  LINE_FLOATS,
  MAX_SCENE_COINS,
  MAX_SCENE_LANES,
  MAX_SCENE_QUADS,
  QUAD_FLOATS,
  type SceneContext,
} from '../src/replay/cinema/scene';
import { Show, type ShowFrame } from '../src/replay/director/show';
import { END_TITLE_PX, storyUnit } from '../src/replay/story/layout';
import { endTitleAlpha } from '../src/replay/story/draw';
import { LOOP_S } from '../src/replay/director/show';
import { COLORS } from '../src/sky/frame';
import { LANE_SEGMENTS } from '../src/sky/instances';
import { buildLayout } from '../src/sky/layout';
import { coinDiameter } from '../src/sky/coins';
import { REPLAY_COIN_UNIT } from '../src/replay/compose';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const show = new Show({ replay, history, stars, length: 30, focus: null, eligible: () => true });
const atlas = new Map(replay.chains.map((c, i) => [c.selector, [i * 0.1, 0, i * 0.1 + 0.1, 1] as const]));
const targets = [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }];
const ctx = (over: Partial<SceneContext> = {}): SceneContext => ({
  width: 1280,
  height: 720,
  tier: TIERS.high,
  dust: dustField(11, 1),
  fullExtent: show.fullExtent,
  atlas,
  titleTargets: targets,
  reducedMotion: false,
  seed: 5,
  finaleSeconds: 3,
  ...over,
});
const quadCount = (s: { quads: Float32Array }) => s.quads.length / QUAD_FLOATS;
const withSky = (frame: ShowFrame, sky: Partial<ShowFrame['base']['sky']>, base: Partial<ShowFrame['base']> = {}): ShowFrame => ({
  ...frame,
  base: { ...frame.base, ...base, sky: { ...frame.base.sky, ...sky } },
});

describe('buildScene', () => {
  it('is deterministic for the same frame and context', () => {
    expect(buildScene(show.frameAt(15), ctx())).toEqual(buildScene(show.frameAt(15), ctx()));
  });

  it('packs whole instances and stays bounded', () => {
    const s = buildScene(show.frameAt(15), ctx());
    expect(s.quads.length % QUAD_FLOATS).toBe(0);
    expect(s.coins.length % COIN_FLOATS).toBe(0);
    expect(s.lines.length % LINE_FLOATS).toBe(0);
    expect(quadCount(s)).toBeLessThanOrEqual(MAX_SCENE_QUADS);
  });

  it('draws fewer dust points and no nebula on the Low tier', () => {
    const high = buildScene(show.frameAt(15), ctx());
    const low = buildScene(show.frameAt(15), ctx({ tier: TIERS.low }));
    expect(low.quads.length).toBeLessThan(high.quads.length);
    expect(low.nebula).toBeNull();
    expect(high.nebula).not.toBeNull();
    expect(low.bloom).toBe('off');
  });

  it('draws one coin per visible coin that has an atlas cell', () => {
    const frame = show.frameAt(26);
    const s = buildScene(frame, ctx());
    const visible = frame.base.coins.filter((c) => atlas.has(c.selector) && (frame.base.sky.stars[c.star]?.radius ?? 0) > 0);
    expect(s.coins.length / COIN_FLOATS).toBe(visible.length);
  });

  it('shakes only during a milestone slam, and never under reduced motion', () => {
    const frame = { ...show.frameAt(15), slam: { start: 14.9, label: '$1B moved', progress: 0.1 } };
    expect(buildScene(frame, ctx()).shock).not.toBeNull();
    expect(buildScene(frame, ctx({ reducedMotion: true })).shock).toBeNull();
    expect(buildScene(show.frameAt(15), ctx()).shock).toBeNull();
  });

  it('assembles one title particle per target in the finale', () => {
    const withTitle = buildScene(show.frameAt(28.2), ctx());
    const without = buildScene(show.frameAt(28.2), ctx({ titleTargets: [] }));
    expect(quadCount(withTitle) - quadCount(without)).toBe(targets.length);
  });

  it.each([
    [1920, 1080],
    [1080, 1920],
  ])('lands the assembled title particles on the drawn end title at %ix%i', (width, height) => {
    const em = END_TITLE_PX * storyUnit(width, height);
    const s = buildScene(show.frameAt(28.8), ctx({ width, height, titleTargets: [{ x: 1, y: -0.25 }] }));
    const sparks: [number, number][] = [];
    for (let i = 0; i < s.quads.length; i += QUAD_FLOATS) if (s.quads[i + 9] === CINEMA_SHAPE.spark) sparks.push([s.quads[i]!, s.quads[i + 1]!]);
    expect(sparks.some(([x, y]) => Math.abs(x - (width / 2 + em)) < 1e-3 && Math.abs(y - (height / 2 - 0.25 * em)) < 1e-3)).toBe(true);
  });

  it('lets a coin that popped in at the end of the story settle to its size in the finale', () => {
    const days = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
    const late = {
      ...replay,
      since: days[0]!,
      chains: [
        { selector: 'a', name: 'alpha-mainnet', display_name: 'Alpha', first_day: days[0]! },
        { selector: 'b', name: 'beta-mainnet', display_name: 'Beta', first_day: days[0]! },
        { selector: 'd', name: 'delta-mainnet', display_name: 'Delta', first_day: days.at(-1)! },
      ],
      lanes: [[0, 1], [2, 0]],
      days: days.map((day, i) => ({ day, lanes: i === days.length - 1 ? [[0, 3000, 1e6], [1, 50, 1e9]] : [[0, 3000, 1e6]] })),
    } as ReplayFile;
    const lateHistory = late.days.map((d) => ({ ...history[0]!, day: d.day, messages: 3000 }));
    const s = new Show({ replay: late, history: lateHistory, stars: buildLayout(late.chains), length: 30, focus: null, eligible: () => true });
    const lateAtlas = new Map(late.chains.map((c) => [c.selector, [0, 0, 1, 1] as const]));
    const sizeOf = (t: number) => {
      const f = s.frameAt(t);
      const k = f.base.coins.findIndex((c) => c.selector === 'd');
      const scene = buildScene(f, ctx({ atlas: lateAtlas, fullExtent: s.fullExtent }));
      const star = f.base.sky.stars[f.base.coins[k]!.star]!;
      return { drawn: scene.coins[k * COIN_FLOATS + 2]!, rest: coinDiameter(star.radius) * (720 / REPLAY_COIN_UNIT) };
    };
    const finaleStart = s.length - s.timing.finale;
    const popping = sizeOf(finaleStart + 0.05);
    expect(popping.drawn).not.toBeCloseTo(popping.rest, 4);
    const poster = sizeOf(s.posterTime());
    expect(poster.drawn).toBeCloseTo(poster.rest, 4);
  });

  it.each([15, 30, 60])('holds the formed title for at least a quarter of the %i s finale before the loop crossfade', (length) => {
    const finaleS = new Show({ replay, history, stars, length, focus: null, eligible: () => true }).timing.finale;
    const loopFrom = (finaleS - LOOP_S) / finaleS;
    const fractions = Array.from({ length: 1001 }, (_, i) => i / 1000);
    const landed = fractions.find((f) => titleAssembly(f) >= 1)!;
    expect(loopFrom - landed).toBeGreaterThanOrEqual(0.25);
    for (const f of fractions.filter((x) => x >= landed && x <= loopFrom)) {
      expect(titleParticleFade(f) >= 0.5 || endTitleAlpha(f, true) >= 0.98).toBe(true);
    }
    expect(endTitleAlpha(landed, true)).toBe(0);
  });

  it.each([
    [1280, 720],
    [720, 720],
    [720, 1280],
  ])('drifts the nebula about 2 percent of the frame width per 10 s at %ix%i', (width, height) => {
    const at = (t: number) => buildScene(show.frameAt(t), ctx({ width, height })).nebula!.offset[0];
    const widthInNoise = 2.2 * (width / height);
    expect((at(15) - at(5)) / widthInNoise).toBeCloseTo(0.02, 6);
  });

  it('feathers the canvas edge only when asked', () => {
    expect(buildScene(show.frameAt(15), ctx()).edgeFeather).toBe(0);
    expect(buildScene(show.frameAt(15), ctx({ edgeFeather: 0.06 })).edgeFeather).toBe(0.06);
  });

  it('pulses the exposure only around the finale beat', () => {
    expect(buildScene(show.frameAt(20), ctx()).exposure).toBe(1);
    expect(buildScene(show.frameAt(27.6), ctx()).exposure).toBeGreaterThan(1);
  });

  it('draws no supernova before a join ignites', () => {
    const frame = show.frameAt(15);
    const star = frame.base.sky.stars.findIndex((s) => s.radius > 0);
    const before = buildScene(withSky(frame, { rings: [{ star, progress: -0.2 }] }), ctx());
    const none = buildScene(withSky(frame, { rings: [] }), ctx());
    const during = buildScene(withSky(frame, { rings: [{ star, progress: 0.2 }] }), ctx());
    expect(quadCount(before)).toBe(quadCount(none));
    expect(quadCount(during)).toBeGreaterThan(quadCount(none));
  });

  it('colors only gold comets gold', () => {
    const frame = show.frameAt(15);
    const comet = { from: 0, to: 1, progress: 0.5, size: 0.5 };
    const goldQuads = (kind: 'token' | 'data' | 'gold') => {
      const s = buildScene(withSky(frame, { comets: [{ ...comet, kind }], rings: [] }, { arrivals: [] }), ctx({ tier: TIERS.low }));
      let gold = 0;
      for (let i = 0; i < s.quads.length; i += QUAD_FLOATS) {
        if (s.quads[i + 5]! > s.quads[i + 7]! * 2) gold++;
      }
      return gold;
    };
    expect(goldQuads('gold')).toBeGreaterThan(0);
    expect(goldQuads('data')).toBe(0);
    expect(goldQuads('token')).toBe(0);
  });

  it('keeps the most opaque lanes when over the lane cap', () => {
    const frame = show.frameAt(15);
    const many = Array.from({ length: MAX_SCENE_LANES + 10 }, (_, i) => ({ from: 0, to: 1, opacity: i < 10 ? 0.01 : 0.5 }));
    const s = buildScene(withSky(frame, { lanes: many, comets: [], rings: [] }, { arrivals: [] }), ctx());
    expect(s.lines.length / LINE_FLOATS).toBe(MAX_SCENE_LANES * LANE_SEGMENTS * 2);
    expect(Math.min(...Array.from({ length: s.lines.length / LINE_FLOATS }, (_, i) => s.lines[i * LINE_FLOATS + 2]!))).toBeCloseTo(0.45);
  });

  describe('flood', () => {
    const base = show.frameAt(15);
    const live = base.base.sky.stars.length;
    const comets = Array.from({ length: 250 }, (_, i) => ({ from: i % live, to: (i + 1) % live, progress: (i % 10) / 10 + 0.05, size: 1, kind: 'gold' as const }));
    const rings = Array.from({ length: 600 }, (_, i) => ({ star: i % live, progress: 0.1 + (i % 5) * 0.1 }));
    const arrivals = Array.from({ length: 120 }, (_, i) => ({ from: i % live, to: (i + 1) % live, age: (i % 4) * 0.1, size: 1, kind: 'gold' as const }));
    const lanes = Array.from({ length: 2000 }, (_, i) => ({ from: i % live, to: (i + 1) % live, opacity: 0.5 }));
    const coins = Array.from({ length: 500 }, () => ({ star: 0, selector: replay.chains[0]!.selector, alpha: 1 }));
    const floodStars = base.base.sky.stars.map((s) => ({ ...s, radius: Math.max(s.radius, 1) }));
    const flood = withSky(base, { comets, rings, lanes, stars: floodStars }, { arrivals, coins });
    const scene = buildScene(flood, ctx());

    it('keeps every array within its cap', () => {
      expect(quadCount(scene)).toBeLessThanOrEqual(MAX_SCENE_QUADS);
      expect(scene.lines.length / LINE_FLOATS).toBeLessThanOrEqual(MAX_SCENE_LANES * LANE_SEGMENTS * 2);
      expect(scene.coins.length / COIN_FLOATS).toBeLessThanOrEqual(MAX_SCENE_COINS);
    });

    it('fills the quad cap exactly', () => {
      expect(quadCount(scene)).toBe(MAX_SCENE_QUADS);
    });

    it('still draws exactly one core per live star at the cap', () => {
      const coreRed = COLORS.star[0] * 1.1;
      let cores = 0;
      for (let i = 0; i < scene.quads.length; i += QUAD_FLOATS) {
        if (scene.quads[i + 9] === CINEMA_SHAPE.disc && Math.abs(scene.quads[i + 5]! - coreRed) < 1e-4) cores++;
      }
      expect(cores).toBe(floodStars.length);
    });
  });
});

describe('dustField', () => {
  it('seeds three layers with the spec counts', () => {
    const d = dustField(3, 1);
    expect(d.layers.map((l) => l.length / 5)).toEqual([300, 180, 90]);
    expect(dustField(3, 1)).toEqual(d);
  });
});
