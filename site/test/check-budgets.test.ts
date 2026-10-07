import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { entryScripts, reachableBytes, staticImports } from '../scripts/check-budgets';

describe('check-budgets', () => {
  it('finds module scripts, island components and preloads in a page', () => {
    const html = `<script type="module" src="/_astro/page.A1.js"></script><link rel="modulepreload" href="/_astro/react.B2.js"><astro-island component-url="/_astro/HomeLive.C3.js" renderer-url="/_astro/client.D4.js"></astro-island><script src="https://analytics.jivx.com/script.js"></script>`;
    expect(entryScripts(html)).toEqual(['/_astro/page.A1.js', '/_astro/react.B2.js', '/_astro/HomeLive.C3.js', '/_astro/client.D4.js']);
  });

  it('follows static imports but not dynamic ones', () => {
    expect(staticImports('import{a as b}from"./x.js";import"./y.js";const m=import("./lazy.js");export{c}from"../z.js"')).toEqual(['./x.js', './y.js', '../z.js']);
  });

  it('sums the gzip size of everything reachable once', async () => {
    const files: Record<string, string> = {
      '/_astro/a.js': 'import"./b.js";import("./c.js")',
      '/_astro/b.js': 'import"./a.js";console.log(1)',
      '/_astro/c.js': 'x'.repeat(10_000),
    };
    const result = await reachableBytes(['/_astro/a.js'], async (p) => files[p]!);
    expect(result.files).toEqual(['/_astro/a.js', '/_astro/b.js']);
    expect(result.gzipBytes).toBe(gzipSync(files['/_astro/a.js']!).length + gzipSync(files['/_astro/b.js']!).length);
  });
});
