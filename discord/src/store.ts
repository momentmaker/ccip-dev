import type { Tier } from '@ccip-dev/core/linkmarine';
import { MAX_CLASHES, type Draw } from './draw';

export interface MarineMeme {
  tag: string;
  file: string;
  key: string;
  /** The tag's SFW memes when the Marine was drawn: the card's pips and "N memes" never change. Absent on the first Marines' rows. */
  count?: number;
  /** The archive commit the Marine was drawn under, which the meme is copied from. Absent on the first Marines' rows. */
  sha?: string;
}

export interface Marine {
  serial: number;
  platform: string;
  userId: string;
  callsign: string;
  tags: string[];
  tier: Tier;
  score: number;
  percentile: number;
  memes: MarineMeme[];
  blood: string;
  faith: string;
  displayName: string;
  snapshotVersion: number;
  enlistedAt: string;
  cardKey: string | null;
}

interface MarineRow {
  serial: number;
  platform: string;
  user_id: string;
  callsign: string;
  tags: string;
  tier: Tier;
  score: number;
  percentile: number;
  memes: string;
  blood: string;
  faith: string;
  display_name: string;
  snapshot_version: number;
  enlisted_at: string;
  card_key: string | null;
}

const toMarine = (r: MarineRow): Marine => ({
  serial: r.serial,
  platform: r.platform,
  userId: r.user_id,
  callsign: r.callsign,
  tags: JSON.parse(r.tags) as string[],
  tier: r.tier,
  score: r.score,
  percentile: r.percentile,
  memes: JSON.parse(r.memes) as MarineMeme[],
  blood: r.blood,
  faith: r.faith,
  displayName: r.display_name,
  snapshotVersion: r.snapshot_version,
  enlistedAt: r.enlisted_at,
  cardKey: r.card_key,
});

export async function findMarine(db: D1Database, platform: string, userId: string): Promise<Marine | null> {
  const row = await db.prepare('SELECT * FROM marines WHERE platform = ? AND user_id = ?').bind(platform, userId).first<MarineRow>();
  return row ? toMarine(row) : null;
}

export interface Recruit {
  platform: string;
  userId: string;
  displayName: string;
  enlistedAt: string;
  snapshotVersion: number;
}

export interface Drafted {
  draw: Draw;
  memes: MarineMeme[];
  blood: string;
  faith: string;
}

export type EnlistResult = { kind: 'enlisted'; marine: Marine } | { kind: 'already'; marine: Marine } | { kind: 'clashed' };

/**
 * Enlists once: a Marine already on record is returned as is. A callsign whose tags another Marine holds, in any order,
 * is drawn again, up to MAX_CLASHES times. A clash is looked up before inserting to skip a failed round trip; serials
 * stay dense because AUTOINCREMENT advances sqlite_sequence only on a successful insert, so a true race that fails on
 * tag_key is redrawn without a gap. beforeInsert lets a test interleave two enlistments. Two enlistments at once meet at UNIQUE (platform,
 * user_id): the second finds the first's record.
 */
export async function enlist(db: D1Database, recruit: Recruit, draft: () => Drafted, beforeInsert: () => Promise<void> = async () => {}): Promise<EnlistResult> {
  const existing = await findMarine(db, recruit.platform, recruit.userId);
  if (existing) return { kind: 'already', marine: existing };
  const taken = db.prepare('SELECT 1 FROM marines WHERE tag_key = ?');
  const insert = db.prepare(
    `INSERT INTO marines (platform, user_id, callsign, tag_key, tags, tier, score, percentile, memes, blood, faith, display_name, snapshot_version, enlisted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) RETURNING *`,
  );
  for (let attempt = 0; attempt < MAX_CLASHES; attempt++) {
    const d = draft();
    if (await taken.bind(d.draw.tagKey).first()) continue;
    await beforeInsert();
    try {
      const row = await insert
        .bind(recruit.platform, recruit.userId, d.draw.callsign, d.draw.tagKey, JSON.stringify(d.draw.tags), d.draw.tier, d.draw.score, d.draw.percentile, JSON.stringify(d.memes), d.blood, d.faith, recruit.displayName, recruit.snapshotVersion, recruit.enlistedAt)
        .first<MarineRow>();
      if (row) return { kind: 'enlisted', marine: toMarine(row) };
    } catch (err) {
      const raced = await findMarine(db, recruit.platform, recruit.userId);
      if (raced) return { kind: 'already', marine: raced };
      if (!String(err).includes('marines.tag_key')) throw err;
    }
  }
  return { kind: 'clashed' };
}

export async function setCardKey(db: D1Database, serial: number, key: string): Promise<void> {
  await db.prepare('UPDATE marines SET card_key = ? WHERE serial = ?').bind(key, serial).run();
}

/** Claims a `meta` key for `ttlMs`: false while an earlier claim is younger. The values are ISO times, which compare as text. */
export async function claimMeta(db: D1Database, key: string, nowMs: number, ttlMs: number): Promise<boolean> {
  const res = await db
    .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?3')
    .bind(key, new Date(nowMs).toISOString(), new Date(nowMs - ttlMs).toISOString())
    .run();
  return res.meta.changes > 0;
}
