import type { CostFile, CostLane } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { chainIndex, defaultRoute, destinationOptions, routeForSource, routeFromQuery, routeQuery, sourceOptions } from '../src/lib/cost';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const ARB = '4949039107694359620';
const NEW = '999';
const lane = (src: string, dst: string, messages: number): CostLane => ({ src, dst, messages, median_usd: 0.5, p10_usd: 0.1, p90_usd: 2 });
const cost: CostFile = {
  schema_version: 1, updated_at: '2026-10-08T00:10:00.000Z', attribution: 'x', from: '2026-09-08', to: '2026-10-07',
  lanes: [lane(ETH, BASE, 900), lane(BASE, ETH, 400), lane(ETH, ARB, 120), lane(NEW, BASE, 7)],
};
const index = chainIndex([
  { selector: ETH, name: 'Ethereum', slug: 'ethereum' },
  { selector: BASE, name: 'Base', slug: 'base' },
  { selector: ARB, name: 'Arbitrum', slug: 'arbitrum' },
]);
const names = (list: { name: string }[]) => list.map((c) => c.name);

describe('routeFromQuery', () => {
  it('opens the route a ?from=&to= link names', () => {
    expect(routeFromQuery(cost, index, '?from=base&to=ethereum')).toEqual({ src: BASE, dst: ETH, lane: cost.lanes[1] });
  });

  it('reads a hand-typed name in any case', () => {
    expect(routeFromQuery(cost, index, '?from=Base&to=ETHEREUM')).toMatchObject({ src: BASE, dst: ETH });
  });

  it('falls back to the busiest route when a name is not a known chain', () => {
    expect(routeFromQuery(cost, index, '?from=base&to=atlantis')).toEqual({ src: ETH, dst: BASE, lane: cost.lanes[0] });
  });

  it('opens the busiest route without a query', () => {
    expect(routeFromQuery(cost, index, '')).toEqual({ src: ETH, dst: BASE, lane: cost.lanes[0] });
  });

  it('keeps a known route that cost.json does not list, with no lane', () => {
    expect(routeFromQuery(cost, index, '?from=arbitrum&to=base')).toEqual({ src: ARB, dst: BASE, lane: null });
  });

  it('treats the same chain twice as a route without data', () => {
    expect(routeFromQuery(cost, index, '?from=base&to=base')).toEqual({ src: BASE, dst: BASE, lane: null });
  });

  it('resolves a chain the build did not know by its selector', () => {
    expect(routeFromQuery(cost, index, `?from=${NEW}&to=base`)).toEqual({ src: NEW, dst: BASE, lane: cost.lanes[3] });
  });

  it('has no route when cost.json lists none', () => {
    expect(routeFromQuery({ ...cost, lanes: [] }, index, '?from=base&to=ethereum')).toBeNull();
  });
});

describe('defaultRoute', () => {
  it('gives a tie in messages to the route listed first', () => {
    // #given
    const tied = { ...cost, lanes: [lane(BASE, ETH, 5), lane(ETH, BASE, 5)] };
    // #when, #then
    expect(defaultRoute(tied)).toMatchObject({ src: BASE, dst: ETH });
  });
});

describe('routeQuery', () => {
  it('writes both chains as slugs, and a chain the build did not know as its selector', () => {
    expect([routeQuery(index, { src: BASE, dst: ETH }), routeQuery(index, { src: NEW, dst: BASE })]).toEqual(['?from=base&to=ethereum', `?from=${NEW}&to=base`]);
  });
});

describe('select options', () => {
  it('lists the sources in cost.json by name', () => {
    expect(names(sourceOptions(cost, index, null))).toEqual([NEW, 'Base', 'Ethereum']);
  });

  it("keeps the selected chain listed when it has no data, so a link's route shows in the selects", () => {
    expect(names(sourceOptions(cost, index, ARB))).toEqual([NEW, 'Arbitrum', 'Base', 'Ethereum']);
  });

  it('lists only the destinations with data for the chosen source', () => {
    expect(names(destinationOptions(cost, index, ETH, null))).toEqual(['Arbitrum', 'Base']);
  });
});

describe('routeForSource', () => {
  it('keeps the destination when the new source has data for it', () => {
    expect(routeForSource(cost, ETH, ARB)).toEqual({ src: ETH, dst: ARB, lane: cost.lanes[2] });
  });

  it("moves to the new source's busiest destination otherwise", () => {
    expect(routeForSource(cost, BASE, ARB)).toEqual({ src: BASE, dst: ETH, lane: cost.lanes[1] });
  });
});
