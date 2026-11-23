import {
  allTimeTotal, dayTotalsFacts, passportArrivalLines, passportChangeText, passportSlug, passportSummaryParts, RECORD_TOTAL, recordDriver, recordValueText,
  weekTotalsFacts, type BroadcastTarget, type RecordDriver, type TotalMetric,
} from '@ccip-dev/core/broadcasts';
import { dataSharePct, formatCompactCount, formatCount, formatFeeTotal, formatLink, formatLinkAmount, formatShare, formatUsd, formatUtcDay } from '@ccip-dev/core/format';
import { chainName, chainNameMap, laneLabel, shortAddress, type ChainNames } from '@ccip-dev/core/names';
import type { DayLeaders, Leader } from '@ccip-dev/core/public';
import type { PassportEvent } from '@ccip-dev/core/public-passport';
import { formatThresholdUsd, recordsSetOn, trackedMilestones, type MilestoneMetric, type RecordKind, type RecordSet } from '@ccip-dev/core/records';
import { addDays } from '@ccip-dev/core/time';
import { viaTokenMark } from '../../src/lib/senders';
import { h, type Child, type VNode } from '../h';
import { moversTree, spotlightTree } from './board-cards';
import {
  bigSize, bigText, bold, boldArrows, broadcastFrame, cardDay, cardWeek, COLORS, deltaStat, eyebrow, feeBars, hasReplayDay, iconsFor, MILESTONE_TITLES, MOMENT_COLUMN_WIDTH,
  momentColumn, mutedStat, namesOf, nameSize, pill, PILLS, row, skyFor, statsPanel, TEXT_COLUMN, type BroadcastInputs,
} from './broadcast-frame';
import { messageCount } from './content';
import { ctaFor, RECORDS_CTA } from './cta';
import { glyph, withArrows } from './glyphs';
import { countdownTree, welcomeTree } from './moment-cards';
import { skyNodes } from './orbit-sky';
import type { PassportInputs } from './passport-card';
import { pegTree } from './peg-card';
import { newcomerTree, projectSpotlightTree } from './project-cards';
import { reserveTree } from './reserve-card';
import { operatorTree, stakingTree } from './staking-cards';
import { pollTree, roundupTree } from './week-cards';

export const RECORD_TITLES: Record<RecordKind, string> = {
  messages: 'Most messages in a day',
  value: 'Most value moved in a day',
  fees: 'Most fees paid to CCIP in a day',
  largest_fee: 'Largest single fee',
  link_share: 'Highest share of fees paid in LINK',
};

const addressOf = (key: string) => key.slice(key.indexOf(':') + 1);

