import type { ReserveFile } from '@ccip-dev/core/public';
import type { CSSProperties } from 'react';
import { formatCompactCount, formatCount, formatUtcDay } from '../../lib/format';
import { roadTo } from '../../lib/reserve-view';

const MILLION = 1_000_000;
const millions = (link: number) => `${formatCount(link / MILLION)}M`;

/** Each million the Reserve has reached and the ones ahead to 1% of all LINK, with where it stands today. */
export default function Road({ reserve }: { reserve: Pick<ReserveFile, 'latest' | 'pace' | 'transfers'> }) {
  const stops = roadTo(reserve);
  const link = reserve.latest?.link ?? null;
  if (stops.length === 0 || link === null) return null;
  const reached = stops.filter((s) => s.reached);
  const goal = stops.at(-1)!;
  const first = reached[0];
  const last = reached.at(-1);
  // The track runs through each stop's center; today sits between the last million reached and the next.
  const here = Math.max(0, Math.min(1, (reached.length - 0.5 + (link - (last?.link ?? 0)) / MILLION) / stops.length));
  const style = { '--stops': stops.length, '--done': `${(here * 100).toFixed(1)}%` } as CSSProperties;
  return (
    <section className="band" id="road" aria-labelledby="road-title">
      <div className="band-head">
        <p className="eyebrow">The road to {millions(goal.link)}</p>
        <h2 id="road-title">
          {reached.length > 0 ? `${formatCount(reached.length)} million down. ` : 'The first million. '}
          <span className="g">
            {formatCount((goal.link - (last?.link ?? 0)) / MILLION)} to 1% of all LINK.
          </span>
        </h2>
        <p className="lead">
          {first && last && first !== last ? `The first million took ${formatCount(first.days)} days; the latest took ${formatCount(last.days)}. ` : ''}
          {goal.day
            ? `At the last four weeks' pace, about ${formatCompactCount(reserve.pace?.annualized_link)} LINK a year, ${millions(goal.link)} lands around ${formatUtcDay(goal.day)}.`
            : 'The dates ahead appear once the Reserve has a weekly pace.'}
        </p>
      </div>
      <div className="panel road-panel">
        <ol className="road" style={style}>
          {stops.map((s) => (
            <li key={s.link} className={s === goal ? 'goal' : s.reached ? 'reached' : 'ahead'}>
              <span className="road-hex">
                <span>{millions(s.link)}</span>
              </span>
              <span className="road-day">{s.day === null ? '—' : `${s.reached ? '' : '≈ '}${formatUtcDay(s.day)}`}</span>
              <span className="road-sub">{s.reached ? `${formatCount(s.days)} days` : s === goal ? '1% of all LINK' : 'at this pace'}</span>
            </li>
          ))}
          <li className="road-here" style={{ left: `${(here * 100).toFixed(1)}%` }} aria-hidden="true">
            <span>{formatCompactCount(link)} today</span>
            <i />
          </li>
        </ol>
      </div>
    </section>
  );
}
