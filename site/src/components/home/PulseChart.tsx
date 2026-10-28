import { useEffect, useRef, useState } from 'react';
import { dayFraction, pacedTotal, type CountedDay } from '../../lib/all-time';
import { formatCompactCount, formatCount, formatUsd, formatUtcDay } from '../../lib/format';
import { PULSE_METRICS, pulseGeometry, pulseIndex, pulseValue, type PulseMetric } from '../../lib/pulse';
import Segmented from '../controls/Segmented';
import { useNow } from '../hooks';

const FALLBACK_W = 760;
const FRAME = { left: 44, right: 10, top: 22, bottom: 26 };
const NARROW = 560;

const valueText = (metric: PulseMetric, v: number | null) => (v === null ? '—' : metric === 'messages' ? formatCount(v) : formatUsd(v));
const axisText = (metric: PulseMetric, v: number) => (metric === 'messages' ? formatCompactCount(v) : formatUsd(v)).replace('.0', '');
const shortDay = (day: string) => formatUtcDay(day).replace(/, \d{4}$/, '');

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const hexPoints = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');

/** Ninety finalized days, with today's live point after them and a dashed line to where today is heading. */
export default function PulseChart({ days, today }: { days: readonly CountedDay[]; today: CountedDay }) {
  const [metric, setMetric] = useState<PulseMetric>('messages');
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, width] = useWidth(FALLBACK_W);
  const now = useNow(60_000);
  const height = width < NARROW ? 220 : 260;
  const todayValue = pulseValue(today, metric);
  const paced = now && todayValue !== null ? pacedTotal(todayValue, dayFraction(today.day, now.getTime())) : null;
  const g = pulseGeometry(days, metric, { value: todayValue, paced }, { width, height, ...FRAME });
  const n = days.length;
  const labelDays = width < NARROW ? [0, Math.floor(n / 2)] : [0, Math.floor(n / 3), Math.floor((2 * n) / 3)];
  const hoverValue = hover === null ? null : hover === n ? todayValue : pulseValue(days[hover]!, metric);
  const hoverY = hover === null ? null : hover === n ? g.today?.y ?? null : g.ys[hover] ?? null;
  const highRight = g.high !== null && g.high.x > width * 0.6;
  const label = PULSE_METRICS.find((m) => m.key === metric)!.label.toLowerCase();
  const summary =
    g.high === null
      ? `No ${label} in the last ${n} days.`
      : `Daily ${label} over the last ${n} days: the high was ${valueText(metric, g.high.value)} on ${formatUtcDay(days[g.high.index]!.day)}; today so far ${valueText(metric, todayValue)}.`;

  return (
    <div className="pulse">
      <div className="panel-head">
        <span className="label">The pulse · last {n} days</span>
        <Segmented label="Chart metric" options={PULSE_METRICS.map((m) => ({ value: m.key, label: m.label }))} value={metric} onChange={setMetric} />
      </div>
      <div className="pulse-plot" ref={wrapRef}>
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary}>
          <defs>
            <linearGradient id="pulse-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4a7ff0" stopOpacity="0.42" />
              <stop offset="1" stopColor="#4a7ff0" stopOpacity="0" />
            </linearGradient>
          </defs>
          {g.ticks.map((t) => (
            <g key={t.value}>
              <line className="pulse-grid" x1={FRAME.left} x2={width - FRAME.right} y1={t.y} y2={t.y} />
              <text className="pulse-axis" x={FRAME.left - 8} y={t.y + 4} textAnchor="end">
                {axisText(metric, t.value)}
              </text>
            </g>
          ))}
          <path d={g.area} fill="url(#pulse-area)" />
          <path d={g.line} className="pulse-line" />
          {g.high && (
            <g className="pulse-high">
              <line x1={g.high.x} x2={g.high.x} y1={g.high.y - 8} y2={g.high.y} />
              <polygon points={hexPoints(g.high.x, g.high.y - 14, 6.5)} />
              <text x={highRight ? g.high.x - 12 : g.high.x + 12} y={g.high.y - 10} textAnchor={highRight ? 'end' : 'start'}>
                {n}-day high · {valueText(metric, g.high.value)}
              </text>
            </g>
          )}
          {g.today && (
            <g className="pulse-today">
              {g.today.paced && (
                <>
                  <line className="pulse-pace" x1={g.xs[n - 1]} y1={g.ys[n - 1] ?? g.today.y} x2={g.today.x} y2={g.today.paced.y} />
                  <circle className="pulse-pace-dot" cx={g.today.x} cy={g.today.paced.y} r="4.5" />
                  <text className="pulse-pace-text" x={g.today.x} y={Math.max(FRAME.top + 4, g.today.paced.y - 12)} textAnchor="end">
                    on pace ~{valueText(metric, g.today.paced.value)}
                  </text>
                </>
              )}
              <line className="pulse-stem" x1={g.today.x} x2={g.today.x} y1={g.today.y} y2={height - FRAME.bottom} />
              <circle className="pulse-dot" cx={g.today.x} cy={g.today.y} r="5" />
            </g>
          )}
          {labelDays.map((i) =>
            days[i] ? (
              <text key={i} className="pulse-axis" x={g.xs[i]} y={height - 8}>
                {shortDay(days[i]!.day)}
              </text>
            ) : null,
          )}
          <text className="pulse-axis pulse-axis-today" x={width - FRAME.right} y={height - 8} textAnchor="end">
            today
          </text>
          {hover !== null && hoverY !== null && <line className="pulse-cross" x1={g.xs[hover]} x2={g.xs[hover]} y1={FRAME.top} y2={height - FRAME.bottom} />}
          <rect
            className="pulse-hit"
            x={FRAME.left}
            y={FRAME.top}
            width={Math.max(0, width - FRAME.left - FRAME.right)}
            height={Math.max(0, height - FRAME.top - FRAME.bottom)}
            onPointerMove={(e) => {
              const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
              setHover(pulseIndex(((e.clientX - box.left) / box.width) * width, g.xs));
            }}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && hoverY !== null && (
          <div className="pulse-tip" style={{ left: g.xs[hover], top: hoverY - 10 }}>
            <strong className="mono">{valueText(metric, hoverValue)}</strong>
            <span className="muted">{hover === n ? 'Today so far' : formatUtcDay(days[hover]!.day)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
