import type { StakingFile } from '@ccip-dev/core/public';
import { formatCompactCount, formatUtcDay } from '../../lib/format';
import { tapeAsked, tapeGrid, tapeMax } from '../../lib/staking-view';

const W = 1200;
const H = 260;
const TOP = 10;
/** The zero line sits low: LINK in and the trace rise above it, and LINK out, which mirrors LINK in, needs little room below. */
const MID = 190;

/** Weekly LINK in and out of the community pool: staked above the line, unstaked below, and the LINK that asked to leave as a trace. */
export default function Tape({ weeks }: { weeks: StakingFile['weeks'] }) {
  if (weeks.length === 0) return null;
  const max = tapeMax(weeks);
  const grid = tapeGrid(max);
  const step = W / weeks.length;
  const bar = Math.max(1, step * 0.7);
  const up = (v: number) => (MID - TOP) * Math.min(1, v / max);
  // The same scale both ways, so a week out mirrors a week in; the rare week that runs past the bottom gets a cap.
  const below = H - MID - 4;
  const down = (v: number) => Math.min(below, up(v));
  const trace = weeks.map((w, i) => `${i === 0 ? 'M' : 'L'}${(i * step + step / 2).toFixed(1)} ${(MID - up(tapeAsked(w))).toFixed(1)}`).join(' ');
  const years: { i: number; year: string }[] = [];
  weeks.forEach((w, i) => {
    const year = w.week.slice(0, 4);
    if (i > 0 && year === weeks[i - 1]!.week.slice(0, 4)) return;
    // A year that starts within a few weeks of the last label takes its place.
    if (years.length > 0 && (i - years.at(-1)!.i) * step < 60) years.pop();
    years.push({ i, year });
  });
  const biggest = weeks.reduce((a, b) => (b.unstaked > a.unstaked ? b : a));
  const gridY = MID - up(grid);
  return (
    <section className="band" id="tape" aria-labelledby="tape-title">
      <div className="band-head">
        <div>
          <p className="eyebrow">The tape · weekly since {formatUtcDay(weeks[0]!.week)}</p>
          <h2 id="tape-title">
            In, out, <span className="t">and back in</span>.
          </h2>
          <p className="lead">
            Far more LINK asks to leave than leaves, and what leaves is restaked by someone else within minutes, so the weeks mirror each other. The biggest week out was{' '}
            {formatUtcDay(biggest.week)}: {formatCompactCount(biggest.unstaked)} LINK.
          </p>
        </div>
      </div>
      <div className="panel">
        <ul className="tape-key">
          <li><i className="key key-in" />Staked</li>
          <li><i className="key key-out" />Unstaked</li>
          <li><i className="key key-trace" />Started unbonding, outside stake.link</li>
        </ul>
        <div className="tape-wrap">
          <svg className="tape" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Weekly LINK staked and unstaked over ${weeks.length} weeks`}>
            <line x1="0" x2={W} y1={gridY} y2={gridY} className="tape-grid" />
            <line x1="0" x2={W} y1={MID} y2={MID} className="tape-axis" />
            {weeks.map((w, i) => (
              <g key={w.week}>
                <rect x={i * step + (step - bar) / 2} y={MID - up(w.staked)} width={bar} height={up(w.staked)} className="tape-in" />
                {w.staked > max && <rect x={i * step + (step - bar) / 2} y={TOP - 2} width={bar} height={3} className="tape-clip" />}
                <rect x={i * step + (step - bar) / 2} y={MID} width={bar} height={down(w.unstaked)} className="tape-out" />
                {up(w.unstaked) > below && <rect x={i * step + (step - bar) / 2} y={H - 4} width={bar} height={3} className="tape-clip" />}
              </g>
            ))}
            <path d={trace} className="tape-trace" />
          </svg>
          <span className="tape-grid-label mono" style={{ top: gridY }}>
            {formatCompactCount(grid)} LINK a week
          </span>
          <div className="tape-years" aria-hidden="true">
            {years.map((y) => (
              <span key={y.year} className="mono" style={{ left: `${(100 * y.i * step) / W}%` }}>
                {y.year}
              </span>
            ))}
          </div>
        </div>
        <p className="foot">
          Bars with a gold cap run off the chart: the launch weeks staked {formatCompactCount(Math.max(...weeks.map((w) => w.staked)))} LINK in the biggest
          of them.
        </p>
      </div>
    </section>
  );
}
