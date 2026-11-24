import {
  bySelector, ChainReadError, classifyParties, confirmArrivals, createThrottle, dayOf, evaluateChecks, groupName, listLaneOnRamps, METHOD_VERSION, openChain, PARTY_ROLES, passportCorrections,
  passportNotesHash, planPassportPosts, readPassportChain, stepWireUnit, WIRE_TOKEN_POSTS, WIRE_UNREAD,
  type ArrivalItem, type ArrivalReading, type ArrivingRow, type ChainRef, type CheckResult, type CheckValue, type Correction, type DesignReason, type HttpDeps, type LaneOnRamps,
  type PartyClassification, type PassportRow, type RawLane, type RawSettings, type Readable, type RateLimit, type RowReading, type StoredReading,
  type WireChange, type WireOutcome, type WireUnitState,
} from '@ccip-dev/core';
import directory from '../../../config/ccip-directory.json';
import { broadcastSafely } from '../broadcasts/run';
import type { RunContext } from '../context';
import { passportConfig, postState, type PassportConfig } from '../passport-config';
import { publishPassport, type Publication, type PublishGroup, type PublishRow } from '../passport-publish';
import * as passportStore from '../passport-store';
import { groupBy, rowKey } from '../passport-store';
import { chainEndpoint } from '../rpc';
import * as store from '../store';

/** The first run at or after 01:00 UTC starts the day's reading, after the 00:07 finalize. */
export const START_HOUR_UTC = 1;
/** From the 22:00 UTC run the day is evaluated with whatever was read. */
export const CLOSE_HOUR_UTC = 22;
export const RUN_BUDGET_MS = 4 * 60_000;
/**
 * A chain starts only while this much of the run's budget remains, and fails for the day past it. The recorded fixtures
 * cost 12 requests for one row and 15 for two; Ethereum, the largest chain at 222 rows, comes to about 670, which at the
 * 150-250 ms a keyless endpoint takes is two to three minutes.
 */
export const CHAIN_TIME_LIMIT_MS = 3 * 60_000;
/**
 * Passport runs last in the hourly cron, whose invocation ends at 15 minutes of wall clock. The Reserve and staking scans
 * before it may each take 4 minutes when behind, so chain readings end this far into the invocation, leaving the
 * evaluation, publish and wire a margin.
 */
export const INVOCATION_READ_WINDOW_MS = 11 * 60_000;
/** Start-to-start spacing of one chain's requests: back-to-back reads drew HTTP 429 from public endpoints. */
const REQUEST_INTERVAL_MS = 150;
const LISTED_WITHIN_DAYS = 7;
const TRIES_PER_DAY = 2;
const CHAIN_ALERT_AFTER = 3;
const ARRIVAL_READINGS_KEPT = 2;
const DAY_MS = 86_400_000;
const WRITE_BATCH = 100;

const META = { mode: 'passport:mode', since: 'passport:since', evaluated: 'passport:evaluated', onRamps: 'passport:onramps', notes: 'passport:notes' } as const;
const VERIFIER_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = directory.verifiers;
const TOP_SETTINGS = ['administrator', 'pendingAdministrator', 'pool', 'poolType', 'hooks', 'allowedFinality'] as const satisfies readonly (keyof RawSettings)[];
const LANE_SETTINGS = ['remoteToken', 'remotePools', 'outbound', 'inbound', 'fastOutbound', 'fastInbound', 'poolVerifiers', 'laneVerifiers'] as const satisfies readonly (keyof RawLane)[];

/**
 * KTD17: one reading per chain per day inside the hourly cron. From 01:00 UTC each run reads chains within its budget;
 * once every chain has been tried, or from 22:00 UTC, the day is evaluated once. KTD21: a later run that day whose
 * bundled statements and corrections differ from those last evaluated with evaluates the day again. Every run then offers
 * the due post records to the wire (KTD22), even one whose reading failed, so a post waiting for its card still goes out.
 */
