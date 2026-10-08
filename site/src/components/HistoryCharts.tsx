import type { DayTotals } from '@ccip-dev/core/public';
import { useId, useMemo, useState } from 'react';
import { ADDITIVE, CHART_H, CHART_W, chartGeometry, chartSeries, chartSummary, linkShare, nearestIndex, pointX, stepIndex, type HistoryMetric } from '../lib/charts';
import { formatCount, formatDuration, formatUsd, formatUtcDay, linkShareText } from '../lib/format';
import { FEES_SINCE } from '../lib/records';
import type { MetricKey } from '../lib/metric-anchors';
import InfoLink from './InfoLink';

interface MetricSpec {
  key: HistoryMetric;
  title: string;
  format: (v: number | null) => string;
  metric: MetricKey;
}

const METRICS: MetricSpec[] = [
  { key: 'messages', title: 'Messages', format: formatCount, metric: 'messages' },
  { key: 'usd_value', title: 'Value transferred', format: formatUsd, metric: 'value' },
  { key: 'fee_usd', title: 'Fees', format: formatUsd, metric: 'fees' },
  { key: 'unique_senders', title: 'Unique senders', format: formatCount, metric: 'senders' },
  { key: 'median_delivery_s', title: 'Median delivery time', format: formatDuration, metric: 'delivery' },
];

function Chart({ rows, spec, cumulative }: { rows: DayTotals[]; spec: MetricSpec; cumulative: boolean }) {
  const points = useMemo(() => chartSeries(rows, spec.key, cumulative), [rows, spec.key, cumulative]);
  const geo = useMemo(() => chartGeometry(points, CHART_W, CHART_H), [points]);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover !== null ? points[hover] ?? null : geo.last;
  const share = spec.key === 'fee_usd' && shown ? linkShare(rows, shown.day, cumulative) : null;
  return (
    <figure className="card chart">
      <figcaption>
        <span className="label">
          {spec.title}
          {cumulative ? ' (cumulative)' : ''}
          <InfoLink metric={spec.metric} label={spec.title.toLowerCase()} />
        </span>
        <span aria-live="polite">
          <span className="chart-value mono">{spec.format(shown?.value ?? null)}</span>{' '}
          <span className="muted small">
            {shown ? formatUtcDay(shown.day) : ''}
            {share !== null ? ` · ${linkShareText(share)}` : ''}
          </span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        tabIndex={0}
        aria-label={chartSummary(spec.title, points, spec.format, cumulative)}
        onKeyDown={(e) => {
          const next = stepIndex(hover, e.key, points.length);
          if (next === hover) return;
          e.preventDefault();
          setHover(next);
        }}
        onBlur={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setHover(nearestIndex(((e.clientX - box.left) / box.width) * CHART_W, CHART_W, points.length));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <path d={geo.area} className="chart-area" />
        <path d={geo.line} className="chart-line" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line className="chart-cursor" x1={pointX(hover, points.length, CHART_W)} x2={pointX(hover, points.length, CHART_W)} y1={0} y2={CHART_H} />
        )}
      </svg>
      {spec.key === 'fee_usd' && <p className="muted small">Fees are collected from {FEES_SINCE} onward.</p>}
    </figure>
  );
}

export default function HistoryCharts({ rows }: { rows: DayTotals[] }) {
  const [cumulative, setCumulative] = useState(false);
  const cumulativeId = useId();
  return (
    <div>
      <label className="toggle">
        <input id={cumulativeId} name="cumulative" type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} /> Cumulative
      </label>
      <div className="charts">
        {METRICS.map((spec) => (
          <Chart key={spec.key} rows={rows} spec={spec} cumulative={cumulative && ADDITIVE.has(spec.key)} />
        ))}
      </div>
    </div>
  );
}
