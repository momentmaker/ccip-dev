import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import worker from '../src/index';
import { alertTelegramSetup, claimUpdate, handleUpdate, parseCommand, pruneClaims, telegramWebhook, webhookSecretMatches, type TelegramChat, type TelegramUpdate } from '../src/telegram-bot';
import { fakeTelegram, fakeTelegramBot, OWNER_ID, resetStorage, TG_SETTINGS, tgError } from './helpers';

const SECRET = 'webhook-secret_123';
const DM: TelegramChat = { id: 777000111, type: 'private' };
const CCIPDEV: TelegramChat = { id: -1001234, type: 'channel', username: 'ccipdev' };
const MARINE_GROUP: TelegramChat = { id: -1005555, type: 'supergroup' };
const STRANGERS: TelegramChat = { id: -1009999, type: 'group' };
const ALERTS: TelegramChat = { id: -1007777, type: 'group' };
const SETTINGS = { ...TG_SETTINGS, gateChats: ['@ccipdev', String(MARINE_GROUP.id)] };

const message = (chat: TelegramChat, text: string, from = 777000111, update_id = 1): TelegramUpdate => ({ update_id, message: { from: { id: from }, chat, text } });
const added = (chat: TelegramChat, from: number, status = 'member'): TelegramUpdate => ({ update_id: 2, my_chat_member: { from: { id: from }, chat, new_chat_member: { status } } });
const hook = (update: unknown, secret: string | null = SECRET) =>
  new Request('https://discord.ccip.dev/telegram', { method: 'POST', body: JSON.stringify(update), headers: secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret } });

const DAY_MS = 86_400_000;
const metaKeys = async () => (await env.DB.prepare('SELECT key FROM meta ORDER BY key').all<{ key: string }>()).results.map((r) => r.key);

/** A day-old and a fresh claim of each kind, and old rows of other kinds that the prune must leave alone however old they are. */
async function seedMeta(now: Date): Promise<void> {
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const row = (key: string, value: string) => env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind(key, value);
  await env.DB.batch([
    row('tg-update:1', at(DAY_MS + 1)),
    row('tg-update:2', at(1_000)),
    row('tg-stamp:7', at(DAY_MS + 1)),
    row('tg-stamp:8', at(1_000)),
    row('sticker-run', '2020-01-01T00:00:00.000Z'),
    row('alert:telegram-update', '2020-01-01T00:00:00.000Z'),
  ]);
}

beforeEach(resetStorage);

describe('the webhook', () => {
  it('answers 401 without the secret header, or with a wrong one, and 200 at once with it, working after', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    const work: Promise<unknown>[] = [];
    // #when
    const answers = await Promise.all([telegramWebhook(hook(message(DM, '/start'), null), bot, SECRET, () => {}), telegramWebhook(hook(message(DM, '/start'), 'wrong'), bot, SECRET, () => {}), telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p))]);
    const before = bot.tg.calls.length;
    await Promise.all(work);
    // #then
    expect([answers.map((r) => r.status), before, bot.tg.calls.map((c) => c.method)]).toEqual([[401, 401, 200], 0, ['sendMessage']]);
  });

  it('compares the secret in constant time, and refuses everything while no secret is set', async () => {
    // #then
    expect(await Promise.all([webhookSecretMatches(SECRET, SECRET), webhookSecretMatches(SECRET, `${SECRET}x`), webhookSecretMatches('', ''), webhookSecretMatches(SECRET, null)])).toEqual([true, false, false, false]);
  });

  it('drops every update while TELEGRAM_BOT is off', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...SETTINGS, open: false } });
    const work: Promise<unknown>[] = [];
    // #when
    const res = await telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p));
    // #then
    expect([res.status, work.length]).toEqual([200, 0]);
  });

  it('handles each update once, even when Telegram redelivers it while the first is still running', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    const work: Promise<unknown>[] = [];
    // #when the same update arrives three times, two at once
    await Promise.all([telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p)), telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p))]);
    await Promise.all(work);
    await telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p));
    await Promise.all(work);
    // #then
    expect(bot.tg.calls.length).toBe(1);
  });

  it('alerts telegram-update when an update fails', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS, db: { prepare: () => { throw new Error('D1 is down'); } } as unknown as D1Database });
    const work: Promise<unknown>[] = [];
    // #when
    await telegramWebhook(hook(message(DM, '/start')), bot, SECRET, (p) => void work.push(p));
    await Promise.all(work);
    // #then
    expect(bot.alerts.map((a) => a.signature)).toEqual(['telegram-update']);
  });

  it('is reached at /telegram through the Worker, which needs TELEGRAM_WEBHOOK_SECRET', async () => {
    // #given
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const handle = (environment: typeof env) => worker.fetch(hook(message(DM, '/start')) as Parameters<typeof worker.fetch>[0], environment, ctx);
    // #when
    const answers = await Promise.all([handle(env), handle({ ...env, TELEGRAM_WEBHOOK_SECRET: SECRET })]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([401, 200]);
  });

  it('drops update and stamp claims older than a day, and nothing else', async () => {
    // #given
    const now = new Date('2026-10-15T12:00:00.000Z');
    await seedMeta(now);
    // #when
    await pruneClaims(env.DB, now);
    // #then
    expect(await metaKeys()).toEqual(['alert:telegram-update', 'sticker-run', 'tg-stamp:8', 'tg-update:2']);
  });

  it('answers a request that is not a POST with 405', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    const res = await telegramWebhook(new Request('https://discord.ccip.dev/telegram', { headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET } }), bot, SECRET, () => {});
    // #then
    expect([res.status, res.headers.get('Allow')]).toEqual([405, 'POST']);
  });

  it('answers 200 and does no work for a body that is not JSON', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    const work: Promise<unknown>[] = [];
    // #when
    const res = await telegramWebhook(new Request('https://discord.ccip.dev/telegram', { method: 'POST', body: 'not json', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET } }), bot, SECRET, (p) => void work.push(p));
    // #then
    expect([res.status, work.length]).toEqual([200, 0]);
  });

  it('answers 200 and drops an authenticated body past the cap, so Telegram does not retry it', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    const work: Promise<unknown>[] = [];
    const oversized = { ...message(DM, '/start'), padding: 'x'.repeat(70_000) };
    // #when
    const res = await telegramWebhook(hook(oversized), bot, SECRET, (p) => void work.push(p));
    // #then
    expect([res.status, work.length]).toEqual([200, 0]);
  });
});

