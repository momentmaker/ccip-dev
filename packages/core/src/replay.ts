export interface LaneDayRow {
  day: string;
  key: string;
  messages: number;
  usd_value: number;
}

export interface ChainNames {
  name: string | null;
  display_name: string | null;
}

export interface ReplayChain extends ChainNames {
  selector: string;
  first_day: string;
}

export interface Replay {
  chains: ReplayChain[];
  lanes: [number, number][];
  days: { day: string; lanes: [number, number, number][] }[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function laneEnds(key: string): [string, string] | null {
  const parts = key.split('>');
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

export function buildReplay(rows: LaneDayRow[], names: Map<string, ChainNames>): Replay {
  const sorted = rows
    .flatMap((r) => {
      const ends = laneEnds(r.key);
      return ends ? [{ ...r, ends }] : [];
    })
    .sort((a, b) => compare(a.day, b.day) || compare(a.key, b.key));

  const firstDay = new Map<string, string>();
  for (const r of sorted) for (const selector of r.ends) if (!firstDay.has(selector)) firstDay.set(selector, r.day);

  const chains = [...firstDay]
    .sort(([a, dayA], [b, dayB]) => compare(dayA, dayB) || compare(a, b))
    .map(([selector, first_day]) => ({
      selector,
      name: names.get(selector)?.name ?? null,
      display_name: names.get(selector)?.display_name ?? null,
      first_day,
    }));
  const chainIndex = new Map(chains.map((c, i) => [c.selector, i]));

  const laneIndex = new Map<string, number>();
  const lanes: [number, number][] = [];
  const days: Replay['days'] = [];
  for (const r of sorted) {
    let lane = laneIndex.get(r.key);
    if (lane === undefined) {
      lane = lanes.length;
      laneIndex.set(r.key, lane);
      lanes.push([chainIndex.get(r.ends[0])!, chainIndex.get(r.ends[1])!]);
    }
    if (days.at(-1)?.day !== r.day) days.push({ day: r.day, lanes: [] });
    days.at(-1)!.lanes.push([lane, r.messages, Math.round(r.usd_value)]);
  }
  for (const d of days) d.lanes.sort((a, b) => a[0] - b[0]);
  return { chains, lanes, days };
}
