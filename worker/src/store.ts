import type { MessageRow, PriceInfo, TokenRow } from '@ccip-dev/core';

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

export async function liveMissingDetail(db: D1Database, day: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT message_id FROM messages WHERE day = ? AND source = 'live' AND detail_fetched_at IS NULL ORDER BY send_ts")
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
