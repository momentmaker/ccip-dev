import { pegLiveBody, readPegLive, type PegReading } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { PEG_ATTRIBUTION, pegConfig } from '../peg-config';
import { putJson, TTL } from '../publish';
import { balanceRpcUrls } from '../rpc';
import * as store from '../store';

export const PEG_RPC_ALERT_AFTER = 3;
/** stLINK is redeemable 1:1 in time, so a spot this far off is a bad read, not a market. */
export const SANE_SPOT = { min: 0.5, max: 1.5 } as const;

export async function runPeg(c: RunContext): Promise<void> {
  const reading = await readOrCount(c);
  if (reading === null) return;
  if (!(reading.spot > SANE_SPOT.min && reading.spot < SANE_SPOT.max)) {
    await c.alert('peg-bad-read', `The stLINK peg read a spot of ${reading.spot} LINK, outside ${SANE_SPOT.min}–${SANE_SPOT.max}; the sample was dropped`);
    return;
  }
  await askForMintCapCheck(c, reading);
  const live = pegLiveBody(reading);
  const { thresholds } = pegConfig(c.env);
  await putJson(c.env.PUBLIC, 'peg.json', { attribution: PEG_ATTRIBUTION, thresholds, ...live, episode: null, recent_episodes: [] }, TTL.peg, c.deps.now());
}

async function readOrCount(c: RunContext): Promise<PegReading | null> {
  const db = c.env.DB;
  try {
    const reading = await readPegLive(c.deps, balanceRpcUrls(c.env));
    await store.setMeta(db, 'peg_failures', '0');
    return reading;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failures = Number((await store.getMeta(db, 'peg_failures')) ?? '0') + 1;
    await store.setMeta(db, 'peg_failures', String(failures));
    console.warn(`stLINK peg read failed (${failures} in a row): ${message}`);
    if (failures >= PEG_RPC_ALERT_AFTER) await c.alert('peg-rpc', `The stLINK peg read has failed ${failures} times in a row: ${message}`);
    return null;
  }
}

/** The instant-mint cap was read from the contract, not simulated, because the pool had no room at the time; see the runbook. */
async function askForMintCapCheck(c: RunContext, r: PegReading): Promise<void> {
  if (r.canDeposit <= 0 || (await store.getMeta(c.env.DB, 'peg_mint_cap_checked')) !== null) return;
  await c.alert('peg-mint-check', `StakingPool.canDeposit() is ${r.canDeposit.toFixed(2)} LINK for the first time: run the runbook's "stLINK peg: mint capacity check"`);
  await store.setMeta(c.env.DB, 'peg_mint_cap_checked', c.deps.now().toISOString());
}
