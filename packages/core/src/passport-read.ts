import { ABI_CAPS, addressWord, boolWord, decodeArray, decodeBytes, decodeBytesArray, decodeString, decodeTuple, decodeValue, encodeCall, uintWord, type EvmCall } from './evm-abi';
import { readCalls, readStorage, type CallResult, type PinnedChain } from './evm-read';
import type { HttpDeps } from './http';
import { sanitize } from './normalize';

/** Selectors from docs/research/2026-11-22-ccip-pool-read-surface.md sections 3, 4, 5 and 11. */
const SELECTOR = {
  typeAndVersion: '0x181f5a77',
  owner: '0x8da5cb5b',
  getTokenConfig: '0xcb67e3b1',
  getSupportedChains: '0xc4bffe2b',
  getRateLimitAdmin: '0x6d3d1a58',
  getDynamicConfig: '0x7437ff9f',
  getAdvancedPoolHooks: '0x37a3210d',
  getAllowedFinalityConfig: '0xec6ae7a7',
  getRemotePools: '0xa42a7b8b',
  getRemotePool: '0x0a2fd493',
  getRemoteToken: '0xb7946580',
  getCurrentOutboundRateLimiterState: '0xc75eea9c',
  getCurrentInboundRateLimiterState: '0xaf58d59f',
  getCurrentRateLimiterState: '0x2422ac45',
  getCCVConfig: '0x776d5add',
  getThresholdAmount: '0xf72c071b',
  getDestChainConfig: '0x6def4ce7',
} as const;

/** EIP-1967's admin slot: bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1). */
export const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

/** Pool type names from section 4.3 of the pool research; any other name is a custom pool. */
export const STANDARD_POOL_TYPES: ReadonlySet<string> = new Set([
  'BurnMintTokenPool',
  'LockReleaseTokenPool',
  'BurnFromMintTokenPool',
  'BurnWithFromMintTokenPool',
  'BurnToAddressTokenPool',
  'SiloedLockReleaseTokenPool',
  'LombardTokenPool',
  'BurnMintWithLockReleaseFlagTokenPool',
  'USDCTokenPoolProxy',
  'BurnMintTokenPoolAndProxy',
  'LockReleaseTokenPoolAndProxy',
  'BurnWithFromMintTokenPoolAndProxy',
]);

/** Pools that route to underlying pools and keep no lanes of their own (KTD8). */
const PROXY_POOL_TYPES: ReadonlySet<string> = new Set(['USDCTokenPoolProxy']);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type UnreadableReason = 'no pool set' | 'proxy pool' | 'getter missing' | 'getter unanswered' | 'proxy status unknown' | 'no onramp';

/** A piece of a reading: its value, or why it could not be read. */
export type Readable<T> = { value: T } | { reason: UnreadableReason };

/**
 * A party behind the single-key check: an address; absent when its getter answered the zero address; missing when the
 * pool has no such getter (or no pool is set); unanswered when a getter the pool type should have did not answer, or the
 * node would not show the proxy admin slot.
 */
export type Party =
  | { state: 'address'; address: string }
  | { state: 'absent' }
  | { state: 'missing'; reason: 'getter missing' | 'no pool set' }
  | { state: 'unanswered'; reason: 'getter unanswered' | 'proxy status unknown' };

export interface Parties {
  poolOwner: Party;
  registryAdministrator: Party;
  rateLimitAdmin: Party;
  hooksOwner: Party;
  proxyAdmin: Party;
}

export interface PoolType {
  /** typeAndVersion() as read, sanitised. */
  typeAndVersion: string;
  /** Left of the last space. */
  name: string;
  /** Right of the last space, as reported (`1.6.x-dev` included). */
  version: string;
  /** Major and minor of the version, so `1.6.x-dev` reads as `1.6`; null when the version has no number. */
  line: string | null;
  standard: boolean;
}

/** A limit's configuration; the bucket's fill level and lastUpdated are never kept. Amounts are decimal strings. */
export interface RateLimit {
  isEnabled: boolean;
  capacity: string;
  rate: string;
}

