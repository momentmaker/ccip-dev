import {
  addDays, BREAKDOWN_CONFLICT, buildTokenGroupIndex, LINK_TOKEN, linkFeeKeys, llamaKey, LINK_TOKEN_CHAIN_SELECTOR, normalizeAddress, sanitize, sqlLiteral, tokenGroupEntry, tokenGroupLookup, TOTALS_CONFLICT, type ChainRef, type CoingeckoIdLookup, type Fee,
  type ChainNames, type DailyBreakdown, type DailyTotals, type Dim, type FeeGroupTotals, type LaneDayRow, type LinkFeeTokens, type MessageRow, type NetworkInfo, type NormalizedToken, type PriceInfo,
  type ReserveTransfer, type SenderChain, type TokenGroupIndex, type TokenGroupOf, type TokenRow,
  SENDER_ADDRESS, unlabeledSenderRowsSql, VIA_TOKEN_BACKFILL_DAY_SQL, VIA_TOKEN_CREDIT_DAYS_SQL, VIA_TOKEN_CREDITS_SQL,
} from '@ccip-dev/core';
import { BUDGETED_MOMENTS } from '@ccip-dev/core/broadcasts';

const PARAM_CHUNK = 90;
const BATCH_SIZE = 100;
const MIN_MEDIAN_DAYS = 7;

export const MESSAGE_COLUMNS = [
  'message_id', 'day', 'send_ts', 'receipt_ts', 'status', 'src_chain', 'dst_chain', 'sender', 'receiver', 'origin',
  'token_count', 'usd_value', 'unpriced', 'fee_token', 'fee_amount', 'fee_usd', 'ready_for_manual_exec',
  'detail_fetched_at', 'next_check_at', 'source',
] as const satisfies readonly (keyof MessageRow)[];

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export async function runBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (const batch of chunks(statements, BATCH_SIZE)) await db.batch(batch);
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.prepare('DELETE FROM meta WHERE key = ?').bind(key).run();
    return;
  }
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

/**
 * Writes `value` under `key` in one statement unless the stored value sorts after `staleAtOrBefore`, and returns whether
 * this call wrote it, so of several runs racing for the same key exactly one wins.
 */
export async function claimMeta(db: D1Database, key: string, value: string, staleAtOrBefore: string): Promise<boolean> {
  // A claim is reclaimable only while it is a `pending:` value older than the cutoff: `sent:` and `seeded:` sort after `pending:`,
  // so they never compare `<=`, and any new prefix must sort after `pending:` too.
  const result = await db
    .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?3')
    .bind(key, value, staleAtOrBefore)
    .run();
  return result.meta.changes > 0;
}

/** Deletes `key` only while it still holds `value`, so releasing a claim never drops a newer one. */
export async function releaseMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('DELETE FROM meta WHERE key = ? AND value = ?').bind(key, value).run();
}

/** Writes `value` under each key that has none yet. */
export async function markMeta(db: D1Database, keys: string[], value: string): Promise<void> {
  const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  await runBatch(db, keys.map((key) => insert.bind(key, value)));
}