export async function runPassport(c: RunContext): Promise<void> {
  const config = passportConfig(c.env);
  if (config.mode === 'off') return;
  try {
    await recordDay(c, config);
  } finally {
    await broadcastSafely(c, { kind: 'passport' });
  }
}

async function recordDay(c: RunContext, config: PassportConfig): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const today = dayOf(now);
  const since = await startRecord(db, config, today);
  const notes = passportNotesHash(c.passportNotes);
  if ((await store.getMeta(db, META.evaluated)) === today) {
    if ((await store.getMeta(db, META.notes)) !== notes) {
      await publishPassport(c, await evaluateDay(c, { today, since, config }));
      await store.setMeta(db, META.notes, notes);
    }
    return;
  }
  if (now.getUTCHours() < START_HOUR_UTC) return;

  const untried = await readChains(c, await chainsToRead(c, today), today);
  if (untried.length > 0 && now.getUTCHours() < CLOSE_HOUR_UTC) return;
  await publishPassport(c, await evaluateDay(c, { today, since, config }));
  await store.setMeta(db, META.evaluated, today);
  await store.setMeta(db, META.notes, notes);
  if (untried.length > 0) {
    await c.alert('passport-incomplete', `The Passport reading for ${today} was evaluated incomplete at ${now.getUTCHours()}:00 UTC; not read: ${untried.map((ch) => ch.ref.name).join(', ')}`);
  }
}

/** The launch watermark. The first run with PASSPORT on clears whatever a dry run stored and starts the record (KTD20). */
async function startRecord(db: D1Database, config: PassportConfig, today: string): Promise<string> {
  const mode = await store.getMeta(db, META.mode);
  if (config.mode === 'on' && mode !== 'on') {
    await passportStore.clearPassport(db);
    await store.setMeta(db, META.since, today);
    await store.setMeta(db, META.mode, 'on');
    return today;
  }
  if (mode === null) {
    await store.setMeta(db, META.since, today);
    await store.setMeta(db, META.mode, config.mode);
    return today;
  }
  return (await store.getMeta(db, META.since)) ?? today;
}

const listedSince = (c: RunContext) => new Date(c.deps.now().getTime() - LISTED_WITHIN_DAYS * DAY_MS).toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

type ChainAccess = { design: DesignReason } | { design: null; rpcUrl: string; registry: string };

/** KTD8: rows on a chain with a design reason are never read, and every result on them is "not readable" with that reason. */
function chainAccess(ref: ChainRef | undefined): ChainAccess {
  if (ref === undefined) return { design: 'no-endpoint' };
  if (ref.family !== 'EVM') return { design: 'non-evm-chain' };
  const endpoint = chainEndpoint(ref);
  if (endpoint.ok) return { design: null, rpcUrl: endpoint.rpcUrl, registry: endpoint.tokenAdminRegistry };
  return { design: endpoint.reason === 'no endpoint' ? 'no-endpoint' : 'no-registry' };
}

interface ReadableChain {
  ref: ChainRef;
  rpcUrl: string;
  registry: string;
  state: passportStore.ChainState | undefined;
}

/** A chain is done for the day once it read, or once its second try failed. */
const needsReading = (state: passportStore.ChainState | undefined, today: string) =>
  state === undefined || (state.okDay !== today && !(state.triedDay === today && state.attempts >= TRIES_PER_DAY));

/** The chains still to read today, in selector order: the cursor is each chain's own state in passport_chains. */
async function chainsToRead(c: RunContext, today: string): Promise<ReadableChain[]> {
  const db = c.env.DB;
  const refs = await store.chainRefs(db);
  const candidates = (await passportStore.listedChains(db, listedSince(c))).flatMap((selector) => {
    const ref = refs.get(selector);
    if (ref === undefined) return [];
    const access = chainAccess(ref);
    return access.design === null ? [{ ref, rpcUrl: access.rpcUrl, registry: access.registry }] : [];
  });
  const states = await passportStore.chainStates(db, candidates.map((ch) => ch.ref.selector));
  return candidates
    .map((ch) => ({ ...ch, state: states.get(ch.ref.selector) }))
    .filter((ch) => needsReading(ch.state, today))
    .sort((a, b) => bySelector(a.ref.selector, b.ref.selector));
}

