import { normalizeAddress } from './normalize';
import { LINK_TOKEN, LINK_TOKEN_CHAIN_SELECTOR, LINK_TOKEN_DECIMALS, UNLISTED_LINK_FEE_TOKENS } from './reserve';
import type { DailyBreakdown, DailyTotals, Dim, MessageRow, TokenRow } from './types';

export interface DayRollup {
  totals: DailyTotals;
  breakdown: DailyBreakdown[];
}

interface Group {
  ids: Set<string>;
  usd: number;
  fee: number;
  anyFee: boolean;
}

const senderKey = (r: MessageRow) => `${r.src_chain}:${r.sender}`;

export function rollupDay(day: string, messages: MessageRow[], tokens: TokenRow[]): DayRollup {
  const byId = new Map<string, MessageRow>();
  for (const m of messages) if (m.day === day) byId.set(m.message_id, m);
  const rows = [...byId.values()];
  const deliveries = rows
    .filter((r) => r.status === 'SUCCESS' && r.receipt_ts !== null)
    .map((r) => (Date.parse(r.receipt_ts as string) - Date.parse(r.send_ts)) / 1000);

  const totals: DailyTotals = {
    day,
    messages: rows.length,
    token_messages: rows.filter((r) => r.token_count > 0).length,
    usd_value: sum(rows.map((r) => r.usd_value)),
    fee_usd: rows.some((r) => r.fee_usd !== null) ? sum(rows.map((r) => r.fee_usd ?? 0)) : null,
    unique_senders: new Set(rows.map(senderKey)).size,
    median_delivery_s: median(deliveries),
    unpriced_messages: rows.filter((r) => r.unpriced === 1).length,
  };

  const breakdown: DailyBreakdown[] = [];
  const addMessageGroups = (dim: Dim, keyOf: (r: MessageRow) => string) => {
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const g = groupFor(groups, keyOf(r));
      g.ids.add(r.message_id);
      g.usd += r.usd_value;
      if (r.fee_usd !== null) {
        g.fee += r.fee_usd;
        g.anyFee = true;
      }
    }
    pushGroups(breakdown, day, dim, groups, true);
  };
  addMessageGroups('src_chain', (r) => r.src_chain);
  addMessageGroups('dst_chain', (r) => r.dst_chain);
  addMessageGroups('lane', (r) => `${r.src_chain}>${r.dst_chain}`);
  addMessageGroups('sender', senderKey);

  const tokenGroups = new Map<string, Group>();
  for (const t of tokens) {
    if (!byId.has(t.message_id)) continue;
    const g = groupFor(tokenGroups, `${t.chain}:${t.token}`);
    g.ids.add(t.message_id);
    g.usd += t.usd_value ?? 0;
  }
  pushGroups(breakdown, day, 'token', tokenGroups, false);

  return { totals, breakdown };
}

function groupFor(groups: Map<string, Group>, key: string): Group {
  let g = groups.get(key);
  if (!g) {
    g = { ids: new Set(), usd: 0, fee: 0, anyFee: false };
    groups.set(key, g);
  }
  return g;
}

function pushGroups(out: DailyBreakdown[], day: string, dim: Dim, groups: Map<string, Group>, withFees: boolean): void {
  for (const [key, g] of groups) {
    out.push({ day, dim, key, messages: g.ids.size, usd_value: g.usd, fee_usd: withFees && g.anyFee ? g.fee : null });
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export type LinkFeeMatcher = (chain: string, feeToken: string) => boolean;

/** LINK fee tokens by `chain:normalizedAddress`, each with the decimals that turn its fee amount into LINK. */
export type LinkFeeTokens = ReadonlyMap<string, number>;

export function linkFeeMatcher(keys: { has(key: string): boolean }): LinkFeeMatcher {
  return (chain, feeToken) => keys.has(`${chain}:${normalizeAddress(feeToken)}`);
}

/** The LINK fee tokens with their decimals; the Worker's `store.linkFeeTokens` builds the same map from D1. */
export function linkFeeKeys(tokens: readonly { chain: string; address: string; groupId: string | null; decimals: number }[]): Map<string, number> {
  const ethLink = normalizeAddress(LINK_TOKEN);
  const group = tokens.find((t) => t.chain === LINK_TOKEN_CHAIN_SELECTOR && normalizeAddress(t.address) === ethLink)?.groupId ?? null;
  return new Map<string, number>([
    [`${LINK_TOKEN_CHAIN_SELECTOR}:${ethLink}`, LINK_TOKEN_DECIMALS],
    ...Object.entries(UNLISTED_LINK_FEE_TOKENS).map(([chain, t]): [string, number] => [`${chain}:${normalizeAddress(t.address)}`, t.decimals]),
    ...(group === null ? [] : tokens.filter((t) => t.groupId === group).map((t): [string, number] => [`${t.chain}:${normalizeAddress(t.address)}`, t.decimals])),
  ]);
}

export function linkFeeUsd(messages: MessageRow[], day: string, isLinkFee: LinkFeeMatcher): number | null {
  const byId = new Map<string, MessageRow>();
  for (const m of messages) if (m.day === day) byId.set(m.message_id, m);
  const rows = [...byId.values()];
  if (!rows.some((r) => r.fee_usd !== null)) return null;
  return sum(rows.filter((r) => r.fee_usd !== null && r.fee_token !== null && isLinkFee(r.src_chain, r.fee_token)).map((r) => r.fee_usd!));
}