/** meta values by key, for the keys that have one. */
export async function getMetas(db: D1Database, keys: string[]): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  for (const chunk of chunks([...new Set(keys)], PARAM_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT key, value FROM meta WHERE key IN (${placeholders(chunk.length)})`)
      .bind(...chunk)
      .all<{ key: string; value: string }>();
    for (const r of results) values.set(r.key, r.value);
  }
  return values;
}

/**
 * The moments of these kinds marked sent on day ?1: their own keys, not their `#output` rows. Each kind is a key range, so the
 * count reads meta's primary key instead of every alert and broadcast row.
 */
const momentsSentSql = (kinds: readonly string[]) => `SELECT COUNT(*) AS n FROM meta
  WHERE (${kinds.map((kind) => `(key > 'broadcast:${kind}:' AND key < 'broadcast:${kind};')`).join(' OR ')})
    AND instr(key, '#') = 0 AND value >= 'sent:' || ?1 AND value < 'sent:' || ?2`;

export const MOMENTS_SENT_SQL = momentsSentSql(BUDGETED_MOMENTS);

export async function momentsSentOn(db: D1Database, day: string, kinds: readonly string[] = BUDGETED_MOMENTS): Promise<number> {
  const row = await db.prepare(momentsSentSql(kinds)).bind(day, addDays(day, 1)).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function knownIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (const chunk of chunks(ids, PARAM_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT message_id FROM messages WHERE message_id IN (${placeholders(chunk.length)})`)
      .bind(...chunk)
      .all<{ message_id: string }>();
    for (const r of results) known.add(r.message_id);
  }
  return known;
}

/** Ingest asks this every minute, so it must read one index entry, never the table (messages_source_send_ts). */
export const NEWEST_LIVE_ID_SQL = "SELECT message_id FROM messages WHERE source = 'live' ORDER BY send_ts DESC LIMIT 1";

export async function newestLiveId(db: D1Database): Promise<string | null> {
  const row = await db.prepare(NEWEST_LIVE_ID_SQL).first<{ message_id: string }>();
  return row?.message_id ?? null;
}

export function insertTokenStatement(db: D1Database, t: TokenRow): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO message_tokens (message_id, idx, chain, token, amount, usd_value) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(message_id, idx) DO NOTHING',
    )
    .bind(t.message_id, t.idx, t.chain, t.token, t.amount, t.usd_value);
}

/**
 * A list snapshot can be older than what the row already holds (a page read before the detail job stored SUCCESS), so a
 * stored SUCCESS is never replaced, and a stored FAILED is replaced only by SUCCESS or a newer FAILED: such a stale row
 * leaves status, receipt and manual-execution flag as they were.
 */
export async function upsertListRows(db: D1Database, rows: MessageRow[], tokens: TokenRow[]): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO messages (${MESSAGE_COLUMNS.join(', ')}) VALUES (${placeholders(MESSAGE_COLUMNS.length)})
     ON CONFLICT(message_id) DO UPDATE SET
       status = CASE WHEN messages.status = 'UNRESOLVED' AND excluded.status NOT IN ('SUCCESS', 'FAILED')
                     THEN messages.status ELSE excluded.status END,
       receipt_ts = COALESCE(excluded.receipt_ts, messages.receipt_ts),
       ready_for_manual_exec = excluded.ready_for_manual_exec
     WHERE NOT ((messages.status = 'SUCCESS' AND excluded.status <> 'SUCCESS')
             OR (messages.status = 'FAILED' AND excluded.status NOT IN ('SUCCESS', 'FAILED')))`,
  );
  await runBatch(db, [
    ...rows.map((r) => insert.bind(...MESSAGE_COLUMNS.map((c) => r[c]))),
    ...tokens.map((t) => insertTokenStatement(db, t)),
  ]);
}

export async function getPrices(db: D1Database, keys: string[], freshSinceIso?: string): Promise<Map<string, PriceInfo>> {
  return pricesSince(db, keys, 'ts', freshSinceIso);
}

/** Stored prices of the keys last seen at or after `seenSinceIso`, the ones the prices job still refreshes. */
export async function getPricesSeenSince(db: D1Database, keys: string[], seenSinceIso: string): Promise<Map<string, PriceInfo>> {
  return pricesSince(db, keys, 'seen_at', seenSinceIso);
}

async function pricesSince(
  db: D1Database,
  keys: string[],
  column: 'ts' | 'seen_at',
  sinceIso: string | undefined,
): Promise<Map<string, PriceInfo>> {
  const prices = new Map<string, PriceInfo>();
  const since = sinceIso === undefined ? '' : ` AND ${column} >= ?`;
  for (const chunk of chunks(keys, PARAM_CHUNK - 1)) {
    const { results } = await db
      .prepare(`SELECT llama_key, usd, decimals FROM prices_latest WHERE llama_key IN (${placeholders(chunk.length)})${since}`)
      .bind(...chunk, ...(sinceIso === undefined ? [] : [sinceIso]))
      .all<{ llama_key: string; usd: number; decimals: number }>();
    for (const r of results) prices.set(r.llama_key, { price: r.usd, decimals: r.decimals });
  }
  return prices;
}

export async function upsertPrices(db: D1Database, prices: Map<string, PriceInfo>, nowIso: string): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO prices_latest (llama_key, usd, decimals, ts, seen_at, symbol) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(llama_key) DO UPDATE SET usd = excluded.usd, decimals = excluded.decimals, ts = excluded.ts,
       symbol = COALESCE(excluded.symbol, prices_latest.symbol)`,
  );
  await runBatch(db, [...prices].map(([key, p]) => insert.bind(key, p.price, p.decimals, nowIso, nowIso, p.symbol ?? null)));
}

export async function touchPrices(db: D1Database, keys: string[], nowIso: string): Promise<void> {
  for (const chunk of chunks(keys, PARAM_CHUNK)) {
    await db
      .prepare(`UPDATE prices_latest SET seen_at = ? WHERE llama_key IN (${placeholders(chunk.length)})`)
      .bind(nowIso, ...chunk)
      .run();
  }
}

export async function keysSeenSince(db: D1Database, sinceIso: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT llama_key FROM prices_latest WHERE seen_at >= ? ORDER BY llama_key')
    .bind(sinceIso)
    .all<{ llama_key: string }>();
  return results.map((r) => r.llama_key);
}

export interface LiveRow {
  message_id: string;
  send_ts: string;
  status: string;
  src_chain: string;
  dst_chain: string;
  sender: string;
  usd_value: number;
  symbol: string | null;
  chain: string | null;
  token: string | null;
}

export async function liveSince(db: D1Database, sinceIso: string): Promise<LiveRow[]> {
  const { results } = await db
    .prepare(
      `SELECT m.message_id, m.send_ts, m.status, m.src_chain, m.dst_chain, m.sender, m.usd_value, t.symbol, mt.chain, mt.token
       FROM messages m
       LEFT JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0
       LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
       WHERE m.send_ts >= ?
       ORDER BY m.send_ts DESC
       LIMIT 500`,
    )
    .bind(sinceIso)
    .all<LiveRow>();
  return results;
}

export async function chainNames(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare('SELECT selector, name FROM chains').all<{ selector: string; name: string }>();
  return new Map(results.map((r) => [r.selector, r.name]));
}

export async function chainRefs(db: D1Database): Promise<Map<string, ChainRef>> {
  const { results } = await db
    .prepare('SELECT selector, name, chain_id, family FROM chains')
    .all<{ selector: string; name: string; chain_id: string; family: string }>();
  return new Map(results.map((r) => [r.selector, { selector: r.selector, name: r.name, chainId: r.chain_id, family: r.family }]));
}

const tokenKey = (chain: string, address: string) => `${chain}:${normalizeAddress(address)}`;

/** `count` (chain, address) matches, bound as chain then lowercase address; tokens_chain_lower_address serves each one. */
export const tokenAddressMatch = (count: number) => Array.from({ length: count }, () => '(chain = ? AND lower(address) = ?)').join(' OR ');

/** Symbols by `${chain}:${address}`: the CCIP registry's first, then DefiLlama's for the token's price key. */
export async function tokenSymbols(db: D1Database, tokens: { chain: string; address: string }[]): Promise<Map<string, string>> {
  const symbols = new Map<string, string>();
  const wanted = [...new Map(tokens.map((t) => [tokenKey(t.chain, t.address), t])).values()];
  for (const chunk of chunks(wanted, PARAM_CHUNK / 2)) {
    const { results } = await db
      .prepare(
        `SELECT chain, address, symbol FROM tokens WHERE ${tokenAddressMatch(chunk.length)}`,
      )
      .bind(...chunk.flatMap((t) => [t.chain, t.address.toLowerCase()]))
      .all<{ chain: string; address: string; symbol: string }>();
    for (const r of results) symbols.set(tokenKey(r.chain, r.address), r.symbol);
  }

  const unnamed = wanted.filter((t) => !symbols.has(tokenKey(t.chain, t.address)));
  if (unnamed.length === 0) return symbols;
  const refs = await chainRefs(db);
  const keyed = unnamed.flatMap((t) => {
    const ref = refs.get(t.chain);
    const key = ref === undefined ? null : llamaKey(ref, t.address);
    return key === null ? [] : [{ key, token: tokenKey(t.chain, t.address) }];
  });
  const tokenOfKey = new Map(keyed.map((k) => [k.key, k.token]));
  for (const chunk of chunks([...tokenOfKey.keys()], PARAM_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT llama_key, symbol FROM prices_latest WHERE symbol IS NOT NULL AND llama_key IN (${placeholders(chunk.length)})`)
      .bind(...chunk)
      .all<{ llama_key: string; symbol: string }>();
    for (const r of results) symbols.set(tokenOfKey.get(r.llama_key)!, r.symbol);
  }
  return symbols;
}

