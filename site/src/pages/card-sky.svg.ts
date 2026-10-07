import type { APIRoute } from 'astro';
import { buildData } from '../lib/build-data';
import { buildLayout } from '../sky/layout';
import { skySvg } from '../sky/svg';
import { trailingWeights } from '../sky/weights';

export const GET: APIRoute = async () => {
  const replay = await buildData('replay.json');
  const weights = trailingWeights(replay, 30);
  const svg = skySvg({ width: 640, height: 630, stars: buildLayout(replay.chains), chainValues: weights.chains, lanes: weights.lanes, title: 'CCIP chains' });
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
};
