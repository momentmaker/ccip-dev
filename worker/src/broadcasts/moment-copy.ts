import { addDays } from '@ccip-dev/core';
import { formatCount, formatFeeTotal, formatShare, formatUsd } from '@ccip-dev/core/format';
import { calledShare, type BoardName, type Countdown } from '@ccip-dev/core/moments';
import { formatThresholdUsd, type MilestoneMetric } from '@ccip-dev/core/records';
import type { Poll } from '@ccip-dev/core/public';
import { arrow, bold, fitLines, longDay, noLinks, plural, shortDay, TELEGRAM_CAPTION_MAX, tgName, tgText, weekRange, X_MAX, type Copy, type Line } from './copy';
import type { CountdownFacts, MomentFacts, Mover, MoverName, MoversFacts, PollFacts, RoundupFacts, SpotlightFacts, WelcomeFacts } from './moment-facts';
import type { Player } from './tags';
import { xLength } from './x-length';

/** When a moment post is too long, its detail line (climbers, partners) goes first, then its closing line. */
export const MOMENT_DROP = { detail: 1, closing: 2 } as const;
export const ROUNDUP_SHOWN = 5;

type Name = (p: Player) => string;

/**
 * The one account a moment's X post tags: the player the post is about, by its verified handle. X's automation rules ban
 * unsolicited @mentions, so every other player is a plain name (owner decision, 2026-10-12).
 */
const subject: Name = (p) => (p.x ? `@${p.x}` : noLinks(p.name));
const plain: Name = (p) => noLinks(p.name);
const fitsX = (text: string) => xLength(text) <= X_MAX;
const fitsTelegram = (text: string) => text.length <= TELEGRAM_CAPTION_MAX;
const CLOSING_TG = '#CCIP #Chainlink $LINK';

function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function shownList<T>(items: readonly T[], shown: number, render: (item: T) => string): string {
  const more = items.length - shown;
  return [...items.slice(0, shown).map(render), ...(more > 0 ? [`+${more} more`] : [])].join(' · ');
}

/** "Oct 5–9", or "Sep 28 – Oct 2" across a month. */
function dayRange(from: string, to: string): string {
  return from.slice(0, 7) === to.slice(0, 7) ? `${shortDay(from)}–${Number(to.slice(8))}` : `${shortDay(from)} – ${shortDay(to)}`;
}

/** A first day that moved under $0.50 would read "$0 moved", so it names only its messages. */
const firstDayUsd = (usd: number) => (Math.round(usd) > 0 ? formatUsd(usd) : null);

function welcomeX(f: WelcomeFacts): Line[] {
  const partner = f.partners[0] ? `, with ${plain(f.partners[0])}` : '';
  const moved = firstDayUsd(f.usd);
  return [
    { text: `🎉 Welcome to #CCIP, ${subject(f.chain)}` },
    { text: `Chain #${f.number} on CCIP: first message on ${shortDay(f.day)}${partner}` },
    { text: `First day: ${plural(f.messages, 'message')}${moved === null ? '' : ` · ${moved} moved`}` },
    { text: '#Chainlink', drop: MOMENT_DROP.closing },
  ];
}

