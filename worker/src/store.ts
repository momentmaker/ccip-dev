import {
  BREAKDOWN_CONFLICT, buildTokenGroupIndex, sanitize, tokenGroupEntry, TOTALS_CONFLICT, type ChainRef, type CoingeckoIdLookup,
  type DailyBreakdown, type DailyTotals, type Dim, type MessageRow, type NetworkInfo, type NormalizedToken, type PriceInfo,
  type ReserveTransfer, type TokenGroupIndex, type TokenRow,
} from '@ccip-dev/core';

const PARAM_CHUNK = 90;
const BATCH_SIZE = 100;

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

export async function newestLiveId(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT message_id FROM messages WHERE source = 'live' ORDER BY send_ts DESC LIMIT 1")
    .first<{ message_id: string }>();
  return row?.message_id ?? null;
}

export function insertTokenStatement(db: D1Database, t: TokenRow): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO message_tokens (message_id, idx, chain, token, amount, usd_value) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(message_id, idx) DO NOTHING',
    )
    .bind(t.message_id, t.idx, t.chain, t.token, t.amount, t.usd_value);
}

export async function upsertListRows(db: D1Database, rows: MessageRow[], tokens: TokenRow[]): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO messages (${MESSAGE_COLUMNS.join(', ')}) VALUES (${placeholders(MESSAGE_COLUMNS.length)})
     ON CONFLICT(message_id) DO UPDATE SET
       status = CASE WHEN messages.status = 'UNRESOLVED' AND excluded.status NOT IN ('SUCCESS', 'FAILED')
                     THEN messages.status ELSE excluded.status END,
       receipt_ts = COALESCE(excluded.receipt_ts, messages.receipt_ts),
       ready_for_manual_exec = excluded.ready_for_manual_exec`,
  );
  await runBatch(db, [
    ...rows.map((r) => insert.bind(...MESSAGE_COLUMNS.map((c) => r[c]))),
    ...tokens.map((t) => insertTokenStatement(db, t)),
  ]);
}

export async function getPrices(db: D1Database, keys: string[]): Promise<Map<string, PriceInfo>> {
  const prices = new Map<string, PriceInfo>();
  for (const chunk of chunks(keys, PARAM_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT llama_key, usd, decimals FROM prices_latest WHERE llama_key IN (${placeholders(chunk.length)})`)
      .bind(...chunk)
      .all<{ llama_key: string; usd: number; decimals: number }>();
    for (const r of results) prices.set(r.llama_key, { price: r.usd, decimals: r.decimals });
  }
  return prices;
}

export async function upsertPrices(db: D1Database, prices: Map<string, PriceInfo>, nowIso: string): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO prices_latest (llama_key, usd, decimals, ts, seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(llama_key) DO UPDATE SET usd = excluded.usd, decimals = excluded.decimals, ts = excluded.ts`,
  );
  await runBatch(db, [...prices].map(([key, p]) => insert.bind(key, p.price, p.decimals, nowIso, nowIso)));
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
}

export async function liveSince(db: D1Database, sinceIso: string): Promise<LiveRow[]> {
  const { results } = await db
    .prepare(
      `SELECT m.message_id, m.send_ts, m.status, m.src_chain, m.dst_chain, m.sender, m.usd_value, t.symbol
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

export async function messagesForDay(db: D1Database, day: string): Promise<MessageRow[]> {
  const { results } = await db.prepare('SELECT * FROM messages WHERE day = ?').bind(day).all<MessageRow>();
  return results;
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
       WHERE announced_at IS NULL OR announced_at <> first_seen
       ORDER BY first_seen DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ kind: string; key: string; first_seen: string }>();
  return results;
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

export async function pushBack(db: D1Database, messageId: string, untilIso: string, nowIso: string): Promise<void> {
  const cutoffIso = new Date(new Date(nowIso).getTime() - FINAL_AGE_MS).toISOString();
  await db
    .prepare(
      `UPDATE messages SET
         status = CASE WHEN send_ts <= ?1 AND status <> 'FAILED' THEN 'UNRESOLVED' ELSE status END,
         next_check_at = CASE WHEN send_ts <= ?1 THEN NULL ELSE ?2 END
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

export async function countArrivals(db: D1Database, kind: 'chain' | 'token' | 'lane'): Promise<number> {
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
  kind: 'chain' | 'token',
  keys: string[],
  nowIso: string,
  announcedAt: string | null,
): Promise<void> {
  const insert = db.prepare(
    'INSERT INTO arrivals (kind, key, first_seen, announced_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, key) DO NOTHING',
  );
  await runBatch(db, keys.map((key) => insert.bind(kind, key, nowIso, announcedAt)));
}

export async function insertLaneArrivals(db: D1Database, sinceDay: string, baseline: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO arrivals (kind, key, first_seen, announced_at)
       SELECT 'lane', src_chain || '>' || dst_chain, MIN(send_ts), CASE WHEN ?1 = 1 THEN MIN(send_ts) ELSE NULL END
       FROM messages WHERE day >= ?2 GROUP BY src_chain, dst_chain
       ON CONFLICT(kind, key) DO NOTHING`,
    )
    .bind(baseline ? 1 : 0, sinceDay)
    .run();
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

export async function replaceDaily(db: D1Database, totals: DailyTotals, breakdown: DailyBreakdown[], computedAt: string): Promise<void> {
  const insertBreakdown = db.prepare(
    `INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd) VALUES (?, ?, ?, ?, ?, ?) ${BREAKDOWN_CONFLICT}`,
  );
  await runBatch(db, [
    db
      .prepare(
        `INSERT INTO daily_totals (day, messages, token_messages, usd_value, fee_usd, unique_senders, median_delivery_s, unpriced_messages, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ${TOTALS_CONFLICT}`,
      )
      .bind(
        totals.day, totals.messages, totals.token_messages, totals.usd_value, totals.fee_usd, totals.unique_senders,
        totals.median_delivery_s, totals.unpriced_messages, computedAt,
      ),
    db.prepare('DELETE FROM daily_breakdown WHERE day = ?').bind(totals.day),
    ...breakdown.map((b) => insertBreakdown.bind(b.day, b.dim, b.key, b.messages, b.usd_value, b.fee_usd)),
  ]);
}

export async function dailyHistory(db: D1Database): Promise<DailyTotals[]> {
  const { results } = await db
    .prepare(
      `SELECT day, messages, token_messages, usd_value, fee_usd, unique_senders, median_delivery_s, unpriced_messages
       FROM daily_totals ORDER BY day`,
    )
    .all<DailyTotals>();
  return results;
}

export async function topBetween(
  db: D1Database,
  dim: Dim,
  fromDay: string | null,
  toDay: string,
  limit: number,
): Promise<{ key: string; messages: number; usd_value: number; fee_usd: number | null }[]> {
  const { results } = await db
    .prepare(
      `SELECT key, SUM(messages) AS messages, SUM(usd_value) AS usd_value, SUM(fee_usd) AS fee_usd
       FROM daily_breakdown WHERE dim = ? AND day >= ? AND day <= ?
       GROUP BY key ORDER BY usd_value DESC, messages DESC LIMIT ?`,
    )
    .bind(dim, fromDay ?? '0000-00-00', toDay, limit)
    .all<{ key: string; messages: number; usd_value: number; fee_usd: number | null }>();
  return results;
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
