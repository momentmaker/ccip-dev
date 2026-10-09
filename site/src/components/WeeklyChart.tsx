import { useMemo, useState, type ReactNode } from 'react';
import { CHART_H, CHART_W, nearestIndex, pointX, stepIndex } from '../lib/charts';
import { formatUtcDay } from '../lib/format';
import { weeklyPaths, weeklySummary, type WeeklySeries } from '../lib/weekly-chart';

export interface ChartSeries extends WeeklySeries {
  className: string;
}

export default function WeeklyChart(props: {
  title: string;
  weeks: readonly string[];
  series: readonly ChartSeries[];
  stacked: boolean;
  format: (v: number | null) => string;
  children?: ReactNode;
}) {
  const { title, weeks, series, stacked, format } = props;
  const paths = useMemo(() => weeklyPaths(series, stacked), [series, stacked]);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? weeks.length - 1;
  return (
    <figure className="card chart">
      <figcaption>
        <span className="label">{title}</span>
        <span className="muted small" aria-live="polite">
          {weeks[shown] ? `Week of ${formatUtcDay(weeks[shown]!)}` : ''}
        </span>
      </figcaption>
      {weeks.length === 0 ? (
        <p className="muted">No complete weeks with this data yet.</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            role="img"
            tabIndex={0}
            aria-label={weeklySummary(title, weeks, series, format)}
            onKeyDown={(e) => {
              const next = stepIndex(hover, e.key, weeks.length);
              if (next === hover) return;
              e.preventDefault();
              setHover(next);
            }}
            onBlur={() => setHover(null)}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setHover(nearestIndex(((e.clientX - box.left) / box.width) * CHART_W, CHART_W, weeks.length));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {paths.map((p, i) => (
              <path
                key={p.key}
                d={p.d}
                className={`${series[i]!.className} ${stacked ? 'weekly-area' : 'weekly-line'}`}
                vectorEffect={stacked ? undefined : 'non-scaling-stroke'}
              />
            ))}
            {hover !== null && (
              <line className="chart-cursor" x1={pointX(hover, weeks.length, CHART_W)} x2={pointX(hover, weeks.length, CHART_W)} y1={0} y2={CHART_H} />
            )}
          </svg>
          <ul className="legend">
            {series.map((s) => (
              <li key={s.key}>
                <span className={`swatch ${s.className}`} aria-hidden="true" />
                {s.label} <span className="mono">{format(s.values[shown] ?? null)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {props.children}
      {weeks.length > 0 && (
        <details className="chart-table">
          <summary>Data table</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Week of</th>
                  {series.map((s) => (
                    <th key={s.key} className="num">{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={w}>
                    <td className="mono">{formatUtcDay(w)}</td>
                    {series.map((s) => (
                      <td key={s.key} className="num">{format(s.values[i] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
