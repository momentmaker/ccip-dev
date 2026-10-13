import { bytesToBase64 } from '../cards/coin-icons';
import { h, type VNode } from '../h';

/** The largest the card ever draws a meme (a planet) is 145 px: memes are kept at this size, square, cover-cropped. */
export const MEME_SIZE = 240;

const SIGNATURES: readonly { mime: string; bytes: readonly number[] }[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** The image type by its first bytes; the archive holds JPEG, PNG and GIF, whatever their file names say. */
export function sniffImage(bytes: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[i] === b))?.mime ?? null;
}

/** A meme cover-cropped to MEME_SIZE square; an animated GIF keeps its first frame. */
export function memeTree(image: Uint8Array): VNode {
  const mime = sniffImage(image);
  if (!mime) throw new Error('prepareMeme: not a JPEG, PNG or GIF image');
  return h(
    'div',
    { style: { width: MEME_SIZE, height: MEME_SIZE, display: 'flex' } },
    h('img', { src: `data:${mime};base64,${bytesToBase64(image)}`, width: MEME_SIZE, height: MEME_SIZE, style: { width: MEME_SIZE, height: MEME_SIZE, objectFit: 'cover' } }),
  );
}
