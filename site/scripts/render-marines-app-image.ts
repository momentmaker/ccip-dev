import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { render } from '@cf-wasm/og/node';
import { MOCKUP_MEMES, webMarine } from '../test/fixtures/linkmarine';
import type { VNode } from '../worker/h';
import { APP_IMAGE_SIZE, appImageTree } from '../worker/linkmarine/app-image';
import { KINO_FONTS } from '../worker/linkmarine/fonts';
import { tagsTree } from '../worker/linkmarine/marine-card';
import { MEME_SIZE, memeTree } from '../worker/linkmarine/meme';

/**
 * `pnpm --filter @ccip-dev/site cards:app [--archive ../chainlinkmeme]`: draws the LinkMarines Mini App's 640×360
 * photo for @BotFather into site/public/marines-app-640x360.png, from the Legendary sample Marine and the mockup's memes.
 */
const site = join(import.meta.dirname, '..');
const { values } = parseArgs({ options: { archive: { type: 'string', default: join(site, '..', '..', 'chainlinkmeme') } } });
const dir = join(resolve(values.archive), 'memes');
if (!MOCKUP_MEMES.every((f) => existsSync(join(dir, f)))) throw new Error(`the mockup's memes are not in ${dir}: pass --archive <your chainlinkmeme checkout>`);

const draw = async (tree: VNode, width: number, height: number) => (await render(tree as never, { width, height, fonts: KINO_FONTS, loadAdditionalAsset: async () => [] }).asPng()).image;
const memes = await Promise.all(MOCKUP_MEMES.map(async (f) => draw(memeTree(new Uint8Array(await readFile(join(dir, f)))), MEME_SIZE, MEME_SIZE)));
const card = webMarine('legendary', memes);
const tags = await draw(tagsTree(card), 1200, 675);
const image = await draw(appImageTree(card, tags), APP_IMAGE_SIZE.width, APP_IMAGE_SIZE.height);
const out = join(site, 'public', 'marines-app-640x360.png');
await writeFile(out, image);
console.log(`wrote ${out} (${image.byteLength} bytes)`);
