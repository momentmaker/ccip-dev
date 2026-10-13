import type { MarineCard } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createBot } from '../src/bot';
import { GIF_BYTES, PNG_BYTES } from './helpers';

/** A card as the bot sends it: nested bytes for every meme, and an avatar. */
const card = (tier: MarineCard['tier']): MarineCard => ({
  serial: 7,
  callsign: 'painting-space-prophecy',
  tier,
  percentile: 97.9,
  memes: ['painting', 'space', 'prophecy'].map((tag, i) => ({ tag, count: i + 1, png: new Uint8Array([137, 80, 78, 71, i]) })),
  blood: 'LINK+',
  faith: '4IR',
  name: 'momentmaker',
  enlistedAt: '2026-10-13T10:40:00.000Z',
  avatar: new Uint8Array([137, 80, 78, 71]),
});

describe('the composition root', () => {
  it("reaches the site's LinkMarineCards over the SITE binding with a whole MarineCard", async () => {
    // #given the bot as the Worker builds it
    const bot = createBot(env);
    // #when the cards cross the RPC boundary, bytes and all
    const [png, legendary, common] = await Promise.all([bot.renderer.renderMarineCard(card('legendary')), bot.renderer.renderMarineCards(card('legendary')), bot.renderer.renderMarineCards(card('common'))]);
    // #then the stand-in read each card's tier on the far side
    expect({ png: [...png], legendary: [[...legendary.png], legendary.gif && [...legendary.gif], legendary.glintError], common: common.gif }).toEqual({
      png: [...PNG_BYTES],
      legendary: [[...PNG_BYTES], [...GIF_BYTES], null],
      common: null,
    });
  });
});
