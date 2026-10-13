import { h, type Child, type VNode } from '../h';
import { glyph } from '../cards/glyphs';
import { at, capDay, drawable, font, hexBullet, INK, KINO_SIZE, MONO, MONTHS, px, skyLayer, utcDate as utc } from './art';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const title = (word: string) => word[0] + word.slice(1).toLowerCase();

/** "TUE 13 OCT 2026" */
export const capWeekday = (dayOrIso: string) => `${WEEKDAYS[utc(dayOrIso).getUTCDay()]} ${capDay(dayOrIso)}`;
/** "6 Jul 2023" */
export const plainDay = (dayOrIso: string) => {
  const d = utc(dayOrIso);
  return `${d.getUTCDate()} ${title(MONTHS[d.getUTCMonth()]!)} ${d.getUTCFullYear()}`;
};
/** "Thu 8 Oct" */
export const shortWeekday = (dayOrIso: string) => {
  const d = utc(dayOrIso);
  return `${title(WEEKDAYS[d.getUTCDay()]!)} ${d.getUTCDate()} ${title(MONTHS[d.getUTCMonth()]!)}`;
};
/** "10:40 UTC" */
export const clock = (iso: string) => `${utc(iso).toISOString().slice(11, 16)} UTC`;

export const BLUE_TEXT = { backgroundImage: 'linear-gradient(180deg, #ffffff, #9cc0ff 50%, #3c7bff)', backgroundClip: 'text', color: 'transparent', filter: `drop-shadow(0 ${px(2)}px ${px(14)}px #3c7bff55)` };
export const GOLD_TEXT = { backgroundImage: 'linear-gradient(180deg, #fff6cf, #f5c451 45%, #b07a12)', backgroundClip: 'text', color: 'transparent', filter: `drop-shadow(0 ${px(2)}px ${px(12)}px #f5c45144)` };

/** A card's stars, seeded by its day so they hold still within it. */
export const daySeed = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10)) / 86_400_000);

