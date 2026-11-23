import { normalizeRegistryToken, type NetworkInfo } from '@ccip-dev/core';
import { evmCallKey, fakeEvmChain, fakeFetch, jsonResponse, type EvmHiccup, type FakeRoute, type RecordedCall } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import directory from '../../config/ccip-directory.json';
import endpoints from '../../config/endpoints.json';
import burnMint151 from '../../packages/core/test/fixtures/passport/pools/ethereum-burn-mint-1.5.1.json';
import noHooks200 from '../../packages/core/test/fixtures/passport/pools/ethereum-lock-release-2.0.0-no-hooks.json';
import noPool from '../../packages/core/test/fixtures/passport/pools/ethereum-no-pool.json';
import principals from '../../packages/core/test/fixtures/passport/principals/ethereum.json';
import { CHAIN_TIME_LIMIT_MS, RUN_BUDGET_MS, runPassport } from '../src/jobs/passport';
import * as store from '../src/store';
import { harness, resetStorage, type Harness } from './helpers';

beforeEach(resetStorage);

interface PoolFixture {
  registry: string;
  token: string;
  pool: string | null;
  onRamps: Record<string, string>;
  calls: ({ to: string; data: string; result: string } | { to: string; data: string; revert: boolean })[];
  storage: Record<string, string>;
}

const BURN_MINT = burnMint151 as unknown as PoolFixture;
const NO_HOOKS = noHooks200 as unknown as PoolFixture;
const NO_POOL = noPool as unknown as PoolFixture;

const net = (name: string, chainSelector: string, chainId: string, chainFamily = 'EVM'): NetworkInfo => ({ name, displayName: name, chainSelector, chainId, chainFamily, environment: 'mainnet' });
const ETHEREUM = net('ethereum-mainnet', '5009297550715157269', '1');
const BASE = net('ethereum-mainnet-base-1', '15971525489660198786', '8453');
const ARBITRUM = net('ethereum-mainnet-arbitrum-1', '4949039107694359620', '42161');
const NOWHERE = net('nowhere-mainnet', '1111111111111111111', '777');

const RPC: Record<string, string> = endpoints.rpc;
const REGISTRY = directory.chains as Record<string, { tokenAdminRegistry: string }>;
const LANES_URL = 'https://api.ccip.chain.link/v2/lanes';

/** Safe 1.3.0, two of three, with its probes recorded in the principals fixture. */
const SAFE = '0x62c212084ed4d2c1451c2e778f8ea9a15a47616b';
const WALLET = '0xd4d23209aae8630bf386b7393763a5b7865e57cb';
const RECORDED_OWNER = 'ecf08409a5e35aa58a887cf892c6af6648727281';
const BLOCK = 26_478_300;
const GROUP = '1e5901c9-23ca-5cde-b023-63d82251fe7f';

const D1 = '2026-11-24';
const D2 = '2026-11-25';
const D3 = '2026-11-26';
const D4 = '2026-11-27';
const at = (day: string, hour = 1) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

const word = (address: string) => address.slice(2).padStart(64, '0');

function recorded(fixture: PoolFixture, registry = fixture.registry): Record<string, RecordedCall> {
  return Object.fromEntries(fixture.calls.map((c) => [evmCallKey(c.to === fixture.registry ? registry : c.to, c.data), 'result' in c ? (c.result as RecordedCall) : 'revert']));
}

/** The 1.5.1 BurnMint pool with its registry administrator a 2-of-3 Safe and its owner as given. */
function burnMintCalls(owner: string): Record<string, RecordedCall> {
  const calls = Object.fromEntries(Object.entries(recorded(BURN_MINT)).map(([k, v]) => [k, v.replaceAll(RECORDED_OWNER, SAFE.slice(2)) as RecordedCall]));
  return { ...calls, ...(principals.calls as Record<string, RecordedCall>), [evmCallKey(BURN_MINT.pool!, '0x8da5cb5b')]: `0x${word(owner)}` };
}

