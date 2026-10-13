import { formatCount, formatUsd } from '@ccip-dev/core/format';
import type { DossierCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { artLayer, at, capDay, DOT_FILTER, font, halo, INK, onCurve, pulse, px, r1 } from './art';
import { chainHexFrame, chainHexIcon, chainHexUnder, chainLabel, NO_ART, type ChainArt } from './chain-hex';
import { asOf, bend, BLUE_TEXT, bright, bulletRow, caption, daySeed, eyebrow, intelFrame, textRow } from './intel-frame';
import { textWidthEm } from './inter-black';
import { laneLabel } from './sitrep-card';

const HERO = { x: 200, y: 218, r: 66 };
/** The partners' places in orbit, the biggest first. */
export const PARTNER_SLOTS: readonly { x: number; y: number }[] = [{ x: 340, y: 92 }, { x: 62, y: 100 }, { x: 70, y: 340 }, { x: 340, y: 346 }];
const PARTNER_R = 25;
const BARS = { x: 470, step: 26, width: 16, bottom: 352, max: 44 };

export const TITLE_WIDTH = 290;
const TITLE_TRACKING = -0.02;
const widthEm = (text: string) => textWidthEm(text, TITLE_TRACKING);

/** The title on one line at up to 72, or on two at up to 56 split at the best space, sized from Inter 900's real advances to fit its column. */
export function titleFit(name: string): { lines: string[]; size: number } {
  const oneLine = Math.floor(TITLE_WIDTH / widthEm(name));
  if (Math.min(72, oneLine) >= 40) return { lines: [name], size: Math.min(72, oneLine) };
  const spaces = [...name].flatMap((ch, i) => (ch === ' ' ? [i] : []));
  if (spaces.length === 0) return { lines: [name], size: Math.max(24, oneLine) };
  const splits = spaces.map((i) => [name.slice(0, i), name.slice(i + 1)] as const);
  const longer = (pair: readonly [string, string]) => Math.max(widthEm(pair[0]), widthEm(pair[1]));
  const best = splits.reduce((a, c) => (longer(c) < longer(a) ? c : a));
  return { lines: [...best], size: Math.max(26, Math.min(56, Math.floor(TITLE_WIDTH / longer(best)))) };
}

function orbitSvg(card: DossierCard, arts: ReadonlyMap<string, ChainArt>): { under: string; over: string; defs: string; labels: { x: number; y: number; text: string }[] } {
  const hero = arts.get(card.chain.selector) ?? NO_ART;
  const ring = halo('hero', HERO.x, HERO.y, hero.glow, [{ r: 120, width: 2.5, opacity: 0.45 }, { r: 170, width: 1.8, opacity: 0.28 }, { r: 225, width: 1.2, opacity: 0.16 }, { r: 285, width: 1, opacity: 0.08 }], { r: 210, opacity: 0.28 });
  const partners = card.partners.slice(0, PARTNER_SLOTS.length).map((p, i) => ({ ...p, at: PARTNER_SLOTS[i]! }));
  const max = Math.max(1, ...partners.map((p) => p.usd));
  const lanes = partners.map((p) => ({ p, c: bend(HERO, p.at, 0.2) }));
  const mids = lanes.map(({ p, c }) => onCurve(HERO, c, p.at, 0.55));
  const unders = [chainHexUnder('hero-hex', HERO.x, HERO.y, HERO.r, hero), ...partners.map((p, i) => chainHexUnder(`p${i}`, p.at.x, p.at.y, PARTNER_R, arts.get(p.chain.selector) ?? NO_ART))];
  const bars = card.days.slice(-7);
  const top = Math.max(1, ...bars.map((d) => d.messages));
  const barSvg = bars
    .map((d, i) => {
      const height = Math.max(2, Math.round((BARS.max * d.messages) / top));
      const newest = i === bars.length - 1;
      return `<rect x="${BARS.x + BARS.step * i}" y="${BARS.bottom - height}" width="${BARS.width}" height="${height}" rx="3" fill="${newest ? INK.gold : INK.ccip}" opacity="${newest ? 1 : 0.8}"/>`;
    })
    .join('');
  return {
    defs: ring.defs + DOT_FILTER + unders.map((u) => u.defs).join(''),
    under:
      ring.body +
      lanes.map(({ p, c }) => `<path d="M${HERO.x} ${HERO.y} Q ${r1(c.x)} ${r1(c.y)} ${p.at.x} ${p.at.y}" stroke="${INK.blue}" stroke-width="${r1(2 + 3 * (p.usd / max))}" fill="none" opacity="0.8" stroke-linecap="round"/>`).join('') +
      mids.map((m) => pulse(m.x, m.y)).join('') +
      unders.map((u) => u.body).join('') +
      barSvg,
    over: chainHexFrame(HERO.x, HERO.y, HERO.r, hero, true) + partners.map((p) => chainHexFrame(p.at.x, p.at.y, PARTNER_R, arts.get(p.chain.selector) ?? NO_ART)).join(''),
    labels: partners.map((p, i) => ({ x: mids[i]!.x, y: mids[i]!.y - 13, text: formatUsd(p.usd) })),
  };
}

export function highlight(card: DossierCard): string {
  return `#${card.rank} of ${card.ranked} all time${card.feeRank === null ? '' : ` · #${card.feeRank} in fees this week`}`;
}

/** The fee rank is the part to drop first. */
export function highlightSegments(card: DossierCard): string[][] {
  return [[`#${card.rank} of ${card.ranked} all time`], ...(card.feeRank === null ? [] : [[` · #${card.feeRank} in fees this week`]])];
}

/** /ccipchain: one chain as the hero, its partners of the last 7 days in orbit, its all-time numbers and its week. */
export function dossierTree(card: DossierCard, arts: ReadonlyMap<string, ChainArt>): VNode {
  const orbit = orbitSvg(card, arts);
  const title = titleFit(chainLabel(card.chain).toUpperCase());
  return intelFrame(
    daySeed(card.asOf),
    [{ x: 197.6, y: 214, color: '#1b3fa0', stop: 0.45 }, { x: 684, y: 0, color: '#1d3a7a', stop: 0.55 }],
    { body: orbit.under, defs: orbit.defs },
    chainHexIcon(HERO.x, HERO.y, HERO.r, arts.get(card.chain.selector) ?? NO_ART, chainLabel(card.chain)),
    ...card.partners.slice(0, PARTNER_SLOTS.length).map((p, i) => chainHexIcon(PARTNER_SLOTS[i]!.x, PARTNER_SLOTS[i]!.y, PARTNER_R, arts.get(p.chain.selector) ?? NO_ART, chainLabel(p.chain))),
    artLayer(orbit.over),
    ...orbit.labels.map((l) => laneLabel(l.x, l.y, l.text)),
    eyebrow(440, 26, 'CHAIN DOSSIER · CCIP'),
    at(
      440,
      50,
      { flexDirection: 'column', width: px(TITLE_WIDTH) },
      h('div', { style: { display: 'flex', flexDirection: 'column', ...font('Inter', 900, title.size, INK.text, TITLE_TRACKING), lineHeight: 0.95, ...BLUE_TEXT } }, ...title.lines.map((line) => h('div', { style: { display: 'flex' } }, line))),
      textRow(highlightSegments(card), { color: INK.paleGold, marginTop: px(8) }),
      bulletRow([[bright(formatCount(card.messages)), ' messages'], [' · ', bright(formatUsd(card.usd)), ' moved']], { marginTop: px(14) }),
      bulletRow([[bright(formatUsd(card.feesUsd)), ' in fees, all time']]),
      bulletRow([['7 days: ', bright(formatCount(card.week.messages)), ' messages'], [' · ', bright(formatUsd(card.week.usd))]]),
    ),
    caption(470, 364, 'LAST 7 DAYS · MESSAGES A DAY'),
    card.since ? caption(30, 396, `ON CCIP SINCE ${capDay(card.since)}`, INK.muted, {}, 390) : null,
    asOf(card.asOf),
  );
}
