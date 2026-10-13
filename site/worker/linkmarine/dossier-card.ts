import { formatCount, formatUsd } from '@ccip-dev/core/format';
import type { DossierCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { artLayer, at, capDay, DOT_FILTER, font, halo, INK, onCurve, pulse, px, r1 } from './art';
import { chainHexFrame, chainHexIcon, chainHexUnder, NO_ART, type ChainArt } from './chain-hex';
import { asOf, b, bend, BLUE_TEXT, bulletRow, caption, daySeed, eyebrow, intelFrame, textRow } from './intel-frame';
import { laneLabel } from './sitrep-card';

const HERO = { x: 200, y: 218, r: 66 };
/** The partners' places in orbit, the biggest first. */
export const PARTNER_SLOTS: readonly { x: number; y: number }[] = [{ x: 340, y: 92 }, { x: 62, y: 100 }, { x: 70, y: 340 }, { x: 340, y: 346 }];
const PARTNER_R = 25;
const BARS = { x: 470, step: 26, width: 16, bottom: 352, max: 44 };

/** The title shrinks with the name, so it stays on one line in the right column. */
export function titleSize(name: string): number {
  return name.length <= 7 ? 72 : name.length <= 10 ? 56 : name.length <= 14 ? 42 : 32;
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

/** /ccipchain: one chain as the hero, its partners of the last 7 days in orbit, its all-time numbers and its week. */
export function dossierTree(card: DossierCard, arts: ReadonlyMap<string, ChainArt>): VNode {
  const orbit = orbitSvg(card, arts);
  const name = card.chain.name.toUpperCase();
  return intelFrame(
    daySeed(card.asOf),
    [{ x: 197.6, y: 214, color: '#1b3fa0', stop: 0.45 }, { x: 684, y: 0, color: '#1d3a7a', stop: 0.55 }],
    { body: orbit.under, defs: orbit.defs },
    chainHexIcon(HERO.x, HERO.y, HERO.r, arts.get(card.chain.selector) ?? NO_ART, card.chain.name),
    ...card.partners.slice(0, PARTNER_SLOTS.length).map((p, i) => chainHexIcon(PARTNER_SLOTS[i]!.x, PARTNER_SLOTS[i]!.y, PARTNER_R, arts.get(p.chain.selector) ?? NO_ART, p.chain.name)),
    artLayer(orbit.over),
    ...orbit.labels.map((l) => laneLabel(l.x, l.y, l.text)),
    eyebrow(440, 26, 'CHAIN DOSSIER · CCIP'),
    at(
      440,
      50,
      { flexDirection: 'column', width: px(290) },
      h('div', { style: { ...font('Inter', 900, titleSize(name), INK.text, -0.02), lineHeight: 0.9, ...BLUE_TEXT } }, name),
      textRow([highlight(card)], { color: INK.paleGold, marginTop: px(8) }),
      bulletRow([b(formatCount(card.messages)), ' messages · ', b(formatUsd(card.usd)), ' moved'], { marginTop: px(14) }),
      bulletRow([b(formatUsd(card.feesUsd)), ' in fees, all time']),
      bulletRow(['7 days: ', b(formatCount(card.week.messages)), ' messages · ', b(formatUsd(card.week.usd))]),
    ),
    caption(470, 364, 'LAST 7 DAYS · MESSAGES A DAY'),
    card.since ? caption(30, 396, `ON CCIP SINCE ${capDay(card.since)}`) : null,
    asOf(card.asOf),
  );
}
