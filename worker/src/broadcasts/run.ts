import { addDays, dayOf, weekStart } from '@ccip-dev/core';
import { broadcastCardPath, broadcastKey, isDepositTransfer, type BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { milestonesOn, RECORD_KINDS, recordsSetOn, recordValue, trackedMilestones } from '@ccip-dev/core/records';
import type { RunContext } from '../context';
import type { ReserveBody } from '../publish';
import { LATE_FINALIZE_HOUR_UTC } from '../schedule';
import * as store from '../store';
import { composeCopy, type Copy } from './copy';
import { dailyFacts, loadFactsSource, milestoneFacts, recordFacts, reserveFacts, weeklyFacts, type BroadcastFacts, type FactsSource } from './facts';
import { composeMomentCopy } from './moment-copy';
import { isMomentFacts, loadMomentsSource, momentFacts, type MomentFacts, type MomentsSource } from './moment-facts';
import { dueMoments, pickMoments, type DueMoment } from './moment-plan';
import { broadcastMode, broadcastOutputs, momentMode, selectOutputs, selectPollOutputs, type Broadcast, type BroadcastOutput, type OutputSet } from './outputs';

export const SITE_ORIGIN = 'https://ccip.dev';
export const IMAGE_TIMEOUT_MS = 20_000;
const CLAIM_STALE_MS = 3_600_000;
/** finalize's catch-up window; an older finalized day comes from a rewind and never posts a record. */
export const RECORD_DAYS = 3;
export const RECORDS_SEED_KEY = 'broadcast:records:seeded';
export const RESERVE_SINCE_KEY = 'broadcast:reserve:since';
/** A deposit older than this is never posted, so a pause or a long card outage cannot release a flood of stale ones. */
export const RESERVE_MAX_AGE_DAYS = 3;
export const MOMENTS_SEED_KEY = 'broadcast:moments:seeded';

export type BroadcastRequest = { kind: 'finalize'; days: readonly string[] } | { kind: 'reserve'; reserve: ReserveBody };

interface Planned {
  target: BroadcastTarget;
  facts: BroadcastFacts | MomentFacts;
}

export async function runBroadcasts(c: RunContext, request: BroadcastRequest, outputs: OutputSet = broadcastOutputs(c)): Promise<void> {
  const mode = broadcastMode(c.env);
  if (mode === 'off') return;
  const enabled = selectOutputs(outputs, mode);
  if (enabled.length === 0) {
    console.warn(`[broadcast] BROADCASTS is ${mode} but no output is configured`);
    return;
  }
  const planned = request.kind === 'finalize' ? await planFinalize(c, request.days) : await planReserve(c, request.reserve);
  for (const p of planned) await deliver(c, p, enabled);
  if (request.kind === 'finalize') await broadcastMoments(c, request.days, outputs);
}

/** After the finalize posts, the moments due today, under their own switch; one moment's failure never stops the next. */
async function broadcastMoments(c: RunContext, days: readonly string[], outputs: OutputSet): Promise<void> {
  const mode = momentMode(c.env);
  if (mode === 'off' || !days.includes(addDays(dayOf(c.deps.now()), -1))) return;
  // Until the moment X text tags only its subject, moments keep the owner's X draft and never reach x-post.
  const enabled = selectOutputs({ ...outputs, xPost: [] }, mode);
  for (const p of await planMoments(c, await loadMomentsSource(c))) {
    try {
      await deliver(c, p, p.target.kind === 'poll' ? selectPollOutputs(outputs, mode) : enabled);
    } catch (err) {
      await c.alert('broadcast-run', `${broadcastKey(p.target)} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Monday's poll first, outside the budget and never seeded, then the budgeted moments due today. */
async function planMoments(c: RunContext, src: MomentsSource): Promise<Planned[]> {
  const db = c.env.DB;
  const today = dayOf(c.deps.now());
  const pollFacts = weekStart(today) === today ? momentFacts(src, { kind: 'poll', monday: today }) : null;
  const poll: Planned[] = pollFacts === null ? [] : [{ target: { kind: 'poll', monday: today }, facts: pollFacts }];
  const due = dueMoments(src.moments, today);
  if (await seedMoments(c, due)) return poll;
  const values = await store.getMetas(db, due.map((d) => broadcastKey(d.target)));
  const done = new Set([...values].filter(([, v]) => v.startsWith('sent:') || v.startsWith('seeded:')).map(([key]) => key));
  const picked = pickMoments(due, { done, sentToday: await store.momentsSentOn(db, today) }).flatMap((d) => {
    const facts = momentFacts(src, d.target);
    return facts === null ? [] : [{ target: d.target, facts }];
  });
  return [...poll, ...picked];
}

/** The first run marks every moment due today as seeded, without posting it, so switching moments on posts no old ones. */
async function seedMoments(c: RunContext, due: readonly DueMoment[]): Promise<boolean> {
  const db = c.env.DB;
  if ((await store.getMeta(db, MOMENTS_SEED_KEY)) !== null) return false;
  const value = `seeded:${c.deps.now().toISOString()}`;
  await store.markMeta(db, due.map((d) => broadcastKey(d.target)), value);
  await store.setMeta(db, MOMENTS_SEED_KEY, value);
  return true;
}

/** Broadcasts never fail the job that runs them: a failure alerts, and the hourly run retries what was not sent. */
export async function broadcastSafely(c: RunContext, request: BroadcastRequest, due: () => Promise<boolean> = async () => true): Promise<void> {
  try {
    if (await due()) await runBroadcasts(c, request);
  } catch (err) {
    try {
      await c.alert('broadcast-run', `Broadcasts failed: ${err instanceof Error ? err.message : String(err)}`);
    } catch (alertErr) {
      console.error('[broadcast] the broadcast-run alert failed', alertErr instanceof Error ? alertErr.name : 'error');
    }
  }
}

/** New Reserve deposits, then yesterday's finalize broadcasts again: the ones already sent hold their keys, so only the rest go out. */
export async function broadcastHourly(c: RunContext, reserve: ReserveBody): Promise<void> {
  await broadcastSafely(c, { kind: 'reserve', reserve });
  if (c.deps.now().getUTCHours() === LATE_FINALIZE_HOUR_UTC) return;
  const yesterday = addDays(dayOf(c.deps.now()), -1);
  await broadcastSafely(c, { kind: 'finalize', days: [yesterday] }, async () => (await store.getMeta(c.env.DB, 'last_finalize_day')) === yesterday);
}

async function planFinalize(c: RunContext, days: readonly string[]): Promise<Planned[]> {
  const liveStart = await store.getMeta(c.env.DB, 'live_start_day');
  const yesterday = addDays(dayOf(c.deps.now()), -1);
  const daily = days.includes(yesterday) ? yesterday : null;
  const monday = daily !== null && weekStart(daily) === addDays(daily, -6) ? addDays(daily, -6) : null;
  const oldest = addDays(yesterday, -(RECORD_DAYS - 1));
  const recordDays = [...new Set(days)].filter((d) => liveStart !== null && d >= liveStart && d >= oldest && d <= yesterday).sort();
  const wanted = [...new Set([...(daily === null ? [] : [daily]), ...recordDays])];
  if (wanted.length === 0) return [];
  const src = await loadFactsSource(c, { days: wanted, monday });
  const planned: Planned[] = [];
  const day = daily === null ? null : dailyFacts(src, daily);
  if (daily !== null && day !== null) planned.push({ target: { kind: 'daily', day: daily }, facts: day });
  const week = monday === null ? null : weeklyFacts(src, monday);
  if (monday !== null && week !== null) planned.push({ target: { kind: 'weekly', monday }, facts: week });
  if (await seedRecords(c, src)) return planned;
  for (const d of recordDays) {
    for (const record of recordsSetOn(src.history, src.largest, d)) {
      planned.push({ target: { kind: 'record', record: record.kind, day: d }, facts: recordFacts(src, record) });
    }
    for (const m of milestonesOn(src.history, d)) {
      planned.push({ target: { kind: 'milestone', metric: m.metric, threshold: m.threshold }, facts: milestoneFacts(src, m) });
    }
  }
  return planned;
}

/** The first run marks every current record and passed milestone as announced, so switching broadcasts on posts no old ones. */
async function seedRecords(c: RunContext, src: FactsSource): Promise<boolean> {
  const db = c.env.DB;
  if ((await store.getMeta(db, RECORDS_SEED_KEY)) !== null) return false;
  const value = `seeded:${c.deps.now().toISOString()}`;
  const records = RECORD_KINDS.flatMap((kind) => {
    const best = recordValue(kind, src.history, src.largest);
    return best === null ? [] : [broadcastKey({ kind: 'record', record: kind, day: best.day })];
  });
  const milestones = trackedMilestones(src.history).map((m) => broadcastKey({ kind: 'milestone', metric: m.metric, threshold: m.threshold }));
  await store.markMeta(db, [...records, ...milestones], value);
  await store.setMeta(db, RECORDS_SEED_KEY, value);
  return true;
}

async function planReserve(c: RunContext, reserve: ReserveBody): Promise<Planned[]> {
  // Before the scan catches up, reserve.json lists no transfers; a watermark set then would make every old deposit look new.
  if (reserve.cost_basis === null) return [];
  const db = c.env.DB;
  const deposits = reserve.transfers.filter(isDepositTransfer).sort((a, b) => a.ts.localeCompare(b.ts));
  const since = await store.getMeta(db, RESERVE_SINCE_KEY);
  if (since === null) {
    await store.setMeta(db, RESERVE_SINCE_KEY, deposits.at(-1)?.ts ?? '');
    return [];
  }
  const oldest = new Date(c.deps.now().getTime() - RESERVE_MAX_AGE_DAYS * 86_400_000).toISOString();
  return deposits
    .filter((d) => d.ts > since && d.ts >= oldest && d.price_usd !== null)
    .flatMap((d) => {
      const facts = reserveFacts(reserve, d.tx);
      return facts === null ? [] : [{ target: { kind: 'reserve' as const, tx: d.tx }, facts }];
    });
}

async function checkImage(c: RunContext, url: string): Promise<{ png: Uint8Array } | { problem: string }> {
  try {
    const res = await c.deps.fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    if (!res.ok) return { problem: `answered HTTP ${res.status}` };
    if (!(res.headers.get('content-type') ?? '').startsWith('image/png')) return { problem: 'did not answer with a PNG' };
    const png = new Uint8Array(await res.arrayBuffer());
    return png.byteLength === 0 ? { problem: 'answered an empty PNG' } : { png };
  } catch (err) {
    return { problem: `did not answer (${err instanceof Error ? err.name : 'error'})` };
  }
}

/**
 * Claims the key, then sends the checked card to each output that has not sent yet; every output that sends is marked under
 * `${key}#${name}`. The broadcast is marked sent only once all its outputs are, otherwise the claim is released and the next
 * run sends just the missing ones.
 */
async function deliver(c: RunContext, p: Planned, outputs: readonly BroadcastOutput[]): Promise<void> {
  const db = c.env.DB;
  const key = broadcastKey(p.target);
  let copy: Copy;
  try {
    copy = isMomentFacts(p.facts) ? composeMomentCopy(p.facts) : composeCopy(p.facts);
  } catch (err) {
    await c.alert(`broadcast-copy:${key}`, `${key} was not posted: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const now = c.deps.now();
  const claim = `pending:${now.toISOString()}`;
  if (!(await store.claimMeta(db, key, claim, `pending:${new Date(now.getTime() - CLAIM_STALE_MS).toISOString()}`))) return;
  const outputKey = (output: BroadcastOutput) => `${key}#${output.name}`;
  const remaining: BroadcastOutput[] = [];
  for (const output of outputs) {
    if (!(await store.getMeta(db, outputKey(output)))?.startsWith('sent:')) remaining.push(output);
  }
  if (remaining.length === 0) {
    await markSent(c, key, `sent:${now.toISOString()}`);
    return;
  }
  const cardUrl = `${SITE_ORIGIN}/og/${broadcastCardPath(p.target)}.png`;
  const checked = await checkImage(c, cardUrl);
  if ('problem' in checked) {
    await store.releaseMeta(db, key, claim);
    await c.alert(`broadcast-image:${key}`, `${key} was not posted: its card ${cardUrl} ${checked.problem}`);
    return;
  }
  const broadcast: Broadcast = { key, kind: p.target.kind, image: checked.png, facts: p.facts, ...copy };
  const sentNames = new Set(outputs.filter((o) => !remaining.includes(o)).map((o) => o.name));
  const failedOutputs: string[] = [];
  let waiting = false;
  let unmarked = false;
  for (const output of remaining) {
    // An output that follows another (the poll after its card) waits, without an alert, until that one has sent.
    if (output.after !== undefined && !sentNames.has(output.after)) {
      waiting = true;
      continue;
    }
    const result = await output.send(broadcast).catch((err) => {
      console.error(`[broadcast] output ${output.name} threw`, err instanceof Error ? err.name : 'error');
      return 'failed' as const;
    });
    if (result === 'sent') {
      sentNames.add(output.name);
      unmarked = !(await markSent(c, outputKey(output), `sent:${now.toISOString()}`)) || unmarked;
    } else failedOutputs.push(output.name);
  }
  // Every output sent, so the broadcast closes even if an output mark was lost; releasing it would post that output again.
  // With a failed output and a lost mark, the claim stays pending: releasing would re-send the unmarked output at once.
  if (failedOutputs.length === 0 && !waiting) await markSent(c, key, `sent:${now.toISOString()}`);
  else if (!unmarked) await store.releaseMeta(db, key, claim);
  for (const name of failedOutputs) await c.alert(`broadcast-${name}:${key}`, `${key} was not sent to ${name}; the Worker logs say why`);
}

/** The post is out; a failed mark is retried once, then alerted, since the stale claim would let the hourly run post it again. */
async function markSent(c: RunContext, key: string, value: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.setMeta(c.env.DB, key, value);
      return true;
    } catch (err) {
      console.error(`[broadcast] marking ${key} sent failed (attempt ${attempt + 1})`, err instanceof Error ? err.name : 'error');
    }
  }
  await c.alert(`broadcast-mark:${key}`, `${key} went out but could not be marked sent, so the hourly run may post it again`);
  return false;
}
