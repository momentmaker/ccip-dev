import type { CheckResult, PassportPostRecord, StoredReading, WireLog, WireUnitState } from '@ccip-dev/core';
import { broadcastKey } from '@ccip-dev/core/broadcasts';
import { chunks, placeholders } from './store';

/** D1 binds at most 100 parameters per statement. */
const PARAMS = 90;
const BATCH_SIZE = 100;
/** Readings per evaluation page: one with many lanes runs to tens of kilobytes. */
export const EVALUATION_PAGE = 25;
const UNITS_PAGE = 200;

/** A registry row's key, `<selector>:<address>`. */
export const rowKey = (chain: string, address: string): string => `${chain}:${address}`;

/** Items by key, each group in input order and the groups in the order their first item came. */
export function groupBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = out.get(k);
    if (group === undefined) out.set(k, [item]);
    else group.push(item);
  }
  return out;
}

export interface ChainState {
  chain: string;
  lastBlock: number | null;
  /** The job day of the chain's last successful reading. */
  okDay: string | null;
  /** Days in a row the chain's reading failed. */
  failures: number;
  transport: 'multicall3' | 'single' | null;
  triedDay: string | null;
  /** Tries on triedDay. */
  attempts: number;
}

interface ChainStateRow {
  chain: string;
  last_block: number | null;
  ok_day: string | null;
  failures: number;
  transport: ChainState['transport'];
  tried_day: string | null;
  attempts: number;
}

export const chainStatesSql = (count: number) =>
  `SELECT chain, last_block, ok_day, failures, transport, tried_day, attempts FROM passport_chains WHERE chain IN (${placeholders(count)})`;

export async function chainStates(db: D1Database, chains: readonly string[]): Promise<Map<string, ChainState>> {
  const states = new Map<string, ChainState>();
  for (const chunk of chunks([...chains], PARAMS)) {
    const { results } = await db.prepare(chainStatesSql(chunk.length)).bind(...chunk).all<ChainStateRow>();
    for (const r of results) {
      states.set(r.chain, { chain: r.chain, lastBlock: r.last_block, okDay: r.ok_day, failures: r.failures, transport: r.transport, triedDay: r.tried_day, attempts: r.attempts });
    }
  }
  return states;
}

