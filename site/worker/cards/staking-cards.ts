import { formatCompactCount, formatCount, formatDuration } from '@ccip-dev/core/format';
import { shortAddress } from '@ccip-dev/core/names';
import type { StakingFile } from '@ccip-dev/core/public';
import { operatorMomentFacts, stakingWeekFacts, type OperatorMomentFacts, type StakingWeekFacts } from '@ccip-dev/core/staking-broadcasts';
import { hiveCenters, hiveKinds, type HiveKind } from '../../src/lib/staking-view';
import { h, type Child, type VNode } from '../h';
import { bold, broadcastFrame, cardDay, cardWeek, COLORS, dayNumber, eyebrow, row, TEXT_COLUMN, type BroadcastInputs } from './broadcast-frame';
import type { Cta } from './cta';
import { ORBIT_H, ORBIT_W, skySvg, svgDataUri } from './orbit-sky';

export const STAKING_CTA: Cta = { lead: 'Track staking:', path: 'ccip.dev/staking' };
export const TEAL = '#2ed3c3';
const TEAL_2 = '#8ff3e6';
const HIVE = { x: 935, y: 300, cell: 16, rings: 7 } as const;
const FILL: Record<HiveKind, string> = { wallet: TEAL, smart: TEAL_2, stakelink: '#4a7ff0', contract: '#5d6b82', open: 'none' };

export type HiveMark = { kind: 'gap'; cells: number } | { kind: 'one'; color: string };

/** The community pool as a honeycomb on the right of the card: the week's openings as dark cells, or one operator's cell lit. */
export function stakingHiveSvg(staking: Pick<StakingFile, 'community' | 'holders'>, seed: number, mark: HiveMark): string {
  const centers = hiveCenters(HIVE.rings);
  const kinds = hiveKinds(staking, centers.length);
  const r = HIVE.cell * 0.92;
  const hex = Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 90) * Math.PI) / 180;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');
  // The marked cells: spread over the hive so a handful of gaps reads as scattered, the way they open.
  const marked = new Set(mark.kind === 'gap' ? Array.from({ length: Math.min(mark.cells, 14) }, (_, i) => (i * 37 + 11) % centers.length) : [0]);
  const cells = centers.map((c, i) => {
    const x = (HIVE.x + c.x * HIVE.cell).toFixed(1);
    const y = (HIVE.y + c.y * HIVE.cell).toFixed(1);
    if (marked.has(i)) {
      const style = mark.kind === 'gap' ? 'fill="#070a10" stroke="#ffcf5a" stroke-width="2"' : `fill="${mark.color}" stroke="#ffffff" stroke-width="2" filter="url(#glow)"`;
      return `<polygon points="${hex}" transform="translate(${x} ${y})" ${style}/>`;
    }
    const kind = kinds[i]!;
    return kind === 'open'
      ? `<polygon points="${hex}" transform="translate(${x} ${y})" fill="none" stroke="#ffcf5a" stroke-dasharray="3 3"/>`
      : `<polygon points="${hex}" transform="translate(${x} ${y})" fill="${FILL[kind]}" opacity="${mark.kind === 'one' ? 0.45 : 0.82}"/>`;
  });
  const defs = [
    '<radialGradient id="tealGlow"><stop offset="0" stop-color="#2ed3c3" stop-opacity="0.28"/><stop offset="1" stop-color="#2ed3c3" stop-opacity="0"/></radialGradient>',
    '<filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
  ].join('');
  const body = `<circle cx="${HIVE.x}" cy="${HIVE.y}" r="290" fill="url(#tealGlow)"/>${cells.join('')}`;
  return skySvg(seed, defs, body, [TEXT_COLUMN]);
}

function background(svg: string): VNode[] {
  return [h('img', { src: svgDataUri(svg), width: ORBIT_W, height: ORBIT_H, style: { position: 'absolute', left: 0, top: 0, width: ORBIT_W, height: ORBIT_H } })];
}

function stat(value: string, label: string): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', marginRight: 34 } },
    h('div', { style: { fontSize: 32, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: -1 } }, value),
    h('div', { style: { fontSize: 15, fontWeight: 700, letterSpacing: 2, color: COLORS.muted, textTransform: 'uppercase', marginTop: 2 } }, label),
  );
}

function chip(text: string, color: string, ink: string): VNode {
  return h('div', { style: { display: 'flex', fontSize: 19, fontWeight: 800, letterSpacing: 3, color: ink, backgroundColor: color, borderRadius: 6, padding: '6px 12px' } }, text);
}

