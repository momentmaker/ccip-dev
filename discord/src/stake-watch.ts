import { stakerShard, type StakersFile, type StakingFile } from '@ccip-dev/core/public';
import type { TelegramBot } from './telegram-marines';

// Claim-window reminders: /watch 0x… in a private chat with the bot, then a message when that address's claim window
// opens and another a day before it closes. Unstaking takes 28 days of unbonding and then a 7-day window; a staker who
// misses the window stays staked and has to start over, so these two messages are the ones worth sending.

export const MAX_WATCHES = 5;
export const CLOSING_NOTICE_MS = 86_400_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type Clock =
  | { kind: 'missing' }
  | { kind: 'staked'; stake: number }
  | { kind: 'unbonding'; stake: number; unbondingAt: string; opensAt: string; closesAt: string }
  | { kind: 'open'; stake: number; unbondingAt: string; closesAt: string }
  | { kind: 'lapsed'; stake: number };

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const link = (n: number) => `${Math.round(n).toLocaleString('en-US')} LINK`;
const when = (iso: string) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))} UTC`;

export function clockOf(stakers: Pick<StakersFile, 'stakers'>, periods: StakingFile['periods'], address: string, now: Date): Clock {
  const row = stakers.stakers.find((r) => r[0] === address);
  if (row === undefined) return { kind: 'missing' };
  const [, , stake, , unbondingAt] = row;
  if (unbondingAt === null) return { kind: 'staked', stake };
  const opens = Date.parse(unbondingAt) + periods.unbonding_s * 1000;
  const closes = opens + periods.claim_s * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  if (now.getTime() < opens) return { kind: 'unbonding', stake, unbondingAt, opensAt: iso(opens), closesAt: iso(closes) };
  if (now.getTime() < closes) return { kind: 'open', stake, unbondingAt, closesAt: iso(closes) };
  return { kind: 'lapsed', stake };
}

export function clockText(address: string, clock: Clock): string {
  const who = short(address);
  switch (clock.kind) {
    case 'missing':
      return `${who} isn't staking in Chainlink staking right now. I'll keep watching: once it stakes and starts unbonding, you'll hear from me.`;
    case 'staked':
    case 'lapsed':
      return `${who} is staking ${link(clock.stake)} and isn't unbonding. If it starts, I'll message you when its claim window opens and a day before it closes.`;
    case 'unbonding':
      return `${who} is unbonding ${link(clock.stake)}. Its claim window opens ${when(clock.opensAt)} and closes ${when(clock.closesAt)}. I'll message you at both ends.`;
    case 'open':
      return `${who}'s claim window is open now, until ${when(clock.closesAt)}. Unstake before then or the LINK stays staked.`;
  }
}

const openedText = (address: string, c: Extract<Clock, { kind: 'open' }>) =>
  `🔓 The claim window for ${short(address)} is open. You can unstake ${link(c.stake)} until ${when(c.closesAt)}; after that it stays staked and unbonding starts over.\nhttps://ccip.dev/staking/${address}/`;
const closingText = (address: string, c: Extract<Clock, { kind: 'open' }>) =>
  `⏳ A day left: the claim window for ${short(address)} closes ${when(c.closesAt)}. Unstake before then, or ${link(c.stake)} stays staked.\nhttps://ccip.dev/staking/${address}/`;

