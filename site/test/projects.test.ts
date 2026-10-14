import { PUBLIC_SCHEMAS } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { addressExplorerUrl, kindLabel, labelFileUrl, projectIndexRows, projectPaths, seriesPoints, splitText } from '../src/lib/projects';
import fixture from './fixtures/projects.json';

const FILE = PUBLIC_SCHEMAS['projects.json'].parse(fixture);
const [XSTOCKS, IDLE] = FILE.projects;

describe('project pages', () => {
  it('builds one page per project, and none before projects.json is published', () => {
    // #then
    expect([projectPaths(FILE).map((p) => p.params.slug), projectPaths(null)]).toEqual([['xstocks', 'idle'], []]);
  });

  it('lists the projects in the file’s order with their kind, handle, 7-day messages and share, 30-day value and chains', () => {
    // #when
    const [row] = projectIndexRows(FILE.projects);
    // #then
    expect(row).toEqual({
      slug: 'xstocks', href: '/projects/xstocks/', name: 'xStocks', kind: 'Protocol', x: 'xStocksFi',
      messages7d: 319, share7d: 20.3, usd30d: 0, chains: XSTOCKS!.chains,
    });
  });

  it('words the data split, and has none for a project without messages', () => {
    // #then
    expect([splitText(XSTOCKS!.split), splitText(IDLE!.split)]).toEqual(['67% data messages · 33% token transfers', null]);
  });

  it('charts the series day by day', () => {
    // #then
    expect(seriesPoints(XSTOCKS!.series)).toEqual([{ day: '2026-10-11', value: 0 }, { day: '2026-10-12', value: 100 }, { day: '2026-10-13', value: 319 }]);
  });

  it('links an address to the CCIP Explorer, a project to its label file, and names an unknown kind a project', () => {
    // #then
    expect([addressExplorerUrl('A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u'), labelFileUrl('xstocks'), kindLabel('issuer'), kindLabel('robot')]).toEqual([
      'https://ccip.chain.link/address/A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u',
      'https://github.com/momentmaker/ccip-dev/blob/main/labels/projects/xstocks.toml',
      'Token issuer',
      'Project',
    ]);
  });
});
