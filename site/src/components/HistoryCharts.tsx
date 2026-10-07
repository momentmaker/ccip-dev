import type { DayTotals } from '@ccip-dev/core/public';
import { useMemo, useState } from 'react';
import { ADDITIVE, CHART_H, CHART_W, chartGeometry, chartSeries, nearestIndex, pointX, type HistoryMetric } from '../lib/charts';
import { formatCount, formatDuration, formatUsd, formatUtcDay } from '../lib/format';
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
  const shownRow = shown ? rows.find((r) => r.day === shown.day) : undefined;
  const linkShare = spec.key === 'fee_usd' && shownRow?.fee_usd && shownRow.fee_link_usd !== null ? Math.round((shownRow.fee_link_usd / shownRow.fee_usd) * 100) : null;
  return (
    <figure className="card chart">
      <figcaption>
        <span className="label">
          {spec.title}
          {cumulative ? ' (cumulative)' : ''}
          <InfoLink metric={spec.metric} label={spec.title.toLowerCase()} />
        </span>
        <span className="chart-value mono">{spec.format(shown?.value ?? null)}</span>
        <span className="muted small">
          {shown ? formatUtcDay(shown.day) : ''}
          {linkShare !== null ? ` · ${linkShare}% paid in LINK` : ''}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${spec.title} per day`}
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
      {spec.key === 'fee_usd' && <p className="muted small">Fees are collected from 2026-10-05 onward.</p>}
    </figure>
  );
}

export default function HistoryCharts({ rows }: { rows: DayTotals[] }) {
  const [cumulative, setCumulative] = useState(false);
  return (
    <div>
      <label className="toggle">
        <input type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} /> Cumulative
      </label>
      <div className="charts">
        {METRICS.map((spec) => (
          <Chart key={spec.key} rows={rows} spec={spec} cumulative={cumulative && ADDITIVE.has(spec.key)} />
        ))}
      </div>
    </div>
  );
}
