// The site Worker as the bot's tests see it: its LinkMarineCards entrypoint, answering with marker bytes.
import { WorkerEntrypoint } from 'cloudflare:workers';

export const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
export const GIF = [71, 73, 70, 56, 57, 97];

export class LinkMarineCards extends WorkerEntrypoint {
  async prepareMeme() {
    return new Uint8Array(PNG);
  }

  async renderMarineCard() {
    return new Uint8Array(PNG);
  }

  async renderMarineGlint(card) {
    return card.tier === 'rare' || card.tier === 'legendary' ? new Uint8Array(GIF) : null;
  }

  async renderMarineCards(card) {
    return { png: new Uint8Array(PNG), gif: await this.renderMarineGlint(card), glintError: null };
  }

  async renderMarineWebCard() {
    return new Uint8Array(PNG);
  }

  async renderMarineSticker() {
    return new Uint8Array(PNG);
  }

  async renderIntelCard() {
    return new Uint8Array(PNG);
  }
}

export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
