import {
  allTimeTotal, dayTotalsFacts, RECORD_TOTAL, recordDriver, recordValueText, weekTotalsFacts, type BroadcastTarget, type RecordDriver, type TotalMetric,
} from '@ccip-dev/core/broadcasts';
import { formatCount, formatFeeTotal, formatLink, formatLinkAmount, formatShare, formatUsd, formatUtcDay } from '@ccip-dev/core/format';
import { chainName, chainNameMap, laneLabel, shortAddress, type ChainNames } from '@ccip-dev/core/names';
import type { DayLeaders, Leader, PublicFile, PublicFileName, ReplayFile } from '@ccip-dev/core/public';
import { formatThresholdUsd, recordsSetOn, trackedMilestones, type MilestoneMetric, type RecordKind, type RecordSet } from '@ccip-dev/core/records';
import { addDays } from '@ccip-dev/core/time';
import { windowWeights } from '../../src/sky/weights';
import { h, type Child, type VNode } from '../h';
import { bold, boldArrows, broadcastFrame, cardDay, COLORS, date, dayNumber, deltaStat, eyebrow, feeBars, MONTH_DAY, mutedStat, row, statsPanel } from './broadcast-frame';
import { ctaFor, RECORDS_CTA } from './cta';
import { glyph } from './glyphs';
import { orbitSky, skyNodes, type OrbitSky } from './orbit-sky';
import { reserveTree } from './reserve-card';

export interface BroadcastInputs {
  load: <N extends PublicFileName>(name: N) => Promise<PublicFile<N>>;
  icon: (selector: string) => Promise<string | null>;
}

export const RECORD_TITLES: Record<RecordKind, string> = {
  messages: 'Most messages in a day',
  value: 'Most value moved in a day',
  fees: 'Most fees paid to CCIP in a day',
  largest_fee: 'Largest single fee',
  link_share: 'Highest share of fees paid in LINK',
};

/** "Oct 5 – 11, 2026", or "Sep 28 – Oct 4, 2026" across a month. */
export function cardWeek(monday: string): string {
  const sunday = addDays(monday, 6);
  const end = monday.slice(0, 7) === sunday.slice(0, 7) ? String(Number(sunday.slice(8))) : MONTH_DAY.format(date(sunday));
  return `${MONTH_DAY.format(date(monday))} – ${end}, ${sunday.slice(0, 4)}`;
}

export async function iconsFor(sky: OrbitSky, icon: BroadcastInputs['icon']): Promise<Map<string, string | null>> {
  return new Map(await Promise.all(sky.coins.map(async (c) => [c.selector, await icon(c.selector)] as const)));
}

export const namesOf = (replay: ReplayFile, chains: PublicFile<'chains.json'>): ChainNames => chainNameMap([...replay.chains, ...chains.chains]);

/** The day's (or week's) chains and lanes from replay.json, around the busiest chain. */
export function skyFor(replay: ReplayFile, names: ChainNames, from: string, to: string, extra: { dim?: boolean; gold?: string | null } = {}): OrbitSky {
  const weights = windowWeights(replay, from, to);
  return orbitSky({
    chains: [...weights.chains].map(([selector, value]) => ({ selector, value, name: chainName(names, selector) })),
    lanes: weights.lanes,
    seed: dayNumber(to),
    ...extra,
  });
}

const addressOf = (key: string) => key.slice(key.indexOf(':') + 1);

function leaderCell(label: string, name: string, value: string): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: 153 } },
    h('div', { style: { fontSize: 14, fontWeight: 700, letterSpacing: 2, color: COLORS.muted, textTransform: 'uppercase' } }, label),
    h('div', { style: { fontSize: 20, fontWeight: 700, marginTop: 4, maxWidth: 145, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, name),
    h('div', { style: { fontSize: 18, color: COLORS.muted, marginTop: 2 } }, value),
  );
}

