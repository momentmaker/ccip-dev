import { z } from 'zod';
import { MILESTONE_METRICS } from './records';

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
  fee_native_usd: z.number().nullable().optional(),
  fee_stable_usd: z.number().nullable().optional(),
  fee_link_amount: z.number().nullable().optional(),
});

/** A sender identity's fields, all optional so files published before identities still parse. */
const identityFields = {
  x: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  inferred: z.boolean().optional(),
  chains: z.array(z.string()).optional(),
  addresses: z.number().optional(),
  share_pct: z.number().nullable().optional(),
};

export const TopEntrySchema = z.object({
  key: z.string(),
  messages: z.number(),
  usd: z.number().nullable(),
  fee_usd: z.number().nullable().optional(),
  symbol: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  ...identityFields,
});

export const TodayFileSchema = z.object({
  ...envelope,
  day: z.string(),
  totals: DayTotalsSchema.extend({ fee_link_share_pct: z.number().nullable() }),
  top: z.object({ lane: z.array(TopEntrySchema), token: z.array(TopEntrySchema), sender: z.array(TopEntrySchema) }),
  arrivals: z.array(z.object({ kind: z.string(), key: z.string(), first_seen: z.string() })),
});

export const LargestFeeSchema = z.object({
  message_id: z.string(),
  day: z.string(),
  src: z.string(),
  dst: z.string(),
  fee_usd: z.number(),
  symbol: z.string().nullable(),
});

export const HistoryFileSchema = z.object({
  ...envelope,
  since: z.string().nullable(),
  days: z.array(DayTotalsSchema),
  largest_fees: z.array(LargestFeeSchema).optional(),
});

const TopWindowsSchema = z.object({ '7d': z.array(TopEntrySchema), '30d': z.array(TopEntrySchema), all: z.array(TopEntrySchema) });

export const TopFileSchema = z.object({
  ...envelope,
  dim: z.enum(['src_chain', 'dst_chain', 'lane', 'token', 'sender']),
  since: z.string().nullable(),
  windows: TopWindowsSchema,
  by_fees: TopWindowsSchema.optional(),
  /** Senders by identity; `windows` and `by_fees` keep their per-chain keys for consumers that predate identities. */
  identities: TopWindowsSchema.optional(),
  identities_by_fees: TopWindowsSchema.optional(),
});

const CostSplitSchema = z.object({ messages: z.number(), median_usd: z.number() });

export const CostLaneSchema = z.object({
  src: z.string(),
  dst: z.string(),
  messages: z.number(),
  median_usd: z.number(),
  p10_usd: z.number(),
  p90_usd: z.number(),
  link: CostSplitSchema.optional(),
  gas: CostSplitSchema.optional(),
});

export const CostFileSchema = z.object({ ...envelope, from: z.string(), to: z.string(), lanes: z.array(CostLaneSchema) });

export const LeaderSchema = z.object({
  key: z.string(),
  label: z.string().nullable(),
  messages: z.number(),
  usd: z.number().nullable(),
  fee_usd: z.number().nullable(),
  ...identityFields,
});

export const DayLeadersSchema = z.object({
  day: z.string(),
  token: LeaderSchema.nullable(),
  sender: LeaderSchema.nullable(),
  lane: LeaderSchema.nullable(),
  fee_lane: LeaderSchema.nullable(),
  fee_chain: LeaderSchema.nullable(),
});

export const WeekLeadersSchema = z.object({ week: z.string(), fee_chains: z.array(LeaderSchema) });

export const DayLeadersFileSchema = z.object({ ...envelope, days: z.array(DayLeadersSchema), weeks: z.array(WeekLeadersSchema) });

export const POLL_KINDS = ['fee_chain', 'fees_change', 'lane'] as const;
export type PollKind = (typeof POLL_KINDS)[number];