/** The intel cards' frame: the night sky with its glows and art, then the card elements, "ccip.dev" at the top right. */
export function intelFrame(seed: number, glows: Parameters<typeof skyLayer>[1], art: { body: string; defs: string }, ...children: Child[]): VNode {
  return h(
    'div',
    { style: { width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    skyLayer(seed, glows, art.body, art.defs),
    ...children,
    at(630, 23, { width: px(100), justifyContent: 'flex-end', ...font(MONO, 700, 13, INK.blue) }, 'ccip.dev'),
  );
}

/** JetBrains Mono's advance is 0.6 em; the letter-spacing (em) comes on top of each character. */
export const monoWidth = (chars: number, size: number, tracking: number) => chars * (0.6 + tracking) * size;

/** A row piece that is more than plain text: its text is what is measured and what an ellipsis cuts. */
export interface RowPiece {
  text: string;
  node: (text: string) => Child;
  /** Characters' worth of width the piece's drawing (a glyph) adds. */
  extra?: number;
  /** Never cut, only dropped with its segment. */
  fixed?: boolean;
}
export type Piece = string | RowPiece;
export const bright = (text: string): RowPiece => ({ text, node: b });
export const changePiece = (pct: number, digits: number): RowPiece => ({ text: `${Math.abs(pct).toFixed(digits)}%`, node: () => change(pct, digits), extra: 2, fixed: true });

const pieceText = (p: Piece) => (typeof p === 'string' ? p : p.text);
const pieceChars = (p: Piece) => pieceText(p).length + (typeof p === 'string' ? 0 : (p.extra ?? 0));
const segmentChars = (segment: readonly Piece[]) => segment.reduce((n, p) => n + pieceChars(p), 0);
const ELLIPSIS = drawable('\u2026') || '...';
export const MIN_CUT = 6;
const SHRINK_FLOOR = 0.85;

/** "abc…" to `max` characters, never under MIN_CUT. */
export function ellipsize(text: string, max: number): string {
  const keep = Math.max(MIN_CUT, max);
  return text.length <= keep ? text : text.slice(0, keep - ELLIPSIS.length) + ELLIPSIS;
}

/**
 * A mono row fitted to its box (mockup units): shrunk to no less than 85% of `size`, then its trailing segments
 * dropped (last first), then the last piece left ellipsized. The first segment is never dropped.
 */
export function fitRow(segments: readonly (readonly Piece[])[], size: number, tracking: number, width: number): { size: number; pieces: Child[]; chars: number } {
  const per = (sz: number) => monoWidth(1, sz, tracking);
  const floor = Math.floor(size * SHRINK_FLOOR * 10) / 10;
  let kept = [...segments];
  const total = () => kept.reduce((n, s) => n + segmentChars(s), 0);
  const room = (sz: number) => Math.floor(width / per(sz));
  let used = size;
  if (total() > room(size)) used = Math.max(floor, Math.floor(Math.min(size, width / (total() * (0.6 + tracking))) * 10) / 10);
  while (kept.length > 1 && total() > room(used)) kept = kept.slice(0, -1);
  let flat = kept.flat();
  const over = total() - room(used);
  if (over > 0) {
    const i = flat.map((p) => typeof p === 'string' || !p.fixed).lastIndexOf(true);
    if (i >= 0) {
      const piece = flat[i]!;
      const text = pieceText(piece);
      const cut = ellipsize(text, text.length - over);
      flat = flat.map((p, j) => (j === i ? (typeof piece === 'string' ? cut : { ...piece, text: cut }) : p));
    }
  }
  const pieces: Child[] = [];
  let run = '';
  for (const p of flat) {
    if (typeof p === 'string') run += p;
    else {
      if (run) pieces.push(run);
      run = '';
      pieces.push(p.node(p.text));
    }
  }
  if (run) pieces.push(run);
  return { size: used, pieces, chars: flat.reduce((n, p) => n + pieceChars(p), 0) };
}

/** The width of a column of rows on the right of a card (mockup units). */
export const COLUMN_WIDTH = 290;
const BULLET_WIDTH = 17;
const ROW_SIZE = 12.5;

/** Each segment is a priority: the later ones drop first when the row cannot fit `width`. */
export function textRow(segments: readonly (readonly Piece[])[], style: Record<string, unknown> = {}, width = COLUMN_WIDTH, lead: Child = null): VNode {
  const fit = fitRow(segments, ROW_SIZE, 0, width - (lead ? BULLET_WIDTH : 0));
  const pieces = fit.pieces.map((c) => (typeof c === 'string' ? h('span', { style: { flexShrink: 0 } }, c) : c));
  return h('div', { style: { display: 'flex', alignItems: 'center', marginTop: px(7), ...font(MONO, 700, fit.size, INK.soft), whiteSpace: 'pre', ...style } }, lead, ...pieces);
}

export function bulletRow(segments: readonly (readonly Piece[])[], style: Record<string, unknown> = {}, width = COLUMN_WIDTH): VNode {
  return textRow(segments, style, width, h('div', { style: { display: 'flex', marginRight: px(8) } }, hexBullet(px(9), INK.gold)));
}

/** "a · b · c" as segments that drop from the end. */
export const dotted = (text: string): string[][] => text.split(' · ').map((part, i) => [i === 0 ? part : ` · ${part}`]);

const EDGE = 730;

export function eyebrow(left: number, top: number, text: string, extra: Child = null, extraWidth = 0): VNode {
  const fit = fitRow(dotted(text), 11, 0.16, EDGE - left - extraWidth);
  return at(left, top, { alignItems: 'center', ...font(MONO, 700, fit.size, INK.muted, 0.16) }, extra, ...fit.pieces);
}

export function caption(left: number, top: number, text: string, color: string = INK.muted, style: Record<string, unknown> = {}, width = EDGE - left): VNode {
  const fit = fitRow(dotted(text), 11, 0.08, width);
  return at(left, top, { ...font(MONO, 700, fit.size, color, 0.08), ...style }, ...fit.pieces);
}

/** "AS OF 13 OCT 2026 · 11:28 UTC", bottom right. */
export function asOf(iso: string): VNode {
  return caption(430, 396, `AS OF ${capDay(iso)} · ${clock(iso)}`, INK.muted, { width: px(300), justifyContent: 'flex-end' }, 300);
}

/** Values the rows print bright; the rest of a row is soft. */
export const b = (text: string): VNode => h('span', { style: { color: INK.text, flexShrink: 0 } }, text);

/** "▲ 12%" in green or "▼ 12%" in amber, to `digits` decimals; the fonts have no triangles. */
export function change(pct: number, digits: number): VNode {
  const up = pct >= 0;
  const color = up ? INK.up : INK.down;
  return h('div', { style: { display: 'flex', alignItems: 'center', color } }, glyph(up ? 'up' : 'down', px(10), color, { right: px(4) }), `${Math.abs(pct).toFixed(digits)}%`);
}

/** A lane's control point: off the middle of a→b, to its left, by `k` of its length, so lanes both ways bend apart. */
export function bend(a: { x: number; y: number }, b: { x: number; y: number }, k: number): { x: number; y: number } {
  return { x: (a.x + b.x) / 2 - (b.y - a.y) * k, y: (a.y + b.y) / 2 + (b.x - a.x) * k };
}
