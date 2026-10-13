import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Bot } from '../src/bot';
import type { CallsignSnapshot } from '../src/draw';
import { createAlerter } from '../src/alerts';
import { discordApi } from '../src/discord-api';
import { botHandlers } from '../src/index';
import { dogtagCommand, enlistCommand, revealSteps, STEP_MS, TEXT } from '../src/marines';
import { findMarine } from '../src/store';
import { ARCHIVE_ROUTES, command, fakeBot, type FakeBot, fakeFetch, fakeRenderer, GIF_BYTES, PNG_BYTES, resetStorage, SNAPSHOT } from './helpers';

const ME = '1400000000000000004';
const OTHER = '1500000000000000005';
/** Every draw from this snapshot is Legendary. */
const LEGENDARY: CallsignSnapshot = { ...SNAPSHOT, cutoffs: { uncommon: 0, rare: 0, legendary: 0 } };
/** Three tags only, so every Marine after the first clashes. */
const THREE_TAGS: CallsignSnapshot = { ...SNAPSHOT, tags: SNAPSHOT.tags.slice(0, 3) };

const other = (id = OTHER) => command('dogtag', [{ name: 'marine', type: 6, value: id }], {
  data: { name: 'dogtag', options: [{ name: 'marine', type: 6, value: id }], resolved: { users: { [id]: { id, username: 'rory', avatar: null } }, members: { [id]: { nick: 'Rory' } } } },
});

beforeEach(resetStorage);

describe('the reveal', () => {
  it('stamps the tags one by one, a Rare or Legendary banner on the last', () => {
    // #then
    expect([revealSteps(['painting', 'space', 'prophecy'], 'legendary'), revealSteps(['clown', 'rory', 'pepe'], 'common')]).toEqual([
      ['PAINTING ▮▮', 'PAINTING · SPACE ▮', '⚠ LEGENDARY DRAW\nPAINTING · SPACE · PROPHECY'],
      ['CLOWN ▮▮', 'CLOWN · RORY ▮', 'CLOWN · RORY · PEPE'],
    ]);
  });

  it('saves the draw, edits the reply a second apart, then edits in the card with the callsign', async () => {
    // #given
    const bot = fakeBot();
    const t0 = bot.clock.ms;
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    const steps = revealSteps(marine.tags, marine.tier);
    expect({
      calls: bot.discord.calls,
      saved: [marine.serial, marine.displayName, marine.snapshotVersion, marine.cardKey],
      stored: await Promise.all(['cards/1.png', 'avatars/1.png'].map(async (k) => (await env.MARINES.head(k)) !== null)),
    }).toEqual({
      calls: [
        { kind: 'edit', content: TEXT.drawing, at: t0 },
        ...steps.map((content, i) => ({ kind: 'edit', content, at: t0 + (i + 1) * STEP_MS })),
        { kind: 'edit', content: marine.callsign, file: marine.tier === 'rare' || marine.tier === 'legendary' ? 'marine-1.gif' : 'marine-1.png', at: t0 + 4 * STEP_MS },
      ],
      saved: [1, 'moment maker', 3, 'cards/1.png'],
      stored: [true, true],
    });
  });

  it('banners a Legendary draw and posts its glint, keeping the static card beside it, both from one render', async () => {
    // #given
    const bot = fakeBot({ snapshot: LEGENDARY });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const gif = await env.MARINES.get('cards/1.gif');
    expect({
      banner: bot.discord.calls[3]!.content.startsWith('⚠ LEGENDARY DRAW\n'),
      posted: bot.discord.calls.at(-1)!.file,
      gif: gif && [...new Uint8Array(await gif.arrayBuffer())],
      png: (await env.MARINES.head('cards/1.png')) !== null,
      rendered: bot.renderer.calls.filter((c) => c !== 'prepareMeme').sort(),
    }).toEqual({ banner: true, posted: 'marine-1.gif', gif: [...GIF_BYTES], png: true, rendered: ['renderMarineCards'] });
  });

  it('keeps the draw when the card fails to render: says the tag is being stamped, and alerts', async () => {
    // #given
    const bot = fakeBot({ renderer: fakeRenderer('renderMarineCard') });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1), cardKey: marine.cardKey, alerts: bot.alerts.map((a) => a.signature) }).toEqual({
      last: { kind: 'edit', content: TEXT.stamping(marine), at: bot.clock.ms },
      cardKey: null,
      alerts: ['discord-render:marine'],
    });
  });

  it('keeps the draw when GitHub is down: no card, and a discord-memes alert', async () => {
    // #given
    const bot = fakeBot({ fetch: fakeFetch({ 'https://cdn.discordapp.com/': ARCHIVE_ROUTES['https://cdn.discordapp.com/'] }) });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1)!.content, alerts: bot.alerts.map((a) => a.signature), rendered: bot.renderer.calls }).toEqual({ last: TEXT.stamping(marine), alerts: ['discord-memes'], rendered: [] });
  });

  it('answers a Marine who enlists again with their own card, drawing nothing', async () => {
    // #given
    await enlistCommand(fakeBot(), command('enlist'));
    const bot = fakeBot();
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]), rendered: bot.renderer.calls, marines: (await env.DB.prepare('SELECT COUNT(*) AS n FROM marines').first<{ n: number }>())?.n }).toEqual({
      calls: [['edit', TEXT.already, expect.stringMatching(/^marine-1\.(png|gif)$/)]],
      rendered: [],
      marines: 1,
    });
  });

  it('reports privately and alerts when every draw clashes with a callsign already taken', async () => {
    // #given the only three tags are someone else's
    await enlistCommand(fakeBot({ snapshot: THREE_TAGS }), command('enlist', [], { member: { user: { id: OTHER, username: 'rory' } } }));
    const bot = fakeBot({ snapshot: THREE_TAGS });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), alerts: bot.alerts.map((a) => a.signature) }).toEqual({ calls: [['private', TEXT.internal]], alerts: ['discord-draw'] });
  });
});