/**
 * Reads chains while the budget allows a whole chain; returns those still untried, a chain awaiting its second try or
 * a block from today included.
 */
async function readChains(c: RunContext, chains: readonly ReadableChain[], today: string): Promise<ReadableChain[]> {
  const deadline = Math.min(c.deps.now().getTime() + RUN_BUDGET_MS, c.invokedAt.getTime() + INVOCATION_READ_WINDOW_MS);
  let onRamps: LaneOnRamps | null | undefined;
  const untried: ReadableChain[] = [];
  for (const chain of chains) {
    if (deadline - c.deps.now().getTime() < CHAIN_TIME_LIMIT_MS) {
      untried.push(chain);
      continue;
    }
    if (onRamps === undefined) onRamps = await laneOnRamps(c, today);
    if (onRamps === null || (await readChain(c, chain, onRamps[chain.ref.selector] ?? {}, today)) === 'retry') untried.push(chain);
  }
  return untried;
}

/**
 * Each lane's OnRamp from the keyless lanes endpoint, fetched once a day. When the endpoint fails, the last stored list
 * stands in (lanes rarely change in a day); with none stored, null leaves the chains untried, so the run that closes the
 * day still evaluates and reports them instead of failing on every try.
 */
async function laneOnRamps(c: RunContext, today: string): Promise<LaneOnRamps | null> {
  const stored = await store.getMeta(c.env.DB, META.onRamps);
  const kept = stored === null ? null : (JSON.parse(stored) as { day: string; onRamps: LaneOnRamps });
  if (kept?.day === today) return kept.onRamps;
  try {
    const onRamps = await listLaneOnRamps(c.deps, c.env.CCIP_API_BASE);
    await store.setMeta(c.env.DB, META.onRamps, JSON.stringify({ day: today, onRamps }));
    return onRamps;
  } catch (err) {
    const fallback = kept === null ? 'no stored lane list, so no chain is read this run' : `reading with the lane list from ${kept.day}`;
    await c.alert('passport-lanes', `The CCIP lanes endpoint failed (${messageOf(err)}); ${fallback}`);
    return kept?.onRamps ?? null;
  }
}

type ReadRow = Extract<RowReading, { status: 'read' }>;

const partyAddresses = (settings: RawSettings) => PARTY_ROLES.flatMap((role) => {
  const party = settings.parties[role];
  return party.state === 'address' ? [party.address.toLowerCase()] : [];
});

/**
 * One chain at one pinned block (KTD5): registry rows, then their parties. A request made past the chain's time limit
 * stops the reading. A failure is tried once more in a later run before it counts; one past the time limit counts at once.
 * A pinned block from before today's midnight is left for a later run, with no try used and nothing written: a reading
 * dated the day before would never count as read today nor set its rows' baseline (R33). From 03:00 UTC every block
 * openChain accepts is from today.
 */
