import {
  addDays, buildTokenGroupIndex, bySelector, CHECK_KINDS, groupName, llamaKey, normalizeAddress, passportNoteKey, rollupChecks, tokenClaims, tokenGroupEntry,
  type ArrivalItem, type ChainRef, type CheckKind, type CheckResult, type CheckValue, type DesignReason, type PassportPostRecord, type PassportStatement, type PerHourFigure,
  type PoolPointerResult, type RateLimitResult, type RowRef, type SingleKeyResult, type TokenAmount,
} from '@ccip-dev/core';
import {
  PASSPORT_SHARDS, passportShard, type PassportChainRow, type PassportEvent, type PassportLane, type PassportLogEntry, type PassportStatementView, type PassportToken,
} from '@ccip-dev/core/public-passport';
import { byName } from '@ccip-dev/core/roster';
import type { RunContext } from './context';
import type { PassportMode } from './passport-config';
import * as passportStore from './passport-store';
import { groupBy, rowKey } from './passport-store';
import { fallbackLoader, priceFallback } from './price-fallback';
import { putJson, TTL, usd } from './publish';
import { triggerSiteBuild } from './site-build';
import * as store from './store';

/** passport-events.json holds the post records of this many days before the evaluated day, and that day. */
export const EVENTS_DAYS = 60;
/** The index's latest-changes list. */
export const LATEST_EVENTS = 10;
/** With PASSPORT dry the files go to ARCHIVE under this prefix (KTD20). */
export const DRY_PREFIX = 'passport-dry/';
/** A stored price older than this prices no per-hour figure: the prices job refreshes only keys that messages touch. */
const PRICE_FRESH_MS = 86_400_000;

/** One registry row of a page, as the day's evaluation loaded it. */
export interface PublishRow {
  registry: passportStore.RegistryRow;
  stored: passportStore.StoredRow | undefined;
  design: DesignReason | null;
  /** The day the row was marked "no longer listed"; null while the registry lists it. */
  delistedOn: string | null;
}

/** A page: the rows that share a registry group today, and the results the day's evaluation produced for them. */
export interface PublishGroup {
  id: string;
  rows: PublishRow[];
  results: CheckResult[];
}

export interface Publication {
  mode: PassportMode;
  day: string;
  since: string;
  refs: ReadonlyMap<string, ChainRef>;
  groups: PublishGroup[];
}

const keyOf = (r: PublishRow) => rowKey(r.registry.chain, r.registry.address);
const ZERO_ADDRESS = /^0x0+$/;

/**
 * KTD19: writes passport.json, the sixteen passport/<h>.json shards and passport-events.json once each, then asks for a
 * site build. With PASSPORT dry the same files go to ARCHIVE under DRY_PREFIX and no build is asked for.
 */
export async function publishPassport(c: RunContext, p: Publication): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const page: PageInputs = {
    prices: await rowPrices(c, p),
    log: groupBy(await passportStore.changeLog(db), (r) => rowKey(r.chain, r.address)),
    statements: statementsByRow(c.passportNotes.statements, p.refs),
    claims: projectClaims(c, p),
  };
  const tokens = p.groups.map((g) => tokenPage(g, page)).sort((a, b) => byName(a.name, b.name) || byName(a.id, b.id));
  const from = addDays(p.day, -EVENTS_DAYS);
  const events = eventsOf(await passportStore.postsSince(db, from), tokens);

  const [bucket, prefix] = p.mode === 'on' ? [c.env.PUBLIC, ''] : [c.env.ARCHIVE, DRY_PREFIX];
  const put = (name: string, body: Record<string, unknown>) => putJson(bucket, name, body, TTL.passport, now, prefix);
  const head = { day: p.day, since: p.since };
  await put('passport.json', { ...head, tokens: tokens.map(indexLine), latest: events.slice(0, LATEST_EVENTS) });
  const shards = new Map<string, PassportToken[]>(PASSPORT_SHARDS.map((h) => [`passport/${h}.json`, []]));
  for (const t of tokens) shards.get(passportShard(t.id))!.push(t);
  for (const [name, list] of shards) await put(name, { ...head, tokens: list });
  await put('passport-events.json', { from, events });
  if (p.mode === 'on') await triggerSiteBuild(c);
}