export interface PoolVerifiers {
  outbound: string[];
  thresholdOutbound: string[];
  inbound: string[];
  thresholdInbound: string[];
}

/** The lane's own verifier lists from its OnRamp; a 1.x OnRamp has none. */
export type LaneVerifiers = { onRamp: '1.x' } | { onRamp: '2.x'; mandated: string[]; defaults: string[] };

export interface RawLane {
  remoteChainSelector: string;
  /** Lowercase hex bytes; a 32-byte left-padded EVM address is cut to its 20 bytes. */
  remoteToken: Readable<string>;
  /** Same encoding as remoteToken, sorted. */
  remotePools: Readable<string[]>;
  outbound: Readable<RateLimit>;
  inbound: Readable<RateLimit>;
  fastOutbound: Readable<RateLimit>;
  fastInbound: Readable<RateLimit>;
  poolVerifiers: Readable<PoolVerifiers>;
  laneVerifiers: Readable<LaneVerifiers>;
}

export interface Hooks {
  address: string;
  /** Decimal string. */
  thresholdAmount: Readable<string>;
}

/** One registry row's configuration, JSON-serialisable with a fixed key order: lowercase addresses, sorted lists. */
export interface RawSettings {
  token: string;
  administrator: string;
  pendingAdministrator: string;
  /** The registry's pool for the token; the zero address when none is set. */
  pool: string;
  poolType: Readable<PoolType>;
  parties: Parties;
  /** null when the pool's getter answers that it has no hooks contract. */
  hooks: Readable<Hooks | null>;
  /** The bytes4 from getAllowedFinalityConfig(), as hex. */
  allowedFinality: Readable<string>;
  /** Sorted by remote chain selector. */
  lanes: Readable<RawLane[]>;
}

/** A row any of whose calls failed is unread: it keeps its stored reading, and `failures` names the calls. */
export type RowReading = { token: string; status: 'read'; settings: RawSettings } | { token: string; status: 'unread'; failures: string[] };

export interface PassportChainInput {
  /** The chain's TokenAdminRegistry from config/ccip-directory.json. */
  registry: string;
  /**
   * The OnRamp for each lane leaving this chain, by destination chain selector. Its source is the keyless
   * https://api.ccip.chain.link/v2/lanes answer: every lane whose sourceChainSelector is this chain's selector.
   */
  onRamps: Readonly<Record<string, string>>;
  /** Token addresses of the registry rows to read. */
  tokens: readonly string[];
}

/** The registry's typeAndVersion() does not name a TokenAdminRegistry, so nothing read through it is trusted. */
export class WrongRegistryError extends Error {
  readonly kind = 'wrong-registry';
  constructor(message: string) {
    super(message);
    this.name = 'WrongRegistryError';
  }
}

const callKey = (call: EvmCall) => `${call.to}:${call.data}`;

const call = (to: string, selector: string, ...words: string[]): EvmCall => ({ to: to.toLowerCase(), data: encodeCall(selector, ...words) });

/** Answers for a set of calls, each asked once however many rows need it. */
class Answers {
  private readonly results = new Map<string, CallResult>();

  static async read(deps: HttpDeps, pinned: PinnedChain, calls: readonly EvmCall[]): Promise<Answers> {
    const unique = [...new Map(calls.map((c) => [callKey(c), c])).values()];
    const results = await readCalls(deps, pinned, unique);
    const answers = new Answers();
    unique.forEach((c, i) => answers.results.set(callKey(c), results[i]!));
    return answers;
  }

  merged(other: Answers): Answers {
    const both = new Answers();
    for (const source of [this, other]) for (const [k, v] of source.results) both.results.set(k, v);
    return both;
  }

  of(c: EvmCall): CallResult {
    const result = this.results.get(callKey(c));
    if (result === undefined) throw new Error(`no answer asked for ${callKey(c)}`);
    return result;
  }
}

