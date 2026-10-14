import { addDays, dayOf, feeClassifier, lastCompleteMonday, mergeIdentities, normalizeAddress, rankIdentities, sharePct, LINK_PRICE_KEY, LINK_RESERVE, LINK_TOKEN, linkFeeMatcher, linkFeeUsd, buildReplay, reserveStats, rollupDay, toUnits, type DailyBreakdown, type Dim, type FeeClassifier, type LinkFeeTokens, type IdentityTotals, type SenderIdentity, type PricedTransfer } from '@ccip-dev/core';
import { LabelCoverageSchema, TOP_WINDOWS, type DayLeaders, type DayTotals, type LargestFee, type Leader, type ReserveFile, type TopWindow } from '@ccip-dev/core/public';
import type { RunContext } from './context';
import { lookupLabel } from './labels';
import { buildMoments } from './moments';
import { buildProjects } from './projects';
import { LABEL_COVERAGE_KEY, labelCoverageOf, rankedIdentities, senderBook, topIdentityByDay, type SenderBook } from './senders';
import * as store from './store';

export type ReserveBody = Omit<ReserveFile, 'schema_version' | 'updated_at' | 'attribution'>;

export const SCHEMA_VERSION = 1;
export const ATTRIBUTION = 'Data: Chainlink CCIP API, DefiLlama';
export const TTL = { live: 30, today: 30, status: 30, history: 300, top: 300, reserve: 300, replay: 300, cost: 300, leaders: 300, moments: 300, projects: 300, chains: 3600, tokens: 3600 } as const;

const LIVE_WINDOW_MINUTES = 15;

const RETRY_DELAYS_MS = [1000, 2000];

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Puts `key` with up to two retries, warning before each one so R2 flakes show in the logs. */
export async function retryPut<T>(key: string, put: () => Promise<T>, sleep: (ms: number) => Promise<void> = realSleep): Promise<T> {
  const attempts = RETRY_DELAYS_MS.length + 1;
  for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
    try {
      return await put();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`R2 put of ${key} failed (attempt ${i + 1} of ${attempts}), retrying in ${delay} ms: ${message}`);
      await sleep(delay);
    }
  }
  return put();
}

export async function putJson(
  bucket: R2Bucket,
  name: string,
  body: Record<string, unknown>,
  maxAgeSeconds: number,
  now: Date,
): Promise<void> {
  const doc = { schema_version: SCHEMA_VERSION, updated_at: now.toISOString(), attribution: ATTRIBUTION, ...body };
  await retryPut(`v1/${name}`, () =>
    bucket.put(`v1/${name}`, JSON.stringify(doc), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: `public, max-age=${maxAgeSeconds}` },
    }),
  );
}

