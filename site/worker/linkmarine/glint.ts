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

function lit(base: Uint8Array, f: TagFrame, t: number, width: number): Uint8Array {
  const out = new Uint8Array(base);
  for (let y = f.y0; y < f.y1; y++) {
    for (let x = f.x0; x < f.x1; x++) {
      const k = glintAt(f, x, y, t);
      if (k === 0) continue;
      const i = (y * width + x) * 4;
      out[i] = out[i]! + k * (255 - out[i]!);
      out[i + 1] = out[i + 1]! + k * (255 - out[i + 1]!);
      out[i + 2] = out[i + 2]! + k * (255 - out[i + 2]!);
    }
  }
  return out;
}

function indexer(palette: gifencModule.Palette): (rgba: Uint8Array, i: number, x: number, y: number) => number {
  const cache = new Int16Array(1 << 15).fill(-1);
  return (rgba, i, x, y) => {
    const d = BAYER[(y & 3) * 4 + (x & 3)]!;
    const r = Math.min(255, Math.max(0, rgba[i]! + d));
    const g = Math.min(255, Math.max(0, rgba[i + 1]! + d));
    const b = Math.min(255, Math.max(0, rgba[i + 2]! + d));
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let found = cache[key]!;
    if (found < 0) {
      found = gifenc.nearestColorIndex(palette, [(r >> 3) << 3, (g >> 3) << 3, (b >> 3) << 3]);
      cache[key] = found;
    }
    return found;
  };
}

export interface GlintFrames {
  palette: gifencModule.Palette;
  /** The static card, indexed. */
  first: Uint8Array;
  /** The sweep: each frame's changed pixels, TRANSPARENT everywhere else. */
  sweep: Uint8Array[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * The glint's frames: the static card, then a light sweeping across the front tag. They share one 255-colour palette,
 * and every frame after the first carries only the pixels that change, so the file stays small.
 */
export function glintFrames(base: Uint8Array, width: number, height: number, tag: TagBox = FRONT_TAG): GlintFrames {
  const frame = tagFrame(tag, width, height);
  const sweeps = Array.from({ length: GLINT.sweepFrames }, (_, k) => lit(base, frame, (k + 1) / (GLINT.sweepFrames + 1), width));
  const sample = new Uint8Array(base.length * 2);
  sample.set(base);
  sample.set(sweeps[Math.floor(GLINT.sweepFrames / 2)]!, base.length);
  const palette = gifenc.quantize(sample, 255);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const toIndex = indexer(palette);
  const shown = new Uint8Array(width * height);
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) shown[p] = toIndex(base, p * 4, x, y);
  const first = new Uint8Array(shown);
  const sweep = sweeps.map((pixels) => {
    const index = new Uint8Array(width * height).fill(TRANSPARENT);
    for (let y = frame.y0; y < frame.y1; y++) {
      for (let x = frame.x0; x < frame.x1; x++) {
        const p = y * width + x;
        const want = toIndex(pixels, p * 4, x, y);
        if (want !== shown[p]) {
          index[p] = want;
          shown[p] = want;
        }
      }
    }
    return index;
  });
  return { palette, first, sweep, box: { x0: frame.x0, y0: frame.y0, x1: frame.x1, y1: frame.y1 } };
}

/** The animated glint as a looping GIF: the card held 600 ms, then twelve 60 ms frames of the sweep, about 1.3 s in all. */
export function glintGif(base: Uint8Array, width: number, height: number, tag: TagBox = FRONT_TAG): Uint8Array {
  const frames = glintFrames(base, width, height, tag);
  const gif = gifenc.GIFEncoder();
  gif.writeFrame(frames.first, width, height, { palette: frames.palette, delay: GLINT.holdMs, repeat: 0 });
  for (const index of frames.sweep) gif.writeFrame(index, width, height, { delay: GLINT.frameMs, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 });
  gif.finish();
  return gif.bytes();
}