interface ChainSpec {
  chain: NetworkInfo;
  calls: Record<string, RecordedCall>;
  storage?: Record<string, string>;
  chainId?: number;
  hiccups?: Partial<Record<string, EvmHiccup[]>>;
  onRequest?: (method: string) => void;
}

/** One chain's endpoint at its URL in config/endpoints.json, its blocks stamped 00:30 UTC on `day`. */
function chainRoute(spec: ChainSpec, day: string): FakeRoute {
  const fake = fakeEvmChain({
    chainId: spec.chainId ?? Number(spec.chain.chainId),
    latest: BLOCK + 12,
    timestamp: Date.parse(`${day}T00:30:00.000Z`) / 1000,
    calls: spec.calls,
    code: principals.code,
    storage: spec.storage,
    hiccups: spec.hiccups,
  });
  return (url, init) => {
    if (url !== RPC[spec.chain.name]) return undefined;
    spec.onRequest?.((JSON.parse(String(init?.body)) as { method: string }).method);
    return fake(url, init);
  };
}

function lanesRoute(onRamps: Record<string, Record<string, string>>): FakeRoute {
  const lanes = Object.entries(onRamps).flatMap(([source, byDest]) =>
    Object.entries(byDest).map(([dest, onRamp]) => ({ sourceChainSelector: source, destChainSelector: dest, onRampAddress: onRamp, offRampAddress: '0x0', version: '2.0.0', status: 'OPERATIONAL' })));
  return (url) => (url === LANES_URL ? jsonResponse({ lanes }) : undefined);
}

interface SeedToken {
  chain: NetworkInfo;
  address: string;
  group?: string;
  symbol?: string;
  seenAt?: string;
}

async function seed(chains: NetworkInfo[], tokens: SeedToken[]): Promise<void> {
  await store.upsertChains(env.DB, chains, '2026-10-01T00:00:00.000Z');
  for (const t of tokens) {
    const token = normalizeRegistryToken({ chainSelector: t.chain.chainSelector, address: t.address, symbol: t.symbol ?? 'BMT', name: `${t.symbol ?? 'BMT'} Token`, decimals: 18, groupId: t.group ?? GROUP });
    await store.upsertTokens(env.DB, [token], t.seenAt ?? '2026-11-23T00:00:00.000Z');
  }
}

const ON = { PASSPORT: 'on', PASSPORT_PUBLIC: 'off' };

interface Run {
  alerts: Harness['alerts'];
  urls: string[];
}

/** One hourly run at `iso`; `advance` moves the run's clock, as a slow endpoint would. */
async function run(iso: string, routes: (advance: (ms: number) => void) => FakeRoute[], switches: Record<string, string> = ON): Promise<Run> {
  let now = Date.parse(iso);
  let h: Harness | null = null;
  const advance = (ms: number) => {
    now += ms;
    h?.setNow(new Date(now).toISOString());
  };
  const f = fakeFetch(...routes(advance));
  h = harness({ now: iso, fetch: f, env: switches });
  await runPassport(h.c);
  return { alerts: h.alerts, urls: f.calls.map((c) => c.url) };
}

const ETH_LANES = lanesRoute({ [ETHEREUM.chainSelector]: { ...BURN_MINT.onRamps, ...NO_HOOKS.onRamps } });

/** One daily run against Ethereum holding the BurnMint row with the given owner. */
function burnMintDay(day: string, owner: string, switches: Record<string, string> = ON, hour = 1): Promise<Run> {
  return run(at(day, hour), () => [ETH_LANES, chainRoute({ chain: ETHEREUM, calls: burnMintCalls(owner), storage: BURN_MINT.storage }, day)], switches);
}

const seedBurnMint = () => seed([ETHEREUM], [{ chain: ETHEREUM, address: BURN_MINT.token }]);