export function usd(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

export function linkAmount(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

export const LARGEST_FEES_LIMIT = 10;

export const COST_WINDOW_DAYS = 30;
export const COST_MIN_MESSAGES = 5;
export const COST_LINK_MIN_MESSAGES = 20;

/** Typical fees on some routes are fractions of a cent, so cost.json keeps four decimals where other files keep cents. */
export function costUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function costLane(r: store.FeeCostRow) {
  const split = r.link_messages >= COST_LINK_MIN_MESSAGES;
  return {
    src: r.src,
    dst: r.dst,
    messages: r.messages,
    median_usd: costUsd(r.median_usd),
    p10_usd: costUsd(r.p10_usd),
    p90_usd: costUsd(r.p90_usd),
    ...(split && r.link_median_usd !== null ? { link: { messages: r.link_messages, median_usd: costUsd(r.link_median_usd) } } : {}),
    ...(split && r.gas_median_usd !== null ? { gas: { messages: r.messages - r.link_messages, median_usd: costUsd(r.gas_median_usd) } } : {}),
  };
}

async function publishCost(c: RunContext, now: Date, linkTokens: LinkFeeTokens): Promise<void> {
  const today = dayOf(now);
  const from = addDays(today, -COST_WINDOW_DAYS);
  const to = addDays(today, -1);
  const rows = await store.feeCosts(c.env.DB, from, to, linkTokens, COST_MIN_MESSAGES);
  await putJson(c.env.PUBLIC, 'cost.json', { from, to, lanes: rows.map(costLane) }, TTL.cost, now);
}

export const DAY_LEADERS_DAYS = 400;
export const LEADER_WEEKS = 8;

export function leader(r: store.BreakdownRow, label: string | null): Leader {
  return { key: r.key, label, messages: r.messages, usd: usd(r.usd_value), fee_usd: usd(r.fee_usd) };
}

/** A sender identity as every public file publishes it, with its share of the period's messages. */
export function identityEntry(i: IdentityTotals, periodMessages: number | null): Leader {
  return {
    key: i.key,
    label: i.label,
    messages: i.messages,
    usd: usd(i.usd_value),
    fee_usd: usd(i.fee_usd),
    x: i.inferred ? null : i.x,
    kind: i.kind,
    inferred: i.inferred,
    chains: i.chains,
    addresses: i.addresses,
    share_pct: sharePct(i.messages, periodMessages),
  };
}

/** Each day's leaders over [fromDay, toDay]: the top token and lane by value, the top sender identity by messages, and the top lane and source chain by fees. */
export async function dayLeaderEntries(c: RunContext, fromDay: string, toDay: string): Promise<DayLeaders[]> {
  const db = c.env.DB;
  const book = await senderBook(c);
  const tokens = await store.dailyLeaders(db, 'token', 'value', fromDay, toDay);
  const senders = topIdentityByDay(
    book,
    [...(await store.senderDaysOf(db, fromDay, toDay, book.labeled)), ...(await store.dailyTopUnlabeledSenders(db, fromDay, toDay, book.labeled, book.claimed))],
    await store.viaTokenCreditDays(db, fromDay, toDay, book.claimed, book.labeled),
  );
  const dayMessages = await store.messagesByDay(db, fromDay, toDay);
  const lanes = await store.dailyLeaders(db, 'lane', 'value', fromDay, toDay);
  const feeLanes = await store.dailyLeaders(db, 'lane', 'fees', fromDay, toDay);
  const feeChains = await store.dailyLeaders(db, 'src_chain', 'fees', fromDay, toDay);
  const symbols = await store.tokenSymbols(db, tokens.map((r) => splitTokenKey(r.key)));
  const byDay = (rows: store.LeaderRow[]) => new Map(rows.map((r) => [r.day, r]));
  const [token, lane, feeLane, feeChain] = [tokens, lanes, feeLanes, feeChains].map(byDay);
  const days = [...new Set([...[tokens, lanes, feeLanes, feeChains].flat().map((r) => r.day), ...senders.keys()])].sort();
  return days.map((day) => {
    const t = token!.get(day);
    const s = senders.get(day);
    const l = lane!.get(day);
    const fl = feeLane!.get(day);
    const fc = feeChain!.get(day);
    return {
      day,
      token: t ? leader(t, symbolOf(symbols, t.key)) : null,
      sender: s ? identityEntry(s, dayMessages.get(day) ?? null) : null,
      lane: l ? leader(l, null) : null,
      fee_lane: fl ? leader(fl, null) : null,
      fee_chain: fc ? leader(fc, null) : null,
    };
  });
}

export async function weekFeeChains(c: RunContext, monday: string): Promise<Leader[]> {
  return (await store.topBetween(c.env.DB, 'src_chain', monday, addDays(monday, 6), 3, 'fees')).map((r) => leader(r, null));
}

export async function publishDayLeaders(c: RunContext, now: Date): Promise<void> {
  const today = dayOf(now);
  const lastDay = addDays(today, -1);
  const days = await dayLeaderEntries(c, addDays(today, -DAY_LEADERS_DAYS), lastDay);
  const latest = lastCompleteMonday(lastDay);
  const weeks: { week: string; fee_chains: Leader[] }[] = [];
  for (let i = LEADER_WEEKS - 1; i >= 0; i--) {
    const monday = addDays(latest, -7 * i);
    weeks.push({ week: monday, fee_chains: await weekFeeChains(c, monday) });
  }
  await putJson(c.env.PUBLIC, 'day-leaders.json', { days, weeks }, TTL.leaders, now);
}

function feeLinkShare(feeLinkUsd: number | null, feeUsd: number | null): number | null {
  return feeLinkUsd === null || feeUsd === null || feeUsd === 0 ? null : Math.round((feeLinkUsd / feeUsd) * 10_000) / 100;
}

export function topOf(breakdown: DailyBreakdown[], dim: Dim, limit: number): DailyBreakdown[] {
  return breakdown
    .filter((b) => b.dim === dim)
    .sort((a, b) => b.usd_value - a.usd_value || b.messages - a.messages)
    .slice(0, limit);
}

export function senderLabel(c: RunContext, names: Map<string, string>, senderKey: string): string | null {
  const split = senderKey.indexOf(':');
  return lookupLabel(c.labels, names.get(senderKey.slice(0, split)), senderKey.slice(split + 1))?.name ?? null;
}

export async function publishLiveFiles(c: RunContext): Promise<void> {
  const now = c.deps.now();
  const book = await senderBook(c);
  const since = new Date(now.getTime() - LIVE_WINDOW_MINUTES * 60_000).toISOString();
  const rows = await store.liveSince(c.env.DB, since);
  const today = await rollupToday(c, now);
  const symbols = await store.tokenSymbols(c.env.DB, [
    ...rows.flatMap((r) => (r.symbol === null && r.chain !== null && r.token !== null ? [{ chain: r.chain, address: r.token }] : [])),
    ...topOf(today.breakdown, 'token', TOP_LIMIT).map((b) => splitTokenKey(b.key)),
  ]);
  await publishLive(c, now, book, rows, symbols);
  await publishToday(c, now, book, today, symbols);
  await publishStatus(c, now);
}

const TOP_LIMIT = 10;

function splitTokenKey(key: string): { chain: string; address: string } {
  const split = key.indexOf(':');
  return { chain: key.slice(0, split), address: key.slice(split + 1) };
}

function symbolOf(symbols: Map<string, string>, key: string): string | null {
  const { chain, address } = splitTokenKey(key);
  return symbols.get(`${chain}:${normalizeAddress(address)}`) ?? null;
}

async function rollupToday(c: RunContext, now: Date) {
  const day = dayOf(now);
  const messages = await store.messagesForDay(c.env.DB, day);
  const tokens = await store.tokensForDay(c.env.DB, day);
  return { day, messages, ...rollupDay(day, messages, tokens, await store.firstTokenGroups(c.env.DB, tokens)) };
}

/** The feed shows a live message's label as verified, so a label spread from another chain is left out. */
function verifiedLabel(identity: SenderIdentity): string | null {
  return identity.inferred ? null : (identity.project?.name ?? null);
}

async function publishLive(c: RunContext, now: Date, book: SenderBook, rows: store.LiveRow[], symbols: Map<string, string>): Promise<void> {
  await putJson(
    c.env.PUBLIC,
    'live.json',
    {
      window_minutes: LIVE_WINDOW_MINUTES,
      messages: rows.map((r) => ({
        id: r.message_id,
        send_ts: r.send_ts,
        status: r.status,
        src: r.src_chain,
        dst: r.dst_chain,
        token: r.symbol ?? (r.chain !== null && r.token !== null ? symbolOf(symbols, `${r.chain}:${r.token}`) : null),
        usd: usd(r.usd_value),
        sender_label: verifiedLabel(book.resolve(r.src_chain, r.sender)),
      })),
    },
    TTL.live,
    now,
  );
}

/** today.json's top senders are identities ranked by value, as its lanes and tokens are. */
async function publishToday(
  c: RunContext,
  now: Date,
  book: SenderBook,
  { day, messages, totals, breakdown }: Awaited<ReturnType<typeof rollupToday>>,
  symbols: Map<string, string>,
): Promise<void> {
  const feeLink = linkFeeUsd(messages, day, linkFeeMatcher(await store.linkFeeTokens(c.env.DB)));
  const top = (dim: Dim) =>
    topOf(breakdown, dim, TOP_LIMIT).map((b) => ({
      key: b.key,
      messages: b.messages,
      usd: usd(b.usd_value),
      ...(dim === 'token' ? { symbol: symbolOf(symbols, b.key) } : {}),
    }));
  const senders = rankIdentities(mergeIdentities(breakdown.filter((b) => b.dim === 'sender'), book.resolve), 'value', TOP_LIMIT).map((i) =>
    identityEntry(i, totals.messages),
  );
  await putJson(
    c.env.PUBLIC,
    'today.json',
    {
      day,
      totals: {
        ...totals,
        usd_value: usd(totals.usd_value),
        fee_usd: usd(totals.fee_usd),
        fee_link_usd: usd(feeLink),
        fee_link_share_pct: feeLinkShare(feeLink, totals.fee_usd),
      },
      top: { lane: top('lane'), token: top('token'), sender: senders },
      arrivals: await store.recentArrivals(c.env.DB, 10),
    },
    TTL.today,
    now,
  );
}

/** A missing or unreadable coverage row reads as none, so status.json always publishes. */
function storedCoverage(raw: string | null) {
  if (raw === null) return null;
  try {
    const parsed = LabelCoverageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function publishStatus(c: RunContext, now: Date): Promise<void> {
  const db = c.env.DB;
  const [lastIngest, lastFinalize, coverageFrom, coverage] = await Promise.all([
    store.getMeta(db, 'last_ingest_ok_at'),
    store.getMeta(db, 'last_finalize_day'),
    store.getMeta(db, 'coverage_from'),
    store.getMeta(db, LABEL_COVERAGE_KEY),
  ]);
  await putJson(
    c.env.PUBLIC,
    'status.json',
    {
      last_ingest_ok_at: lastIngest,
      lag_seconds: lastIngest ? Math.round((now.getTime() - Date.parse(lastIngest)) / 1000) : null,
      last_finalize_day: lastFinalize,
      coverage_from: coverageFrom,
      label_coverage: storedCoverage(coverage),
    },
    TTL.status,
    now,
  );
}

const DAY_MS = 86_400_000;

function linkUnits(raw: string): number {
  return Math.round(toUnits(raw, 18) * 100) / 100;
}

async function latestLinkPrice(c: RunContext): Promise<number | null> {
  try {
    return (await c.prices.latest([LINK_PRICE_KEY])).get(LINK_PRICE_KEY)?.price ?? null;
  } catch (err) {
    console.warn(`LINK price read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function pricedTransfer(r: store.ReserveTransferRow): PricedTransfer {
  return { ts: r.ts, tx: r.tx_hash, direction: r.direction, counterparty: r.counterparty, amount: r.amount, linkUsd: r.link_usd };
}

export async function publishRegistryFiles(c: RunContext): Promise<ReserveBody> {
  const now = c.deps.now();
  const db = c.env.DB;
  const series = await store.reserveSeries(db, new Date(now.getTime() - 90 * DAY_MS).toISOString());
  const latest = series.at(-1);
  const linkPriceUsd = await latestLinkPrice(c);
  const caughtUp = (await store.getMeta(db, 'reserve_scan_caught_up')) === '1';
  const stats = caughtUp ? reserveStats({ transfers: (await store.reserveTransfers(db)).map(pricedTransfer), linkPriceUsd, now }) : null;
  const reserve: ReserveBody = {
    token: LINK_TOKEN,
    reserve: LINK_RESERVE,
    latest: latest ? { ts: latest.ts, link: linkUnits(latest.link_balance) } : null,
    series: series.map((s) => ({ ts: s.ts, link: linkUnits(s.link_balance) })),
    link_price_usd: linkPriceUsd === null ? null : Math.round(linkPriceUsd * 10_000) / 10_000,
    cost_basis: stats?.cost_basis ?? null,
    pace: stats?.pace ?? null,
    weekly: stats?.weekly ?? [],
    performance: stats?.performance ?? null,
    transfers: stats?.transfers ?? [],
    latest_transfer: stats?.latest_transfer ?? null,
  };
  await putJson(c.env.PUBLIC, 'reserve.json', reserve, TTL.reserve, now);
  await putJson(c.env.PUBLIC, 'chains.json', { chains: await store.registryChains(db) }, TTL.chains, now);
  await putJson(c.env.PUBLIC, 'tokens.json', { tokens: await store.registryTokens(db) }, TTL.tokens, now);
  return reserve;
}

const DIMS: Dim[] = ['src_chain', 'dst_chain', 'lane', 'token', 'sender'];

/** Token rows carry no fees: a message's fee is not split across its tokens, so there is nothing to rank them by. */
const FEE_DIMS: ReadonlySet<Dim> = new Set<Dim>(['src_chain', 'dst_chain', 'lane', 'sender']);

/** history.json's day rows: the daily totals with their fee groups, rounded as published. */
export async function historyDays(c: RunContext): Promise<DayTotals[]> {
  const db = c.env.DB;
  const groups = await store.feeGroupsByDay(db);
  return (await store.dailyHistory(db)).map((d) => {
    const g = groups.get(d.day);
    return {
      ...d,
      usd_value: usd(d.usd_value) ?? 0,
      fee_usd: usd(d.fee_usd),
      fee_link_usd: usd(g?.link_usd ?? null),
      fee_native_usd: usd(g?.native_usd ?? null),
      fee_stable_usd: usd(g?.stable_usd ?? null),
      fee_link_amount: linkAmount(g?.link_amount ?? null),
    };
  });
}

export async function largestFeeEntries(c: RunContext, throughDay: string, limit: number, classify: FeeClassifier): Promise<LargestFee[]> {
  return (await store.largestFees(c.env.DB, throughDay, limit)).map((r) => ({
    message_id: r.message_id,
    day: r.day,
    src: r.src_chain,
    dst: r.dst_chain,
    fee_usd: usd(r.fee_usd) ?? 0,
    symbol: r.fee_token === null ? null : classify(r.src_chain, r.fee_token).symbol,
  }));
}

export interface WeekLeaderRows {
  token: Leader | null;
  sender: Leader | null;
  lane: Leader | null;
  feeChains: Leader[];
}

/** A Monday–Sunday week's top token and lane by value, top sender identity by messages and top 3 source chains by fees. */
export async function weekLeaderRows(c: RunContext, monday: string): Promise<WeekLeaderRows> {
  const db = c.env.DB;
  const sunday = addDays(monday, 6);
  const [token] = await store.topBetween(db, 'token', monday, sunday, 1, 'value');
  const book = await senderBook(c);
  const [sender] = await rankedIdentities(c, book, monday, sunday, 'messages', 1);
  const weekMessages = (await store.totalsBetween(db, monday, sunday)).messages;
  const [lane] = await store.topBetween(db, 'lane', monday, sunday, 1, 'value');
  const symbols = token ? await store.tokenSymbols(db, [splitTokenKey(token.key)]) : new Map<string, string>();
  return {
    token: token ? leader(token, symbolOf(symbols, token.key)) : null,
    sender: sender ? identityEntry(sender, weekMessages) : null,
    lane: lane ? leader(lane, null) : null,
    feeChains: await weekFeeChains(c, monday),
  };
}

const TOP_FILE_LIMIT = 100;

/** top/sender.json's identities for each window, each with its share of the window's messages. */
async function identityWindows(c: RunContext, book: SenderBook, today: string, order: store.TopOrder): Promise<Record<TopWindow, Leader[]>> {
  const lastDay = addDays(today, -1);
  const from: Record<TopWindow, string | null> = { '7d': addDays(today, -7), '30d': addDays(today, -30), all: null };
  const out: Record<TopWindow, Leader[]> = { '7d': [], '30d': [], all: [] };
  for (const window of TOP_WINDOWS) {
    const total = (await store.totalsBetween(c.env.DB, from[window], lastDay)).messages;
    out[window] = (await rankedIdentities(c, book, from[window], lastDay, order, TOP_FILE_LIMIT)).map((i) => identityEntry(i, total));
  }
  return out;
}

async function senderBookOrAlert(c: RunContext): Promise<SenderBook | null> {
  try {
    return await senderBook(c);
  } catch (err) {
    await c.alert('top-sender-identities', `Sender identities were not computed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The identity windows for top/sender.json; without them the file keeps its per-chain windows, which every reader falls back to. */
async function topSenderIdentities(c: RunContext, book: SenderBook, today: string): Promise<{ identities?: Record<TopWindow, Leader[]>; identities_by_fees?: Record<TopWindow, Leader[]> }> {
  try {
    return { identities: await identityWindows(c, book, today, 'value'), identities_by_fees: await identityWindows(c, book, today, 'fees') };
  } catch (err) {
    await c.alert('top-sender-identities', `Sender identities were not computed: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

export async function publishHistoryFiles(c: RunContext): Promise<void> {
  const now = c.deps.now();
  const db = c.env.DB;
  const days = await historyDays(c);
  const linkTokens = await store.linkFeeTokens(db);
  const classify = feeClassifier(linkTokens);
  const since = (await store.getMeta(db, 'coverage_from')) ?? days[0]?.day ?? null;
  await putJson(
    c.env.PUBLIC,
    'history.json',
    { since, days, largest_fees: await largestFeeEntries(c, days.at(-1)?.day ?? '', LARGEST_FEES_LIMIT, classify) },
    TTL.history,
    now,
  );

  try {
    await publishCost(c, now, linkTokens);
  } catch (err) {
    await c.alert('cost-publish', `cost.json was not published: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await publishDayLeaders(c, now);
  } catch (err) {
    await c.alert('day-leaders-publish', `day-leaders.json was not published: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await putJson(c.env.PUBLIC, 'moments.json', await buildMoments(c, { lastDay: addDays(dayOf(now), -1), days }), TTL.moments, now);
  } catch (err) {
    await c.alert('moments-publish', `moments.json was not published: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await putJson(c.env.PUBLIC, 'projects.json', await buildProjects(c, addDays(dayOf(now), -1)), TTL.projects, now);
  } catch (err) {
    await c.alert('projects-publish', `projects.json was not published: ${err instanceof Error ? err.message : String(err)}`);
  }

  const today = dayOf(now);
  const lastDay = addDays(today, -1);
  const names = await store.chainNames(db);
  const book = await senderBookOrAlert(c);
  if (book) {
    try {
      await store.setMeta(db, LABEL_COVERAGE_KEY, JSON.stringify(await labelCoverageOf(c, book, addDays(today, -7), lastDay)));
    } catch (err) {
      await c.alert('label-coverage', `Label coverage was not computed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const dim of DIMS) {
    const ranked = async (order: store.TopOrder) => ({
      '7d': await store.topBetween(db, dim, addDays(today, -7), lastDay, 100, order),
      '30d': await store.topBetween(db, dim, addDays(today, -30), lastDay, 100, order),
      all: await store.topBetween(db, dim, null, lastDay, 100, order),
    });
    const windows = await ranked('value');
    const byFees = FEE_DIMS.has(dim) ? await ranked('fees') : null;
    const symbols =
      dim === 'token'
        ? await store.tokenSymbols(db, Object.values(windows).flatMap((rows) => rows.map((r) => splitTokenKey(r.key))))
        : new Map<string, string>();
    const entries = (rows: typeof windows['all']) =>
      rows.map((r) => ({
        key: r.key,
        messages: r.messages,
        usd: usd(r.usd_value),
        fee_usd: usd(r.fee_usd),
        ...(dim === 'token' ? { symbol: symbolOf(symbols, r.key) } : {}),
        ...(dim === 'sender' ? { label: senderLabel(c, names, r.key) } : {}),
      }));
    const published = (w: typeof windows) => ({ '7d': entries(w['7d']), '30d': entries(w['30d']), all: entries(w.all) });
    const identities = dim === 'sender' && book ? await topSenderIdentities(c, book, today) : {};
    await putJson(
      c.env.PUBLIC,
      `top/${dim}.json`,
      { dim, since, windows: published(windows), ...(byFees ? { by_fees: published(byFees) } : {}), ...identities },
      TTL.top,
      now,
    );
  }
  try {
    await putJson(
      c.env.PUBLIC,
      'replay.json',
      { since, ...buildReplay(await store.laneHistory(db), await store.chainDisplayNames(db)) },
      TTL.replay,
      now,
    );
  } catch (err) {
    await c.alert('replay-publish', `replay.json was not published: ${err instanceof Error ? err.message : String(err)}`);
  }
}
