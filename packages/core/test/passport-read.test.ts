import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { uintWord } from '../src/evm-abi';
import type { PinnedChain } from '../src/evm-read';
import type { HttpDeps } from '../src/http';
import { readPassportChain, WrongRegistryError, type RawLane, type RawSettings, type RowReading } from '../src/passport-read';
import { evmCallKey, fakeEvmChain, fakeFetch, type FakeEvmChain, type FakeEvmChainOptions, type RecordedCall } from '../src/testing';
import burnMint151 from './fixtures/passport/pools/ethereum-burn-mint-1.5.1.json';
import andProxy150 from './fixtures/passport/pools/ethereum-burn-mint-and-proxy-1.5.0.json';
import lockRelease16Dev from './fixtures/passport/pools/ethereum-lock-release-1.6.x-dev.json';
import hooks200 from './fixtures/passport/pools/base-burn-mint-2.0.0-hooks.json';
import noHooks200 from './fixtures/passport/pools/ethereum-lock-release-2.0.0-no-hooks.json';
import usdcProxy from './fixtures/passport/pools/ethereum-usdc-proxy-2.0.0.json';
import noPool from './fixtures/passport/pools/ethereum-no-pool.json';
import customEnergy from './fixtures/passport/pools/ethereum-custom-energy-1.0.0.json';
import proxyAdmin151 from './fixtures/passport/pools/ethereum-lock-release-1.5.1-proxy-admin.json';

interface Fixture {
  chainId: number;
  block: number;
  blockHash: string;
  timestamp: number;
  registry: string;
  token: string;
  pool: string;
  onRamps: Record<string, string>;
  calls: ({ to: string; data: string; result: string } | { to: string; data: string; revert: boolean })[];
  storage: Record<string, string>;
}

const FIXTURES: Record<string, Fixture> = { burnMint151, andProxy150, lockRelease16Dev, hooks200, noHooks200, usdcProxy, noPool, customEnergy, proxyAdmin151 };

