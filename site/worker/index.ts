import { handleOg, type OgEnv } from './og';
import { renderPng } from './render';

export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/og/')) return env.ASSETS.fetch(request);
    return handleOg(request, env, ctx, { fetch: (input, init) => fetch(input, init), renderPng, cache: caches.default });
  },
} satisfies ExportedHandler<OgEnv & { ASSETS: Fetcher }>;

export { LinkMarineCards } from './linkmarine/entrypoint';
