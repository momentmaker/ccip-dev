import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { render } from '@cf-wasm/og/node';
import { hasGlint, INTEL_KINDS, TIERS, type IntelCards, type IntelKind, type MarineWebCard } from '@ccip-dev/core/linkmarine';
import { DOSSIER, marine, RECORDS, SITREP, VAULT } from '../test/fixtures/linkmarine';
import type { VNode } from '../worker/h';
import { chainArts } from '../worker/linkmarine/chain-hex';
import { KINO_FONTS } from '../worker/linkmarine/fonts';
import { glintGif } from '../worker/linkmarine/glint';
import { intelSelectors, intelTree } from '../worker/linkmarine/intel';
import { marineTree } from '../worker/linkmarine/marine-card';
import { MEME_SIZE, memeTree } from '../worker/linkmarine/meme';

/**
 * `pnpm --filter @ccip-dev/site cards:linkmarine [--out DIR] [--archive ../chainlinkmeme]`: draws every tier of the dog
 * tag card (and the glint of Rare and Legendary) and the four intel cards from fixtures, for a human look before launch.
 * With the chainlinkmeme checkout the tags carry the mockup's three real memes; without it, plain swatches.
 */
const site = join(import.meta.dirname, '..');
const { values } = parseArgs({ options: { out: { type: 'string', default: join(site, 'linkmarine-cards') }, archive: { type: 'string', default: join(site, '..', '..', 'chainlinkmeme') } } });
const out = resolve(values.out);
/** The mockup's memes: painting, space and prophecy. */
const MOCKUP_MEMES = ['a3ccf753ffd27a408d0d5d974faecf2f.jpeg', 'e572d111223722c3d6cce9d52b90f45e.jpeg', 'aabd55f53e8aea9de4665be183d5bb7d.jpeg'];
const SWATCHES = ['#c0392b', '#1f6fb2', '#7d3c98'];

const draw = async (tree: VNode, width = 1200, height = 675) => render(tree as never, { width, height, fonts: KINO_FONTS, loadAdditionalAsset: async () => [] }).asPng();
const swatch = (color: string) => ({ type: 'div', props: { style: { width: MEME_SIZE, height: MEME_SIZE, display: 'flex', backgroundImage: `linear-gradient(135deg, ${color}, #f4f7fb)` } } }) as VNode;

async function memes(): Promise<Uint8Array[]> {
  const dir = join(resolve(values.archive), 'memes');
  if (MOCKUP_MEMES.every((f) => existsSync(join(dir, f)))) {
    return Promise.all(MOCKUP_MEMES.map(async (f) => (await draw(memeTree(new Uint8Array(await readFile(join(dir, f)))), MEME_SIZE, MEME_SIZE)).image));
  }
  console.warn(`no chainlinkmeme checkout at ${values.archive}: drawing swatches for the memes`);
  return Promise.all(SWATCHES.map(async (c) => (await draw(swatch(c), MEME_SIZE, MEME_SIZE)).image));
}

const assets = { fetch: async (request: Request | string) => {
  const path = join(site, 'public', new URL(typeof request === 'string' ? request : request.url).pathname);
  return existsSync(path) ? new Response(await readFile(path)) : new Response('missing', { status: 404 });
} };

await mkdir(out, { recursive: true });
const pngs = await memes();
for (const tier of TIERS) {
  const card = marine(tier, pngs);
  const rendered = await draw(marineTree(card));
  await writeFile(join(out, `marine-${tier}.png`), rendered.image);
  const web: MarineWebCard = { serial: card.serial, callsign: card.callsign, tier: card.tier, percentile: card.percentile, memes: card.memes, blood: card.blood, faith: card.faith, enlistedAt: card.enlistedAt };
  await writeFile(join(out, `marine-${tier}-web.png`), (await draw(marineTree(web))).image);
  if (hasGlint(tier)) await writeFile(join(out, `marine-${tier}.gif`), glintGif(new Uint8Array(rendered.pixels), rendered.width, rendered.height));
}
const intel: IntelCards = { sitrep: SITREP, dossier: DOSSIER, vault: VAULT, records: RECORDS };
for (const kind of INTEL_KINDS) {
  const card = intel[kind as IntelKind];
  const arts = await chainArts(assets, intelSelectors(kind, card as never));
  await writeFile(join(out, `intel-${kind}.png`), (await draw(intelTree(kind, card as never, arts))).image);
}
console.log(`wrote ${TIERS.length} dog tag cards, their web cards, their glints and ${INTEL_KINDS.length} intel cards to ${out}`);
