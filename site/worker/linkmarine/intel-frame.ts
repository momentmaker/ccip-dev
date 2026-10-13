import { h, type Child, type VNode } from '../h';
import { glyph } from '../cards/glyphs';
import { at, capDay, font, hexBullet, INK, KINO_SIZE, MONO, MONTHS, px, skyLayer, utcDate as utc } from './art';

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

export function eyebrow(left: number, top: number, text: string, extra: Child = null): VNode {
  return at(left, top, { alignItems: 'center', ...font(MONO, 700, 11, INK.muted, 0.16) }, extra, text);
}

export function caption(left: number, top: number, text: string, color: string = INK.muted, style: Record<string, unknown> = {}): VNode {
  return at(left, top, { ...font(MONO, 700, 11, color, 0.08), ...style }, text);
}

/** "AS OF 13 OCT 2026 · 11:28 UTC", bottom right. */
export function asOf(iso: string): VNode {
  return caption(430, 396, `AS OF ${capDay(iso)} · ${clock(iso)}`, INK.muted, { width: px(300), justifyContent: 'flex-end' });
}

/** Values the rows print bright; the rest of a row is soft. */
export const b = (text: string): VNode => h('span', { style: { color: INK.text, flexShrink: 0 } }, text);

/** Each piece keeps its width, so a long row runs past the column rather than losing its spaces. */
export function textRow(children: readonly Child[], style: Record<string, unknown> = {}): VNode {
  const pieces = children.map((c) => (typeof c === 'string' ? h('span', { style: { flexShrink: 0 } }, c) : c));
  return h('div', { style: { display: 'flex', alignItems: 'center', marginTop: px(7), ...font(MONO, 700, 12.5, INK.soft), whiteSpace: 'pre', ...style } }, ...pieces);
}

export function bulletRow(children: readonly Child[], style: Record<string, unknown> = {}): VNode {
  return textRow([h('div', { style: { display: 'flex', marginRight: px(8) } }, hexBullet(px(9), INK.gold)), ...children], style);
}

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
