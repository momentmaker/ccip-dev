import type { StakingFile } from '@ccip-dev/core/public';
import { formatCompactCount, formatCount, formatUtcDay } from '../../lib/format';
import { sharePct, spaceForecast } from '../../lib/staking-view';

const DAYS = 28;
const W = 560;
const H = 110;
const AXIS_DAYS = [0, 7, 14, 21];

const shortDay = (day: string) => formatUtcDay(day).replace(/, \d{4}$/, '');

/** Where the full pool's space is likely to open over the coming weeks, day by day, for anyone waiting to get in. */
export default function SpaceForecast({ staking, now }: { staking: StakingFile; now: Date }) {
  const f = spaceForecast(staking.queue, now, DAYS);
  if (f === null) return null;
  const rate = sharePct(staking.queue.conversion.others.left, staking.queue.conversion.others.total) ?? 0;
  const max = Math.max(1, ...f.days.map((d) => d.likely));
  const step = W / DAYS;
  const bar = step * 0.72;
  return (
    <div className="panel forecast-panel">
      <span className="label">Space forecast · next {DAYS} days</span>
      <p className="forecast-big mono">
        ≈ {formatCompactCount(staking.queue.likely_to_leave)} <small>LINK likely to free up</small>
      </p>
      {f.peak && (
        <p className="forecast-peak">
          Watch <b>{shortDay(f.peak.day)}</b>: {formatCount(f.peak.opening)} LINK of claim windows open, ≈ {formatCompactCount(f.peak.likely)} likely to leave.
        </p>
      )}
      <div className="forecast-chart">
        <svg className="forecast" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`LINK likely to leave by the day its claim window opens, over the next ${DAYS} days`}>
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="forecast-base" />
          {f.days.map((d, i) => {
            const h = d.likely > 0 ? Math.max(3, (d.likely / max) * (H - 6)) : 0;
            return (
              <rect key={d.day} x={i * step + (step - bar) / 2} y={H - h} width={bar} height={h} rx="1.5" className={d === f.peak ? 'fc-bar peak' : 'fc-bar'}>
                <title>{`${shortDay(d.day)}: ${formatCount(d.opening)} LINK of claim windows open, ≈ ${formatCompactCount(d.likely)} likely to leave`}</title>
              </rect>
            );
          })}
        </svg>
        <div className="forecast-axis mono" aria-hidden="true">
          {AXIS_DAYS.map((i) => (
            <span key={i} style={{ left: `${(100 * i) / DAYS}%` }}>
              {i === 0 ? 'Today' : shortDay(f.days[i]!.day)}
            </span>
          ))}
        </div>
      </div>
      <p className="foot">
        Each day's LINK whose claim window opens, outside stake.link, × the {Math.round(rate)}% of windows that have ended in an exit
        {f.openNow > 0 ? `, plus ≈ ${formatCompactCount(f.openNow)} from windows open now` : ''}. A leaver can go any day of a 7-day window, and hunters take the
        space within seconds.
      </p>
    </div>
  );
}