/** The no-pool fixture on another chain: its registry calls moved to that chain's registry. */
const noPoolOn = (chain: NetworkInfo, extra: Partial<ChainSpec> = {}): ChainSpec => ({ chain, calls: recorded(NO_POOL, REGISTRY[chain.chainSelector]!.tokenAdminRegistry), ...extra });
const NO_LANES = lanesRoute({});

const all = async <T>(sql: string, ...params: unknown[]) => (await env.DB.prepare(sql).bind(...params).all<T>()).results;
const meta = (key: string) => store.getMeta(env.DB, key);

interface UnitRow {
  unit: string;
  result: string;
  announced: string | null;
  pending: string | null;
  pending_day: string | null;
  wire: string;
}
const units = () => all<UnitRow>('SELECT unit, result, announced, pending, pending_day, wire FROM passport_units ORDER BY unit');
const changes = () => all<{ chain: string; address: string; day: string; kind: string; detail: string }>('SELECT chain, address, day, kind, detail FROM passport_changes ORDER BY id');
const posts = () => all<{ id: string; day: string; kind: string; group_id: string | null; facts: string; state: string }>('SELECT id, day, kind, group_id, facts, state FROM passport_posts ORDER BY id');
const passportRow = (chain: NetworkInfo, address: string) =>
  env.DB.prepare('SELECT reading, read_day, first_read_day, delisted_day, arrival_day FROM passport_rows WHERE chain = ? AND address = ?')
    .bind(chain.chainSelector, address)
    .first<{ reading: string | null; read_day: string | null; first_read_day: string | null; delisted_day: string | null; arrival_day: string | null }>();
const chainState = (chain: NetworkInfo) =>
  env.DB.prepare('SELECT ok_day, failures, tried_day, attempts FROM passport_chains WHERE chain = ?').bind(chain.chainSelector).first<{ ok_day: string | null; failures: number; tried_day: string | null; attempts: number }>();
const SINGLE_KEY = `single-key/${ETHEREUM.chainSelector}:${BURN_MINT.token}`;
const rpcHosts = (urls: string[]) => [...new Set(urls.filter((u) => u !== LANES_URL))];