async function send(bot: TelegramBot, chatId: number, text: string): Promise<boolean> {
  const res = await bot.tg.call('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  if (!res.ok) console.warn(`stake watch: sendMessage to ${chatId} failed (${res.status}): ${res.description}`);
  return res.ok;
}

async function readClock(bot: TelegramBot, address: string): Promise<Clock> {
  const [stakers, staking] = await Promise.all([bot.data.load(stakerShard(address)), bot.data.load('staking.json')]);
  return clockOf(stakers, staking.periods, address, bot.now());
}

/** /watch 0x…, /unwatch [0x…] and /watching, in a private chat. Answers every call, so a typo never goes unanswered. */
export async function stakeWatchCommand(bot: TelegramBot, chatId: number, name: 'watch' | 'unwatch' | 'watching', payload: string | null): Promise<void> {
  const db = bot.db;
  const address = payload !== null && ADDRESS.test(payload) ? payload.toLowerCase() : null;
  if (name === 'watching') {
    const { results } = await db.prepare('SELECT address FROM stake_watch WHERE chat_id = ? ORDER BY created_at').bind(chatId).all<{ address: string }>();
    await send(bot, chatId, results.length === 0 ? 'You aren’t watching any staking address. Send /watch 0x… to get claim-window reminders.' : `Watching:\n${results.map((r) => r.address).join('\n')}`);
    return;
  }
  if (name === 'unwatch') {
    const res = address === null ? await db.prepare('DELETE FROM stake_watch WHERE chat_id = ?').bind(chatId).run() : await db.prepare('DELETE FROM stake_watch WHERE chat_id = ? AND address = ?').bind(chatId, address).run();
    await send(bot, chatId, res.meta.changes === 0 ? 'Nothing to stop: that address isn’t on your watch list.' : address === null ? 'Stopped every claim-window reminder.' : `Stopped watching ${short(address)}.`);
    return;
  }
  if (address === null) {
    await send(bot, chatId, 'Send /watch with a staking address: /watch 0x… (0x and 40 hex characters).');
    return;
  }
  const count = await db.prepare('SELECT COUNT(*) AS n FROM stake_watch WHERE chat_id = ?').bind(chatId).first<{ n: number }>();
  const already = await db.prepare('SELECT 1 AS x FROM stake_watch WHERE chat_id = ? AND address = ?').bind(chatId, address).first();
  if (!already && (count?.n ?? 0) >= MAX_WATCHES) {
    await send(bot, chatId, `You're watching ${MAX_WATCHES} addresses, the most there is room for. Send /unwatch 0x… to drop one.`);
    return;
  }
  const clock = await readClock(bot, address);
  // A window already open when you start watching counts as announced: the reply says so.
  const opened = clock.kind === 'open' ? clock.unbondingAt : null;
  await db
    .prepare('INSERT INTO stake_watch (chat_id, address, created_at, opened_for) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, address) DO NOTHING')
    .bind(chatId, address, bot.now().toISOString(), opened)
    .run();
  await send(bot, chatId, `${already ? 'Already watching. ' : ''}${clockText(address, clock)}\nSend /unwatch ${address} to stop.`);
}

interface WatchRow {
  chat_id: number;
  address: string;
  opened_for: string | null;
  closing_for: string | null;
}

/** The cron's pass over every watch: an opening reminder once per unbonding, then a closing one in its last day. */
export async function stakeWatchJob(bot: TelegramBot): Promise<void> {
  if (!bot.settings.open) return;
  try {
    const { results } = await bot.db.prepare('SELECT chat_id, address, opened_for, closing_for FROM stake_watch').all<WatchRow>();
    if (results.length === 0) return;
    const staking = await bot.data.load('staking.json');
    const shards = new Map<string, StakersFile>();
    for (const name of new Set(results.map((r) => stakerShard(r.address)))) shards.set(name, await bot.data.load(name));
    const now = bot.now();
    for (const r of results) {
      const clock = clockOf(shards.get(stakerShard(r.address))!, staking.periods, r.address, now);
      if (clock.kind !== 'open') continue;
      if (r.opened_for !== clock.unbondingAt && (await send(bot, r.chat_id, openedText(r.address, clock)))) {
        await bot.db.prepare('UPDATE stake_watch SET opened_for = ? WHERE chat_id = ? AND address = ?').bind(clock.unbondingAt, r.chat_id, r.address).run();
      }
      if (r.closing_for !== clock.unbondingAt && Date.parse(clock.closesAt) - now.getTime() <= CLOSING_NOTICE_MS && (await send(bot, r.chat_id, closingText(r.address, clock)))) {
        await bot.db.prepare('UPDATE stake_watch SET closing_for = ? WHERE chat_id = ? AND address = ?').bind(clock.unbondingAt, r.chat_id, r.address).run();
      }
    }
  } catch (err) {
    await bot.alert('stake-watch', `Claim-window reminders failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