/**
 * R12: each listed row's price in dollars, from the stored prices the rest of the Worker values tokens with: its own
 * DefiLlama key, then a group sibling's, then its CoinGecko coin's. Nothing is fetched here and nothing is logged.
 */
async function rowPrices(c: RunContext, p: Publication): Promise<Map<string, number>> {
  const db = c.env.DB;
  const freshSince = new Date(c.deps.now().getTime() - PRICE_FRESH_MS).toISOString();
  const rows = p.groups.flatMap((g) => g.rows);
  const listed = rows.flatMap((row) => {
    const ref = p.refs.get(row.registry.chain);
    return row.delistedOn === null && ref !== undefined ? [{ row, ref, key: llamaKey(ref, row.registry.address) }] : [];
  });
  const prices = await store.getPrices(db, [...new Set(listed.flatMap((r) => (r.key === null ? [] : [r.key])))], freshSince);
  const index = buildTokenGroupIndex(rows.map((r) => tokenGroupEntry(
    { chain: r.registry.chain, address: r.registry.address, decimals: r.registry.decimals, groupId: r.registry.group_id },
    p.refs.get(r.registry.chain),
  )));
  const tokens: TokenAmount[] = listed.map((r) => ({ chain: r.ref, token: r.row.registry.address, amount: '0' }));
  const fallback = await priceFallback({ ...fallbackLoader(c), groups: async () => index }, tokens, prices, (keys) => store.getPrices(db, keys, freshSince));
  const out = new Map<string, number>();
  for (const { row, ref, key } of listed) {
    const price = (key === null ? undefined : prices.get(key)) ?? fallback?.(ref, row.registry.address);
    if (price !== undefined) out.set(keyOf(row), price.price);
  }
  return out;
}

/** A statement with the result key it answers. */
interface PlacedStatement {
  key: string;
  chain: string;
  statement: PassportStatement;
}

/** The bundled statements by their row, `<selector>:<address>`; one naming a chain the chains table lacks is left out. */
function statementsByRow(statements: readonly PassportStatement[], refs: ReadonlyMap<string, ChainRef>): Map<string, PlacedStatement[]> {
  const selectors = new Map([...refs.values()].map((ref) => [ref.name, ref.selector]));
  const placed = statements.flatMap((statement) => {
    const chain = selectors.get(statement.chain);
    const key = passportNoteKey(statement, selectors);
    return chain === undefined || key === null ? [] : [{ key, chain, statement }];
  });
  return groupBy(placed, (s) => rowKey(s.chain, s.statement.token));
}

/** Project labels by the claimed row's key and by its registry group, as the via-token credits take them. */
function projectClaims(c: RunContext, p: Publication): ReadonlyMap<string, { slug: string }> {
  const chains = new Map([...p.refs].map(([selector, ref]) => [selector, { name: ref.name, family: ref.family }]));
  const groups = new Map(p.groups.flatMap((g) => g.rows.map((r) => [rowKey(r.registry.chain, normalizeAddress(r.registry.address)), r.registry.group_id] as const)));
  return tokenClaims(c.labelTokens, c.projects, chains, groups);
}

interface PageInputs {
  prices: ReadonlyMap<string, number>;
  log: ReadonlyMap<string, passportStore.ChangeRow[]>;
  statements: ReadonlyMap<string, PlacedStatement[]>;
  claims: ReadonlyMap<string, { slug: string }>;
}

const statementView = (s: PassportStatement): PassportStatementView => ({
  answers: s.answers, text: s.text, said_on: s.saidOn, attached_on: s.attachedOn, verified_via: s.verifiedVia, verified_source: s.verifiedSource,
});