/** One row's view of the answers: it notes every failed call the row depends on. */
class RowAnswers {
  readonly failures: string[] = [];

  constructor(private readonly answers: Answers) {}

  /** The call's answer data; null for a revert or a failure. */
  data(c: EvmCall): string | null {
    return this.answered(c)?.data ?? null;
  }

  reverted(c: EvmCall): boolean {
    return this.answers.of(c).status === 'reverted';
  }

  private answered(c: EvmCall): { data: string } | null {
    const result = this.answers.of(c);
    if (result.status === 'failed') this.failures.push(`${c.to} ${c.data.slice(0, 10)}: ${result.reason}`);
    return result.status === 'answered' ? result : null;
  }
}

function parseTypeAndVersion(answer: string | null): Omit<PoolType, 'standard'> | null {
  const text = decodeString(answer);
  if (text === null) return null;
  const clean = sanitize(text, ABI_CAPS.text);
  const space = clean.lastIndexOf(' ');
  const name = space < 0 ? clean : clean.slice(0, space);
  const version = space < 0 ? '' : clean.slice(space + 1);
  const numbers = /^(\d+)\.(\d+)/.exec(version);
  return { typeAndVersion: clean, name, version, line: numbers ? `${numbers[1]}.${numbers[2]}` : null };
}

const majorOf = (line: string | null) => (line === null ? null : Number(line.split('.')[0]));

const byNumber = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A 32-byte value whose first 12 bytes are zero is a left-padded EVM address. */
function remoteBytes(bytes: string): string {
  const hex = bytes.toLowerCase();
  return hex.length === 66 && hex.startsWith(`0x${'0'.repeat(24)}`) ? `0x${hex.slice(26)}` : hex;
}

function decodeBytes4(answer: string | null): string | null {
  const word = decodeValue(answer, 'uint256');
  if (word === null || (word & ((1n << 224n) - 1n)) !== 0n) return null;
  return `0x${(word >> 224n).toString(16).padStart(8, '0')}`;
}

const BUCKET = ['uint128', 'uint32', 'bool', 'uint128', 'uint128'] as const;

/** TokenBucket{tokens, lastUpdated, isEnabled, capacity, rate} starting at word `at`; tokens and lastUpdated are dropped. */
const limitAt = (words: readonly (bigint | boolean)[], at: number): RateLimit => ({ isEnabled: words[at + 2] === true, capacity: String(words[at + 3]), rate: String(words[at + 4]) });

const decodeBucket = (answer: string | null): RateLimit | null => {
  const words = decodeTuple(answer, BUCKET);
  return words === null ? null : limitAt(words, 0);
};

/** (TokenBucket outbound, TokenBucket inbound): ten static words. */
function decodeBucketPair(answer: string | null): { outbound: RateLimit; inbound: RateLimit } | null {
  const words = decodeTuple(answer, [...BUCKET, ...BUCKET] as const);
  return words === null ? null : { outbound: limitAt(words, 0), inbound: limitAt(words, 5) };
}

/**
 * The address arrays of a dynamic struct, by their member positions in its head. Each array is decoded as an answer of its
 * own: a leading word pointing past itself at the member, followed by the struct.
 */
function structAddressArrays(answer: string | null, members: readonly number[]): string[][] | null {
  const start = decodeValue(answer, 'uint256');
  if (answer === null || start === null || start > BigInt((answer.length - 2) / 2)) return null;
  const struct = answer.slice(2 + Number(start) * 2);
  const lists: string[][] = [];
  for (const member of members) {
    const offset = decodeValue(`0x${struct.slice(member * 64)}`, 'uint256');
    if (offset === null || offset > BigInt(struct.length / 2)) return null;
    const list = decodeArray(`0x${uintWord(offset + 32n)}${struct}`, 'address');
    if (list === null) return null;
    lists.push(list.sort(byText));
  }
  return lists;
}

