import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CallsignSnapshot } from '../src/draw';
import { dogtagCommand, enlistCommand, revealSteps, STEP_MS, TEXT } from '../src/marines';
import { findMarine } from '../src/store';
import { ARCHIVE_ROUTES, command, fakeBot, fakeFetch, fakeRenderer, GIF_BYTES, PNG_BYTES, resetStorage, SNAPSHOT } from './helpers';

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
