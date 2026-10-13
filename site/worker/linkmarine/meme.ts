import { bytesToBase64 } from '../cards/coin-icons';
import { h, type VNode } from '../h';

/** The largest the card ever draws a meme (a planet) is 145 px: memes are kept at this size, square, cover-cropped. */
export const MEME_SIZE = 240;

/** The archive's largest meme is 8.2 MB. */
export const MAX_MEME_BYTES = 16 * 1024 * 1024;

const SIGNATURES: readonly { mime: string; name: string; bytes: readonly number[]; end: readonly number[]; zeroPadded: boolean }[] = [
  { mime: 'image/png', name: 'PNG', bytes: [0x89, 0x50, 0x4e, 0x47], end: [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], zeroPadded: false },
  { mime: 'image/jpeg', name: 'JPEG', bytes: [0xff, 0xd8, 0xff], end: [0xff, 0xd9], zeroPadded: true },
  { mime: 'image/gif', name: 'GIF', bytes: [0x47, 0x49, 0x46, 0x38], end: [0x3b], zeroPadded: false },
];

function endsWith(image: Uint8Array, end: readonly number[], zeroPadded: boolean): boolean {
  let last = image.length;
  if (zeroPadded) while (last > 0 && image[last - 1] === 0) last--;
  return last >= end.length && end.every((b, i) => image[last - end.length + i] === b);
}

/** The image type by its first bytes; the archive holds JPEG, PNG and GIF, whatever their file names say. */
export function sniffImage(bytes: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[i] === b))?.mime ?? null;
}

/** A download cut short keeps its signature but loses its terminator, and would draw as a blank or half meme. */
function checkImage(image: Uint8Array): string {
  if (image.length > MAX_MEME_BYTES) throw new Error('prepareMeme: image over 16 MB');
  const found = SIGNATURES.find((s) => s.bytes.every((b, i) => image[i] === b));
  if (!found) throw new Error('prepareMeme: not a JPEG, PNG or GIF image');
  if (!endsWith(image, found.end, found.zeroPadded)) throw new Error(`prepareMeme: truncated or corrupt ${found.name}`);
  return found.mime;
}

/** A meme cover-cropped to MEME_SIZE square; an animated GIF keeps its first frame. */
export function memeTree(image: Uint8Array): VNode {
  const mime = checkImage(image);
  return h(
    'div',
    { style: { width: MEME_SIZE, height: MEME_SIZE, display: 'flex' } },
    h('img', { src: `data:${mime};base64,${bytesToBase64(image)}`, width: MEME_SIZE, height: MEME_SIZE, style: { width: MEME_SIZE, height: MEME_SIZE, objectFit: 'cover' } }),
  );
}