async function readChain(c: RunContext, chain: ReadableChain, onRamps: Readonly<Record<string, string>>, today: string): Promise<'read' | 'retry' | 'failed'> {
  const db = c.env.DB;
  const { ref, state } = chain;
  const limitAt = c.deps.now().getTime() + CHAIN_TIME_LIMIT_MS;
  const pastLimit = () => c.deps.now().getTime() >= limitAt;
  const overLimit = () => new ChainReadError('endpoint', `${ref.name}: the reading passed its ${CHAIN_TIME_LIMIT_MS / 1000} s time limit`);
  const paced = createThrottle(c.deps, REQUEST_INTERVAL_MS);
  const deps: HttpDeps = {
    sleep: c.deps.sleep,
    clock: c.deps.clock,
    fetch: async (input, init) => {
      await paced();
      if (pastLimit()) throw overLimit();
      return c.deps.fetch(input, init);
    },
  };
  const tries = (state?.triedDay === today ? state.attempts : 0) + 1;
  try {
    const tokens = await passportStore.listedTokens(db, ref.selector, listedSince(c));
    const pinned = await openChain(deps, chain.rpcUrl, { chainId: Number(ref.chainId), lastBlock: state?.lastBlock ?? null });
    const readOn = dayOf(new Date(pinned.timestamp * 1000));
    if (readOn !== today) return 'retry';
    const readings = await readPassportChain(deps, pinned, { registry: chain.registry, onRamps, tokens });
    const read = readings.filter((r): r is ReadRow => r.status === 'read');
    const parties = await classifyParties(deps, pinned, read.flatMap((r) => partyAddresses(r.settings)));
    if (pastLimit()) throw overLimit();

    const stored = await passportStore.storedReadings(db, ref.selector);
    const original = new Map(tokens.map((t) => [t.toLowerCase(), t]));
    const rows = read.map((r) => {
      const address = original.get(r.token) ?? r.token;
      const reading: StoredReading = { readOn, settings: r.settings, parties: partiesOf(r.settings, parties) };
      return rowWrite(ref.selector, address, reading, stored.get(address)?.reading ?? null);
    });
    await passportStore.saveChainReading(db, ref.selector, rows, {
      chain: ref.selector, lastBlock: pinned.block, okDay: today, failures: 0, transport: pinned.multicall3 ? 'multicall3' : 'single', triedDay: today, attempts: tries,
    });
    const unread = readings.filter((r) => r.status === 'unread');
    if (unread.length > 0) {
      const named = unread.map((r) => `${original.get(r.token) ?? r.token} (${r.failures[0]})`).join('; ');
      await c.alert(`passport-calls:${ref.selector}`, `Passport kept the stored reading of ${unread.length} rows on ${ref.name} whose calls failed: ${named}`);
    }
    return 'read';
  } catch (err) {
    const final = pastLimit() || tries >= TRIES_PER_DAY;
    const failures = (state?.failures ?? 0) + (final ? 1 : 0);
    console.warn(`Passport reading of ${ref.name} failed (try ${tries}): ${messageOf(err)}`);
    await passportStore.saveChainState(db, {
      chain: ref.selector, lastBlock: state?.lastBlock ?? null, okDay: state?.okDay ?? null, failures, transport: state?.transport ?? null, triedDay: today, attempts: final ? TRIES_PER_DAY : tries,
    });
    if (final && failures >= CHAIN_ALERT_AFTER) await c.alert(`passport-chain:${ref.selector}`, `Passport could not read ${ref.name} on ${failures} days in a row: ${messageOf(err)}`);
    return final ? 'failed' : 'retry';
  }
}

function partiesOf(settings: RawSettings, classified: ReadonlyMap<string, PartyClassification>): Record<string, PartyClassification> {
  return Object.fromEntries(partyAddresses(settings).map((address) => {
    const party = classified.get(address);
    if (party === undefined) throw new Error(`party ${address} of token ${settings.token} was not classified`);
    return [address, party];
  }));
}

function rowWrite(chain: string, address: string, reading: StoredReading, previous: StoredReading | null): passportStore.RowReadingWrite {
  if (previous === null) return { address, reading, method: METHOD_VERSION, changed: [], logs: [{ chain, address, day: reading.readOn, kind: 'first-reading', detail: reading }] };
  const logs = settingChanges(previous, reading).map((detail): passportStore.LogEntry => ({ chain, address, day: reading.readOn, kind: detail.setting === 'pool' ? 'pool-replaced' : 'setting', detail }));
  return { address, reading, method: METHOD_VERSION, changed: chainValueChanges(previous.settings, reading.settings), logs };
}

interface SettingChange {
  setting: string;
  from: unknown;
  to: unknown;
}

const lanesBySelector = (lanes: readonly RawLane[]) => new Map(lanes.map((l) => [l.remoteChainSelector, l]));
const selectorsOf = (a: ReadonlyMap<string, RawLane>, b: ReadonlyMap<string, RawLane>) => [...new Set([...a.keys(), ...b.keys()])].sort(bySelector);

