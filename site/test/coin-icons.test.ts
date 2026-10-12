import { describe, expect, it } from 'vitest';
import { bytesToBase64, coinIcon } from '../worker/cards/coin-icons';

const BASE = '15971525489660198786';
const ZORA = '3555797439612589184';

describe('coinIcon', () => {
  const assets = (files: Record<string, Uint8Array | string>) => ({
    fetch: async (req: Request | string) => {
      const path = new URL(typeof req === 'string' ? req : req.url).pathname;
      return path in files ? new Response(files[path] as BodyInit) : new Response('missing', { status: 404 });
    },
  });

  it("reads a chain's icon from the site's assets as a data URI, PNG or SVG", async () => {
    // #given
    const files = { '/chains/ethereum-mainnet-base-1.svg': '<svg/>', '/chains/zora-mainnet.png': new Uint8Array([137, 80, 78, 71]) };
    // #when
    const [svg, png] = await Promise.all([coinIcon(assets(files), 'https://ccip.dev', BASE), coinIcon(assets(files), 'https://ccip.dev', ZORA)]);
    // #then
    expect([svg, png]).toEqual([`data:image/svg+xml;base64,${btoa('<svg/>')}`, 'data:image/png;base64,iVBORw==']);
  });

  it('has no icon for a chain the manifest lacks or an asset that is missing', async () => {
    expect([await coinIcon(assets({}), 'https://ccip.dev', '1'), await coinIcon(assets({}), 'https://ccip.dev', BASE)]).toEqual([null, null]);
  });

  it('encodes more bytes than one call can spread', () => {
    const bytes = new Uint8Array(100_000).fill(65);
    expect(bytesToBase64(bytes)).toBe(btoa('A'.repeat(100_000)));
  });
});