function leaderCell(label: string, name: string, value: string, note: string | null = null): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: 153 } },
    h('div', { style: { fontSize: 14, fontWeight: 700, letterSpacing: 2, color: COLORS.muted, textTransform: 'uppercase' } }, label),
    h('div', { style: { fontSize: 20, fontWeight: 700, marginTop: 4, maxWidth: 145, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, name),
    h('div', { style: { fontSize: 18, color: COLORS.muted, marginTop: 2, maxWidth: 145, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, value),
    note === null
      ? null
      : h('div', { style: { fontSize: 14, color: COLORS.muted, marginTop: 2, maxWidth: 145, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, note),
  );
}

const SENDER_FIGURE_MAX = 15;

/** "319 msgs · 20%"; no share (a leader from before identities) reads "319 msgs", and a figure too wide for the cell drops to "12.3K · 4.8%". */
function senderFigure(l: Leader): string {
  const share = l.share_pct === undefined || l.share_pct === null ? '' : ` · ${formatShare(l.share_pct)}`;
  const full = `${formatCount(l.messages)} msgs${share}`;
  return full.length <= SENDER_FIGURE_MAX ? full : `${formatCompactCount(l.messages)}${share}`;
}

const SENDER_MARK_MAX = 20;

/** The via-token mark at 14px in a 145px cell, with the count compact when the full mark would not fit. */
function senderMark(l: Leader): string | null {
  const full = viaTokenMark(l);
  return full !== null && full.length > SENDER_MARK_MAX ? viaTokenMark(l, formatCompactCount) : full;
}

function leadersRow(lead: DayLeaders, names: ChainNames): VNode {
  return h(
    'div',
    { style: { display: 'flex', marginTop: 18, paddingTop: 14, borderTop: '1px solid #1f2a3c' } },
    lead.token ? leaderCell('Top token', lead.token.label ?? shortAddress(addressOf(lead.token.key)), formatUsd(lead.token.usd)) : null,
    lead.sender ? leaderCell('Top sender', lead.sender.label ?? shortAddress(addressOf(lead.sender.key)), senderFigure(lead.sender), senderMark(lead.sender)) : null,
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

/** "CRE workflows: 30 messages (20%)"; null when no message was sent by a CRE workflow, or the history rows predate counting them. */
function creLine(messages: number, creMessages: number): string | null {
  if (creMessages <= 0 || messages <= 0) return null;
  return `CRE workflows: ${messageCount(creMessages)} (${formatShare((creMessages / messages) * 100)})`;
}

const mutedLine = (text: string, marginTop: number) => h('div', { style: { fontSize: 18, color: COLORS.muted, marginTop } }, text);

/** The data share and the CRE line share one row, as the stats panel has no height to spare for another. */
function dayMetaRow(dataShare: number | null, cre: string | null): VNode | null {
  const data = dataShare === null ? null : `${formatShare(dataShare)} data`;
  if (cre === null) return data === null ? null : mutedLine(data, 12);
  return h(
    'div',
    { style: { display: 'flex', justifyContent: 'space-between', marginTop: 12 } },
    data === null ? null : mutedLine(data, 0),
    mutedLine(cre, 0),
  );
}

function dayFooter(dataShare: number | null, leaders: VNode, cre: string | null): VNode {
  return h('div', { style: { display: 'flex', flexDirection: 'column' } }, dayMetaRow(dataShare, cre), leaders);
}

function weekFooter(bars: VNode, cre: string | null): VNode {
  return cre === null ? bars : h('div', { style: { display: 'flex', flexDirection: 'column' } }, bars, mutedLine(cre, 12));
}

async function dailyTree(day: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const totals = dayTotalsFacts(history.days, day);
  const lead = leaders.days.find((d) => d.day === day);
  const dayRow = history.days.find((d) => d.day === day);
  if (totals === null || lead === undefined || !hasReplayDay(replay, day)) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, day, day, {}, { cre: true });
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
      dayFooter(dayRow ? dataSharePct(dayRow.messages, dayRow.data_messages) : null, leadersRow(lead, names), dayRow ? creLine(dayRow.messages, dayRow.cre_messages ?? 0) : null),
    ),
    insight: record ? recordInsight(record) : laneInsight(lead.lane, names),
    cta: ctaFor(day),
  });
}

async function weeklyTree(monday: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, leaders, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('day-leaders.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const totals = weekTotalsFacts(history.days, monday);
  const week = leaders.weeks.find((w) => w.week === monday);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const complete = weekDays.every((d) => history.days.some((x) => x.day === d));
  if (!complete || totals === null || week === undefined || !hasReplayDay(replay, addDays(monday, 6))) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, monday, addDays(monday, 6), {}, { cre: true });
  const weekRows = history.days.filter((d) => weekDays.includes(d.day));
  const sumOf = (pick: (d: (typeof weekRows)[number]) => number) => weekRows.reduce((sum, d) => sum + pick(d), 0);
  const cre = creLine(sumOf((d) => d.messages), sumOf((d) => d.cre_messages ?? 0));
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
      weekFooter(feeBars(totals.feesByDay), cre),
    ),
    insight: feeChainsInsight(week.fee_chains, names),
    // The fee chains fill the strip, so the call to action shows only its address, as in the weekly mockup.
    cta: { ...ctaFor(monday), lead: '' },
  });
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

const COLUMN_WIDTH = 660;

