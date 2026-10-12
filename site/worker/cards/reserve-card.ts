import { reserveDepositFacts, type ReserveDepositFacts } from '@ccip-dev/core/broadcasts';
import { formatCompactCount, formatCount, formatPct, formatUsd } from '@ccip-dev/core/format';
import { h, type Child, type VNode } from '../h';
import type { BroadcastInputs } from './broadcast-cards';
import { bold, broadcastFrame, cardDay, COLORS, date, dayNumber, eyebrow, MONTH_DAY, row, TEXT_COLUMN } from './broadcast-frame';
import { RESERVE_CTA } from './cta';
import { ORBIT_H, ORBIT_W, skySvg, svgDataUri } from './orbit-sky';

export const RESERVE_BARS = { x: 735, bottom: 540, step: 30, width: 20, max: 70 } as const;

const MARK = { x: 880, y: 300 };
const STREAMS = [
  { d: 'M1215 115 C1100 125 1010 160 935 215', width: 5, opacity: 0.9, from: [1215, 115], to: [935, 215] },
  { d: 'M1215 190 C1130 200 1050 235 975 265', width: 4, opacity: 0.7, from: [1215, 190], to: [975, 265] },
  { d: 'M1215 255 C1120 262 1030 285 962 300', width: 3, opacity: 0.5, from: [1215, 255], to: [962, 300] },
] as const;
const COMETS = [[1060, 148], [1091, 220], [1078, 274]] as const;

const r1 = (v: number) => Math.round(v * 10) / 10;

function hexagon(r: number): string {
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return `${r1(MARK.x + r * Math.cos(a))},${r1(MARK.y + r * Math.sin(a))}`;
  }).join(' ');
}

/** The Chainlink hexagon glowing with deposits streaming in, over the LINK added each week (this deposit's week lit). */
export function reserveSvg(d: ReserveDepositFacts, seed: number): string {
  const defs = [
    '<filter id="blur8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>',
    '<filter id="blur20" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="20"/></filter>',
    ...STREAMS.map(
      (s, i) =>
        `<linearGradient id="stream${i}" gradientUnits="userSpaceOnUse" x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}"><stop offset="0" stop-color="#4a7ff0"/><stop offset="1" stop-color="#7de3ff"/></linearGradient>`,
    ),
  ].join('');
  const max = Math.max(0, ...d.weeks.map((w) => w.link));
  const bars = d.weeks.map((w, i) => {
    const height = max > 0 ? Math.max(2, Math.round((RESERVE_BARS.max * w.link) / max)) : 2;
    const current = i === d.weeks.length - 1;
    return `<rect x="${RESERVE_BARS.x + RESERVE_BARS.step * i}" y="${RESERVE_BARS.bottom - height}" width="${RESERVE_BARS.width}" height="${height}" rx="3" fill="${current ? '#7de3ff' : '#4a7ff0'}" opacity="${current ? 1 : 0.75}"/>`;
  });
  const body = [
    `<circle cx="${MARK.x}" cy="${MARK.y}" r="230" fill="none" stroke="#4a7ff0" stroke-opacity="0.14" stroke-width="1.5" stroke-dasharray="3 9"/>`,
    `<circle cx="${MARK.x}" cy="${MARK.y}" r="165" fill="none" stroke="#4a7ff0" stroke-opacity="0.18" stroke-width="1.5" stroke-dasharray="3 9"/>`,
    `<polygon points="${hexagon(118)}" fill="#2a5bd7" opacity="0.55" filter="url(#blur20)"/>`,
    `<polygon points="${hexagon(104)}" fill="#0b1430" stroke="#375BD2" stroke-width="30" stroke-linejoin="miter"/>`,
    `<polygon points="${hexagon(104)}" fill="none" stroke="#7aa2ff" stroke-opacity="0.5" stroke-width="2"/>`,
    ...STREAMS.map((s, i) => `<path d="${s.d}" stroke="url(#stream${i})" stroke-width="${s.width}" fill="none" stroke-linecap="round" opacity="${s.opacity}"/>`),
    ...COMETS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#9fc2ff" opacity="0.4" filter="url(#blur8)"/>`),
    ...bars,
  ].join('');
  return skySvg(seed, defs, body, [TEXT_COLUMN]);
}

function reserveStat(value: string, label: string): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', marginRight: 44 } },
    h('div', { style: { fontSize: 34, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: -1 } }, value),
    h('div', { style: { fontSize: 17, fontWeight: 700, letterSpacing: 2.5, color: COLORS.muted, textTransform: 'uppercase', marginTop: 2 } }, label),
  );
}

function reserveBody(d: ReserveDepositFacts): VNode {
  const worth: Child[] = [
    ...(d.usdAtDeposit === null ? [] : [bold(`${formatUsd(d.usdAtDeposit)} `), d.usdNow === null ? 'at deposit' : 'at deposit · ']),
    ...(d.usdNow === null ? [] : [bold(`${formatUsd(d.usdNow)} `), `today${d.changePct === null ? '' : ` (${formatPct(d.changePct)})`}`]),
  ];
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 124, width: 640, display: 'flex', flexDirection: 'column' } },
    eyebrow('New deposit into the Reserve'),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', marginTop: 10 } },
      h('div', { style: { fontSize: 104, fontWeight: 800, letterSpacing: -3, lineHeight: 1 } }, `+${formatCount(d.link)}`),
      h('div', { style: { fontSize: 52, fontWeight: 800, color: '#7aa2ff', marginLeft: 14, marginBottom: 8 } }, 'LINK'),
    ),
    row(worth, { fontSize: 28, marginTop: 18, color: COLORS.muted }),
    h(
      'div',
      { style: { display: 'flex', marginTop: 40, paddingTop: 26, borderTop: '1px solid #1f2a3c' } },
      reserveStat(formatCompactCount(d.balanceLink), 'LINK held'),
      reserveStat(formatCount(d.streak), 'weeks in a row'),
      d.nextMilestone ? reserveStat(MONTH_DAY.format(date(d.nextMilestone.eta)), `On pace for ${formatCount(d.nextMilestone.link / 1_000_000)}M`) : null,
    ),
  );
}

export async function reserveTree(tx: string, load: BroadcastInputs['load']): Promise<VNode | null> {
  const d = reserveDepositFacts(await load('reserve.json'), tx);
  if (d === null) return null;
  const day = d.ts.slice(0, 10);
  return broadcastFrame({
    background: [
      h('img', { src: svgDataUri(reserveSvg(d, dayNumber(day))), width: ORBIT_W, height: ORBIT_H, style: { position: 'absolute', left: 0, top: 0, width: ORBIT_W, height: ORBIT_H } }),
      h(
        'div',
        { style: { position: 'absolute', left: RESERVE_BARS.x, top: RESERVE_BARS.bottom - RESERVE_BARS.max - 27, fontSize: 15, fontWeight: 700, letterSpacing: 2.5, color: COLORS.muted } },
        `LINK ADDED PER WEEK · ${d.weeks.length} WEEKS`,
      ),
    ],
    eyebrow: `Chainlink Reserve · ${cardDay(day)}`,
    body: reserveBody(d),
    insight:
      d.avgWeeklyLink === null
        ? []
        : ['Weekly average: ', bold(`${formatCount(d.avgWeeklyLink)} LINK`), `${d.avgWeeklyUsd === null ? '' : ` (${formatUsd(d.avgWeeklyUsd)})`} over ${d.averageWeeks} week${d.averageWeeks === 1 ? '' : 's'}`],
    cta: RESERVE_CTA,
  });
}
