import { normalizeRegistryToken, type NetworkInfo, type PassportNotes, type PassportPostRecord, type PassportStatement, type ProjectRegistry, type StoredReading, type TokenLabels } from '@ccip-dev/core';
import { PASSPORT_SHARDS, PUBLIC_SCHEMAS, type PassportEvent, type PassportIndexFile, type PassportShardFile, type PassportToken, type PublicFileName } from '@ccip-dev/core/public';
import { evmCallKey, fakeEvmChain, fakeFetch, jsonResponse, type FakeRoute, type RecordedCall } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import endpoints from '../../config/endpoints.json';
import burnMint151 from '../../packages/core/test/fixtures/passport/pools/ethereum-burn-mint-1.5.1.json';
import principals from '../../packages/core/test/fixtures/passport/principals/ethereum.json';
import type { Env } from '../src/env';
import { runPassport } from '../src/jobs/passport';
import * as passportStore from '../src/passport-store';
import { SITE_DISPATCH_URL } from '../src/site-build';
import * as store from '../src/store';
import { harness, readPublic, resetStorage, type Harness } from './helpers';

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
const TOKEN = BURN_MINT.token;

const net = (name: string, chainSelector: string, chainId: string): NetworkInfo => ({ name, displayName: name, chainSelector, chainId, chainFamily: 'EVM', environment: 'mainnet' });
const ETHEREUM = net('ethereum-mainnet', '5009297550715157269', '1');

const RPC: Record<string, string> = endpoints.rpc;
const LANES_URL = 'https://api.ccip.chain.link/v2/lanes';
const SAFE = '0x62c212084ed4d2c1451c2e778f8ea9a15a47616b';
const WALLET = '0xd4d23209aae8630bf386b7393763a5b7865e57cb';
const RECORDED_OWNER = 'ecf08409a5e35aa58a887cf892c6af6648727281';
const BLOCK = 26_478_300;
const GROUP = '1e5901c9-23ca-5cde-b023-63d82251fe7f';
const OTHER_GROUP = 'a0b1c2d3-0000-5000-8000-000000000001';

const D1 = '2026-11-24';
const D2 = '2026-11-25';
const D3 = '2026-11-26';
const at = (day: string, hour = 1) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const word = (address: string) => address.slice(2).padStart(64, '0');

const SINGLE_KEY = `single-key/${ETHEREUM.chainSelector}:${TOKEN}`;
const SHARD_NAMES = PASSPORT_SHARDS.map((h) => `passport/${h}.json` as PublicFileName);
const FILE_NAMES: PublicFileName[] = ['passport.json', 'passport-events.json', ...SHARD_NAMES];

const uint = (n: bigint) => n.toString(16).padStart(64, '0');
/** The recording has every limit off; the Arbitrum lane's outbound limit is switched on here: 100,000 tokens, refilling 10 a second. */
const ARBITRUM_OUTBOUND = evmCallKey(BURN_MINT.pool!, `0xc75eea9c${uint(4949039107694359620n)}`);
const LIMIT_ON = `0x${uint(0n)}${uint(0n)}${uint(1n)}${uint(100_000n * 10n ** 18n)}${uint(10n * 10n ** 18n)}` as RecordedCall;

/** The 1.5.1 BurnMint pool with its registry administrator a 2-of-3 Safe, its owner as given, and one outbound limit on. */
function burnMintCalls(owner: string): Record<string, RecordedCall> {
  const recorded = Object.fromEntries(BURN_MINT.calls.map((c) => [evmCallKey(c.to, c.data), 'result' in c ? (c.result.replaceAll(RECORDED_OWNER, SAFE.slice(2)) as RecordedCall) : 'revert']));
  return { ...recorded, ...(principals.calls as Record<string, RecordedCall>), [evmCallKey(BURN_MINT.pool!, '0x8da5cb5b')]: `0x${word(owner)}`, [ARBITRUM_OUTBOUND]: LIMIT_ON };
}