/** A line that stays inside the text column and wraps instead of running into the sky. */
const columnRow = (children: readonly Child[], style: Record<string, unknown>) =>
  row(children, { marginTop: 10, alignSelf: 'flex-start', maxWidth: COLUMN_WIDTH, flexWrap: 'wrap', ...style });

/** A space sitting first in a text piece next to a bold one renders wider than the space before the bold, so spaces trail instead. */
function previousLine(r: RecordSet): VNode {
  const days = `${formatCount(r.stoodDays)} day${r.stoodDays === 1 ? '' : 's'}`;
  return columnRow(['Previous record ', bold(`${recordValueText(r.kind, r.previous.value)} `), `on ${formatUtcDay(r.previous.day)} · stood ${days}`], { fontSize: 26, color: COLORS.muted });
}

/** The route, with a trailing piece glued to its last chain so the two wrap together and the tail never starts a line. */
function routeWithTail(route: string, tail: string): VNode {
  const parts = withArrows(route, 20, COLORS.strong);
  const last = parts.pop();
  const closing = row([last ?? '', h('span', { style: { color: COLORS.soft, fontWeight: 400 } }, tail)], { flexShrink: 0 });
  return row([...parts, closing], { color: COLORS.strong, fontWeight: 700, maxWidth: COLUMN_WIDTH, flexWrap: 'wrap' });
}

function driverLine(r: RecordSet, d: RecordDriver | null, names: ChainNames): VNode | null {
  if (d === null) return null;
  const style = { fontSize: 24, color: COLORS.soft };
  if (r.kind === 'largest_fee') return columnRow(['Paid on ', routeWithTail(laneLabel(names, d.lane), d.symbol ? `, paid in ${d.symbol}` : '')], style);
  const lane = boldArrows(laneLabel(names, d.lane), 20, { maxWidth: COLUMN_WIDTH, flexWrap: 'wrap' });
  return columnRow(['Driven by ', lane, r.kind === 'value' ? `: ${formatUsd(d.usd)} moved` : `: ${formatCount(d.messages)} messages`], style);
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
  if (record === undefined || !hasReplayDay(replay, day)) return null;
  const names = namesOf(replay, chains);
  const driver = recordDriver(record, leaders.days.find((d) => d.day === day) ?? null, largest);
  const sky = skyFor(replay, names, day, day, { dim: true, gold: driver ? (driver.lane.split('>')[0] ?? null) : null, starFree: [TEXT_COLUMN] });
  const metric = RECORD_TOTAL[kind];
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `New all-time record · ${cardDay(day)}`,
    body: headlineBody({ pill: 'NEW RECORD', title: RECORD_TITLES[kind], value: recordValueText(kind, record.value), lines: [previousLine(record), driverLine(record, driver, names)] }),
    insight: allTimeInsight(metric, allTimeTotal(metric, history.days, day)),
    cta: RECORDS_CTA,
  });
}