/** Registry token groups by `${chain}:${normalized address}`; null for a registry token without a group. */
export async function tokenGroupIds(db: D1Database, tokens: { chain: string; address: string }[]): Promise<Map<string, string | null>> {
  const groups = new Map<string, string | null>();
  const wanted = [...new Map(tokens.map((t) => [tokenKey(t.chain, t.address), t])).values()];
  for (const chunk of chunks(wanted, PARAM_CHUNK / 2)) {
    const { results } = await db
      .prepare(`SELECT chain, address, group_id FROM tokens WHERE ${tokenAddressMatch(chunk.length)}`)
      .bind(...chunk.flatMap((t) => [t.chain, t.address.toLowerCase()]))
      .all<{ chain: string; address: string; group_id: string | null }>();
    for (const r of results) groups.set(tokenKey(r.chain, r.address), r.group_id);
  }
  return groups;
}

/** Registry groups of `<selector>:<address>` keys, as tokenGroupIds returns them. */
export async function registryGroups(db: D1Database, keys: readonly string[]): Promise<Map<string, string | null>> {
  return tokenGroupIds(db, keys.map((k) => ({ chain: k.slice(0, k.indexOf(':')), address: k.slice(k.indexOf(':') + 1) })));
}

export async function firstTokenGroups(db: D1Database, tokens: readonly TokenRow[]): Promise<TokenGroupOf> {
  const first = tokens.filter((t) => t.idx === 0).map((t) => ({ chain: t.chain, address: t.token }));
  return tokenGroupLookup(await tokenGroupIds(db, first));
}

export async function messagesForDay(db: D1Database, day: string): Promise<MessageRow[]> {
  const { results } = await db.prepare('SELECT * FROM messages WHERE day = ?').bind(day).all<MessageRow>();
  return results;
}

export interface UnpricedLiveFee {
  messageId: string;
  fee: Fee;
  chain: ChainRef;
}

/** The day's detailed live messages that carry a fee with no USD value, with the source chain their price keys need. */
export async function unpricedLiveFees(db: D1Database, day: string): Promise<UnpricedLiveFee[]> {
  const { results } = await db
    .prepare(
      `SELECT m.message_id, m.fee_token, m.fee_amount, c.selector, c.name, c.chain_id, c.family
       FROM messages m JOIN chains c ON c.selector = m.src_chain
       WHERE m.day = ? AND m.source = 'live' AND m.fee_token IS NOT NULL AND m.fee_usd IS NULL AND m.detail_fetched_at IS NOT NULL`,
    )
    .bind(day)
    .all<{ message_id: string; fee_token: string; fee_amount: string; selector: string; name: string; chain_id: string; family: string }>();
  return results.map((r) => ({
    messageId: r.message_id,
    fee: { token: r.fee_token, amount: r.fee_amount },
    chain: { selector: r.selector, name: r.name, chainId: r.chain_id, family: r.family },
  }));
}

/** Sets a fee's USD value only on a row still unpriced with the same fee, so a priced or refilled row is never overwritten. */
export async function setUnpricedFeeUsd(db: D1Database, fees: { messageId: string; fee: Fee; feeUsd: number }[]): Promise<void> {
  await runBatch(
    db,
    fees.map(({ messageId, fee, feeUsd }) =>
      db
        .prepare('UPDATE messages SET fee_usd = ? WHERE message_id = ? AND fee_usd IS NULL AND fee_token = ? AND fee_amount = ?')
        .bind(feeUsd, messageId, fee.token, fee.amount),
    ),
  );
}

export async function tokensForDay(db: D1Database, day: string): Promise<TokenRow[]> {
  const { results } = await db
    .prepare('SELECT t.* FROM message_tokens t JOIN messages m ON m.message_id = t.message_id WHERE m.day = ?')
    .bind(day)
    .all<TokenRow>();
  return results;
}

export async function recentArrivals(db: D1Database, limit: number): Promise<{ kind: string; key: string; first_seen: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT kind, key, first_seen FROM arrivals
       WHERE kind <> 'sender' AND (announced_at IS NULL OR announced_at <> first_seen)
       ORDER BY first_seen DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ kind: string; key: string; first_seen: string }>();
  return results;
}

/** The keys among `keys` already recorded under `kind`. */
export async function existingArrivals(db: D1Database, kind: 'sender', keys: readonly string[]): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT key FROM arrivals WHERE kind = ?1 AND key IN (SELECT value FROM json_each(?2))')
    .bind(kind, JSON.stringify(keys))
    .all<{ key: string }>();
  return new Set(results.map((r) => r.key));
}

/** Sender arrivals from `sinceIso` on, oldest first. */
export async function senderArrivalsSince(db: D1Database, sinceIso: string): Promise<{ key: string; first_seen: string }[]> {
  const { results } = await db
    .prepare("SELECT key, first_seen FROM arrivals WHERE kind = 'sender' AND first_seen >= ? ORDER BY first_seen, key")
    .bind(sinceIso)
    .all<{ key: string; first_seen: string }>();
  return results;
}

/** Each address's first day with a message from it, on any chain the registry lists, through messages_sender. */
export const FIRST_SENDER_DAYS_SQL = `SELECT sender AS address, MIN(day) AS first_day FROM messages
  WHERE src_chain IN (SELECT selector FROM chains) AND sender IN (SELECT value FROM json_each(?1)) GROUP BY sender`;

export async function firstSenderDays(db: D1Database, addresses: readonly string[]): Promise<Map<string, string>> {
  const { results } = await db.prepare(FIRST_SENDER_DAYS_SQL).bind(JSON.stringify(addresses)).all<{ address: string; first_day: string }>();
  return new Map(results.map((r) => [r.address, r.first_day]));
}

export async function dueForDetail(db: D1Database, nowIso: string, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT message_id FROM messages WHERE next_check_at IS NOT NULL AND next_check_at <= ? ORDER BY next_check_at LIMIT ?')
    .bind(nowIso, limit)
    .all<{ message_id: string }>();
  return results.map((r) => r.message_id);
}

export async function liveNeedingDetail(db: D1Database, day: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT message_id FROM messages WHERE day = ? AND source = 'live' AND (detail_fetched_at IS NULL OR unpriced = 1) ORDER BY send_ts",
    )
    .bind(day)
    .all<{ message_id: string }>();
  return results.map((r) => r.message_id);
}

const FINAL_AGE_MS = 48 * 3_600_000;

/**
 * Retries a message's detail later after a failed fetch. A message no longer polled (next_check_at NULL, as for a final
 * SUCCESS that finalize re-fills) stays out of the queue.
 */