describe('/dogtag', () => {
  it("shows another member's card from R2, the glint for a Legendary", async () => {
    // #given
    await enlistCommand(fakeBot({ snapshot: LEGENDARY }), command('enlist', [], { member: { user: { id: OTHER, username: 'rory' } } }));
    const bot = fakeBot({ snapshot: LEGENDARY });
    // #when
    await dogtagCommand(bot, other());
    // #then
    const marine = (await findMarine(env.DB, 'discord', OTHER))!;
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]), rendered: bot.renderer.calls }).toEqual({ calls: [['edit', marine.callsign, 'marine-1.gif']], rendered: [] });
  });

  it("says publicly that another member hasn't enlisted, and privately when it is the one asking", async () => {
    // #given
    const [asked, self] = [fakeBot(), fakeBot()];
    // #when
    await dogtagCommand(asked, other());
    await dogtagCommand(self, command('dogtag'));
    // #then
    expect([asked.discord.calls.map((c) => [c.kind, c.content]), self.discord.calls.map((c) => [c.kind, c.content])]).toEqual([
      [['edit', TEXT.notEnlisted('Rory')]],
      [['private', TEXT.notEnlisted('moment maker')]],
    ]);
  });

  it('stamps on demand a card that failed at enlistment, with the avatar kept then', async () => {
    // #given an enlistment whose card failed
    await enlistCommand(fakeBot({ renderer: fakeRenderer('renderMarineCard') }), command('enlist'));
    const bot = fakeBot();
    // #when
    await dogtagCommand(bot, command('dogtag'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    const avatar = await env.MARINES.get('avatars/1.png');
    expect({
      calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]),
      cardKey: marine.cardKey,
      avatar: avatar && [...new Uint8Array(await avatar.arrayBuffer())],
      avatarUrl: bot.fetch.urls.find((u) => u.includes('cdn.discordapp.com')),
    }).toEqual({
      calls: [['edit', marine.callsign, expect.stringMatching(/^marine-1\.(png|gif)$/)]],
      cardKey: 'cards/1.png',
      avatar: [...PNG_BYTES],
      avatarUrl: `https://cdn.discordapp.com/avatars/${ME}/abc.png?size=128`,
    });
  });

  it('stamps on demand without the glint when the glint fails, keeping and posting the static card', async () => {
    // #given a Legendary whose card failed at enlistment
    await enlistCommand(fakeBot({ snapshot: LEGENDARY, renderer: fakeRenderer('renderMarineCard') }), command('enlist'));
    const bot = fakeBot({ snapshot: LEGENDARY, renderer: fakeRenderer('renderMarineGlint') });
    // #when
    await dogtagCommand(bot, command('dogtag'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]), cardKey: marine.cardKey, alerts: bot.alerts.map((a) => [a.signature, a.text]) }).toEqual({
      calls: [['edit', marine.callsign, 'marine-1.png']],
      cardKey: 'cards/1.png',
      alerts: [['discord-render:marine', 'glint for Marine #1 failed: renderMarineGlint failed']],
    });
  });

  it('answers privately when the card still cannot be drawn', async () => {
    // #given
    await enlistCommand(fakeBot({ renderer: fakeRenderer('renderMarineCard') }), command('enlist'));
    const bot = fakeBot({ renderer: fakeRenderer('renderMarineCard') });
    // #when
    await dogtagCommand(bot, command('dogtag'));
    // #then
    expect(bot.discord.calls.map((c) => [c.kind, c.content])).toEqual([['private', TEXT.internal]]);
  });
});