function chainStateStatement(db: D1Database, s: ChainState): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO passport_chains (chain, last_block, ok_day, failures, transport, tried_day, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block, ok_day = excluded.ok_day, failures = excluded.failures,
         transport = excluded.transport, tried_day = excluded.tried_day, attempts = excluded.attempts`,
    )
    .bind(s.chain, s.lastBlock, s.okDay, s.failures, s.transport, s.triedDay, s.attempts);
}

export async function saveChainState(db: D1Database, s: ChainState): Promise<void> {
  await chainStateStatement(db, s).run();
}

/** Chains with a registry row listed since `listedSince`. */
export async function listedChains(db: D1Database, listedSince: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT DISTINCT chain FROM tokens WHERE last_seen >= ?').bind(listedSince).all<{ chain: string }>();
  return results.map((r) => r.chain);
}

export async function listedTokens(db: D1Database, chain: string, listedSince: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT address FROM tokens WHERE chain = ? AND last_seen >= ? ORDER BY address').bind(chain, listedSince).all<{ address: string }>();
  return results.map((r) => r.address);
}

export const STORED_READINGS_SQL = 'SELECT address, reading, first_read_day FROM passport_rows WHERE chain = ?';

export interface StoredRowReading {
  reading: StoredReading | null;
  firstReadDay: string | null;
}

export async function storedReadings(db: D1Database, chain: string): Promise<Map<string, StoredRowReading>> {
  const { results } = await db.prepare(STORED_READINGS_SQL).bind(chain).all<{ address: string; reading: string | null; first_read_day: string | null }>();
  return new Map(results.map((r) => [r.address, { reading: r.reading === null ? null : (JSON.parse(r.reading) as StoredReading), firstReadDay: r.first_read_day }]));
}

/** What a passport_changes row records. */
export type ChangeKind = 'first-reading' | 'setting' | 'pool-replaced' | WireLog | 'correction';

export interface LogEntry {
  chain: string;
  address: string;
  day: string;
  kind: ChangeKind;
  detail: unknown;
}

export interface RowReadingWrite {
  address: string;
  reading: StoredReading;
  method: number;
  /** The chain values that differ from the stored reading. */
  changed: readonly string[];
  logs: readonly LogEntry[];
}

export function logStatement(db: D1Database, e: LogEntry): D1PreparedStatement {
  return db.prepare('INSERT INTO passport_changes (chain, address, day, kind, detail) VALUES (?, ?, ?, ?, ?)').bind(e.chain, e.address, e.day, e.kind, JSON.stringify(e.detail));
}

/** Statement groups in batches of at most BATCH_SIZE, a group never split, so each one lands whole or not at all. */
async function runGroups(db: D1Database, groups: D1PreparedStatement[][]): Promise<void> {
  let batch: D1PreparedStatement[] = [];
  for (const group of groups) {
    if (batch.length > 0 && batch.length + group.length > BATCH_SIZE) {
      await db.batch(batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length > 0) await db.batch(batch);
}

/**
 * Each row's log rows and its new reading land in one batch, so a retried write never logs a change twice; the chain
 * state comes last, so the chain counts as read only once every row is stored.
 */
export async function saveChainReading(db: D1Database, chain: string, rows: readonly RowReadingWrite[], state: ChainState): Promise<void> {
  const upsert = db.prepare(
    `INSERT INTO passport_rows (chain, address, reading, read_day, method, first_read_day, changed) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6)
     ON CONFLICT(chain, address) DO UPDATE SET reading = excluded.reading, read_day = excluded.read_day, method = excluded.method,
       first_read_day = COALESCE(passport_rows.first_read_day, excluded.first_read_day), changed = excluded.changed, delisted_day = NULL`,
  );
  const groups = rows.map((r) => [
    ...r.logs.map((e) => logStatement(db, e)),
    upsert.bind(chain, r.address, JSON.stringify(r.reading), r.reading.readOn, r.method, JSON.stringify(r.changed)),
  ]);
  await runGroups(db, [...groups, [chainStateStatement(db, state)]]);
}

export interface RegistryRow {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  group_id: string | null;
  first_seen: string;
  last_seen: string;
}

export async function registryRows(db: D1Database): Promise<RegistryRow[]> {
  const { results } = await db.prepare('SELECT chain, address, symbol, name, decimals, group_id, first_seen, last_seen FROM tokens ORDER BY chain, address').all<RegistryRow>();
  return results;
}

export interface StoredRow {
  chain: string;
  address: string;
  reading: string | null;
  read_day: string | null;
  first_read_day: string | null;
  changed: string | null;
  arrival: string | null;
  arrival_day: string | null;
  delisted_day: string | null;
}

const readings = new WeakMap<StoredRow, StoredReading>();

/** A stored row's reading, parsed once however many times it is asked for. */
export function readingOf(row: StoredRow): StoredReading | null {
  if (!row.reading) return null;
  const known = readings.get(row);
  if (known !== undefined) return known;
  const reading = JSON.parse(row.reading) as StoredReading;
  readings.set(row, reading);
  return reading;
}

export const ROWS_PAGE_SQL = `SELECT chain, address, reading, read_day, first_read_day, changed, arrival, arrival_day, delisted_day FROM passport_rows
  WHERE (chain, address) > (?, ?) ORDER BY chain, address LIMIT ?`;

/** Every stored row, a page of EVALUATION_PAGE at a time in key order; readings stay unparsed until their group is evaluated. */
export async function storedRows(db: D1Database): Promise<StoredRow[]> {
  const rows: StoredRow[] = [];
  let after = { chain: '', address: '' };
  for (;;) {
    const { results } = await db.prepare(ROWS_PAGE_SQL).bind(after.chain, after.address, EVALUATION_PAGE).all<StoredRow>();
    rows.push(...results);
    if (results.length < EVALUATION_PAGE) return rows;
    after = results.at(-1)!;
  }
}

export interface StoredUnit {
  unit: string;
  chain: string;
  address: string;
  result: string;
  wire: string;
}

export const UNITS_PAGE_SQL = 'SELECT unit, chain, address, result, wire FROM passport_units WHERE unit > ? ORDER BY unit LIMIT ?';

export async function storedUnits(db: D1Database): Promise<StoredUnit[]> {
  const units: StoredUnit[] = [];
  let after = '';
  for (;;) {
    const { results } = await db.prepare(UNITS_PAGE_SQL).bind(after, UNITS_PAGE).all<StoredUnit>();
    units.push(...results);
    if (results.length < UNITS_PAGE) return units;
    after = results.at(-1)!.unit;
  }
}

export interface UnitWrite {
  unit: string;
  chain: string;
  address: string;
  result: CheckResult;
  wire: WireUnitState;
}

export function unitStatement(db: D1Database, u: UnitWrite): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO passport_units (unit, chain, address, result, basis, announced, pending, pending_day, wire) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(unit) DO UPDATE SET chain = excluded.chain, address = excluded.address, result = excluded.result, basis = excluded.basis,
         announced = excluded.announced, pending = excluded.pending, pending_day = excluded.pending_day, wire = excluded.wire`,
    )
    .bind(u.unit, u.chain, u.address, JSON.stringify(u.result), u.result.basis, u.wire.announced, u.wire.pending?.result ?? null, u.wire.pending?.day ?? null, JSON.stringify(u.wire));
}

