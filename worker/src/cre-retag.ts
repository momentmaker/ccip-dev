import { addDays, CRE_FIRST_DAY, creRetagDaySql, dayOf } from '@ccip-dev/core';
import type { RunContext } from './context';
import { isFinalizeHour } from './schedule';
import * as store from './store';

/** After a key change, the days whose messages a new key may have signed before the PR merged. */
export const CRE_RETAG_DAYS = 30;
export const CRE_RETAG_DAYS_PER_RUN = 30;

/** Bump when the re-tag starts writing something new for every day, so one full pass backfills it. */
export const CRE_RETAG_SCHEMA = 2;
const SCHEMA_KEY = 'cre_retag_schema';
const VERSION_KEY = 'cre_keys_version';
const PASS_KEY = 'cre_retag';

/** A pass walks back from `next` to `from`, one day per batch. */
interface RetagPass {
  version: string;
  next: string;
  from: string;
}

/** A stored value that is not a pass (corrupt JSON, `null`, missing fields) counts as no pass, so a fresh one starts. */
function parsePass(value: string | null): RetagPass | null {
  if (value === null) return null;
  let pass: Partial<RetagPass> | null;
  try {
    pass = JSON.parse(value) as Partial<RetagPass> | null;
  } catch {
    return null;
  }
  if (pass === null || typeof pass !== 'object') return null;
  return typeof pass.version === 'string' && typeof pass.next === 'string' && typeof pass.from === 'string' ? (pass as RetagPass) : null;
}

/**
 * Brings every message's `cre` flag in line with the bundled key set. The first pass covers CRE's whole history, and so
 * does a new CRE_RETAG_SCHEMA; a new key list re-covers the last CRE_RETAG_DAYS days. A pass whose version is no longer current restarts from today. Each
 * day's progress is saved with the day's batch. It sits out the hours a finalize rewrites days, which would otherwise
 * build a day's cre rows from flags this step is changing.
 */
export async function retagCre(c: RunContext, maxDays = CRE_RETAG_DAYS_PER_RUN): Promise<void> {
  const { version, keys } = c.creKeys;
  if (keys.size === 0 || isFinalizeHour(c.deps.now())) return;
  const db = c.env.DB;
  const schema = String(CRE_RETAG_SCHEMA);
  const done = await store.getMeta(db, VERSION_KEY);
  const doneSchema = await store.getMeta(db, SCHEMA_KEY);
  if (done === version && doneSchema === schema) return;
  const passVersion = `${version}#${schema}`;
  const today = dayOf(c.deps.now());
  const full = done === null || doneSchema !== schema;
  const stored = parsePass(await store.getMeta(db, PASS_KEY));
  const pass: RetagPass =
    stored?.version === passVersion ? stored : { version: passVersion, next: today, from: full ? CRE_FIRST_DAY : addDays(today, -(CRE_RETAG_DAYS - 1)) };
  const retagSql = creRetagDaySql(c.creKeys);
  let day = pass.next;
  for (let n = 0; n < maxDays && day >= pass.from; n++, day = addDays(day, -1)) {
    await store.retagCreDay(db, day, retagSql, PASS_KEY, JSON.stringify({ ...pass, next: addDays(day, -1) }));
  }
  if (day < pass.from) {
    await store.setMeta(db, VERSION_KEY, version);
    await store.setMeta(db, SCHEMA_KEY, schema);
    await store.setMeta(db, PASS_KEY, null);
  }
}
