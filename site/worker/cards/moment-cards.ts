import { formatCount, formatUsd, formatUtcDay } from '@ccip-dev/core/format';
import type { Countdown } from '@ccip-dev/core/moments';
import { chainName } from '@ccip-dev/core/names';
import { formatProgressUsd, formatThresholdUsd, type MilestoneMetric } from '@ccip-dev/core/records';
import { addDays } from '@ccip-dev/core/time';
import { h, type Child, type VNode } from '../h';
import {
  bigSize, bigText, bold, broadcastFrame, cardDay, COLORS, columnLine, date, eyebrow, hasReplayDay, hubSky, iconsFor, loadMomentFiles, MILESTONE_TITLES, momentColumn,
  MONTH_DAY, nameSize, namesOf, pill, PILLS, row, skyFor, TEXT_COLUMN, type BroadcastInputs,
} from './broadcast-frame';
import { CHAINS_CTA, RECORDS_CTA } from './cta';
import { skyNodes } from './orbit-sky';

const BAR_WIDTH = 600;

/** A new chain gold at the hub of its own first day, linked to its first partners. */
export async function welcomeTree(selector: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const files = await loadMomentFiles(inputs);
  if (files === null) return null;
  const { moments, replay, chains } = files;
  const arrival = moments.arrivals.chains.find((c) => c.selector === selector);
  if (arrival === undefined || !hasReplayDay(replay, arrival.day)) return null;
  const names = namesOf(replay, chains);
  const sky = hubSky(replay, names, selector, arrival.day, arrival.day, { gold: selector, starFree: [TEXT_COLUMN] });
  const name = chainName(names, selector);
  const partners = arrival.partners.map((p) => chainName(names, p));
  const messages = `${formatCount(arrival.messages)} message${arrival.messages === 1 ? '' : 's'}`;
  // A first day that moved under $0.50 would read "$0 moved", so it names only its messages.
  const firstDay: Child[] = Math.round(arrival.usd) > 0 ? [bold(`${messages} `), '· ', bold(`${formatUsd(arrival.usd)} `), 'moved'] : [bold(messages)];
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `New chain · ${cardDay(arrival.day)}`,
    body: momentColumn(
      pill('WELCOME TO CCIP', PILLS.welcome, 'star'),
      eyebrow(`Chain #${arrival.number} on CCIP`, { marginTop: 24 }),
      bigText(name, nameSize(name)),
      columnLine(['First message ', bold(`${formatUtcDay(arrival.day)} `), ...(partners[0] ? ['with ', bold(partners[0])] : [])]),
      columnLine(['First day: ', ...firstDay], { fontSize: 24, color: COLORS.soft }),
    ),
    insight: partners.length === 0 ? [] : ['Connected to ', ...partners.slice(0, 3).flatMap((p, i): Child[] => [...(i > 0 ? [' · '] : []), bold(p)])],
    cta: CHAINS_CTA,
  });
}

const amount = (metric: MilestoneMetric, v: number) => (metric === 'messages' ? formatCount(v) : formatUsd(v));
const totalText = (metric: MilestoneMetric, v: number) => (metric === 'messages' ? formatCount(v) : formatProgressUsd(v));
const thresholdText = (metric: MilestoneMetric, v: number) => (metric === 'messages' ? formatCount(v) : formatThresholdUsd(v));

/** How far the total has come from the last milestone (or zero) to this one. */
function progressBar(c: Countdown): VNode {
  const from = c.previous?.threshold ?? 0;
  const share = Math.min(1, Math.max(0, (c.total - from) / (c.threshold - from)));
  const start = c.previous ? `${thresholdText(c.metric, from)} · ${MONTH_DAY.format(date(c.previous.day))}` : '0';
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', marginTop: 26, width: BAR_WIDTH } },
    h(
      'div',
      { style: { display: 'flex', width: BAR_WIDTH, height: 18, borderRadius: 9, backgroundColor: '#18202e', overflow: 'hidden' } },
      h('div', { style: { width: Math.max(18, Math.round(BAR_WIDTH * share)), height: 18, borderRadius: 9, backgroundImage: 'linear-gradient(90deg, #4a7ff0, #7de3ff)' } }),
    ),
    row(
      [h('span', { style: { color: COLORS.muted } }, start), h('span', { style: { color: COLORS.soft, fontWeight: 700 } }, `${totalText(c.metric, c.total)} now`), h('span', { style: { color: COLORS.muted } }, thresholdText(c.metric, c.threshold))],
      { justifyContent: 'space-between', width: BAR_WIDTH, fontSize: 20, marginTop: 8 },
    ),
  );
}

/** The next milestone, its days left at the last 7 days' pace, and the way there from the last one, as of moments.json. */
export async function countdownTree(metric: MilestoneMetric, threshold: number, inputs: BroadcastInputs): Promise<VNode | null> {
  const files = await loadMomentFiles(inputs);
  if (files === null) return null;
  const { moments, replay, chains } = files;
  const countdown = moments.countdowns.find((c) => c.metric === metric && c.threshold === threshold);
  const asOf = addDays(moments.updated_at.slice(0, 10), -1);
  if (countdown === undefined || !hasReplayDay(replay, asOf)) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, asOf, asOf, { dim: true, starFree: [TEXT_COLUMN] });
  const value = thresholdText(metric, threshold);
  const days = `${countdown.days_left} day${countdown.days_left === 1 ? '' : 's'}`;
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `Countdown · ${cardDay(moments.updated_at)}`,
    body: momentColumn(
      pill('COUNTDOWN', PILLS.violet),
      eyebrow(MILESTONE_TITLES[metric], { marginTop: 24 }),
      bigText(value, bigSize(value)),
      columnLine(['About ', bold(`${days} `), 'away at ', bold(`${amount(metric, countdown.per_day)} `), 'a day']),
      progressBar(countdown),
    ),
    insight: countdown.previous
      ? ['Last milestone: ', bold(thresholdText(metric, countdown.previous.threshold)), ` on ${formatUtcDay(countdown.previous.day)}`]
      : ['All-time now ', bold(totalText(metric, countdown.total))],
    cta: RECORDS_CTA,
  });
}
