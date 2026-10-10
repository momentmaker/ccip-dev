import type { DayTotals } from '@ccip-dev/core/public';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HistoryCharts, { HistoryChartsView } from '../src/components/HistoryCharts';

const row = (day: string, usd: number, fee: number | null): DayTotals => ({
  day, messages: 10, token_messages: 10, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
});

describe('HistoryCharts take rate', () => {
  it('draws the take rate right after the fees, with a text summary and the basis-points note', () => {
    // #given $2 of fees on $10,000 (2 bps), then $3 on $20,000 (1.5 bps)
    const html = renderToString(createElement(HistoryCharts, { rows: [row('2026-10-05', 10_000, 2), row('2026-10-06', 20_000, 3)], feesSince: '2026-10-05' }));
    // #then
    expect({
      summary: html.includes('aria-label="Take rate, Oct 5, 2026 to Oct 6, 2026: latest 1.5 bps, high 2.0 bps"'),
      note: html.includes('Fees as basis points of value moved.'),
      afterFees: html.indexOf('aria-label="Fees,') < html.indexOf('aria-label="Take rate,'),
    }).toEqual({ summary: true, note: true, afterFees: true });
  });
});

describe('HistoryCharts daily or cumulative switch', () => {
  const rows = [row('2026-10-05', 10_000, 2), row('2026-10-06', 20_000, 3)];

  it('offers a Daily | Cumulative switch with Daily selected, and no checkbox', () => {
    // #when
    const html = renderToString(createElement(HistoryCharts, { rows, feesSince: '2026-10-05' }));
    // #then
    expect({
      group: html.includes('role="radiogroup" aria-label="Chart values"'),
      dailyChecked: /aria-checked="true"[^>]*>Daily</.test(html),
      cumulativeUnchecked: /aria-checked="false"[^>]*>Cumulative</.test(html),
      checkbox: html.includes('type="checkbox"'),
    }).toEqual({ group: true, dailyChecked: true, cumulativeUnchecked: true, checkbox: false });
  });

  it('makes the additive charts cumulative and leaves the take rate daily', () => {
    // #when
    const html = renderToString(createElement(HistoryChartsView, { rows, feesSince: '2026-10-05', cumulative: true, onCumulativeChange: () => {} })).replaceAll('<!-- -->', '');
    // #then
    expect({
      messages: html.includes('Messages (cumulative)'),
      fees: html.includes('Fees (cumulative)'),
      takeRate: html.includes('Take rate (cumulative)'),
      cumulativeChecked: /aria-checked="true"[^>]*>Cumulative</.test(html),
    }).toEqual({ messages: true, fees: true, takeRate: false, cumulativeChecked: true });
  });
});
