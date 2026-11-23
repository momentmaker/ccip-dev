import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { sanitize } from './normalize';
import { METHOD_VERSION, type PartyClassification, type PartyKind } from './passport-principals';
import type { Parties, PoolVerifiers, RateLimit, RawLane, RawSettings, Readable } from './passport-read';

export const CHECK_KINDS = ['single-key', 'rate-limit', 'pool-pointer'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export type CheckValue = 'flagged' | 'clear' | 'not readable';

/** Rows ccip.dev cannot read at all (KTD8). */
export const DESIGN_REASONS = ['non-evm-chain', 'no-endpoint', 'no-registry'] as const;
export type DesignReason = (typeof DESIGN_REASONS)[number];

/** Every reason a result can carry; the site maps each one to a plain note. */
export const REASON_CODES = [
  ...DESIGN_REASONS,
  'never-read',
  'reading-too-old',
  'single-key',
  'multi-signer',
  'no-party-can-act',
  'party-unidentified',
  'proxy-status-unknown',
  'pool-type-not-recognised',
  'limit-on',
  'limit-off',
  'limit-not-readable',
  'proxy-pool',
  'lanes-not-readable',
  'pools-point-at-each-other',
  'pointer-broken',
  'pointer-not-readable',
  'remote-chain-not-in-group',
  'read-on-different-days',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** A reading keeps its results this many days after it was taken (R31). */
export const STALE_AFTER_DAYS = 7;
/** getAllowedFinalityConfig()'s answer when a pool allows only transfers that wait for finality. */
export const WAIT_FOR_FINALITY = '0x00000000';
export const ETHEREUM_SELECTOR = '5009297550715157269';

const DAY_MS = 86_400_000;
const HOUR_S = 3600n;
const BASIS_HEX = 16;

export interface RowRef {
  chain: string;
  token: string;
}

/** A row's last successful reading, with its parties classified at the same block. */
export interface StoredReading {
  /** UTC day of the reading's pinned block. */
  readOn: string;
  settings: RawSettings;
  /** Classifications by lowercase address, covering every party address in `settings`. */
  parties: Readonly<Record<string, PartyClassification>>;
}

export interface PassportRow {
  /** Chain selector. */
  chain: string;
  token: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  priceUsd: number | null;
  unreadableByDesign: DesignReason | null;
  /** null when the row has never been read successfully. */
  reading: StoredReading | null;
}

/** An operator's correction; it applies only while the result's basis still matches (KTD15). */
export interface Correction {
  key: string;
  basis: string;
  value: CheckValue;
  reason: ReasonCode;
}

export interface EvaluateInput {
  /** One group's registry rows. */
  rows: readonly PassportRow[];
  corrections: readonly Correction[];
  /** The group's stored results from the last evaluation; a pair read on different days keeps its result from here. */
  previous: readonly CheckResult[];
  /** Verifier names by chain selector, then lowercase address (config/ccip-directory.json `verifiers`). */
  verifierNames: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** UTC day of the evaluation. */
  today: string;
}

export type PartyRole = keyof Parties;

export interface PartyFact {
  role: PartyRole;
  address: string | null;
  kind: PartyKind | 'unanswered';
  signers: number | null;
  /** A Safe's owners or an MCMS's signers: the keys the signers are drawn from. */
  keys: number | null;
}

export interface SingleKeyFacts {
  poolType: string | null;
  parties: PartyFact[];
  /** The parties that decided a flagged or "not readable" result. */
  decidedBy: PartyRole[];
}

export type PerHourFigure =
  | { finality: 'standard' | 'fast'; limit: 'off' }
  | { finality: 'standard' | 'fast'; limit: 'on'; units: string; tokens: string | null; usd: number | null };

export interface VerifierRef {
  address: string;
  /** null for a verifier the directory does not list: a custom verifier. */
  name: string | null;
}

export type VerifierLine =
  | { direction: 'outbound'; state: 'ccip-1x' }
  | {
      direction: 'outbound' | 'inbound';
      state: 'listed';
      verifiers: VerifierRef[];
      /** Verifiers added at or above an amount. */
      threshold: { units: string | null; tokens: string | null; verifiers: VerifierRef[] } | null;
    }
  | { direction: 'outbound' | 'inbound'; state: 'not readable' };

export interface LaneFacts {
  /** The standard figure, then the fast-finality figure when the pool allows fast finality and that limit is on. */
  perHour: PerHourFigure[];
  /** The receiving row's inbound limit for this lane (R36); null when the lane was not read. */
  receivingInbound: 'on' | 'off' | 'not readable' | null;
  verifiers: VerifierLine[];
}

export type PointerState = 'points' | 'no-lane' | 'wrong-token' | 'pool-not-listed' | 'not readable';

export interface PointerFacts {
  sides: { from: RowRef; to: string; state: PointerState }[];
}

interface ResultBase {
  key: string;
  value: CheckValue;
  reason: ReasonCode;
  /** The day of the reading the result rests on; null when it rests on none. */
  readOn: string | null;
  /** A short hash of the values that decided the result. */
  basis: string;
  corrected: boolean;
  methodVersion: number;
}

export interface SingleKeyResult extends ResultBase {
  check: 'single-key';
  row: RowRef;
  facts: SingleKeyFacts;
}

export interface RateLimitResult extends ResultBase {
  check: 'rate-limit';
  row: RowRef;
  /** null for a row whose lanes are unknown in a group with no other chain. */
  remoteChain: string | null;
  facts: LaneFacts;
}

export interface PoolPointerResult extends ResultBase {
  check: 'pool-pointer';
  /** The pair in chain order; the second has no token when the group has no row on that chain. */
  rows: [RowRef, RowRef | { chain: string; token: null }];
  facts: PointerFacts;
}

export type CheckResult = SingleKeyResult | RateLimitResult | PoolPointerResult;

type RowState =
  | { kind: 'design'; reason: DesignReason }
  | { kind: 'never' }
  | { kind: 'stale'; reading: StoredReading }
  | { kind: 'fresh'; reading: StoredReading };

interface Row {
  input: PassportRow;
  ref: RowRef;
  state: RowState;
}

interface Outcome {
  value: CheckValue;
  reason: ReasonCode;
  readOn: string | null;
  basis: unknown;
}

const ROLES: readonly PartyRole[] = ['poolOwner', 'registryAdministrator', 'rateLimitAdmin', 'hooksOwner', 'proxyAdmin'];

const hash = (value: unknown) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))).slice(0, BASIS_HEX);
const ageDays = (day: string, today: string) => (Date.parse(today) - Date.parse(day)) / DAY_MS;
const rowKey = (ref: RowRef) => `${ref.chain}:${ref.token}`;
const byChain = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
const byRef = (a: RowRef, b: RowRef) => byChain(a.chain, b.chain) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function rowState(row: PassportRow, today: string): RowState {
  if (row.unreadableByDesign !== null) return { kind: 'design', reason: row.unreadableByDesign };
  if (row.reading === null) return { kind: 'never' };
  return ageDays(row.reading.readOn, today) > STALE_AFTER_DAYS ? { kind: 'stale', reading: row.reading } : { kind: 'fresh', reading: row.reading };
}