export const BoardEntrySchema = z.object({
  key: z.string(),
  label: z.string().nullable(),
  value: z.number(),
  rank: z.number(),
  previous_rank: z.number().nullable(),
});

export const SpotlightSchema = z.object({
  selector: z.string(),
  rank: z.number(),
  messages: z.number(),
  previous_messages: z.number(),
  usd: z.number(),
  previous_usd: z.number(),
  fee_usd: z.number().nullable(),
  previous_fee_usd: z.number().nullable(),
  partners: z.array(z.string()),
  token: z.object({ key: z.string(), label: z.string().nullable(), usd: z.number() }).nullable(),
});

export const MomentsWeekSchema = z.object({
  week: z.string(),
  boards: z.object({ fee_chains: z.array(BoardEntrySchema), tokens: z.array(BoardEntrySchema), lanes: z.array(BoardEntrySchema) }),
  spotlight: SpotlightSchema.nullable(),
});

const PollOptionSchema = z.object({ key: z.string(), label: z.string() });

export const PollSchema = z.object({
  week: z.string(),
  question_kind: z.enum(POLL_KINDS),
  question: z.string(),
  options: z.array(PollOptionSchema),
  answer: z.string().nullable(),
  outcome: z.object({ key: z.string(), label: z.string(), value: z.number(), change_pct: z.number().nullable() }).nullable(),
  votes: z.array(z.number()).nullable(),
  total_votes: z.number().nullable(),
});

export const MomentsFileSchema = z.object({
  ...envelope,
  network: z.object({ chains: z.number(), lanes: z.number() }),
  arrivals: z.object({
    chains: z.array(z.object({ selector: z.string(), day: z.string(), number: z.number(), partners: z.array(z.string()), messages: z.number(), usd: z.number() })),
    lanes: z.array(z.object({ key: z.string(), day: z.string(), messages: z.number(), usd: z.number() })),
    tokens: z.array(z.object({ key: z.string(), symbol: z.string().nullable(), day: z.string(), chains: z.array(z.string()), usd: z.number() })),
  }),
  weeks: z.array(MomentsWeekSchema),
  countdowns: z.array(
    z.object({
      metric: z.enum(MILESTONE_METRICS),
      threshold: z.number(),
      total: z.number(),
      per_day: z.number(),
      days_left: z.number(),
      previous: z.object({ threshold: z.number(), day: z.string() }).nullable(),
    }),
  ),
  polls: z.array(PollSchema),
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
  deposit: z.boolean().optional(),
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
  'cost.json': CostFileSchema,
  'day-leaders.json': DayLeadersFileSchema,
  'moments.json': MomentsFileSchema,
} as const;

export type PublicFileName = keyof typeof PUBLIC_SCHEMAS;
export type PublicFile<N extends PublicFileName> = z.infer<(typeof PUBLIC_SCHEMAS)[N]>;

export type StatusFile = z.infer<typeof StatusFileSchema>;
export type LiveMessage = z.infer<typeof LiveMessageSchema>;
export type LiveFile = z.infer<typeof LiveFileSchema>;
export type DayTotals = z.infer<typeof DayTotalsSchema>;
export type LargestFee = z.infer<typeof LargestFeeSchema>;
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
export type CostLane = z.infer<typeof CostLaneSchema>;
export type CostFile = z.infer<typeof CostFileSchema>;
export type Leader = z.infer<typeof LeaderSchema>;
export type DayLeaders = z.infer<typeof DayLeadersSchema>;
export type WeekLeaders = z.infer<typeof WeekLeadersSchema>;
export type DayLeadersFile = z.infer<typeof DayLeadersFileSchema>;
export type BoardEntry = z.infer<typeof BoardEntrySchema>;
export type Spotlight = z.infer<typeof SpotlightSchema>;
export type MomentsWeek = z.infer<typeof MomentsWeekSchema>;
export type Poll = z.infer<typeof PollSchema>;
export type MomentsFile = z.infer<typeof MomentsFileSchema>;
