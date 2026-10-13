import { describe, expect, it } from 'vitest';
import { GLINT, glintAt, glintFrames, glintGif, marineImages, tagFrame, TRANSPARENT } from '../worker/linkmarine/glint';
import { FRONT_TAG } from '../worker/linkmarine/marine-card';

const W = 1200;
const H = 675;

/** A card of two colours, so the palette has room and the sweep has something to light. */
function base(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p++) rgba.set(p % W < 600 ? [10, 15, 30, 255] : [200, 150, 60, 255], p * 4);
  return rgba;
}

/** The byte length of every Uint8Array made while `run` runs; views onto an existing buffer allocate nothing and are left out. */
function uint8Allocations(run: () => void): number[] {
  const Real = globalThis.Uint8Array;
  const sizes: number[] = [];
  globalThis.Uint8Array = new Proxy(Real, {
    construct(target, args, newTarget) {
      const made = Reflect.construct(target, args, newTarget) as Uint8Array;
      if (!(args[0] instanceof ArrayBuffer)) sizes.push(made.byteLength);
      return made;
    },
  });
  try {
    run();
  } finally {
    globalThis.Uint8Array = Real;
  }
  return sizes;
}

describe('the glint', () => {
  it('lights only the front tag, from nothing to a bright band and back', () => {
    // #given the tag's centre in card pixels
    const f = tagFrame(FRONT_TAG, W, H);
    const [cx, cy] = [Math.floor(f.cx), Math.floor(f.cy)];
    // #when
    const light = { offTag: glintAt(f, 5, 5, 0.5), centre: glintAt(f, cx, cy, 0.5), before: glintAt(f, cx, cy, 0), after: glintAt(f, cx, cy, 1) };
    // #then
    expect({ offTag: light.offTag, centre: light.centre > 0.8, before: light.before < 0.01, after: light.after < 0.01 }).toEqual({ offTag: 0, centre: true, before: true, after: true });
  });

  it("holds the card, then sweeps in twelve frames of the front tag's box alone", () => {
    // #when
    const frames = glintFrames(base(), W, H);
    const { x0, y0, x1, y1 } = frames.box;
    const sweep = [...frames.sweep()];
    const changed = sweep.map((index) => index.filter((v) => v !== TRANSPARENT).length);
    // #then each frame covers the box, about a fifth of the card
    expect({
      sweep: sweep.length,
      palette: frames.palette.length,
      boxed: sweep.every((index) => index.length === (x1 - x0) * (y1 - y0)),
      fifth: (x1 - x0) * (y1 - y0) < (W * H) / 4,
      lit: changed.slice(2, 10).every((n) => n > 1000),
      timing: GLINT.holdMs + GLINT.sweepFrames * GLINT.frameMs,
    }).toEqual({ sweep: 12, palette: 256, boxed: true, fifth: true, lit: true, timing: 1320 });
  });

  it('encodes the glint without a copy of the card per frame: one card-sized buffer, under 12 MB in all', () => {
    // #given
    const card = base();
    // #when
    const sizes = uint8Allocations(() => glintGif(card, W, H));
    // #then the one buffer as large as the card is the palette's sample: the card and the lit box
    const total = sizes.reduce((s, n) => s + n, 0);
    expect({ cardSized: sizes.filter((n) => n >= W * H * 4).length, underTwelveMB: total < 12_000_000 }).toEqual({ cardSized: 1, underTwelveMB: true });
  });
});

/** Every index of every frame is a real colour, or the transparent 255. */
function indicesAreSound(frames: ReturnType<typeof glintFrames>): boolean {
  const real = frames.colors;
  return frames.first.every((v) => v < real) && [...frames.sweep()].every((index) => index.every((v) => v === TRANSPARENT || v < real));
}

describe('the glint palette', () => {
  it('never gives a real pixel the transparent index when the palette is short', () => {
    // #given a card with few colours, near-black among them
    const rgba = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) rgba.set(p % W < 300 ? [1, 2, 3, 255] : p % W < 800 ? [12, 14, 40, 255] : [90, 60, 20, 255], p * 4);
    // #when
    const frames = glintFrames(rgba, W, H);
    // #then
    expect({ short: frames.colors < 255, sound: indicesAreSound(frames) }).toEqual({ short: true, sound: true });
  });

  it('never gives a real pixel the transparent index when the palette is full', () => {
    // #given a card of 300 colour stripes, with a near-black band among them
    const rgba = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      const k = Math.floor((x * 300) / W);
      rgba.set(x < 60 ? [6, 6, 6, 255] : [40 + ((k * 37) % 216), 40 + ((k * 91) % 216), 40 + ((k * 13) % 216), 255], p * 4);
    }
    // #when
    const frames = glintFrames(rgba, W, H);
    // #then
    expect({ full: frames.colors, sound: indicesAreSound(frames) }).toEqual({ full: 255, sound: true });
  });
});

describe('the dog tag images from one render', () => {
  const rendered = () => ({ png: new Uint8Array([137, 80, 78, 71]), pixels: base(), width: W, height: H });

  it('keeps the PNG and gives the reason when the glint fails', () => {
    // #given
    const card = rendered();
    // #when
    const images = marineImages(card, 'legendary', () => {
      throw new Error('Array buffer allocation failed');
    });
    // #then
    expect(images).toEqual({ png: card.png, gif: null, glintError: 'Array buffer allocation failed' });
  });

  it('glints Rare and up only', () => {
    // #given
    const card = rendered();
    const glint = () => new Uint8Array([71, 73, 70]);
    // #when
    const gifs = (['common', 'uncommon', 'rare', 'legendary'] as const).map((tier) => marineImages(card, tier, glint).gif?.length ?? null);
    // #then
    expect(gifs).toEqual([null, null, 3, 3]);
  });
});
