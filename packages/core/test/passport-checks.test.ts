import { describe, expect, it } from 'vitest';
import type { PinnedChain } from '../src/evm-read';
import type { HttpDeps } from '../src/http';
import {
  CHECK_KINDS,
  REASON_CODES,
  evaluateChecks,
  groupName,
  rollupChecks,
  type CheckResult,
  type EvaluateInput,
  type PassportRow,
  type PoolPointerResult,
  type RateLimitResult,
  type SingleKeyResult,
} from '../src/passport-checks';
import { METHOD_VERSION, type PartyClassification } from '../src/passport-principals';
import { readPassportChain, type RateLimit, type RawLane, type RawSettings, type Readable } from '../src/passport-read';
import { evmCallKey, fakeEvmChain, fakeFetch, type RecordedCall } from '../src/testing';
import hooks200 from './fixtures/passport/pools/base-burn-mint-2.0.0-hooks.json';
import burnMint151 from './fixtures/passport/pools/ethereum-burn-mint-1.5.1.json';
import andProxy150 from './fixtures/passport/pools/ethereum-burn-mint-and-proxy-1.5.0.json';
import customEnergy from './fixtures/passport/pools/ethereum-custom-energy-1.0.0.json';
import gho151 from './fixtures/passport/pools/ethereum-lock-release-1.5.1-proxy-admin.json';
import lockRelease16Dev from './fixtures/passport/pools/ethereum-lock-release-1.6.x-dev.json';
import noHooks200 from './fixtures/passport/pools/ethereum-lock-release-2.0.0-no-hooks.json';
import noPool from './fixtures/passport/pools/ethereum-no-pool.json';
import usdcProxy from './fixtures/passport/pools/ethereum-usdc-proxy-2.0.0.json';
import recordedParties from './fixtures/passport/checks/parties.json';
import principals from './fixtures/passport/principals/golden.json';

interface Fixture {
  selector: string;
  chainId: number;
  block: number;
  blockHash: string;
  timestamp: number;
  registry: string;
  token: string;
  onRamps: Record<string, string>;
  calls: ({ to: string; data: string; result: string } | { to: string; data: string; revert: boolean })[];
  storage: Record<string, string>;
}

const TODAY = '2026-11-23';
const ETHEREUM = '5009297550715157269';
const BASE = '15971525489660198786';
const ARBITRUM = '4949039107694359620';
const SOLANA = '124615329519749607';
const ZERO = '0x0000000000000000000000000000000000000000';
const COMMITTEE = '0x2caafd3b4cf606220580c885bd2b448fb93dc03b';
const CCTP = '0xbfd2109d3ff5b6f09281bdb52ca6b56d7bb1ff12';

/** Verifier names for the two chains the fixtures cover, as config/ccip-directory.json lists them. */
const NAMES = {
  [ETHEREUM]: { [COMMITTEE]: 'Committee Verifier (Default)', [CCTP]: 'CCTP Verifier' },
  [BASE]: { [COMMITTEE]: 'Committee Verifier (Default)', [CCTP]: 'CCTP Verifier' },
};

const PARTIES = recordedParties.parties as unknown as Record<string, Record<string, PartyClassification>>;
const PRINCIPAL = principals.results as unknown as Record<string, PartyClassification>;
const SAFE_1_OF_3 = PRINCIPAL['hand/safe-1-of-3']!;
const SAFE_2_OF_3 = PRINCIPAL['ethereum/0x62c212084ed4d2c1451c2e778f8ea9a15a47616b']!;
const UNIDENTIFIED = PRINCIPAL['ethereum/0x5300a1a15135ea4dc7ad5a167152c01efc9b192a']!;
const WALLET = PRINCIPAL['ethereum/0xd4d23209aae8630bf386b7393763a5b7865e57cb']!;

async function settingsOf(fixture: Fixture): Promise<RawSettings> {
  const calls: Record<string, RecordedCall> = Object.fromEntries(fixture.calls.map((c) => [evmCallKey(c.to, c.data), 'result' in c ? (c.result as `0x${string}`) : 'revert']));
  const fake = fakeEvmChain({ chainId: fixture.chainId, latest: fixture.block + 12, timestamp: fixture.timestamp, calls, storage: fixture.storage });
  const deps: HttpDeps = { fetch: fakeFetch(fake), sleep: async () => {}, clock: () => fixture.timestamp * 1000 };
  const pinned: PinnedChain = { rpcUrl: 'https://rpc.example', chainId: fixture.chainId, block: fixture.block, blockHash: fixture.blockHash, timestamp: fixture.timestamp, multicall3: true };
  const [row] = await readPassportChain(deps, pinned, { registry: fixture.registry, onRamps: fixture.onRamps, tokens: [fixture.token] });
  if (row?.status !== 'read') throw new Error(`fixture ${fixture.token} did not read`);
  return row.settings;
}