/** The row's lanes from its stored reading, of any age; null when they are unknown. A row with no pool has none. */
function knownLanes(state: RowState): RawLane[] | null {
  if (state.kind === 'design' || state.kind === 'never') return null;
  const { lanes } = state.reading.settings;
  if ('value' in lanes) return lanes.value;
  return lanes.reason === 'no pool set' ? [] : null;
}

/** The outcome for every result of a row that has no fresh reading. */
function unreadableRow(state: Exclude<RowState, { kind: 'fresh' }>): Outcome {
  if (state.kind === 'design') return { value: 'not readable', reason: state.reason, readOn: null, basis: state.reason };
  if (state.kind === 'never') return { value: 'not readable', reason: 'never-read', readOn: null, basis: 'never-read' };
  return { value: 'not readable', reason: 'reading-too-old', readOn: state.reading.readOn, basis: 'reading-too-old' };
}

function formatUnits(units: bigint, decimals: number): string {
  const digits = units.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

function tokensOf(units: bigint, row: PassportRow): { units: string; tokens: string | null; usd: number | null } {
  const tokens = row.decimals === null ? null : formatUnits(units, row.decimals);
  return { units: units.toString(), tokens, usd: tokens !== null && row.priceUsd !== null ? Number(tokens) * row.priceUsd : null };
}

/** The most that can leave in one hour from a full bucket: its capacity plus an hour of refill. */
function perHour(finality: 'standard' | 'fast', limit: RateLimit, row: PassportRow): PerHourFigure {
  if (!limit.isEnabled) return { finality, limit: 'off' };
  return { finality, limit: 'on', ...tokensOf(BigInt(limit.capacity) + BigInt(limit.rate) * HOUR_S, row) };
}

function partyFacts(reading: StoredReading): PartyFact[] {
  const { settings, parties } = reading;
  return ROLES.flatMap((role): PartyFact[] => {
    const party = settings.parties[role];
    if (party.state === 'missing') return [];
    if (party.state === 'absent') return [{ role, address: null, kind: 'absent', signers: null, keys: null }];
    if (party.state === 'unanswered') return [{ role, address: null, kind: 'unanswered', signers: null, keys: null }];
    const classified = parties[party.address.toLowerCase()];
    if (classified === undefined) throw new Error(`the ${role} ${party.address} of token ${settings.token} has no classification`);
    const keys = classified.kind === 'safe' ? classified.safe.owners : classified.kind === 'mcms' ? classified.mcms.signers : null;
    return [{ role, address: party.address, kind: classified.kind, signers: classified.signers, keys }];
  });
}

/** A pool type the reader knows the roles of; a row with no pool has only its registry administrator. */
function recognisedPool(settings: RawSettings): boolean {
  const { poolType } = settings;
  return 'value' in poolType ? poolType.value.standard : poolType.reason === 'no pool set';
}

/** KTD7, R37 and R39: flagged when any party is one signer; never clear while any party is unknown or the pool type is not recognised. */
function singleKey(reading: StoredReading): Outcome & { facts: SingleKeyFacts } {
  const parties = partyFacts(reading);
  const { poolType } = reading.settings;
  const typeName = 'value' in poolType ? poolType.value.typeAndVersion : null;
  const basis = { poolType: typeName, recognised: recognisedPool(reading.settings), parties: parties.map((p) => [p.role, p.address, p.kind, p.signers]) };
  const outcome = (value: CheckValue, reason: ReasonCode, decidedBy: PartyRole[]) => ({ value, reason, readOn: reading.readOn, basis, facts: { poolType: typeName, parties, decidedBy } });

  const single = parties.filter((p) => p.signers === 1);
  if (single.length > 0) return outcome('flagged', 'single-key', single.map((p) => p.role));
  const unknown = parties.filter((p) => p.kind === 'unidentified' || p.kind === 'unanswered');
  if (unknown.length > 0) {
    const onlyProxy = unknown.every((p) => p.role === 'proxyAdmin' && p.kind === 'unanswered');
    return outcome('not readable', onlyProxy ? 'proxy-status-unknown' : 'party-unidentified', unknown.map((p) => p.role));
  }
  if (!recognisedPool(reading.settings)) return outcome('not readable', 'pool-type-not-recognised', []);
  return outcome('clear', parties.some((p) => p.signers !== null) ? 'multi-signer' : 'no-party-can-act', []);
}

function verifierRefs(addresses: readonly string[], names: Readonly<Record<string, string>>): VerifierRef[] {
  return [...new Set(addresses)].map((address) => ({ address, name: names[address.toLowerCase()] ?? null }));
}

/** Threshold verifiers apply only from a non-zero amount, so a zero amount adds no line. */
function threshold(list: readonly string[], amount: Readable<string> | null, row: PassportRow, names: Readonly<Record<string, string>>) {
  if (list.length === 0) return null;
  if (amount !== null && 'value' in amount && BigInt(amount.value) === 0n) return null;
  const figure = amount !== null && 'value' in amount ? tokensOf(BigInt(amount.value), row) : { units: null, tokens: null };
  return { units: figure.units, tokens: figure.tokens, verifiers: verifierRefs(list, names) };
}

/** KTD11: what the sending side requires, then the pool's inbound list as a second line. */
function verifierLines(lane: RawLane, row: PassportRow, settings: RawSettings, names: Readonly<Record<string, string>>): VerifierLine[] {
  const pool: Readable<PoolVerifiers> | null = 'reason' in lane.poolVerifiers && lane.poolVerifiers.reason === 'getter missing' ? null : lane.poolVerifiers;
  const amount = 'value' in settings.hooks && settings.hooks.value !== null ? settings.hooks.value.thresholdAmount : null;
  const lines: VerifierLine[] = [];

  if ('reason' in lane.laneVerifiers || (pool !== null && 'reason' in pool)) lines.push({ direction: 'outbound', state: 'not readable' });
  else if (lane.laneVerifiers.value.onRamp === '1.x') lines.push({ direction: 'outbound', state: 'ccip-1x' });
  else {
    const { mandated, defaults } = lane.laneVerifiers.value;
    const own = pool === null ? [] : pool.value.outbound;
    lines.push({
      direction: 'outbound',
      state: 'listed',
      verifiers: verifierRefs([...mandated, ...(own.length > 0 ? own : defaults)], names),
      threshold: pool === null ? null : threshold(pool.value.thresholdOutbound, amount, row, names),
    });
  }

  if (pool !== null && 'value' in pool && pool.value.inbound.length > 0) {
    lines.push({ direction: 'inbound', state: 'listed', verifiers: verifierRefs(pool.value.inbound, names), threshold: threshold(pool.value.thresholdInbound, amount, row, names) });
  }
  return lines;
}

/** The row on the lane's remote chain whose token the lane names. */
function rowNamedBy(rows: readonly Row[], lane: RawLane): Row | undefined {
  if (!('value' in lane.remoteToken)) return undefined;
  const token = lane.remoteToken.value;
  return rows.find((r) => r.ref.chain === lane.remoteChainSelector && sameAddress(r.ref.token, token));
}

function receivingInbound(rows: readonly Row[], from: Row, lane: RawLane): 'on' | 'off' | 'not readable' {
  const receiver = rowNamedBy(rows, lane);
  if (receiver === undefined || receiver.state.kind !== 'fresh') return 'not readable';
  const back = knownLanes(receiver.state)?.find((l) => l.remoteChainSelector === from.ref.chain);
  if (back === undefined || !('value' in back.inbound)) return 'not readable';
  return back.inbound.value.isEnabled ? 'on' : 'off';
}

/** R36 and KTD24: the sending side's standard outbound limit decides; a fast-finality limit adds a figure only when the pool allows fast finality. */
function rateLimit(rows: readonly Row[], row: Row, reading: StoredReading, lane: RawLane, names: Readonly<Record<string, string>>): Outcome & { facts: LaneFacts } {
  const { outbound, fastOutbound } = lane;
  const facts: LaneFacts = { perHour: [], receivingInbound: receivingInbound(rows, row, lane), verifiers: verifierLines(lane, row.input, reading.settings, names) };
  const basis = { outbound: 'value' in outbound ? outbound.value.isEnabled : outbound.reason };
  const outcome = (value: CheckValue, reason: ReasonCode) => ({ value, reason, readOn: reading.readOn, basis, facts });
  if (!('value' in outbound)) return outcome('not readable', 'limit-not-readable');
  facts.perHour.push(perHour('standard', outbound.value, row.input));
  if (!outbound.value.isEnabled) return outcome('flagged', 'limit-off');
  const { allowedFinality } = reading.settings;
  const allowsFast = 'value' in allowedFinality && allowedFinality.value !== WAIT_FOR_FINALITY;
  if (allowsFast && 'value' in fastOutbound && fastOutbound.value.isEnabled) facts.perHour.push(perHour('fast', fastOutbound.value, row.input));
  return outcome('clear', 'limit-on');
}

/** A lane that names another of the group's rows on `to`'s chain points at that sibling, not at `to`. */
function laneSide(from: Row, to: Row, group: readonly Row[]): PointerState {
  const lanes = knownLanes(from.state);
  if (lanes === null || to.state.kind === 'design' || to.state.kind === 'never') return 'not readable';
  const lane = lanes.find((l) => l.remoteChainSelector === to.ref.chain);
  if (lane === undefined) return 'no-lane';
  if (!('value' in lane.remoteToken) || !('value' in lane.remotePools)) return 'not readable';
  const remoteToken = lane.remoteToken.value;
  if (!sameAddress(remoteToken, to.ref.token)) {
    const sibling = group.some((r) => r !== to && r.ref.chain === to.ref.chain && sameAddress(remoteToken, r.ref.token));
    return sibling ? 'no-lane' : 'wrong-token';
  }
  const pool = to.state.reading.settings.pool;
  return lane.remotePools.value.some((p) => sameAddress(p, pool)) ? 'points' : 'pool-not-listed';
}

const lists = (from: Row, to: Row) => knownLanes(from.state)?.some((l) => l.remoteChainSelector === to.ref.chain) ?? false;
const lanesUnknown = (row: Row) => knownLanes(row.state) === null;

function laneBasis(from: Row, to: Row): unknown {
  if (from.state.kind === 'design' || from.state.kind === 'never') return from.state.kind;
  const { lanes, pool, token } = from.state.reading.settings;
  if (!('value' in lanes)) return { token, pool, lanes: lanes.reason };
  const lane = lanes.value.find((l) => l.remoteChainSelector === to.ref.chain);
  return { token, pool, lane: lane === undefined ? null : { remoteToken: lane.remoteToken, remotePools: lane.remotePools } };
}

/** KTD10 for a pair read on the same day: one flag when either side fails to point at the other; null when neither lists the other. */
function pointer(a: Row, b: Row, group: readonly Row[], readOn: string): (Outcome & { facts: PointerFacts }) | null {
  const sides = [
    { from: a.ref, to: b.ref.chain, state: laneSide(a, b, group) },
    { from: b.ref, to: a.ref.chain, state: laneSide(b, a, group) },
  ];
  const [ab, ba] = sides.map((s) => s.state) as [PointerState, PointerState];
  if (ab === 'no-lane' && ba === 'no-lane') return null;
  const listed = (s: PointerState) => s === 'points' || s === 'wrong-token' || s === 'pool-not-listed';
  const broken = sides.some((s) => s.state === 'wrong-token' || s.state === 'pool-not-listed') || (ab === 'no-lane' && listed(ba)) || (ba === 'no-lane' && listed(ab));
  const basis = [laneBasis(a, b), laneBasis(b, a)];
  const facts = { sides };
  if (broken) return { value: 'flagged', reason: 'pointer-broken', readOn, basis, facts };
  if (ab === 'not readable' || ba === 'not readable') {
    const proxy = [a, b].some((r) => r.state.kind === 'fresh' && 'reason' in r.state.reading.settings.lanes && r.state.reading.settings.lanes.reason === 'proxy pool');
    return { value: 'not readable', reason: proxy ? 'proxy-pool' : 'pointer-not-readable', readOn, basis, facts };
  }
  return { value: 'clear', reason: 'pools-point-at-each-other', readOn, basis, facts };
}

const finish = (check: CheckKind, key: string, outcome: Outcome) => ({
  key,
  value: outcome.value,
  reason: outcome.reason,
  readOn: outcome.readOn,
  basis: hash({ check, decided: outcome.basis }),
  corrected: false,
  methodVersion: METHOD_VERSION,
});

const NO_PARTIES: SingleKeyFacts = { poolType: null, parties: [], decidedBy: [] };
const NO_LANE: LaneFacts = { perHour: [], receivingInbound: null, verifiers: [] };

function rowResults(rows: readonly Row[], row: Row, input: EvaluateInput): CheckResult[] {
  const lanes = knownLanes(row.state);
  const remotes = lanes !== null ? lanes.map((l) => l.remoteChainSelector) : otherChains(rows, row);
  const singleKeyResult = (outcome: Outcome, facts: SingleKeyFacts): SingleKeyResult => ({
    check: 'single-key',
    row: row.ref,
    ...finish('single-key', `single-key/${rowKey(row.ref)}`, outcome),
    facts,
  });
  const laneResult = (remote: string | null, outcome: Outcome, facts: LaneFacts): RateLimitResult => ({
    check: 'rate-limit',
    row: row.ref,
    remoteChain: remote,
    ...finish('rate-limit', `rate-limit/${rowKey(row.ref)}/${remote ?? '*'}`, outcome),
    facts,
  });

  if (row.state.kind !== 'fresh') {
    const outcome = unreadableRow(row.state);
    return [singleKeyResult(outcome, NO_PARTIES), ...remotes.map((remote) => laneResult(remote, outcome, NO_LANE))];
  }
  const { reading } = row.state;
  const { facts, ...outcome } = singleKey(reading);
  const names = input.verifierNames[row.ref.chain] ?? {};
  const unknownLanes: ReasonCode = 'reason' in reading.settings.lanes && reading.settings.lanes.reason === 'proxy pool' ? 'proxy-pool' : 'lanes-not-readable';
  return [
    singleKeyResult(outcome, facts),
    ...remotes.map((remote) => {
      const lane = lanes?.find((l) => l.remoteChainSelector === remote);
      if (lane === undefined) return laneResult(remote, { value: 'not readable', reason: unknownLanes, readOn: reading.readOn, basis: unknownLanes }, NO_LANE);
      const { facts: laneFacts, ...laneOutcome } = rateLimit(rows, row, reading, lane, names);
      return laneResult(remote, laneOutcome, laneFacts);
    }),
  ];
}

/** The group's other chains, for keying the lane results of a row whose lanes are unknown; [null] when there are none. */
function otherChains(rows: readonly Row[], row: Row): (string | null)[] {
  const chains = [...new Set(rows.map((r) => r.ref.chain).filter((c) => c !== row.ref.chain))].sort(byChain);
  return chains.length > 0 ? chains : [null];
}

function pairResult(a: Row, b: Row, group: readonly Row[], input: EvaluateInput): PoolPointerResult | null {
  const key = `pool-pointer/${rowKey(a.ref)}/${rowKey(b.ref)}`;
  const make = (outcome: Outcome & { facts?: PointerFacts }): PoolPointerResult => ({
    check: 'pool-pointer',
    rows: [a.ref, b.ref],
    ...finish('pool-pointer', key, outcome),
    facts: outcome.facts ?? { sides: [] },
  });

  const design = [a, b].find((r) => r.state.kind === 'design');
  if (design !== undefined && design.state.kind === 'design') return make({ value: 'not readable', reason: design.state.reason, readOn: null, basis: design.state.reason });

  const aDay = a.input.reading?.readOn ?? null;
  const bDay = b.input.reading?.readOn ?? null;
  if (aDay !== null && aDay === bDay) {
    if (ageDays(aDay, input.today) > STALE_AFTER_DAYS) return make({ value: 'not readable', reason: 'reading-too-old', readOn: aDay, basis: 'reading-too-old' });
    const outcome = pointer(a, b, group, aDay);
    return outcome === null ? null : make(outcome);
  }

  const previous = input.previous.find((r): r is PoolPointerResult => r.check === 'pool-pointer' && r.key === key);
  if (previous !== undefined && previous.readOn !== null) {
    if (ageDays(previous.readOn, input.today) <= STALE_AFTER_DAYS) return previous;
    return make({ value: 'not readable', reason: 'reading-too-old', readOn: previous.readOn, basis: 'reading-too-old' });
  }
  if (aDay === null || bDay === null) return make({ value: 'not readable', reason: 'never-read', readOn: null, basis: 'never-read' });
  return make({ value: 'not readable', reason: 'read-on-different-days', readOn: null, basis: 'read-on-different-days' });
}

/** Lanes to a chain where the group has no row cannot be checked from the other side. */
function unmatchedLanes(rows: readonly Row[], row: Row): PoolPointerResult[] {
  if (row.state.kind !== 'fresh' && row.state.kind !== 'stale') return [];
  const { readOn } = row.state.reading;
  const reason: ReasonCode = row.state.kind === 'fresh' ? 'remote-chain-not-in-group' : 'reading-too-old';
  const chains = new Set(rows.map((r) => r.ref.chain));
  return (knownLanes(row.state) ?? [])
    .filter((l) => !chains.has(l.remoteChainSelector))
    .map((l) => ({
      check: 'pool-pointer',
      rows: [row.ref, { chain: l.remoteChainSelector, token: null }],
      ...finish('pool-pointer', `pool-pointer/${rowKey(row.ref)}/${l.remoteChainSelector}:*`, { value: 'not readable', reason, readOn, basis: reason }),
      facts: { sides: [] },
    }));
}

function applyCorrection(result: CheckResult, corrections: readonly Correction[]): CheckResult {
  const correction = corrections.find((c) => c.key === result.key && c.basis === result.basis);
  return correction === undefined ? result : { ...result, value: correction.value, reason: correction.reason, corrected: true };
}

/**
 * Runs the checklist over one group's rows (KTD1): a single-key result per row, a rate-limit result per row and remote
 * chain, and a pool-pointer result per pair of rows on different chains that form a lane. A reading up to seven days old
 * keeps its results and date; an older one gives "not readable" with its date (R31). A pair is evaluated only from two
 * readings of the same day; otherwise its previous result stands for up to seven days (KTD10).
 */
export function evaluateChecks(input: EvaluateInput): CheckResult[] {
  const rows: Row[] = input.rows.map((r) => ({ input: r, ref: { chain: r.chain, token: r.token }, state: rowState(r, input.today) }));
  const results = rows.flatMap((row) => rowResults(rows, row, input));

  const ordered = [...rows].sort((a, b) => byRef(a.ref, b.ref));
  for (const [i, a] of ordered.entries()) {
    for (const b of ordered.slice(i + 1)) {
      if (a.ref.chain === b.ref.chain) continue;
      if (!lanesUnknown(a) && !lanesUnknown(b) && !lists(a, b) && !lists(b, a)) continue;
      const result = pairResult(a, b, rows, input);
      if (result !== null) results.push(result);
    }
  }
  results.push(...rows.flatMap((row) => unmatchedLanes(rows, row)));
  return results.map((r) => applyCorrection(r, input.corrections));
}

/** A token's results per check for the index: flagged over "not readable" over clear; null for a check with no result. */
export function rollupChecks(results: readonly CheckResult[]): Record<CheckKind, CheckValue | null> {
  const rollup = (check: CheckKind): CheckValue | null => {
    const values = new Set(results.filter((r) => r.check === check).map((r) => r.value));
    if (values.has('flagged')) return 'flagged';
    if (values.has('not readable')) return 'not readable';
    return values.has('clear') ? 'clear' : null;
  };
  return { 'single-key': rollup('single-key'), 'rate-limit': rollup('rate-limit'), 'pool-pointer': rollup('pool-pointer') };
}

export interface NamedRow {
  chain: string;
  token: string;
  symbol: string | null;
  name: string | null;
}

export interface GroupName {
  symbol: string | null;
  name: string;
}

/** KTD2: the most common non-blank symbol and name; a tie goes to the Ethereum row, then to the lowest chain selector. */
export function groupName(rows: readonly NamedRow[]): GroupName {
  const preferred = [...rows].sort((a, b) => Number(b.chain === ETHEREUM_SELECTOR) - Number(a.chain === ETHEREUM_SELECTOR) || byChain(a.chain, b.chain));
  const first = preferred[0];
  if (first === undefined) throw new Error('a group has at least one row');
  const mostCommon = (pick: (r: NamedRow) => string | null): string | null => {
    const clean = (r: NamedRow) => sanitize(pick(r) ?? '').trim();
    const counts = new Map<string, number>();
    for (const r of preferred) if (clean(r) !== '') counts.set(clean(r), (counts.get(clean(r)) ?? 0) + 1);
    const top = Math.max(0, ...counts.values());
    return preferred.map(clean).find((v) => v !== '' && counts.get(v) === top) ?? null;
  };
  return { symbol: mostCommon((r) => r.symbol), name: mostCommon((r) => r.name) ?? `Unnamed token ${first.token.slice(0, 6)}…${first.token.slice(-4)}` };
}
