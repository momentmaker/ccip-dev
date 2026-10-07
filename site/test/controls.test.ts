import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChainPicker from '../src/components/controls/ChainPicker';
import RecordPill from '../src/components/controls/RecordPill';
import Scrubber from '../src/components/controls/Scrubber';
import { activeAfterSearch, BAR_IDLE_MS, barVisible, filterChains, formatClock, moveIndex, nearestMark, pickableChains, spacedTicks } from '../src/lib/controls';

const chains = [
  { selector: 'e', name: 'Ethereum', value: 3, icon: null },
  { selector: 'b', name: 'Base', value: 2, icon: null },
  { selector: 'n', name: 'BNB Chain', value: 1, icon: null },
];

describe('filterChains', () => {
  it('matches case-insensitively anywhere in the name, keeping order', () => {
    expect(filterChains('b', chains).map((c) => c.selector)).toEqual(['b', 'n']);
    expect(filterChains('CHAIN', chains).map((c) => c.selector)).toEqual(['n']);
  });

  it('ignores spaces and returns everything for an empty query', () => {
    expect(filterChains('bnbch', chains).map((c) => c.selector)).toEqual(['n']);
    expect(filterChains('  ', chains)).toHaveLength(3);
  });
});

describe('moveIndex', () => {
  it('wraps around both ends', () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(-1, -1, 3)).toBe(2);
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
});

describe('nearestMark', () => {
  const marks = [{ time: 5 }, { time: 10 }];
  it('finds the mark under the pointer within the tolerance', () => {
    expect(nearestMark(marks, 10.2, 30)).toBe(1);
    expect(nearestMark(marks, 7.5, 30)).toBe(-1);
  });
});

describe('formatClock', () => {
  it.each([[0, '0:00'], [9.6, '0:09'], [30, '0:30'], [75, '1:15']])('%s s is %s', (s, text) => {
    expect(formatClock(s)).toBe(text);
  });
});

describe('barVisible', () => {
  const base = { playing: false, recording: false, lastActivityMs: 0, nowMs: 60_000 };

  it('stays visible while not playing', () => {
    expect(barVisible(base)).toBe(true);
  });

  it('stays visible while playing and recently active', () => {
    expect(barVisible({ ...base, playing: true, lastActivityMs: 59_000 })).toBe(true);
  });

  it('hides while playing once idle for longer than the window', () => {
    expect(barVisible({ ...base, playing: true, lastActivityMs: 60_000 - BAR_IDLE_MS - 1 })).toBe(false);
  });

  it('hides while recording once idle', () => {
    expect(barVisible({ ...base, recording: true })).toBe(false);
  });
});

describe('pickableChains', () => {
  it('offers only chains that have a replay page', () => {
    expect(pickableChains(chains, { e: 'ethereum', n: 'bnb-chain' }).map((c) => c.selector)).toEqual(['e', 'n']);
  });

  it('ignores names that only exist on Object.prototype', () => {
    expect(pickableChains([{ selector: 'constructor', name: 'X', value: 1, icon: null }], {})).toEqual([]);
  });
});

describe('activeAfterSearch', () => {
  it('keeps All chains active for an empty query', () => {
    expect(activeAfterSearch('  ', 3)).toBe(0);
  });

  it('moves to the first match when the query has results', () => {
    expect(activeAfterSearch('eth', 1)).toBe(1);
  });

  it('stays on All chains when nothing matches, so the active option always exists', () => {
    expect(activeAfterSearch('zzz', 0)).toBe(0);
  });
});

describe('control markup', () => {
  const noop = () => {};

  it('steps the scrubber in tenths of a second', () => {
    const html = renderToStaticMarkup(createElement(Scrubber, { length: 30, time: 0, onScrub: noop, marks: [], ticks: [], valueText: 'Jul 6, 2023' }));
    expect(html).toContain('step="0.1"');
  });

  it('shows a focus chain without an icon as its initial on a coin, not the All chains mark', () => {
    const html = renderToStaticMarkup(createElement(ChainPicker, { chains: [{ selector: 'k', name: 'Kroma', value: 1, icon: null }], value: 'k', onChange: noop }));
    expect(html).toContain('<span class="all-coin" aria-hidden="true">K</span>');
    expect(html).not.toContain('✦');
  });

  it('keeps the All chains mark when no chain is chosen', () => {
    const html = renderToStaticMarkup(createElement(ChainPicker, { chains: [{ selector: 'k', name: 'Kroma', value: 1, icon: null }], value: null, onChange: noop }));
    expect(html).toContain('✦');
  });

  it('reports recording progress as a progressbar, without a live region that reads every percent', () => {
    const html = renderToStaticMarkup(createElement(RecordPill, { progress: 0.42, onCancel: noop }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('Recording · 42%');
    expect(html).not.toMatch(/role="status"|aria-live/);
  });
});

describe('spacedTicks', () => {
  const ticks = [{ time: 2, label: '2023' }, { time: 2.6, label: '2024' }, { time: 12, label: '2025' }, { time: 22, label: '2026' }];

  it('drops a year label that would print over a later one on a narrow scrubber, keeping the latest years', () => {
    // #given a 280 px rail, where 2023 and 2024 sit 5.6 px apart
    // #when ticks are spaced 32 px apart
    // #then 2023 goes and the later years stay
    expect(spacedTicks(ticks, 30, 280, 32).map((t) => t.label)).toEqual(['2024', '2025', '2026']);
  });

  it('keeps every year when the rail is wide enough', () => {
    expect(spacedTicks(ticks, 30, 4000, 32)).toHaveLength(4);
  });

  it('keeps every year before the rail has been measured', () => {
    expect(spacedTicks(ticks, 30, 0, 32)).toHaveLength(4);
  });
});
