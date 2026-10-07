import { render } from '@cf-wasm/og/workerd';
import { INTER_400, INTER_700 } from './fonts';
import { handleOg, type OgEnv } from './og';

const FONTS = [
  { name: 'Inter', data: INTER_400, weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: INTER_700, weight: 700 as const, style: 'normal' as const },
];

export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/og/')) return env.ASSETS.fetch(request);
    return handleOg(request, env, ctx, {
      fetch: (input, init) => fetch(input, init),
      renderPng: async (tree) =>
        (await render(tree as never, { width: 1200, height: 630, fonts: FONTS, loadAdditionalAsset: () => undefined }).asPng()).image,
      cache: caches.default,
    });
  },
} satisfies ExportedHandler<OgEnv & { ASSETS: Fetcher }>;