/** Which getters a pool type is known to have; a custom pool is known to have none, so its reverts read as missing. */
type Getter = 'owner' | 'supportedChains' | 'rateLimitAdmin' | 'hooks' | 'allowedFinality' | 'remoteToken' | 'remotePools' | 'limits' | 'fastLimits' | 'hooksGetters';
const V1_GETTERS: ReadonlySet<Getter> = new Set(['owner', 'supportedChains', 'rateLimitAdmin', 'remoteToken', 'remotePools', 'limits']);
const V2_GETTERS: ReadonlySet<Getter> = new Set([...V1_GETTERS, 'hooks', 'allowedFinality', 'fastLimits', 'hooksGetters']);
const PROXY_GETTERS: ReadonlySet<Getter> = new Set(['owner']);

function knownGetters(type: Omit<PoolType, 'standard'> | null): ReadonlySet<Getter> {
  if (type === null || !STANDARD_POOL_TYPES.has(type.name)) return new Set();
  if (PROXY_POOL_TYPES.has(type.name)) return PROXY_GETTERS;
  const major = majorOf(type.line);
  return major === 1 ? V1_GETTERS : major === 2 ? V2_GETTERS : new Set();
}

const poolCalls = (pool: string) => ({
  typeAndVersion: call(pool, SELECTOR.typeAndVersion),
  owner: call(pool, SELECTOR.owner),
  supportedChains: call(pool, SELECTOR.getSupportedChains),
  rateLimitAdmin: call(pool, SELECTOR.getRateLimitAdmin),
  dynamicConfig: call(pool, SELECTOR.getDynamicConfig),
  hooks: call(pool, SELECTOR.getAdvancedPoolHooks),
  allowedFinality: call(pool, SELECTOR.getAllowedFinalityConfig),
});

const laneCalls = (pool: string, selector: string) => {
  const remote = uintWord(BigInt(selector));
  return {
    remotePools: call(pool, SELECTOR.getRemotePools, remote),
    remotePool: call(pool, SELECTOR.getRemotePool, remote),
    remoteToken: call(pool, SELECTOR.getRemoteToken, remote),
    outbound: call(pool, SELECTOR.getCurrentOutboundRateLimiterState, remote),
    inbound: call(pool, SELECTOR.getCurrentInboundRateLimiterState, remote),
    standard: call(pool, SELECTOR.getCurrentRateLimiterState, remote, boolWord(false)),
    fast: call(pool, SELECTOR.getCurrentRateLimiterState, remote, boolWord(true)),
  };
};

const hooksCalls = (hooks: string) => ({ owner: call(hooks, SELECTOR.owner), thresholdAmount: call(hooks, SELECTOR.getThresholdAmount) });
const ccvConfigCall = (hooks: string, selector: string) => call(hooks, SELECTOR.getCCVConfig, uintWord(BigInt(selector)));
const onRampTypeCall = (onRamp: string) => call(onRamp, SELECTOR.typeAndVersion);
const destChainConfigCall = (onRamp: string, selector: string) => call(onRamp, SELECTOR.getDestChainConfig, uintWord(BigInt(selector)));

/** What the pool stage learnt that decides the lane stage's calls. */
interface PoolStage {
  type: Omit<PoolType, 'standard'> | null;
  proxy: boolean;
  supportedChains: string[] | null;
  hooks: string | null;
}

function poolStage(answers: Answers, pool: string): PoolStage {
  const row = new RowAnswers(answers);
  const calls = poolCalls(pool);
  const type = parseTypeAndVersion(row.data(calls.typeAndVersion));
  const proxy = type !== null && PROXY_POOL_TYPES.has(type.name);
  const chains = proxy ? null : decodeArray(row.data(calls.supportedChains), 'uint64');
  const hooks = decodeValue(row.data(calls.hooks), 'address');
  return { type, proxy, supportedChains: chains?.map(String).sort(byNumber) ?? null, hooks: hooks === ZERO_ADDRESS ? null : hooks };
}

