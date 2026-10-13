import { describe, expect, it } from 'vitest';
import worker from '../index';
import { marinePage } from '../marines';

/** The template's head as Base.astro writes it, noindex included. */
const TEMPLATE = `<!doctype html><html lang="en"><head><title>LinkMarine · ccip.dev</title><meta name="description" content="x"><link rel="canonical" href="https://ccip.dev/marines/marine/"><meta name="robots" content="noindex"><meta property="og:title" content="LinkMarine · ccip.dev"><meta property="og:description" content="x"><meta property="og:url" content="https://ccip.dev/marines/marine/"><meta property="og:image" content="https://ccip.dev/og-default.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="LinkMarine · ccip.dev"></head><body><main></main></body></html>`;

function assets() {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (request: Request | string) => {
      const path = new URL(typeof request === 'string' ? request : request.url).pathname;
      seen.push(path);
      if (path === '/marines/marine/') return new Response(TEMPLATE, { headers: { 'Content-Type': 'text/html' } });
      if (path === '/404') return new Response('<h1>Not found</h1>', { headers: { 'Content-Type': 'text/html' } });
      return new Response(`asset ${path}`, { headers: { 'Content-Type': 'text/html' } });
    },
  };
}

const page = (path: string, a = assets()) => marinePage(new Request(`https://ccip.dev${path}`), a);
/** An attribute's value, its escaped apostrophes decoded (HTMLRewriter may write ' as &#39;). */
const attr = (html: string, selector: RegExp) => selector.exec(html)?.[1]?.replace(/&#39;|&#x27;|&apos;/g, "'") ?? null;

describe('a Marine page', () => {
  it('serves the template with the Marine’s title, description, canonical URL and web card', async () => {
    // #when
    const html = await (await page('/marines/0007/')).text();
    // #then
    expect({
      title: attr(html, /<title>([^<]*)<\/title>/),
      ogTitle: attr(html, /property="og:title" content="([^"]*)"/),
      description: attr(html, /name="description" content="([^"]*)"/),
      ogDescription: attr(html, /property="og:description" content="([^"]*)"/),
      canonical: attr(html, /rel="canonical" href="([^"]*)"/),
      url: attr(html, /property="og:url" content="([^"]*)"/),
      image: attr(html, /property="og:image" content="([^"]*)"/),
      size: [attr(html, /og:image:width" content="([^"]*)"/), attr(html, /og:image:height" content="([^"]*)"/)],
      alt: attr(html, /og:image:alt" content="([^"]*)"/),
      noindex: html.includes('noindex'),
    }).toEqual({
      title: 'LINK MARINE #0007 · ccip.dev',
      ogTitle: 'LINK MARINE #0007 · ccip.dev',
      description: "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it.",
      ogDescription: "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it.",
      canonical: 'https://ccip.dev/marines/0007/',
      url: 'https://ccip.dev/marines/0007/',
      image: 'https://discord.ccip.dev/web/7.png',
      size: ['1200', '675'],
      alt: 'The dog tags of LINK MARINE #0007',
      noindex: false,
    });
  });

  it('redirects any other spelling of the serial to its padded path, keeping the query', async () => {
    // #when
    const answers = await Promise.all(['/marines/7/', '/marines/7', '/marines/007/?ref=x'].map((p) => page(p)));
    // #then
    expect(answers.map((r) => [r.status, r.headers.get('location')])).toEqual([
      [301, 'https://ccip.dev/marines/0007/'],
      [301, 'https://ccip.dev/marines/0007/'],
      [301, 'https://ccip.dev/marines/0007/?ref=x'],
    ]);
  });

  it('answers the 404 page for serial 0, a serial too long to be one, and the template’s own path', async () => {
    // #when
    const answers = await Promise.all(['/marines/0/', '/marines/1234567890/', '/marines/marine/', '/marines/marine'].map((p) => page(p)));
    // #then
    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });

  it('passes the roster and any other /marines/ path through to the assets', async () => {
    // #given
    const a = assets();
    // #when
    const answers = await Promise.all(['/marines/', '/marines/about/'].map((p) => page(p, a)));
    // #then
    expect([await answers[0]!.text(), await answers[1]!.text()]).toEqual(['asset /marines/', 'asset /marines/about/']);
  });

  it('serves a five-digit serial at its own digits', async () => {
    // #when
    const html = await (await page('/marines/12345/')).text();
    // #then
    expect(attr(html, /<title>([^<]*)<\/title>/)).toBe('LINK MARINE #12345 · ccip.dev');
  });
});

describe('the site Worker', () => {
  it('routes /marines/ paths to the Marine page handler', async () => {
    // #when
    const res = await worker.fetch(new Request('https://ccip.dev/marines/7/'), { ASSETS: assets() } as never, {} as ExecutionContext);
    // #then
    expect(res.status).toBe(301);
  });
});
