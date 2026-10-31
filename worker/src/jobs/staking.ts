import { classifyStakers, readBlockNumber, readStakingChain, readStakingEvents, STAKING_FIRST_BLOCK, stakerRows, stakingStats } from '@ccip-dev/core';
import { STAKER_SHARDS, stakerShard, type StakersFile, type StakingFile } from '@ccip-dev/core/public';
import { broadcastStaking } from '../broadcasts/run';
import type { RunContext } from '../context';
import operatorNames from '../generated/staking-operators.json';
import { ATTRIBUTION, putJson, SCHEMA_VERSION, TTL } from '../publish';
import { logRpcUrls } from '../rpc';
import * as store from '../store';
import { CHUNK_BLOCKS, CONFIRMATIONS, SCAN_BUDGET_MS } from './reserve';

/** The backfill from the first v0.2 block takes about 770 chunks; most hold a handful of logs, so a run can take many. */
export const MAX_CHUNKS_PER_RUN = 250;
export const CLASSIFY_PER_RUN = 3_000;
/** A wallet can take EIP-7702 code, so holders are checked again after this long. */
export const RECLASSIFY_AFTER_DAYS = 30;
const SCAN_ALERT_AFTER = 3;
const DAY_MS = 86_400_000;

export const STAKING_OPERATOR_NAMES: Readonly<Record<string, string>> = operatorNames;

/** Scans both staking pools hourly, classifies new stakers and, once both are complete, publishes staking.json and the stakers files. */
export async function runStaking(c: RunContext): Promise<void> {
  const scannedTo = await scanStaking(c);
  await classifyNewStakers(c);
  if (scannedTo === null) return;
  if (await store.hasUnclassifiedStakers(c.env.DB)) {
    console.warn('Staking files wait for every staker to be classified');
    return;
  }
  await broadcastStaking(c, await publishStaking(c, scannedTo));
}

/** The block the events are complete to, or null while backfilling or after a failed scan. */
export async function scanStaking(c: RunContext): Promise<number | null> {
  const db = c.env.DB;
  try {
    const deadline = c.deps.now().getTime() + SCAN_BUDGET_MS;
    const urls = logRpcUrls(c.env);
    let cursor = Number((await store.getMeta(db, 'staking_scan_block')) ?? STAKING_FIRST_BLOCK - 1);
    const head = (await readBlockNumber(c.deps, urls)) - CONFIRMATIONS;
    for (let chunk = 0; chunk < MAX_CHUNKS_PER_RUN && cursor < head && c.deps.now().getTime() < deadline; chunk++) {
      const to = Math.min(cursor + CHUNK_BLOCKS, head);
      await store.insertStakingEvents(db, await readStakingEvents(c.deps, urls, cursor + 1, to));
      cursor = to;
      await store.setMeta(db, 'staking_scan_block', String(cursor));
    }
    await store.setMeta(db, 'staking_scan_failures', '0');
    if (cursor < head) return null;
    await store.setMeta(db, 'staking_scan_caught_up', '1');
    return cursor;
  } catch (err) {
    await recordScanFailure(c, err);
    return null;
  }
}

async function recordScanFailure(c: RunContext, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`Staking scan failed: ${message}`);
  try {
    const failures = Number((await store.getMeta(c.env.DB, 'staking_scan_failures')) ?? '0') + 1;
    await store.setMeta(c.env.DB, 'staking_scan_failures', String(failures));
    if (failures >= SCAN_ALERT_AFTER) await c.alert('staking-scan', `Staking scan failed ${failures} hours in a row: ${message}`);
  } catch (metaErr) {
    console.warn(`Staking scan failure could not be recorded: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
  }
}

/** Classifies stakers never seen, then stale ones. A failure leaves them for the next hour. */
export async function classifyNewStakers(c: RunContext): Promise<void> {
  const now = c.deps.now();
  try {
    const staleBefore = new Date(now.getTime() - RECLASSIFY_AFTER_DAYS * DAY_MS).toISOString();
    const addresses = await store.stakersToClassify(c.env.DB, staleBefore, CLASSIFY_PER_RUN);
    if (addresses.length === 0) return;
    await store.upsertStakingHolders(c.env.DB, await classifyStakers(c.deps, logRpcUrls(c.env), addresses), now.toISOString());
  } catch (err) {
    console.warn(`Staker classification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Publishes staking.json and the stakers files, and returns staking.json as published. */
export async function publishStaking(c: RunContext, asOfBlock: number): Promise<StakingFile> {
  const db = c.env.DB;
  const now = c.deps.now();
  const [events, holders, chain] = await Promise.all([store.stakingEvents(db), store.stakingHolders(db), readStakingChain(c.deps, logRpcUrls(c.env))]);
  if (events.length === 0) throw new Error('The staking scan is complete but found no events');
  const body = stakingStats({ events, chain, holders, names: STAKING_OPERATOR_NAMES, now, asOfBlock });
  await putJson(c.env.PUBLIC, 'staking.json', body, TTL.staking, now);
  const shards = new Map<string, StakersFile['stakers']>(STAKER_SHARDS.map((h) => [`stakers/${h}.json`, []]));
  for (const row of stakerRows({ events, holders, chain })) shards.get(stakerShard(row[0]))!.push(row);
  for (const [name, stakers] of shards) await putJson(c.env.PUBLIC, name, { as_of_block: asOfBlock, stakers }, TTL.staking, now);
  return { schema_version: SCHEMA_VERSION, updated_at: now.toISOString(), attribution: ATTRIBUTION, ...body };
}