/** KTD9: one entry per configuration value that differs, with its old and new value; a party's signer facts count too. */
function settingChanges(previous: StoredReading, next: StoredReading): SettingChange[] {
  const out: SettingChange[] = [];
  const diff = (setting: string, from: unknown, to: unknown) => {
    if (!same(from, to)) out.push({ setting, from, to });
  };
  for (const key of TOP_SETTINGS) diff(key, previous.settings[key], next.settings[key]);
  for (const role of PARTY_ROLES) {
    const from = previous.settings.parties[role];
    const to = next.settings.parties[role];
    if (!same(from, to)) out.push({ setting: `parties.${role}`, from, to });
    else if (to.state === 'address') diff(`signers.${role}`, previous.parties[to.address.toLowerCase()], next.parties[to.address.toLowerCase()]);
  }
  const before = previous.settings.lanes;
  const after = next.settings.lanes;
  if (!('value' in before) || !('value' in after)) {
    diff('lanes', before, after);
    return out;
  }
  const a = lanesBySelector(before.value);
  const b = lanesBySelector(after.value);
  for (const selector of selectorsOf(a, b)) {
    const from = a.get(selector);
    const to = b.get(selector);
    if (from === undefined || to === undefined) diff(`lanes.${selector}`, from ?? null, to ?? null);
    else for (const field of LANE_SETTINGS) diff(`lanes.${selector}.${field}`, from[field], to[field]);
  }
  return out;
}

const limitSwitch = (limit: Readable<RateLimit>) => ('value' in limit ? limit.value.isEnabled : limit.reason);

/** KTD13: the chain values a result rests on that differ from the stored reading, keyed so a result can find its own. */
function chainValueChanges(previous: RawSettings, next: RawSettings): string[] {
  const keys: string[] = [];
  for (const role of PARTY_ROLES) if (!same(previous.parties[role], next.parties[role])) keys.push(`party:${role}`);
  if (previous.pool !== next.pool) keys.push('pool');
  if (!('value' in previous.lanes) || !('value' in next.lanes)) {
    if (!same(previous.lanes, next.lanes)) keys.push('lanes');
    return keys;
  }
  const a = lanesBySelector(previous.lanes.value);
  const b = lanesBySelector(next.lanes.value);
  for (const selector of selectorsOf(a, b)) {
    const from = a.get(selector);
    const to = b.get(selector);
    if (from === undefined || to === undefined) keys.push(`lane:${selector}`);
    else {
      if (limitSwitch(from.outbound) !== limitSwitch(to.outbound)) keys.push(`switch:${selector}`);
      if (!same(from.remoteToken, to.remoteToken)) keys.push(`remoteToken:${selector}`);
      if (!same(from.remotePools, to.remotePools)) keys.push(`remotePools:${selector}`);
    }
  }
  return keys;
}

interface DayInput {
  today: string;
  since: string;
  config: PassportConfig;
}

/** What evaluating one group needs beyond the day: the operator's corrections and what each corrected unit showed before the day. */
interface Evaluation extends DayInput {
  corrections: readonly Correction[];
  correctedFrom: ReadonlyMap<string, CheckValue | null>;
}

interface CorrectionDetail {
  unit: string;
  from: CheckValue | null;
  to: CheckValue;
  basis: string;
}

/**
 * The day's correction log rows are rewritten by every evaluation that day, so they hold the value each corrected unit
 * had before the day's first evaluation.
 */
async function correctedFrom(db: D1Database, day: string): Promise<Map<string, CheckValue | null>> {
  return new Map((await passportStore.correctionLog(db, day)).map((logged) => {
    const detail = JSON.parse(logged) as CorrectionDetail;
    return [detail.unit, detail.from];
  }));
}

interface Member {
  key: string;
  registry: passportStore.RegistryRow;
  stored: passportStore.StoredRow | undefined;
  design: DesignReason | null;
  firstSeen: string;
}