export function deleteUnitStatement(db: D1Database, unit: string): D1PreparedStatement {
  return db.prepare('DELETE FROM passport_units WHERE unit = ?').bind(unit);
}

export function arrivalStatement(db: D1Database, chain: string, address: string, arrival: unknown, arrivalDay: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO passport_rows (chain, address, arrival, arrival_day) VALUES (?, ?, ?, ?)
       ON CONFLICT(chain, address) DO UPDATE SET arrival = excluded.arrival, arrival_day = excluded.arrival_day`,
    )
    .bind(chain, address, JSON.stringify(arrival), arrivalDay);
}

/** Marks a row "no longer listed" from `day`; null clears the mark for a row listed again. */
export function delistStatement(db: D1Database, chain: string, address: string, day: string | null): D1PreparedStatement {
  return db
    .prepare('INSERT INTO passport_rows (chain, address, delisted_day) VALUES (?, ?, ?) ON CONFLICT(chain, address) DO UPDATE SET delisted_day = excluded.delisted_day')
    .bind(chain, address, day);
}

/** The log kinds an evaluation writes; a second evaluation that day deletes them first. */
export const EVALUATION_LOG_KINDS = ['re-classified'] as const satisfies readonly ChangeKind[];

export async function clearEvaluationLog(db: D1Database, day: string): Promise<void> {
  await db.prepare(`DELETE FROM passport_changes WHERE day = ? AND kind IN (${placeholders(EVALUATION_LOG_KINDS.length)})`).bind(day, ...EVALUATION_LOG_KINDS).run();
}

/** The day's correction log rows' details, unparsed. */
export async function correctionLog(db: D1Database, day: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT detail FROM passport_changes WHERE day = ? AND kind = 'correction' ORDER BY id`).bind(day).all<{ detail: string }>();
  return results.map((r) => r.detail);
}

/**
 * The day's correction log rows give way to `entries` in one batch, so an evaluation that dies before it leaves the
 * earlier rows, and each corrected unit's value before the day, in place for the next one.
 */
export async function replaceCorrectionLog(db: D1Database, day: string, entries: readonly LogEntry[]): Promise<void> {
  await db.batch([db.prepare(`DELETE FROM passport_changes WHERE day = ? AND kind = 'correction'`).bind(day), ...entries.map((e) => logStatement(db, e))]);
}

export interface ChangeRow {
  id: number;
  chain: string;
  address: string;
  day: string;
  kind: string;
  /** null for a first reading, whose detail is the whole reading and is not published. */
  detail: string | null;
}

const CHANGES_PAGE = 500;
export const CHANGES_PAGE_SQL = `SELECT id, chain, address, day, kind, CASE WHEN kind = 'first-reading' THEN NULL ELSE detail END AS detail
  FROM passport_changes WHERE id > ? ORDER BY id LIMIT ?`;

/** The whole change log in id order, a page of CHANGES_PAGE at a time. */
export async function changeLog(db: D1Database): Promise<ChangeRow[]> {
  const rows: ChangeRow[] = [];
  let after = 0;
  for (;;) {
    const { results } = await db.prepare(CHANGES_PAGE_SQL).bind(after, CHANGES_PAGE).all<ChangeRow>();
    rows.push(...results);
    if (results.length < CHANGES_PAGE) return rows;
    after = results.at(-1)!.id;
  }
}

export const POSTS_SINCE_SQL = 'SELECT facts FROM passport_posts WHERE day >= ? ORDER BY day';

/** Post records from `day` on, by passport_posts_day; a day holds at most eleven. */
export async function postsSince(db: D1Database, day: string): Promise<PassportPostRecord[]> {
  const { results } = await db.prepare(POSTS_SINCE_SQL).bind(day).all<{ facts: string }>();
  return results.map((r) => JSON.parse(r.facts) as PassportPostRecord);
}

const dueKey = (id: string) => `passport:due:${id}`;

/**
 * The ids among `ids`, records of `day`, whose broadcast was claimed or sent: the broadcast's key, or one of its
 * `#<output>` rows, is in meta. An output row alone means one output sent while another failed, so the record is already
 * partly out. One range read over the day's broadcast keys: D1 refuses a compound SELECT of more than five terms.
 */
