import type { PegHistoryFile } from '@ccip-dev/core/public';
import { useMemo, useState } from 'react';
import { formatGap, gapChart, nearestPoint, PEG_RANGES, rangeRows, utcStamp, type PegRange } from '../../lib/peg-view';

const W = 720;
const H = 260;
const PAD = { top: 14, right: 12, bottom: 22, left: 56 };

export default function PegChart({ history, now }: { history: PegHistoryFile; now: Date }) {
  const [range, setRange] = useState<PegRange>('30D');
  const [hover, setHover] = useState<number | null>(null);
  const chart = useMemo(
    () => gapChart(rangeRows(history, range, now), { width: W, height: H, pad: PAD, thresholds: history.thresholds, episodes: history.episodes, markers: history.markers }),
    [history, range, now],
  );
  const point = chart && hover !== null ? chart.points[hover] : null;
  return (
    <div className="panel peg-chart">
      <div className="panel-head">
        <span className="eyebrow">Gap to 1:1</span>
        <div className="peg-ranges" role="group" aria-label="Range">
          {PEG_RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={r === range} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {chart === null ? (
        <p className="foot">No prices in this range yet.</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`stLINK's gap to 1 LINK over ${range}`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHover(nearestPoint(chart, ((e.clientX - box.left) / box.width) * W));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {chart.spans.map((s, i) => (
            <rect key={i} x={s.x0} y={PAD.top} width={Math.max(1, s.x1 - s.x0)} height={H - PAD.top - PAD.bottom} className={`peg-span ${s.side}`} />
          ))}
          {chart.bands.map((b) => (
            <line key={b.line} x1={PAD.left} x2={W - PAD.right} y1={b.y} y2={b.y} className={Math.abs(b.line) === history.thresholds.public ? 'peg-band public' : 'peg-band'} />
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={chart.zeroY} y2={chart.zeroY} className="peg-zero" />
          {chart.ticks.map((t) => (
            <text key={t.label} x={PAD.left - 8} y={t.y + 4} className="peg-tick">
              {t.label}
            </text>
          ))}
          <path d={chart.path} className="peg-line" />
          {chart.pins.map((p, i) => (
            <g key={i} className="peg-pin">
              <line x1={p.x} x2={p.x} y1={PAD.top} y2={H - PAD.bottom} />
              <circle cx={p.x} cy={PAD.top + 4} r={4}>
                <title>{p.label}</title>
              </circle>
            </g>
          ))}
          {point && <circle cx={point.x} cy={point.y} r={4} className="peg-dot" />}
        </svg>
      )}
      <p className="foot peg-readout" aria-live="polite">
        {point
          ? `${utcStamp(point.row[0])} · close ${formatGap(point.row[4] - 1)} · low ${formatGap(point.row[3] - 1)} · high ${formatGap(point.row[2] - 1)}`
          : `Shaded: episodes past ${formatGap(history.thresholds.private).replace('+', '±')}. Pins: stake.link vault activity.`}
      </p>
    </div>
  );
}
