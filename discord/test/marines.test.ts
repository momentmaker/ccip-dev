import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
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

  it('banners a Legendary draw and posts its glint, keeping the static card beside it', async () => {
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
    }).toEqual({ banner: true, posted: 'marine-1.gif', gif: [...GIF_BYTES], png: true, rendered: ['renderMarineCard', 'renderMarineGlint'] });
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

  it('gives up on a card still stamping 18 s after the command arrived, leaving /dogtag to finish it', async () => {
    // #given a renderer that takes 25 s
    const bot = fakeBot();
    bot.renderer.renderMarineCard = async () => {
      await bot.sleep(25_000);
      return PNG_BYTES;
    };
    // #when
    await enlistCommand(bot, command('enlist'));
    // #then
    const marine = (await findMarine(env.DB, 'discord', ME))!;
    expect(bot.discord.calls.at(-1)).toEqual({ kind: 'edit', content: TEXT.stamping(marine), at: bot.clock.ms });
  });

  it('offers the final edit only the time left before 28 s for a 429', async () => {
    // #given a command received 22 s ago, so the stamping deadline has passed
    const bot = fakeBot();
    const waits = refusing(bot, () => false);
    // #when
    await enlistCommand(bot, command('enlist'), bot.clock.ms - 22_000);
    // #then
    expect(waits.at(-1)).toBe(2_000);
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
