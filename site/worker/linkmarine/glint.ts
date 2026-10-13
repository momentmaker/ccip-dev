/// <reference path="./gifenc.d.ts" />
import * as gifencModule from 'gifenc';
import { px } from './art';
import { FRONT_TAG, TAG_RADIUS, type TagBox } from './marine-card';

// Bundlers hand gifenc over as ES named exports, Node as the CommonJS object behind `default`.
const gifenc: typeof gifencModule = 'GIFEncoder' in gifencModule ? gifencModule : (gifencModule as unknown as { default: typeof gifencModule }).default;

export const GLINT = { sweepFrames: 12, frameMs: 60, holdMs: 600 } as const;
export const TRANSPARENT = 255;
/** A 4×4 Bayer matrix, centred on zero: ordered dithering stays put from frame to frame, so unchanged pixels stay transparent. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 10);

interface TagFrame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
  cos: number;
  sin: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The front tag in card pixels, with the box around it once turned. */
export function tagFrame(tag: TagBox, width: number, height: number): TagFrame {
  const w = px(tag.width);
  const h = px(tag.height);
  const cx = px(tag.left) + w / 2;
  const cy = px(tag.top) + h / 2;
  const a = (tag.rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const halfW = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
  const halfH = (Math.abs(w * sin) + Math.abs(h * cos)) / 2;
  return {
    cx, cy, w, h, r: px(TAG_RADIUS), cos, sin,
    x0: Math.max(0, Math.floor(cx - halfW)), y0: Math.max(0, Math.floor(cy - halfH)),
    x1: Math.min(width, Math.ceil(cx + halfW)), y1: Math.min(height, Math.ceil(cy + halfH)),
  };
}

/** How much light the sweep throws on card pixel (x, y) at progress t (0 → 1), 0 off the tag. */
export function glintAt(f: TagFrame, x: number, y: number, t: number): number {
  const dx = x + 0.5 - f.cx;
  const dy = y + 0.5 - f.cy;
  const u = dx * f.cos + dy * f.sin;
  const v = -dx * f.sin + dy * f.cos;
  const qx = Math.abs(u) - (f.w / 2 - f.r);
  const qy = Math.abs(v) - (f.h / 2 - f.r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - f.r;
  const cover = Math.min(1, Math.max(0, 0.5 - outside));
  if (cover === 0) return 0;
  const centre = (-0.85 + 1.7 * t) * f.w;
  const s = (u + 0.42 * v - centre) / f.w;
  const light = 0.55 * Math.exp(-((s / 0.09) ** 2)) + 0.35 * Math.exp(-((s / 0.018) ** 2));
  return cover * Math.min(0.85, light);
}

/** Sweep frame k's progress: never 0 or 1, where the light would sit off the tag. */
const progress = (k: number) => (k + 1) / (GLINT.sweepFrames + 1);

/** A channel brightened by `light`, truncated as a byte stores it. */
const brighten = (v: number, light: number) => (v + light * (255 - v)) | 0;

type Indexer = (r: number, g: number, b: number, x: number, y: number) => number;

function indexer(palette: gifencModule.Palette): Indexer {
  const cache = new Int16Array(1 << 15).fill(-1);
  return (r0, g0, b0, x, y) => {
    const d = BAYER[(y & 3) * 4 + (x & 3)]!;
    const r = Math.min(255, Math.max(0, r0 + d));
    const g = Math.min(255, Math.max(0, g0 + d));
    const b = Math.min(255, Math.max(0, b0 + d));
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let found = cache[key]!;
    if (found < 0) {
      found = gifenc.nearestColorIndex(palette, [(r >> 3) << 3, (g >> 3) << 3, (b >> 3) << 3]);
      cache[key] = found;
    }
    return found;
  };
}

/** What the palette is drawn from: the card, then the front tag's box as the middle sweep frame lights it. */
function paletteSample(base: Uint8Array, f: TagFrame, width: number): Uint8Array {
  const sample = new Uint8Array(base.length + (f.x1 - f.x0) * (f.y1 - f.y0) * 4);
  sample.set(base);
  const t = progress(Math.floor(GLINT.sweepFrames / 2));
  let o = base.length;
  for (let y = f.y0; y < f.y1; y++) {
    for (let x = f.x0; x < f.x1; x++, o += 4) {
      const i = (y * width + x) * 4;
      const light = glintAt(f, x, y, t);
      for (let c = 0; c < 3; c++) sample[o + c] = brighten(base[i + c]!, light);
      sample[o + 3] = base[i + 3]!;
    }
  }
  return sample;
}

export interface GlintFrames {
  /** Padded to 256 entries for the encoder; only the first `colors` are real. */
  palette: gifencModule.Palette;
  /** How many palette entries are real colours: pixels only ever use these, so index 255 stays free for TRANSPARENT. */
  colors: number;
  /** The static card, indexed. */
  first: Uint8Array;
  /** The front tag's box: the only pixels the sweep changes. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The sweep, a frame at a time as it is asked for: each frame is the box's indices, the changed pixels and TRANSPARENT elsewhere. */
  sweep: () => Generator<Uint8Array>;
}

/**
 * The glint's frames: the static card, then a light sweeping across the front tag. They share one 255-colour palette,
 * and every frame after the first carries only the pixels that change, so the file stays small. The sweep is lit only
 * inside the tag's box and one frame at a time, so encoding never holds more than a box of each frame.
 */
export function glintFrames(base: Uint8Array, width: number, height: number, tag: TagBox = FRONT_TAG): GlintFrames {
  const f = tagFrame(tag, width, height);
  const palette = gifenc.quantize(paletteSample(base, f, width), 255);
  const colors = palette.length;
  const toIndex = indexer(palette.slice());
  while (palette.length < 256) palette.push([0, 0, 0]);
  const first = new Uint8Array(width * height);
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) first[p] = toIndex(base[p * 4]!, base[p * 4 + 1]!, base[p * 4 + 2]!, x, y);
  const box = { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 };
  function* sweep(): Generator<Uint8Array> {
    const shown = new Uint8Array((box.x1 - box.x0) * (box.y1 - box.y0));
    for (let y = box.y0, q = 0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++, q++) shown[q] = first[y * width + x]!;
    for (let k = 0; k < GLINT.sweepFrames; k++) {
      const t = progress(k);
      const index = new Uint8Array(shown.length).fill(TRANSPARENT);
      for (let y = box.y0, q = 0; y < box.y1; y++) {
        for (let x = box.x0; x < box.x1; x++, q++) {
          const p = y * width + x;
          const light = glintAt(f, x, y, t);
          const i = p * 4;
          const want = light === 0 ? first[p]! : toIndex(brighten(base[i]!, light), brighten(base[i + 1]!, light), brighten(base[i + 2]!, light), x, y);
          if (want !== shown[q]) {
            index[q] = want;
            shown[q] = want;
          }
        }
      }
      yield index;
    }
  }
  return { palette, colors, first, box, sweep };
}

/** The animated glint as a looping GIF: the card held 600 ms, then twelve 60 ms frames of the sweep, about 1.3 s in all. */
export function glintGif(base: Uint8Array, width: number, height: number, tag: TagBox = FRONT_TAG): Uint8Array {
  const frames = glintFrames(base, width, height, tag);
  const gif = gifenc.GIFEncoder();
  gif.writeFrame(frames.first, width, height, { palette: frames.palette, delay: GLINT.holdMs, repeat: 0 });
  // gifenc writes whole frames only: one card-sized frame, transparent outside the box, carries each box in turn.
  const { x0, y0, x1, y1 } = frames.box;
  const boxWidth = x1 - x0;
  const whole = new Uint8Array(width * height).fill(TRANSPARENT);
  for (const index of frames.sweep()) {
    for (let y = y0; y < y1; y++) whole.set(index.subarray((y - y0) * boxWidth, (y - y0 + 1) * boxWidth), y * width + x0);
    gif.writeFrame(whole, width, height, { delay: GLINT.frameMs, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 });
  }
  gif.finish();
  return gif.bytes();
}