async function milestoneTree(metric: MilestoneMetric, threshold: number, inputs: BroadcastInputs): Promise<VNode | null> {
  const [history, replay, chains] = await Promise.all([inputs.load('history.json'), inputs.load('replay.json'), inputs.load('chains.json')]);
  const milestone = trackedMilestones(history.days).find((m) => m.metric === metric && m.threshold === threshold);
  if (milestone === undefined || !hasReplayDay(replay, milestone.day)) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, milestone.day, milestone.day, { dim: true, starFree: [TEXT_COLUMN] });
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Milestone · ${cardDay(milestone.day)}`,
    body: headlineBody({
      pill: 'MILESTONE',
      title: MILESTONE_TITLES[metric],
      value: metric === 'messages' ? formatCount(threshold) : formatThresholdUsd(threshold),
      lines: [columnRow([`Crossed on ${formatUtcDay(milestone.day)}`], { fontSize: 26, color: COLORS.muted })],
    }),
    insight: allTimeInsight(metric, allTimeTotal(metric, history.days, milestone.day)),
    cta: RECORDS_CTA,
  });
}

/** A token record shows this many of its lines and counts the rest, so the column never runs into the strip. */
const PASSPORT_LINES_SHOWN = 3;

function passportTokenLines(event: Extract<PassportEvent, { kind: 'token' }>, names: ChainNames): string[] {
  return [
    ...event.changes.map((ch) => passportChangeText(ch, names)),
    ...event.arrivals.flatMap((a) => passportArrivalLines({ kind: a.kind, chains: a.chains, otherChainFlags: a.other_chain_flags }, names)),
  ];
}

function passportBody(event: PassportEvent, names: ChainNames): VNode {
  const line = (text: string) => h('div', { style: { display: 'flex', maxWidth: MOMENT_COLUMN_WIDTH, marginTop: 10, fontSize: 22, lineHeight: 1.3, color: COLORS.soft } }, text);
  if (event.kind === 'summary') {
    const tokens = `${formatCount(event.tokens.length)} more token${event.tokens.length === 1 ? '' : 's'}`;
    const { raised, cleared, new_token: newToken, new_chain: newChain } = event.counts;
    return momentColumn(pill('TOKEN PASSPORT', PILLS.welcome), bigText(tokens, nameSize(tokens)), ...passportSummaryParts({ raised, cleared, newToken, newChain }).map(line));
  }
  const lines = passportTokenLines(event, names);
  const rest = lines.length - PASSPORT_LINES_SHOWN;
  return momentColumn(
    pill('TOKEN PASSPORT', PILLS.welcome),
    bigText(event.name, nameSize(event.name)),
    ...lines.slice(0, PASSPORT_LINES_SHOWN).map(line),
    rest > 0 ? line(`And ${formatCount(rest)} more on the token's page`) : null,
  );
}

/**
 * KTD22: a post record's card, drawn from the record as passport-events.json holds it and never from the token's current
 * page, so a sent post's card does not change. null for an id the file does not hold.
 */
async function passportPostTree(id: string, inputs: PassportInputs): Promise<VNode | null> {
  const [file, chains] = await Promise.all([inputs.loadPassport('passport-events.json'), inputs.load('chains.json')]);
  const event = file.events.find((e) => e.id === id);
  if (event === undefined) return null;
  const names = chainNameMap(chains.chains);
  return broadcastFrame({
    background: [],
    eyebrow: `Token Passport · ${cardDay(event.day)}`,
    body: passportBody(event, names),
    insight: event.kind === 'token' ? ['On ', bold(event.chains.map((c) => chainName(names, c)).join(' · '))] : ['Each token is listed under Latest changes'],
    cta: event.kind === 'token' ? { lead: '', path: `ccip.dev/passport/${passportSlug(event.token_id)}` } : { lead: 'Latest changes:', path: 'ccip.dev/passport' },
  });
}

/** Only a Passport post's card reads the passport files, so only it needs their loader. */
type BroadcastTreeInputs = BroadcastInputs & Partial<Pick<PassportInputs, 'loadPassport'>>;

/** null when the published data has no such card: the route answers 404 and nothing is posted. */
export async function broadcastTree(target: BroadcastTarget, inputs: BroadcastTreeInputs): Promise<VNode | null> {
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
    case 'welcome':
      return welcomeTree(target.selector, inputs);
    case 'newcomer':
      return newcomerTree(target.key, inputs);
    case 'countdown':
      return countdownTree(target.metric, target.threshold, inputs);
    case 'movers':
      return moversTree(target.monday, inputs);
    case 'spotlight':
      return spotlightTree(target.monday, inputs);
    case 'project':
      return projectSpotlightTree(target.monday, inputs);
    case 'roundup':
      return roundupTree(target.monday, inputs);
    case 'poll':
      return pollTree(target.monday, inputs);
    case 'staking':
      return stakingTree(target.monday, inputs);
    case 'operator':
      return operatorTree(target.address, target.at, inputs);
    case 'peg':
      return pegTree({ episode: target.episode, phase: target.phase }, inputs);
    case 'passport': {
      const { loadPassport } = inputs;
      if (loadPassport === undefined) throw new Error('a Token Passport post card needs the passport file loader');
      return passportPostTree(target.id, { ...inputs, loadPassport });
    }
  }
}