function tokenPage(group: PublishGroup, inputs: PageInputs): PassportToken {
  const rows = [...group.rows].sort((a, b) => bySelector(a.registry.chain, b.registry.chain) || byName(a.registry.address, b.registry.address));
  const listed = rows.filter((r) => r.delistedOn === null);
  const name = groupName((listed.length > 0 ? listed : rows).map((r) => ({ chain: r.registry.chain, token: r.registry.address, symbol: r.registry.symbol, name: r.registry.name })));

  const values = new Map(group.results.map((r) => [r.key, r.value]));
  const statements = rows.flatMap((r) => inputs.statements.get(keyOf(r)) ?? []);
  const answering = (s: PlacedStatement) => values.get(s.key) === s.statement.answers;
  const beside = (result: CheckResult) => statements.filter((s) => s.key === result.key && answering(s)).map((s) => statementView(s.statement));
  const moved: PassportLogEntry[] = statements.filter((s) => !answering(s)).map((s) => ({
    kind: 'statement', day: s.statement.attachedOn, chain: s.chain, address: s.statement.token, unit: s.key, statement: statementView(s.statement),
  }));
  const changes = rows.flatMap((r) => inputs.log.get(keyOf(r)) ?? []).sort((a, b) => byName(a.day, b.day) || a.id - b.id);
  const log = [...changes.map(logEntry), ...moved].sort((a, b) => byName(a.day, b.day));

  return {
    id: group.id,
    name: name.name,
    symbol: name.symbol,
    project: inputs.claims.get(group.id)?.slug ?? null,
    chains: [...new Set(rows.map((r) => r.registry.chain))],
    results: rollupChecks(group.results),
    rows: rows.map((r) => chainRow(r, group.results, beside, inputs.prices.get(keyOf(r)) ?? null)),
    log,
  };
}

const indexLine = ({ rows, log: _log, ...line }: PassportToken) => ({ ...line, addresses: [...new Set(rows.map((r) => r.address))] });

function poolOf(stored: passportStore.StoredRow | undefined): string | null {
  if (!stored?.reading) return null;
  const { pool } = passportStore.readingOf(stored)!.settings;
  return ZERO_ADDRESS.test(pool) ? null : pool;
}

type Beside = (result: CheckResult) => PassportStatementView[];

const resultFields = (r: CheckResult, beside: Beside) => ({
  key: r.key, value: r.value, reason: r.reason, read_on: r.readOn, basis: r.basis, corrected: r.corrected, statements: beside(r),
});

/** The dollar figure is priced here at publish time and never stored (KTD9). */
function perHour(figure: PerHourFigure, price: number | null): PerHourFigure {
  if (figure.limit === 'off') return figure;
  return { ...figure, usd: figure.tokens !== null && price !== null ? usd(Number(figure.tokens) * price) : null };
}

/** One row with its single-key result and a lane per remote chain; a pair's pointer result sits on the lane of both its rows. */
function chainRow(row: PublishRow, results: readonly CheckResult[], beside: Beside, price: number | null): PassportChainRow {
  const { chain, address } = row.registry;
  const isRow = (ref: RowRef | { chain: string; token: string | null }) => ref.chain === chain && ref.token === address;
  const lanes = new Map<string | null, PassportLane>();
  const lane = (remote: string | null) => lanes.get(remote) ?? lanes.set(remote, { remote_chain: remote, rate_limit: null, pointers: [] }).get(remote)!;
  const pointer = (r: PoolPointerResult, other: { chain: string; token: string | null }) =>
    lane(other.chain).pointers.push({
      ...resultFields(r, beside),
      other: { chain: other.chain, address: other.token },
      sides: r.facts.sides.map((s) => ({ from: { chain: s.from.chain, address: s.from.token }, to: s.to, state: s.state })),
    });

  let singleKey: SingleKeyResult | undefined;
  for (const r of results) {
    if (r.check === 'single-key' && isRow(r.row)) singleKey = r;
    else if (r.check === 'rate-limit' && isRow(r.row)) lane(r.remoteChain).rate_limit = rateLimitView(r, beside, price);
    else if (r.check === 'pool-pointer' && isRow(r.rows[0])) pointer(r, r.rows[1]);
    else if (r.check === 'pool-pointer' && isRow(r.rows[1])) pointer(r, r.rows[0]);
  }
  return {
    chain,
    address,
    pool: poolOf(row.stored),
    read_on: row.stored?.read_day ?? null,
    delisted_on: row.delistedOn,
    unreadable: row.design,
    single_key: singleKey === undefined ? null : {
      ...resultFields(singleKey, beside), pool_type: singleKey.facts.poolType, parties: singleKey.facts.parties, decided_by: singleKey.facts.decidedBy,
    },
    lanes: [...lanes.values()].sort((a, b) => (a.remote_chain === null ? 1 : b.remote_chain === null ? -1 : bySelector(a.remote_chain, b.remote_chain))),
  };
}

function rateLimitView(r: RateLimitResult, beside: Beside, price: number | null): NonNullable<PassportLane['rate_limit']> {
  return { ...resultFields(r, beside), per_hour: r.facts.perHour.map((f) => perHour(f, price)), receiving_inbound: r.facts.receivingInbound, verifiers: r.facts.verifiers };
}