export async function pushBack(db: D1Database, messageId: string, untilIso: string, nowIso: string): Promise<void> {
  const cutoffIso = new Date(new Date(nowIso).getTime() - FINAL_AGE_MS).toISOString();
  await db
    .prepare(
      `UPDATE messages SET
         status = CASE WHEN send_ts <= ?1 AND status NOT IN ('SUCCESS', 'FAILED') THEN 'UNRESOLVED' ELSE status END,
         next_check_at = CASE WHEN send_ts <= ?1 OR next_check_at IS NULL THEN NULL ELSE ?2 END
       WHERE message_id = ?3`,
    )
    .bind(cutoffIso, untilIso, messageId)
    .run();
}

export async function applyDetail(db: D1Database, row: MessageRow, tokens: TokenRow[]): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE messages SET status = ?, receipt_ts = ?, ready_for_manual_exec = ?, token_count = ?, usd_value = ?,
           unpriced = ?, fee_token = ?, fee_amount = ?, fee_usd = ?, detail_fetched_at = ?, next_check_at = ?
         WHERE message_id = ?`,
      )
      .bind(
        row.status, row.receipt_ts, row.ready_for_manual_exec, row.token_count, row.usd_value, row.unpriced,
        row.fee_token, row.fee_amount, row.fee_usd, row.detail_fetched_at, row.next_check_at, row.message_id,
      ),
    db.prepare('DELETE FROM message_tokens WHERE message_id = ?').bind(row.message_id),
    ...tokens.map((t) => insertTokenStatement(db, t)),
  ]);
}

export async function countRows(db: D1Database, table: 'chains' | 'tokens'): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countArrivals(db: D1Database, kind: 'chain' | 'token' | 'lane' | 'sender'): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM arrivals WHERE kind = ?').bind(kind).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function upsertChains(db: D1Database, chains: NetworkInfo[], nowIso: string): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO chains (selector, name, display_name, family, chain_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(selector) DO UPDATE SET name = excluded.name, display_name = excluded.display_name,
       family = excluded.family, chain_id = excluded.chain_id, last_seen = excluded.last_seen`,
  );
  await runBatch(
    db,
    chains.map((ch) => insert.bind(ch.chainSelector, sanitize(ch.name), sanitize(ch.displayName ?? ch.name), ch.chainFamily, ch.chainId, nowIso, nowIso)),
  );
}

export async function upsertTokens(db: D1Database, tokens: NormalizedToken[], nowIso: string): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO tokens (chain, address, symbol, name, decimals, group_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chain, address) DO UPDATE SET symbol = excluded.symbol, name = excluded.name,
       decimals = excluded.decimals, group_id = excluded.group_id, last_seen = excluded.last_seen`,
  );
  await runBatch(db, tokens.map((t) => insert.bind(t.chain, t.address, t.symbol, t.name, t.decimals, t.groupId, nowIso, nowIso)));
}

/**
 * The CCIP token registry indexed for the price fallback. Tokens without a group are included too: the fallback's
 * CoinGecko step values them with their registry decimals.
 */
export async function tokenGroups(db: D1Database): Promise<TokenGroupIndex> {
  const { results } = await db
    .prepare(
      `SELECT t.chain, t.address, t.decimals, t.group_id, c.family, c.chain_id
       FROM tokens t LEFT JOIN chains c ON c.selector = t.chain`,
    )
    .all<{
      chain: string; address: string; decimals: number; group_id: string | null; family: string | null; chain_id: string | null;
    }>();
  return buildTokenGroupIndex(
    results.map((r) =>
      tokenGroupEntry(
        { chain: r.chain, address: r.address, decimals: r.decimals, groupId: r.group_id },
        r.family !== null && r.chain_id !== null ? { family: r.family, chainId: r.chain_id } : undefined,
      ),
    ),
  );
}

/** Registry tokens whose chain is known, with that chain's family and chain id, for mapping them to CoinGecko coins. */
export async function registryTokenChains(
  db: D1Database,
): Promise<(Pick<ChainRef, 'selector' | 'family' | 'chainId'> & { address: string })[]> {
  const { results } = await db
    .prepare('SELECT t.chain, t.address, c.family, c.chain_id FROM tokens t JOIN chains c ON c.selector = t.chain')
    .all<{ chain: string; address: string; family: string; chain_id: string }>();
  return results.map((r) => ({ selector: r.chain, address: r.address, family: r.family, chainId: r.chain_id }));
}

/** Stores today's mapping: upserts every id, then deletes the rows this refresh did not write. */
export async function replaceCoingeckoIds(
  db: D1Database,
  ids: { chain: string; address: string; coinId: string }[],
  nowIso: string,
): Promise<void> {
  const upsert = db.prepare(
    `INSERT INTO coingecko_ids (chain, address, coin_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(chain, address) DO UPDATE SET coin_id = excluded.coin_id, updated_at = excluded.updated_at`,
  );
  await runBatch(db, ids.map((id) => upsert.bind(id.chain, id.address, id.coinId, nowIso)));
  await db.prepare('DELETE FROM coingecko_ids WHERE updated_at <> ?').bind(nowIso).run();
}

export async function countCoingeckoIds(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM coingecko_ids').first<{ n: number }>();
  return row?.n ?? 0;
}

/** The registry tokens' CoinGecko coin ids, by chain selector and address. */
export async function coingeckoIds(db: D1Database): Promise<CoingeckoIdLookup> {
  const { results } = await db
    .prepare('SELECT chain, address, coin_id FROM coingecko_ids')
    .all<{ chain: string; address: string; coin_id: string }>();
  const byToken = new Map(results.map((r) => [`${r.chain}|${r.address}`, r.coin_id]));
  return (chain, address) => byToken.get(`${chain.selector}|${address}`);
}

export async function insertArrivals(
  db: D1Database,
  kind: 'chain' | 'token' | 'sender',
  keys: string[],
  nowIso: string,
  announcedAt: string | null,
): Promise<void> {
  const insert = db.prepare(
    'INSERT INTO arrivals (kind, key, first_seen, announced_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, key) DO NOTHING',
  );
  await runBatch(db, keys.map((key) => insert.bind(kind, key, nowIso, announcedAt)));
}

/**
 * The recent days' lanes. D1 keeps no table statistics, so without INDEXED BY SQLite walked all of messages_sender for the
 * GROUP BY: every message, every hour, to read two days.
 */
export const LANE_ARRIVALS_SQL = `INSERT INTO arrivals (kind, key, first_seen, announced_at)
  SELECT 'lane', src_chain || '>' || dst_chain, MIN(send_ts), CASE WHEN ?1 = 1 THEN MIN(send_ts) ELSE NULL END
  FROM messages INDEXED BY messages_day WHERE day >= ?2 GROUP BY src_chain, dst_chain
  ON CONFLICT(kind, key) DO NOTHING`;

export async function insertLaneArrivals(db: D1Database, sinceDay: string, baseline: boolean): Promise<void> {
  await db.prepare(LANE_ARRIVALS_SQL).bind(baseline ? 1 : 0, sinceDay).run();
}

export async function insertReserve(db: D1Database, ts: string, linkBalance: string): Promise<void> {
  await db
    .prepare('INSERT INTO reserve_snapshots (ts, link_balance) VALUES (?, ?) ON CONFLICT(ts) DO UPDATE SET link_balance = excluded.link_balance')
    .bind(ts, linkBalance)
    .run();
}

export async function reserveSeries(db: D1Database, sinceIso: string): Promise<{ ts: string; link_balance: string }[]> {
  const { results } = await db
    .prepare('SELECT ts, link_balance FROM reserve_snapshots WHERE ts >= ? ORDER BY ts')
    .bind(sinceIso)
    .all<{ ts: string; link_balance: string }>();
  return results;
}

export async function registryChains(db: D1Database): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT c.selector, c.name, c.display_name, c.family, c.chain_id, COALESCE(a.first_seen, c.first_seen) AS first_seen
       FROM chains c LEFT JOIN arrivals a ON a.kind = 'chain' AND a.key = c.selector ORDER BY c.name`,
    )
    .all<Record<string, unknown>>();
  return results;
}