function ethereumRoute(owner: string, day: string): FakeRoute {
  const fake = fakeEvmChain({
    chainId: 1,
    latest: BLOCK + 12,
    timestamp: Date.parse(`${day}T00:30:00.000Z`) / 1000,
    calls: burnMintCalls(owner),
    code: principals.code,
    storage: BURN_MINT.storage,
  });
  return (url, init) => (url === RPC[ETHEREUM.name] ? fake(url, init) : undefined);
}

const lanes = Object.entries(BURN_MINT.onRamps).map(([dest, onRamp]) => ({
  sourceChainSelector: ETHEREUM.chainSelector, destChainSelector: dest, onRampAddress: onRamp, offRampAddress: '0x0', version: '2.0.0', status: 'OPERATIONAL',
}));
const LANES: FakeRoute = (url) => (url === LANES_URL ? jsonResponse({ lanes }) : undefined);
const dispatch = (status: number): FakeRoute => (url) => (url === SITE_DISPATCH_URL ? new Response(null, { status }) : undefined);

async function seedToken(group: string | null, seenAt = '2026-11-23T00:00:00.000Z'): Promise<void> {
  await store.upsertChains(env.DB, [ETHEREUM], '2026-10-01T00:00:00.000Z');
  const token = normalizeRegistryToken({ chainSelector: ETHEREUM.chainSelector, address: TOKEN, symbol: 'BMT', name: 'BMT Token', decimals: 18, groupId: group });
  await store.upsertTokens(env.DB, [token], seenAt);
}

interface DayOptions {
  owner?: string;
  switches?: Partial<Env>;
  hour?: number;
  routes?: FakeRoute[];
  passportNotes?: PassportNotes;
  projects?: ProjectRegistry;
  labelTokens?: TokenLabels;
}

/** One hourly run that reads Ethereum's BurnMint row with the given owner, and returns its alerts and the URLs it fetched. */
async function day(iso: string, o: DayOptions = {}): Promise<{ alerts: Harness['alerts']; urls: string[] }> {
  const f = fakeFetch(LANES, ethereumRoute(o.owner ?? SAFE, iso.slice(0, 10)), ...(o.routes ?? []));
  const h = harness({
    now: iso, fetch: f, env: { PASSPORT: 'on', PASSPORT_PUBLIC: 'off', ...o.switches }, passportNotes: o.passportNotes, projects: o.projects, labelTokens: o.labelTokens,
  });
  await runPassport(h.c);
  return { alerts: h.alerts, urls: f.calls.map((c) => c.url) };
}

