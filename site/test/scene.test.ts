import { describe, expect, it } from 'vitest';
import { buildLayout } from '../src/sky/layout';
import { ARRIVAL_FRESH_MS, ARRIVAL_REACH, ARRIVAL_RING_MS, CAPTION_MS, COMET_MS, cometKind, cometSize, LiveScene, MAX_COMETS } from '../src/sky/scene';

const stars = buildLayout([{ selector: 'A', first_day: '2023-07-06' }, { selector: 'B', first_day: '2023-07-07' }]);
const newScene = () => new LiveScene(stars, new Map([['A', 100], ['B', 25]]), [{ src: 'A', dst: 'B', usd: 50 }]);
const msg = (id: string, usd: number | null, token: string | null = null) => ({ id, src: 'A', dst: 'B', usd, token });
const caption = () => 'caption';

describe('comet styling', () => {
  it('sizes comets on a log scale between 0.15 and 1', () => {
    expect(cometSize(null)).toBe(0.15);
    expect(cometSize(0)).toBe(0.15);
    expect(cometSize(1000)).toBeCloseTo(Math.log10(1001) / 7);
    expect(cometSize(1e9)).toBe(1);
  });

  it('colors gold from $1M, blue for token transfers, pale for data-only messages', () => {
    expect(cometKind(null, null)).toBe('data');
    expect(cometKind(0, 'USDC')).toBe('token');
    expect(cometKind(12, null)).toBe('token');
    expect(cometKind(1_000_000, null)).toBe('gold');
  });
});

describe('LiveScene', () => {
  it('moves a comet along its lane over 2.4 s', () => {
    const scene = newScene();
    scene.launch(msg('m1', 5), 1000, caption);
    expect(scene.frame(1000 + COMET_MS / 2).comets).toEqual([{ from: 0, to: 1, progress: 0.5, size: cometSize(5), kind: 'token' }]);
    expect(scene.frame(1000 + COMET_MS).comets).toEqual([]);
  });

  it('keeps at most 400 comets, dropping the oldest', () => {
    const scene = newScene();
    for (let i = 0; i <= MAX_COMETS; i++) scene.launch(msg(`m${i}`, 1), i, caption);
    expect(scene.frame(MAX_COMETS).comets).toHaveLength(MAX_COMETS);
  });

  it('gives a $1M+ message a caption for 4 s and a ring when it arrives', () => {
    const scene = newScene();
    expect(scene.launch(msg('whale', 4_200_000, 'USDC'), 0, caption)).toEqual({ id: 'whale', text: 'caption', until: CAPTION_MS });
    expect(scene.frame(COMET_MS - 1).rings).toEqual([]);
    expect(scene.frame(COMET_MS).rings).toEqual([{ star: 1, progress: 0 }]);
    expect(scene.captions).toHaveLength(1);
    scene.frame(CAPTION_MS);
    expect(scene.captions).toHaveLength(0);
    expect(scene.launch(msg('small', 10), 0, caption)).toBeNull();
  });

  it('reports each landing once, with its destination and kind', () => {
    const scene = newScene();
    scene.launch(msg('m1', null), 0, caption);
    scene.frame(COMET_MS - 1);
    expect(scene.takeArrivals()).toEqual([]);
    scene.frame(COMET_MS + 16);
    expect(scene.takeArrivals()).toEqual([{ star: 1, selector: 'B', kind: 'data' }]);
    scene.frame(COMET_MS + 32);
    expect(scene.takeArrivals()).toEqual([]);
  });

  it('stays quiet about landings it only notices long after, like a tab coming back', () => {
    const scene = newScene();
    scene.launch(msg('m1', 5), 0, caption);
    const frame = scene.frame(COMET_MS + ARRIVAL_FRESH_MS + 1);
    expect(scene.takeArrivals()).toEqual([]);
    expect(frame.rings).toEqual([]);
    expect(frame.stars[1]!.flash).toBe(0);
  });

  it('flares the destination star as the comet lands and ripples it in the comet’s color', () => {
    const scene = newScene();
    scene.launch(msg('m1', 5), 0, caption);
    const landed = scene.frame(COMET_MS);
    expect(landed.stars.map((s) => s.flash)).toEqual([0, 1]);
    expect(landed.rings).toEqual([{ star: 1, progress: 0, kind: 'token', reach: ARRIVAL_REACH }]);
    expect(scene.frame(COMET_MS + ARRIVAL_RING_MS / 2).rings).toEqual([{ star: 1, progress: 0.5, kind: 'token', reach: ARRIVAL_REACH }]);
    expect(scene.frame(COMET_MS + ARRIVAL_RING_MS).rings).toEqual([]);
  });

  it('adds an unknown chain as a new star', () => {
    const scene = newScene();
    expect(scene.starIndex('NEW')).toBe(2);
    expect(scene.frame(0).stars).toHaveLength(3);
    expect(scene.starIndex('NEW')).toBe(2);
  });

  it('flashes both stars for reduced motion and fades the flash', () => {
    const scene = newScene();
    scene.flash(msg('m', 1), 0);
    expect(scene.frame(0).stars.map((s) => s.flash)).toEqual([1, 1]);
    expect(scene.frame(450).stars[0]!.flash).toBeCloseTo(0.5);
    expect(scene.frame(900).stars[0]!.flash).toBe(0);
  });

  it('builds lanes with opacity from their USD', () => {
    expect(newScene().frame(0).lanes).toEqual([{ from: 0, to: 1, opacity: expect.closeTo(0.56 * 0.35, 5) }]);
  });
});