/** What evaluating every group adds up to for the day. */
interface DayTally {
  changes: WireChange[];
  arrivals: ArrivalItem[];
  names: Record<string, string>;
  pending: string[];
  produced: Set<string>;
  results: Map<string, CheckResult[]>;
  corrections: passportStore.LogEntry[];
}

const rowKeysOf = (r: CheckResult): string[] =>
  r.check === 'pool-pointer' ? r.rows.flatMap((x) => (x.token === null ? [] : [rowKey(x.chain, x.token)])) : [rowKey(r.row.chain, r.row.token)];

/** A unit key's parts after its check: its row keys, and for a lane a remote selector or `*`, which name no row. */
const unitRowKeys = (unit: string): string[] => unit.split('/').slice(1);

/**
 * Evaluates every group from the stored readings (U5), steps each result's wire state (U6), confirms arrivals, and replaces
 * the day's post records. A second evaluation on the same day replays from each state's `before`, so it replaces the first.
 * Returns what publishing needs, from the rows and readings already loaded here, so the files cost no second read of them.
 */
async function evaluateDay(c: RunContext, input: DayInput): Promise<Publication> {
  const db = c.env.DB;
  const refs = await store.chainRefs(db);
  const selectors = new Map([...refs.values()].map((ref) => [ref.name, ref.selector]));
  const day: Evaluation = { ...input, corrections: passportCorrections(c.passportNotes, selectors), correctedFrom: await correctedFrom(db, input.today) };
  const registry = await passportStore.registryRows(db);
  const storedRows = new Map((await passportStore.storedRows(db)).map((r) => [rowKey(r.chain, r.address), r]));
  const storedUnits = await passportStore.storedUnits(db);
  const unitsByRow = groupBy(storedUnits, (u) => rowKey(u.chain, u.address));

  const queue: D1PreparedStatement[] = [];
  const write = async (...statements: D1PreparedStatement[]) => {
    queue.push(...statements);
    if (queue.length >= WRITE_BATCH) await store.runBatch(db, queue.splice(0));
  };

  await passportStore.clearEvaluationLog(db, day.today);
  const listedFrom = listedSince(c);
  const listedRows: Member[] = [];
  const delistedRows: PublishRow[] = [];
  for (const r of registry) {
    const key = rowKey(r.chain, r.address);
    const stored = storedRows.get(key);
    const listed = r.last_seen >= listedFrom;
    const marked = stored?.delisted_day != null;
    if (!listed && !marked) await write(passportStore.delistStatement(db, r.chain, r.address, day.today));
    if (listed && marked) await write(passportStore.delistStatement(db, r.chain, r.address, null));
    const design = chainAccess(refs.get(r.chain)).design;
    if (listed) listedRows.push({ key, registry: r, stored, design, firstSeen: dayOf(r.first_seen) });
    else delistedRows.push({ registry: r, stored, design, delistedOn: stored?.delisted_day ?? day.today });
  }
  const groupIdOf = (r: passportStore.RegistryRow) => r.group_id ?? rowKey(r.chain, r.address);
  const groups = groupBy(listedRows, (m) => groupIdOf(m.registry));
  const delisted = groupBy(delistedRows, (r) => groupIdOf(r.registry));

  const tally: DayTally = { changes: [], arrivals: [], names: {}, pending: [], produced: new Set(), results: new Map(), corrections: [] };
  for (const [groupId, members] of groups) {
    await write(...evaluateGroup(db, groupId, members, unitsByRow, day, tally));
  }
  // A delisted row keeps its units, so its announced flags stand if the registry lists it again.
  const delistedKeys = new Set(delistedRows.map((r) => rowKey(r.registry.chain, r.registry.address)));
  for (const u of storedUnits) {
    if (!tally.produced.has(u.unit) && !unitRowKeys(u.unit).some((k) => delistedKeys.has(k))) await write(passportStore.deleteUnitStatement(db, u.unit));
  }
  await store.runBatch(db, queue.splice(0));
  await passportStore.replaceCorrectionLog(db, day.today, tally.corrections);

  const records = planPassportPosts({ day: day.today, changes: tally.changes, arrivals: tally.arrivals, names: tally.names, kept: await passportStore.keptPosts(db, day.today) });
  await passportStore.replacePosts(db, day.today, records, postState(day.config));
  await passportStore.markDuePosts(db, day.today, c.deps.now().toISOString());

  if (tally.pending.length > 0) {
    await c.alert('passport-pending', `Passport results went pending on ${day.today} and post if the next successful reading agrees: ${tally.pending.join('; ')}`);
  }
  const summary = records.find((r) => r.kind === 'summary');
  if (summary !== undefined) {
    const tokens = records.length - 1 + summary.groupIds.length;
    await c.alert('passport-cap', `${tokens} tokens have Passport posts on ${day.today}: ${WIRE_TOKEN_POSTS} get their own post and ${summary.groupIds.length} share the summary`);
  }

  const pages: PublishGroup[] = [...new Set([...groups.keys(), ...delisted.keys()])].map((id) => ({
    id,
    rows: [...(groups.get(id) ?? []).map((m): PublishRow => ({ registry: m.registry, stored: m.stored, design: m.design, delistedOn: null })), ...(delisted.get(id) ?? [])],
    results: tally.results.get(id) ?? [],
  }));
  return { mode: day.config.mode, day: day.today, since: day.since, refs, groups: pages };
}