const index = async () => (await readPublic('passport.json')) as PassportIndexFile;
const shard = async (name: string) => (await readPublic(name)) as PassportShardFile;
async function token(id: string): Promise<PassportToken | undefined> {
  for (const name of SHARD_NAMES) {
    const found = (await shard(name)).tokens.find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}
const events = async () => ((await readPublic('passport-events.json')) as { events: PassportEvent[] }).events;
const logRows = async () => (await env.DB.prepare('SELECT id, day, kind FROM passport_changes ORDER BY id').all()).results;
const storedReading = async () =>
  JSON.parse((await env.DB.prepare('SELECT reading FROM passport_rows WHERE chain = ? AND address = ?').bind(ETHEREUM.chainSelector, TOKEN).first<{ reading: string }>())!.reading) as StoredReading;

/** The first lane of the stored reading whose outbound limit is on, with what can leave in an hour in whole tokens. */
async function limitedLane(): Promise<{ remote: string; tokens: number }> {
  const reading = await storedReading();
  const all = 'value' in reading.settings.lanes ? reading.settings.lanes.value : [];
  const lane = all.find((l) => 'value' in l.outbound && l.outbound.value.isEnabled);
  if (lane === undefined || !('value' in lane.outbound)) throw new Error('the fixture has no lane with its outbound limit on');
  const units = BigInt(lane.outbound.value.capacity) + BigInt(lane.outbound.value.rate) * 3600n;
  return { remote: lane.remoteChainSelector, tokens: Number(units) / 1e18 };
}

async function standardFigure(remote: string): Promise<{ tokens: string | null; usd: number | null } | undefined> {
  const lane = (await token(GROUP))?.rows[0]?.lanes.find((l) => l.remote_chain === remote);
  const figure = lane?.rate_limit?.per_hour.find((f) => f.finality === 'standard');
  return figure && figure.limit === 'on' ? { tokens: figure.tokens, usd: figure.usd } : undefined;
}

async function seedPrice(usd: number, iso: string): Promise<void> {
  await store.upsertPrices(env.DB, new Map([[`ethereum:${TOKEN}`, { price: usd, decimals: 18 }]]), iso);
}

describe('publishing the Passport files', () => {
  it('writes the index, all sixteen shards and the events file, each parsing with its schema, after an evaluation', async () => {
    // #given
    await seedToken(GROUP);
    // #when
    await day(at(D1));
    // #then
    const failing: string[] = [];
    for (const name of FILE_NAMES) if (!PUBLIC_SCHEMAS[name].safeParse(await readPublic(name)).success) failing.push(name);
    expect(failing).toEqual([]);
  });

  it('puts a token in the shard named by the first hex digit of its page id and in no other', async () => {
    // #given
    await seedToken(GROUP);
    // #when
    await day(at(D1));
    // #then
    const holding: string[] = [];
    for (const name of SHARD_NAMES) if ((await shard(name)).tokens.some((t) => t.id === GROUP)) holding.push(name);
    expect(holding).toEqual(['passport/1.json']);
  });

  it('gives the index line of a token with one flagged result a flagged single-key result and no count', async () => {
    // #given a pool owned by a single wallet
    await seedToken(GROUP);
    // #when
    await day(at(D1), { owner: WALLET });
    // #then
    const line = (await index()).tokens.find((t) => t.id === GROUP)!;
    expect({ singleKey: line.results['single-key'], fields: Object.keys(line).sort() }).toEqual({
      singleKey: 'flagged',
      fields: ['addresses', 'chains', 'id', 'name', 'project', 'results', 'symbol'],
    });
  });

  it('names the token by its group name and lists its chains and addresses on the index line', async () => {
    // #given
    await seedToken(GROUP);
    // #when
    await day(at(D1));
    // #then
    const line = (await index()).tokens.find((t) => t.id === GROUP)!;
    expect({ name: line.name, symbol: line.symbol, chains: line.chains, addresses: line.addresses }).toEqual({ name: 'BMT Token', symbol: 'BMT', chains: [ETHEREUM.chainSelector], addresses: [TOKEN] });
  });

  it('covers AE5: a priced token\'s per-hour figure carries dollars at the stored price', async () => {
    // #given
    await seedToken(GROUP);
    await seedPrice(2, at(D1, 0));
    // #when
    await day(at(D1));
    // #then
    const lane = await limitedLane();
    const figure = await standardFigure(lane.remote);
    expect(figure?.usd).toBeCloseTo(lane.tokens * 2, 2);
  });

  it('covers AE5: an unpriced token\'s per-hour figure carries token units only', async () => {
    // #given
    await seedToken(GROUP);
    // #when
    await day(at(D1));
    // #then
    const lane = await limitedLane();
    const figure = await standardFigure(lane.remote);
    expect({ tokens: Number(figure?.tokens), usd: figure?.usd }).toEqual({ tokens: lane.tokens, usd: null });
  });

  it('changes the dollar figure and writes no log row when the price changes between two publishes', async () => {
    // #given
    await seedToken(GROUP);
    await seedPrice(2, at(D1, 0));
    await day(at(D1));
    const lane = await limitedLane();
    const before = { usd: (await standardFigure(lane.remote))?.usd, log: await logRows() };
    await seedPrice(3, at(D2, 0));
    // #when
    await day(at(D2));
    // #then
    const after = { usd: (await standardFigure(lane.remote))?.usd, log: await logRows() };
    expect({ before: before.usd?.toFixed(2), after: after.usd?.toFixed(2), sameLog: after.log }).toEqual({
      before: (lane.tokens * 2).toFixed(2),
      after: (lane.tokens * 3).toFixed(2),
      sameLog: before.log,
    });
  });

  it('carries the slug of the project whose labels claim the token', async () => {
    // #given
    await seedToken(GROUP);
    const projects: ProjectRegistry = { acme: { name: 'Acme', x: null, url: null, kind: 'issuer', source: null, addresses: [], tokens: [{ chain: ETHEREUM.name, address: TOKEN, source: 'https://acme.example' }] } };
    // #when
    await day(at(D1), { projects, labelTokens: { [`${ETHEREUM.name}:${TOKEN}`]: 'acme' } });
    // #then
    expect({ index: (await index()).tokens.find((t) => t.id === GROUP)?.project, page: (await token(GROUP))?.project }).toEqual({ index: 'acme', page: 'acme' });
  });

  it('covers AE7: shows a statement beside the result it answers, and in the log once the result has changed', async () => {
    // #given a statement answering the flag a single wallet raises
    await seedToken(GROUP);
    const statement: PassportStatement = {
      chain: ETHEREUM.name, token: TOKEN, check: 'single-key', remoteChain: null, remoteToken: null, answers: 'flagged',
      text: 'The deployer key moves to a Safe next week.', saidOn: D1, attachedOn: D1, verifiedVia: 'x', verifiedSource: 'example',
    };
    const notes: PassportNotes = { statements: [statement], corrections: [] };
    const view = { answers: 'flagged', text: statement.text, said_on: D1, attached_on: D1, verified_via: 'x', verified_source: 'example' };
    await day(at(D1), { owner: WALLET, passportNotes: notes });
    const flagged = await token(GROUP);
    // #when the owner is a 2-of-3 Safe the next day
    await day(at(D2), { owner: SAFE, passportNotes: notes });
    // #then
    const cleared = await token(GROUP);
    expect({
      beside: flagged?.rows[0]?.single_key?.statements,
      loggedWhileFlagged: flagged?.log.filter((e) => e.kind === 'statement'),
      besideAfter: cleared?.rows[0]?.single_key?.statements,
      loggedAfter: cleared?.log.filter((e) => e.kind === 'statement'),
    }).toEqual({
      beside: [view],
      loggedWhileFlagged: [],
      besideAfter: [],
      loggedAfter: [{ kind: 'statement', day: D1, chain: ETHEREUM.chainSelector, address: TOKEN, unit: SINGLE_KEY, statement: view }],
    });
  });

  it('shows a row that moved to another group since yesterday under its new group, with its log', async () => {
    // #given
    await seedToken(GROUP);
    await day(at(D1));
    await seedToken(OTHER_GROUP, `${D2}T00:00:00.000Z`);
    // #when
    await day(at(D2));
    // #then
    const moved = await token(OTHER_GROUP);
    expect({
      ids: (await index()).tokens.map((t) => t.id),
      rows: moved?.rows.map((r) => r.address),
      log: moved?.log.map((e) => [e.day, e.kind]),
      shard: (await shard('passport/a.json')).tokens.map((t) => t.id),
    }).toEqual({ ids: [OTHER_GROUP], rows: [TOKEN], log: [[D1, 'first-reading']], shard: [OTHER_GROUP] });
  });

  it('marks a row the registry no longer lists with that day and its last read day, and gives it no results', async () => {
    // #given
    await seedToken(GROUP, '2026-11-23T00:00:00.000Z');
    await day(at(D1));
    // #when nine days after the registry last listed it
    await day(at('2026-12-02'));
    // #then
    const row = (await token(GROUP))?.rows[0];
    expect({ delisted: row?.delisted_on, read: row?.read_on, singleKey: row?.single_key, lanes: row?.lanes }).toEqual({ delisted: '2026-12-02', read: D1, singleKey: null, lanes: [] });
  });

  it('describes a raised flag in the events file with the token, its chains and the result it names', async () => {
    // #given
    await seedToken(GROUP);
    await day(at(D1), { owner: SAFE });
    await day(at(D2), { owner: WALLET });
    // #when
    await day(at(D3), { owner: WALLET });
    // #then
    expect(await events()).toEqual([
      {
        id: `${D3}-${GROUP}`, day: D3, kind: 'token', token_id: GROUP, name: 'BMT Token (BMT)', chains: [ETHEREUM.chainSelector], arrivals: [],
        changes: [{ kind: 'raised', correction: false, unit: SINGLE_KEY, check: 'single-key', chain: ETHEREUM.chainSelector, address: TOKEN, remote_chain: null, remote_address: null }],
      },
    ]);
  });

  it('leaves post records older than 60 days out of the events file', async () => {
    // #given
    await seedToken(GROUP);
    await day(at(D1));
    const record = (on: string): PassportPostRecord => ({ id: `${on}-${GROUP}`, day: on, kind: 'token', groupId: GROUP, name: 'BMT Token (BMT)', changes: [], arrivals: [] });
    const insert = env.DB.prepare("INSERT INTO passport_posts (id, day, kind, group_id, facts, state) VALUES (?, ?, 'token', ?, ?, 'seeded')");
    for (const on of ['2026-09-25', '2026-09-26']) await insert.bind(`${on}-${GROUP}`, on, GROUP, JSON.stringify(record(on))).run();
    // #when 61 and 60 days after those records
    await day(at(D2));
    // #then
    expect((await events()).map((e) => e.day)).toEqual(['2026-09-26']);
  });
});

describe('the site build trigger', () => {
  const dispatches = (urls: string[]) => urls.filter((u) => u === SITE_DISPATCH_URL).length;

  it('is called once by a publish', async () => {
    // #given
    await seedToken(GROUP);
    // #when
    const { urls } = await day(at(D1), { switches: { GITHUB_DISPATCH_TOKEN: 'tok' }, routes: [dispatch(204)] });
    // #then
    expect(dispatches(urls)).toBe(1);
  });

  it('alerts when it fails, and the day still counts as evaluated', async () => {
    // #given
    await seedToken(GROUP);
    // #when
    const { alerts } = await day(at(D1), { switches: { GITHUB_DISPATCH_TOKEN: 'tok' }, routes: [dispatch(500)] });
    // #then
    expect({ alerts: alerts.filter((a) => a.signature === 'site-dispatch').length, evaluated: await store.getMeta(env.DB, 'passport:evaluated') }).toEqual({ alerts: 1, evaluated: D1 });
  });

  it('is not called, and nothing is written to PUBLIC, with PASSPORT dry; the files are in ARCHIVE under passport-dry/', async () => {
    // #given
    await seedToken(GROUP);
    // #when
    const { urls } = await day(at(D1), { switches: { PASSPORT: 'dry', GITHUB_DISPATCH_TOKEN: 'tok' }, routes: [dispatch(204)] });
    // #then
    const archived = (await env.ARCHIVE.list({ prefix: 'passport-dry/' })).objects.map((o) => o.key).sort();
    expect({ dispatches: dispatches(urls), public: (await env.PUBLIC.list()).objects.length, archived }).toEqual({
      dispatches: 0,
      public: 0,
      archived: FILE_NAMES.map((n) => `passport-dry/v1/${n}`).sort(),
    });
  });
});

describe('the publish step\'s reads', () => {
  const plan = async (sql: string, ...params: unknown[]) =>
    (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((r) => r.detail);

  it.each([
    ['a page of the change log', passportStore.CHANGES_PAGE_SQL, [0, 500]],
    ['the recent post records', passportStore.POSTS_SINCE_SQL, ['2026-09-26']],
  ])('reads %s through a key, never a scan', async (_name, sql, params) => {
    // #when
    const details = await plan(sql, ...params);
    // #then
    expect(details.filter((d) => !/^SEARCH passport_\w+ USING (INTEGER PRIMARY KEY|INDEX passport_posts_day)/.test(d))).toEqual([]);
  });
});
