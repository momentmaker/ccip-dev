import { z } from 'zod';

const envelope = {
  schema_version: z.literal(1),
  updated_at: z.string(),
  attribution: z.string(),
};

export const TOP_WINDOWS = ['7d', '30d', 'all'] as const;
export type TopWindow = (typeof TOP_WINDOWS)[number];

export const StatusFileSchema = z.object({
  ...envelope,
  last_ingest_ok_at: z.string().nullable(),
  lag_seconds: z.number().nullable(),
  last_finalize_day: z.string().nullable(),
  coverage_from: z.string().nullable(),
});

export const LiveMessageSchema = z.object({
  id: z.string(),
  send_ts: z.string(),
  status: z.string(),
  src: z.string(),
  dst: z.string(),
  token: z.string().nullable(),
  usd: z.number().nullable(),
  sender_label: z.string().nullable(),
});

export const LiveFileSchema = z.object({ ...envelope, window_minutes: z.number(), messages: z.array(LiveMessageSchema) });

export const DayTotalsSchema = z.object({
  day: z.string(),
  messages: z.number(),
  token_messages: z.number(),
  usd_value: z.number(),
  fee_usd: z.number().nullable(),
  unique_senders: z.number(),
  median_delivery_s: z.number().nullable(),
  unpriced_messages: z.number(),
  fee_link_usd: z.number().nullable(),
});

export const TopEntrySchema = z.object({
  key: z.string(),
  messages: z.number(),
  usd: z.number().nullable(),
  fee_usd: z.number().nullable().optional(),
  symbol: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
});

export const TodayFileSchema = z.object({
  ...envelope,
  day: z.string(),
  totals: DayTotalsSchema.extend({ fee_link_share_pct: z.number().nullable() }),
  top: z.object({ lane: z.array(TopEntrySchema), token: z.array(TopEntrySchema), sender: z.array(TopEntrySchema) }),
  arrivals: z.array(z.object({ kind: z.string(), key: z.string(), first_seen: z.string() })),
});

export const HistoryFileSchema = z.object({ ...envelope, since: z.string().nullable(), days: z.array(DayTotalsSchema) });

export const TopFileSchema = z.object({
  ...envelope,
  dim: z.enum(['src_chain', 'dst_chain', 'lane', 'token', 'sender']),
  since: z.string().nullable(),
  windows: z.object({ '7d': z.array(TopEntrySchema), '30d': z.array(TopEntrySchema), all: z.array(TopEntrySchema) }),
});

export const ChainSchema = z.object({
  selector: z.string(),
  name: z.string(),
  display_name: z.string().nullable(),
  family: z.string().nullable(),
  chain_id: z.string().nullable(),
  first_seen: z.string().nullable(),
});

export const ChainsFileSchema = z.object({ ...envelope, chains: z.array(ChainSchema) });

export const TokenSchema = z.object({
  chain: z.string(),
  address: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  decimals: z.number().nullable(),
  group_id: z.string().nullable(),
  first_seen: z.string().nullable(),
});

export const TokensFileSchema = z.object({ ...envelope, tokens: z.array(TokenSchema) });

export const TransferViewSchema = z.object({
  ts: z.string(),
  tx: z.string(),
  direction: z.enum(['in', 'out']),
  counterparty: z.string(),
  link: z.number(),
  price_usd: z.number().nullable(),
  usd: z.number().nullable(),
  value_now_usd: z.number().nullable(),
  change_pct: z.number().nullable(),
});

const PricePointSchema = z.object({ ts: z.string(), tx: z.string(), price_usd: z.number() });

