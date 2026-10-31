import type { StakingFile } from '@ccip-dev/core/public';
import { formatCompactCount, formatUtcDay } from '../../lib/format';

const W = 1200;
const H = 270;
const MID = 140;

/** Weekly LINK in and out of the community pool: staked above the line, unstaked below, and the LINK that asked to leave as a trace. */
export default function Tape({ weeks }: { weeks: StakingFile['weeks'] }) {
  if (weeks.length === 0) return null;
  // The launch weeks moved the whole pool; scale to the busiest ordinary week and clip the launch bars at the top.
  const others = (w: StakingFile['weeks'][number]) => w.unbonding_link - w.stakelink_unbonding_link;
  const values = weeks.flatMap((w) => [w.staked, w.unstaked, others(w)]).sort((a, b) => a - b);
  const max = Math.max(1, (values[Math.floor(values.length * 0.97)] ?? 1) * 1.15);
  const step = W / weeks.length;
  const bar = Math.max(1, step * 0.7);
  const up = (v: number) => (MID - 14) * Math.min(1, v / max);
  // The same scale both ways, so a week out mirrors a week in; out bars stop above the year labels.
  const down = (v: number) => Math.min(H - MID - 24, up(v));
  const trace = weeks.map((w, i) => `${i === 0 ? 'M' : 'L'}${(i * step + step / 2).toFixed(1)} ${(MID - up(others(w))).toFixed(1)}`).join(' ');
  const years: { i: number; year: string }[] = [];
  weeks.forEach((w, i) => {
    const year = w.week.slice(0, 4);
    if (i > 0 && year === weeks[i - 1]!.week.slice(0, 4)) return;
    // A year that starts within a few weeks of the last label takes its place.
    if (years.length > 0 && (i - years.at(-1)!.i) * step < 60) years.pop();
    years.push({ i, year });
  });
  const biggest = weeks.reduce((a, b) => (b.unstaked > a.unstaked ? b : a));
  return (
    <section className="band" aria-labelledby="tape-title">
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
        <svg className="tape" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Weekly LINK staked and unstaked over ${weeks.length} weeks`}>
          <line x1="0" x2={W} y1={MID} y2={MID} className="tape-axis" />
          {weeks.map((w, i) => (
            <g key={w.week}>
              <rect x={i * step + (step - bar) / 2} y={MID - up(w.staked)} width={bar} height={up(w.staked)} className="tape-in" />
              {w.staked > max && <rect x={i * step + (step - bar) / 2} y={8} width={bar} height={3} className="tape-clip" />}
              <rect x={i * step + (step - bar) / 2} y={MID} width={bar} height={down(w.unstaked)} className="tape-out" />
            </g>
          ))}
          <path d={trace} className="tape-trace" />
          {years.map((y) => (
            <text key={y.year} x={y.i * step + 4} y={H - 4} className="tape-year">{y.year}</text>
          ))}
        </svg>
        <p className="foot">
          Bars with a gold cap ran off the chart: the launch weeks staked {formatCompactCount(Math.max(...weeks.map((w) => w.staked)))} LINK in the biggest
          of them.
        </p>
      </div>
    </section>
  );
}