export async function registryTokens(db: D1Database): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT t.chain, t.address, t.symbol, t.name, t.decimals, t.group_id, COALESCE(a.first_seen, t.first_seen) AS first_seen
       FROM tokens t LEFT JOIN arrivals a ON a.kind = 'token' AND a.key = t.chain || ':' || t.address
       ORDER BY t.symbol, t.chain`,
    )
    .all<Record<string, unknown>>();
  return results;
}

export async function countForDay(db: D1Database, day: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM messages WHERE day = ?').bind(day).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Runs in batches of BATCH_SIZE statements, so a failure after the first batch leaves the day partly replaced. */
export async function replaceDaily(db: D1Database, totals: DailyTotals, breakdown: DailyBreakdown[], computedAt: string): Promise<void> {
  try {
    await writeDaily(db, totals, breakdown, computedAt);
  } catch (err) {
    console.error(
      `replaceDaily for ${totals.day} failed, so its daily_totals and daily_breakdown rows may be partly replaced until the day is ` +
        `finalized again: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

async function writeDaily(db: D1Database, totals: DailyTotals, breakdown: DailyBreakdown[], computedAt: string): Promise<void> {
  const insertBreakdown = db.prepare(
    `INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd) VALUES (?, ?, ?, ?, ?, ?) ${BREAKDOWN_CONFLICT}`,
  );
  await runBatch(db, [
    db
      .prepare(
        `INSERT INTO daily_totals (day, messages, token_messages, data_messages, usd_value, fee_usd, unique_senders, median_delivery_s, unpriced_messages, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${TOTALS_CONFLICT}`,
      )
      .bind(
        totals.day, totals.messages, totals.token_messages, totals.data_messages ?? null, totals.usd_value, totals.fee_usd, totals.unique_senders,
        totals.median_delivery_s, totals.unpriced_messages, computedAt,
      ),
    db.prepare('DELETE FROM daily_breakdown WHERE day = ?').bind(totals.day),
    ...breakdown.map((b) => insertBreakdown.bind(b.day, b.dim, b.key, b.messages, b.usd_value, b.fee_usd)),
  ]);
}

export async function rolledUpDaysBefore(db: D1Database, before: string, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT day FROM daily_totals WHERE day < ? ORDER BY day DESC LIMIT ?')
    .bind(before, limit)
    .all<{ day: string }>();
  return results.map((r) => r.day);
}

export async function backfillViaTokenDay(db: D1Database, day: string): Promise<void> {
  await db.prepare(VIA_TOKEN_BACKFILL_DAY_SQL).bind(day).run();
}

export async function dailyHistory(db: D1Database): Promise<DailyTotals[]> {
  const { results } = await db
    .prepare(
      `SELECT day, messages, token_messages, data_messages, usd_value, fee_usd, unique_senders, median_delivery_s, unpriced_messages
       FROM daily_totals ORDER BY day`,
    )
    .all<DailyTotals>();
  return results;
}

export async function trailingUsdMedian(db: D1Database, day: string, days: number): Promise<number | null> {
  const { results } = await db
    .prepare('SELECT usd_value FROM daily_totals WHERE day < ?1 AND day >= ?2 ORDER BY usd_value')
    .bind(day, addDays(day, -days))
    .all<{ usd_value: number }>();
  if (results.length < MIN_MEDIAN_DAYS) return null;
  const mid = Math.floor(results.length / 2);
  const values = results.map((r) => r.usd_value);
  return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

export type TopOrder = 'value' | 'fees' | 'messages';

/** Each order ends on the key, so keys tied on every figure always rank the same way, per day and per window. */
const ORDER_COLUMNS: Record<TopOrder, string> = {
  value: 'usd_value DESC, messages DESC, key',
  fees: 'fee_usd DESC, usd_value DESC, key',
  messages: 'messages DESC, usd_value DESC, key',
};

/** By fees, a key with no fee data in the window has nothing to rank by, so it is left out. */
const TOP_ORDER_SQL: Record<TopOrder, string> = {
  value: `ORDER BY ${ORDER_COLUMNS.value}`,
  fees: `HAVING SUM(fee_usd) IS NOT NULL ORDER BY ${ORDER_COLUMNS.fees}`,
  messages: `ORDER BY ${ORDER_COLUMNS.messages}`,
};

export interface BreakdownRow {
  key: string;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

export interface LeaderRow extends BreakdownRow {
  day: string;
}

export async function topBetween(
  db: D1Database,
  dim: Dim,
  fromDay: string | null,
  toDay: string,
  limit: number,
  order: TopOrder,
): Promise<BreakdownRow[]> {
  const { results } = await db
    .prepare(
      `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
       FROM daily_breakdown WHERE dim = ? AND day >= ? AND day <= ?
       GROUP BY key ${TOP_ORDER_SQL[order]} LIMIT ?`,
    )
    .bind(dim, fromDay ?? '0000-00-00', toDay, limit)
    .all<BreakdownRow>();
  return results;
}

/** Each day's first row of `dim` in `order` over [fromDay, toDay]: for one day, the same ranking topBetween gives. */
export async function dailyLeaders(db: D1Database, dim: Dim, order: TopOrder, fromDay: string, toDay: string): Promise<LeaderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, key, messages, usd_value, fee_usd FROM (
         SELECT day, key, messages, usd_value, fee_usd, ROW_NUMBER() OVER (PARTITION BY day ORDER BY ${ORDER_COLUMNS[order]}) AS rn
         FROM daily_breakdown WHERE dim = ?1 AND day >= ?2 AND day <= ?3${order === 'fees' ? ' AND fee_usd IS NOT NULL' : ''}
       ) WHERE rn = 1 ORDER BY day`,
    )
    .bind(dim, fromDay, toDay)
    .all<LeaderRow>();
  return results;
}

export async function senderChains(db: D1Database): Promise<Map<string, SenderChain>> {
  const { results } = await db.prepare('SELECT selector, name, family FROM chains').all<{ selector: string; name: string; family: string }>();
  return new Map(results.map((r) => [r.selector, { name: r.name, family: r.family }]));
}

/** No LIMIT: a project's rows on every chain must all arrive before they merge and rank. */
export const SENDER_TOTALS_OF_SQL = `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
  FROM daily_breakdown WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 AND ${SENDER_ADDRESS} IN (SELECT value FROM json_each(?3))
  GROUP BY key ORDER BY key`;

export async function senderTotalsOf(db: D1Database, fromDay: string | null, toDay: string, addresses: readonly string[]): Promise<BreakdownRow[]> {
  const { results } = await db.prepare(SENDER_TOTALS_OF_SQL).bind(fromDay ?? '0000-00-00', toDay, JSON.stringify(addresses)).all<BreakdownRow>();
  return results;
}

export async function senderDaysOf(db: D1Database, fromDay: string, toDay: string, addresses: readonly string[]): Promise<LeaderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, key, messages, usd_value, fee_usd FROM daily_breakdown
       WHERE dim = 'sender' AND day >= ?1 AND day <= ?2 AND ${SENDER_ADDRESS} IN (SELECT value FROM json_each(?3)) ORDER BY day, key`,
    )
    .bind(fromDay, toDay, JSON.stringify(addresses))
    .all<LeaderRow>();
  return results;
}

