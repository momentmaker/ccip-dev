import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DOSSIER, RECORDS, SITREP, VAULT } from '../../test/fixtures/linkmarine';
import { LinkMarineCards } from '../linkmarine/entrypoint';

const assets = { fetch: async () => new Response('missing', { status: 404 }) };
const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];

describe('the LinkMarineCards entrypoint: intel cards', () => {
  it('renders each of the four intel cards at 1200×675', async () => {
    // #given the bot's view of the entrypoint
    const cards: LinkMarineRenderer = new LinkMarineCards(createExecutionContext(), { ASSETS: assets });
    // #when
    const pngs = await Promise.all([cards.renderIntelCard('sitrep', SITREP), cards.renderIntelCard('dossier', DOSSIER), cards.renderIntelCard('vault', VAULT), cards.renderIntelCard('records', RECORDS)]);
    // #then
    expect(pngs.map(size)).toEqual([[1200, 675], [1200, 675], [1200, 675], [1200, 675]]);
  });

  it('throws on a kind it does not draw, so the bot reports it instead of posting', async () => {
    // #given
    const cards = new LinkMarineCards(createExecutionContext(), { ASSETS: assets });
    // #then
    await expect(cards.renderIntelCard('weather' as never, SITREP as never)).rejects.toThrow('no intel card called weather');
  });
});