async function claimedPosts(db: D1Database, day: string, ids: readonly string[]): Promise<Set<string>> {
  const prefix = broadcastKey({ kind: 'passport', id: day });
  const { results } = await db.prepare('SELECT key FROM meta WHERE key >= ? AND key < ?').bind(`${prefix}-`, `${prefix}.`).all<{ key: string }>();
  const keys = results.map((r) => r.key);
  return new Set(ids.filter((id) => {
    const key = broadcastKey({ kind: 'passport', id });
    return keys.some((k) => k === key || k.startsWith(`${key}#`));
  }));
}

/** The day's post records already claimed or sent, which stay as they are (KTD16), so planning the day again counts them in. */
export async function keptPosts(db: D1Database, day: string): Promise<PassportPostRecord[]> {
  const { results } = await db.prepare('SELECT id, facts FROM passport_posts WHERE day = ? ORDER BY id').bind(day).all<{ id: string; facts: string }>();
  const claimed = await claimedPosts(db, day, results.map((r) => r.id));
  return results.filter((r) => claimed.has(r.id)).map((r) => JSON.parse(r.facts) as PassportPostRecord);
}

/**
 * One day's post records replace that day's earlier ones in one batch, but KTD16 holds for a record already claimed or sent:
 * it stays exactly as it was, so a second evaluation that day never rewrites what went out or is going out. A record
 * seeded while posts were off stays seeded, so turning posts on never sends it (KTD20).
 */
export async function replacePosts(db: D1Database, day: string, records: readonly PassportPostRecord[], state: 'due' | 'seeded'): Promise<void> {
  const { results: old } = await db.prepare('SELECT id, state FROM passport_posts WHERE day = ?').bind(day).all<{ id: string; state: string }>();
  const seeded = new Set(old.filter((r) => r.state === 'seeded').map((r) => r.id));
  const kept = await claimedPosts(db, day, old.map((r) => r.id));
  const written = new Set(records.map((r) => r.id));
  const insert = db.prepare('INSERT INTO passport_posts (id, day, kind, group_id, facts, state) VALUES (?, ?, ?, ?, ?, ?)');
  const replaced = old.filter((r) => !kept.has(r.id));
  const statements = [
    ...replaced.map((r) => db.prepare('DELETE FROM passport_posts WHERE id = ?').bind(r.id)),
    ...replaced.filter((r) => !written.has(r.id)).map((r) => db.prepare('DELETE FROM meta WHERE key = ?').bind(dueKey(r.id))),
    ...records
      .filter((r) => !kept.has(r.id))
      .map((r) => insert.bind(r.id, r.day, r.kind, r.kind === 'token' ? r.groupId : null, JSON.stringify(r), seeded.has(r.id) ? 'seeded' : state)),
  ];
  if (statements.length > 0) await db.batch(statements);
}

/** Notes `at` as the time each due record of `day` became due, keeping the time of one noted before, so its 48 hours run from then. */
export async function markDuePosts(db: D1Database, day: string, at: string): Promise<void> {
  await db
    .prepare(`INSERT INTO meta (key, value) SELECT 'passport:due:' || id, ? FROM passport_posts WHERE day = ? AND state = 'due' ON CONFLICT(key) DO NOTHING`)
    .bind(at, day)
    .run();
}

export interface DuePost {
  record: PassportPostRecord;
  /** When the record became due; its own day's start for a record noted by no evaluation. */
  dueSince: string;
}

export const DUE_POSTS_SQL = `SELECT p.facts, m.value AS due_since FROM passport_posts p LEFT JOIN meta m ON m.key = 'passport:due:' || p.id
  WHERE p.day >= ? AND p.state = 'due' ORDER BY p.day, p.id`;

/** The due post records from `day` on, sent or not, by passport_posts_day. */
export async function duePosts(db: D1Database, day: string): Promise<DuePost[]> {
  const { results } = await db.prepare(DUE_POSTS_SQL).bind(day).all<{ facts: string; due_since: string | null }>();
  return results.map((r) => {
    const record = JSON.parse(r.facts) as PassportPostRecord;
    return { record, dueSince: r.due_since ?? `${record.day}T00:00:00.000Z` };
  });
}

/** Empties the five tables and every `passport:` meta key; the launch run starts from nothing (KTD20). */
export async function clearPassport(db: D1Database): Promise<void> {
  await db.batch([
    ...['passport_chains', 'passport_rows', 'passport_units', 'passport_changes', 'passport_posts'].map((t) => db.prepare(`DELETE FROM ${t}`)),
    db.prepare("DELETE FROM meta WHERE key >= 'passport:' AND key < 'passport;'"),
  ]);
}
