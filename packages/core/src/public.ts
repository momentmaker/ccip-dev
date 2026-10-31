import { z } from 'zod';
import { MILESTONE_METRICS } from './records';
import { HOLDER_KINDS } from './staking';

const envelope = {
  schema_version: z.literal(1),
  updated_at: z.string(),
  attribution: z.string(),
};

export const TOP_WINDOWS = ['7d', '30d', 'all'] as const;
export type TopWindow = (typeof TOP_WINDOWS)[number];

export const LabelCoverageSchema = z.object({
  messages_pct: z.number().nullable(),
  usd_pct: z.number().nullable(),
  fees_pct: z.number().nullable(),
  via_token_messages_pct: z.number().nullable().optional(),
  via_token_usd_pct: z.number().nullable().optional(),
  via_token_fees_pct: z.number().nullable().optional(),
  window: z.literal('7d'),
});

export const StatusFileSchema = z.object({
  ...envelope,
  last_ingest_ok_at: z.string().nullable(),
  lag_seconds: z.number().nullable(),
  last_finalize_day: z.string().nullable(),
  coverage_from: z.string().nullable(),
  label_coverage: LabelCoverageSchema.nullable().optional(),
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
  data_messages: z.number().nullable().optional(),
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
  via_token_messages: z.number().optional(),
  via_token_usd: z.number().nullable().optional(),
  via_token_fee_usd: z.number().nullable().optional(),
  via_token: z.boolean().optional(),
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

export const ProjectSpotlightSchema = z.object({
  key: z.string(),
  slug: z.string(),
  name: z.string(),
  x: z.string().nullable(),
  kind: z.string(),
  inferred: z.boolean(),
  messages: z.number(),
  previous_messages: z.number(),
  usd: z.number(),
  fee_usd: z.number().nullable(),
  chains: z.array(z.string()),
  /** The part of `messages` credited via the project's claimed tokens; a file from before via token has none. */
  via_token_messages: z.number().optional(),
});

export const MomentsWeekSchema = z.object({
  week: z.string(),
  boards: z.object({ fee_chains: z.array(BoardEntrySchema), tokens: z.array(BoardEntrySchema), lanes: z.array(BoardEntrySchema) }),
  spotlight: SpotlightSchema.nullable(),
  project: ProjectSpotlightSchema.nullable().optional(),
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

export const SenderArrivalSchema = z.object({
  key: z.string(),
  label: z.string().nullable(),
  x: z.string().nullable(),
  kind: z.string().nullable(),
  inferred: z.boolean(),
  /** The day it entered the day's top 10. */
  day: z.string(),
  /** Its first message's day, over all its addresses. */
  first_day: z.string(),
  rank: z.number(),
  messages: z.number(),
  /** Its messages from its first day through `day`. */
  total_messages: z.number(),
  chains: z.array(z.string()),
  /** The part of `messages` credited via the project's claimed tokens; a file from before via token has none. */
  via_token_messages: z.number().optional(),
});

export const MomentsFileSchema = z.object({
  ...envelope,
  network: z.object({ chains: z.number(), lanes: z.number() }),
  arrivals: z.object({
    chains: z.array(z.object({ selector: z.string(), day: z.string(), number: z.number(), partners: z.array(z.string()), messages: z.number(), usd: z.number() })),
    lanes: z.array(z.object({ key: z.string(), day: z.string(), messages: z.number(), usd: z.number() })),
    tokens: z.array(z.object({ key: z.string(), symbol: z.string().nullable(), day: z.string(), chains: z.array(z.string()), usd: z.number() })),
    senders: z.array(SenderArrivalSchema).optional(),
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

const ProjectWindowSchema = z.object({
  messages: z.number(),
  usd: z.number(),
  fee_usd: z.number().nullable(),
  share_pct: z.number().nullable(),
  /** The part of `messages` and `usd` credited via the project's claimed tokens. */
  via_token_messages: z.number().optional(),
  via_token_usd: z.number().optional(),
});

export const ProjectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  x: z.string().nullable(),
  url: z.string().nullable(),
  kind: z.string(),
  source: z.string().nullable(),
  totals: z.object({ '7d': ProjectWindowSchema, '30d': ProjectWindowSchema, all: ProjectWindowSchema }),
  series: z.array(z.object({ day: z.string(), messages: z.number() })),
  chains: z.array(z.string()),
  lanes: z.array(z.object({ src: z.string(), dst: z.string(), messages: z.number(), usd: z.number() })),
  split: z.object({ data_messages: z.number(), token_messages: z.number() }),
  addresses: z.array(z.object({ chain: z.string(), address: z.string(), note: z.string().nullable(), inferred: z.boolean() })),
  tokens: z.array(z.object({ chain: z.string(), address: z.string(), symbol: z.string().nullable(), source: z.string() })).optional(),
});

export const ProjectsFileSchema = z.object({ ...envelope, from: z.string(), to: z.string(), projects: z.array(ProjectSchema) });

const QueueSplitSchema = z.object({ stakers: z.number(), link: z.number(), stakelink_stakers: z.number(), stakelink_link: z.number() });
const RatioSchema = z.object({ left: z.number(), total: z.number() });
const HolderKindSchema = z.enum(HOLDER_KINDS);

export const StakingFileSchema = z.object({
  ...envelope,
  as_of_block: z.number(),
  /** The first staking event's time. */
  since: z.string(),
  periods: z.object({ unbonding_s: z.number(), claim_s: z.number() }),
  community: z.object({
    total: z.number(), cap: z.number(), min_stake: z.number(), max_stake: z.number(), stakers: z.number(), ever: z.number(),
    at_max: z.number(), median: z.number(), mean: z.number(), full_since: z.string().nullable(),
  }),
  operator: z.object({
    total: z.number(), cap: z.number(), min_stake: z.number(), max_stake: z.number(), stakers: z.number(), allowlisted: z.number(), removed: z.number(), at_max: z.number(),
  }),
  /** The reward vault's emission, in LINK a second, and the yearly rate it pays on each pool's principal. */
  rewards: z
    .object({
      community_per_s: z.number(), operator_per_s: z.number(), delegated_per_s: z.number(), ends_at: z.string(),
      community_rate_pct: z.number().nullable(), operator_rate_pct: z.number().nullable(),
    })
    .nullable(),
  holders: z.array(z.object({ kind: HolderKindSchema, stakers: z.number(), link: z.number() })),
  sizes: z.array(z.object({ min: z.number(), max: z.number().nullable(), stakers: z.number(), link: z.number() })),
  tenure: z.object({ first_month: z.number(), median_days: z.number(), by_year: z.array(z.object({ year: z.string(), stakers: z.number() })) }),
  queue: z.object({
    unbonding: QueueSplitSchema,
    claimable: QueueSplitSchema,
    /** LINK from stakers in their unbonding period, by the day their claim window opens (UTC). */
    days: z.array(z.object({ day: z.string(), link: z.number(), stakelink_link: z.number(), stakers: z.number() })),
    /** Claim windows that closed in the last 7 days, by the day they closed. */
    closed: z.array(z.object({ day: z.string(), left: z.number(), stayed: z.number(), stakelink_stayed: z.number() })),
    conversion: z.object({ others: RatioSchema, stakelink: RatioSchema }),
    likely_to_leave: z.number(),
    lapsed: z.number(),
  }),
  refills: z.object({
    openings: z.number(), median_s: z.number(), p90_s: z.number(), same_block: z.number(), next_block: z.number(), hunters: z.number(),
    leaders: z.array(z.object({ address: z.string(), grabs: z.number(), link: z.number(), fastest_s: z.number() })),
    recent: z.array(z.object({ opened_at: z.string(), gap: z.number(), seconds: z.number().nullable(), blocks: z.number().nullable(), grabs: z.array(z.string()) })),
  }),
  weeks: z.array(z.object({ week: z.string(), staked: z.number(), unstaked: z.number(), unbondings: z.number(), unbonding_link: z.number(), new_stakers: z.number(), openings: z.number() })),
  operators: z.array(z.object({ address: z.string(), name: z.string().nullable(), via: HolderKindSchema, stake: z.number(), since: z.string().nullable(), status: z.enum(['active', 'removed']) })),
  operator_events: z.array(
    z.object({ ts: z.string(), kind: z.enum(['added', 'removed', 'staked', 'unstaked', 'unbonding']), address: z.string(), name: z.string().nullable(), amount: z.number().nullable(), stake: z.number().nullable() }),
  ),
  stakelink: z.object({ community_vaults: z.number(), community_link: z.number(), operator_vaults: z.number(), operator_link: z.number() }),
});

/**
 * Every current staker whose address starts 0x<shard>: address, pool (c or o), principal, first stake, unbonding start,
 * holder, place by first stake and by principal among the pool's current stakers (1 is the earliest and the largest),
 * and how many times it took space that opened in the full community pool.
 */
export const StakersFileSchema = z.object({
  ...envelope,
  as_of_block: z.number(),
  stakers: z.array(
    z.tuple([z.string(), z.enum(['c', 'o']), z.number(), z.string(), z.string().nullable(), HolderKindSchema, z.number(), z.number(), z.number()]),
  ),
});

export const STAKER_SHARDS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'] as const;
export type StakerShardName = `stakers/${(typeof STAKER_SHARDS)[number]}.json`;
/** The stakers file that holds an address. */
export const stakerShard = (address: string): StakerShardName => `stakers/${address.slice(2, 3).toLowerCase() as (typeof STAKER_SHARDS)[number]}.json`;
const STAKER_SHARD_SCHEMAS = Object.fromEntries(STAKER_SHARDS.map((h) => [`stakers/${h}.json`, StakersFileSchema])) as Record<StakerShardName, typeof StakersFileSchema>;

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
  'projects.json': ProjectsFileSchema,
  'staking.json': StakingFileSchema,
  ...STAKER_SHARD_SCHEMAS,
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
export type ProjectSpotlight = z.infer<typeof ProjectSpotlightSchema>;
export type MomentsWeek = z.infer<typeof MomentsWeekSchema>;
export type Poll = z.infer<typeof PollSchema>;
export type MomentsFile = z.infer<typeof MomentsFileSchema>;
export type SenderArrival = z.infer<typeof SenderArrivalSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectsFile = z.infer<typeof ProjectsFileSchema>;
export type StakingFile = z.infer<typeof StakingFileSchema>;
export type StakersFile = z.infer<typeof StakersFileSchema>;
