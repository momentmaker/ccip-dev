import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/replay/cinema/quality';
import { buildScene, createSceneBuilder, dustField, type SceneContext } from '../src/replay/cinema/scene';
import { Show } from '../src/replay/director/show';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const show = new Show({ replay, history, stars, length: 30, focus: null, eligible: () => true });
const atlas = new Map(replay.chains.map((c, i) => [c.selector, [i * 0.1, 0, i * 0.1 + 0.1, 1] as const]));
const ctx: SceneContext = {
  width: 1280,
  height: 720,
  tier: TIERS.high,
  dust: dustField(11, 1),
  fullExtent: show.fullExtent,
  atlas,
  titleTargets: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }],
  reducedMotion: false,
  seed: 5,
  finaleSeconds: 3,
};

const fingerprint = (a: Float32Array): string => {
  const bits = new Uint32Array(a.buffer, a.byteOffset, a.length);
  let h = 2166136261;
  for (const v of bits) h = Math.imul(h ^ v, 16777619) >>> 0;
  return `${a.length}:${h}`;
};
const fingerprints = (scene: { lines: Float32Array; quads: Float32Array; coins: Float32Array }) => [fingerprint(scene.lines), fingerprint(scene.quads), fingerprint(scene.coins)];
const TIMES = [0, 5, 15, 26, 27.3, 29.5];
const GOLDEN = [
  ['96:3881688590', '1550:1871880110', '0:2166136261'],
  ['96:3953014084', '790:2514322388', '0:2166136261'],
  ['192:1328960865', '1090:1692436568', '24:760649950'],
  ['192:2875041235', '1030:1693299645', '32:1996228850'],
  ['192:2654241931', '1170:3806334481', '32:2480375795'],
  ['192:2845710538', '1040:3211187491', '32:3035599655'],
];

describe('buildScene output', () => {
  it('matches the values captured before buffer reuse', () => {
    expect(TIMES.map((t) => fingerprints(buildScene(show.frameAt(t), ctx)))).toEqual(GOLDEN);
  });
});

describe('createSceneBuilder', () => {
  it('reproduces the same output when one builder is reused across frames', () => {
    const build = createSceneBuilder();
    expect(TIMES.map((t) => fingerprints(build(show.frameAt(t), ctx)))).toEqual(GOLDEN);
  });

  it('grows for a larger frame, then is neither truncated nor padded by a smaller one', () => {
    const build = createSceneBuilder();
    const small = fingerprints(build(show.frameAt(5), ctx));
    const large = fingerprints(build(show.frameAt(26), ctx));
    const smallAgain = fingerprints(build(show.frameAt(5), ctx));
    expect(small).toEqual(GOLDEN[1]);
    expect(large).toEqual(GOLDEN[3]);
    expect(smallAgain).toEqual(GOLDEN[1]);
  });

  it('keeps separate buffers per builder', () => {
    const a = createSceneBuilder()(show.frameAt(15), ctx);
    const b = createSceneBuilder()(show.frameAt(15), ctx);
    expect(a.quads.buffer).not.toBe(b.quads.buffer);
  });
});
