import { WorkerEntrypoint } from 'cloudflare:workers';
import type { MarineCard } from '@ccip-dev/core/linkmarine';
import { marineTree } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
import { renderKino } from './render';

/**
 * The LinkMarine bot's renderer, reached only through its service binding: no route serves it. It returns PNG (and GIF)
 * bytes, and throws when a card cannot be drawn, so the bot never posts a half-drawn one.
 */
export class LinkMarineCards extends WorkerEntrypoint {
  async prepareMeme(image: Uint8Array): Promise<Uint8Array> {
    return (await renderKino(memeTree(image), { width: MEME_SIZE, height: MEME_SIZE })).png;
  }

  async renderMarineCard(card: MarineCard): Promise<Uint8Array> {
    return (await renderKino(marineTree(card))).png;
  }
}
