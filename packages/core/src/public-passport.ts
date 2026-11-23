import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { CHECK_KINDS, DESIGN_REASONS, REASON_CODES, type CheckValue, type PartyFact, type PartyRole, type PointerState } from './passport-checks';
import type { VerifiedVia } from './passport-notes';
import { envelope, STAKER_SHARDS } from './public';

const CheckValueSchema = z.enum(['flagged', 'clear', 'not readable'] as const satisfies readonly CheckValue[]);
const PARTY_ROLES = ['poolOwner', 'registryAdministrator', 'rateLimitAdmin', 'hooksOwner', 'proxyAdmin'] as const satisfies readonly PartyRole[];
const PARTY_KINDS = ['wallet', 'delegated-wallet', 'safe', 'mcms', 'timelock', 'absent', 'no-key', 'unidentified', 'unanswered'] as const satisfies readonly PartyFact['kind'][];
const POINTER_STATES = ['points', 'no-lane', 'wrong-token', 'pool-not-listed', 'not readable'] as const satisfies readonly PointerState[];
const PartyRoleSchema = z.enum(PARTY_ROLES);
const PassportRowRefSchema = z.object({ chain: z.string(), address: z.string() });

/** The three flag-capable results rolled up per check: flagged over "not readable" over clear; null for a check with no result. */
export const PassportRollupSchema = z.object({ 'single-key': CheckValueSchema.nullable(), 'rate-limit': CheckValueSchema.nullable(), 'pool-pointer': CheckValueSchema.nullable() });

/** A team's statement (R27): its own words, with the day it was said and the day the operator attached it. */
export const PassportStatementSchema = z.object({
  answers: CheckValueSchema,
  text: z.string(),
  said_on: z.string(),
  attached_on: z.string(),
  verified_via: z.enum(['x', 'website', 'signature'] as const satisfies readonly VerifiedVia[]),
  verified_source: z.string(),
});

/** Every result carries a reason code, never prose; `statements` holds those that answer the result's current value. */
const resultFields = {
  key: z.string(),
  value: CheckValueSchema,
  reason: z.enum(REASON_CODES),
  read_on: z.string().nullable(),
  basis: z.string(),
  corrected: z.boolean(),
  statements: z.array(PassportStatementSchema),
};

export const PassportSingleKeySchema = z.object({
  ...resultFields,
  pool_type: z.string().nullable(),
  parties: z.array(z.object({ role: PartyRoleSchema, address: z.string().nullable(), kind: z.enum(PARTY_KINDS), signers: z.number().nullable(), keys: z.number().nullable() })),
  decided_by: z.array(PartyRoleSchema),
});

const FinalitySchema = z.enum(['standard', 'fast']);
/** The most that can leave in an hour, in raw units and token units; `usd` is priced at publish time and is null without a price. */
export const PassportPerHourSchema = z.union([
  z.object({ finality: FinalitySchema, limit: z.literal('off') }),
  z.object({ finality: FinalitySchema, limit: z.literal('on'), units: z.string(), tokens: z.string().nullable(), usd: z.number().nullable() }),
]);

const VerifierRefSchema = z.object({ address: z.string(), name: z.string().nullable() });
const DirectionSchema = z.enum(['outbound', 'inbound']);
export const PassportVerifierLineSchema = z.union([
  z.object({ direction: z.literal('outbound'), state: z.literal('ccip-1x') }),
  z.object({
    direction: DirectionSchema,
    state: z.literal('listed'),
    verifiers: z.array(VerifierRefSchema),
    threshold: z.object({ units: z.string().nullable(), tokens: z.string().nullable(), verifiers: z.array(VerifierRefSchema) }).nullable(),
  }),
  z.object({ direction: DirectionSchema, state: z.literal('not readable') }),
]);

export const PassportRateLimitSchema = z.object({
  ...resultFields,
  per_hour: z.array(PassportPerHourSchema),
  /** The receiving row's inbound limit, a note that raises no flag (R36). */
  receiving_inbound: z.enum(['on', 'off', 'not readable']).nullable(),
  verifiers: z.array(PassportVerifierLineSchema),
});

/** A pool-pointer result belongs to a pair of rows and appears on the lane of each; `other` has no address when the group has no row there. */
export const PassportPointerSchema = z.object({
  ...resultFields,
  other: z.object({ chain: z.string(), address: z.string().nullable() }),
  sides: z.array(z.object({ from: PassportRowRefSchema, to: z.string(), state: z.enum(POINTER_STATES) })),
});

/** One lane of a row: its remote chain (null when the row's lanes are unknown and the group has no other chain). */
export const PassportLaneSchema = z.object({
  remote_chain: z.string().nullable(),
  rate_limit: PassportRateLimitSchema.nullable(),
  pointers: z.array(PassportPointerSchema),
});

/** One registry row. A row "no longer listed" since `delisted_on` has no results; `read_on` is its last reading's day. */
export const PassportChainRowSchema = z.object({
  chain: z.string(),
  address: z.string(),
  pool: z.string().nullable(),
  read_on: z.string().nullable(),
  delisted_on: z.string().nullable(),
  unreadable: z.enum(DESIGN_REASONS).nullable(),
  single_key: PassportSingleKeySchema.nullable(),
  lanes: z.array(PassportLaneSchema),
});

const logFields = { day: z.string(), chain: z.string(), address: z.string() };
/**
 * The dated log (R16) in date order. A statement whose result no longer has the value it answers moves here, dated the
 * day it was attached; `from` and `to` of a setting are the stored values as read.
 */
