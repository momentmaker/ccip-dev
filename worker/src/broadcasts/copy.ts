import { addDays } from '@ccip-dev/core';
import { recordValueText } from '@ccip-dev/core/broadcasts';
import { formatCompactCount, formatCount, formatFeeTotal, formatLinkAmount, formatPct, formatShare, formatUsd } from '@ccip-dev/core/format';
import type { RecordKind } from '@ccip-dev/core/records';
import type { BroadcastFacts, DailyFacts, LeaderFacts, MilestoneFacts, RecordFacts, ReserveFacts, WeeklyFacts } from './facts';
import type { Player } from './tags';
import { xLength } from './x-length';

export const X_MAX = 280;
export const TELEGRAM_CAPTION_MAX = 1024;

/** A line of a post. When the post is too long, lines with a drop rank go, lowest rank first; the others always stay. */
export interface Line {
  text: string;
  drop?: number;
}

export const DROP = { lane: 1, sender: 2, token: 3, feeChains: 4, closing: 5 } as const;

export function fitLines(lines: readonly Line[], fits: (text: string) => boolean): string {
  const join = (kept: readonly Line[]) => kept.map((l) => l.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const ranks = [...new Set(lines.flatMap((l) => (l.drop === undefined ? [] : [l.drop])))].sort((a, b) => a - b);
  let kept = [...lines];
  if (fits(join(kept))) return join(kept);
  for (const rank of ranks) {
    kept = kept.filter((l) => l.drop !== rank);
    if (fits(join(kept))) return join(kept);
  }
  throw new Error(`the post does not fit even without its droppable lines: ${join(kept).slice(0, 60)}…`);
}

const DOMAIN = /[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

/**
 * X and Telegram turn a name like "pump.fun" into a link; a one-dot leader (U+2024) looks the same and links nothing.
 * A zero-width space after "@" and after the colon of "://" stops an untrusted name from mentioning anyone or opening a link.
 */
export function noLinks(name: string): string {
  return name
    .replace(DOMAIN, (m) => m.replaceAll('.', '\u2024'))
    .replaceAll('@', '@\u200b')
    .replaceAll('://', ':\u200b//');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xName = (p: Player) => (p.x ? `@${p.x}` : noLinks(p.name));
export const tgName = (p: Player) => escapeHtml(noLinks(p.name));
export const tgText = (s: string) => escapeHtml(noLinks(s));

const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const WEEKDAY = utc({ weekday: 'short', month: 'short', day: 'numeric' });
const WEEKDAY_YEAR = utc({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const MONTH_DAY = utc({ month: 'short', day: 'numeric' });
const date = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
export const postDay = (day: string) => WEEKDAY.format(date(day));
export const longDay = (day: string) => WEEKDAY_YEAR.format(date(day));
export const shortDay = (day: string) => MONTH_DAY.format(date(day));

export function weekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  return monday.slice(0, 7) === sunday.slice(0, 7) ? `${shortDay(monday)}–${Number(sunday.slice(8))}` : `${shortDay(monday)} – ${shortDay(sunday)}`;
}

export const arrow = (pct: number | null) => (pct === null ? null : `${pct >= 0 ? '▲' : '▼'} ${formatShare(Math.abs(pct))}`);
const words = (...parts: (string | null)[]) => parts.filter((p): p is string => p !== null && p !== '').join(' ');
const paren = (s: string | null) => (s === null ? '' : ` (${s})`);
export const bold = (s: string) => `<b>${s}</b>`;
export const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;
const millions = (link: number) => `${formatCount(link / 1_000_000)}M`;
const present = (parts: (string | null)[]) => parts.filter((s): s is string => s !== null);

function leaderLinesX(l: LeaderFacts): Line[] {
  const lines: Line[] = [];
  if (l.token) {
    const share = l.token.sharePct === null ? '' : ` (${formatShare(l.token.sharePct)})`;
    const project = l.token.project ? xName(l.token.project) : null;
    lines.push({ text: words(`Top token: $${noLinks(l.token.symbol)}`, project, `· ${formatUsd(l.token.usd)}${share}`), drop: DROP.token });
  }
  if (l.sender) lines.push({ text: `Top sender: ${xName(l.sender.player)} · ${plural(l.sender.messages, 'message')}`, drop: DROP.sender });
  if (l.lane) lines.push({ text: `Busiest lane: ${xName(l.lane.src)} → ${xName(l.lane.dst)} · ${formatUsd(l.lane.usd)}`, drop: DROP.lane });
  return lines;
}

function leaderLinesTg(l: LeaderFacts): Line[] {
  const lines: Line[] = [];
  if (l.token) {
    const project = l.token.project ? ` (${tgName(l.token.project)})` : '';
    const share = l.token.sharePct === null ? '' : `, ${formatShare(l.token.sharePct)} of the value moved`;
    lines.push({ text: `Top token: ${tgText(l.token.symbol)}${project} · ${formatUsd(l.token.usd)}${share}`, drop: DROP.token });
  }
  if (l.sender) lines.push({ text: `Top sender: ${tgName(l.sender.player)} · ${plural(l.sender.messages, 'message')}`, drop: DROP.sender });
  if (l.lane) lines.push({ text: `Busiest lane: ${tgName(l.lane.src)} → ${tgName(l.lane.dst)} · ${formatUsd(l.lane.usd)}`, drop: DROP.lane });
  return lines;
}

function feesX(fees: number | null, change: string | null, sharePct: number | null): Line[] {
  if (fees === null) return [];
  return [{ text: words(`${formatFeeTotal(fees)} in fees`, change, sharePct === null ? null : `· ${formatShare(sharePct)} paid in $LINK`) }];
}

function feesTg(fees: number | null, change: string | null, sharePct: number | null, linkUsd: number | null, amount: number | null): Line[] {
  if (fees === null) return [];
  const paid = present([linkUsd === null ? null : formatFeeTotal(linkUsd), amount === null ? null : formatLinkAmount(amount)]);
  const link = sharePct === null ? '' : ` · ${formatShare(sharePct)} paid in LINK${paid.length === 0 ? '' : ` (${paid.join(', ')})`}`;
  return [{ text: `${formatFeeTotal(fees)} in fees${paren(change)}${link}` }];
}

function dailyX(f: DailyFacts): Line[] {
  const t = f.totals;
  return [
    { text: `#CCIP · ${postDay(f.day)}` },
    { text: `${plural(t.messages.value ?? 0, 'message')} · ${formatUsd(t.value.value)} moved` },
    ...feesX(t.fees.value, null, t.linkSharePct),
    ...leaderLinesX(f.leaders),
    { text: '#Chainlink', drop: DROP.closing },
  ];
}

function dailyTg(f: DailyFacts): Line[] {
  const t = f.totals;
  const vsAverage = arrow(t.messages.pct);
  return [
    { text: bold(`CCIP daily report · ${longDay(f.day)}`) },
    { text: `${plural(t.messages.value ?? 0, 'message')}${paren(vsAverage === null ? null : `${vsAverage} vs the 7-day average`)}` },
    { text: `${formatUsd(t.value.value)} moved${paren(arrow(t.value.pct))}` },
    ...feesTg(t.fees.value, arrow(t.fees.pct), t.linkSharePct, t.linkUsd, t.linkAmount),
    { text: '' },
    ...leaderLinesTg(f.leaders),
    ...(f.feeChain ? [{ text: `Top fee chain: ${tgName(f.feeChain.player)} · ${formatFeeTotal(f.feeChain.feeUsd)} in fees`, drop: DROP.lane }] : []),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function weeklyX(f: WeeklyFacts): Line[] {
  const t = f.totals;
  return [
    { text: `#CCIP this week · ${weekRange(f.monday)}` },
    { text: words(plural(t.messages.value ?? 0, 'message'), arrow(t.messages.pct), `· ${formatUsd(t.value.value)} moved`, arrow(t.value.pct)) },
    ...feesX(t.fees.value, arrow(t.fees.pct), t.linkSharePct),
    ...leaderLinesX(f.leaders),
    ...(f.feeChains.length > 0 ? [{ text: `Top fee chains: ${f.feeChains.map((c) => xName(c.player)).join(' · ')}`, drop: DROP.feeChains }] : []),
    { text: '#Chainlink', drop: DROP.closing },
  ];
}

function weeklyTg(f: WeeklyFacts): Line[] {
  const t = f.totals;
  const vsLast = arrow(t.messages.pct);
  const chains = f.feeChains.map((c) => `${tgName(c.player)} ${formatFeeTotal(c.feeUsd)}`).join(' · ');
  return [
    { text: bold(`CCIP weekly report · ${weekRange(f.monday)}, ${t.sunday.slice(0, 4)}`) },
    { text: `${plural(t.messages.value ?? 0, 'message')}${paren(vsLast === null ? null : `${vsLast} vs last week`)}` },
    { text: `${formatUsd(t.value.value)} moved${paren(arrow(t.value.pct))}` },
    ...feesTg(t.fees.value, arrow(t.fees.pct), t.linkSharePct, t.linkUsd, t.linkAmount),
    { text: '' },
    ...leaderLinesTg(f.leaders),
    ...(f.feeChains.length > 0 ? [{ text: `Top fee chains: ${chains}`, drop: DROP.feeChains }] : []),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

const HEADLINE: Record<RecordKind, (value: string, link: string) => string> = {
  messages: (v) => `${v} messages in one day`,
  value: (v) => `${v} moved in one day`,
  fees: (v) => `${v} in fees in one day`,
  largest_fee: (v) => `${v}, the largest single fee ever`,
  link_share: (v, link) => `${v} of fees paid in ${link} in one day`,
};

function driverLine(f: RecordFacts, name: (p: Player) => string, text: (s: string) => string): Line[] {
  if (!f.driver || !f.route) return [];
  const lane = `${name(f.route.src)} → ${name(f.route.dst)}`;
  const line =
    f.record.kind === 'value'
      ? `Driven by ${lane} · ${formatUsd(f.driver.usd)}`
      : f.record.kind === 'largest_fee'
        ? `Paid on ${lane}${f.driver.symbol ? ` in ${text(f.driver.symbol)}` : ''}`
        : `Driven by ${lane} · ${plural(f.driver.messages, 'message')}`;
  return [{ text: line, drop: DROP.lane }];
}

function recordX(f: RecordFacts): Line[] {
  const r = f.record;
  return [
    { text: `🚨 New all-time high for #CCIP: ${HEADLINE[r.kind](recordValueText(r.kind, r.value), '$LINK')}` },
    { text: `Previous record: ${recordValueText(r.kind, r.previous.value)} (${shortDay(r.previous.day)}), held for ${plural(r.stoodDays, 'day')}` },
    ...driverLine(f, xName, noLinks),
    { text: '@chainlink $LINK', drop: DROP.closing },
  ];
}

function recordTg(f: RecordFacts): Line[] {
  const r = f.record;
  return [
    { text: bold('New all-time high for CCIP') },
    { text: `${HEADLINE[r.kind](recordValueText(r.kind, r.value), 'LINK')}, on ${longDay(r.day)}` },
    { text: `Previous record: ${recordValueText(r.kind, r.previous.value)} on ${longDay(r.previous.day)}, held for ${plural(r.stoodDays, 'day')}` },
    ...driverLine(f, tgName, tgText),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function milestoneX(f: MilestoneFacts): Line[] {
  return [
    { text: `🏁 New milestone for #CCIP: ${f.milestone.label} all time` },
    { text: `Reached on ${postDay(f.milestone.day)}` },
    { text: '@chainlink $LINK', drop: DROP.closing },
  ];
}

function milestoneTg(f: MilestoneFacts): Line[] {
  return [
    { text: bold('New milestone for CCIP') },
    { text: `${escapeHtml(f.milestone.label)} all time, reached on ${longDay(f.milestone.day)}` },
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function reserveX(f: ReserveFacts): Line[] {
  const d = f.deposit;
  const pace = present([
    `Now ${formatCompactCount(d.balanceLink)} LINK`,
    d.streak >= 2 ? `${formatCount(d.streak)} weekly deposits in a row` : null,
    d.nextMilestone ? `on pace for ${millions(d.nextMilestone.link)} around ${shortDay(d.nextMilestone.eta)}` : null,
  ]);
  return [
    { text: `The Chainlink Reserve just added ${formatCount(d.link)} $LINK${paren(d.usdAtDeposit === null ? null : formatUsd(d.usdAtDeposit))}` },
    { text: pace.join(' · ') },
    { text: '@chainlink #CCIP', drop: DROP.closing },
  ];
}

function reserveTg(f: ReserveFacts): Line[] {
  const d = f.deposit;
  const added = present([
    `+${formatCount(d.link)} LINK`,
    d.usdAtDeposit === null ? null : `${formatUsd(d.usdAtDeposit)} at deposit`,
    d.usdNow === null ? null : `${formatUsd(d.usdNow)} today${paren(d.changePct === null ? null : formatPct(d.changePct))}`,
  ]);
  return [
    { text: bold('New deposit into the Chainlink Reserve') },
    { text: added.join(' · ') },
    { text: `Now ${formatCompactCount(d.balanceLink)} LINK held${d.streak >= 2 ? ` · ${formatCount(d.streak)} weekly deposits in a row` : ''}` },
    ...(d.avgWeeklyLink === null ? [] : [{ text: `${d.averageWeeks}-week average: ${formatCount(d.avgWeeklyLink)} LINK a week${paren(d.avgWeeklyUsd === null ? null : formatUsd(d.avgWeeklyUsd))}` }]),
    ...(d.nextMilestone ? [{ text: `On pace for ${millions(d.nextMilestone.link)} LINK around ${longDay(d.nextMilestone.eta)}` }] : []),
    { text: '' },
    { text: '#CCIP #Chainlink $LINK', drop: DROP.closing },
  ];
}

function xLines(f: BroadcastFacts): Line[] {
  switch (f.kind) {
    case 'daily':
      return dailyX(f);
    case 'weekly':
      return weeklyX(f);
    case 'record':
      return recordX(f);
    case 'milestone':
      return milestoneX(f);
    case 'reserve':
      return reserveX(f);
  }
}

function telegramLines(f: BroadcastFacts): Line[] {
  switch (f.kind) {
    case 'daily':
      return dailyTg(f);
    case 'weekly':
      return weeklyTg(f);
    case 'record':
      return recordTg(f);
    case 'milestone':
      return milestoneTg(f);
    case 'reserve':
      return reserveTg(f);
  }
}

export interface Copy {
  xText: string;
  telegramHtml: string;
}

/** Telegram counts its 1,024 after removing tags; measuring the raw HTML is stricter, so a caption that passes here always fits. */
export function composeCopy(facts: BroadcastFacts): Copy {
  return {
    xText: fitLines(xLines(facts), (t) => xLength(t) <= X_MAX),
    telegramHtml: fitLines(telegramLines(facts), (t) => t.length <= TELEGRAM_CAPTION_MAX),
  };
}