const selector = (signature: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8)}`;

const SIGNATURES = [
  'typeAndVersion()',
  'owner()',
  'getTokenConfig(address)',
  'getSupportedChains()',
  'getRateLimitAdmin()',
  'getDynamicConfig()',
  'getAdvancedPoolHooks()',
  'getAllowedFinalityConfig()',
  'getRemotePools(uint64)',
  'getRemotePool(uint64)',
  'getRemoteToken(uint64)',
  'getCurrentOutboundRateLimiterState(uint64)',
  'getCurrentInboundRateLimiterState(uint64)',
  'getCurrentRateLimiterState(uint64,bool)',
  'getCCVConfig(uint64)',
  'getThresholdAmount()',
  'getDestChainConfig(uint64)',
];
const SIGNATURE_OF = new Map(SIGNATURES.map((s) => [selector(s), s]));

const ZERO = '0x0000000000000000000000000000000000000000';
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const COMMITTEE_VERIFIER = '0x2caafd3b4cf606220580c885bd2b448fb93dc03b';
const SOLANA = '124615329519749607';
const ARBITRUM = '4949039107694359620';

const recordedCalls = (fixture: Fixture): Record<string, RecordedCall> =>
  Object.fromEntries(fixture.calls.map((c) => [evmCallKey(c.to, c.data), 'result' in c ? (c.result as `0x${string}`) : 'revert']));

const callTo = (to: string, signature: string, ...args: bigint[]) => evmCallKey(to, `${selector(signature)}${args.map(uintWord).join('')}`);

/** An ABI-encoded string answer, built here rather than through the codec under test. */
function stringAnswer(text: string): `0x${string}` {
  const bytes = bytesToHex(utf8ToBytes(text));
  return `0x${uintWord(0x20n)}${uintWord(BigInt(bytes.length / 2))}${bytes.padEnd(Math.ceil(bytes.length / 64) * 64, '0')}`;
}

interface Setup {
  fixtures: Fixture[];
  calls?: Record<string, RecordedCall>;
  storage?: FakeEvmChainOptions['storage'];
  multicall3?: boolean;
}

function chainFor({ fixtures, calls = {}, storage, multicall3 = true }: Setup) {
  const first = fixtures[0]!;
  const fake = fakeEvmChain({
    chainId: first.chainId,
    latest: first.block + 12,
    timestamp: first.timestamp,
    calls: Object.assign({}, ...fixtures.map(recordedCalls), calls),
    storage: storage ?? Object.assign({}, ...fixtures.map((f) => f.storage)),
  });
  const deps: HttpDeps = { fetch: fakeFetch(fake), sleep: async () => {}, clock: () => first.timestamp * 1000 };
  const pinned: PinnedChain = { rpcUrl: 'https://rpc.example', chainId: first.chainId, block: first.block, blockHash: first.blockHash, timestamp: first.timestamp, multicall3 };
  return { fake, deps, pinned };
}

async function readRows(setup: Setup): Promise<{ rows: RowReading[]; fake: FakeEvmChain }> {
  const { fake, deps, pinned } = chainFor(setup);
  const onRamps = Object.assign({}, ...setup.fixtures.map((f) => f.onRamps));
  const rows = await readPassportChain(deps, pinned, { registry: setup.fixtures[0]!.registry, onRamps, tokens: setup.fixtures.map((f) => f.token) });
  return { rows, fake };
}

async function settingsOf(fixture: Fixture, over: Omit<Setup, 'fixtures'> = {}): Promise<RawSettings> {
  const { rows } = await readRows({ fixtures: [fixture], ...over });
  const row = rows[0]!;
  if (row.status !== 'read') throw new Error(`row unread: ${row.failures.join('; ')}`);
  return row.settings;
}

function laneOf(settings: RawSettings, remote: string): RawLane {
  if (!('value' in settings.lanes)) throw new Error(`lanes not readable: ${settings.lanes.reason}`);
  const lane = settings.lanes.value.find((l) => l.remoteChainSelector === remote);
  if (lane === undefined) throw new Error(`no lane to ${remote}`);
  return lane;
}

const disabled = { value: { isEnabled: false, capacity: '0', rate: '0' } };
const missing = { reason: 'getter missing' } as const;

describe('recorded fixtures', () => {
  it('ask only getters whose selectors are recomputed here from their signatures', () => {
    const unknown = Object.values(FIXTURES)
      .flatMap((f) => f.calls)
      .map((c) => c.data.slice(0, 10))
      .filter((s) => !SIGNATURE_OF.has(s));
    expect(unknown).toEqual([]);
  });
});

describe('readPassportChain on a BurnMintTokenPool 1.5.1', () => {
  it('yields the registry row, the owner, the rate-limit admin and every supported lane with its remote token, remote pools and limits', async () => {
    const owner = '0xecf08409a5e35aa58a887cf892c6af6648727281';
    const lane = (remoteChainSelector: string, remoteToken: string, remotePool: string, laneVerifiers: RawLane['laneVerifiers']): RawLane => ({
      remoteChainSelector,
      remoteToken: { value: remoteToken },
      remotePools: { value: [remotePool] },
      outbound: disabled,
      inbound: disabled,
      fastOutbound: missing,
      fastInbound: missing,
      poolVerifiers: missing,
      laneVerifiers,
    });
    const v2Lane = { value: { onRamp: '2.x' as const, mandated: [], defaults: [COMMITTEE_VERIFIER] } };
    expect(await settingsOf(burnMint151)).toEqual({
      token: '0x4c1dab3be86347977f3dfc4b9688224ef2272939',
      administrator: owner,
      pendingAdministrator: ZERO,
      pool: '0xe25a97e9e2f1eeee81d4a7986a018ac3ae8d857b',
      poolType: { value: { typeAndVersion: 'BurnMintTokenPool 1.5.1', name: 'BurnMintTokenPool', version: '1.5.1', line: '1.5', standard: true } },
      parties: {
        poolOwner: { state: 'address', address: owner },
        registryAdministrator: { state: 'address', address: owner },
        rateLimitAdmin: { state: 'absent' },
        hooksOwner: { state: 'missing', reason: 'getter missing' },
        proxyAdmin: { state: 'absent' },
      },
      hooks: missing,
      allowedFinality: missing,
      lanes: {
        value: [
          lane(SOLANA, '0x0a167e7c5296649af23296209c0d921b1f9aa1bca18df3960084a1771e670561', '0x3899a7869372bdeef2cb310ec86f18fd3be8f51378f5f7d529135f2ba54fd9e6', { value: { onRamp: '1.x' } }),
          lane('4426351306075016396', '0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c', '0xf6839b313671dae8c1b6abcab4ebd0bf41259187', v2Lane),
          lane(ARBITRUM, '0x418176040912d11d9445dd4aec322772a42f2a59', '0x22ff19a7307eee6bd6d38c569f8bcb40fd071ff4', v2Lane),
          lane('8481857512324358265', '0xb267cc10fa4c54db1fd5a6e9cafbb98c16cc9b97', '0x4c8a1e94c84f9043e26b3bbff76f670a91e645a1', v2Lane),
          lane('11344663589394136015', '0x2c2d4d99f95643c8ec2ebd1d73a6fd0273068b1e', '0x467721ad1f05235b84b6c94e012b12c79d9ebfd7', v2Lane),
          lane('15971525489660198786', '0x23cd099eb438cca50349ee2bc809196b1ae00861', '0x049df7ed53037c58bcab45510c153d5cd5564830', v2Lane),
        ],
      },
    });
  });

  it('reads enabled limits and a set rate-limit admin from a LockReleaseTokenPool 1.5.1', async () => {
    const settings = await settingsOf(proxyAdmin151);
    expect(settings.parties.rateLimitAdmin).toEqual({ state: 'address', address: '0xc5bcc58be6172769ca1a78b8a45752e3c5059c39' });
    const limit = { value: { isEnabled: true, capacity: '5000000000000000000000000', rate: '1000000000000000000000' } };
    expect(laneOf(settings, ARBITRUM)).toMatchObject({
      remotePools: { value: ['0x26329558f08cbb40d6a4cca0e0c67b29d64a8c50', '0xb94ab28c6869466a46a42aba834ca2b3cecca5eb'] },
      outbound: limit,
      inbound: limit,
    });
  });

  it('records a rate-limit admin whose getter does not answer on this standard pool type as unanswered', async () => {
    const pool = burnMint151.pool;
    const settings = await settingsOf(burnMint151, { calls: { [callTo(pool, 'getRateLimitAdmin()')]: 'revert' } });
    expect(settings.parties.rateLimitAdmin).toEqual({ state: 'unanswered', reason: 'getter unanswered' });
  });

  it('records a pool with a non-zero EIP-1967 admin slot with its proxy admin', async () => {
    expect((await settingsOf(proxyAdmin151)).parties.proxyAdmin).toEqual({ state: 'address', address: '0xb54f773211331f3889b74624d341e49328e83473' });
  });

  it('records the proxy status as unknown where the node refuses eth_getStorageAt, and reads the rest', async () => {
    const settings = await settingsOf(proxyAdmin151, { storage: 'unsupported' });
    expect(settings.parties.proxyAdmin).toEqual({ state: 'unanswered', reason: 'proxy status unknown' });
    expect(settings.parties.poolOwner).toEqual({ state: 'address', address: '0x5300a1a15135ea4dc7ad5a167152c01efc9b192a' });
  });
});

describe('readPassportChain on older and newer pool versions', () => {
  it('reads a BurnMintTokenPoolAndProxy 1.5.0 remote pool through getRemotePool, ignoring the getRemotePools revert', async () => {
    const lane = laneOf(await settingsOf(andProxy150), ARBITRUM);
    expect(lane.remotePools).toEqual({ value: ['0xcba063b1f328e4d42b05a165cbbb590939bdd70a'] });
    expect(lane.remoteToken).toEqual({ value: '0x94025780a1ab58868d9b2dbbb775f44b32e8e6e5' });
  });

  it('reads a pool reporting 1.6.x-dev as a 1.6 pool with its 1.x limits', async () => {
    const settings = await settingsOf(lockRelease16Dev);
    expect(settings.poolType).toEqual({ value: { typeAndVersion: 'LockReleaseTokenPool 1.6.x-dev', name: 'LockReleaseTokenPool', version: '1.6.x-dev', line: '1.6', standard: true } });
    expect(laneOf(settings, '15971525489660198786')).toMatchObject({
      outbound: { value: { isEnabled: true, capacity: '1000000000000000000000', rate: '11574000000000000' } },
      inbound: { value: { isEnabled: true, capacity: '55000000000000000000000', rate: '636574074000000000' } },
    });
  });

  it('reads a 2.0.0 pool with hooks: limits from the ten-word state, admin from getDynamicConfig, the hooks and their owner, both verifier lists and the threshold', async () => {
    const settings = await settingsOf(hooks200);
    expect(settings.parties).toMatchObject({
      poolOwner: { state: 'address', address: '0xf940b3780adfe1e56194b76055b086e83a82c1ee' },
      rateLimitAdmin: { state: 'absent' },
      hooksOwner: { state: 'address', address: '0xf940b3780adfe1e56194b76055b086e83a82c1ee' },
    });
    expect(settings.hooks).toEqual({ value: { address: '0xf9b85c04863bc8342a50e52d8076c16b1bb2d78b', thresholdAmount: { value: '0' } } });
    expect(laneOf(settings, '2308837218439511688')).toEqual({
      remoteChainSelector: '2308837218439511688',
      remoteToken: { value: '0xcb501b3be628df250006aba41f4a1c46ce8527349eca94fd6dbbb0cb7ed0c370' },
      remotePools: { value: ['0xe79e4f81916bab13b848f933bb1cdf17dad2f39fd112a264f8ca5f8aaa75a025'] },
      outbound: disabled,
      inbound: disabled,
      fastOutbound: disabled,
      fastInbound: disabled,
      poolVerifiers: { value: { outbound: [COMMITTEE_VERIFIER], thresholdOutbound: [], inbound: [COMMITTEE_VERIFIER], thresholdInbound: [] } },
      laneVerifiers: { value: { onRamp: '2.x', mandated: [], defaults: [COMMITTEE_VERIFIER] } },
    });
    expect(laneOf(settings, '5009297550715157269').poolVerifiers).toEqual({ value: { outbound: [], thresholdOutbound: [], inbound: [], thresholdInbound: [] } });
  });

  it('reads a 2.0.0 pool’s allowed finality and its fast-finality limits apart from the standard ones', async () => {
    const settings = await settingsOf(noHooks200);
    expect(settings.allowedFinality).toEqual({ value: '0x0000000c' });
    expect(settings.parties.rateLimitAdmin).toEqual({ state: 'address', address: '0x5a54bbae78a3f043a1a41d6f9eb39fb2a1f766c7' });
    const standard = { value: { isEnabled: true, capacity: '1500000000000000000000000', rate: '69444444444444444444' } };
    expect(laneOf(settings, ARBITRUM)).toMatchObject({
      outbound: standard,
      inbound: standard,
      fastOutbound: { value: { isEnabled: true, capacity: '250000000000000000000000', rate: '250000000000000000000' } },
      fastInbound: disabled,
    });
  });

  it('reads a 2.0.0 pool without hooks as empty pool verifier lists beside the lane’s default verifiers', async () => {
    const settings = await settingsOf(noHooks200);
    expect(settings.hooks).toEqual({ value: null });
    expect(settings.parties.hooksOwner).toEqual({ state: 'absent' });
    expect(laneOf(settings, ARBITRUM)).toMatchObject({
      poolVerifiers: { value: { outbound: [], thresholdOutbound: [], inbound: [], thresholdInbound: [] } },
      laneVerifiers: { value: { onRamp: '2.x', mandated: [], defaults: [COMMITTEE_VERIFIER] } },
    });
  });

  it('marks a lane whose OnRamp reports a 1.x version as a 1.x lane and asks that OnRamp for no verifier set', async () => {
    const { rows, fake } = await readRows({ fixtures: [noHooks200] });
    const settings = (rows[0] as { settings: RawSettings }).settings;
    expect(laneOf(settings, SOLANA).laneVerifiers).toEqual({ value: { onRamp: '1.x' } });
    const asked = JSON.stringify(fake.requests);
    expect(asked).toContain(selector('getDestChainConfig(uint64)').slice(2));
    expect(asked).not.toContain(`${selector('getDestChainConfig(uint64)').slice(2)}${uintWord(BigInt(SOLANA))}`);
  });
});

describe('readPassportChain on pools it cannot read in full', () => {
  it('reads a USDCTokenPoolProxy 2.0.0’s owner, and its lanes carry the reason "proxy pool"', async () => {
    const settings = await settingsOf(usdcProxy);
    expect(settings.parties.poolOwner).toEqual({ state: 'address', address: '0x44835bbba9d40deda9b64858095ecfb2693c9449' });
    expect(settings.lanes).toEqual({ reason: 'proxy pool' });
  });

  it('records "no pool set" for a registered token whose registry pool is the zero address, with no pool call made', async () => {
    const { rows, fake } = await readRows({ fixtures: [noPool], multicall3: false });
    const settings = (rows[0] as { settings: RawSettings }).settings;
    expect(settings).toMatchObject({
      pool: ZERO,
      administrator: '0x44835bbba9d40deda9b64858095ecfb2693c9449',
      poolType: { reason: 'no pool set' },
      lanes: { reason: 'no pool set' },
      parties: { poolOwner: { state: 'missing', reason: 'no pool set' }, registryAdministrator: { state: 'address', address: '0x44835bbba9d40deda9b64858095ecfb2693c9449' } },
    });
    expect(fake.requests.filter((r) => JSON.stringify(r.params).includes(ZERO))).toEqual([]);
  });

  it('reads a custom pool that reverts on getRateLimitAdmin through getDynamicConfig, as a pool that is not standard', async () => {
    const settings = await settingsOf(customEnergy);
    expect(settings.poolType).toMatchObject({ value: { name: 'EnergyTokenPool', version: '1.0.0', standard: false } });
    expect(settings.parties.rateLimitAdmin).toEqual({ state: 'absent' });
  });

  it('keeps the rest of a custom pool’s reading when neither rate-limit admin getter answers, and records that getter as missing', async () => {
    const pool = customEnergy.pool;
    const settings = await settingsOf(customEnergy, { calls: { [callTo(pool, 'getDynamicConfig()')]: 'revert' } });
    expect(settings.parties.rateLimitAdmin).toEqual({ state: 'missing', reason: 'getter missing' });
    expect(settings.parties.poolOwner).toEqual({ state: 'address', address: '0xe637218e7528ddbc5568b15f23725540041a6b20' });
    expect(laneOf(settings, SOLANA)).toMatchObject({
      outbound: { value: { isEnabled: true, capacity: '1000000000', rate: '11575' } },
      inbound: { value: { isEnabled: true, capacity: '1100000000', rate: '12732' } },
    });
  });

  it('stores a typeAndVersion() holding control characters sanitised', async () => {
    const pool = burnMint151.pool;
    const settings = await settingsOf(burnMint151, { calls: { [callTo(pool, 'typeAndVersion()')]: stringAnswer('BurnMint\u0000TokenPool‮ 1.5.1') } });
    expect(settings.poolType).toMatchObject({ value: { typeAndVersion: 'BurnMintTokenPool 1.5.1', name: 'BurnMintTokenPool', standard: true } });
  });

  it('stores a typeAndVersion() over the length cap as no answer', async () => {
    const pool = burnMint151.pool;
    const settings = await settingsOf(burnMint151, { calls: { [callTo(pool, 'typeAndVersion()')]: stringAnswer(`${'X'.repeat(123)}Pool 1.5.1`) } });
    expect(settings.poolType).toEqual({ reason: 'getter unanswered' });
  });

  it('leaves a row unread when its pool’s calls fail, while the chain’s other rows are read', async () => {
    const pool = burnMint151.pool;
    const { rows } = await readRows({ fixtures: [burnMint151, andProxy150], calls: { [callTo(pool, 'owner()')]: 'burn' } });
    expect(rows.map((r) => [r.token, r.status])).toEqual([
      [burnMint151.token, 'unread'],
      [andProxy150.token, 'read'],
    ]);
    expect((rows[0] as { failures: string[] }).failures.join(' ')).toContain(pool);
  });

  it('fails the whole chain as a wrong-registry error when the registry’s typeAndVersion() does not name a TokenAdminRegistry', async () => {
    const registry = burnMint151.registry;
    const read = readRows({ fixtures: [burnMint151], calls: { [callTo(registry, 'typeAndVersion()')]: stringAnswer('OnRamp 2.0.0') } });
    await expect(read).rejects.toBeInstanceOf(WrongRegistryError);
    await expect(read).rejects.toMatchObject({ kind: 'wrong-registry' });
  });
});

describe('readPassportChain output', () => {
  it('never carries a bucket fill level or lastUpdated', async () => {
    const recorded = lockRelease16Dev.calls.find((c) => c.data === `${selector('getCurrentOutboundRateLimiterState(uint64)')}${uintWord(4051577828743386545n)}`)!;
    const words = (recorded as { result: string }).result.slice(2).match(/.{64}/g)!.map((w) => BigInt(`0x${w}`));
    const [fill, lastUpdated, , capacity] = words;
    expect(fill).not.toBe(capacity);
    const text = JSON.stringify(await settingsOf(lockRelease16Dev));
    expect(text).not.toMatch(/tokens"|lastUpdated/);
    expect(text).not.toContain(String(fill));
    expect(text).not.toContain(String(lastUpdated));
  });

  it('reads the same settings one call at a time where Multicall3 is not used', async () => {
    expect(await settingsOf(hooks200, { multicall3: false })).toEqual(await settingsOf(hooks200));
  });

  it('reads each pool’s EIP-1967 admin slot once', async () => {
    const { fake } = await readRows({ fixtures: [proxyAdmin151] });
    expect(fake.requests.filter((r) => r.method === 'eth_getStorageAt').map((r) => r.params.slice(0, 2))).toEqual([[proxyAdmin151.pool, ADMIN_SLOT]]);
  });
});
