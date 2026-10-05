import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakeCcip, fakePrices, listMessage } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { build } from '../backfill/build';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY = `base:${TOKEN}`;
const NOW = new Date('2026-10-08T00:00:00.000Z');
const today1 = listMessage({ id: 'today1', sendTs: '2026-10-08T01:00:00.000Z' });
const a2 = listMessage({ id: 'a2', sendTs: '2026-10-06T12:00:00.000Z', token: { address: TOKEN, amount: '5000000' } });
const a1 = listMessage({ id: 'a1', sendTs: '2026-10-06T01:00:00.000Z' });
const b1 = listMessage({ id: 'b1', sendTs: '2026-10-05T10:00:00.000Z' });
const c1 = listMessage({ id: 'c1', sendTs: '2026-10-04T23:00:00.000Z' });

const pricesAt = (price: number) => fakePrices({ latest: { [KEY]: { price, decimals: 6 } }, history: { [KEY]: { '2026-10-06': price } } });

async function crawlDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'backfill-sql-'));
  await mkdir(path.join(dir, 'pages'));
  await writeFile(path.join(dir, 'pages', '00000.json'), JSON.stringify([today1, a2, a1, b1, c1]));
  await writeFile(path.join(dir, 'coverage.json'), JSON.stringify({ coverage_from: c1.sendTimestamp, complete: true, stopped_at_depth_wall: true }));
  return dir;
}

async function applyAll(db: DatabaseSync, dir: string): Promise<void> {
  const files = (await readdir(path.join(dir, 'sql'))).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) db.exec(await readFile(path.join(dir, 'sql', file), 'utf8'));
}

function snapshot(db: DatabaseSync, id: string): { message: unknown; tokens: unknown[] } {
  return {
    message: db.prepare('SELECT * FROM messages WHERE message_id = ?').get(id),
    tokens: db.prepare('SELECT * FROM message_tokens WHERE message_id = ? ORDER BY 1, 2').all(id),
  };
}

describe('backfill SQL against a real database', () => {
  it('updates backfill rows and leaves live rows untouched across a rebuild', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(await readFile(path.resolve(import.meta.dirname, '../../worker/migrations/0001_init.sql'), 'utf8'));

    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: pricesAt(2), registry: fakeCcip(), now: () => NOW });
    const scratch = new DatabaseSync(':memory:');
    scratch.exec(await readFile(path.resolve(import.meta.dirname, '../../worker/migrations/0001_init.sql'), 'utf8'));
    await applyAll(scratch, dir);
    const columns = scratch.prepare('SELECT * FROM messages WHERE message_id = ?').get('a2') as Record<string, unknown>;
    const tokenColumns = scratch.prepare('SELECT * FROM message_tokens WHERE message_id = ?').get('a2') as Record<string, unknown>;

    const liveMessage = { ...columns, source: 'live', fee_usd: 0.123456, usd_value: 777.5 };
    const liveToken = { ...tokenColumns, usd_value: 777.5 };
    const insert = (table: string, row: Record<string, unknown>) =>
      db
        .prepare(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`)
        .run(...(Object.values(row) as never[]));
    insert('messages', liveMessage);
    insert('message_tokens', liveToken);
    const liveBefore = snapshot(db, 'a2');

    await applyAll(db, dir);
    expect(snapshot(db, 'a2')).toEqual(liveBefore);
    expect(db.prepare("SELECT source FROM messages WHERE message_id IN ('a1','b1') ORDER BY message_id").all()).toEqual([
      { source: 'backfill' },
      { source: 'backfill' },
    ]);
    const totalOn = () => (db.prepare("SELECT usd_value FROM daily_totals WHERE day = '2026-10-06'").get() as { usd_value: number }).usd_value;
    const firstTotal = totalOn();

    const rebuilt = await crawlDir();
    await build({ dir: rebuilt, liveStartDay: '2026-10-08', prices: pricesAt(50), registry: fakeCcip(), now: () => NOW });
    await applyAll(db, rebuilt);
    expect(snapshot(db, 'a2')).toEqual(liveBefore);
    expect(totalOn()).toBeGreaterThan(firstTotal);
    expect(db.prepare("SELECT source FROM messages WHERE message_id = 'a1'").get()).toEqual({ source: 'backfill' });
  });
});