/** An address's rank over its rows summed across chains; each order ends on the address, as ORDER_COLUMNS ends on the key. */
const ADDRESS_ORDER_SQL: Record<TopOrder, string> = {
  value: 'ORDER BY SUM(usd_value) DESC, SUM(messages) DESC, address',
  fees: 'HAVING SUM(fee_usd) IS NOT NULL ORDER BY SUM(fee_usd) DESC, SUM(usd_value) DESC, address',
  messages: 'ORDER BY SUM(messages) DESC, SUM(usd_value) DESC, address',
};

/**
 * The per-key rows of the ?4 busiest addresses outside the labeled list ?3 over [?1, ?2], net of the claimed keys ?5,
 * each address ranked by its rows summed across chains. A key with nothing left is dropped before the cut, so the ?4
 * are the busiest by what they keep.
 */
export const topUnlabeledSendersSql = (order: TopOrder) => `WITH rows AS (${unlabeledSenderRowsSql(false, '?5')}),
  net AS (
    SELECT key, address, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
    FROM rows GROUP BY key HAVING SUM(messages) > 0
  ),
  top AS (SELECT address FROM net GROUP BY address ${ADDRESS_ORDER_SQL[order]} LIMIT ?4)
  SELECT key, messages, usd_value, fee_usd FROM net WHERE address IN (SELECT address FROM top) ORDER BY key`;

export async function topUnlabeledSenders(
  db: D1Database,
  fromDay: string | null,
  toDay: string,
  labeled: readonly string[],
  limit: number,
  order: TopOrder,
  claimed: readonly string[],
): Promise<BreakdownRow[]> {
  const { results } = await db
    .prepare(topUnlabeledSendersSql(order))
    .bind(fromDay ?? '0000-00-00', toDay, JSON.stringify(labeled), limit, JSON.stringify(claimed))
    .all<BreakdownRow>();
  return results;
}

/** By messages, summed across chains and net of the claimed keys ?4, so a day's leader is one identity with every chain it sent from. */
export const DAILY_TOP_UNLABELED_SQL = `WITH rows AS (${unlabeledSenderRowsSql(true, '?4')}),
  net AS (
    SELECT day, key, address, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
    FROM rows GROUP BY day, key HAVING SUM(messages) > 0
  ),
  ranked AS (
    SELECT day, address, ROW_NUMBER() OVER (PARTITION BY day ORDER BY SUM(messages) DESC, SUM(usd_value) DESC, address) AS rn
    FROM net GROUP BY day, address
  )
  SELECT n.day, n.key, n.messages, n.usd_value, n.fee_usd FROM net n JOIN ranked k ON k.day = n.day AND k.address = n.address
  WHERE k.rn = 1 ORDER BY n.day, n.key`;

export async function dailyTopUnlabeledSenders(db: D1Database, fromDay: string, toDay: string, labeled: readonly string[], claimed: readonly string[]): Promise<LeaderRow[]> {
  const { results } = await db.prepare(DAILY_TOP_UNLABELED_SQL).bind(fromDay, toDay, JSON.stringify(labeled), JSON.stringify(claimed)).all<LeaderRow>();
  return results;
}

/** The claimed direct sends over the window as credit rows (see VIA_TOKEN_CREDITS_SQL); none, unread, when nothing is claimed. */
export async function viaTokenCreditsOf(db: D1Database, fromDay: string | null, toDay: string, claimed: readonly string[], labeled: readonly string[]): Promise<BreakdownRow[]> {
  if (claimed.length === 0) return [];
  const { results } = await db.prepare(VIA_TOKEN_CREDITS_SQL).bind(fromDay ?? '0000-00-00', toDay, JSON.stringify(claimed), JSON.stringify(labeled)).all<BreakdownRow>();
  return results;
}

export async function viaTokenCreditDays(db: D1Database, fromDay: string, toDay: string, claimed: readonly string[], labeled: readonly string[]): Promise<LeaderRow[]> {
  if (claimed.length === 0) return [];
  const { results } = await db.prepare(VIA_TOKEN_CREDIT_DAYS_SQL).bind(fromDay, toDay, JSON.stringify(claimed), JSON.stringify(labeled)).all<LeaderRow>();
  return results;
}

export interface WindowTotals {
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

export async function totalsBetween(db: D1Database, fromDay: string | null, toDay: string): Promise<WindowTotals> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(usd_value), 0) AS usd_value, SUM(fee_usd) AS fee_usd FROM daily_totals WHERE day >= ? AND day <= ?')
    .bind(fromDay ?? '0000-00-00', toDay)
    .first<WindowTotals>();
  return row ?? { messages: 0, usd_value: 0, fee_usd: null };
}