function row(chain: string, token: string, over: Partial<PassportRow> = {}): PassportRow {
  return { chain, token, symbol: 'TKN', name: 'Token', decimals: 18, priceUsd: null, unreadableByDesign: null, reading: null, ...over };
}

function readRow(chain: string, settings: RawSettings, parties: Record<string, PartyClassification>, readOn = TODAY, over: Partial<PassportRow> = {}): PassportRow {
  return row(chain, settings.token, { reading: { readOn, settings, parties }, ...over });
}

async function fixtureRow(fixture: Fixture, over: { parties?: Record<string, PartyClassification>; readOn?: string; settings?: (s: RawSettings) => RawSettings } & Partial<PassportRow> = {}): Promise<PassportRow> {
  const { parties, readOn, settings: edit, ...rest } = over;
  const read = await settingsOf(fixture);
  return readRow(fixture.selector, edit ? edit(read) : read, { ...PARTIES[fixture.selector], ...parties }, readOn, rest);
}

function evaluate(rows: PassportRow[], over: Partial<EvaluateInput> = {}): CheckResult[] {
  return evaluateChecks({ rows, corrections: [], previous: [], verifierNames: NAMES, today: TODAY, ...over });
}

const singleKeyOf = (results: CheckResult[], token: string) => results.find((r): r is SingleKeyResult => r.check === 'single-key' && r.row.token === token);
const rateLimitsOf = (results: CheckResult[], token: string) => results.filter((r): r is RateLimitResult => r.check === 'rate-limit' && r.row.token === token);
const laneOf = (results: CheckResult[], token: string, remote: string) => rateLimitsOf(results, token).find((r) => r.remoteChain === remote);
const pairsOf = (results: CheckResult[]) => results.filter((r): r is PoolPointerResult => r.check === 'pool-pointer');

const limit = (isEnabled: boolean, capacity = '0', rate = '0'): Readable<RateLimit> => ({ value: { isEnabled, capacity, rate } });
const OFF = limit(false);
const MISSING = { reason: 'getter missing' } as const;

const A_TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const A_POOL = '0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';
const B_TOKEN = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const B_POOL = '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const OLD_POOL = '0x0101010101010101010101010101010101010101';
const MULTISIG = '0x62c212084ed4d2c1451c2e778f8ea9a15a47616b';
const CUSTOM_VERIFIER = '0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';

function lane(remote: string, token: string, pools: string[], over: Partial<RawLane> = {}): RawLane {
  return {
    remoteChainSelector: remote,
    remoteToken: { value: token },
    remotePools: { value: pools },
    outbound: OFF,
    inbound: OFF,
    fastOutbound: MISSING,
    fastInbound: MISSING,
    poolVerifiers: MISSING,
    laneVerifiers: { value: { onRamp: '1.x' } },
    ...over,
  };
}

/** A standard 1.5.1 pool whose owner and registry administrator are one 2-of-3 Safe. */
function settings(token: string, pool: string, lanes: RawLane[], over: Partial<RawSettings> = {}): RawSettings {
  return {
    token,
    administrator: MULTISIG,
    pendingAdministrator: ZERO,
    pool,
    poolType: { value: { typeAndVersion: 'BurnMintTokenPool 1.5.1', name: 'BurnMintTokenPool', version: '1.5.1', line: '1.5', standard: true } },
    parties: {
      poolOwner: { state: 'address', address: MULTISIG },
      registryAdministrator: { state: 'address', address: MULTISIG },
      rateLimitAdmin: { state: 'absent' },
      hooksOwner: { state: 'missing', reason: 'getter missing' },
      proxyAdmin: { state: 'absent' },
    },
    hooks: MISSING,
    allowedFinality: MISSING,
    lanes: { value: lanes },
    ...over,
  };
}

const MULTISIG_PARTIES = { [MULTISIG]: SAFE_2_OF_3 };

