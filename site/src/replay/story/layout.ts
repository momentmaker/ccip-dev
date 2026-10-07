export type StoryAspect = 'wide' | 'square' | 'tall';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoryLayout {
  aspect: StoryAspect;
  unit: number;
  width: number;
  height: number;
  date: Box;
  counter: Box;
  sub: Box;
  board: Box;
  watermark: Box;
  timeline: Box;
  card: Box;
  slam: Box;
  title: Box;
}

export function aspectOf(width: number, height: number): StoryAspect {
  const r = width / height;
  return r > 1.2 ? 'wide' : r < 0.8 ? 'tall' : 'square';
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const centered = (width: number, w: number, y: number, h: number): Box => ({ x: (width - w) / 2, y, w, h });

export function layoutFor(width: number, height: number): StoryLayout {
  const aspect = aspectOf(width, height);
  const u = Math.min(width, height) / 1080;
  const pad = 48 * u;
  const date: Box = { x: pad, y: pad, w: 560 * u, h: 56 * u };
  const counter: Box = { x: pad, y: pad + 64 * u, w: 640 * u, h: 110 * u };
  const sub: Box = { x: pad, y: pad + 180 * u, w: 640 * u, h: 34 * u };
  const timelineH = 40 * u;
  const slam = centered(width, Math.min(900 * u, width - 2 * pad), height / 2 - 100 * u, 200 * u);
  const title = centered(width, Math.min(1200 * u, width - 2 * pad), height / 2 - 130 * u, 260 * u);
  if (aspect === 'wide') {
    const boardW = 380 * u;
    const board: Box = { x: width - pad - boardW, y: pad, w: boardW, h: 360 * u };
    const watermark: Box = { x: width - pad - boardW, y: height - pad - 30 * u, w: boardW, h: 30 * u };
    const timeline: Box = { x: pad, y: height - pad - timelineH, w: width - 2 * pad - boardW - 40 * u, h: timelineH };
    const card = centered(width, 640 * u, timeline.y - 24 * u - 90 * u, 90 * u);
    return { aspect, unit: u, width, height, date, counter, sub, board, watermark, timeline, card, slam, title };
  }
  const watermark: Box = { x: width - pad - 300 * u, y: pad, w: 300 * u, h: 30 * u };
  const timeline: Box = { x: pad, y: height - pad - timelineH, w: width - 2 * pad, h: timelineH };
  const board: Box = { x: pad, y: timeline.y - 16 * u - 120 * u, w: width - 2 * pad, h: 120 * u };
  const card = centered(width, 640 * u, board.y - 24 * u - 90 * u, 90 * u);
  return { aspect, unit: u, width, height, date, counter, sub, board, watermark, timeline, card, slam, title };
}
