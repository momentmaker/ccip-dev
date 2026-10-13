import { SITE_URL } from '../src/config';
import { MARINE_DESCRIPTION, MARINE_TEMPLATE_PATH, marinePath, marineTitle, serialFromPath, webCardUrl } from '../src/lib/marines';

export interface MarineAssets {
  fetch(request: Request | string): Promise<Response>;
}

/** A path shaped like a Marine's, valid or not: anything else under /marines/ is the assets' to answer. */
const SERIAL_SHAPED = /^\/marines\/\d+\/?$/;

async function notFound(url: URL, assets: MarineAssets): Promise<Response> {
  const page = await assets.fetch(new Request(new URL('/404', url)));
  return new Response(page.body, { status: 404, headers: page.headers });
}

const setAttribute = (name: string, value: string) => ({
  element(e: Element) {
    e.setAttribute(name, value);
  },
});

/** The template's head made the Marine's: title, description, canonical URL and web card. A Marine page is indexable. */
export function marineHead(page: Response, serial: number): Response {
  const title = `${marineTitle(serial)} · ccip.dev`;
  const url = `${SITE_URL}${marinePath(serial)}`;
  return new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(title) })
    .on('meta[name="robots"]', { element: (e) => void e.remove() })
    .on('meta[name="description"]', setAttribute('content', MARINE_DESCRIPTION))
    .on('meta[property="og:description"]', setAttribute('content', MARINE_DESCRIPTION))
    .on('meta[property="og:title"]', setAttribute('content', title))
    .on('meta[property="og:url"]', setAttribute('content', url))
    .on('link[rel="canonical"]', setAttribute('href', url))
    .on('meta[property="og:image"]', setAttribute('content', webCardUrl(serial)))
    .on('meta[property="og:image:width"]', setAttribute('content', '1200'))
    .on('meta[property="og:image:height"]', setAttribute('content', '675'))
    .on('meta[property="og:image:alt"]', setAttribute('content', `The dog tags of ${marineTitle(serial)}`))
    .transform(page);
}

/**
 * /marines/<serial>/: the padded path gets the template with the Marine's head, other spellings redirect to it, and
 * serial 0 or the template's own path get the 404 page. The bot is never asked, so its outage cannot break a page.
 */
export async function marinePage(request: Request, assets: MarineAssets): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === MARINE_TEMPLATE_PATH || url.pathname === MARINE_TEMPLATE_PATH.slice(0, -1)) return notFound(url, assets);
  if (!SERIAL_SHAPED.test(url.pathname)) return assets.fetch(request);
  const serial = serialFromPath(url.pathname);
  if (serial === null) return notFound(url, assets);
  const canonical = marinePath(serial);
  if (url.pathname !== canonical) return Response.redirect(new URL(`${canonical}${url.search}`, url).href, 301);
  const template = await assets.fetch(new Request(new URL(MARINE_TEMPLATE_PATH, url)));
  if (!template.ok) return template;
  return marineHead(template, serial);
}
