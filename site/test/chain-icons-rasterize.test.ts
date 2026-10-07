import { describe, expect, it } from 'vitest';
import { embedsRaster, rasterizeIcon } from '../scripts/chain-icons/rasterize';

const RED = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="red"/></svg>';

describe('embedsRaster', () => {
  it('is true for an svg embedding a png data uri', () => {
    expect(embedsRaster('<svg><image href="data:image/png;base64,AAAA"/></svg>')).toBe(true);
  });

  it('is false for a plain path svg', () => {
    expect(embedsRaster('<svg><path d="M0 0h1v1z"/></svg>')).toBe(false);
  });
});

describe('rasterizeIcon', () => {
  it('returns png bytes', async () => {
    const png = await rasterizeIcon(RED);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('renders at 128 by 128', async () => {
    const png = await rasterizeIcon(RED);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([128, 128]);
  });
});