describe('the thin bot', () => {
  it('answers /start in a DM with a button that opens the Mini App, carrying a known payload as startapp', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    for (const text of ['/start', '/start marine_42', '/start whatever']) await handleUpdate(bot, message(DM, text));
    // #then
    expect(bot.tg.calls.map((c) => [c.body.chat_id, c.body.text, c.body.reply_markup])).toEqual(
      ['https://ccip.dev/tg/', 'https://ccip.dev/tg/?startapp=marine_42', 'https://ccip.dev/tg/'].map((url) => [
        DM.id,
        'Enlist and get your LinkMarine dog tag.',
        { inline_keyboard: [[{ text: 'Open LinkMarines', web_app: { url } }]] },
      ]),
    );
  });

  it('answers /start in a LinkMarine group with a link to the Mini App, and ignores a command for another bot', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(MARINE_GROUP, '/start@ccipdevbot tag_pepe'));
    await handleUpdate(bot, message(MARINE_GROUP, '/start@otherbot'));
    // #then
    expect(bot.tg.calls.map((c) => c.body.reply_markup)).toEqual([{ inline_keyboard: [[{ text: 'Open LinkMarines', url: 'https://t.me/ccipdevbot/marines?startapp=tag_pepe' }]] }]);
  });

  it('tells /id to the owner anywhere and in a LinkMarine chat, and to nobody else', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(MARINE_GROUP, '/id'));
    await handleUpdate(bot, message(DM, '/id', OWNER_ID));
    await handleUpdate(bot, message(STRANGERS, '/id', OWNER_ID));
    await handleUpdate(bot, message(DM, '/id'));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.text])).toEqual([
      ['sendMessage', `This chat's ID: ${MARINE_GROUP.id}`],
      ['sendMessage', `This chat's ID: ${DM.id}`],
      ['sendMessage', `This chat's ID: ${STRANGERS.id}`],
    ]);
  });

  it('leaves a group it is added to by anyone but the owner, unless the group is on the list', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, added(STRANGERS, 777000111));
    await handleUpdate(bot, added(STRANGERS, OWNER_ID));
    await handleUpdate(bot, added(MARINE_GROUP, 777000111, 'administrator'));
    await handleUpdate(bot, added(CCIPDEV, 777000111, 'administrator'));
    await handleUpdate(bot, added(STRANGERS, 777000111, 'left'));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.chat_id])).toEqual([['leaveChat', STRANGERS.id]]);
  });

  it('stays in the alert chat when anyone adds it or sends a command there, and still leaves any other group', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...SETTINGS, alertChatId: String(ALERTS.id) } });
    // #when
    await handleUpdate(bot, added(ALERTS, 777000111));
    await handleUpdate(bot, message(ALERTS, '/id', 777000111));
    await handleUpdate(bot, message(STRANGERS, '/id', 777000111));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.chat_id])).toEqual([['leaveChat', STRANGERS.id]]);
  });

  it('leaves a group not on the list where a command reaches it', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS, tg: fakeTelegram({ leaveChat: () => tgError(400, 'Bad Request: chat not found') }) });
    // #when
    await handleUpdate(bot, message(STRANGERS, '/start'));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.chat_id])).toEqual([['leaveChat', STRANGERS.id]]);
  });

  it('parses a command word whole, for us or for no bot', () => {
    // #then
    expect(['/start', '/START', '/start@ccipdevbot', '/Start@CcipDevBot marine_42', '/start marine_42', '/id', '/help'].map(parseCommand)).toEqual([
      { name: 'start', payload: null },
      { name: 'start', payload: null },
      { name: 'start', payload: null },
      { name: 'start', payload: 'marine_42' },
      { name: 'start', payload: 'marine_42' },
      { name: 'id', payload: null },
      { name: 'help', payload: null },
    ]);
  });

  it('does not take a longer word, or a command for another bot, for one of ours', () => {
    // #then
    expect(['/start_now', '/start2', '/start-x', '/id_card', '/id?', '/start@', '/start@otherbot', '/start@ccipdevbot_evil', '/start@ccipdevbot-evil', 'start', ''].map(parseCommand)).toEqual(Array(11).fill(null));
  });

  it('ignores a longer word that starts like a command of ours', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(DM, '/start_now'));
    await handleUpdate(bot, message(DM, '/start2'));
    await handleUpdate(bot, message(MARINE_GROUP, '/id_card'));
    // #then
    expect(bot.tg.calls).toEqual([]);
  });

  it('warns with the method, status and description when the Bot API refuses a send or a leave, and alerts nothing', async () => {
    // #given
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const tg = fakeTelegram({ sendMessage: () => tgError(403, 'Forbidden: bot was blocked by the user'), leaveChat: () => tgError(400, 'Bad Request: chat not found') });
    const bot = fakeTelegramBot({ settings: SETTINGS, tg });
    // #when
    await handleUpdate(bot, message(DM, '/start'));
    await handleUpdate(bot, message(MARINE_GROUP, '/id'));
    await handleUpdate(bot, message(STRANGERS, '/start'));
    await handleUpdate(bot, added(STRANGERS, 777000111));
    // #then
    expect([warn.mock.calls.map((c) => c.join(' ')), bot.alerts]).toEqual([
      [
        'telegram sendMessage failed (403): Forbidden: bot was blocked by the user',
        'telegram sendMessage failed (403): Forbidden: bot was blocked by the user',
        'telegram leaveChat failed (400): Bad Request: chat not found',
        'telegram leaveChat failed (400): Bad Request: chat not found',
      ],
      [],
    ]);
  });

  it('stays quiet when the Bot API answers', async () => {
    // #given
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(DM, '/start'));
    await handleUpdate(bot, added(STRANGERS, 777000111));
    // #then
    expect(warn).not.toHaveBeenCalled();
  });

  it('counts any status but left and kicked as being in the chat, so a restricted add leaves too', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    for (const status of ['restricted', 'kicked', 'left']) await handleUpdate(bot, added(STRANGERS, 777000111, status));
    // #then
    expect(bot.tg.calls.map((c) => [c.method, c.body.chat_id])).toEqual([['leaveChat', STRANGERS.id]]);
  });

  it('says nothing to plain text', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await handleUpdate(bot, message(DM, 'hello'));
    await handleUpdate(bot, { update_id: 9 });
    // #then
    expect(bot.tg.calls).toEqual([]);
  });
});

