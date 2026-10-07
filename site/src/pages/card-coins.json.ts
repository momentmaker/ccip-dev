import type { APIRoute } from 'astro';
import { buildData } from '../lib/build-data';
import { missingIcons } from '../lib/chain-icons';
import { iconDataUri } from '../lib/chain-icons-server';
import { CARD_COINS, cardCoins } from '../sky/card-coins';
import { buildLayout } from '../sky/layout';
import { trailingWeights } from '../sky/weights';

export const GET: APIRoute = async () => {
  const [replay, chains] = await Promise.all([buildData('replay.json'), buildData('chains.json')]);
  const listed = new Map([...chains.chains, ...replay.chains].map((c) => [c.selector, c]));
  const missing = missingIcons([...listed.values()]);
  if (missing.length > 0) console.warn(`chain icons missing for ${missing.join(', ')}; run pnpm --filter @ccip-dev/site icons:fetch`);
  const weights = trailingWeights(replay, 30);
  const coins = cardCoins({ width: 640, height: 630, stars: buildLayout(replay.chains), chainValues: weights.chains, count: CARD_COINS, src: (s) => iconDataUri(s) });
  return new Response(JSON.stringify({ coins }), { headers: { 'content-type': 'application/json' } });
};
