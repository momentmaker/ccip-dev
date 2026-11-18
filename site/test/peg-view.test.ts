import { PEG_FILE_FIXTURE, PEG_HISTORY_FIXTURE } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { activeSide, episodeRows, formatGap, gapChart, markerLabel, nearestPoint, priceText, rangeRows, recordsView, routeRows } from '../src/lib/peg-view';

const NOW = new Date('2026-11-18T01:40:00.000Z');

describe('formats', () => {
  it('signs the gap with a true minus and keeps two decimals', () => {
    expect(formatGap(-0.0084)).toBe('−0.84%');
    expect(formatGap(0.0254)).toBe('+2.54%');
    expect(formatGap(0.00004)).toBe('0.00%');
    expect(priceText(0.999751)).toBe('1 stLINK = 0.99975 LINK');
  });

  it('calls the side the gap is on, or none at exactly 1:1', () => {
    expect(activeSide(-0.0002)).toBe('discount');
    expect(activeSide(0.0002)).toBe('premium');
    expect(activeSide(0)).toBeNull();
  });
});

describe('routeRows', () => {
  it('describes the discount route', () => {
    expect(routeRows(PEG_FILE_FIXTURE, 'discount')).toEqual([
      { label: 'Curve, under 1:1', value: 'up to 10,000 LINK · +0.53 LINK' },
      { label: 'Redeem at 1:1 now', value: '0.0 LINK' },
      { label: 'Tradeable now', value: 'none' },
      { label: 'Withdrawal queue', value: '1,541 stLINK ahead · next payout after Nov 18 15:50 UTC' },
    ]);
  });

  it('describes the premium route', () => {
    expect(routeRows(PEG_FILE_FIXTURE, 'premium')).toEqual([
      { label: 'Curve, over 1:1', value: 'no size after fees' },
      { label: 'Mint at 1:1 now', value: '1,541 LINK' },
      { label: 'Tradeable now', value: 'none' },
      { label: 'Deposit queue', value: 'empty' },
    ]);
  });
});

describe('rangeRows', () => {
  it('uses hours for 7 and 30 days and days beyond', () => {
    expect(rangeRows(PEG_HISTORY_FIXTURE, '7D', NOW)).toHaveLength(3);
    expect(rangeRows(PEG_HISTORY_FIXTURE, '1Y', NOW).map((r) => r[0].slice(0, 10))).toEqual(['2026-09-23', '2026-09-25', '2026-11-17', '2026-11-18']);
    expect(rangeRows(PEG_HISTORY_FIXTURE, 'All', NOW)).toHaveLength(4);
  });
});

describe('gapChart', () => {
  const opts = { width: 600, height: 200, pad: { top: 10, right: 10, bottom: 20, left: 40 }, thresholds: PEG_HISTORY_FIXTURE.thresholds, episodes: PEG_HISTORY_FIXTURE.episodes, markers: PEG_HISTORY_FIXTURE.markers };

  it('has no chart without rows', () => {
    expect(gapChart([], opts)).toBeNull();
  });

  it('centres zero, draws the threshold bands and spans the time range', () => {
    const c = gapChart(PEG_HISTORY_FIXTURE.days, opts)!;
    expect(c.zeroY).toBeCloseTo(10 + (200 - 30) / 2, 6);
    expect(c.bands.map((b) => b.line)).toEqual([0.0075, 0.003, -0.003, -0.0075]);
    expect(c.points[0]!.x).toBe(40);
    expect(c.points.at(-1)!.x).toBe(590);
    expect(c.path.startsWith('M40 ')).toBe(true);
  });

  it('shades the episodes and pins the markers inside the range', () => {
    const c = gapChart(PEG_HISTORY_FIXTURE.days, opts)!;
    expect(c.spans.map((s) => s.side)).toEqual(['discount', 'premium']);
    expect(c.pins.map((p) => p.label)).toEqual(['80 stake.link vaults began unbonding']);
  });

  it('finds the nearest point to the pointer', () => {
    const c = gapChart(PEG_HISTORY_FIXTURE.days, opts)!;
    expect(nearestPoint(c, 45)).toBe(0);
    expect(nearestPoint(c, 589)).toBe(3);
  });
});

describe('episodeRows', () => {
  it('lists episodes newest first, marking one still running', () => {
    expect(episodeRows(PEG_HISTORY_FIXTURE)).toEqual([
      { side: 'premium', when: 'Sep 25', length: '21h', peak: '+5.64%' },
      { side: 'discount', when: 'Sep 22', length: '79h', peak: '−0.88%' },
    ]);
    const running = { ...PEG_HISTORY_FIXTURE, episodes: [{ ...PEG_HISTORY_FIXTURE.episodes[0]!, end: null }] };
    expect(episodeRows(running)[0]!.length).toBe('79h, running');
  });
});

describe('markerLabel and recordsView', () => {
  it('words the markers', () => {
    expect(markerLabel({ hour: '', kind: 'stakelink_deposit', vaults: 3, link: 12_500 })).toBe('stake.link vaults staked 12,500 LINK');
  });

  it('lists the records', () => {
    expect(recordsView(PEG_HISTORY_FIXTURE, NOW)).toEqual([
      { label: 'Deepest discount', value: '−0.88% · Sep 25 11:00 UTC' },
      { label: 'Highest premium', value: '+5.64% · Sep 25 21:00 UTC' },
      { label: 'Longest episode', value: '79 hours · discount from Sep 22' },
      { label: 'Since the last one', value: '52 days' },
    ]);
  });
});
