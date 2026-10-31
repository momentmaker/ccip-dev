import { marinePage } from './marines';
import { handleOg, type OgEnv } from './og';
import { renderPng } from './render';
import { stakerPage } from './stakers';

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/marines/')) return marinePage(request, env.ASSETS);
    if (path.startsWith('/staking/')) return stakerPage(request, env.ASSETS);
    if (!path.startsWith('/og/')) return env.ASSETS.fetch(request);
    return handleOg(request, env, ctx, { fetch: (input, init) => fetch(input, init), renderPng, cache: caches.default });
  },
} satisfies ExportedHandler<OgEnv & { ASSETS: Fetcher }>;

export { LinkMarineCards } from './linkmarine/entrypoint';