export const PassportLogEntrySchema = z.union([
  z.object({ ...logFields, kind: z.literal('first-reading') }),
  z.object({ ...logFields, kind: z.enum(['setting', 'pool-replaced']), setting: z.string(), from: z.unknown(), to: z.unknown() }),
  z.object({ ...logFields, kind: z.literal('re-classified'), unit: z.string(), from: CheckValueSchema.nullable(), to: CheckValueSchema }),
  z.object({ ...logFields, kind: z.literal('correction'), unit: z.string(), from: CheckValueSchema.nullable(), to: CheckValueSchema, basis: z.string() }),
  z.object({ ...logFields, kind: z.literal('statement'), unit: z.string(), statement: PassportStatementSchema }),
]);

const passportTokenFields = {
  /** The page id: the registry group id, or `<selector>:<address>` for a row with no group. */
  id: z.string(),
  name: z.string(),
  symbol: z.string().nullable(),
  /** The slug of the project ccip.dev's labels tie the token to. */
  project: z.string().nullable(),
  chains: z.array(z.string()),
  results: PassportRollupSchema,
};

export const PassportTokenSchema = z.object({ ...passportTokenFields, rows: z.array(PassportChainRowSchema), log: z.array(PassportLogEntrySchema) });

/** A result a post names, taken apart from its key so a card needs nothing else. */
const PassportUnitRefSchema = z.object({
  unit: z.string(),
  check: z.enum(CHECK_KINDS),
  chain: z.string(),
  address: z.string(),
  remote_chain: z.string().nullable(),
  remote_address: z.string().nullable(),
});

/** One post record (KTD16), as stored when its day was evaluated. */
export const PassportEventSchema = z.union([
  z.object({
    id: z.string(),
    day: z.string(),
    kind: z.literal('token'),
    token_id: z.string(),
    name: z.string(),
    chains: z.array(z.string()),
    changes: z.array(PassportUnitRefSchema.extend({ kind: z.enum(['raised', 'cleared']), correction: z.boolean() })),
    arrivals: z.array(
      z.object({
        kind: z.enum(['new token', 'new chain']),
        chains: z.array(z.object({ chain: z.string(), address: z.string(), readable: z.boolean(), flags: z.array(PassportUnitRefSchema) })),
        other_chain_flags: z.number(),
      }),
    ),
  }),
  z.object({
    id: z.string(),
    day: z.string(),
    kind: z.literal('summary'),
    tokens: z.array(z.object({ token_id: z.string(), name: z.string().nullable() })),
    counts: z.object({ raised: z.number(), cleared: z.number(), new_token: z.number(), new_chain: z.number() }),
  }),
]);

/** `day` is the evaluated day and `since` the day recording began. `latest` holds the newest post records, newest first. */
export const PassportIndexFileSchema = z.object({
  ...envelope,
  day: z.string(),
  since: z.string(),
  tokens: z.array(z.object({ ...passportTokenFields, addresses: z.array(z.string()) })),
  latest: z.array(PassportEventSchema),
});

export const PassportShardFileSchema = z.object({ ...envelope, day: z.string(), since: z.string(), tokens: z.array(PassportTokenSchema) });

/** Post records from `from` on, newest first. */
export const PassportEventsFileSchema = z.object({ ...envelope, from: z.string(), events: z.array(PassportEventSchema) });

export const PASSPORT_SHARDS = STAKER_SHARDS;
export type PassportShardName = `passport/${(typeof PASSPORT_SHARDS)[number]}.json`;
const REGISTRY_GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The shard that holds a token page. A registry group id, a UUID, gives its first hex digit; any other page id, such as
 * `<selector>:<address>` for a row with no group, gives the first hex digit of its SHA-256, so it lands in exactly one shard
 * and such rows spread over all sixteen.
 */
export function passportShard(id: string): PassportShardName {
  const digit = REGISTRY_GROUP_ID.test(id) ? id[0]!.toLowerCase() : (sha256(utf8ToBytes(id))[0]! >> 4).toString(16);
  return `passport/${digit as (typeof PASSPORT_SHARDS)[number]}.json`;
}
const PASSPORT_SHARD_SCHEMAS = Object.fromEntries(PASSPORT_SHARDS.map((h) => [`passport/${h}.json`, PassportShardFileSchema])) as Record<PassportShardName, typeof PassportShardFileSchema>;

export const PASSPORT_SCHEMAS = {
  'passport.json': PassportIndexFileSchema,
  'passport-events.json': PassportEventsFileSchema,
  ...PASSPORT_SHARD_SCHEMAS,
} as const;

export type PassportFileName = keyof typeof PASSPORT_SCHEMAS;
export type PassportFile<N extends PassportFileName> = z.infer<(typeof PASSPORT_SCHEMAS)[N]>;

export type PassportIndexFile = z.infer<typeof PassportIndexFileSchema>;
export type PassportShardFile = z.infer<typeof PassportShardFileSchema>;
export type PassportEventsFile = z.infer<typeof PassportEventsFileSchema>;
export type PassportToken = z.infer<typeof PassportTokenSchema>;
export type PassportChainRow = z.infer<typeof PassportChainRowSchema>;
export type PassportLane = z.infer<typeof PassportLaneSchema>;
export type PassportLogEntry = z.infer<typeof PassportLogEntrySchema>;
export type PassportEvent = z.infer<typeof PassportEventSchema>;
export type PassportStatementView = z.infer<typeof PassportStatementSchema>;
