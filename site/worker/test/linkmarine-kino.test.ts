import { describe, expect, it } from 'vitest';
import { h } from '../h';
import { artLayer, HEX_CLIP } from '../linkmarine/art';
import { renderKino } from '../linkmarine/render';

/** A 16×16 JPEG, red on the left half and blue on the right. */
const RED_BLUE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAgEBAgMCAgIDBAMDAwMEBQQEBAQEBQYFBQUFBQUGBgYGBgYGBgcHBwcHBwgICAgICQkJCQkJCQkJCf/bAEMBAQEBAgICBAICBAkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCf/dAAQAAf/aAAwDAQACEQMRAD8A+F6+R6+uK+R6/vz9gP8A81Z/3Jf+7Z/qB/pBX/NI/wDc9/7pn//Z';
const GREEN = '#00ff00';

const pixel = (r: { pixels: Uint8Array; width: number }, x: number, y: number) => [...r.pixels.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];
const box = (left: number, child: ReturnType<typeof h>) => h('div', { style: { position: 'absolute', left, top: 0, width: 100, height: 100, display: 'flex' } }, child);

describe('the kino renderer', () => {
  it("etches a meme through Satori's own filter and clip-path, which resvg draws", async () => {
    // #given the meme plain, and grey, contrasty and clipped to a hexagon
    const tree = h(
      'div',
      { style: { width: 200, height: 100, display: 'flex', position: 'relative', backgroundColor: GREEN } },
      box(0, h('img', { src: RED_BLUE_JPEG, width: 100, height: 100, style: { width: 100, height: 100 } })),
      box(100, h('img', { src: RED_BLUE_JPEG, width: 100, height: 100, style: { width: 100, height: 100, clipPath: HEX_CLIP, filter: 'grayscale(1) contrast(1.7) brightness(0.95)' } })),
    );
    // #when
    const r = await renderKino(tree, { width: 200, height: 100 });
    // #then plain is red; etched is grey (r = g = b); the hexagon's corner is the background
    const [plain, etched, corner] = [pixel(r, 25, 50), pixel(r, 125, 50), pixel(r, 102, 3)];
    expect({ red: plain[0]! > 200 && plain[1]! < 80, grey: Math.max(...etched) - Math.min(...etched) <= 2, clipped: corner }).toEqual({ red: true, grey: true, clipped: [0, 255, 0] });
  });

  it('draws no raster image nested in an SVG art layer, so memes and icons are card elements', async () => {
    // #given the same meme inside an art layer's SVG
    const tree = h(
      'div',
      { style: { width: 1200, height: 675, display: 'flex', position: 'relative', backgroundColor: GREEN } },
      artLayer(`<image href="${RED_BLUE_JPEG}" x="0" y="0" width="100" height="100"/><rect x="200" y="0" width="100" height="100" fill="#ff0000"/>`),
    );
    // #when
    const r = await renderKino(tree);
    // #then the art layer's shapes draw, its image does not
    expect([pixel(r, 40, 80), pixel(r, 395, 80)]).toEqual([[0, 255, 0], [255, 0, 0]]);
  });

  it('has Inter 900 and JetBrains Mono 700 besides the 800s', async () => {
    // #given the same word in each weight
    const word = (family: string, weight: number) => h('div', { style: { position: 'absolute', left: 0, top: 0, fontFamily: family, fontWeight: weight, fontSize: 60, color: '#000' } }, 'MMMMMM');
    const ink = async (family: string, weight: number) => {
      const r = await renderKino(h('div', { style: { width: 400, height: 80, display: 'flex', position: 'relative', backgroundColor: '#fff' } }, word(family, weight)), { width: 400, height: 80 });
      let dark = 0;
      for (let i = 0; i < r.pixels.length; i += 4) if (r.pixels[i]! < 128) dark++;
      return dark;
    };
    // #when
    const [inter800, inter900, mono700, mono800] = await Promise.all([ink('Inter', 800), ink('Inter', 900), ink('JetBrains Mono', 700), ink('JetBrains Mono', 800)]);
    // #then each weight is its own, heavier one with more ink
    expect({ inter: inter900 > inter800, mono: mono800 > mono700 }).toEqual({ inter: true, mono: true });
  });
});
