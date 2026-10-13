import { formatCompactCount, formatCount, formatPrice, formatUsd } from '@ccip-dev/core/format';
import type { VaultCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { at, capDay, font, halo, hexPoints, INK, px, r1 } from './art';
import { asOf, b, bright, bulletRow, caption, changePiece, daySeed, eyebrow, GOLD_TEXT, intelFrame, shortWeekday, textRow } from './intel-frame';
import { textWidthEm } from './inter-black';

const VAULT_AT = { x: 190, y: 214 };
const BARS = { x: 440, step: 11.2, width: 7.5, bottom: 356, max: 52 };
const VAULT_DEFS =
  '<linearGradient id="vg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6cf"/><stop offset=".4" stop-color="#f5c451"/><stop offset="1" stop-color="#7d570f"/></linearGradient>' +
  '<filter id="vb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>';


export const FIGURE_WIDTH = 290;
export const FIGURE_TRACKING = -0.02;

/** The LINK figure at up to 52, sized from Inter 900's real advances to stay inside its column. */
export function figureSize(text: string): number {
  return Math.min(52, Math.floor(FIGURE_WIDTH / textWidthEm(text, FIGURE_TRACKING)));
}

function vaultSvg(card: VaultCard): { body: string; defs: string } {
  const ring = halo('vault', VAULT_AT.x, VAULT_AT.y, INK.gold, [{ r: 150, width: 1.4, opacity: 0.25 }, { r: 205, width: 1, opacity: 0.14 }, { r: 265, width: 1, opacity: 0.07 }], { r: 210, opacity: 0.28 });
  const bolts = hexPoints(VAULT_AT.x, VAULT_AT.y, 112)
    .split(' ')
    .map((p) => p.split(','))
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="url(#vg)" stroke="#5a3d08" stroke-width="1.5"/>`)
    .join('');
  const door = [
    `<polygon points="${hexPoints(VAULT_AT.x, VAULT_AT.y, 118)}" fill="${INK.gold}" opacity=".35" filter="url(#vb)"/>`,
    `<polygon points="${hexPoints(VAULT_AT.x, VAULT_AT.y, 112)}" fill="#151b2e" stroke="url(#vg)" stroke-width="10"/>`,
    `<polygon points="${hexPoints(VAULT_AT.x, VAULT_AT.y, 88)}" fill="none" stroke="#f5c45188" stroke-width="2" stroke-dasharray="4 6"/>`,
    bolts,
    `<polygon points="${hexPoints(VAULT_AT.x, VAULT_AT.y, 50)}" fill="none" stroke="#375bd2" stroke-width="15" stroke-linejoin="round"/>`,
    `<polygon points="${hexPoints(VAULT_AT.x, VAULT_AT.y, 50)}" fill="none" stroke="#6c8cff" stroke-width="3" opacity=".6"/>`,
  ].join('');
  const weeks = (card.weekly ?? []).slice(-26);
  const max = Math.max(1, ...weeks);
  const bars = weeks
    .map((link, i) => {
      const height = Math.max(2, Math.round((BARS.max * link) / max));
      const latest = i === weeks.length - 1;
      return `<rect x="${r1(BARS.x + BARS.step * i)}" y="${BARS.bottom - height}" width="${BARS.width}" height="${height}" rx="2" fill="${latest ? INK.cream : INK.gold}" opacity="${latest ? 1 : 0.7}"/>`;
    })
    .join('');
  return { body: ring.body + door + bars, defs: ring.defs + VAULT_DEFS };
}

export function dueText(card: VaultCard): string | null {
  if (!card.nextDue) return null;
  return card.overdue ? `overdue since ${shortWeekday(card.nextDue)}` : `next one due ~${shortWeekday(card.nextDue)}`;
}

/** /linkreserve: the vault door around the Chainlink mark, the LINK held, its gain on cost, the deposit streak and six months of deposits. */
export function vaultTree(card: VaultCard): VNode {
  const art = vaultSvg(card);
  const due = dueText(card);
  const figure = formatCount(card.link);
  return intelFrame(
    daySeed(card.asOf),
    [{ x: 190, y: 214, color: '#3a2a08', stop: 0.45 }, { x: 684, y: 0, color: '#1d3a7a', stop: 0.55 }],
    art,
    eyebrow(440, 26, 'CHAINLINK RESERVE'),
    at(
      440,
      50,
      { flexDirection: 'column', width: px(FIGURE_WIDTH) },
      h('div', { style: { ...font('Inter', 900, figureSize(figure), INK.text, FIGURE_TRACKING), lineHeight: 0.9, ...GOLD_TEXT } }, figure),
      h(
        'div',
        { style: { display: 'flex', ...font('Inter', 700, 14, INK.sub), marginTop: px(6), whiteSpace: 'pre' } },
        'LINK held',
        ...(card.valueUsd == null ? [] : [' · ', b(formatUsd(card.valueUsd)), ...(card.priceUsd == null ? [] : [` at ${formatPrice(card.priceUsd)}`])]),
      ),
      card.changePct === null || card.costUsd === null ? null : textRow([[changePiece(card.changePct, 1), ` on its ${formatUsd(card.costUsd)} cost`]], { marginTop: px(10) }),
      bulletRow([
        [bright(formatCount(card.streak)), '-week deposit streak'],
        ...(card.avgWeeklyLink === null ? [] : [[' · ~', bright(formatCompactCount(card.avgWeeklyLink)), ' a week']]),
      ]),
      card.lastDeposit ? bulletRow([['last ', bright(`${formatCount(card.lastDeposit.link)} LINK`), ` on ${shortWeekday(card.lastDeposit.day)}`]]) : null,
      due ? bulletRow([[due]], card.overdue ? { color: INK.down } : {}) : null,
    ),
    caption(440, 366, 'LINK DEPOSITED A WEEK · LAST 6 MONTHS'),
    card.milestone ? caption(30, 396, `${formatCount(card.milestone.link)} LINK ETA ${capDay(card.milestone.eta)}`, INK.paleGold, {}, 390) : null,
    asOf(card.asOf),
  );
}
