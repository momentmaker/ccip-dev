import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { STICKERS_PER_RUN, stickerJob } from '../src/stickers';
import type { TelegramResult } from '../src/telegram-api';
import { fakeRenderer, fakeTelegram, fakeTelegramBot, OWNER_ID, resetStorage, seedMarine, TG_SETTINGS, tgError, tgOk } from './helpers';

/**
 * Telegram's sticker packs, held in memory: uploads get file ids, packs hold their stickers in order. `fail` answers a
 * method from a table first, by call count, so a test can fail the nth call.
 */
function packs(fail: Record<string, (n: number) => TelegramResult<unknown> | null> = {}) {
  const sets = new Map<string, string[]>();
  const counts: Record<string, number> = {};
  let uploads = 0;
  const failing = (method: string) => fail[method]?.((counts[method] = (counts[method] ?? 0) + 1)) ?? null;
  const tg = fakeTelegram({
    uploadStickerFile: () => failing('uploadStickerFile') ?? tgOk({ file_id: `up${++uploads}` }),
    createNewStickerSet: (b) => {
      const name = String(b.name);
      if (sets.has(name)) return tgError(400, 'Bad Request: sticker set name is already occupied');
      const failed = failing('createNewStickerSet');
      if (failed) return failed;
      sets.set(name, [`in-${(b.stickers as { sticker: string }[])[0]!.sticker}`]);
      return tgOk(true);
    },
    addStickerToSet: (b) => {
      const failed = failing('addStickerToSet');
      if (failed && !(failed.ok === false && failed.status === 0 && failed.description === 'lost')) return failed;
      sets.get(String(b.name))!.push(`in-${(b.sticker as { sticker: string }).sticker}`);
      return failed ?? tgOk(true);
    },
    getStickerSet: (b) => failing('getStickerSet') ?? (sets.has(String(b.name)) ? tgOk({ stickers: sets.get(String(b.name))!.map((file_id) => ({ file_id })) }) : tgError(400, 'Bad Request: STICKERSET_INVALID')),
  });
  return { tg, sets };
}

const LOST = tgError(0, 'lost');

async function stickers(): Promise<[number, string | null, string | null][]> {
  const { results } = await env.DB.prepare('SELECT serial, sticker_set, sticker_file_id FROM marines ORDER BY serial').all<{ serial: number; sticker_set: string | null; sticker_file_id: string | null }>();
  return results.map((r) => [r.serial, r.sticker_set, r.sticker_file_id]);
}

async function runLock(): Promise<string | null> {
  return (await env.DB.prepare("SELECT value FROM meta WHERE key = 'sticker-run'").first<{ value: string }>())?.value ?? null;
}

const CALLSIGNS = ['sergey-pepe-comfy', 'painting-space-prophecy', 'sergey-painting-space'];
const MEMES = JSON.stringify([
  { tag: 'sergey', file: 's1.jpeg', key: 'memes/s1.jpeg.png' },
  { tag: 'pepe', file: 'p1.jpeg', key: 'memes/p1.jpeg.png' },
  { tag: 'comfy', file: 'c1.png', key: 'memes/c1.png.png' },
]);