function leadersRow(lead: DayLeaders, names: ChainNames): VNode {
  return h(
    'div',
    { style: { display: 'flex', marginTop: 18, paddingTop: 14, borderTop: '1px solid #1f2a3c' } },
    lead.token ? leaderCell('Top token', lead.token.label ?? shortAddress(addressOf(lead.token.key)), formatUsd(lead.token.usd)) : null,
    lead.sender ? leaderCell('Top sender', lead.sender.label ?? shortAddress(addressOf(lead.sender.key)), `${formatCount(lead.sender.messages)} msgs`) : null,
    lead.fee_chain ? leaderCell('Top fee chain', chainName(names, lead.fee_chain.key), `${formatFeeTotal(lead.fee_chain.fee_usd)} fees`) : null,
  );
}

function laneInsight(lane: Leader | null, names: ChainNames): Child[] {
  return lane ? ['Busiest lane: ', boldArrows(laneLabel(names, lane.key)), ` · ${formatUsd(lane.usd)}`] : [];
}

function recordInsight(record: RecordSet): Child[] {
  return [glyph('star', 18, COLORS.gold, { right: 8 }), 'New record: ', bold(RECORD_TITLES[record.kind]), ` (${recordValueText(record.kind, record.value)})`];
}

function feeChainsInsight(chains: readonly Leader[], names: ChainNames): Child[] {
  if (chains.length === 0) return [];
  return ['Top fee chains: ', ...chains.flatMap((l, i): Child[] => [...(i > 0 ? [' · '] : []), bold(chainName(names, l.key)), ` ${formatFeeTotal(l.fee_usd)}`])];
}

async function dailyTree(day: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const totals = dayTotalsFacts(history.days, day);
  const lead = leaders.days.find((d) => d.day === day);
  if (totals === null || lead === undefined) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, day, day);
  const record = recordsSetOn(history.days, history.largest_fees ?? [], day)[0];
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Daily report · ${cardDay(day)}`,
    body: statsPanel(
      'Yesterday on CCIP',
      [
        deltaStat('Messages', formatCount(totals.messages.value), totals.messages.pct, ' vs 7d avg'),
        deltaStat('Value moved', formatUsd(totals.value.value), totals.value.pct, ''),
        deltaStat('Fees', formatFeeTotal(totals.fees.value), totals.fees.pct, ''),
        mutedStat('Paid in LINK', formatShare(totals.linkSharePct), formatLinkAmount(totals.linkAmount)),
      ],
      leadersRow(lead, names),
    ),
    insight: record ? recordInsight(record) : laneInsight(lead.lane, names),
    cta: ctaFor(day),
  });
}

async function weeklyTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const totals = weekTotalsFacts(history.days, monday);
  const week = leaders.weeks.find((w) => w.week === monday);
  if (totals === null || week === undefined) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, monday, addDays(monday, 6));
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Weekly report · ${cardWeek(monday)}`,
    body: statsPanel(
      'This week on CCIP',
      [
        deltaStat('Messages', formatCount(totals.messages.value), totals.messages.pct, ' vs last week'),
        deltaStat('Value moved', formatUsd(totals.value.value), totals.value.pct, ''),
        deltaStat('Fees', formatFeeTotal(totals.fees.value), totals.fees.pct, ''),
        mutedStat('Paid in LINK', formatShare(totals.linkSharePct), `${formatFeeTotal(totals.linkUsd)} in LINK`),
      ],
      feeBars(totals.feesByDay),
    ),
    insight: feeChainsInsight(week.fee_chains, names),
    // The fee chains fill the strip, so the call to action shows only its address, as in the weekly mockup.
    cta: { ...ctaFor(monday), lead: '' },
  });
}

export function bigSize(text: string): number {
  return text.length <= 7 ? 132 : text.length <= 10 ? 104 : 80;
}

function headlineBody(o: { pill: string; title: string; value: string; lines: (VNode | null)[] }): VNode {
  return h(
    'div',
    { style: { position: 'absolute', left: 52, top: 118, width: 660, display: 'flex', flexDirection: 'column' } },
    row([glyph('star', 18, '#1a1205', { right: 8 }), o.pill], {
      alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 999, backgroundImage: 'linear-gradient(90deg, #ffcf5a, #ff9f43)',
      color: '#1a1205', fontWeight: 800, fontSize: 20, letterSpacing: 3,
    }),
    eyebrow(o.title, { marginTop: 24 }),
    h('div', { style: { fontSize: bigSize(o.value), fontWeight: 800, letterSpacing: -4, lineHeight: 1.02, color: '#ffffff', textShadow: '0 0 40px rgba(255,207,90,0.35)' } }, o.value),
    ...o.lines,
  );
}

