import { describe, expect, it } from 'vitest';
import { buildLayout } from '../src/sky/layout';
import { ARRIVAL_FRESH_MS, ARRIVAL_REACH, ARRIVAL_RING_MS, CAPTION_MS, COMET_MS, cometKind, cometSize, creCaption, LiveScene, MAX_COMETS, RING_MS, SHOCKWAVE } from '../src/sky/scene';

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

  it('flies CRE-sent messages as their own kind, whatever they carry', () => {
    // #given a CRE message with and without value
    // #when the kind is chosen
    // #then it is cre
    expect(cometKind(12, 'USDC', true)).toBe('cre');
    expect(cometKind(null, null, true)).toBe('cre');
  });

  it('keeps gold over cre for a $1M+ CRE message', () => {
    // #given a CRE message worth $1M
    // #when the kind is chosen
    // #then gold wins
    expect(cometKind(1_000_000, 'USDC', true)).toBe('gold');
  });

  it('never picks cre when the flag is absent or false', () => {
    // #given no cre flag, and an explicit false
    // #when the kind is chosen
    // #then it is as before
    expect(cometKind(12, 'USDC')).toBe('token');
    expect(cometKind(null, null, false)).toBe('data');
  });

  it('captions a CRE message with its verified sender, or plain CRE without one', () => {
    // #given a sender label, and none
    // #when the caption is written
    // #then the label follows CRE only when there is one
    expect(creCaption('Aave')).toBe('CRE · Aave');
    expect(creCaption(null)).toBe('CRE');
    expect(creCaption(undefined)).toBe('CRE');
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

  it('drops the oldest launches once past the cap, keeping the newest in order', () => {
    const scene = newScene();
    const extra = 3;
    for (let i = 0; i < MAX_COMETS + extra; i++) scene.launch(msg(`m${i}`, 1), i, caption);
    const now = MAX_COMETS + extra;
    const progress = scene.frame(now).comets.map((c) => c.progress);
    expect(progress).toHaveLength(MAX_COMETS);
    expect(progress[0]).toBeCloseTo((now - extra) / COMET_MS, 9);
    expect(progress.at(-1)).toBeCloseTo(1 / COMET_MS, 9);
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

  it('flies a CRE message as a cre comet and captions it for 4 s without rings', () => {
    // #given a small CRE message
    const scene = newScene();
    // #when it launches
    const launched = scene.launch({ ...msg('c1', 5, 'USDC'), cre: true }, 0, () => 'CRE · Aave');
    // #then the comet is cre, the caption is returned, and nothing rings until it lands
    expect(launched).toEqual({ id: 'c1', text: 'CRE · Aave', until: CAPTION_MS });
    expect(scene.frame(COMET_MS / 2).comets[0]!.kind).toBe('cre');
    expect(scene.frame(COMET_MS - 1).rings).toEqual([]);
  });

  it('rings a CRE landing in its own color, with no shockwave', () => {
    // #given a CRE comet
    const scene = newScene();
    scene.launch({ ...msg('c1', 5), cre: true }, 0, caption);
    // #when it lands and the ring plays out
    const landed = scene.frame(COMET_MS);
    // #then there is a single teal-kind arrival ring
    expect(landed.rings).toEqual([{ star: 1, progress: 0, kind: 'cre', reach: ARRIVAL_REACH }]);
    expect(scene.frame(COMET_MS + SHOCKWAVE[0].delay).rings).toHaveLength(1);
    expect(scene.takeArrivals()).toEqual([{ star: 1, selector: 'B', kind: 'cre' }]);
  });

  it('keeps the whale caption and shockwave on a $1M+ CRE message', () => {
    // #given a CRE message worth $4.2M
    const scene = newScene();
    // #when it launches
    const launched = scene.launch({ ...msg('c1', 4_200_000, 'USDC'), cre: true }, 0, caption);
    // #then it is a gold comet with the whale's rings
    expect(launched).toEqual({ id: 'c1', text: 'caption', until: CAPTION_MS });
    expect(scene.frame(COMET_MS).comets).toEqual([]);
    expect(scene.frame(COMET_MS + SHOCKWAVE[0].delay).rings).toHaveLength(2);
  });

  it('sends a shockwave of two wider rings out after a $1M+ ring', () => {
    const scene = newScene();
    scene.launch(msg('whale', 4_200_000, 'USDC'), 0, caption);
    const [first, second] = SHOCKWAVE;
    expect(scene.frame(COMET_MS + first.delay).rings).toEqual([
      { star: 1, progress: first.delay / RING_MS },
      { star: 1, progress: 0, reach: first.reach },
    ]);
    expect(scene.frame(COMET_MS + second.delay).rings).toHaveLength(3);
    expect(scene.frame(COMET_MS + second.delay + second.ms).rings).toEqual([]);
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