/** A Marine straight into D1, its callsign its own tag key, so any number of them can be enlisted. */
async function insertMarine(platform: string, userId: string, callsign: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO marines (platform, user_id, callsign, tag_key, tags, tier, score, percentile, memes, blood, faith, display_name, snapshot_version, enlisted_at)
     VALUES (?1, ?2, ?3, ?3, '["sergey","pepe","comfy"]', 'common', 15, 40, ?4, 'LINK+', '4IR', 'Ada', 3, '2026-10-13T10:40:00.000Z')`,
  )
    .bind(platform, userId, callsign, MEMES)
    .run();
}

beforeEach(resetStorage);

describe('the sticker job', () => {
  it('creates Vol. 1 with the first sticker, as the owner, then adds the next, recording each', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg, sets } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    const create = tg.calls.find((c) => c.method === 'createNewStickerSet')!.body;
    expect({
      create: [create.user_id, create.name, create.title, create.stickers],
      added: tg.calls.filter((c) => c.method === 'addStickerToSet').map((c) => c.body.name),
      pack: sets.get('linkmarines_by_ccipdevbot'),
      recorded: await stickers(),
    }).toEqual({
      create: [OWNER_ID, 'linkmarines_by_ccipdevbot', 'LinkMarines Vol. 1 · ccip.dev', [{ sticker: 'up1', format: 'static', emoji_list: ['🎖'] }]],
      added: ['linkmarines_by_ccipdevbot'],
      pack: ['in-up1', 'in-up2'],
      recorded: [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', 'in-up2'],
      ],
    });
  });

  it('starts Vol. 2 at serial 121', async () => {
    // #given the next Marine is #121
    await env.DB.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('marines', 120)").run();
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg, sets } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    expect([[...sets.keys()], await stickers()]).toEqual([['linkmarines2_by_ccipdevbot'], [[121, 'linkmarines2_by_ccipdevbot', 'in-up1']]]);
  });

  it('never adds a sticker twice', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg } = packs();
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    await stickerJob(bot);
    // #then
    expect(tg.calls.filter((c) => c.method === 'uploadStickerFile').length).toBe(1);
  });

  it('settles a sticker whose answer was lost from the pack itself on the next run, adding nothing again', async () => {
    // #given the add reaches Telegram, but its answer is lost
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg, sets } = packs({ addStickerToSet: (n) => (n === 1 ? LOST : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    const afterFirst = await stickers();
    await stickerJob(bot);
    // #then
    expect({ afterFirst, after: await stickers(), pack: sets.get('linkmarines_by_ccipdevbot'), alerts: bot.alerts.map((a) => a.signature) }).toEqual({
      afterFirst: [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', null],
      ],
      after: [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', 'in-up2'],
      ],
      pack: ['in-up1', 'in-up2'],
      alerts: ['telegram-sticker:2'],
    });
  });

  it('makes a Marine due again when a lost add never reached the pack', async () => {
    // #given an add whose answer is lost before Telegram acts
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg, sets } = packs({ addStickerToSet: (n) => (n === 1 ? tgError(0, 'request failed (TimeoutError)') : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    await stickerJob(bot);
    await stickerJob(bot);
    // #then
    expect([await stickers(), sets.get('linkmarines_by_ccipdevbot')]).toEqual([
      [
        [1, 'linkmarines_by_ccipdevbot', 'in-up1'],
        [2, 'linkmarines_by_ccipdevbot', 'in-up3'],
      ],
      ['in-up1', 'in-up3'],
    ]);
  });

  it('leaves a Marine who enlists during a run for the next run, after the ones already queued', async () => {
    // #given two Marines, and a third who enlists while the first sticker is drawn
    await insertMarine('discord', 'u1', 'marine-1');
    await insertMarine('discord', 'u2', 'marine-2');
    const { tg, sets } = packs();
    const renderer = fakeRenderer();
    let enlisted = false;
    const bot = fakeTelegramBot({
      tg,
      renderer: {
        ...renderer,
        renderMarineSticker: async (card) => {
          if (!enlisted) await insertMarine('telegram', '777000111', 'marine-3');
          enlisted = true;
          return renderer.renderMarineSticker(card);
        },
      },
    });
    // #when
    await stickerJob(bot);
    const firstRun = (await stickers()).map((s) => s[2]);
    await stickerJob(bot);
    // #then
    expect([firstRun, sets.get('linkmarines_by_ccipdevbot')]).toEqual([['in-up1', 'in-up2', null], ['in-up1', 'in-up2', 'in-up3']]);
  });

  it('stops the run at a 429, quietly, for the next run to go on', async () => {
    // #given
    for (const [i, c] of CALLSIGNS.slice(0, 3).entries()) await seedMarine(`m${i}`, 'x', c);
    const { tg } = packs({ uploadStickerFile: (n) => (n === 2 ? tgError(429, 'Too Many Requests: retry after 30', 30) : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    // #then
    expect({ uploads: tg.calls.filter((c) => c.method === 'uploadStickerFile').length, recorded: (await stickers()).map((s) => s[2] !== null), alerts: bot.alerts }).toEqual({
      uploads: 2,
      recorded: [true, false, false],
      alerts: [],
    });
  });

  it('alerts telegram-sticker:<serial> on any other failure, and goes on with the next Marine', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    await seedMarine('b', 'rory', CALLSIGNS[1]!);
    const { tg } = packs({ createNewStickerSet: (n) => (n === 1 ? tgError(400, 'Bad Request: STICKER_PNG_DIMENSIONS') : null) });
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    // #then
    expect({ alerts: bot.alerts.map((a) => [a.signature, a.text.includes('STICKER_PNG_DIMENSIONS')]), recorded: await stickers() }).toEqual({
      alerts: [['telegram-sticker:1', true]],
      recorded: [
        [1, null, null],
        [2, 'linkmarines_by_ccipdevbot', 'in-up2'],
      ],
    });
  });

  it('alerts and goes on when a sticker cannot be drawn', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const bot = fakeTelegramBot({ tg: packs().tg, renderer: fakeRenderer('renderMarineSticker') });
    // #when
    await stickerJob(bot);
    // #then
    expect([bot.alerts.map((a) => a.signature), await stickers()]).toEqual([['telegram-sticker:1'], [[1, null, null]]]);
  });

  it(`backfills oldest first, ${STICKERS_PER_RUN} a run`, async () => {
    // #given twelve Marines
    for (let i = 1; i <= 12; i++) await insertMarine('discord', `u${i}`, `marine-${i}`);
    const { tg } = packs();
    const bot = fakeTelegramBot({ tg });
    // #when
    await stickerJob(bot);
    const firstRun = (await stickers()).filter((s) => s[2] !== null).map((s) => s[0]);
    await stickerJob(bot);
    // #then
    expect([firstRun, (await stickers()).filter((s) => s[2] !== null).length]).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 12]);
  });

  it('tells a Telegram Marine their sticker number, with the sticker and the pack, and tells a Discord Marine nothing', async () => {
    // #given a Discord Marine, then a Telegram one
    await insertMarine('discord', 'a', 'marine-1');
    await insertMarine('telegram', '777000111', 'marine-2');
    const { tg } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    expect(tg.calls.filter((c) => c.method.startsWith('send')).map((c) => [c.method, c.body.chat_id, c.body.text ?? c.body.sticker, c.body.reply_markup])).toEqual([
      ['sendMessage', '777000111', "You're sticker #2 in LinkMarines Vol. 1", undefined],
      ['sendSticker', '777000111', 'in-up2', { inline_keyboard: [[{ text: 'Add the pack', url: 'https://t.me/addstickers/linkmarines_by_ccipdevbot' }]] }],
    ]);
  });

  it('does nothing while LinkMarines on Telegram is off, claiming no run', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, open: false } }));
    // #then
    expect([tg.calls, await runLock()]).toEqual([[], null]);
  });

  it('does nothing while there is no sticker owner, claiming no run', async () => {
    // #given
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg } = packs();
    // #when
    await stickerJob(fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, ownerId: null } }));
    // #then
    expect([tg.calls, await runLock()]).toEqual([[], null]);
  });

  it('does nothing while another run holds the lock, and leaves that lock as it is', async () => {
    // #given a run that started a minute ago
    await seedMarine('a', 'momentmaker', CALLSIGNS[0]!);
    const { tg } = packs();
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('sticker-run', '2026-10-13T10:39:00.000Z')").run();
    // #when
    await stickerJob(fakeTelegramBot({ tg }));
    // #then
    expect([tg.calls, await runLock()]).toEqual([[], '2026-10-13T10:39:00.000Z']);
  });
});