/** The OnRamp's generation: 1 and 2 are the CCIP lines; null when its typeAndVersion() gave no version. */
function onRampMajor(answers: Answers, onRamp: string): number | null {
  const result = answers.of(onRampTypeCall(onRamp));
  return majorOf(parseTypeAndVersion(result.status === 'answered' ? result.data : null)?.line ?? null);
}

function piece<T>(row: RowAnswers, c: EvmCall, decode: (data: string | null) => T | null, known: boolean): Readable<T> {
  const value = decode(row.data(c));
  if (value !== null) return { value };
  return { reason: row.reverted(c) && !known ? 'getter missing' : 'getter unanswered' };
}

function party(address: Readable<string>): Party {
  if ('reason' in address) return address.reason === 'getter missing' ? { state: 'missing', reason: 'getter missing' } : { state: 'unanswered', reason: 'getter unanswered' };
  return address.value === ZERO_ADDRESS ? { state: 'absent' } : { state: 'address', address: address.value };
}

function proxyAdminParty(slot: CallResult): Party {
  const admin = slot.status === 'answered' ? decodeValue(slot.data, 'address') : null;
  if (admin === null) return { state: 'unanswered', reason: 'proxy status unknown' };
  return admin === ZERO_ADDRESS ? { state: 'absent' } : { state: 'address', address: admin };
}

const noPool = { reason: 'no pool set' } as const;
const noPoolParty: Party = { state: 'missing', reason: 'no pool set' };

interface RowContext {
  row: RowAnswers;
  pool: string;
  stage: PoolStage;
  known: ReadonlySet<Getter>;
  onRamps: ReadonlyMap<string, string>;
}

function readLane(ctx: RowContext, hooks: Readable<Hooks | null>, selector: string): RawLane {
  const { row, known } = ctx;
  const calls = laneCalls(ctx.pool, selector);
  const remoteToken = piece(row, calls.remoteToken, decodeBytes, known.has('remoteToken'));

  const pools = decodeBytesArray(row.data(calls.remotePools));
  const single = decodeBytes(row.data(calls.remotePool));
  const remotePools: Readable<string[]> =
    pools !== null ? { value: pools.map(remoteBytes).sort(byText) } : single !== null ? { value: [remoteBytes(single)] } : { reason: known.has('remotePools') ? 'getter unanswered' : 'getter missing' };

  const standard = decodeBucketPair(row.data(calls.standard));
  const outbound = standard !== null ? { value: standard.outbound } : piece(row, calls.outbound, decodeBucket, known.has('limits'));
  const inbound = standard !== null ? { value: standard.inbound } : piece(row, calls.inbound, decodeBucket, known.has('limits'));
  const fast = piece(row, calls.fast, decodeBucketPair, known.has('fastLimits'));

  let poolVerifiers: Readable<PoolVerifiers>;
  if ('reason' in hooks) poolVerifiers = hooks;
  else if (hooks.value === null) poolVerifiers = { value: { outbound: [], thresholdOutbound: [], inbound: [], thresholdInbound: [] } };
  else {
    const lists = piece(row, ccvConfigCall(hooks.value.address, selector), (d) => structAddressArrays(d, [0, 1, 2, 3]), known.has('hooksGetters'));
    poolVerifiers = 'reason' in lists ? lists : { value: { outbound: lists.value[0]!, thresholdOutbound: lists.value[1]!, inbound: lists.value[2]!, thresholdInbound: lists.value[3]! } };
  }

  return {
    remoteChainSelector: selector,
    remoteToken: 'value' in remoteToken ? { value: remoteBytes(remoteToken.value) } : remoteToken,
    remotePools,
    outbound,
    inbound,
    fastOutbound: 'value' in fast ? { value: fast.value.outbound } : fast,
    fastInbound: 'value' in fast ? { value: fast.value.inbound } : fast,
    poolVerifiers,
    laneVerifiers: laneVerifiers(ctx, selector),
  };
}

