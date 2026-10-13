import { WorkerEntrypoint } from 'cloudflare:workers';
import { hasGlint, type IntelCards, type IntelKind, type LinkMarineRenderer, type MarineCard } from '@ccip-dev/core/linkmarine';
import type { AssetFetcher } from '../cards/coin-icons';
import { chainArts } from './chain-hex';
import { glintGif } from './glint';
import { intelSelectors, intelTree } from './intel';
import { marineTree } from './marine-card';
import { MEME_SIZE, memeTree } from './meme';
import { renderKino } from './render';

export interface LinkMarineEnv {
  ASSETS: AssetFetcher;
}

/**
 * The LinkMarine bot's renderer, reached only through its service binding: no route serves it. It returns PNG (and GIF)
 * bytes, and throws when a card cannot be drawn, so the bot never posts a half-drawn one.
 */
export class LinkMarineCards extends WorkerEntrypoint<LinkMarineEnv> implements LinkMarineRenderer {
  async prepareMeme(image: Uint8Array): Promise<Uint8Array> {
    return (await renderKino(memeTree(image), { width: MEME_SIZE, height: MEME_SIZE })).png;
  }

  async renderMarineCard(card: MarineCard): Promise<Uint8Array> {
    return (await renderKino(marineTree(card))).png;
  }

  async renderMarineGlint(card: MarineCard): Promise<Uint8Array | null> {
    if (!hasGlint(card.tier)) return null;
    const rendered = await renderKino(marineTree(card));
    return glintGif(rendered.pixels, rendered.width, rendered.height);
  }

  async renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array> {
    const arts = await chainArts(this.env.ASSETS, intelSelectors(kind, card));
    return (await renderKino(intelTree(kind, card, arts))).png;
  }
}
