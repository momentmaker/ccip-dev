import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { chordScale, flowData, labelAngle, truncateLabel } from '../src/lib/flow';
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

  it('counts a lane between two Other chains once in the Other group', () => {
    const withInnerLane: ReplayFile = {
      ...replay,
      lanes: [...replay.lanes, [0, 2]],
      days: [...replay.days, { day: '2023-07-10', lanes: [[4, 3, 250]] }],
    };
    const flow = flowData(withInnerLane, 'all', names, 1);
    expect(flow.groups.map((g) => g.key)).toEqual(['5009297550715157269', 'other']);
    expect(flow.groups[1]).toMatchObject({ usd: 1_504_750, messages: 63 });
    expect(flow.usd[1]).toEqual([800, 250]);
    expect(flow.messages[1]).toEqual([5, 3]);
  });

  it('lists the top lanes by value with readable names', () => {
    expect(flowData(replay, '7d', names).topLanes).toEqual([
      { label: 'Ethereum → Base', src: '5009297550715157269', dst: '15971525489660198786', usd: 1_500_700, messages: 12 },
      { label: 'Ethereum → Polygon', src: '5009297550715157269', dst: '4051577828743386545', usd: 3_000, messages: 43 },
      { label: 'Polygon → Ethereum', src: '4051577828743386545', dst: '5009297550715157269', usd: 500, messages: 4 },
      { label: 'Solana → Ethereum', src: '124615329519749607', dst: '5009297550715157269', usd: 300, messages: 1 },
    ]);
  });

  it('carries the source and destination of the busiest lane first', () => {
    expect(flowData(replay, '7d', names).topLanes[0]).toMatchObject({ src: '5009297550715157269', dst: '15971525489660198786' });
  });

  it('has no Other group when every chain fits', () => {
    expect(flowData(replay, '30d', names).groups.map((g) => g.key)).not.toContain('other');
  });

  it('is empty without replay days', () => {
    expect(flowData({ ...replay, days: [] }, '7d', names)).toEqual({ groups: [], usd: [], messages: [], topLanes: [] });
  });
});

describe('labelAngle', () => {
  const groupRotation = (mid: number) => (mid * 180) / Math.PI - 90 + (mid > Math.PI ? 180 : 0);

  it.each([0.5, 4.0])('cancels the label rotation for an icon at mid %s', (mid) => {
    const total = groupRotation(mid) + -labelAngle(mid);
    expect(((total % 360) + 360) % 360).toBeCloseTo(0);
  });

  it('turns the label half a turn on the left half', () => {
    expect(labelAngle(Math.PI + 0.1) - labelAngle(Math.PI - 0.1)).toBeCloseTo(180 + (0.2 * 180) / Math.PI);
  });
});

describe('chordScale', () => {
  it('keeps the design sizes when the chord is drawn near its native width', () => {
    expect(chordScale(640)).toMatchObject({ font: 12, icon: 14, margin: 90, maxChars: Infinity });
    expect(chordScale(720).font).toBe(12);
    expect(chordScale(null).font).toBe(12);
  });

  it('keeps labels at least 10 px on screen when the chord is shrunk', () => {
    for (const width of [358, 300, 420, 500]) {
      const { font } = chordScale(width);
      expect((font * width) / 640).toBeGreaterThanOrEqual(10 - 1e-9);
    }
  });

  it('grows the label margin and shortens names when it has to scale up', () => {
    const phone = chordScale(358);
    expect(phone.margin).toBeGreaterThan(90);
    expect(phone.icon).toBeGreaterThan(14);
    expect(phone.maxChars).toBe(11);
  });
});

describe('chordScale minArc', () => {
  it('needs a wider arc before labelling a chain when labels are larger relative to the ring', () => {
    expect(chordScale(640).minArc).toBeCloseTo(0.052, 2);
    expect(chordScale(320).minArc).toBeGreaterThan(chordScale(640).minArc * 1.5);
  });
});

describe('truncateLabel', () => {
  it('shortens with an ellipsis only when over the limit', () => {
    expect(truncateLabel('Arbitrum One', 11)).toBe('Arbitrum O…');
    expect(truncateLabel('Base', 11)).toBe('Base');
    expect(truncateLabel('Arbitrum One', Infinity)).toBe('Arbitrum One');
  });
});