describe('a setup left unfinished', () => {
  const ON_BUT = 'LinkMarines on Telegram is on, but ';
  const OWNER_MISSING = `TELEGRAM_STICKER_OWNER_ID is empty, so the sticker packs can't be made: set it in discord/wrangler.toml and deploy (runbook, "LinkMarines on Telegram", one-time setup step 3)`;
  const SECRET_MISSING = `TELEGRAM_WEBHOOK_SECRET is not set on the Worker, so the bot can't hear /start: put it there with the wrangler secret put line (runbook, "LinkMarines on Telegram", one-time setup step 4)`;

  it('alerts telegram-setup naming the sticker owner and the runbook step that sets it, while the owner is empty', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...SETTINGS, ownerId: null } });
    // #when
    await alertTelegramSetup(bot, SECRET);
    // #then
    expect(bot.alerts).toEqual([{ signature: 'telegram-setup', text: ON_BUT + OWNER_MISSING }]);
  });

  it('alerts telegram-setup naming the webhook secret and the runbook step that sets it, while the Worker has none', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await alertTelegramSetup(bot, '');
    // #then
    expect(bot.alerts).toEqual([{ signature: 'telegram-setup', text: ON_BUT + SECRET_MISSING }]);
  });

  it('names both in one alert when both are missing, since an alert is sent once an hour per signature', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...SETTINGS, ownerId: null } });
    // #when
    await alertTelegramSetup(bot, '');
    // #then
    expect(bot.alerts).toEqual([{ signature: 'telegram-setup', text: `${ON_BUT}${OWNER_MISSING}; ${SECRET_MISSING}` }]);
  });

  it('alerts nothing once both are set', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: SETTINGS });
    // #when
    await alertTelegramSetup(bot, SECRET);
    // #then
    expect(bot.alerts).toEqual([]);
  });

  it('alerts nothing while the switch is off, whatever is missing', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...SETTINGS, open: false, ownerId: null } });
    // #when
    await alertTelegramSetup(bot, '');
    // #then
    expect(bot.alerts).toEqual([]);
  });
});