function laneVerifiers(ctx: RowContext, selector: string): Readable<LaneVerifiers> {
  const onRamp = ctx.onRamps.get(selector);
  if (onRamp === undefined) return { reason: 'no onramp' };
  const typeCall = onRampTypeCall(onRamp);
  const major = majorOf(parseTypeAndVersion(ctx.row.data(typeCall))?.line ?? null);
  if (major === null) return { reason: 'getter unanswered' };
  if (major < 2) return { value: { onRamp: '1.x' } };
  const lists = structAddressArrays(ctx.row.data(destChainConfigCall(onRamp, selector)), [8, 9]);
  return lists === null ? { reason: 'getter unanswered' } : { value: { onRamp: '2.x', mandated: lists[0]!, defaults: lists[1]! } };
}

function readPoolRow(ctx: RowContext, registryAdministrator: Party, slot: CallResult): Pick<RawSettings, 'poolType' | 'parties' | 'hooks' | 'allowedFinality' | 'lanes'> {
  const { row, known, stage } = ctx;
  const calls = poolCalls(ctx.pool);
  const poolType: Readable<PoolType> = piece(row, calls.typeAndVersion, (d) => {
    const type = parseTypeAndVersion(d);
    return type === null ? null : { ...type, standard: STANDARD_POOL_TYPES.has(type.name) };
  }, true);

  const ownerAddress = piece(row, calls.owner, (d) => decodeValue(d, 'address'), known.has('owner'));
  const rateLimitAdminAddress = row.data(calls.rateLimitAdmin) !== null
    ? piece(row, calls.rateLimitAdmin, (d) => decodeValue(d, 'address'), known.has('rateLimitAdmin'))
    : piece(row, calls.dynamicConfig, (d) => decodeTuple(d, ['address', 'address', 'address'] as const)?.[1] ?? null, known.has('rateLimitAdmin'));

  const hooksAddress = piece(row, calls.hooks, (d) => decodeValue(d, 'address'), known.has('hooks'));
  let hooks: Readable<Hooks | null>;
  let hooksOwner: Party;
  if ('reason' in hooksAddress) {
    hooks = hooksAddress;
    hooksOwner = party(hooksAddress);
  } else if (stage.hooks === null) {
    hooks = { value: null };
    hooksOwner = { state: 'absent' };
  } else {
    const hc = hooksCalls(stage.hooks);
    const hooksKnown = known.has('hooksGetters');
    hooks = { value: { address: stage.hooks, thresholdAmount: piece(row, hc.thresholdAmount, (d) => decodeValue(d, 'uint256')?.toString() ?? null, hooksKnown) } };
    hooksOwner = party(piece(row, hc.owner, (d) => decodeValue(d, 'address'), hooksKnown));
  }

  const allowedFinality = piece(row, calls.allowedFinality, decodeBytes4, known.has('allowedFinality'));
  let lanes: Readable<RawLane[]>;
  if (stage.proxy) lanes = { reason: 'proxy pool' };
  else if (stage.supportedChains === null) lanes = { reason: row.reverted(calls.supportedChains) && !known.has('supportedChains') ? 'getter missing' : 'getter unanswered' };
  else lanes = { value: stage.supportedChains.map((selector) => readLane(ctx, hooks, selector)) };

  return {
    poolType,
    parties: { poolOwner: party(ownerAddress), registryAdministrator, rateLimitAdmin: party(rateLimitAdminAddress), hooksOwner, proxyAdmin: proxyAdminParty(slot) },
    hooks,
    allowedFinality,
    lanes,
  };
}

/**
 * Reads one chain's registry rows at its pinned block: the registry, then every pool's own getters and admin slot, then
 * each pool's lanes, hooks and the lanes' OnRamps. Every version's getters are asked in the same pass; a revert means the
 * pool does not have that getter. A row any of whose calls failed comes back unread while the other rows are read.
 */
