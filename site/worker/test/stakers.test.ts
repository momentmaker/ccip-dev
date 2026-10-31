import { describe, expect, it } from 'vitest';
import { stakerPage } from '../stakers';

const TEMPLATE = `<!doctype html><html lang="en"><head><title>Chainlink staker · ccip.dev</title><meta name="description" content="x"><link rel="canonical" href="https://ccip.dev/staking/staker/"><meta name="robots" content="noindex"><meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:url" content="x"><meta property="og:image" content="https://ccip.dev/og-default.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="x"></head><body></body></html>`;
const A = '0x8d87cbd8c3632b7ef117a15f8100943a23b7d03b';

function assets() {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (request: Request | string) => {
      const path = new URL(typeof request === 'string' ? request : request.url).pathname;
      seen.push(path);
      return new Response(path === '/staking/staker/' ? TEMPLATE : `asset ${path}`, { headers: { 'Content-Type': 'text/html' } });
    },
  };
}

const page = (path: string, a = assets()) => stakerPage(new Request(`https://ccip.dev${path}`), a);
const attr = (html: string, re: RegExp) => re.exec(html)?.[1] ?? null;

describe('a staker page', () => {
  it('serves the template with the staker’s title, canonical URL and card, and stays out of search', async () => {
    const html = await (await page(`/staking/${A}/`)).text();
    expect({
      title: attr(html, /<title>([^<]*)<\/title>/),
      canonical: attr(html, /rel="canonical" href="([^"]*)"/),
      image: attr(html, /property="og:image" content="([^"]*)"/),
      height: attr(html, /og:image:height" content="([^"]*)"/),
      noindex: html.includes('noindex'),
    }).toEqual({
      title: 'Staker 0x8d87…d03b · Chainlink staking · ccip.dev',
      canonical: `https://ccip.dev/staking/${A}/`,
      image: `https://ccip.dev/og/staker/${A}.png`,
      height: '675',
      noindex: true,
    });
  });

  it('redirects other spellings to the lowercase path and leaves every other path to the assets', async () => {
    const upper = await page(`/staking/${A.toUpperCase().replace('0X', '0x')}?ref=x`);
    expect([upper.status, upper.headers.get('location')]).toEqual([301, `https://ccip.dev/staking/${A}/?ref=x`]);
    const a = assets();
    await Promise.all(['/staking/', '/staking/staker/', '/staking/0x12/'].map((p) => page(p, a)));
    expect(a.seen).toEqual(['/staking/', '/staking/staker/', '/staking/0x12/']);
  });
});