export const ReserveFileSchema = z.object({
  ...envelope,
  token: z.string(),
  reserve: z.string(),
  latest: z.object({ ts: z.string(), link: z.number() }).nullable(),
  series: z.array(z.object({ ts: z.string(), link: z.number() })),
  link_price_usd: z.number().nullable(),
  cost_basis: z
    .object({
      link_in: z.number(),
      link_out: z.number(),
      cost_usd: z.number(),
      value_usd: z.number().nullable(),
      change_usd: z.number().nullable(),
      change_pct: z.number().nullable(),
      avg_deposit_price_usd: z.number().nullable(),
      unpriced_transfers: z.number(),
    })
    .nullable(),
  pace: z
    .object({
      deposits: z.number(),
      last_deposit: z
        .object({ ts: z.string(), tx: z.string(), link: z.number(), price_usd: z.number().nullable(), usd: z.number().nullable() })
        .nullable(),
      days_since_last_deposit: z.number().nullable(),
      avg_weekly_link_4w: z.number().nullable(),
      avg_weekly_usd_4w: z.number().nullable(),
      annualized_link: z.number().nullable(),
      supply_share_pct: z.number(),
      next_milestone: z.object({ link: z.number(), eta: z.string() }).nullable(),
      avg_days_between_deposits: z.number().nullable(),
      next_expected_deposit: z.string().nullable(),
      deposit_overdue: z.boolean(),
      deposit_streak: z.number(),
    })
    .nullable(),
  weekly: z.array(z.object({ week: z.string(), deposits: z.number(), link: z.number(), usd: z.number() })),
  performance: z
    .object({ best: PricePointSchema.nullable(), worst: PricePointSchema.nullable(), above: z.number().nullable(), below: z.number().nullable() })
    .nullable(),
  transfers: z.array(TransferViewSchema),
  latest_transfer: TransferViewSchema.nullable(),
});

export const ReplayFileSchema = z.object({
  ...envelope,
  since: z.string().nullable(),
  chains: z.array(
    z.object({ selector: z.string(), name: z.string().nullable(), display_name: z.string().nullable(), first_day: z.string() }),
  ),
  lanes: z.array(z.tuple([z.number(), z.number()])),
  days: z.array(z.object({ day: z.string(), lanes: z.array(z.tuple([z.number(), z.number(), z.number()])) })),
});

export const PUBLIC_SCHEMAS = {
  'status.json': StatusFileSchema,
  'live.json': LiveFileSchema,
  'today.json': TodayFileSchema,
  'history.json': HistoryFileSchema,
  'top/lane.json': TopFileSchema,
  'top/token.json': TopFileSchema,
  'top/sender.json': TopFileSchema,
  'top/src_chain.json': TopFileSchema,
  'top/dst_chain.json': TopFileSchema,
  'chains.json': ChainsFileSchema,
  'tokens.json': TokensFileSchema,
  'reserve.json': ReserveFileSchema,
  'replay.json': ReplayFileSchema,
} as const;

export type PublicFileName = keyof typeof PUBLIC_SCHEMAS;
export type PublicFile<N extends PublicFileName> = z.infer<(typeof PUBLIC_SCHEMAS)[N]>;

export type StatusFile = z.infer<typeof StatusFileSchema>;
export type LiveMessage = z.infer<typeof LiveMessageSchema>;
export type LiveFile = z.infer<typeof LiveFileSchema>;
export type DayTotals = z.infer<typeof DayTotalsSchema>;
export type TopEntry = z.infer<typeof TopEntrySchema>;
export type TodayFile = z.infer<typeof TodayFileSchema>;
export type HistoryFile = z.infer<typeof HistoryFileSchema>;
export type TopFile = z.infer<typeof TopFileSchema>;
export type Chain = z.infer<typeof ChainSchema>;
export type ChainsFile = z.infer<typeof ChainsFileSchema>;
export type Token = z.infer<typeof TokenSchema>;
export type TokensFile = z.infer<typeof TokensFileSchema>;
export type TransferView = z.infer<typeof TransferViewSchema>;
export type ReserveFile = z.infer<typeof ReserveFileSchema>;
export type ReplayFile = z.infer<typeof ReplayFileSchema>;