interface SettingDetail {
  setting: string;
  from: unknown;
  to: unknown;
}

interface UnitDetail {
  unit: string;
  from: CheckValue | null;
  to: CheckValue;
  basis: string;
}

function logEntry(r: passportStore.ChangeRow): PassportLogEntry {
  const at = { day: r.day, chain: r.chain, address: r.address };
  if (r.kind === 'first-reading') return { ...at, kind: 'first-reading' };
  const detail = JSON.parse(r.detail ?? 'null') as SettingDetail & UnitDetail;
  if (r.kind === 'setting' || r.kind === 'pool-replaced') return { ...at, kind: r.kind, setting: detail.setting, from: detail.from, to: detail.to };
  if (r.kind === 're-classified') return { ...at, kind: 're-classified', unit: detail.unit, from: detail.from, to: detail.to };
  if (r.kind === 'correction') return { ...at, kind: 'correction', unit: detail.unit, from: detail.from, to: detail.to, basis: detail.basis };
  throw new Error(`passport_changes row ${r.id} has the unknown kind "${r.kind}"`);
}

function splitRow(row: string): { chain: string; address: string } {
  const at = row.indexOf(':');
  return { chain: row.slice(0, at), address: row.slice(at + 1) };
}

/** A result key taken apart: `<check>/<chain>:<token>`, then `/<remote>` or `/*` for a lane, or `/<chain>:<token|*>` for a pair. */
function unitRef(unit: string) {
  const [check, row, remote] = unit.split('/');
  if (!CHECK_KINDS.includes(check as CheckKind) || row === undefined) throw new Error(`result key "${unit}" names no check and row`);
  const own = splitRow(row);
  const base = { unit, check: check as CheckKind, ...own };
  if (check === 'single-key' || remote === undefined) return { ...base, remote_chain: null, remote_address: null };
  if (check === 'rate-limit') return { ...base, remote_chain: remote === '*' ? null : remote, remote_address: null };
  const other = splitRow(remote);
  return { ...base, remote_chain: other.chain, remote_address: other.address === '*' ? null : other.address };
}

const arrivalView = (a: ArrivalItem) => ({
  kind: a.kind,
  chains: a.chains.map((ch) => ({ chain: ch.chain, address: splitRow(ch.row).address, readable: ch.readable, flags: ch.flags.map(unitRef) })),
  other_chain_flags: a.otherChainFlags,
});

const displayName = (t: PassportToken) => (t.symbol === null ? t.name : `${t.name} (${t.symbol})`);

/**
 * Each post record as stored, with every result it names taken apart, so a card can be drawn from it alone (KTD22). Its
 * chains are the ones the record itself names, so a sent post's card never changes.
 */
function eventsOf(records: readonly PassportPostRecord[], tokens: readonly PassportToken[]): PassportEvent[] {
  const pages = new Map(tokens.map((t) => [t.id, t]));
  const events = records.map((r): PassportEvent => {
    if (r.kind === 'summary') {
      const { raised, cleared, newToken, newChain } = r.counts;
      const named = r.groupIds.map((id) => ({ token_id: id, name: pages.has(id) ? displayName(pages.get(id)!) : null }));
      return { id: r.id, day: r.day, kind: 'summary', tokens: named, counts: { raised, cleared, new_token: newToken, new_chain: newChain } };
    }
    const changes = r.changes.map((ch) => ({ ...unitRef(ch.unit), kind: ch.kind, correction: ch.correction }));
    const arrivals = r.arrivals.map(arrivalView);
    const named = [...changes.map((ch) => ch.chain), ...arrivals.flatMap((a) => a.chains.map((ch) => ch.chain))];
    const chains = [...new Set(named)].sort(bySelector);
    return { id: r.id, day: r.day, kind: 'token', token_id: r.groupId, name: r.name, chains, changes, arrivals };
  });
  const rank = (e: PassportEvent) => (e.kind === 'summary' ? 2 : e.changes.length > 0 ? 0 : 1);
  const nameOf = (e: PassportEvent) => (e.kind === 'token' ? e.name : '');
  return events.sort((a, b) => byName(b.day, a.day) || rank(a) - rank(b) || byName(nameOf(a), nameOf(b)) || byName(a.id, b.id));
}
