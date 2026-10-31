import { STAKING_FIXTURE } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_WATCHES, stakeWatchCommand, stakeWatchJob } from '../src/stake-watch';
import { handleUpdate } from '../src/telegram-bot';
import { fakeTelegramBot, resetStorage, TG_SETTINGS } from './helpers';

beforeEach(resetStorage);

const CHAT = 777000111;
const A = '0x00000000000000000000000000000000000000aa';
const B = '0x00000000000000000000000000000000000000bb';
// A started unbonding on Oct 10: its window opens Nov 7 and closes Nov 14. B is staked and not unbonding.
const SHARD = {
  ...STAKING_FIXTURE,
  as_of_block: 1,
  stakers: [
    [A, 'c', 15_000, '2023-12-01T00:00:00.000Z', '2026-10-10T00:00:00.000Z', 'wallet', 120, 1, 0],
    [B, 'c', 2_000, '2024-02-01T00:00:00.000Z', null, 'wallet', 7_000, 4_000, 0],
  ],
};

function bot(now: string) {
  const b = fakeTelegramBot({ data: { load: async (name: string) => (name === 'staking.json' ? STAKING_FIXTURE : SHARD) } as never });
  b.clock.ms = Date.parse(now);
  return b;
}
const texts = (b: ReturnType<typeof bot>) => b.tg.calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.body.text));
const rows = async () => (await env.DB.prepare('SELECT chat_id, address, opened_for, closing_for FROM stake_watch ORDER BY address').all()).results;

describe('/watch', () => {
  it('watches an address and says where its exit clock stands', async () => {
    const b = bot('2026-11-02T14:00:00.000Z');
    await stakeWatchCommand(b, CHAT, 'watch', A.toUpperCase().replace('0X', '0x'));
    expect(texts(b)[0]).toContain('0x0000…00aa is unbonding 15,000 LINK. Its claim window opens Sat, Nov 7, 00:00 UTC and closes Sat, Nov 14, 00:00 UTC.');
    expect(await rows()).toEqual([{ chat_id: CHAT, address: A, opened_for: null, closing_for: null }]);
  });

  it('turns away a bad address and a sixth watch, and lists and drops watches', async () => {
    const b = bot('2026-11-02T14:00:00.000Z');
    await stakeWatchCommand(b, CHAT, 'watch', '0x12');
    for (let i = 0; i < MAX_WATCHES; i++) await stakeWatchCommand(b, CHAT, 'watch', `0x${String(i).padStart(40, '1')}`);
    await stakeWatchCommand(b, CHAT, 'watch', B);
    await stakeWatchCommand(b, CHAT, 'watching', null);
    await stakeWatchCommand(b, CHAT, 'unwatch', `0x${'0'.padStart(40, '1')}`);
    await stakeWatchCommand(b, CHAT, 'unwatch', null);
    const t = texts(b);
    expect(t[0]).toContain('Send /watch with a staking address');
    expect(t[6]).toContain(`You're watching ${MAX_WATCHES} addresses`);
    expect(t[7]!.split('\n')).toHaveLength(MAX_WATCHES + 1);
    expect([t[8], t[9]]).toEqual(['Stopped watching 0x1111…1110.', 'Stopped every claim-window reminder.']);
    expect(await rows()).toEqual([]);
  });

  it('only answers in a private chat', async () => {
    const b = bot('2026-11-02T14:00:00.000Z');
    const group = { id: -1001234, type: 'channel' as const, username: 'ccipdev' };
    await handleUpdate({ ...b, settings: TG_SETTINGS }, { update_id: 1, message: { from: { id: CHAT }, chat: group, text: `/watch ${A}` } });
    await handleUpdate(b, { update_id: 2, message: { from: { id: CHAT }, chat: { id: CHAT, type: 'private' }, text: `/watch ${A}` } });
    expect(await rows()).toHaveLength(1);
  });
});

describe('the reminder job', () => {
  it('sends the opening reminder once, then the closing one in the window’s last day', async () => {
    await stakeWatchCommand(bot('2026-11-02T14:00:00.000Z'), CHAT, 'watch', A);
    const sent: string[] = [];
    for (const now of ['2026-11-06T23:50:00.000Z', '2026-11-07T00:10:00.000Z', '2026-11-08T00:10:00.000Z', '2026-11-13T00:10:00.000Z', '2026-11-13T12:00:00.000Z']) {
      const b = bot(now);
      await stakeWatchJob(b);
      sent.push(...texts(b).map((t) => `${now.slice(5, 10)} ${[...t][0]}`));
    }
    expect(sent).toEqual(['11-07 🔓', '11-13 ⏳']);
    expect(await rows()).toEqual([{ chat_id: CHAT, address: A, opened_for: '2026-10-10T00:00:00.000Z', closing_for: '2026-10-10T00:00:00.000Z' }]);
  });

  it('does nothing while LinkMarines on Telegram is off, and retries a reminder Telegram refused', async () => {
    await stakeWatchCommand(bot('2026-11-02T14:00:00.000Z'), CHAT, 'watch', A);
    const off = { ...bot('2026-11-08T00:00:00.000Z'), settings: { ...TG_SETTINGS, open: false } };
    await stakeWatchJob(off);
    expect(off.tg.calls).toEqual([]);
    const refused = bot('2026-11-08T00:00:00.000Z');
    refused.tg = { ...refused.tg, call: async (method: string, body: Record<string, unknown>) => (refused.tg.calls.push({ method, body }), { ok: false, status: 403, description: 'blocked', retryAfter: null }) } as never;
    await stakeWatchJob(refused);
    expect((await rows())[0]).toMatchObject({ opened_for: null });
  });
});