function weekBody(w: StakingWeekFacts): VNode {
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 118, width: 640, display: 'flex', flexDirection: 'column' } },
    eyebrow('Staking sitrep', { color: TEAL }),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', marginTop: 8 } },
      h('div', { style: { fontSize: 92, fontWeight: 800, letterSpacing: -3, lineHeight: 1 } }, formatCompactCount(w.total)),
      h('div', { style: { fontSize: 40, fontWeight: 800, color: TEAL, marginLeft: 12, marginBottom: 6 } }, 'LINK staked'),
    ),
    h(
      'div',
      { style: { display: 'flex', marginTop: 14 } },
      w.full ? chip(w.fullDays === null ? 'POOL FULL' : `POOL FULL FOR ${formatCount(w.fullDays)} DAYS`, TEAL, '#032a27') : chip(`${formatCompactCount(w.cap - w.total)} LINK OF SPACE OPEN`, COLORS.gold, '#2a2116'),
    ),
    row(['In ', bold(formatCompactCount(w.week.staked)), ' · out ', bold(formatCompactCount(w.week.unstaked)), ` LINK · ${formatCount(w.week.new_stakers)} new stakers`], { fontSize: 26, marginTop: 20, color: COLORS.soft }),
    row(
      [bold(formatCompactCount(w.askedToLeave)), ' LINK asked to leave', ...(w.conversionPct === null ? [] : [' · ', bold(`${Math.round(w.conversionPct)}%`), ' of askers go'])],
      { fontSize: 26, marginTop: 8, color: COLORS.soft },
    ),
    h(
      'div',
      { style: { display: 'flex', marginTop: 28, paddingTop: 22, borderTop: '1px solid #1f2a3c' } },
      stat(formatCount(w.stakers), 'stakers'),
      stat(formatCount(w.openings), 'gaps opened'),
      w.fastestRefillS === null ? null : stat(formatDuration(w.fastestRefillS), 'fastest refill'),
      w.communityRatePct === null ? null : stat(`${w.communityRatePct.toFixed(2)}%`, 'a year'),
    ),
  );
}

const operatorName = (o: { name: string | null; address: string }) => o.name ?? shortAddress(o.address);

function weekInsight(w: StakingWeekFacts): Child[] {
  const e = w.operatorEvents[0];
  if (e !== undefined) {
    const verb = { added: 'joined the operator pool', removed: 'left the operator pool', staked: `staked ${formatCount(e.amount)} LINK`, unstaked: `unstaked ${formatCount(e.amount)} LINK`, unbonding: 'started unbonding' }[e.kind];
    return ['Operator watch: ', bold(operatorName(e)), ` ${verb}`];
  }
  return ['Likely to leave in the next 28 days: ', bold(`≈ ${formatCompactCount(w.likelyToLeave)} LINK`)];
}

/** Monday's report on the week before; null until staking.json covers that week, so the post waits. */
export async function stakingTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const staking = await inputs.load('staking.json');
  const w = stakingWeekFacts(staking, monday);
  if (w === null) return null;
  return broadcastFrame({
    background: background(stakingHiveSvg(staking, dayNumber(monday), { kind: 'gap', cells: w.openings })),
    eyebrow: `Chainlink staking · ${cardWeek(monday)}`,
    body: weekBody(w),
    insight: weekInsight(w),
    cta: STAKING_CTA,
  });
}

const HEADLINE: Record<OperatorMomentFacts['kind'], (m: OperatorMomentFacts) => string> = {
  added: () => 'joined the node operator pool',
  removed: () => 'was removed from the operator pool',
  unstaked: (m) => `unstaked ${formatCount(m.amount)} LINK`,
};
const MARK: Record<OperatorMomentFacts['kind'], string> = { added: TEAL_2, removed: COLORS.down, unstaked: COLORS.gold };

function operatorBody(m: OperatorMomentFacts): VNode {
  const name = operatorName(m);
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 124, width: 640, display: 'flex', flexDirection: 'column' } },
    eyebrow('Operator watch', { color: TEAL }),
    h('div', { style: { display: 'flex', fontSize: name.length > 18 ? 64 : 84, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: 12 } }, name),
    h('div', { style: { display: 'flex', fontSize: 36, fontWeight: 700, color: MARK[m.kind], marginTop: 12 } }, HEADLINE[m.kind](m)),
    row(
      [m.via === 'stakelink' ? 'Staking through a stake.link vault' : m.name !== null ? shortAddress(m.address) : 'Chainlink staking v0.2 · Ethereum'],
      { fontSize: 24, marginTop: 14, color: COLORS.muted },
    ),
    h(
      'div',
      { style: { display: 'flex', marginTop: 40, paddingTop: 24, borderTop: '1px solid #1f2a3c' } },
      stat(formatCount(m.operators), 'operators staked'),
      stat(formatCompactCount(m.operatorTotal), 'LINK in the pool'),
      m.kind === 'unstaked' && m.stake !== null ? stat(formatCount(m.stake), 'its stake now') : null,
    ),
  );
}

/** One operator joining, leaving or unstaking; null when staking.json no longer lists the event. */
export async function operatorTree(address: string, at: number, inputs: BroadcastInputs): Promise<VNode | null> {
  const staking = await inputs.load('staking.json');
  const m = operatorMomentFacts(staking, address, at);
  if (m === null) return null;
  const day = m.ts.slice(0, 10);
  return broadcastFrame({
    background: background(stakingHiveSvg(staking, dayNumber(day), { kind: 'one', color: MARK[m.kind] })),
    eyebrow: `Chainlink staking · ${cardDay(day)}`,
    body: operatorBody(m),
    insight: ['Community pool: ', bold(`${formatCompactCount(staking.community.total)} LINK`), ` · ${formatCount(staking.community.stakers)} stakers`],
    cta: STAKING_CTA,
  });
}