function welcomeTg(f: WelcomeFacts): Line[] {
  const chain = tgName(f.chain);
  const moved = firstDayUsd(f.usd);
  return [
    { text: bold(`Welcome to CCIP, ${chain}`) },
    { text: `${chain} is chain ${bold(`#${f.number}`)} on CCIP. Its first message was on ${longDay(f.day)}.` },
    { text: `First day: ${bold(formatCount(f.messages))} message${f.messages === 1 ? '' : 's'}${moved === null ? '' : ` and ${bold(moved)} moved`}.` },
    ...(f.partners.length > 0 ? [{ text: `Connected to ${andList(f.partners.slice(0, 3).map(tgName))}.`, drop: MOMENT_DROP.detail }] : []),
    { text: '' },
    { text: CLOSING_TG, drop: MOMENT_DROP.closing },
  ];
}

const COUNTDOWN_X: Record<MilestoneMetric, (t: number) => string> = {
  messages: (t) => `${formatCount(t)} all-time #CCIP messages`,
  value: (t) => `${formatThresholdUsd(t)} moved over #CCIP all time`,
  fees: (t) => `${formatThresholdUsd(t)} in all-time #CCIP fees`,
};

const COUNTDOWN_TG: Record<MilestoneMetric, (t: number) => string> = {
  messages: (t) => `${formatCount(t)} messages all time`,
  value: (t) => `${formatThresholdUsd(t)} moved all time`,
  fees: (t) => `${formatThresholdUsd(t)} in fees all time`,
};

const amount = (c: Pick<Countdown, 'metric'>, v: number) => (c.metric === 'messages' ? formatCount(v) : formatUsd(v));
const threshold = (c: Pick<Countdown, 'metric'>, v: number) => (c.metric === 'messages' ? formatCount(v) : formatThresholdUsd(v));

function countdownX({ countdown: c }: CountdownFacts): Line[] {
  return [
    { text: `⏳ ${COUNTDOWN_X[c.metric](c.threshold)} is about ${plural(c.days_left, 'day')} away` },
    { text: `${amount(c, c.total)} now, adding about ${amount(c, c.per_day)} a day` },
    { text: '#Chainlink', drop: MOMENT_DROP.closing },
  ];
}

function countdownTg({ countdown: c }: CountdownFacts): Line[] {
  return [
    { text: bold(`CCIP countdown: ${tgText(COUNTDOWN_TG[c.metric](c.threshold))}`) },
    { text: `About ${bold(plural(c.days_left, 'day'))} away at the pace of the last 7 days, about ${bold(amount(c, c.per_day))} a day.` },
    { text: `${bold(amount(c, c.total))} so far.` },
    ...(c.previous ? [{ text: `Last milestone: ${threshold(c, c.previous.threshold)} on ${longDay(c.previous.day)}.`, drop: MOMENT_DROP.detail }] : []),
    { text: '' },
    { text: CLOSING_TG, drop: MOMENT_DROP.closing },
  ];
}

const BY: Record<BoardName, string> = { fee_chains: 'by fees', tokens: 'by value', lanes: 'by value' };
const VERB: Record<BoardName, string> = { fee_chains: 'paid the most fees', tokens: 'moved the most value', lanes: 'moved the most value' };
const boardValue = (m: Pick<Mover, 'board' | 'value'>) => (m.board === 'fee_chains' ? formatFeeTotal(m.value) : formatUsd(m.value));

function moverName(n: MoverName, chain: Name, text: (s: string) => string): string {
  if (n.kind === 'chain') return chain(n.player);
  if (n.kind === 'token') return text(n.symbol);
  return `${text(n.src.name)} → ${text(n.dst.name)}`;
}

function climb(m: Mover, name: string): string {
  return m.gain === null ? `${name} new at #${m.rank} ${BY[m.board]}` : `${name} ▲${m.gain} to #${m.rank} ${BY[m.board]}`;
}

/** `headlineChain` writes the headline's chain, the post's subject; `chain` writes every other chain. */
function moversLines(f: MoversFacts, headlineChain: Name, chain: Name, text: (s: string) => string, tg: boolean): Line[] {
  const name = (n: MoverName) => moverName(n, chain, text);
  const leader = moverName(f.headline.name, headlineChain, text);
  const headline = f.newLeader
    ? `${leader} ${VERB[f.headline.board]} last week (${tg ? bold(boardValue(f.headline)) : boardValue(f.headline)})${f.dethroned ? `, taking the top spot from ${name(f.dethroned)}` : ''}`
    : climb(f.headline, leader);
  const climbers = f.climbers.map((m) => climb(m, name(m.name))).join(' · ');
  const lead = f.newLeader ? 'Climbers' : 'Also climbing';
  if (tg) {
    return [
      { text: bold(`CCIP leaderboards · ${weekRange(f.monday)}`) },
      { text: `${f.newLeader ? 'New #1: ' : 'Top climber: '}${headline}.` },
      ...(climbers ? [{ text: `${lead}: ${climbers}`, drop: MOMENT_DROP.detail }] : []),
      { text: '' },
      { text: CLOSING_TG, drop: MOMENT_DROP.closing },
    ];
  }
  return [
    { text: f.newLeader ? `New #1 on #CCIP: ${headline}` : `Top climber on #CCIP last week: ${headline}` },
    ...(climbers ? [{ text: `${lead}: ${climbers}`, drop: MOMENT_DROP.detail }] : []),
    { text: '#Chainlink $LINK', drop: MOMENT_DROP.closing },
  ];
}

const pctOf = (now: number, before: number | null) => (before === null || before === 0 ? null : ((now - before) / before) * 100);

function spotlightX(f: SpotlightFacts): Line[] {
  const s = f.spotlight;
  const change = arrow(pctOf(s.messages, s.previous_messages));
  const figures = [
    `${plural(s.messages, 'message')}${change ? ` (${change} vs last week)` : ''}`,
    `${formatUsd(s.usd)} moved`,
    ...(s.fee_usd === null ? [] : [`${formatFeeTotal(s.fee_usd)} in fees`]),
  ];
  return [
    { text: `Chain spotlight: ${subject(f.chain)} is the fastest-growing chain on #CCIP this week` },
    { text: figures.join(' · ') },
    ...(f.partners.length > 0 ? [{ text: `Top partners: ${f.partners.map(plain).join(' · ')}`, drop: MOMENT_DROP.detail }] : []),
    { text: '#Chainlink $LINK', drop: MOMENT_DROP.closing },
  ];
}

function spotlightTg(f: SpotlightFacts): Line[] {
  const s = f.spotlight;
  const chain = tgName(f.chain);
  const change = (now: number, before: number | null, suffix = '') => {
    const a = arrow(pctOf(now, before));
    return a ? ` (${a}${suffix})` : '';
  };
  const figures = [
    `${bold(formatCount(s.messages))} messages${change(s.messages, s.previous_messages, ' vs last week')}`,
    `${bold(formatUsd(s.usd))} moved${change(s.usd, s.previous_usd)}`,
    ...(s.fee_usd === null ? [] : [`${bold(formatFeeTotal(s.fee_usd))} in fees${change(s.fee_usd, s.previous_fee_usd)}`]),
  ];
  return [
    { text: bold(`Chain spotlight: ${chain}`) },
    { text: `${chain} is the fastest-growing chain on CCIP this week, and #${s.rank} by messages.` },
    { text: figures.join(' · ') },
    ...(f.partners.length > 0 ? [{ text: `Top partners: ${f.partners.map(tgName).join(' · ')}`, drop: MOMENT_DROP.detail }] : []),
    ...(f.token ? [{ text: `Top token: ${tgText(f.token.symbol)} · ${formatUsd(f.token.usd)} moved`, drop: MOMENT_DROP.detail }] : []),
    { text: '' },
    { text: CLOSING_TG, drop: MOMENT_DROP.closing },
  ];
}

function roundupX(f: RoundupFacts, shown: number): Line[] {
  const lanes = shownList(f.lanes, shown, (l) => `${plain(l.src)} → ${plain(l.dst)}`);
  const tokens = shownList(f.tokens, shown, (t) => `${noLinks(t.symbol)} on ${plain(t.chain)}${t.project ? ` (${plain(t.project)})` : ''}`);
  return [
    { text: 'New on #CCIP this week' },
    ...(lanes ? [{ text: `Lanes: ${lanes}` }] : []),
    ...(tokens ? [{ text: `Tokens: ${tokens}` }] : []),
    { text: `CCIP now runs ${formatCount(f.network.lanes)} lanes between ${formatCount(f.network.chains)} chains`, drop: MOMENT_DROP.closing },
  ];
}

const joined = (lines: readonly Line[]) => lines.map((l) => l.text).join('\n');

/** Names up to 5 lanes and 5 tokens, fewer when X's 280 needs it, with "+N more" for the rest; the network line goes only when no list length fits with it. */
function roundupXText(f: RoundupFacts): string {
  for (let shown = ROUNDUP_SHOWN; shown >= 1; shown--) {
    const lines = roundupX(f, shown);
    if (fitsX(joined(lines))) return joined(lines);
  }
  for (let shown = ROUNDUP_SHOWN; shown > 1; shown--) {
    const lines = roundupX(f, shown);
    if (fitsX(joined(lines.filter((l) => l.drop === undefined)))) return fitLines(lines, fitsX);
  }
  return fitLines(roundupX(f, 1), fitsX);
}

function roundupTg(f: RoundupFacts, shown: number): Line[] {
  const lanes = shownList(f.lanes, shown, (l) => `${tgName(l.src)} → ${tgName(l.dst)}`);
  const tokens = shownList(f.tokens, shown, (t) => `${tgText(t.symbol)} on ${tgName(t.chain)}${t.project ? ` (${tgName(t.project)})` : ''}`);
  return [
    { text: bold(`New on CCIP this week · ${dayRange(f.monday, addDays(f.monday, 4))}`) },
    ...(lanes ? [{ text: `New lanes: ${lanes}` }] : []),
    ...(tokens ? [{ text: `New tokens: ${tokens}` }] : []),
    { text: `CCIP now runs ${bold(formatCount(f.network.lanes))} lanes between ${bold(formatCount(f.network.chains))} chains.` },
    { text: '' },
    { text: '#CCIP', drop: MOMENT_DROP.closing },
  ];
}

function roundupTelegram(f: RoundupFacts): string {
  for (let shown = ROUNDUP_SHOWN; shown > 1; shown--) {
    const lines = roundupTg(f, shown);
    if (fitsTelegram(joined(lines))) return joined(lines);
  }
  return fitLines(roundupTg(f, 1), fitsTelegram);
}

/** "Base paid the most fees ($1.8K)", or for the fee question "CCIP fees rose 12% to $9.0K". */
function outcomeText(poll: Poll): string | null {
  const o = poll.outcome;
  if (o === null) return null;
  if (poll.question_kind === 'fees_change') {
    const pct = o.change_pct ?? 0;
    return `CCIP fees ${pct >= 0 ? 'rose' : 'fell'} ${formatShare(Math.abs(pct))} to ${formatFeeTotal(o.value)}`;
  }
  return poll.question_kind === 'fee_chain' ? `${tgText(o.label)} paid the most fees (${formatFeeTotal(o.value)})` : `${tgText(o.label)} moved the most value (${formatUsd(o.value)})`;
}

function pollTg(f: PollFacts): Line[] {
  const outcome = f.last ? outcomeText(f.last) : null;
  const called = f.last ? calledShare(f.last) : null;
  const question = tgText(f.poll.question.replace(/ this week\?$/, '?'));
  const ask = `This week: ${question.charAt(0).toLowerCase()}${question.slice(1)} Vote below.`;
  return outcome === null
    ? [{ text: `🔮 ${ask}` }]
    : [{ text: `🔮 Last week: ${outcome}.${called === null ? '' : ` ${called}% of you called it.`}` }, { text: ask }];
}

function momentX(f: Exclude<MomentFacts, PollFacts | RoundupFacts>): Line[] {
  switch (f.kind) {
    case 'welcome':
      return welcomeX(f);
    case 'countdown':
      return countdownX(f);
    case 'movers':
      return moversLines(f, subject, plain, noLinks, false);
    case 'spotlight':
      return spotlightX(f);
  }
}

function momentTelegram(f: MomentFacts): Line[] {
  switch (f.kind) {
    case 'welcome':
      return welcomeTg(f);
    case 'countdown':
      return countdownTg(f);
    case 'movers':
      return moversLines(f, tgName, tgName, tgText, true);
    case 'spotlight':
      return spotlightTg(f);
    case 'roundup':
      return [{ text: roundupTelegram(f) }];
    case 'poll':
      return pollTg(f);
  }
}

/** A moment's X text and Telegram caption. The poll has no X draft, so its X text is empty. */
export function composeMomentCopy(f: MomentFacts): Copy {
  const xText = f.kind === 'poll' ? '' : f.kind === 'roundup' ? roundupXText(f) : fitLines(momentX(f), fitsX);
  return { xText, telegramHtml: fitLines(momentTelegram(f), fitsTelegram) };
}
