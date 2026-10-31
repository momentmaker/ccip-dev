import { SITE_URL } from '../src/config';
import { addressFromPath, STAKER_DESCRIPTION, STAKER_TEMPLATE_PATH, stakerPath, stakerTitle } from '../src/lib/staker';
import type { MarineAssets } from './marines';

const ADDRESS_SHAPED = /^\/staking\/0x[0-9a-fA-F]{40}\/?$/;

const setAttribute = (name: string, value: string) => ({
  element(e: Element) {
    e.setAttribute(name, value);
  },
});

/** The template's head made the staker's: title, description, canonical URL and its card. */
export function stakerHead(page: Response, address: string): Response {
  const title = `${stakerTitle(address)} · Chainlink staking · ccip.dev`;
  const url = `${SITE_URL}${stakerPath(address)}`;
  return new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(title) })
    .on('meta[name="description"]', setAttribute('content', STAKER_DESCRIPTION))
    .on('meta[property="og:description"]', setAttribute('content', STAKER_DESCRIPTION))
    .on('meta[property="og:title"]', setAttribute('content', title))
    .on('meta[property="og:url"]', setAttribute('content', url))
    .on('link[rel="canonical"]', setAttribute('href', url))
    .on('meta[property="og:image"]', setAttribute('content', `${SITE_URL}/og/staker/${address}.png`))
    .on('meta[property="og:image:width"]', setAttribute('content', '1200'))
    .on('meta[property="og:image:height"]', setAttribute('content', '675'))
    .on('meta[property="og:image:alt"]', setAttribute('content', `The Chainlink staking card of ${address}`))
    .transform(page);
}

/**
 * /staking/<address>/: the lowercase path gets the template with the staker's head, other spellings redirect to it. The
 * page stays out of search (noindex): stakers are many, and each card is a link to share. Other paths are the assets'.
 */
export async function stakerPage(request: Request, assets: MarineAssets): Promise<Response> {
  const url = new URL(request.url);
  if (!ADDRESS_SHAPED.test(url.pathname)) return assets.fetch(request);
  const address = addressFromPath(url.pathname)!;
  const canonical = stakerPath(address);
  if (url.pathname !== canonical) return Response.redirect(new URL(`${canonical}${url.search}`, url).href, 301);
  const template = await assets.fetch(new Request(new URL(STAKER_TEMPLATE_PATH, url)));
  if (!template.ok) return template;
  return stakerHead(template, address);
}
