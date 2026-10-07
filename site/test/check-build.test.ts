import { describe, expect, it } from 'vitest';
import { checkIconFiles, checkPages, checkSiteIcons, htmlIds, isRedirectPage, pageFacts } from '../scripts/check-build';

const page = (title: string, og: string, canonical: string) =>
  `<html><head><title>${title}</title><meta property="og:image" content="${og}"><link rel="canonical" href="${canonical}"></head><body><h2 id="coverage">C</h2></body></html>`;
const OG = 'https://ccip.dev/og/home.png?v=2026-10-07';

describe('check-build', () => {
  it('reports a site icon missing from the build root, including the favicon.ico browsers request by default', () => {
    expect(checkSiteIcons(new Set(['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']))).toEqual(['/favicon.ico: site icon is missing from the build']);
  });

  it('passes when every site icon is in the build root', () => {
    expect(checkSiteIcons(new Set(['favicon.ico', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']))).toEqual([]);
  });

  it('reports manifest icons missing from dist/chains', () => {
    expect(checkIconFiles(['a.svg', 'b.svg'], new Set(['a.svg']))).toEqual(['/chains/b.svg: icon listed in the manifest is missing from the build']);
    expect(checkIconFiles(['a.svg'], new Set(['a.svg']))).toEqual([]);
  });

  it('reads the title, og:image and canonical URL of a page', () => {
    expect(pageFacts('/', page('ccip.dev', OG, 'https://ccip.dev/'))).toEqual({ path: '/', title: 'ccip.dev', ogImage: OG, canonical: 'https://ccip.dev/' });
  });

  it('finds element ids and redirect pages', () => {
    expect(htmlIds(page('a', OG, 'https://ccip.dev/'))).toEqual(new Set(['coverage']));
    expect(isRedirectPage('<meta http-equiv="refresh" content="0;url=/history/30d/">')).toBe(true);
    expect(isRedirectPage(page('a', OG, 'https://ccip.dev/'))).toBe(false);
  });

  it('accepts a clean build', () => {
    const pages = [pageFacts('/', page('ccip.dev', OG, 'https://ccip.dev/')), pageFacts('/about/', page('About · ccip.dev', 'https://ccip.dev/og-default.png', 'https://ccip.dev/about/'))];
    expect(checkPages(pages, new Set(['coverage']), ['coverage'])).toEqual([]);
  });

  it('reports duplicate titles, bad cards, missing canonicals and missing anchors', () => {
    const pages = [
      pageFacts('/a/', page('Same', OG, 'https://ccip.dev/a/')),
      pageFacts('/b/', page('Same', 'https://elsewhere.example/x.png', 'https://ccip.dev/b/')),
      pageFacts('/c/', '<title>C</title>'),
    ];
    expect(checkPages(pages, new Set(), ['coverage'])).toEqual([
      '/b/: title "Same" repeats /a/',
      '/b/: og:image https://elsewhere.example/x.png is not an allowed card URL',
      '/c/: og:image (missing) is not an allowed card URL',
      '/c/: canonical (missing) is not on https://ccip.dev/',
      '/methodology/: no element with id "coverage"',
    ]);
  });
});
