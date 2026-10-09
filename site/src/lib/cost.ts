import type { CostFile, CostLane } from '@ccip-dev/core/public';

export interface CostChain {
  selector: string;
  name: string;
  slug: string;
}

export interface CostRoute {
  src: string;
  dst: string;
  lane: CostLane | null;
}

export interface ChainIndex {
  bySelector: ReadonlyMap<string, CostChain>;
  bySlug: ReadonlyMap<string, string>;
}

export function chainIndex(chains: readonly CostChain[]): ChainIndex {
  return { bySelector: new Map(chains.map((c) => [c.selector, c])), bySlug: new Map(chains.map((c) => [c.slug, c.selector])) };
}

/** A chain new since the last site build is named by its selector, which is also its slug. */
export function chainOf(index: ChainIndex, selector: string): CostChain {
  return index.bySelector.get(selector) ?? { selector, name: selector, slug: selector };
}

function busiest(lanes: readonly CostLane[]): CostLane | null {
  return lanes.reduce<CostLane | null>((best, l) => (best === null || l.messages > best.messages ? l : best), null);
}

export function routeOf(cost: CostFile, src: string, dst: string): CostRoute {
  return { src, dst, lane: cost.lanes.find((l) => l.src === src && l.dst === dst) ?? null };
}

export function defaultRoute(cost: CostFile): CostRoute | null {
  const lane = busiest(cost.lanes);
  return lane === null ? null : { src: lane.src, dst: lane.dst, lane };
}

/** Reads `?from=<slug>&to=<slug>`. A name that is not a known chain falls back to the busiest route. */
export function routeFromQuery(cost: CostFile, index: ChainIndex, search: string): CostRoute | null {
  if (cost.lanes.length === 0) return null;
  const params = new URLSearchParams(search);
  const listed = new Set(cost.lanes.flatMap((l) => [l.src, l.dst]));
  const resolve = (name: string | null): string | null => {
    const key = (name ?? '').trim().toLowerCase();
    return index.bySlug.get(key) ?? (listed.has(key) ? key : null);
  };
  const src = resolve(params.get('from'));
  const dst = resolve(params.get('to'));
  return src !== null && dst !== null ? routeOf(cost, src, dst) : defaultRoute(cost);
}

export function routeQuery(index: ChainIndex, route: Pick<CostRoute, 'src' | 'dst'>): string {
  return `?${new URLSearchParams({ from: chainOf(index, route.src).slug, to: chainOf(index, route.dst).slug }).toString()}`;
}

/** The selected chain stays listed even without data, so a route opened from a link still shows in the selects. */
function options(index: ChainIndex, selectors: readonly string[], selected: string | null): CostChain[] {
  const all = new Set(selectors);
  if (selected !== null) all.add(selected);
  return [...all].map((s) => chainOf(index, s)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function sourceOptions(cost: CostFile, index: ChainIndex, selected: string | null): CostChain[] {
  return options(index, cost.lanes.map((l) => l.src), selected);
}

export function destinationOptions(cost: CostFile, index: ChainIndex, src: string, selected: string | null): CostChain[] {
  return options(index, cost.lanes.filter((l) => l.src === src).map((l) => l.dst), selected);
}

/** After From changes, To stays when the new source has data for it; otherwise it moves to the source's busiest destination. */
export function routeForSource(cost: CostFile, src: string, dst: string): CostRoute {
  const current = routeOf(cost, src, dst);
  if (current.lane !== null) return current;
  const lane = busiest(cost.lanes.filter((l) => l.src === src));
  return lane === null ? current : { src, dst: lane.dst, lane };
}
