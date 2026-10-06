import type { MessageRow, NormalizedMessage, PriceFallback, PriceLookup, Source, TokenRow } from './types';
import { valueTokens, type Valuation } from './value';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const UNRESOLVED_AFTER = 48 * HOUR;

export interface RowExtras {
  source: Source;
  feeUsd?: number | null;
  detailFetchedAt?: string | null;
  nextCheckAt?: string | null;
}

export function toMessageRow(m: NormalizedMessage, v: Valuation, extras: RowExtras): MessageRow {
  return {
    message_id: m.messageId,
    day: m.day,
    send_ts: m.sendTs,
    receipt_ts: m.receiptTs,
    status: m.status,
    src_chain: m.src.selector,
    dst_chain: m.dst.selector,
    sender: m.sender,
    receiver: m.receiver,
    origin: m.origin,
    token_count: m.tokens.length,
    usd_value: v.usdValue,
    unpriced: v.unpriced ? 1 : 0,
    fee_token: m.fee?.token ?? null,
    fee_amount: m.fee?.amount ?? null,
    fee_usd: extras.feeUsd ?? null,
    ready_for_manual_exec: m.readyForManualExec ? 1 : 0,
    detail_fetched_at: extras.detailFetchedAt ?? null,
    next_check_at: extras.nextCheckAt ?? null,
    source: extras.source,
  };
}

export function toTokenRows(m: NormalizedMessage, v: Valuation): TokenRow[] {
  return m.tokens.map((t, idx) => ({
    message_id: m.messageId,
    idx,
    chain: t.chain.selector,
    token: t.token,
    amount: t.amount,
    usd_value: v.tokenUsd[idx] ?? null,
  }));
}

/** Also returns every token amount valued above MAX_TRANSFER_USD, in `outliers` (see `Valuation`). */
export function buildRows(
  messages: NormalizedMessage[],
  lookup: PriceLookup,
  extras: (m: NormalizedMessage) => RowExtras,
  fallback?: PriceFallback,
): { rows: MessageRow[]; tokens: TokenRow[]; outliers: string[] } {
  const rows: MessageRow[] = [];
  const tokens: TokenRow[] = [];
  const outliers: string[] = [];
  for (const m of messages) {
    const valuation = valueTokens(m.tokens, lookup, fallback);
    rows.push(toMessageRow(m, valuation, extras(m)));
    tokens.push(...toTokenRows(m, valuation));
    outliers.push(...valuation.outliers);
  }
  return { rows, tokens, outliers };
}

export function firstCheckAt(sendTs: string): string {
  return new Date(Date.parse(sendTs) + 2 * MINUTE).toISOString();
}

export function isFinal(status: string, readyForManualExec: boolean): boolean {
  return status === 'SUCCESS' || status === 'UNRESOLVED' || (status === 'FAILED' && !readyForManualExec);
}

export function scheduleNextCheck(
  status: string,
  readyForManualExec: boolean,
  sendTs: string,
  now: Date,
): { status: string; nextCheckAt: string | null } {
  if (isFinal(status, readyForManualExec)) return { status, nextCheckAt: null };
  const age = now.getTime() - Date.parse(sendTs);
  if (age >= UNRESOLVED_AFTER) return { status: status === 'FAILED' ? 'FAILED' : 'UNRESOLVED', nextCheckAt: null };
  const step = age < 12 * MINUTE ? 10 * MINUTE : age < 72 * MINUTE ? HOUR : 6 * HOUR;
  return { status, nextCheckAt: new Date(now.getTime() + step).toISOString() };
}
