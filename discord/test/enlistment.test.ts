import type { MarineCard } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cardKey, enlistMarine, stampCard, type Report } from '../src/enlistment';
import { findMarine } from '../src/store';
import { fakeBot, fakeRenderer, PNG_BYTES, resetStorage } from './helpers';

const TELEGRAM_ID = '777000111';

beforeEach(resetStorage);

describe('enlistment on any platform', () => {
  it('enlists a Telegram account as its own Marine, after a Discord one with the same id', async () => {
    // #given
    const bot = fakeBot();
    await enlistMarine(bot, { platform: 'discord', userId: TELEGRAM_ID, displayName: 'on discord' });
    // #when
    const result = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Ada Lovelace' });
    // #then
    const discord = (await findMarine(env.DB, 'discord', TELEGRAM_ID))!;
    expect(result.kind === 'enlisted' && [result.marine.serial, result.marine.platform, result.marine.displayName, result.marine.callsign !== discord.callsign]).toEqual([2, 'telegram', 'Ada Lovelace', true]);
  });

  it('never draws twice for one Telegram account', async () => {
    // #given
    const bot = fakeBot();
    const first = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Ada' });
    // #when
    const again = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Someone Else' });
    // #then
    expect([again.kind, again.kind !== 'clashed' && again.marine.callsign, again.kind !== 'clashed' && again.marine.displayName]).toEqual([
      'already',
      first.kind === 'enlisted' && first.marine.callsign,
      'Ada',
    ]);
  });

  it('stamps a Telegram Marine with the name and the avatar it is handed, and records the card', async () => {
    // #given
    const drawn: MarineCard[] = [];
    const renderer = fakeRenderer();
    const bot = fakeBot({
      renderer: {
        ...renderer,
        renderMarineCards: async (card) => {
          drawn.push(card);
          return renderer.renderMarineCards(card);
        },
      },
    });
    const result = await enlistMarine(bot, { platform: 'telegram', userId: TELEGRAM_ID, displayName: 'Ada Lovelace' });
    const marine = result.kind === 'enlisted' ? result.marine : null;
    const reports: Report[] = [];
    // #when
    const cards = await stampCard(bot, marine!, async () => PNG_BYTES, reports);
    // #then
    expect({
      posted: cards?.map((c) => c.name).at(-1),
      name: drawn[0]?.name,
      avatar: drawn[0]?.avatar && [...drawn[0].avatar],
      kept: (await env.MARINES.head(cardKey(1, 'png')))?.httpMetadata?.contentType,
      recorded: (await findMarine(env.DB, 'telegram', TELEGRAM_ID))?.cardKey,
      reports,
    }).toEqual({ posted: 'marine-1.png', name: 'Ada Lovelace', avatar: [...PNG_BYTES], kept: 'image/png', recorded: 'cards/1.png', reports: [] });
  });
});