function displayName(members: readonly Member[]): string {
  const name = groupName(members.map((m) => ({ chain: m.registry.chain, token: m.registry.address, symbol: m.registry.symbol, name: m.registry.name })));
  return name.symbol === null ? name.name : `${name.name} (${name.symbol})`;
}

/** Whether a result's chain values changed in today's reading of one of its rows (KTD13). */
function valuesChanged(result: CheckResult, members: readonly Member[], changedOf: (m: Member) => readonly string[]): boolean {
  return members.some((m) => {
    const changed = changedOf(m);
    if (result.check === 'single-key') return changed.some((k) => k.startsWith('party:'));
    if (result.check === 'rate-limit') return changed.some((k) => k === 'lanes' || (result.remoteChain !== null && (k === `lane:${result.remoteChain}` || k === `switch:${result.remoteChain}`)));
    const other = result.rows.find((r) => r.chain !== m.registry.chain)?.chain;
    return changed.some((k) => k === 'lanes' || k === 'pool' || (other !== undefined && [`lane:${other}`, `remoteToken:${other}`, `remotePools:${other}`].includes(k)));
  });
}

function evaluateGroup(db: D1Database, groupId: string, members: readonly Member[], unitsByRow: ReadonlyMap<string, readonly passportStore.StoredUnit[]>, day: Evaluation, tally: DayTally): D1PreparedStatement[] {
  const { today, since } = day;
  const statements: D1PreparedStatement[] = [];
  const byKey = new Map(members.map((m) => [m.key, m]));
  const name = displayName(members);
  tally.names[groupId] = name;

  const stored = members.flatMap((m) => unitsByRow.get(m.key) ?? []);
  const storedByUnit = new Map(stored.map((u) => [u.unit, u]));
  const rows: PassportRow[] = members.map((m) => ({
    chain: m.registry.chain,
    token: m.registry.address,
    symbol: m.registry.symbol,
    name: m.registry.name,
    decimals: m.registry.decimals,
    priceUsd: null,
    unreadableByDesign: m.design,
    reading: m.stored ? passportStore.readingOf(m.stored) : null,
  }));
  const results = evaluateChecks({ rows, corrections: day.corrections, previous: stored.map((u) => JSON.parse(u.result) as CheckResult), verifierNames: VERIFIER_NAMES, today });
  tally.results.set(groupId, results);

  const changed = new Map<Member, string[]>();
  const changedOf = (m: Member) => changed.get(m) ?? changed.set(m, JSON.parse(m.stored?.changed ?? '[]') as string[]).get(m)!;
  const readToday = (m: Member) => m.stored?.read_day === today && m.stored.reading !== null;
  // A row whose arrival confirmed today is still arriving, so a second evaluation that day confirms it the same way.
  const arriving = (m: Member) => m.firstSeen > since && (m.stored?.arrival_day == null || m.stored.arrival_day === today);
  const flagged = results.filter((r) => r.value === 'flagged');
  const arrivingRows: ArrivingRow[] = members.filter(arriving).map((m) => {
    let readings = (m.stored?.arrival ? JSON.parse(m.stored.arrival) : []) as ArrivalReading[];
    if (readToday(m)) {
      const flags = flagged.filter((r) => rowKeysOf(r).includes(m.key)).map((r) => r.key).sort();
      readings = [...readings.filter((r) => r.day !== today), { day: today, flags }].slice(-ARRIVAL_READINGS_KEPT);
    }
    return { row: m.key, chain: m.registry.chain, groupId, firstSeen: m.firstSeen, readableByDesign: m.design === null, readings };
  });
  const settled = members.filter((m) => !arriving(m)).map((m) => ({ groupId, chain: m.registry.chain, flags: flagged.filter((r) => rowKeysOf(r)[0] === m.key).length }));
  const items = confirmArrivals({ today, since, arriving: arrivingRows, settled });
  tally.arrivals.push(...items);
  const confirming = new Set(items.flatMap((i) => i.chains.map((ch) => ch.row)));
  for (const r of arrivingRows) {
    const m = byKey.get(r.row)!;
    const arrivalDay = confirming.has(r.row) ? today : null;
    if (m.stored?.arrival !== JSON.stringify(r.readings) || (m.stored?.arrival_day ?? null) !== arrivalDay) {
      statements.push(passportStore.arrivalStatement(db, m.registry.chain, m.registry.address, r.readings, arrivalDay));
    }
  }

  for (const result of results) {
    tally.produced.add(result.key);
    const unitMembers = rowKeysOf(result).map((k) => byKey.get(k)!);
    const [first] = unitMembers;
    const previous = storedByUnit.get(result.key);
    if (result.corrected) {
      const logged = day.correctedFrom.get(result.key);
      const from = logged !== undefined ? logged : previous ? (JSON.parse(previous.result) as CheckResult).value : null;
      if (from !== result.value) {
        const detail: CorrectionDetail = { unit: result.key, from, to: result.value, basis: result.basis };
        tally.corrections.push({ chain: first!.registry.chain, address: first!.registry.address, day: today, kind: 'correction', detail });
      }
    }
    let wire: WireUnitState = previous ? (JSON.parse(previous.wire) as WireUnitState) : WIRE_UNREAD;
    if (!unitMembers.some((m) => arriving(m) && !confirming.has(m.key))) {
      const outcome: WireOutcome = unitMembers.every(readToday)
        ? {
            read: true,
            result: result.value,
            method: result.methodVersion,
            baseline: unitMembers.some((m) => m.stored?.first_read_day === today || confirming.has(m.key)),
            chainValuesChanged: valuesChanged(result, unitMembers, changedOf),
            corrected: result.corrected,
          }
        : { read: false };
      const step = stepWireUnit(wire, outcome, today);
      wire = step.state;
      if (step.event !== null) tally.changes.push({ ...step.event, groupId, unit: result.key });
      if (step.log !== null) {
        statements.push(passportStore.logStatement(db, { chain: first!.registry.chain, address: first!.registry.address, day: today, kind: step.log, detail: { unit: result.key, from: step.state.before?.result ?? null, to: result.value } }));
      }
      if (wire.pending !== null && wire.pending.day === today) tally.pending.push(`${name} ${result.key}: ${wire.announced ?? 'unannounced'} → ${wire.pending.result}`);
    }
    if (previous?.result !== JSON.stringify(result) || previous.wire !== JSON.stringify(wire)) {
      statements.push(passportStore.unitStatement(db, { unit: result.key, chain: first!.registry.chain, address: first!.registry.address, result, wire }));
    }
  }
  return statements;
}