function previousLine(r: RecordSet): VNode {
  const days = `${formatCount(r.stoodDays)} day${r.stoodDays === 1 ? '' : 's'}`;
  return row(['Previous record ', bold(recordValueText(r.kind, r.previous.value)), ` on ${formatUtcDay(r.previous.day)} · stood ${days}`], { fontSize: 26, marginTop: 10, color: COLORS.muted, alignSelf: 'flex-start' });
}

function driverLine(r: RecordSet, d: RecordDriver | null, names: ChainNames): VNode | null {
  if (d === null) return null;
  const lane = boldArrows(laneLabel(names, d.lane), 20);
  const style = { fontSize: 24, marginTop: 10, color: COLORS.soft, alignSelf: 'flex-start' };
  if (r.kind === 'largest_fee') return row(['Paid on ', lane, d.symbol ? `, paid in ${d.symbol}` : ''], style);
  return row(['Driven by ', lane, r.kind === 'value' ? `: ${formatUsd(d.usd)} moved` : `: ${formatCount(d.messages)} messages`], style);
}

const ALL_TIME: Record<TotalMetric, [string, (v: number) => string]> = {
  messages: ['All-time messages now ', formatCount],
  value: ['All-time value moved now ', formatUsd],
  fees: ['All-time fees now ', formatFeeTotal],
  link_amount: ['All-time LINK paid in fees now ', formatLink],
};

function allTimeInsight(metric: TotalMetric, total: number): Child[] {
  const [lead, format] = ALL_TIME[metric];
  return [lead, bold(format(total))];
}

async function recordTree(kind: RecordKind, day: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const largest = history.largest_fees ?? [];
  const record = recordsSetOn(history.days, largest, day).find((r) => r.kind === kind);
  if (record === undefined) return null;
  const names = namesOf(replay, chains);
  const driver = recordDriver(record, leaders.days.find((d) => d.day === day) ?? null, largest);
  const sky = skyFor(replay, names, day, day, { dim: true, gold: driver ? (driver.lane.split('>')[0] ?? null) : null });
  const metric = RECORD_TOTAL[kind];
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `New all-time record · ${cardDay(day)}`,
    body: headlineBody({ pill: 'NEW RECORD', title: RECORD_TITLES[kind], value: recordValueText(kind, record.value), lines: [previousLine(record), driverLine(record, driver, names)] }),
    insight: allTimeInsight(metric, allTimeTotal(metric, history.days, day)),
    cta: RECORDS_CTA,
  });
}

const MILESTONE_TITLES: Record<MilestoneMetric, string> = {
  messages: 'All-time messages on CCIP',
  value: 'All-time value moved over CCIP',
  fees: 'All-time fees paid to CCIP',
};

async function milestoneTree(metric: MilestoneMetric, threshold: number, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const milestone = trackedMilestones(history.days).find((m) => m.metric === metric && m.threshold === threshold);
  if (milestone === undefined) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, milestone.day, milestone.day, { dim: true });
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Milestone · ${cardDay(milestone.day)}`,
    body: headlineBody({
      pill: 'MILESTONE',
      title: MILESTONE_TITLES[metric],
      value: metric === 'messages' ? formatCount(threshold) : formatThresholdUsd(threshold),
      lines: [row([`Crossed on ${formatUtcDay(milestone.day)}`], { fontSize: 26, marginTop: 10, color: COLORS.muted })],
    }),
    insight: allTimeInsight(metric, allTimeTotal(metric, history.days, milestone.day)),
    cta: RECORDS_CTA,
  });
}

/** null when the published data has no such card: the route answers 404 and nothing is posted. */
export async function broadcastTree(target: BroadcastTarget, inputs: BroadcastInputs): Promise<VNode | null> {
  switch (target.kind) {
    case 'daily':
      return dailyTree(target.day, inputs);
    case 'weekly':
      return weeklyTree(target.monday, inputs);
    case 'record':
      return recordTree(target.record, target.day, inputs);
    case 'milestone':
      return milestoneTree(target.metric, target.threshold, inputs);
    case 'reserve':
      return reserveTree(target.tx, inputs.load);
  }
}