describe('runPassport switches', () => {
  it('makes no RPC call and writes nothing with PASSPORT off', async () => {
    // #given
    await seedBurnMint();
    // #when
    const { urls } = await run(at(D1), () => [], { PASSPORT: 'off', PASSPORT_PUBLIC: 'off' });
    // #then
    const counts = await all<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM passport_chains) + (SELECT COUNT(*) FROM passport_rows) + (SELECT COUNT(*) FROM passport_units)
        + (SELECT COUNT(*) FROM passport_changes) + (SELECT COUNT(*) FROM passport_posts) + (SELECT COUNT(*) FROM meta WHERE key LIKE 'passport:%') AS n`,
    );
    expect({ urls, written: counts[0]!.n }).toEqual({ urls: [], written: 0 });
  });

  it('stores readings and results with PASSPORT dry', async () => {
    // #given
    await seedBurnMint();
    // #when
    await burnMintDay(D1, SAFE, { PASSPORT: 'dry', PASSPORT_PUBLIC: 'on' });
    // #then
    const singleKey = (await units()).find((u) => u.unit === SINGLE_KEY)!;
    expect({ readDay: (await passportRow(ETHEREUM, BURN_MINT.token))?.read_day, singleKey: JSON.parse(singleKey.result).value }).toEqual({ readDay: D1, singleKey: 'clear' });
  });

  it.each([
    ['dry', 'on', 'seeded'],
    ['on', 'off', 'seeded'],
    ['on', 'drafts', 'due'],
    ['on', 'on', 'due'],
  ])('with PASSPORT %s and PASSPORT_PUBLIC %s, a post record is %s', async (passport, publicPosts, state) => {
    // #given
    await seedBurnMint();
    const switches = { PASSPORT: passport, PASSPORT_PUBLIC: publicPosts };
    await burnMintDay(D1, SAFE, switches);
    await burnMintDay(D2, WALLET, switches);
    // #when
    await burnMintDay(D3, WALLET, switches);
    // #then
    expect((await posts()).map((p) => p.state)).toEqual([state]);
  });

  it('covers AE6: the first run with PASSPORT on clears a dry run, sets passport:since and announces every result without a post', async () => {
    // #given
    await seedBurnMint();
    await burnMintDay(D1, WALLET, { PASSPORT: 'dry', PASSPORT_PUBLIC: 'off' });
    // #when
    await burnMintDay(D2, SAFE);
    // #then
    const stored = await units();
    expect({
      since: await meta('passport:since'),
      logDays: [...new Set((await changes()).map((c) => c.day))],
      logKinds: [...new Set((await changes()).map((c) => c.kind))],
      unannounced: stored.filter((u) => u.announced !== JSON.parse(u.result).value).map((u) => u.unit),
      posts: await posts(),
    }).toEqual({ since: D2, logDays: [D2], logKinds: ['first-reading'], unannounced: [], posts: [] });
  });
});

describe('runPassport readings and log', () => {
  it("logs an owner that changes between two days once, with the old and new address and the block's UTC day", async () => {
    // #given
    await seedBurnMint();
    await burnMintDay(D1, SAFE);
    // #when
    await burnMintDay(D2, WALLET);
    // #then
    const settings = (await changes()).filter((c) => c.kind === 'setting').map((c) => ({ day: c.day, address: c.address, detail: JSON.parse(c.detail) }));
    expect(settings).toEqual([
      { day: D2, address: BURN_MINT.token, detail: { setting: 'parties.poolOwner', from: { state: 'address', address: SAFE }, to: { state: 'address', address: WALLET } } },
    ]);
  });

  it('writes no log row for a reading identical to the stored one', async () => {
    // #given
    await seedBurnMint();
    await burnMintDay(D1, SAFE);
    const before = await changes();
    // #when
    await burnMintDay(D2, SAFE);
    // #then
    expect(await changes()).toEqual(before);
  });

  it('stores the first reading whole in the log, with its parties classified', async () => {
    // #given
    await seedBurnMint();
    // #when
    await burnMintDay(D1, SAFE);
    // #then
    const first = JSON.parse((await changes()).find((c) => c.kind === 'first-reading')!.detail);
    expect({ readOn: first.readOn, pool: first.settings.pool, safe: first.parties[SAFE] }).toEqual({
      readOn: D1,
      pool: BURN_MINT.pool,
      safe: { kind: 'safe', signers: 2, safe: { singleton: '0xd9db270c1b5e3bd161e8c8503c55ceabee709552', release: '1.3.0', threshold: 2, owners: 3 } },
    });
  });

  it('keeps the stored reading of a row whose pool calls fail, updates the chain\'s other rows, and names the row in one alert', async () => {
    // #given
    await seed([ETHEREUM], [{ chain: ETHEREUM, address: BURN_MINT.token }, { chain: ETHEREUM, address: NO_HOOKS.token, group: 'other-group', symbol: 'NHK' }]);
    const both = (owner: RecordedCall) => ({ ...recorded(NO_HOOKS), ...burnMintCalls(SAFE), [evmCallKey(BURN_MINT.pool!, '0x8da5cb5b')]: owner });
    const storage = { ...BURN_MINT.storage, ...NO_HOOKS.storage };
    await run(at(D1), () => [ETH_LANES, chainRoute({ chain: ETHEREUM, calls: both(`0x${word(SAFE)}`), storage }, D1)]);
    // #when
    const { alerts } = await run(at(D2), () => [ETH_LANES, chainRoute({ chain: ETHEREUM, calls: both('burn'), storage }, D2)]);
    // #then
    const callAlerts = alerts.filter((a) => a.signature.startsWith('passport-calls'));
    expect({
      failedRow: (await passportRow(ETHEREUM, BURN_MINT.token))?.read_day,
      otherRow: (await passportRow(ETHEREUM, NO_HOOKS.token))?.read_day,
      alerts: callAlerts.length,
      named: callAlerts[0]?.text.includes(BURN_MINT.token),
    }).toEqual({ failedRow: D1, otherRow: D2, alerts: 1, named: true });
  });

  it('treats a chain answering the wrong chain id as a failed reading and stores nothing', async () => {
    // #given
    await seed([ETHEREUM], [{ chain: ETHEREUM, address: NO_POOL.token }]);
    // #when
    await run(at(D1), () => [NO_LANES, chainRoute(noPoolOn(ETHEREUM, { chainId: 10 }), D1)]);
    // #then
    expect({ row: await passportRow(ETHEREUM, NO_POOL.token), log: await changes(), state: await chainState(ETHEREUM) }).toEqual({
      row: null,
      log: [],
      state: { ok_day: null, failures: 0, tried_day: D1, attempts: 1 },
    });
  });

  it('makes no RPC call for a chain with no endpoint and marks its rows "not readable" with that reason', async () => {
    // #given
    await seed([NOWHERE], [{ chain: NOWHERE, address: NO_POOL.token }]);
    // #when
    const { urls } = await run(at(D1), () => []);
    // #then
    const result = JSON.parse((await units()).find((u) => u.unit === `single-key/${NOWHERE.chainSelector}:${NO_POOL.token}`)!.result);
    expect({ urls, value: result.value, reason: result.reason }).toEqual({ urls: [], value: 'not readable', reason: 'no-endpoint' });
  });

  it('does not read a row the registry last listed eight days ago, and marks it "no longer listed"', async () => {
    // #given
    await seed([ETHEREUM], [{ chain: ETHEREUM, address: NO_POOL.token, seenAt: '2026-11-16T00:00:00.000Z' }]);
    // #when
    const { urls } = await run(at(D1), () => []);
    // #then
    expect({ urls, delisted: (await passportRow(ETHEREUM, NO_POOL.token))?.delisted_day, units: await units() }).toEqual({ urls: [], delisted: D1, units: [] });
  });
});

describe('runPassport across hourly runs', () => {
  const THREE = [ETHEREUM, BASE, ARBITRUM];
  const threeChains = () => seed(THREE, THREE.map((chain) => ({ chain, address: NO_POOL.token })));

  it('stores the cursor when a run hits its budget after two chains, and the next run starts at the third chain', async () => {
    // #given
    await threeChains();
    const step = (RUN_BUDGET_MS - CHAIN_TIME_LIMIT_MS) / 2 + 5_000;
    const routes = (day: string) => (advance: (ms: number) => void) => [
      NO_LANES,
      ...THREE.map((chain) => chainRoute(noPoolOn(chain, { onRequest: (m) => m === 'eth_chainId' && advance(step) }), day)),
    ];
    // #when
    const first = await run(at(D1), routes(D1));
    const second = await run(at(D1, 2), routes(D1));
    // #then
    const firstHosts = rpcHosts(first.urls);
    expect({
      first: firstHosts.length,
      second: rpcHosts(second.urls),
      evaluated: await meta('passport:evaluated'),
    }).toEqual({ first: 2, second: THREE.map((c) => RPC[c.name]!).filter((u) => !firstHosts.includes(u)), evaluated: D1 });
  });

  it('does no reading in a run after the day was evaluated', async () => {
    // #given
    await seed([ETHEREUM], [{ chain: ETHEREUM, address: NO_POOL.token }]);
    await run(at(D1), () => [NO_LANES, chainRoute(noPoolOn(ETHEREUM), D1)]);
    // #when
    const later = await run(at(D1, 2), () => [NO_LANES, chainRoute(noPoolOn(ETHEREUM), D1)]);
    // #then
    expect(later.urls).toEqual([]);
  });

  it('tries a chain whose endpoint times out once more in a later run, then keeps its reading and read day and counts one failure', async () => {
    // #given
    await seed([ETHEREUM], [{ chain: ETHEREUM, address: NO_POOL.token }]);
    await run(at(D1), () => [NO_LANES, chainRoute(noPoolOn(ETHEREUM), D1)]);
    const stored = await passportRow(ETHEREUM, NO_POOL.token);
    const timingOut = () => [NO_LANES, chainRoute(noPoolOn(ETHEREUM, { hiccups: { eth_chainId: ['timeout', 'timeout', 'timeout'] } }), D2)];
    await run(at(D2), timingOut);
    const afterFirst = await chainState(ETHEREUM);
    // #when
    const second = await run(at(D2, 2), timingOut);
    // #then
    expect({
      afterFirst: afterFirst?.failures,
      retried: rpcHosts(second.urls),
      failures: (await chainState(ETHEREUM))?.failures,
      row: await passportRow(ETHEREUM, NO_POOL.token),
    }).toEqual({ afterFirst: 0, retried: [RPC[ETHEREUM.name]], failures: 1, row: stored });
  });

  it('fails a chain for the day when its reading runs past its time limit, and moves on to the next chain', async () => {
    // #given
    await seed([ETHEREUM, BASE], [ETHEREUM, BASE].map((chain) => ({ chain, address: NO_POOL.token })));
    const routes = (advance: (ms: number) => void) => [
      NO_LANES,
      chainRoute(noPoolOn(ETHEREUM, { onRequest: (m) => m === 'eth_getBlockByNumber' && advance(CHAIN_TIME_LIMIT_MS + 1_000) }), D1),
      chainRoute(noPoolOn(BASE), D1),
    ];
    const first = await run(at(D1), routes);
    // #when
    const second = await run(at(D1, 2), routes);
    // #then
    expect({
      first: rpcHosts(first.urls),
      second: rpcHosts(second.urls),
      ethereum: await chainState(ETHEREUM),
      ethereumRow: await passportRow(ETHEREUM, NO_POOL.token),
    }).toEqual({
      first: [RPC[ETHEREUM.name]],
      second: [RPC[BASE.name]],
      ethereum: { ok_day: null, failures: 1, tried_day: D1, attempts: 2 },
      ethereumRow: null,
    });
  });

  it('alerts once with the chain name when a chain fails on three days, and resets the count on a later success', async () => {
    // #given
    await seed([ETHEREUM], [{ chain: ETHEREUM, address: NO_POOL.token }]);
    const down = (day: string) => () => [NO_LANES, chainRoute(noPoolOn(ETHEREUM, { hiccups: { eth_chainId: [500, 500, 500] } }), day)];
    const alerts: Harness['alerts'] = [];
    for (const day of [D1, D2, D3]) {
      for (const hour of [1, 2]) alerts.push(...(await run(at(day, hour), down(day))).alerts);
    }
    // #when
    await run(at(D4), () => [NO_LANES, chainRoute(noPoolOn(ETHEREUM), D4)]);
    // #then
    const chainAlerts = alerts.filter((a) => a.signature.startsWith('passport-chain'));
    expect({ alerts: chainAlerts.length, named: chainAlerts[0]?.text.includes(ETHEREUM.name), failures: (await chainState(ETHEREUM))?.failures }).toEqual({ alerts: 1, named: true, failures: 0 });
  });

  it('evaluates what it has at 22:00 UTC with chains untried, and alerts that the day is incomplete', async () => {
    // #given
    await seed([ETHEREUM, BASE], [ETHEREUM, BASE].map((chain) => ({ chain, address: NO_POOL.token })));
    // #when
    const { alerts } = await run(at(D1, 22), (advance) => [
      NO_LANES,
      chainRoute(noPoolOn(ETHEREUM, { onRequest: (m) => m === 'eth_chainId' && advance(RUN_BUDGET_MS - CHAIN_TIME_LIMIT_MS + 1_000) }), D1),
      chainRoute(noPoolOn(BASE), D1),
    ]);
    // #then
    const incomplete = alerts.filter((a) => a.signature === 'passport-incomplete');
    expect({ evaluated: await meta('passport:evaluated'), alerts: incomplete.length, named: incomplete[0]?.text.includes(BASE.name) }).toEqual({ evaluated: D1, alerts: 1, named: true });
  });
});

describe('runPassport evaluation', () => {
  it('alerts once, naming the token and the change, when a result goes pending', async () => {
    // #given
    await seedBurnMint();
    await burnMintDay(D1, SAFE);
    // #when
    const { alerts } = await burnMintDay(D2, WALLET);
    // #then
    const pending = alerts.filter((a) => a.signature === 'passport-pending');
    expect({ alerts: pending.length, token: pending[0]?.text.includes('BMT'), change: pending[0]?.text.includes(`${SINGLE_KEY}: clear → flagged`) }).toEqual({ alerts: 1, token: true, change: true });
  });

  it('covers AE2: a single key on two days shows the flag on the first and raises it in one post record on the second', async () => {
    // #given
    await seedBurnMint();
    await burnMintDay(D1, SAFE);
    await burnMintDay(D2, WALLET);
    const flaggedOnD2 = JSON.parse((await units()).find((u) => u.unit === SINGLE_KEY)!.result).value;
    const postsOnD2 = await posts();
    // #when
    await burnMintDay(D3, WALLET);
    // #then
    const [record] = await posts();
    expect({ flaggedOnD2, postsOnD2, id: record?.id, changes: JSON.parse(record!.facts).changes }).toEqual({
      flaggedOnD2: 'flagged',
      postsOnD2: [],
      id: `${D3}-${GROUP}`,
      changes: [{ kind: 'raised', day: D3, correction: false, groupId: GROUP, unit: SINGLE_KEY }],
    });
  });

  it('leaves one set of log rows and post records when the day is evaluated twice', async () => {
    // #given a lane result stored under an older method version, so the day logs a re-classification
    await seedBurnMint();
    await burnMintDay(D1, SAFE);
    await burnMintDay(D2, WALLET);
    const lane = (await units()).find((u) => u.unit.startsWith('rate-limit/'))!.unit;
    await env.DB.prepare(`UPDATE passport_units SET wire = json_set(wire, '$.method', 0, '$.result', 'clear', '$.announced', 'clear') WHERE unit = ?`).bind(lane).run();
    await burnMintDay(D3, WALLET);
    const once = { log: await changes(), posts: await posts() };
    // #when
    await store.setMeta(env.DB, 'passport:evaluated', null);
    await burnMintDay(D3, WALLET, ON, 2);
    // #then
    const twice = { log: await changes(), posts: await posts() };
    expect({ reclassified: twice.log.filter((c) => c.kind === 're-classified').length, same: twice }).toEqual({ reclassified: 1, same: once });
  });

  it('alerts once with the count on a day that reaches the post cap', async () => {
    // #given eleven tokens first seen after launch on a chain no endpoint reads, so each arrives unreadable
    await seed([NOWHERE], [{ chain: NOWHERE, address: NO_POOL.token }]);
    await run(at(D1), () => []);
    const late = Array.from({ length: 11 }, (_, i) => ({ chain: NOWHERE, address: `0x${(i + 1).toString(16).padStart(40, '0')}`, group: `group-${i}`, seenAt: `${D2}T00:30:00.000Z` }));
    await seed([NOWHERE], late);
    await run(at(D2), () => []);
    // #when
    const { alerts } = await run(at(D3), () => []);
    // #then
    const cap = alerts.filter((a) => a.signature === 'passport-cap');
    expect({ alerts: cap.length, count: cap[0]?.text.includes('11 tokens'), records: (await posts()).map((p) => p.kind) }).toEqual({
      alerts: 1,
      count: true,
      records: [...Array.from({ length: 10 }, () => 'token'), 'summary'],
    });
  });
});
