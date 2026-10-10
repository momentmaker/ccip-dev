import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HistoryCharts from '../src/components/HistoryCharts';
import Scrubber from '../src/components/controls/Scrubber';

const scrubber = () =>
  renderToString(createElement(Scrubber, { length: 10, time: 1, onScrub: () => {}, marks: [], ticks: [], valueText: '0:01' }));

describe('form fields carry a name and an id', () => {
  it('history charts switch daily and cumulative with buttons, so they have no bare input', () => {
    const out = renderToString(createElement(HistoryCharts, { rows: [], feesSince: null }));
    expect(out).not.toMatch(/<input/);
  });

  it('scrubber range', () => {
    expect(scrubber()).toMatch(/<input[^>]*name="position"/);
    expect(scrubber()).toMatch(/<input[^>]*id="[^"]+"/);
  });

  it('gives two scrubbers on one page different ids', () => {
    const both = renderToString(createElement('div', null, createElement(Scrubber, { length: 10, time: 1, onScrub: () => {}, marks: [], ticks: [], valueText: 'a' }), createElement(Scrubber, { length: 10, time: 1, onScrub: () => {}, marks: [], ticks: [], valueText: 'b' })));
    const found = [...both.matchAll(/<input[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(found).size).toBe(2);
  });
});
