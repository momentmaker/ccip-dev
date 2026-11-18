import { CLASSIFY_BATCH, classifyStakers, readBlockNumber, readStakingChain, readStakingEvents, STAKING_FIRST_BLOCK, stakerRows, stakingStats } from '@ccip-dev/core';
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
  const classified = await classifyNewStakers(c);
  await reclassifyStaleHolders(c);
  if (scannedTo === null) return;
  if (!classified) {
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

/**
 * Classifies the stakers first seen since the classified cursor and moves the cursor to the scanned block. Returns whether
 * every staker is classified; a failure keeps the batches saved so far and leaves the rest for the next hour.
 */
export async function classifyNewStakers(c: RunContext): Promise<boolean> {
  const db = c.env.DB;
  try {
    const scanned = await store.getMeta(db, 'staking_scan_block');
    if (scanned === null) return true;
    const from = (await store.stakersClassifiedTo(db)) ?? 0;
    if (from >= Number(scanned)) return true;
    const { addresses, complete } = await store.unclassifiedStakers(db, from, CLASSIFY_PER_RUN);
    await classifyAndSave(c, addresses);
    if (!complete) return false;
    await store.setMeta(db, store.STAKING_CLASSIFIED_KEY, scanned);
    return true;
  } catch (err) {
    console.warn(`Staker classification failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Checks holders again once their classification is RECLASSIFY_AFTER_DAYS old, oldest first. */
export async function reclassifyStaleHolders(c: RunContext): Promise<void> {
  try {
    const staleBefore = new Date(c.deps.now().getTime() - RECLASSIFY_AFTER_DAYS * DAY_MS).toISOString();
    await classifyAndSave(c, await store.staleHolders(c.env.DB, staleBefore, CLASSIFY_PER_RUN));
  } catch (err) {
    console.warn(`Staker reclassification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function classifyAndSave(c: RunContext, addresses: readonly string[]): Promise<void> {
  const checkedAt = c.deps.now().toISOString();
  for (let i = 0; i < addresses.length; i += CLASSIFY_BATCH) {
    const kinds = await classifyStakers(c.deps, logRpcUrls(c.env), addresses.slice(i, i + CLASSIFY_BATCH));
    await store.upsertStakingHolders(c.env.DB, kinds, checkedAt);
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
