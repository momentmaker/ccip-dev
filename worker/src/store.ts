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
