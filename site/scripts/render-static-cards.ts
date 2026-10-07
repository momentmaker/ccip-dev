import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { render } from '@cf-wasm/og/node';
import { defaultCard } from '../worker/cards/content';
import { cardTree } from '../worker/cards/frame';
import { INTER_400, INTER_700 } from '../worker/fonts';
import { h } from '../worker/h';

const FONTS = [
  { name: 'Inter', data: INTER_400, weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: INTER_700, weight: 700 as const, style: 'normal' as const },
];
const HEX = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" fill="#0c0f14"/><path fill="#2f62df" d="M32 4 56 18v28L32 60 8 46V18z"/><path fill="#0c0f14" d="M32 13 48 22.5v19L32 51 16 41.5v-19z"/><path fill="#4a7ff0" d="M32 22 40.5 27v10L32 42l-8.5-5V27z"/></svg>`;
const icon = (size: number) =>
  h('div', { style: { width: size, height: size, display: 'flex' } }, h('img', { src: `data:image/svg+xml;base64,${Buffer.from(HEX(size)).toString('base64')}`, width: size, height: size }));

const publicDir = join(import.meta.dirname, '..', 'public');
const png = async (tree: unknown, width: number, height: number) =>
  (await render(tree as never, { width, height, fonts: FONTS, loadAdditionalAsset: async () => [] }).asPng()).image;

await writeFile(join(publicDir, 'og-default.png'), await png(cardTree(defaultCard(), { skyDataUri: null, sparkDataUri: null, sponsorLine: null }), 1200, 630));
await writeFile(join(publicDir, 'apple-touch-icon.png'), await png(icon(180), 180, 180));
await writeFile(join(publicDir, 'favicon-32.png'), await png(icon(32), 32, 32));
console.log('wrote og-default.png, apple-touch-icon.png and favicon-32.png');
