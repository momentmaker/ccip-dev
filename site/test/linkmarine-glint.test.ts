import { describe, expect, it } from 'vitest';
import { GLINT, glintAt, glintFrames, tagFrame, TRANSPARENT } from '../worker/linkmarine/glint';
import { FRONT_TAG } from '../worker/linkmarine/marine-card';

const W = 1200;
const H = 675;

/** A card of two colours, so the palette has room and the sweep has something to light. */
function base(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p++) rgba.set(p % W < 600 ? [10, 15, 30, 255] : [200, 150, 60, 255], p * 4);
  return rgba;
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

  it('holds the card, then sweeps in twelve frames that change nothing outside the tag', () => {
    // #when
    const frames = glintFrames(base(), W, H);
    const { x0, y0, x1, y1 } = frames.box;
    const outside = frames.sweep.every((index) => index.every((v, p) => v === TRANSPARENT || ((p % W) >= x0 && (p % W) < x1 && Math.floor(p / W) >= y0 && Math.floor(p / W) < y1)));
    const changed = frames.sweep.map((index) => index.filter((v) => v !== TRANSPARENT).length);
    // #then
    expect({
      sweep: frames.sweep.length,
      palette: frames.palette.length,
      outside,
      lit: changed.slice(2, 10).every((n) => n > 1000),
      timing: GLINT.holdMs + GLINT.sweepFrames * GLINT.frameMs,
    }).toEqual({ sweep: 12, palette: 256, outside: true, lit: true, timing: 1320 });
  });
});

/** Every index of every frame is a real colour, or the transparent 255 exactly where the pixel is unchanged. */
function indicesAreSound(frames: ReturnType<typeof glintFrames>): boolean {
  const real = frames.colors;
  const shown = new Uint8Array(frames.first);
  if (!frames.first.every((v) => v < real)) return false;
  for (const index of frames.sweep) {
    for (let p = 0; p < index.length; p++) {
      const v = index[p]!;
      if (v === TRANSPARENT) continue;
      if (v >= real) return false;
      shown[p] = v;
    }
  }
  return true;
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
    // #given a card of many colours, dark ones among them
    const rgba = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      const y = Math.floor(p / W);
      rgba.set([(x * 7 + y) % 256, (x * 3 + y * 5) % 200, (x + y * 11) % 90, 255], p * 4);
    }
    // #when
    const frames = glintFrames(rgba, W, H);
    // #then
    expect({ full: frames.colors, sound: indicesAreSound(frames) }).toEqual({ full: 255, sound: true });
  }, 30_000);
});
