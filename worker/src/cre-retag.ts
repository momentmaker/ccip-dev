import { addDays, CRE_FIRST_DAY, creRetagDaySql, dayOf } from '@ccip-dev/core';
import type { RunContext } from './context';
import * as store from './store';

/** After a key change, the days whose messages a new key may have signed before the PR merged. */
export const CRE_RETAG_DAYS = 30;
export const CRE_RETAG_DAYS_PER_RUN = 30;

const VERSION_KEY = 'cre_keys_version';
const PASS_KEY = 'cre_retag';

/** A pass walks back from `next` to `from`, one day per batch. */
interface RetagPass {
  version: string;
  next: string;
  from: string;
}

function parsePass(value: string | null): RetagPass | null {
  if (value === null) return null;
  const pass = JSON.parse(value) as Partial<RetagPass>;
  return typeof pass.version === 'string' && typeof pass.next === 'string' && typeof pass.from === 'string' ? (pass as RetagPass) : null;
}

/**
 * Brings every message's `cre` flag in line with the bundled key set. The first pass covers CRE's whole history; a new
 * key list re-covers the last CRE_RETAG_DAYS days. A pass whose version is no longer current restarts from today.
 */
export async function retagCre(c: RunContext, maxDays = CRE_RETAG_DAYS_PER_RUN): Promise<void> {
  const { version, keys } = c.creKeys;
  if (keys.size === 0) return;
  const db = c.env.DB;
  const done = await store.getMeta(db, VERSION_KEY);
  if (done === version) return;
  const today = dayOf(c.deps.now());
  const stored = parsePass(await store.getMeta(db, PASS_KEY));
  const pass: RetagPass =
    stored?.version === version ? stored : { version, next: today, from: done === null ? CRE_FIRST_DAY : addDays(today, -(CRE_RETAG_DAYS - 1)) };
  const retagSql = creRetagDaySql(c.creKeys);
  let day = pass.next;
  for (let n = 0; n < maxDays && day >= pass.from; n++, day = addDays(day, -1)) await store.retagCreDay(db, day, retagSql);
  if (day < pass.from) {
    await store.setMeta(db, VERSION_KEY, version);
    await store.setMeta(db, PASS_KEY, null);
  } else {
    await store.setMeta(db, PASS_KEY, JSON.stringify({ ...pass, next: day }));
  }
}