export async function messagesByDay(db: D1Database, fromDay: string, toDay: string): Promise<Map<string, number>> {
  const { results } = await db.prepare('SELECT day, messages FROM daily_totals WHERE day >= ? AND day <= ? ORDER BY day').bind(fromDay, toDay).all<{ day: string; messages: number }>();
  return new Map(results.map((r) => [r.day, r.messages]));
}

export interface SenderLaneRow {
  key: string;
  dst_chain: string;
  messages: number;
  usd_value: number;
  data_messages: number;
}

/** Messages by sender key and destination over [?1, ?2], for the keys in the JSON list ?3, with how many carried no tokens. */
export const SENDER_LANES_SQL = `WITH k AS (
    SELECT substr(value, 1, instr(value, ':') - 1) AS chain, substr(value, instr(value, ':') + 1) AS sender FROM json_each(?3)
  )
  SELECT m.src_chain || ':' || m.sender AS key, m.dst_chain, COUNT(*) AS messages, SUM(m.usd_value) AS usd_value,
    SUM(CASE WHEN m.token_count = 0 THEN 1 ELSE 0 END) AS data_messages
  FROM k JOIN messages m ON m.src_chain = k.chain AND m.sender = k.sender AND m.day >= ?1 AND m.day <= ?2
  GROUP BY m.src_chain, m.sender, m.dst_chain ORDER BY key, m.dst_chain`;

export async function senderLanes(db: D1Database, fromDay: string, toDay: string, keys: readonly string[]): Promise<SenderLaneRow[]> {
  const { results } = await db.prepare(SENDER_LANES_SQL).bind(fromDay, toDay, JSON.stringify(keys)).all<SenderLaneRow>();
  return results;
}

export interface FirstDayRow {
  key: string;
  first_day: string;
}

/** Each key's first day with a message, oldest first. */
export async function firstDays(db: D1Database, dim: 'lane' | 'token'): Promise<FirstDayRow[]> {
  const { results } = await db
    .prepare('SELECT key, MIN(day) AS first_day FROM daily_breakdown WHERE dim = ? GROUP BY key ORDER BY first_day, key')
    .bind(dim)
    .all<FirstDayRow>();
  return results;
}

/** The rows of `dim` over [fromDay, toDay], one per day and key. */
export async function breakdownBetween(db: D1Database, dim: Dim, fromDay: string, toDay: string): Promise<LeaderRow[]> {
  const { results } = await db
    .prepare('SELECT day, key, messages, usd_value, fee_usd FROM daily_breakdown WHERE dim = ? AND day >= ? AND day <= ? ORDER BY day, key')
    .bind(dim, fromDay, toDay)
    .all<LeaderRow>();
  return results;
}

export interface ChainWeekRow {
  key: string;
  /** The week's Monday. */
  week: string;
  messages: number;
}

/** Each chain's messages sent or received, by the Monday of their week, over [?1, ?2]; it reads only the window's chain rows. */
export const CHAIN_WEEK_MESSAGES_SQL = `SELECT key, date(day, '-' || ((CAST(strftime('%w', day) AS INTEGER) + 6) % 7) || ' days') AS week, SUM(messages) AS messages
  FROM daily_breakdown WHERE dim IN ('src_chain', 'dst_chain') AND day >= ?1 AND day <= ?2
  GROUP BY key, week ORDER BY week, key`;

export async function chainWeekMessages(db: D1Database, fromDay: string, toDay: string): Promise<ChainWeekRow[]> {
  const { results } = await db.prepare(CHAIN_WEEK_MESSAGES_SQL).bind(fromDay, toDay).all<ChainWeekRow>();
  return results;
}