function pair(aLanes: RawLane[], bLanes: RawLane[], days: { a?: string; b?: string } = {}): PassportRow[] {
  return [
    readRow(ETHEREUM, settings(A_TOKEN, A_POOL, aLanes), MULTISIG_PARTIES, days.a),
    readRow(BASE, settings(B_TOKEN, B_POOL, bLanes), MULTISIG_PARTIES, days.b),
  ];
}

describe('AE1: a chain that cannot be read never shows clear', () => {
  it('gives Ethereum its results and every Solana result, the pair included, "not readable"', async () => {
    const ethereum = await fixtureRow(noHooks200);
    const solana = row(SOLANA, '9u9WEPFm1Qe2DwWNqFDB3rFzfP6mLJ5h2AFbqhaPCCiK', { unreadableByDesign: 'non-evm-chain' });
    const results = evaluate([ethereum, solana]);

    expect(singleKeyOf(results, noHooks200.token)).toMatchObject({ value: 'flagged', readOn: TODAY });
    expect(rateLimitsOf(results, noHooks200.token).map((r) => [r.remoteChain, r.value])).toEqual([
      [SOLANA, 'clear'],
      ['2308837218439511688', 'clear'],
      [ARBITRUM, 'clear'],
      ['7801139999541420232', 'clear'],
      ['8481857512324358265', 'clear'],
    ]);

    const forSolana = results.filter((r) => ('row' in r ? r.row.chain === SOLANA : r.rows.some((x) => x.chain === SOLANA)));
    expect(forSolana.map((r) => [r.check, r.value, r.reason])).toEqual([
      ['single-key', 'not readable', 'non-evm-chain'],
      ['rate-limit', 'not readable', 'non-evm-chain'],
      ['pool-pointer', 'not readable', 'non-evm-chain'],
    ]);
  });
});

describe('single-key check', () => {
  it('AE15: flags a pool owned by a Safe any one of three keys can sign for, naming that party', async () => {
    const results = evaluate([await fixtureRow(burnMint151, { parties: { '0xecf08409a5e35aa58a887cf892c6af6648727281': SAFE_1_OF_3 } })]);
    const result = singleKeyOf(results, burnMint151.token)!;
    expect(result).toMatchObject({ value: 'flagged', reason: 'single-key', facts: { decidedBy: ['poolOwner', 'registryAdministrator'] } });
    expect(result.facts.parties.find((p) => p.role === 'poolOwner')).toEqual({ role: 'poolOwner', address: '0xecf08409a5e35aa58a887cf892c6af6648727281', kind: 'safe', signers: 1, keys: 3 });
  });

  it('AE15: is clear when every party needs two or more of its keys', async () => {
    const results = evaluate([await fixtureRow(burnMint151, { parties: { '0xecf08409a5e35aa58a887cf892c6af6648727281': SAFE_2_OF_3 } })]);
    expect(singleKeyOf(results, burnMint151.token)).toMatchObject({ value: 'clear', reason: 'multi-signer', facts: { decidedBy: [] } });
  });

  it('is clear for the recorded 3-of-4 Safe that owns the pool and administers the token', async () => {
    expect(singleKeyOf(evaluate([await fixtureRow(burnMint151)]), burnMint151.token)).toMatchObject({ value: 'clear', reason: 'multi-signer' });
  });

  it('AE15: is "not readable" when the owner is a contract ccip.dev cannot identify and no party is a single key', async () => {
    const results = evaluate([await fixtureRow(burnMint151, { parties: { '0xecf08409a5e35aa58a887cf892c6af6648727281': UNIDENTIFIED } })]);
    expect(singleKeyOf(results, burnMint151.token)).toMatchObject({ value: 'not readable', reason: 'party-unidentified', facts: { decidedBy: ['poolOwner', 'registryAdministrator'] } });
  });

  it('flags an unidentified owner beside a wallet rate-limit admin, naming the rate-limit admin', async () => {
    const results = evaluate([await fixtureRow(noHooks200, { parties: { '0x0c6bbfd2d5666d44bf28580edeec0263692c8316': UNIDENTIFIED } })]);
    expect(singleKeyOf(results, noHooks200.token)).toMatchObject({ value: 'flagged', reason: 'single-key', facts: { decidedBy: ['rateLimitAdmin'] } });
  });

  it('gives "not readable" when the proxy status is unknown and no party is a single key', async () => {
    const results = evaluate([
      await fixtureRow(burnMint151, { settings: (s) => ({ ...s, parties: { ...s.parties, proxyAdmin: { state: 'unanswered', reason: 'proxy status unknown' } } }) }),
    ]);
    expect(singleKeyOf(results, burnMint151.token)).toMatchObject({ value: 'not readable', reason: 'proxy-status-unknown', facts: { decidedBy: ['proxyAdmin'] } });
  });

  it('gives "not readable" on a standard pool with an unidentified party and no single key', async () => {
    expect(singleKeyOf(evaluate([await fixtureRow(gho151)]), gho151.token)).toMatchObject({ value: 'not readable', reason: 'party-unidentified' });
  });

  it('never gives clear on a pool type it does not recognise, but still flags a wallet owner there', async () => {
    expect(singleKeyOf(evaluate([await fixtureRow(customEnergy)]), customEnergy.token)).toMatchObject({ value: 'not readable', reason: 'pool-type-not-recognised' });
    const walletOwned = evaluate([await fixtureRow(customEnergy, { parties: { '0xe637218e7528ddbc5568b15f23725540041a6b20': WALLET } })]);
    expect(singleKeyOf(walletOwned, customEnergy.token)).toMatchObject({ value: 'flagged', reason: 'single-key' });
  });

  it('flags two wallets on Base that own the pool and administer the token', async () => {
    expect(singleKeyOf(evaluate([await fixtureRow(hooks200)]), hooks200.token)).toMatchObject({ value: 'flagged', facts: { decidedBy: ['poolOwner', 'registryAdministrator', 'hooksOwner'] } });
  });
});

