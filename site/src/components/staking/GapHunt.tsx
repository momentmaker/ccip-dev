import type { StakingFile } from '@ccip-dev/core/public';
import { formatCount, formatDuration, formatUtcDay, formatUtcTime } from '../../lib/format';
import { shortHex, stakerHref } from '../../lib/staking-view';

const RECENT = 10;

/** How fast opened space in the full pool is taken, and who takes it. */
export default function GapHunt({ staking }: { staking: StakingFile }) {
  const r = staking.refills;
  const recent = [...r.recent].reverse().slice(0, RECENT);
  return (
    <section className="band" aria-labelledby="hunt-title">
      <div className="band-head">
        <div>
          <p className="eyebrow">The gap hunt</p>
          <h2 id="hunt-title">
            Space lasts <span className="t">{formatDuration(r.median_s)}</span>.
          </h2>
          <p className="lead">
            The community pool has been full since {staking.community.full_since ? formatUtcDay(staking.community.full_since) : '—'}. Every time
            someone leaves, hunters race to take the space: half the gaps close within {formatDuration(r.median_s)}, and 90% within {formatDuration(r.p90_s)}.
          </p>
        </div>
      </div>
      <ul className="hunt-stats">
        <li><b className="mono">{formatCount(r.openings)}</b><span>openings since full</span></li>
        <li><b className="mono">{formatCount(r.same_block)}</b><span>refilled in the same block</span></li>
        <li><b className="mono">{formatCount(r.next_block)}</b><span>in the very next block</span></li>
        <li><b className="mono">{formatCount(r.hunters)}</b><span>hunters have scored</span></li>
      </ul>
      <div className="hunt-grid">
        <div className="panel">
          <span className="label">Top hunters · all time</span>
          <div className="table-wrap">
            <table className="hunt-table">
              <thead>
                <tr><th scope="col">#</th><th scope="col">Hunter</th><th scope="col" className="num">Grabs</th><th scope="col" className="num">LINK taken</th><th scope="col" className="num">Fastest</th></tr>
              </thead>
              <tbody>
                {r.leaders.map((l, i) => (
                  <tr key={l.address} className={i === 0 ? 'champ' : undefined}>
                    <td className="mono">{i + 1}</td>
                    <td><a className="mono" href={stakerHref(l.address)}>{shortHex(l.address)}</a></td>
                    <td className="num mono">{formatCount(l.grabs)}</td>
                    <td className="num mono">{formatCount(l.link)}</td>
                    <td className="num mono">{formatDuration(l.fastest_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <span className="label">Openings this week</span>
          {recent.length === 0 ? (
            <p className="muted">No space opened in the last 7 days.</p>
          ) : (
            <ol className="hunt-feed">
              {recent.map((o) => (
                <li key={o.opened_at}>
                  <span className="mono when">{formatUtcDay(o.opened_at).replace(/, \d{4}$/, '')} {formatUtcTime(o.opened_at).replace(' UTC', '')}</span>
                  <span className="mono gap">{formatCount(o.gap)} LINK</span>
                  <span className={`mono took${o.seconds !== null && o.seconds <= 12 ? ' fast' : ''}`}>{o.seconds === null ? 'still open' : formatDuration(o.seconds)}</span>
                  <span className="who">
                    {o.grabs.slice(0, 2).map((g) => (
                      <a key={g} className="mono" href={stakerHref(g)}>{shortHex(g)}</a>
                    ))}
                    {o.grabs.length > 2 ? <span className="muted"> +{o.grabs.length - 2}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="foot">Times are block times: 12s is the very next block, 0s the same block.</p>
        </div>
      </div>
    </section>
  );
}