/** The registry tokens of the given groups. */
export async function tokenGroupMembers(db: D1Database, groups: string[]): Promise<{ chain: string; address: string; group_id: string; symbol: string }[]> {
  const members: { chain: string; address: string; group_id: string; symbol: string }[] = [];
  for (const chunk of chunks([...new Set(groups)], PARAM_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT chain, address, group_id, symbol FROM tokens WHERE group_id IN (${placeholders(chunk.length)}) ORDER BY chain, address`)
      .bind(...chunk)
      .all<{ chain: string; address: string; group_id: string; symbol: string }>();
    members.push(...results);
  }
  return members;
}

export interface ReserveTransferRow {
  tx_hash: string;
  log_index: number;
  block_number: number;
  ts: string;
  direction: 'in' | 'out';
  counterparty: string;
  amount: string;
  link_usd: number | null;
}

export async function insertReserveTransfers(db: D1Database, transfers: ReserveTransfer[]): Promise<ReserveTransfer[]> {
  if (transfers.length === 0) return [];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reserve_transfers (tx_hash, log_index, block_number, ts, direction, counterparty, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const results = await db.batch(
    transfers.map((t) => insert.bind(t.txHash, t.logIndex, t.blockNumber, t.ts, t.direction, t.counterparty, t.amount)),
  );
  return transfers.filter((_, i) => (results[i]?.meta.changes ?? 0) > 0);
}

export async function reserveTransfers(db: D1Database): Promise<ReserveTransferRow[]> {
  const { results } = await db.prepare('SELECT * FROM reserve_transfers ORDER BY block_number, log_index').all<ReserveTransferRow>();
  return results;
}

export async function reserveOutflowsSince(
  db: D1Database,
  sinceIso: string,
): Promise<{ tx_hash: string; ts: string; counterparty: string; amount: string }[]> {
  const { results } = await db
    .prepare("SELECT tx_hash, ts, counterparty, amount FROM reserve_transfers WHERE direction = 'out' AND ts >= ? ORDER BY block_number, log_index")
    .bind(sinceIso)
    .all<{ tx_hash: string; ts: string; counterparty: string; amount: string }>();
  return results;
}

export async function unpricedReserveTransfers(db: D1Database, limit: number): Promise<{ tx_hash: string; log_index: number; ts: string }[]> {
  const { results } = await db
    .prepare('SELECT tx_hash, log_index, ts FROM reserve_transfers WHERE link_usd IS NULL ORDER BY block_number, log_index LIMIT ?')
    .bind(limit)
    .all<{ tx_hash: string; log_index: number; ts: string }>();
  return results;
}

export async function setReserveTransferPrices(
  db: D1Database,
  prices: { txHash: string; logIndex: number; linkUsd: number }[],
): Promise<void> {
  const update = db.prepare('UPDATE reserve_transfers SET link_usd = ? WHERE tx_hash = ? AND log_index = ?');
  await runBatch(db, prices.map((p) => update.bind(p.linkUsd, p.txHash, p.logIndex)));
}

export async function linkFeeTokens(db: D1Database): Promise<LinkFeeTokens> {
  const { results } = await db
    .prepare(
      `SELECT chain, address, group_id, decimals FROM tokens
       WHERE group_id IS NOT NULL AND group_id = (SELECT group_id FROM tokens WHERE chain = ? AND lower(address) = lower(?))`,
    )
    .bind(LINK_TOKEN_CHAIN_SELECTOR, LINK_TOKEN)
    .all<{ chain: string; address: string; group_id: string; decimals: number }>();
  return linkFeeKeys(results.map((r) => ({ chain: r.chain, address: r.address, groupId: r.group_id, decimals: r.decimals })));
}

export async function setFeeGroupTotals(db: D1Database, day: string, groups: FeeGroupTotals): Promise<void> {
  await db
    .prepare('UPDATE daily_totals SET fee_link_usd = ?, fee_native_usd = ?, fee_stable_usd = ?, fee_link_amount = ? WHERE day = ?')
    .bind(groups.link_usd, groups.native_usd, groups.stable_usd, groups.link_amount, day)
    .run();
}

export async function feeGroupsByDay(db: D1Database): Promise<Map<string, FeeGroupTotals>> {
  const { results } = await db
    .prepare('SELECT day, fee_link_usd, fee_native_usd, fee_stable_usd, fee_link_amount FROM daily_totals')
    .all<{ day: string; fee_link_usd: number | null; fee_native_usd: number | null; fee_stable_usd: number | null; fee_link_amount: number | null }>();
  return new Map(results.map((r) => [r.day, { link_usd: r.fee_link_usd, native_usd: r.fee_native_usd, stable_usd: r.fee_stable_usd, link_amount: r.fee_link_amount }]));
}

/** ORDER BY fee_usd alone, so idx_messages_fee_usd yields the rows in order and LIMIT stops the scan. */
export const LARGEST_FEES_SQL =
  'SELECT message_id, day, src_chain, dst_chain, fee_token, fee_usd FROM messages WHERE fee_usd IS NOT NULL AND day <= ? ORDER BY fee_usd DESC LIMIT ?';

export interface LargestFeeRow {
  message_id: string;
  day: string;
  src_chain: string;
  dst_chain: string;
  fee_token: string | null;
  fee_usd: number;
}

export async function largestFees(db: D1Database, throughDay: string, limit: number): Promise<LargestFeeRow[]> {
  const { results } = await db.prepare(LARGEST_FEES_SQL).bind(throughDay, limit).all<LargestFeeRow>();
  return results;
}

export interface FeeCostRow {
  src: string;
  dst: string;
  messages: number;
  link_messages: number;
  p10_usd: number;
  median_usd: number;
  p90_usd: number;
  link_median_usd: number | null;
  gas_median_usd: number | null;
}

/** A fee token as normalizeAddress stores it: a 42-character 0x address lowercased, any other address as it is. */
const NORMALIZED_FEE_TOKEN = "CASE WHEN fee_token LIKE '0x%' AND length(fee_token) = 42 THEN lower(fee_token) ELSE fee_token END";

/**
 * One row per route over days [?1, ?2] with at least ?3 priced fees: the nearest-rank 10th, 50th and 90th percentiles
 * (rank ceil(p·n/100), written (p·n + 99) / 100 in integer arithmetic), and the medians of the LINK-paid and other fees.
 * The LINK keys are inlined as literals because D1 caps a statement at 100 bound parameters.
 */
export function feeCostsSql(linkTokens: LinkFeeTokens): string {
  const keys = [...linkTokens.keys()].map(sqlLiteral).join(', ');
  return `WITH priced AS (
      SELECT src_chain, dst_chain, fee_usd,
        CASE WHEN (src_chain || ':' || ${NORMALIZED_FEE_TOKEN}) IN (${keys}) THEN 1 ELSE 0 END AS is_link
      FROM messages WHERE day >= ?1 AND day <= ?2 AND fee_usd IS NOT NULL
    ), ranked AS (
      SELECT src_chain, dst_chain, fee_usd, is_link,
        ROW_NUMBER() OVER (PARTITION BY src_chain, dst_chain ORDER BY fee_usd) AS rn,
        COUNT(*) OVER (PARTITION BY src_chain, dst_chain) AS n,
        ROW_NUMBER() OVER (PARTITION BY src_chain, dst_chain, is_link ORDER BY fee_usd) AS split_rn,
        COUNT(*) OVER (PARTITION BY src_chain, dst_chain, is_link) AS split_n,
        SUM(is_link) OVER (PARTITION BY src_chain, dst_chain) AS link_n
      FROM priced
    )
    SELECT src_chain AS src, dst_chain AS dst, MAX(n) AS messages, MAX(link_n) AS link_messages,
      MAX(CASE WHEN rn = (10 * n + 99) / 100 THEN fee_usd END) AS p10_usd,
      MAX(CASE WHEN rn = (50 * n + 99) / 100 THEN fee_usd END) AS median_usd,
      MAX(CASE WHEN rn = (90 * n + 99) / 100 THEN fee_usd END) AS p90_usd,
      MAX(CASE WHEN is_link = 1 AND split_rn = (50 * split_n + 99) / 100 THEN fee_usd END) AS link_median_usd,
      MAX(CASE WHEN is_link = 0 AND split_rn = (50 * split_n + 99) / 100 THEN fee_usd END) AS gas_median_usd
    FROM ranked
    WHERE n >= ?3
    GROUP BY src_chain, dst_chain
    ORDER BY messages DESC, src, dst`;
}

export async function feeCosts(db: D1Database, fromDay: string, toDay: string, linkTokens: LinkFeeTokens, minMessages: number): Promise<FeeCostRow[]> {
  const { results } = await db.prepare(feeCostsSql(linkTokens)).bind(fromDay, toDay, minMessages).all<FeeCostRow>();
  return results;
}

export async function laneHistory(db: D1Database): Promise<LaneDayRow[]> {
  const { results } = await db
    .prepare("SELECT day, key, messages, usd_value FROM daily_breakdown WHERE dim = 'lane' ORDER BY day, key")
    .all<LaneDayRow>();
  return results;
}

export async function chainDisplayNames(db: D1Database): Promise<Map<string, ChainNames>> {
  const { results } = await db
    .prepare('SELECT selector, name, display_name FROM chains')
    .all<{ selector: string; name: string | null; display_name: string | null }>();
  return new Map(results.map((r) => [r.selector, { name: r.name, display_name: r.display_name }]));
}
