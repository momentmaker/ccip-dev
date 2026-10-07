import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { flowData } from '../src/lib/flow';
import { chainNameMap } from '../src/lib/names';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const names = chainNameMap(replay.chains);

describe('flowData', () => {
  it('keeps the top chains by value and groups the rest as Other', () => {
    const flow = flowData(replay, 'all', names, 2);
    expect(flow.groups).toEqual([
      { key: '5009297550715157269', label: 'Ethereum', usd: 1_504_500, messages: 60 },
      { key: '15971525489660198786', label: 'Base', usd: 1_500_700, messages: 12 },
      { key: 'other', label: 'Other', usd: 3_800, messages: 48 },
    ]);
    expect(flow.usd).toEqual([
      [0, 1_500_700, 3_000],
      [0, 0, 0],
      [800, 0, 0],
    ]);
    expect(flow.messages).toEqual([
      [0, 12, 43],
      [0, 0, 0],
      [5, 0, 0],
    ]);
  });

  it('lists the top lanes by value with readable names', () => {
    expect(flowData(replay, '7d', names).topLanes).toEqual([
      { label: 'Ethereum → Base', usd: 1_500_700, messages: 12 },
      { label: 'Ethereum → Polygon', usd: 3_000, messages: 43 },
      { label: 'Polygon → Ethereum', usd: 500, messages: 4 },
      { label: 'Solana → Ethereum', usd: 300, messages: 1 },
    ]);
  });

  it('has no Other group when every chain fits', () => {
    expect(flowData(replay, '30d', names).groups.map((g) => g.key)).not.toContain('other');
  });

  it('is empty without replay days', () => {
    expect(flowData({ ...replay, days: [] }, '7d', names)).toEqual({ groups: [], usd: [], messages: [], topLanes: [] });
  });
});