describe('the cron', () => {
  const cron = async (environment: typeof env, scheduledTime: Date) => {
    const work: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void work.push(p), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    await worker.scheduled(createScheduledController({ scheduledTime, cron: '*/10 * * * *' }), environment, ctx);
    await Promise.allSettled(work);
  };

  it('drops claims older than a day as of the time it was scheduled for, not the wall clock', async () => {
    // #given a time far from the clock, so a prune that used the clock would drop the fresh claims too
    const scheduledTime = new Date('2026-01-01T12:00:00.000Z');
    await seedMeta(scheduledTime);
    // #when
    await cron(env, scheduledTime);
    // #then
    expect(await metaKeys()).toEqual(['alert:telegram-update', 'sticker-run', 'tg-stamp:8', 'tg-update:2']);
  });

  it('still runs the sticker job when the prune fails', async () => {
    // #given a stale sticker-run lock, which a run that starts takes over and lets go of when done
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('sticker-run', ?)").bind(new Date(Date.now() - 20 * 60_000).toISOString()).run();
    const failingPrune = {
      prepare: (sql: string) => {
        if (sql.includes('tg-update')) throw new Error('D1 is down');
        return env.DB.prepare(sql);
      },
    } as unknown as D1Database;
    // #when
    await cron({ ...env, DB: failingPrune, TELEGRAM_BOT: 'on', TELEGRAM_STICKER_OWNER_ID: '42', TELEGRAM_WEBHOOK_SECRET: SECRET }, new Date());
    // #then
    expect(await env.DB.prepare("SELECT value FROM meta WHERE key = 'sticker-run'").first()).toBeNull();
  });

  describe('on a setup left unfinished', () => {
    const logged = () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      onTestFinished(() => warn.mockRestore());
      return () => warn.mock.calls.map((c) => c.join(' '));
    };
    const alertRow = () => env.DB.prepare("SELECT key FROM meta WHERE key = 'alert:telegram-setup'").first();

    it('alerts telegram-setup while the switch is on and the sticker owner is empty, though the sticker job has nothing to do', async () => {
      // #given
      const warnings = logged();
      // #when
      await cron({ ...env, TELEGRAM_BOT: 'on', TELEGRAM_STICKER_OWNER_ID: '', TELEGRAM_WEBHOOK_SECRET: SECRET }, new Date());
      // #then
      expect({ warnings: warnings(), claimed: await alertRow() }).toEqual({ warnings: [expect.stringContaining('TELEGRAM_STICKER_OWNER_ID is empty')], claimed: { key: 'alert:telegram-setup' } });
    });

    it('alerts telegram-setup while the switch is on and the Worker has no webhook secret', async () => {
      // #given
      const warnings = logged();
      // #when
      await cron({ ...env, TELEGRAM_BOT: 'on', TELEGRAM_STICKER_OWNER_ID: '42' }, new Date());
      // #then
      expect({ warnings: warnings(), claimed: await alertRow() }).toEqual({ warnings: [expect.stringContaining('TELEGRAM_WEBHOOK_SECRET is not set')], claimed: { key: 'alert:telegram-setup' } });
    });

    it('alerts nothing while the switch is off', async () => {
      // #given
      const warnings = logged();
      // #when
      await cron({ ...env, TELEGRAM_BOT: 'off', TELEGRAM_STICKER_OWNER_ID: '' }, new Date());
      // #then
      expect({ warnings: warnings(), claimed: await alertRow() }).toEqual({ warnings: [], claimed: null });
    });
  });
});
