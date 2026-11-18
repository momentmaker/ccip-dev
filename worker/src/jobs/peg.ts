import { pegLiveBody, readPegLive, stepPeg, type PegEvent, type PegLiveBody, type PegMachine, type PegOpen, type PegReading, type PegSample, type PegThresholds } from '@ccip-dev/core';
import type { PegEpisodeView } from '@ccip-dev/core/public';
import { broadcastSafely } from '../broadcasts/run';
import type { RunContext } from '../context';
import { pegAlertText } from '../peg-copy';
import { PEG_ATTRIBUTION, pegConfig } from '../peg-config';
import * as pegStore from '../peg-store';
import { putJson, TTL } from '../publish';
import { balanceRpcUrls } from '../rpc';
import * as store from '../store';
import { sendTelegramMessage } from '../telegram';

export const PEG_RPC_ALERT_AFTER = 3;
/** A previous sample older than this is not "in a row" with the next: a skipped run must not confirm an episode. */
export const PEG_PREV_MAX_AGE_MS = 15 * 60_000;
export const PEG_RECENT = 10;
const PREV_KEY = 'peg_prev';
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
  const config = pegConfig(c.env);
  const { episodes } = await advanceEpisodes(c, live, config);
  await putJson(
    c.env.PUBLIC,
    'peg.json',
    { attribution: PEG_ATTRIBUTION, thresholds: config.thresholds, ...live, episode: episodes.find((e) => e.closed_at === null) ?? null, recent_episodes: episodes },
    TTL.peg,
    c.deps.now(),
  );
  await broadcastSafely(c, { kind: 'peg', live, episodes });
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

export function episodeView(row: pegStore.PegEpisodeRow): PegEpisodeView {
  return {
    id: row.id, side: row.side, opened_at: row.opened_at, closed_at: row.closed_at, peak_gap: row.peak_gap, peak_at: row.peak_at,
    best_size: row.best_size, best_profit: row.best_profit, public: row.public === 1, public_at: row.public_at,
  };
}

function previous(raw: string | null, now: Date): PegSample | null {
  if (raw === null) return null;
  try {
    const prev = JSON.parse(raw) as PegSample;
    return now.getTime() - Date.parse(prev.at) <= PEG_PREV_MAX_AGE_MS ? prev : null;
  } catch {
    console.warn(`[peg] unreadable ${PREV_KEY}: ${raw}`);
    return null;
  }
}

const toOpen = (row: pegStore.PegEpisodeRow): PegOpen => ({ side: row.side, openedAt: row.opened_at, peakGap: row.peak_gap, peakAt: row.peak_at, tier: row.tier, public: row.public === 1 });

interface Tracked {
  id: number;
  best: { size: number | null; profit: number | null };
  publicAt: string | null;
}

/** One check through the episode rules: rows are written before the alerts go, so a failed send never repeats an event. */
async function advanceEpisodes(c: RunContext, live: PegLiveBody, config: { thresholds: PegThresholds; publicPosts: boolean }): Promise<{ episodes: PegEpisodeView[] }> {
  const db = c.env.DB;
  const now = c.deps.now();
  const [row, prevRaw] = await Promise.all([pegStore.openPegEpisode(db), store.getMeta(db, PREV_KEY)]);
  const machine: PegMachine = { open: row ? toOpen(row) : null, prev: previous(prevRaw, now) };
  const step = stepPeg(machine, { at: now.toISOString(), gap: live.gap }, config.thresholds, 2);

  let tracked: Tracked | null = row ? { id: row.id, best: { size: row.best_size, profit: row.best_profit }, publicAt: row.public_at } : null;
  const bestAtClose = new Map<PegEvent, number | null>();
  for (const e of step.events) {
    if (e.kind === 'closed' && tracked) {
      bestAtClose.set(e, tracked.best.size);
      await pegStore.savePegEpisode(db, tracked.id, { ...fields(e.episode, tracked), closed_at: e.closedAt });
      tracked = null;
    }
    if (e.kind === 'opened') tracked = { id: await pegStore.insertPegEpisode(db, e.episode), best: { size: null, profit: null }, publicAt: null };
    if (e.kind === 'went_public' && tracked) tracked.publicAt = now.toISOString();
  }
  const open = step.machine.open;
  if (open && tracked) {
    const route = live[open.side];
    if (route.depth !== null && (tracked.best.size === null || route.depth > tracked.best.size)) tracked.best = { size: route.depth, profit: route.profit };
    await pegStore.savePegEpisode(db, tracked.id, { ...fields(open, tracked), closed_at: null });
  }
  await store.setMeta(db, PREV_KEY, JSON.stringify({ at: now.toISOString(), gap: live.gap } satisfies PegSample));

  for (const e of step.events) {
    const text = pegAlertText(e, live, { publicLine: config.thresholds.public, publicPosts: config.publicPosts, bestSize: bestAtClose.get(e) ?? null, now });
    await sendPegAlert(c, e.kind, text);
  }
  return { episodes: (await pegStore.recentPegEpisodes(db, PEG_RECENT)).map(episodeView) };
}

function fields(o: PegOpen, t: Tracked) {
  return { peak_gap: o.peakGap, peak_at: o.peakAt, tier: o.tier, public: o.public, public_at: t.publicAt, best_size: t.best.size, best_profit: t.best.profit };
}

async function sendPegAlert(c: RunContext, kind: PegEvent['kind'], text: string): Promise<void> {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const chatId = c.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) {
    console.warn(`[peg] ${text}`);
    return;
  }
  const failure = await sendTelegramMessage(c.deps.fetch, { token, chatId }, text);
  console.log(JSON.stringify(failure === null ? { peg_alert_sent: kind } : { peg_alert_failed: kind, failure, text }));
}
