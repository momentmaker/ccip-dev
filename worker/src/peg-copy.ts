import type { PegEvent, PegLiveBody, PegSide } from '@ccip-dev/core';
import { formatCount, formatDuration } from '@ccip-dev/core/format';

export const PEG_PAGE_URL = 'https://ccip.dev/staking/#peg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export const pctText = (gap: number) => `${(Math.abs(gap) * 100).toFixed(2)}%`;
export const linkText = (n: number) => (n < 100 ? n.toFixed(1) : formatCount(n));
const price = (live: PegLiveBody) => `1 stLINK = ${live.spot.toFixed(4)} LINK`;

export function pegCurveLine(side: PegSide, live: PegLiveBody): string {
  const r = live[side];
  if (r.depth === null || r.profit === null) return 'Curve: no size beats 1:1 after fees';
  return side === 'discount'
    ? `Curve: buying stLINK beats 1:1 up to ${linkText(r.depth)} LINK (+${r.profit.toFixed(2)} LINK at that size)`
    : `Curve: selling stLINK beats 1:1 up to ${linkText(r.depth)} stLINK (+${r.profit.toFixed(2)} LINK at that size)`;
}

export function pegRouteLine(side: PegSide, live: PegLiveBody, now: Date): string {
  if (side === 'discount') {
    const d = live.discount;
    const window = d.claim_window_open ? '' : ' (no claim window open)';
    const payout = Date.parse(d.next_payout_after) > now.getTime() ? `next payout after ${utcStamp(d.next_payout_after)}` : 'payout possible in the next claim window';
    return `Redeem at 1:1: ${linkText(d.instant)} LINK instant; the rest queues behind ${linkText(d.queued_ahead)} stLINK, ${payout}${window}`;
  }
  const p = live.premium;
  return p.instant > 0 ? `Mint at 1:1: ${linkText(p.instant)} LINK instant` : `Mint at 1:1: queued behind ${linkText(p.queued_ahead)} LINK, stLINK claimed later`;
}

export function pegTradeableLine(side: PegSide, live: PegLiveBody): string {
  const r = live[side];
  if (r.tradeable <= 0) return 'Tradeable now: none at 1:1 instantly';
  return `Tradeable now: ${linkText(r.tradeable)} LINK${r.tradeable_profit === null ? '' : ` for +${r.tradeable_profit.toFixed(2)} LINK`}`;
}

/** Plain text for the owner's alert chat: one message per episode event. */
export function pegAlertText(e: PegEvent, live: PegLiveBody, opts: { publicLine: number; publicPosts: boolean; bestSize: number | null; now: Date }): string {
  const side = e.episode.side;
  const state = [pegCurveLine(side, live), pegRouteLine(side, live, opts.now), pegTradeableLine(side, live), PEG_PAGE_URL];
  switch (e.kind) {
    case 'opened':
      return [`stLINK at a ${pctText(live.gap)} ${side} (${price(live)})`, ...state].join('\n');
    case 'tier':
      return [`stLINK ${side} past ${Math.round(e.tier * 100)}%: now ${pctText(live.gap)} (${price(live)})`, ...state].join('\n');
    case 'went_public':
      return [`stLINK ${side} past the ${pctText(opts.publicLine)} public line: now ${pctText(live.gap)}. ${opts.publicPosts ? 'Posting to the channel.' : 'Public posts are off.'}`, ...state].join('\n');
    case 'closed': {
      const lasted = formatDuration((Date.parse(e.closedAt) - Date.parse(e.episode.openedAt)) / 1000);
      const best = opts.bestSize === null ? [] : [`Best Curve size seen: ${linkText(opts.bestSize)} LINK`];
      return [`stLINK ${side} closed after ${lasted}: peak ${pctText(e.episode.peakGap)} at ${utcStamp(e.episode.peakAt)}`, ...best, PEG_PAGE_URL].join('\n');
    }
  }
}
