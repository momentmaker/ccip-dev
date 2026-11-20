import type { PegEvent, PegLiveBody, PegSide } from '@ccip-dev/core';
import { formatDuration } from '@ccip-dev/core/format';
import { linkAmount, payoutWhen, utcStamp } from '@ccip-dev/core/peg-format';

export const PEG_PAGE_URL = 'https://ccip.dev/staking/#peg';
export const pctText = (gap: number) => `${(Math.abs(gap) * 100).toFixed(2)}%`;
const price = (live: PegLiveBody) => `1 stLINK = ${live.spot.toFixed(4)} LINK`;

export function pegCurveLine(side: PegSide, live: PegLiveBody): string {
  const r = live[side];
  if (r.depth === null || r.profit === null) return 'Curve: no size beats 1:1 after fees';
  return side === 'discount'
    ? `Curve: buying stLINK beats 1:1 up to ${linkAmount(r.depth)} LINK (+${r.profit.toFixed(2)} LINK at that size)`
    : `Curve: selling stLINK beats 1:1 up to ${linkAmount(r.depth)} stLINK (+${r.profit.toFixed(2)} LINK at that size)`;
}

export function pegRouteLine(side: PegSide, live: PegLiveBody, now: Date): string {
  if (side === 'discount') {
    const d = live.discount;
    return `Redeem at 1:1: ${linkAmount(d.instant)} LINK instant; the rest queues behind ${linkAmount(d.queued_ahead)} stLINK, ${payoutWhen(d, now)}`;
  }
  const p = live.premium;
  return p.instant > 0 ? `Mint at 1:1: ${linkAmount(p.instant)} LINK instant` : `Mint at 1:1: queued behind ${linkAmount(p.queued_ahead)} LINK, stLINK claimed later`;
}

export function pegTradeableLine(side: PegSide, live: PegLiveBody): string {
  const r = live[side];
  if (r.tradeable <= 0) return 'Tradeable now: none at 1:1 instantly';
  return `Tradeable now: ${linkAmount(r.tradeable)} LINK${r.tradeable_profit === null ? '' : ` for +${r.tradeable_profit.toFixed(2)} LINK`}`;
}

/** Where a public episode's post goes: PEG_PUBLIC and BROADCASTS both have to allow it. */
export type PegPosting = 'channel' | 'drafts' | 'off';

const POSTING_TEXT: Record<PegPosting, string> = {
  channel: 'Posting to the channel.',
  drafts: 'Broadcasts are in drafts mode: the post goes to drafts, not the channel.',
  off: 'Public posts are off.',
};

/** Plain text for the owner's alert chat: one message per episode event. */
export function pegAlertText(e: PegEvent, live: PegLiveBody, opts: { publicLine: number; posting: PegPosting; bestSize: number | null; now: Date }): string {
  const side = e.episode.side;
  const state = [pegCurveLine(side, live), pegRouteLine(side, live, opts.now), pegTradeableLine(side, live), PEG_PAGE_URL];
  switch (e.kind) {
    case 'opened':
      return [`stLINK at a ${pctText(live.gap)} ${side} (${price(live)})`, ...state].join('\n');
    case 'tier':
      return [`stLINK ${side} past ${Math.round(e.tier * 100)}%: peak ${pctText(e.episode.peakGap)}, now ${pctText(live.gap)} (${price(live)})`, ...state].join('\n');
    case 'went_public':
      return [`stLINK ${side} past the ${pctText(opts.publicLine)} public line: now ${pctText(live.gap)}. ${POSTING_TEXT[opts.posting]}`, ...state].join('\n');
    case 'closed': {
      const lasted = formatDuration((Date.parse(e.closedAt) - Date.parse(e.episode.openedAt)) / 1000);
      const best = opts.bestSize === null ? [] : [`Best Curve size seen: ${linkAmount(opts.bestSize)} LINK`];
      return [`stLINK ${side} closed after ${lasted}: peak ${pctText(e.episode.peakGap)} at ${utcStamp(e.episode.peakAt)}`, ...best, PEG_PAGE_URL].join('\n');
    }
  }
}
