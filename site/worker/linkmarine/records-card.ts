import { formatCount, formatShare, formatUsd } from '@ccip-dev/core/format';
import type { RecordMedal, RecordsCard } from '@ccip-dev/core/linkmarine';
import type { RecordKind } from '@ccip-dev/core/records';
import { glyph } from '../cards/glyphs';
import { h, type Child, type VNode } from '../h';
import { at, capDay, drawable, font, halo, hexPoints, INK, MONO, px } from './art';
import { asOf, b, BLUE_TEXT, bright, daySeed, ellipsize, eyebrow, fitRow, GOLD_TEXT, intelFrame, MIN_CUT, plainDay } from './intel-frame';
import { textWidthEm } from './inter-black';

/** Medal centres left to right, in the Records page's order. */
export const MEDAL_X = [96, 238, 380, 522, 664];
const MEDAL = { y: 196, r: 54 };
const RAISED = { y: 178, r: 62 };
const MEDAL_DEFS =
  '<linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6cf"/><stop offset=".4" stop-color="#f5c451"/><stop offset="1" stop-color="#7d570f"/></linearGradient>' +
  '<filter id="mb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>';

const LABELS: Readonly<Record<RecordKind, string>> = { messages: 'MESSAGES', value: 'MOVED', fees: 'IN FEES', largest_fee: 'ONE FEE', link_share: 'PAID IN LINK' };

export function medalValue(m: RecordMedal): string {
  if (m.kind === 'messages') return formatCount(m.value);
  if (m.kind === 'link_share') return formatShare(m.value);
  return formatUsd(m.value);
}

/** The room a value has inside its hexagon's gold stroke: the flat-to-flat width less the stroke. */
export const medalFitWidth = (raised: boolean): number => ((raised ? RAISED.r : MEDAL.r) - 5) * Math.sqrt(3);

/** The value shrinks with its length, so it stays inside the hexagon: the smaller of the fixed step and the size its real glyph widths allow. */
export function medalSize(text: string, raised: boolean): number {
  const step = text.length <= 5 ? 21 : text.length <= 6 ? 20 : 16;
  const fits = Math.floor(medalFitWidth(raised) / textWidthEm(text, 0));
  return Math.min(raised ? step + 4 : step, fits);
}

function medalsSvg(card: RecordsCard): { body: string; defs: string } {
  const ring = halo('hall', 380, 200, INK.gold, [{ r: 170, width: 1.6, opacity: 0.25 }, { r: 230, width: 1.1, opacity: 0.14 }, { r: 300, width: 1, opacity: 0.07 }], { r: 210, opacity: 0.28 });
  const medals = card.medals
    .slice(0, MEDAL_X.length)
    .map((m, i) => {
      const x = MEDAL_X[i]!;
      if (m.kind === card.newest) {
        return (
          `<polygon points="${hexPoints(x, RAISED.y, RAISED.r + 10)}" fill="${INK.gold}" opacity=".55" filter="url(#mb)"/>` +
          `<polygon points="${hexPoints(x, RAISED.y, RAISED.r)}" fill="#141a2c" stroke="url(#mg)" stroke-width="5"/>` +
          `<polygon points="${hexPoints(x, RAISED.y, RAISED.r - 9)}" fill="none" stroke="#f5c45155" stroke-width="1.2"/>`
        );
      }
      return `<polygon points="${hexPoints(x, MEDAL.y, MEDAL.r)}" fill="#141a2c" stroke="url(#mg)" stroke-width="3.5"/><polygon points="${hexPoints(x, MEDAL.y, MEDAL.r - 9)}" fill="none" stroke="#f5c45155" stroke-width="1.2"/>`;
    })
    .join('');
  return { body: ring.body + medals, defs: ring.defs + MEDAL_DEFS };
}

/** Characters of chain names a medal's lane line may use: its slot is 142 apart, and the neighbours' lines are about 10 characters wide. */
export const LANE_NAME_BUDGET = 26;

/** The two names ellipsized to share the budget in proportion to their lengths, each keeping at least MIN_CUT characters. */
export function laneNames(src: string, dst: string, budget = LANE_NAME_BUDGET): [string, string] {
  if (src.length + dst.length <= budget) return [src, dst];
  const share = Math.round((budget * src.length) / (src.length + dst.length));
  const srcMax = Math.min(src.length, Math.max(MIN_CUT, Math.min(share, budget - MIN_CUT)));
  const dstMax = Math.max(MIN_CUT, budget - srcMax);
  return [ellipsize(src, srcMax), ellipsize(dst, dstMax)];
}

function sub(m: RecordMedal): Child[] {
  if (m.kind !== 'largest_fee' || !m.lane) return ['IN ONE DAY'];
  const [src, dst] = laneNames(drawable(m.lane.src).toUpperCase(), drawable(m.lane.dst).toUpperCase());
  return [src, glyph('right', px(8), INK.muted, { left: px(3), right: px(3) }), dst];
}

function medalText(m: RecordMedal, x: number, raised: boolean): VNode[] {
  const value = medalValue(m);
  const line = (children: Child[], color: string, top: number) => h('div', { style: { display: 'flex', alignItems: 'center', ...font(MONO, 700, 10, color, 0.1), marginTop: px(top) } }, ...children);
  const badge = h('div', { style: { ...font(MONO, 800, 9, '#10131a', 0.14), backgroundImage: 'linear-gradient(135deg, #f5c451, #fff6cf)', padding: `${px(2)}px ${px(7)}px`, borderRadius: px(999), marginBottom: px(5) } }, 'NEWEST');
  const number = h('div', { style: { ...font('Inter', 900, medalSize(value, raised), INK.text), lineHeight: 1, ...(raised ? GOLD_TEXT : BLUE_TEXT) } }, value);
  return [
    at(x - 70, (raised ? RAISED.y : MEDAL.y) - 14, { width: px(140), justifyContent: 'center' }, number),
    at(
      x - 70,
      raised ? 252 : 262,
      { width: px(140), flexDirection: 'column', alignItems: 'center' },
      raised ? badge : null,
      line([LABELS[m.kind]], INK.soft, 0),
      line(sub(m), INK.muted, 3),
      line([capDay(m.day)], INK.paleGold, 3),
    ),
  ];
}

/** The totals line, to just short of where the as-of line starts. */
export const TOTALS_WIDTH = 480;

function totalsRow(card: RecordsCard): VNode {
  const fit = fitRow([[`${formatCount(card.messages)} messages · `, bright(formatUsd(card.usd)), ` moved${card.since ? ` since ${plainDay(card.since)}` : ''}`]], 14, 0, TOTALS_WIDTH);
  return at(30, 384, { ...font(MONO, 700, fit.size, INK.soft), whiteSpace: 'pre' }, ...fit.pieces);
}

/** /cciprecords: the five all-time records as gold-framed hex medals, the newest raised. */
export function recordsTree(card: RecordsCard): VNode {
  const art = medalsSvg(card);
  return intelFrame(
    daySeed(card.asOf),
    [{ x: 608, y: 0, color: '#1d3a7a', stop: 0.55 }],
    art,
    eyebrow(30, 26, 'HALL OF RECORDS · CCIP ALL TIME'),
    ...card.medals.slice(0, MEDAL_X.length).flatMap((m, i) => medalText(m, MEDAL_X[i]!, m.kind === card.newest)),
    totalsRow(card),
    asOf(card.asOf),
  );
}
