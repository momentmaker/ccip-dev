export interface ChainRef {
  selector: string;
  name: string;
  chainId: string;
  family: string;
}

export interface TokenAmount {
  chain: ChainRef;
  token: string;
  amount: string;
}

export interface Fee {
  token: string;
  amount: string;
}

export interface NormalizedMessage {
  messageId: string;
  day: string;
  sendTs: string;
  receiptTs: string | null;
  status: string;
  readyForManualExec: boolean;
  src: ChainRef;
  dst: ChainRef;
  sender: string;
  receiver: string | null;
  origin: string | null;
  tokens: TokenAmount[];
  fee: Fee | null;
}

export interface PriceInfo {
  price: number;
  decimals: number;
}

export type PriceLookup = (llamaKey: string) => PriceInfo | undefined;

/** Prices a token that has no price of its own, by chain selector and normalized address. */
export type PriceFallback = (chainSelector: string, address: string) => PriceInfo | undefined;

export type Source = 'live' | 'backfill';

export interface MessageRow {
  message_id: string;
  day: string;
  send_ts: string;
  receipt_ts: string | null;
  status: string;
  src_chain: string;
  dst_chain: string;
  sender: string;
  receiver: string | null;
  origin: string | null;
  token_count: number;
  usd_value: number;
  unpriced: 0 | 1;
  fee_token: string | null;
  fee_amount: string | null;
  fee_usd: number | null;
  ready_for_manual_exec: 0 | 1;
  detail_fetched_at: string | null;
  next_check_at: string | null;
  source: Source;
}

export interface TokenRow {
  message_id: string;
  idx: number;
  chain: string;
  token: string;
  amount: string;
  usd_value: number | null;
}

export type Dim = 'src_chain' | 'dst_chain' | 'lane' | 'token' | 'sender';

export interface DailyTotals {
  day: string;
  messages: number;
  token_messages: number;
  usd_value: number;
  fee_usd: number | null;
  unique_senders: number;
  median_delivery_s: number | null;
  unpriced_messages: number;
}

export interface DailyBreakdown {
  day: string;
  dim: Dim;
  key: string;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}