export async function readPassportChain(deps: HttpDeps, pinned: PinnedChain, input: PassportChainInput): Promise<RowReading[]> {
  const registry = input.registry.toLowerCase();
  const tokens = input.tokens.map((t) => t.toLowerCase());
  const registryType = call(registry, SELECTOR.typeAndVersion);
  const tokenConfig = (token: string) => call(registry, SELECTOR.getTokenConfig, addressWord(token));

  const registryAnswers = await Answers.read(deps, pinned, [registryType, ...tokens.map(tokenConfig)]);
  const registryResult = registryAnswers.of(registryType);
  if (registryResult.status !== 'failed' && parseTypeAndVersion(registryResult.status === 'answered' ? registryResult.data : null)?.name !== 'TokenAdminRegistry') {
    throw new WrongRegistryError(`${registry} on chain ${pinned.chainId} does not name a TokenAdminRegistry`);
  }
  const configs = new Map(tokens.map((t) => {
    const result = registryAnswers.of(tokenConfig(t));
    return [t, decodeTuple(result.status === 'answered' ? result.data : null, ['address', 'address', 'address'] as const)];
  }));
  const pools = [...new Set([...configs.values()].map((c) => c?.[2]).filter((p): p is string => p !== undefined && p !== ZERO_ADDRESS))];
  const onRamps = new Map(Object.entries(input.onRamps).map(([selector, address]) => [selector, address.toLowerCase()]));

  const poolAnswers = await Answers.read(deps, pinned, [...pools.flatMap((p) => Object.values(poolCalls(p))), ...[...new Set(onRamps.values())].map(onRampTypeCall)]);
  const slots = new Map<string, CallResult>();
  for (const pool of pools) slots.set(pool, await readStorage(deps, pinned, pool, EIP1967_ADMIN_SLOT));
  const stages = new Map(pools.map((p) => [p, poolStage(poolAnswers, p)]));

  const laneStageCalls: EvmCall[] = [];
  for (const [pool, stage] of stages) {
    if (stage.hooks !== null) laneStageCalls.push(...Object.values(hooksCalls(stage.hooks)));
    for (const selector of stage.supportedChains ?? []) {
      laneStageCalls.push(...Object.values(laneCalls(pool, selector)));
      if (stage.hooks !== null) laneStageCalls.push(ccvConfigCall(stage.hooks, selector));
      const onRamp = onRamps.get(selector);
      if (onRamp !== undefined && (onRampMajor(poolAnswers, onRamp) ?? 0) >= 2) laneStageCalls.push(destChainConfigCall(onRamp, selector));
    }
  }
  const answers = registryAnswers.merged(poolAnswers).merged(await Answers.read(deps, pinned, laneStageCalls));

  return tokens.map((token): RowReading => {
    const row = new RowAnswers(answers);
    if (row.data(registryType) === null || configs.get(token) === null) {
      row.data(tokenConfig(token));
      return { token, status: 'unread', failures: row.failures.length > 0 ? row.failures : [`${registry} getTokenConfig(${token}) did not answer`] };
    }
    const [administrator, pendingAdministrator, pool] = configs.get(token)!;
    const registryAdministrator: Party = administrator === ZERO_ADDRESS ? { state: 'absent' } : { state: 'address', address: administrator };
    const base = { token, administrator, pendingAdministrator, pool };
    if (pool === ZERO_ADDRESS) {
      const parties = { poolOwner: noPoolParty, registryAdministrator, rateLimitAdmin: noPoolParty, hooksOwner: noPoolParty, proxyAdmin: noPoolParty };
      return { token, status: 'read', settings: { ...base, poolType: noPool, parties, hooks: noPool, allowedFinality: noPool, lanes: noPool } };
    }
    const stage = stages.get(pool)!;
    const ctx: RowContext = { row, pool, stage, known: knownGetters(stage.type), onRamps };
    const settings: RawSettings = { ...base, ...readPoolRow(ctx, registryAdministrator, slots.get(pool)!) };
    return row.failures.length > 0 ? { token, status: 'unread', failures: [...new Set(row.failures)] } : { token, status: 'read', settings };
  });
}
