import { PEG_MARKER_MIN_LINK, PEG_MARKER_MIN_VAULTS, type PegBar, type PegMarker, type PegMarkerEvent, type PegOpen, type PegSide } from '@ccip-dev/core';
import { chunks, runBatch } from './store';

const BAR_COLUMNS = 5;
/** D1 binds at most 100 parameters per statement. */
const PARAMS = 90;

export async function upsertPegHours(db: D1Database, bars: readonly PegBar[]): Promise<void> {
  const statements = chunks([...bars], Math.floor(PARAMS / BAR_COLUMNS)).map((chunk) =>
    db
      .prepare(
        `INSERT INTO peg_hours (hour, open, high, low, close) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT(hour) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close`,
      )
      .bind(...chunk.flatMap((b) => [b.hour, b.open, b.high, b.low, b.close])),
  );
  await runBatch(db, statements);
}

export async function pegHours(db: D1Database): Promise<PegBar[]> {
  const { results } = await db.prepare('SELECT hour, open, high, low, close FROM peg_hours ORDER BY hour').all<PegBar>();
  return results;
}

export interface PegEpisodeRow {
  id: number;
  side: PegSide;
  opened_at: string;
  closed_at: string | null;
  peak_gap: number;
  peak_at: string;
  best_size: number | null;
  best_profit: number | null;
  tier: number;
  public: number;
  public_at: string | null;
}

export interface PegEpisodeUpdate {
  peak_gap: number;
  peak_at: string;
  tier: number;
  public: boolean;
  public_at: string | null;
  best_size: number | null;
  best_profit: number | null;
  closed_at: string | null;
}

const EPISODE_COLUMNS = 'id, side, opened_at, closed_at, peak_gap, peak_at, best_size, best_profit, tier, public, public_at';

export async function openPegEpisode(db: D1Database): Promise<PegEpisodeRow | null> {
  return db.prepare(`SELECT ${EPISODE_COLUMNS} FROM peg_episodes WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`).first<PegEpisodeRow>();
}

export async function insertPegEpisode(db: D1Database, o: PegOpen): Promise<number> {
  const row = await db
    .prepare('INSERT INTO peg_episodes (side, opened_at, peak_gap, peak_at, tier, public) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(o.side, o.openedAt, o.peakGap, o.peakAt, o.tier, o.public ? 1 : 0)
    .first<{ id: number }>();
  if (row === null) throw new Error('Inserting a peg episode returned no id');
  return row.id;
}

export async function savePegEpisode(db: D1Database, id: number, f: PegEpisodeUpdate): Promise<void> {
  await db
    .prepare('UPDATE peg_episodes SET peak_gap = ?, peak_at = ?, tier = ?, public = ?, public_at = ?, best_size = ?, best_profit = ?, closed_at = ? WHERE id = ?')
    .bind(f.peak_gap, f.peak_at, f.tier, f.public ? 1 : 0, f.public_at, f.best_size, f.best_profit, f.closed_at, id)
    .run();
}

export async function recentPegEpisodes(db: D1Database, limit: number): Promise<PegEpisodeRow[]> {
  const { results } = await db.prepare(`SELECT ${EPISODE_COLUMNS} FROM peg_episodes ORDER BY id DESC LIMIT ?`).bind(limit).all<PegEpisodeRow>();
  return results;
}

export async function pegMarkerEvents(db: D1Database, afterBlock: number, throughBlock: number, limit: number): Promise<PegMarkerEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.block_number AS blockNumber, e.ts, e.kind, e.amount, h.kind AS holder
       FROM staking_events e LEFT JOIN staking_holders h ON h.address = e.staker
       WHERE e.block_number > ? AND e.block_number <= ? AND e.kind IN ('staked', 'unbonding')
       ORDER BY e.block_number, e.log_index LIMIT ?`,
    )
    .bind(afterBlock, throughBlock, limit)
    .all<PegMarkerEvent>();
  return results;
}

/** Adds the hours' sums and moves the cursor in one batch, so a retry never counts an event twice. */
export async function addPegMarkers(db: D1Database, markers: readonly PegMarker[], cursorBlock: number): Promise<void> {
  const upserts = markers.map((m) =>
    db
      .prepare(
        `INSERT INTO peg_markers (hour, kind, vaults, link) VALUES (?, ?, ?, ?)
         ON CONFLICT(hour, kind) DO UPDATE SET vaults = peg_markers.vaults + excluded.vaults,
           link = CASE WHEN excluded.link IS NULL THEN peg_markers.link ELSE COALESCE(peg_markers.link, 0) + excluded.link END`,
      )
      .bind(m.hour, m.kind, m.vaults, m.link),
  );
  const cursor = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('peg_marker_block', String(cursorBlock));
  await db.batch([...upserts, cursor]);
}

export async function pegMarkers(db: D1Database): Promise<PegMarker[]> {
  const { results } = await db
    .prepare(
      `SELECT hour, kind, vaults, link FROM peg_markers
       WHERE (kind = 'stakelink_unbonding' AND vaults >= ?) OR (kind = 'stakelink_deposit' AND link >= ?)
       ORDER BY hour`,
    )
    .bind(PEG_MARKER_MIN_VAULTS, PEG_MARKER_MIN_LINK)
    .all<PegMarker>();
  return results;
}
