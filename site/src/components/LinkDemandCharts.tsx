import { useMemo, useState } from 'react';
import { formatUsd, formatUtcDay } from '../lib/format';
import { FEE_MIX_SERIES, MIX_RANGES, weeksInRange, type BesideWeek, type MixRange, type MixWeek } from '../lib/fee-mix';
import Segmented from './controls/Segmented';
import WeeklyChart, { type ChartSeries } from './WeeklyChart';

const RANGE_LABEL: Record<MixRange, string> = { '90d': '90d', '1y': '1y', all: 'All' };
export const DEPOSITS_CAPTION = 'Shown side by side. The Reserve does not publish which revenue each deposit came from.';

export default function LinkDemandCharts({ mix, beside, mixFrom }: { mix: MixWeek[]; beside: BesideWeek[]; mixFrom: string | null }) {
  const [range, setRange] = useState<MixRange>('1y');
  const mixShown = useMemo(() => weeksInRange(mix, range), [mix, range]);
  const besideShown = useMemo(() => weeksInRange(beside, range), [beside, range]);
  const mixSeries = useMemo<ChartSeries[]>(() => FEE_MIX_SERIES.map((s) => ({ ...s, values: mixShown.map((w) => w[s.key]) })), [mixShown]);
  const feesSeries = useMemo<ChartSeries[]>(
    () => [{ key: 'fees', label: 'CCIP fees', className: 'series-fees', values: besideShown.map((w) => w.fees_usd) }],
    [besideShown],
  );
  const depositsSeries = useMemo<ChartSeries[]>(
    () => [{ key: 'deposits', label: 'Reserve deposits', className: 'series-deposits', values: besideShown.map((w) => w.deposits_usd) }],
    [besideShown],
  );
  return (
    <div className="link-demand-charts">
      <Segmented label="Range" options={MIX_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} value={range} onChange={setRange} />
      <div className="charts">
        <WeeklyChart title="Weekly fee mix (USD)" weeks={mixShown.map((w) => w.week)} series={mixSeries} stacked format={formatUsd}>
          {mixFrom && <p className="muted small">Fee mix from the week of {formatUtcDay(mixFrom)} onward.</p>}
        </WeeklyChart>
        <WeeklyChart title="Weekly CCIP fees (USD)" weeks={besideShown.map((w) => w.week)} series={feesSeries} stacked={false} format={formatUsd} />
        <WeeklyChart title="Weekly Reserve deposits (USD)" weeks={besideShown.map((w) => w.week)} series={depositsSeries} stacked={false} format={formatUsd} />
      </div>
      <p className="muted small">{DEPOSITS_CAPTION}</p>
    </div>
  );
}