describe('rate-limit check', () => {
  it('AE5: flags a lane whose outbound limit is off and shows "no limit"', async () => {
    const result = laneOf(evaluate([await fixtureRow(hooks200)]), hooks200.token, ETHEREUM)!;
    expect(result).toMatchObject({ value: 'flagged', reason: 'limit-off' });
    expect(result.facts.perHour).toEqual([{ finality: 'standard', limit: 'off' }]);
  });

  it('AE14: reads the outbound limit, gives 4,600 tokens an hour, and notes the receiving side sets no limit', () => {
    const rows = pair(
      [lane(BASE, B_TOKEN, [B_POOL], { outbound: limit(true, '1000000000000000000000', '1000000000000000000') })],
      [lane(ETHEREUM, A_TOKEN, [A_POOL], { outbound: limit(true, '1', '1'), inbound: OFF })],
    );
    const result = laneOf(evaluate(rows), A_TOKEN, BASE)!;
    expect(result).toMatchObject({ value: 'clear', reason: 'limit-on' });
    expect(result.facts.perHour).toEqual([{ finality: 'standard', limit: 'on', units: '4600000000000000000000', tokens: '4600', usd: null }]);
    expect(result.facts.receivingInbound).toBe('off');
  });

  it('AE5: shows token units only without a price, and dollars beside them with one', () => {
    const lanes = [lane(BASE, B_TOKEN, [B_POOL], { outbound: limit(true, '1000000000000000000000', '1000000000000000000') })];
    const priced = [readRow(ETHEREUM, settings(A_TOKEN, A_POOL, lanes), MULTISIG_PARTIES, TODAY, { priceUsd: 0.5 })];
    expect(laneOf(evaluate(priced), A_TOKEN, BASE)!.facts.perHour).toEqual([{ finality: 'standard', limit: 'on', units: '4600000000000000000000', tokens: '4600', usd: 2300 }]);
  });

  it('shows no token figure when the token has no decimals on record', () => {
    const lanes = [lane(BASE, B_TOKEN, [B_POOL], { outbound: limit(true, '1000', '1') })];
    const rows = [readRow(ETHEREUM, settings(A_TOKEN, A_POOL, lanes), MULTISIG_PARTIES, TODAY, { decimals: null, priceUsd: 2 })];
    expect(laneOf(evaluate(rows), A_TOKEN, BASE)!.facts.perHour).toEqual([{ finality: 'standard', limit: 'on', units: '4600', tokens: null, usd: null }]);
  });

  it('adds the fast-finality figure on a 2.0 pool that allows fast finality with both limits on', async () => {
    const result = laneOf(evaluate([await fixtureRow(noHooks200)]), noHooks200.token, SOLANA)!;
    expect(result).toMatchObject({ value: 'clear', reason: 'limit-on' });
    expect(result.facts.perHour).toEqual([
      { finality: 'standard', limit: 'on', units: '1749999999999999999998400', tokens: '1749999.9999999999999984', usd: null },
      { finality: 'fast', limit: 'on', units: '3602', tokens: '0.000000000000003602', usd: null },
    ]);
  });

  it('shows one figure on a 2.0 lane whose fast-finality limit is off', async () => {
    const row = await fixtureRow(noHooks200, { settings: (s) => withLane(s, SOLANA, { fastOutbound: OFF }) });
    const result = laneOf(evaluate([row]), noHooks200.token, SOLANA)!;
    expect(result.value).toBe('clear');
    expect(result.facts.perHour.map((f) => f.finality)).toEqual(['standard']);
  });

  it('shows one figure when the pool allows only waiting for finality', async () => {
    const row = await fixtureRow(noHooks200, { settings: (s) => ({ ...s, allowedFinality: { value: '0x00000000' } }) });
    expect(laneOf(evaluate([row]), noHooks200.token, SOLANA)!.facts.perHour.map((f) => f.finality)).toEqual(['standard']);
  });

  it('flags a 2.0 lane whose standard limit is off even when its fast-finality limit is on', async () => {
    const row = await fixtureRow(noHooks200, { settings: (s) => withLane(s, SOLANA, { outbound: OFF }) });
    expect(laneOf(evaluate([row]), noHooks200.token, SOLANA)).toMatchObject({ value: 'flagged', reason: 'limit-off' });
  });

  it('gives "not readable" for every lane of a USDC-style proxy pool, keyed on the group\'s other chains', async () => {
    const results = evaluate([await fixtureRow(usdcProxy), row(BASE, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')]);
    expect(rateLimitsOf(results, usdcProxy.token).map((r) => [r.remoteChain, r.value, r.reason])).toEqual([[BASE, 'not readable', 'proxy-pool']]);
  });

  it('gives no lane results to a row with no pool set', async () => {
    const results = evaluate([await fixtureRow(noPool)]);
    expect(rateLimitsOf(results, noPool.token)).toEqual([]);
    expect(singleKeyOf(results, noPool.token)).toMatchObject({ value: 'not readable', reason: 'party-unidentified', facts: { decidedBy: ['registryAdministrator'] } });
  });
});

function withLane(s: RawSettings, remote: string, over: Partial<RawLane>): RawSettings {
  if (!('value' in s.lanes)) throw new Error('lanes not readable');
  return { ...s, lanes: { value: s.lanes.value.map((l) => (l.remoteChainSelector === remote ? { ...l, ...over } : l)) } };
}

describe('verifier line', () => {
  it('AE4: lists the default verifier by name and adds no flag-capable result', async () => {
    const results = evaluate([await fixtureRow(hooks200)]);
    expect(laneOf(results, hooks200.token, '4051577828743386545')!.facts.verifiers).toEqual([
      { direction: 'outbound', state: 'listed', verifiers: [{ address: COMMITTEE, name: 'Committee Verifier (Default)' }], threshold: null },
    ]);
    expect(new Set(results.map((r) => r.check))).toEqual(new Set(['single-key', 'rate-limit', 'pool-pointer']));
    expect(CHECK_KINDS).toEqual(['single-key', 'rate-limit', 'pool-pointer']);
  });

  it('adds the pool\'s inbound list as a second line', async () => {
    expect(laneOf(evaluate([await fixtureRow(hooks200)]), hooks200.token, '2308837218439511688')!.facts.verifiers).toEqual([
      { direction: 'outbound', state: 'listed', verifiers: [{ address: COMMITTEE, name: 'Committee Verifier (Default)' }], threshold: null },
      { direction: 'inbound', state: 'listed', verifiers: [{ address: COMMITTEE, name: 'Committee Verifier (Default)' }], threshold: null },
    ]);
  });

  it('reads "CCIP 1.x lane" for a lane on a 1.x OnRamp', async () => {
    expect(laneOf(evaluate([await fixtureRow(burnMint151)]), burnMint151.token, SOLANA)!.facts.verifiers).toEqual([{ direction: 'outbound', state: 'ccip-1x' }]);
  });

  it('adds the threshold list with its amount in token units, and names an unlisted verifier as custom', () => {
    const lanes = [
      lane(BASE, B_TOKEN, [B_POOL], {
        laneVerifiers: { value: { onRamp: '2.x', mandated: [], defaults: [COMMITTEE] } },
        poolVerifiers: { value: { outbound: [CUSTOM_VERIFIER], thresholdOutbound: [CCTP], inbound: [], thresholdInbound: [] } },
      }),
    ];
    const s = settings(A_TOKEN, A_POOL, lanes, { hooks: { value: { address: '0x4040404040404040404040404040404040404040', thresholdAmount: { value: '5000000000000000000000' } } } });
    expect(laneOf(evaluate([readRow(ETHEREUM, s, MULTISIG_PARTIES)]), A_TOKEN, BASE)!.facts.verifiers).toEqual([
      {
        direction: 'outbound',
        state: 'listed',
        verifiers: [{ address: CUSTOM_VERIFIER, name: null }],
        threshold: { units: '5000000000000000000000', tokens: '5000', verifiers: [{ address: CCTP, name: 'CCTP Verifier' }] },
      },
    ]);
  });

  it('puts the lane\'s mandated verifiers ahead of the pool\'s own list', () => {
    const lanes = [
      lane(BASE, B_TOKEN, [B_POOL], {
        laneVerifiers: { value: { onRamp: '2.x', mandated: [CCTP], defaults: [COMMITTEE] } },
        poolVerifiers: { value: { outbound: [], thresholdOutbound: [], inbound: [], thresholdInbound: [] } },
      }),
    ];
    const line = laneOf(evaluate([readRow(ETHEREUM, settings(A_TOKEN, A_POOL, lanes), MULTISIG_PARTIES)]), A_TOKEN, BASE)!.facts.verifiers[0];
    expect(line).toEqual({ direction: 'outbound', state: 'listed', verifiers: [{ address: CCTP, name: 'CCTP Verifier' }, { address: COMMITTEE, name: 'Committee Verifier (Default)' }], threshold: null });
  });
});

describe('pool-pointer check', () => {
  const aToB = (pools = [B_POOL], token = B_TOKEN) => lane(BASE, token, pools);
  const bToA = (pools = [A_POOL], token = A_TOKEN) => lane(ETHEREUM, token, pools);

  it('is clear when each side lists the other\'s pool and token, and stays clear beside an older pool', () => {
    expect(pairsOf(evaluate(pair([aToB()], [bToA()]))).map((r) => [r.value, r.reason, r.readOn])).toEqual([['clear', 'pools-point-at-each-other', TODAY]]);
    expect(pairsOf(evaluate(pair([aToB([OLD_POOL, B_POOL])], [bToA()])))[0]!.value).toBe('clear');
  });

  it('is one flag when A\'s remote pools lack B\'s registry pool', () => {
    const pairs = pairsOf(evaluate(pair([aToB([OLD_POOL])], [bToA()])));
    expect(pairs.map((r) => [r.value, r.reason])).toEqual([['flagged', 'pointer-broken']]);
    expect(pairs[0]!.facts.sides).toEqual([
      { from: { chain: ETHEREUM, token: A_TOKEN }, to: BASE, state: 'pool-not-listed' },
      { from: { chain: BASE, token: B_TOKEN }, to: ETHEREUM, state: 'points' },
    ]);
  });

  it('flags a pair where A lists B\'s chain and B does not list A\'s', () => {
    const pairs = pairsOf(evaluate(pair([aToB()], [])));
    expect(pairs.map((r) => [r.value, r.facts.sides.map((s) => s.state)])).toEqual([['flagged', ['points', 'no-lane']]]);
  });

  it('flags a pair whose remote token is not the other row\'s token', () => {
    expect(pairsOf(evaluate(pair([aToB([B_POOL], OLD_POOL)], [bToA()])))[0]!.facts.sides[0]!.state).toBe('wrong-token');
  });

  it('gives no result for a second row on a chain when the lane names its sibling and the second row does not list back', () => {
    const B2_TOKEN = '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
    const rows = [...pair([aToB()], [bToA()]), readRow(BASE, settings(B2_TOKEN, '0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3', []), MULTISIG_PARTIES)];
    expect(pairsOf(evaluate(rows)).map((r) => [r.rows.map((x) => x.token), r.value])).toEqual([[[A_TOKEN, B_TOKEN], 'clear']]);
  });

  it('gives no result for two rows that do not list each other', () => {
    expect(pairsOf(evaluate(pair([], [])))).toEqual([]);
  });

  it('keeps the last result and its date while the rows were read on different days', () => {
    const yesterday = '2026-11-22';
    const previous = evaluate(pair([aToB()], [bToA()], { a: yesterday, b: yesterday }), { today: yesterday });
    const today = pairsOf(evaluate(pair([aToB([OLD_POOL])], [bToA()], { b: yesterday }), { previous }));
    expect(today).toEqual(pairsOf(previous));
    expect(today[0]).toMatchObject({ value: 'clear', readOn: yesterday });
  });

  it('turns "not readable" after seven days without a day both rows were read', () => {
    const lastBoth = '2026-11-15';
    const previous = evaluate(pair([aToB()], [bToA()], { a: lastBoth, b: lastBoth }), { today: lastBoth });
    const today = pairsOf(evaluate(pair([aToB()], [bToA()], { b: '2026-11-16' }), { previous }));
    expect(today.map((r) => [r.value, r.reason, r.readOn])).toEqual([['not readable', 'reading-too-old', lastBoth]]);
  });

  it('is "not readable" when the other row cannot be read by design', () => {
    const rows = [readRow(ETHEREUM, settings(A_TOKEN, A_POOL, [aToB()]), MULTISIG_PARTIES), row(BASE, B_TOKEN, { unreadableByDesign: 'no-endpoint' })];
    expect(pairsOf(evaluate(rows)).map((r) => [r.value, r.reason])).toEqual([['not readable', 'no-endpoint']]);
  });

  it('is "not readable" when the remote chain has no row in the group', () => {
    const rows = [readRow(ETHEREUM, settings(A_TOKEN, A_POOL, [lane(ARBITRUM, B_TOKEN, [B_POOL])]), MULTISIG_PARTIES)];
    const pairs = pairsOf(evaluate(rows));
    expect(pairs.map((r) => [r.value, r.reason, r.rows])).toEqual([['not readable', 'remote-chain-not-in-group', [{ chain: ETHEREUM, token: A_TOKEN }, { chain: ARBITRUM, token: null }]]]);
  });
});

describe('readings that age', () => {
  it('keeps the results and date of a reading three days old', async () => {
    const results = evaluate([await fixtureRow(burnMint151, { readOn: '2026-11-20' })]);
    expect(singleKeyOf(results, burnMint151.token)).toMatchObject({ value: 'clear', readOn: '2026-11-20' });
    expect(laneOf(results, burnMint151.token, SOLANA)).toMatchObject({ value: 'flagged', readOn: '2026-11-20' });
  });

  it('gives "not readable" with the last read date for a reading eight days old', async () => {
    const results = evaluate([await fixtureRow(burnMint151, { readOn: '2026-11-15' })]);
    expect(results.every((r) => r.value === 'not readable' && r.reason === 'reading-too-old' && r.readOn === '2026-11-15')).toBe(true);
    expect(rateLimitsOf(results, burnMint151.token)).toHaveLength(6);
  });

  it('gives "not readable" for a row never read, with one lane result when the group has no other chain', () => {
    expect(evaluate([row(ETHEREUM, A_TOKEN)]).map((r) => [r.check, r.value, r.reason, r.readOn])).toEqual([
      ['single-key', 'not readable', 'never-read', null],
      ['rate-limit', 'not readable', 'never-read', null],
    ]);
  });
});

describe('basis and corrections', () => {
  it('keeps a basis while the deciding values hold, and changes it when they change', () => {
    const lanes = (on: boolean) => [lane(BASE, B_TOKEN, [B_POOL], { outbound: limit(on, '10', '1') })];
    const basisOf = (rows: PassportRow[]) => laneOf(evaluate(rows), A_TOKEN, BASE)!.basis;
    const monday = basisOf([readRow(ETHEREUM, settings(A_TOKEN, A_POOL, lanes(true)), MULTISIG_PARTIES, '2026-11-20')]);
    expect(basisOf([readRow(ETHEREUM, settings(A_TOKEN, A_POOL, lanes(true)), MULTISIG_PARTIES)])).toBe(monday);
    expect(basisOf([readRow(ETHEREUM, settings(A_TOKEN, A_POOL, lanes(false)), MULTISIG_PARTIES)])).not.toBe(monday);
  });

  it('applies a correction whose basis matches and ignores one whose basis differs', async () => {
    const rows = [await fixtureRow(burnMint151)];
    const read = singleKeyOf(evaluate(rows), burnMint151.token)!;
    const corrected = singleKeyOf(evaluate(rows, { corrections: [{ key: read.key, basis: read.basis, value: 'flagged', reason: 'single-key' }] }), burnMint151.token);
    expect(corrected).toMatchObject({ value: 'flagged', reason: 'single-key', corrected: true, basis: read.basis });
    const stale = singleKeyOf(evaluate(rows, { corrections: [{ key: read.key, basis: 'not-this-one', value: 'flagged', reason: 'single-key' }] }), burnMint151.token);
    expect(stale).toEqual(read);
    expect(read.corrected).toBe(false);
  });

  it('stamps every result with the method version and a reason from the published list', async () => {
    const results = evaluate([await fixtureRow(hooks200), await fixtureRow(gho151)]);
    expect(results.every((r) => r.methodVersion === METHOD_VERSION && (REASON_CODES as readonly string[]).includes(r.reason))).toBe(true);
  });
});

describe('groupName', () => {
  const named = (chain: string, symbol: string | null, name: string | null, token = A_TOKEN) => ({ chain, token, symbol, name });

  it('takes the more common symbol in a group mixing PAAL and $PAAL', () => {
    expect(groupName([named(ETHEREUM, '$PAAL', 'PAAL AI'), named(BASE, 'PAAL', 'PAAL AI'), named(ARBITRUM, 'PAAL', 'PAAL AI')])).toEqual({ symbol: 'PAAL', name: 'PAAL AI' });
  });

  it('gives a tie to the Ethereum row, then to the lowest chain selector', () => {
    expect(groupName([named(BASE, 'B', 'Bee'), named(ETHEREUM, 'E', 'Eee')])).toEqual({ symbol: 'E', name: 'Eee' });
    expect(groupName([named(BASE, 'B', 'Bee'), named(ARBITRUM, 'A', 'Aye')])).toEqual({ symbol: 'A', name: 'Aye' });
  });

  it('ignores blank symbols and names', () => {
    expect(groupName([named(ETHEREUM, '  ', ''), named(BASE, 'B', 'Bee')])).toEqual({ symbol: 'B', name: 'Bee' });
  });

  it('calls a group with no name "Unnamed token" with a short address', () => {
    expect(groupName([named(BASE, null, null, B_TOKEN), named(ARBITRUM, '', null, A_TOKEN)])).toEqual({ symbol: null, name: 'Unnamed token 0xaaaa…aaaa' });
  });
});

describe('rollupChecks', () => {
  it('rolls one flagged and five clear results up to flagged, with no count', () => {
    const lanes = [OFF, ...Array.from({ length: 5 }, () => limit(true, '1', '1'))].map((outbound, i) => lane(String(1000 + i), B_TOKEN, [B_POOL], { outbound }));
    const results = evaluate([readRow(ETHEREUM, settings(A_TOKEN, A_POOL, lanes), MULTISIG_PARTIES)]);
    expect(rateLimitsOf(results, A_TOKEN).map((r) => r.value)).toEqual(['flagged', 'clear', 'clear', 'clear', 'clear', 'clear']);
    expect(rollupChecks(results)).toEqual({ 'single-key': 'clear', 'rate-limit': 'flagged', 'pool-pointer': 'not readable' });
  });

  it('puts "not readable" ahead of clear and gives null to a check with no result', () => {
    expect(rollupChecks(evaluate([row(ETHEREUM, A_TOKEN)]))).toEqual({ 'single-key': 'not readable', 'rate-limit': 'not readable', 'pool-pointer': null });
  });
});

describe('golden results', () => {
  it('match every recorded pool fixture under the current method version', async () => {
    const fixtures: Record<string, Fixture> = { hooks200, burnMint151, andProxy150, customEnergy, gho151, lockRelease16Dev, noHooks200, noPool, usdcProxy };
    const results: Record<string, CheckResult[]> = {};
    for (const [name, fixture] of Object.entries(fixtures)) {
      const readOn = new Date(fixture.timestamp * 1000).toISOString().slice(0, 10);
      results[name] = evaluate([await fixtureRow(fixture, { readOn, decimals: null })]);
    }
    const golden = `${JSON.stringify({ methodVersion: METHOD_VERSION, results }, null, 2)}\n`;
    await expect(golden).toMatchFileSnapshot('./fixtures/passport/checks/golden.json');
  });
});
