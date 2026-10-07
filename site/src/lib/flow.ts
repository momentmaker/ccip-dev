import type { ReplayFile } from '@ccip-dev/core/public';
import { lastReplayDay, windowWeights } from '../sky/weights';
import type { Window } from './card-paths';
import { addDays } from './days';
import { chainName, laneLabel, type ChainNames } from './names';

export const FLOW_TOP = 20;
export const OTHER = 'other';
export const WINDOW_DAYS: Record<Window, number | null> = { '7d': 7, '30d': 30, all: null };

export interface FlowGroup {
  key: string;
  label: string;
  usd: number;
  messages: number;
}

export interface FlowData {
  groups: FlowGroup[];
  usd: number[][];
  messages: number[][];
  topLanes: { label: string; src: string; dst: string; usd: number; messages: number }[];
}

const square = (n: number) => Array.from({ length: n }, () => new Array<number>(n).fill(0));

export function flowData(replay: ReplayFile, window: Window, names: ChainNames, top = FLOW_TOP): FlowData {
  const last = lastReplayDay(replay);
  if (!last) return { groups: [], usd: [], messages: [], topLanes: [] };
  const days = WINDOW_DAYS[window];
  const weights = windowWeights(replay, days === null ? null : addDays(last, -(days - 1)), last);

  const ranked = [...weights.chains].sort(([a, va], [b, vb]) => vb - va || (a < b ? -1 : a > b ? 1 : 0)).map(([s]) => s);
  const kept = ranked.slice(0, top);
  const keys = ranked.length > top ? [...kept, OTHER] : kept;
  const index = new Map(kept.map((s, i) => [s, i]));
  const group = (selector: string) => index.get(selector) ?? keys.length - 1;

  const usd = square(keys.length);
  const messages = square(keys.length);
  const groupUsd = new Array<number>(keys.length).fill(0);
  const groupMessages = new Array<number>(keys.length).fill(0);
  for (const lane of weights.lanes) {
    const i = group(lane.src);
    const j = group(lane.dst);
    usd[i]![j]! += lane.usd;
    messages[i]![j]! += lane.messages;
    for (const g of new Set([i, j])) {
      groupUsd[g]! += lane.usd;
      groupMessages[g]! += lane.messages;
    }
  }

  return {
    groups: keys.map((key, i) => ({ key, label: key === OTHER ? 'Other' : chainName(names, key), usd: groupUsd[i]!, messages: groupMessages[i]! })),
    usd,
    messages,
    topLanes: [...weights.lanes]
      .sort((a, b) => b.usd - a.usd || b.messages - a.messages)
      .slice(0, FLOW_TOP)
      .map((l) => ({ label: laneLabel(names, `${l.src}>${l.dst}`), src: l.src, dst: l.dst, usd: l.usd, messages: l.messages })),
  };
}
