import type { CSSProperties } from 'react';
import type { ReserveFile } from '@ccip-dev/core/public';
import { formatCount, formatLink, formatUtcDay } from '../../lib/format';

/** Every week since the first deposit as a gold hex, brighter for a bigger deposit and dark for a week it missed. */
export default function Streak({ weekly, streak }: { weekly: ReserveFile['weekly']; streak: number }) {
  if (weekly.length === 0) return null;
  const max = Math.max(1, ...weekly.map((w) => w.link));
  const missed = weekly.filter((w) => w.deposits === 0).length;
  return (
    <section className="band" id="streak" aria-labelledby="streak-title">
      <div className="band-head">
        <p className="eyebrow">The streak</p>
        <h2 id="streak-title">
          {formatCount(streak)} weeks in a row{missed === 0 ? <span className="g">, never missed</span> : ''}.
        </h2>
        <p className="lead">
          One hex a week since {formatUtcDay(weekly[0]!.week)}, brighter for a bigger deposit{missed > 0 ? `; ${formatCount(missed)} weeks had none` : ''}.
        </p>
      </div>
      <div className="panel">
        <div className="streak" style={{ '--weeks': weekly.length } as CSSProperties} role="img" aria-label={`${formatCount(weekly.length)} weeks, ${formatCount(weekly.length - missed)} with a deposit`}>
          {weekly.map((w, i) => (
            <i
              key={w.week}
              className={w.deposits === 0 ? 'miss' : i === weekly.length - 1 ? 'last' : undefined}
              style={{ '--a': (0.3 + 0.7 * (w.link / max)).toFixed(2) } as CSSProperties}
              title={`Week of ${formatUtcDay(w.week)}: ${w.deposits === 0 ? 'no deposit' : formatLink(w.link)}`}
            />
          ))}
        </div>
        <div className="streak-ends" aria-hidden="true">
          <span>{formatUtcDay(weekly[0]!.week)}</span>
          <span>this week</span>
        </div>
      </div>
    </section>
  );
}
