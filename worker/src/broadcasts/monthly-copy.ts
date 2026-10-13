import { recordValueText } from '@ccip-dev/core/broadcasts';
import { formatCount, formatFeeTotal, formatShare, formatUsd, formatUsdDown } from '@ccip-dev/core/format';
import type { RecordKind } from '@ccip-dev/core/records';
import { bold, fitLines, noLinks, plural, shortDay, TELEGRAM_CAPTION_MAX, tgText, X_MAX, type Copy, type Line } from './copy';
import type { MonthlyFacts } from './monthly';
import { xLength } from './x-length';

/** When the post is too long, its detail lines (New on CCIP, and on Telegram the records and the lane) go first, then the hashtags. */
export const MONTHLY_DROP = { detail: 1, closing: 2 } as const;

const HIGH: Record<RecordKind, (value: string) => string> = {
  messages: (v) => `${v} messages in one day`,
  value: (v) => `${v} moved in one day`,
  fees: (v) => `${v} in fees in one day`,
  largest_fee: (v) => `${v}, the largest single fee`,
  link_share: (v) => `${v} of fees paid in LINK in one day`,
};

const CLOSING = '#CCIP #Chainlink $LINK';

function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The video tags no one: there is no single subject. The value moved is rounded down, as the video's counter and end card show it. */
function monthlyX(f: MonthlyFacts): Line[] {
  const s = f.summary;
  const fees = s.fees === null ? '' : ` · ${formatFeeTotal(s.fees)} in fees`;
  return [
    { text: `🎬 CCIP in ${s.label}` },
    { text: `${plural(s.messages, 'message')} · ${formatUsdDown(s.usd)} moved${fees}` },
    ...(s.joined.length > 0 ? [{ text: `New on CCIP: ${s.joined.map((c) => noLinks(c.name)).join(', ')}`, drop: MONTHLY_DROP.detail }] : []),
    { text: CLOSING, drop: MONTHLY_DROP.closing },
  ];
}

function monthlyTelegram(f: MonthlyFacts): Line[] {
  const s = f.summary;
  const month = s.label.split(' ')[0]!;
  const lines: Line[] = [
    { text: bold(`🎬 CCIP in ${s.label}`) },
    { text: `In ${month}, ${bold(formatCount(s.messages))} CCIP message${s.messages === 1 ? '' : 's'} moved ${bold(formatUsdDown(s.usd))}.` },
  ];
  if (s.fees !== null) {
    const link = s.linkSharePct === null ? '' : `, ${bold(formatShare(s.linkSharePct))} of it in LINK`;
    lines.push({ text: `Senders paid ${bold(formatFeeTotal(s.fees))} in fees${link}.` });
  }
  if (s.joined.length > 0) lines.push({ text: `New on CCIP: ${andList(s.joined.map((c) => tgText(c.name)))}.`, drop: MONTHLY_DROP.detail });
  if (s.records.length > 0) {
    const highs = s.records.map((r) => `${HIGH[r.kind](bold(recordValueText(r.kind, r.value)))} (${shortDay(r.day)})`);
    lines.push({ text: `New all-time highs: ${highs.join('; ')}.`, drop: MONTHLY_DROP.detail });
  }
  if (s.busiestLane) {
    const lane = s.busiestLane;
    lines.push({ text: `Busiest lane: ${tgText(lane.src.name)} → ${tgText(lane.dst.name)}, with ${bold(formatUsd(lane.usd))} moved.`, drop: MONTHLY_DROP.detail });
  }
  return [...lines, { text: '' }, { text: CLOSING, drop: MONTHLY_DROP.closing }];
}

/** The monthly video's X text and Telegram caption: no @ tags and no links. */
export function composeMonthlyCopy(f: MonthlyFacts): Copy {
  return {
    xText: fitLines(monthlyX(f), (t) => xLength(t) <= X_MAX),
    telegramHtml: fitLines(monthlyTelegram(f), (t) => t.length <= TELEGRAM_CAPTION_MAX),
  };
}