/** Makes the bot's renderer take `ms` on its fake clock to draw a card. */
function slowCards(bot: FakeBot, ms: number): void {
  bot.renderer.renderMarineCards = async () => {
    await bot.sleep(ms);
    return { png: PNG_BYTES, gif: null, glintError: null };
  };
}

/** Makes the bot's Discord refuse the edits `refuse` names, and records the longest wait it was allowed for each edit. */
function refusing(bot: FakeBot, refuse: (content: string, file: string | undefined) => boolean) {
  const inner = bot.discord;
  const waits: (number | undefined)[] = [];
  bot.discord = {
    ...inner,
    async editOriginal(token, content, file, maxWaitMs) {
      waits.push(maxWaitMs);
      if (refuse(content, file?.name)) throw new Error('Discord returned HTTP 413');
      return inner.editOriginal(token, content, file, maxWaitMs);
    },
  };
  return waits;
}

describe('a committed Marine always ends with the card or the stamping line', () => {
  it('goes on when a step edit fails', async () => {
    // #given
    const bot = fakeBot();
    refusing(bot, (content) => content.startsWith('PAINTING') || content.includes(' · '));
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1)!.content, file: bot.discord.calls.at(-1)!.file, alerts: bot.alerts.length }).toEqual({ last: marine.callsign, file: expect.stringMatching(/^marine-1\./), alerts: 0 });
  });

  it('posts the static card when the glint is refused, and says so to the alert chat', async () => {
    // #given
    const bot = fakeBot({ snapshot: LEGENDARY });
    refusing(bot, (_content, file) => file === 'marine-1.gif');
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect({ last: bot.discord.calls.at(-1)!.file, alerts: bot.alerts.map((a) => a.signature) }).toEqual({ last: 'marine-1.png', alerts: ['discord-upload'] });
  });

  it('posts and keeps the static card when the glint fails to render, and alerts the glint alone', async () => {
    // #given
    const bot = fakeBot({ snapshot: LEGENDARY, renderer: fakeRenderer('renderMarineGlint') });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({
      last: bot.discord.calls.at(-1),
      cardKey: marine.cardKey,
      gif: (await env.MARINES.head('cards/1.gif')) !== null,
      alerts: bot.alerts,
    }).toEqual({
      last: { kind: 'edit', content: marine.callsign, file: 'marine-1.png', at: bot.clock.ms },
      cardKey: 'cards/1.png',
      gif: false,
      alerts: [{ signature: 'discord-render:marine', text: 'glint for Marine #1 failed: renderMarineGlint failed' }],
    });
  });

  it("falls back to the static card alone when the site drops a Legendary's one render", async () => {
    // #given
    const bot = fakeBot({ snapshot: LEGENDARY, renderer: fakeRenderer('renderMarineCards') });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1)!.file, cardKey: marine.cardKey, rendered: bot.renderer.calls.filter((c) => c !== 'prepareMeme'), alerts: bot.alerts.map((a) => a.text) }).toEqual({
      last: 'marine-1.png',
      cardKey: 'cards/1.png',
      rendered: ['renderMarineCards', 'renderMarineCard'],
      alerts: ['glint for Marine #1 failed: renderMarineCards failed'],
    });
  });

  it('says the tag is being stamped when neither card can be uploaded', async () => {
    // #given
    const bot = fakeBot({ snapshot: LEGENDARY });
    refusing(bot, (_content, file) => file !== undefined);
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1), alerts: bot.alerts.map((a) => a.signature) }).toEqual({ last: { kind: 'edit', content: TEXT.stamping(marine), at: bot.clock.ms }, alerts: ['discord-upload'] });
  });

  it('says the tag is being stamped when the memes cannot be read back from R2', async () => {
    // #given
    const bucket = new Proxy(env.MARINES, {
      get(target, prop) {
        if (prop === 'get') return async (key: string) => (key.startsWith('memes/') ? Promise.reject(new Error('R2 is down')) : target.get(key));
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const bot = fakeBot({ bucket });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1)!.content, alerts: bot.alerts.map((a) => a.signature) }).toEqual({ last: TEXT.stamping(marine), alerts: ['discord-render:marine'] });
  });

  it('still posts the card when R2 refuses to keep it, alerting a storage failure', async () => {
    // #given
    const bucket = new Proxy(env.MARINES, {
      get(target, prop) {
        if (prop === 'put') return async (key: string, ...rest: [never]) => (key.startsWith('cards/') ? Promise.reject(new Error('R2 is full')) : target.put(key, ...rest));
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const bot = fakeBot({ bucket });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: bot.discord.calls.at(-1)!.content, cardKey: marine.cardKey, alerts: bot.alerts.map((a) => a.signature) }).toEqual({ last: marine.callsign, cardKey: null, alerts: ['discord-store:marine'] });
  });

  it('posts a card stamped at 17 s, and the stamping line at 18 s for one that would take until 19 s', async () => {
    // #given two renderers on the fake clock, 17 s and 19 s slow
    const [early, late] = [fakeBot(), fakeBot()];
    for (const [bot, ms] of [[early, 17_000], [late, 19_000]] as const) slowCards(bot, ms);
    const t0 = early.clock.ms;
    // #when
    await enlistCommand(early, command('enlist'));
    await resetStorage();
    await enlistCommand(late, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ early: early.discord.calls.at(-1), late: late.discord.calls.at(-1), lateAlerts: late.alerts.map((a) => a.signature) }).toEqual({
      early: expect.objectContaining({ content: marine.callsign, file: expect.stringMatching(/^marine-1\./), at: t0 + 17_000 }),
      late: { kind: 'edit', content: TEXT.stamping(marine), at: t0 + 18_000 },
      lateAlerts: ['discord-render:marine'],
    });
  });

  it('leaves /dogtag to finish a card that passed the deadline, and still reports it once done', async () => {
    // #given a card that takes 25 s
    const bot = fakeBot();
    slowCards(bot, 25_000);
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ cardKey: marine.cardKey, alerts: bot.alerts.map((a) => a.text) }).toEqual({ cardKey: 'cards/1.png', alerts: ["stamping Marine #1's card passed the deadline"] });
  });

  it('tries the stamping line once, neither waiting out nor retrying a final 429 that asks for more than the time left', async () => {
    // #given a command received 26 s ago, and Discord asking for 10 s on the first final edit
    const bot = fakeBot();
    const sent: string[] = [];
    let limited = true;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      sent.push((JSON.parse(String(init?.body)) as { content: string }).content);
      if (limited) {
        limited = false;
        return new Response(JSON.stringify({ retry_after: 10 }), { status: 429 });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    bot.discord = discordApi('app', { fetch: fetchFn, sleep: bot.sleep, now: () => bot.clock.ms }) as FakeBot['discord'];
    const startedAt = bot.clock.ms - 26_000;
    // #when
    await enlistCommand(bot, command('enlist'), startedAt);
    // #then the 429 was not waited out, and nothing was retried
    const waited = bot.clock.ms - startedAt;
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ waited, requests: sent }).toEqual({ waited: 26_000, requests: [TEXT.stamping(marine)] });
  });

  it('lands the final edit by 28 s when the card upload is slow and then rate limited', async () => {
    // #given the first upload takes 15 s before Discord says 429 with a 10 s ask
    const bot = fakeBot();
    const sent: { at: number; content: string; multipart: boolean }[] = [];
    let slow = true;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      const multipart = init?.body instanceof FormData;
      if (multipart && slow) {
        slow = false;
        await bot.sleep(15_000);
        return new Response(JSON.stringify({ retry_after: 10 }), { status: 429 });
      }
      const content = multipart ? (JSON.parse((init!.body as FormData).get('payload_json') as string) as { content: string }).content : (JSON.parse(String(init?.body)) as { content: string }).content;
      sent.push({ at: bot.clock.ms, content, multipart });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    bot.discord = discordApi('app', { fetch: fetchFn, sleep: bot.sleep, now: () => bot.clock.ms }) as FakeBot['discord'];
    const t0 = bot.clock.ms;
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({ last: [sent.at(-1)!.content === marine.callsign || sent.at(-1)!.content === TEXT.stamping(marine)], landedBy28: sent.at(-1)!.at - t0 <= 28_000, settledBy30: bot.clock.ms - t0 <= 30_000 }).toEqual({ last: [true], landedBy28: true, settledBy30: true });
  });

  it('keeps every step edit to 3 s without waiting on a 429, so a slow Discord still gets the card in by 17 s', async () => {
    // #given each step edit would take 8 s
    const bot = fakeBot();
    const inner = bot.discord;
    const limits: (number | undefined)[][] = [];
    bot.discord = {
      ...inner,
      async editOriginal(token, content, file, maxWaitMs, timeoutMs) {
        if (file) return inner.editOriginal(token, content, file, maxWaitMs, timeoutMs);
        limits.push([maxWaitMs, timeoutMs]);
        await bot.sleep(Math.min(8_000, timeoutMs ?? 8_000));
        throw new Error('aborted');
      },
    };
    const t0 = bot.clock.ms;
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect({ limits, last: bot.discord.calls.at(-1) }).toEqual({
      limits: [[0, 3000], [0, 3000], [0, 3000], [0, 3000]],
      last: expect.objectContaining({ file: expect.stringMatching(/^marine-1\./), at: t0 + 16_000 }),
    });
  });

  it('leaves the Marine on record, deletes nothing and alerts when every Discord edit fails', async () => {
    // #given
    const bot = fakeBot();
    const refuse = async () => {
      throw new Error('Discord returned HTTP 500');
    };
    bot.discord = { ...bot.discord, editOriginal: refuse };
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect({ marine: (await findMarine(env.DB, 'discord', ME))?.serial, private: bot.discord.calls.length, alerts: bot.alerts.map((a) => a.signature) }).toEqual({ marine: 1, private: 0, alerts: ['discord-upload'] });
  });

  it("answers an enlisted Marine's second /enlist with their callsign line when R2 cannot be read", async () => {
    // #given
    await enlistCommand(fakeBot(), command('enlist'));
    const bucket = new Proxy(env.MARINES, {
      get(target, prop) {
        if (prop === 'get') return async () => Promise.reject(new Error('R2 is down'));
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const bot = fakeBot({ bucket });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect(bot.discord.calls.map((c) => [c.kind, c.content])).toEqual([['edit', TEXT.stamping(marine)]]);
  });

  it("names the other member, not the asker, when their card cannot be uploaded", async () => {
    // #given
    await enlistCommand(fakeBot(), command('enlist', [], { member: { user: { id: OTHER, username: 'rory' } } }));
    const bot = fakeBot();
    bot.discord = { ...bot.discord, editOriginal: async (_t, content, file) => { if (file) throw new Error('HTTP 413'); bot.discord.calls.push({ kind: 'edit', content, at: bot.clock.ms }); } };
    // #when
    await dogtagCommand(bot, other());
    // #then
    expect(bot.discord.calls.map((c) => c.content)).toEqual([TEXT.tagStamping('Rory')]);
  });

  it('alerts when the memes are missing from R2 right after the copy', async () => {
    // #given
    const bucket = new Proxy(env.MARINES, {
      get(target, prop) {
        if (prop === 'get') return async (key: string) => (key.startsWith('memes/') ? null : target.get(key));
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const bot = fakeBot({ bucket });
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect(bot.alerts.map((a) => [a.signature, a.text])).toEqual([['discord-render:marine', "Marine #1's memes were missing from storage right after copying"]]);
  });

  it('starts the avatar fetch with the meme copies, not after them', async () => {
    // #given
    const bot = fakeBot();
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    expect(bot.fetch.urls[0]).toContain('cdn.discordapp.com');
  });

  it('answers privately even when the alert chat cannot be reached', async () => {
    // #given an interaction that fails before any draw, and an alerter whose database is down
    const sent: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      sent.push(`${init?.method} ${url.split('/').slice(-1)[0]} ${typeof init?.body === 'string' ? init.body : ''}`);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const brokenDb = { prepare: () => { throw new Error('D1 is down'); } } as unknown as D1Database;
    const bot = fakeBot({
      discord: discordApi('app', { fetch: fetchFn, sleep: async () => {} }),
      alert: createAlerter(brokenDb, { token: 't', chatId: 'c' }, { fetch: fetchFn, now: () => new Date() }),
    });
    // #when
    await botHandlers(bot).commands.enlist!(command('enlist', [], { member: undefined }));
    // #then
    expect(sent).toEqual(['DELETE @original ', `POST tok ${JSON.stringify({ content: TEXT.internal, flags: 64, allowed_mentions: { parse: [] } })}`]);
  });
});

/** A Marine whose card failed at enlistment, and a bot that takes `ms` on its fake clock to render it again. */
async function cardlessMarine(ms: number, overrides: Partial<Bot> = {}): Promise<FakeBot> {
  await enlistCommand(fakeBot({ renderer: fakeRenderer('renderMarineCard') }), command('enlist'));
  const bot = fakeBot(overrides);
  slowCards(bot, ms);
  return bot;
}

/** The two commands that stamp an enlisted Marine's missing card on demand. */
const RESTAMPS = [
  { asked: '/dogtag', run: (bot: FakeBot) => dogtagCommand(bot, command('dogtag')) },
  { asked: 'a second /enlist', run: (bot: FakeBot) => enlistCommand(bot, command('enlist')) },
];

describe('a card stamped on demand that passes the 18 s deadline', () => {
  it.each(RESTAMPS)('$asked posts the callsign line at 18 s, then waits until the card is kept at 22 s', async ({ run }) => {
    // #given
    const bot = await cardlessMarine(22_000);
    const t0 = bot.clock.ms;
    // #when
    await run(bot);
    const resolvedAt = bot.clock.ms - t0;
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect({
      calls: bot.discord.calls,
      resolvedAt,
      kept: [(await env.MARINES.head('cards/1.png')) !== null, marine.cardKey],
      alerts: bot.alerts.map((a) => a.text),
    }).toEqual({
      calls: [{ kind: 'edit', content: TEXT.stamping(marine), at: t0 + 18_000 }],
      resolvedAt: 22_000,
      kept: [true, 'cards/1.png'],
      alerts: ["stamping Marine #1's card passed the deadline"],
    });
  });

  it.each(RESTAMPS)('$asked flushes what the late stamp reports: R2 refusing at 22 s to keep the card', async ({ run }) => {
    // #given
    const bucket = new Proxy(env.MARINES, {
      get(target, prop) {
        if (prop === 'put') return async (key: string, ...rest: [never]) => (key.startsWith('cards/') ? Promise.reject(new Error('R2 is full')) : target.put(key, ...rest));
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const bot = await cardlessMarine(22_000, { bucket });
    // #when
    await run(bot);
    // #then
    expect(bot.alerts.map((a) => a.signature)).toEqual(['discord-render:marine', 'discord-store:marine']);
  });

  it('lets /dogtag go at 28 s when the stamp would take until 35 s, reporting that it passed the deadline', async () => {
    // #given
    const bot = await cardlessMarine(35_000);
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => void unhandled.push(event.reason);
    addEventListener('unhandledrejection', onUnhandled);
    onTestFinished(() => removeEventListener('unhandledrejection', onUnhandled));
    const t0 = bot.clock.ms;
    // #when
    await dogtagCommand(bot, command('dogtag'));
    const resolvedAt = bot.clock.ms - t0;
    // #then the stamp, left running, settles here rather than in the next test
    await vi.waitFor(async () => expect((await findMarine(env.DB, 'discord', ME))!.cardKey).toBe('cards/1.png'));
    expect({ resolvedAt, alerts: bot.alerts.map((a) => a.text), unhandled }).toEqual({
      resolvedAt: 28_000,
      alerts: ["stamping Marine #1's card passed the deadline"],
      unhandled: [],
    });
  });
});

describe('a failing command', () => {
  it('answers the Marine before it alerts', async () => {
    // #given
    const events: string[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      events.push(String(init?.method));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const bot = fakeBot({
      discord: discordApi('app', { fetch: fetchFn, sleep: async () => {} }),
      alert: async (signature) => void events.push(`alert ${signature}`),
    });
    // #when
    await botHandlers(bot).commands.enlist!(command('enlist', [], { member: undefined }));
    // #then
    expect(events).toEqual(['DELETE', 'POST', 'alert discord-command:enlist']);
  });
});
