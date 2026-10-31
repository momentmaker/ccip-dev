import type { StakingFile } from '@ccip-dev/core/public';
import { formatCount } from '../../lib/format';
import { HOLDER_LABEL, sharePct } from '../../lib/staking-view';

const bucketLabel = (min: number, max: number | null, cap: number) =>
  max === null ? `${formatCount(cap)} (the max)` : min === 0 ? `under ${formatCount(max)}` : `${formatCount(min)} to ${formatCount(max)}`;

/** Who stakes: how long they've held, how much, and through what. */
export default function Stakers({ staking }: { staking: StakingFile }) {
  const c = staking.community;
  const t = staking.tenure;
  const firstPct = sharePct(t.first_month, c.stakers);
  const maxYear = Math.max(1, ...t.by_year.map((y) => y.stakers));
  const maxSize = Math.max(1, ...staking.sizes.map((s) => s.link));
  const totalHeld = staking.holders.reduce((a, h) => a + h.link, 0);
  return (
    <section className="band" aria-labelledby="stakers-title">
      <div className="band-head">
        <div>
          <p className="eyebrow">The stakers</p>
          <h2 id="stakers-title">
            Diamond hands, <span className="t">measured</span>.
          </h2>
        </div>
      </div>
      <div className="stakers-grid">
        <div className="panel">
          <span className="label">In since the first month</span>
          <p className="tenure-big">
            <span className="mono">{firstPct === null ? '—' : `${Math.round(firstPct)}%`}</span>
            <small> of today's {formatCount(c.stakers)} stakers</small>
          </p>
          <ul className="ribbons">
            {t.by_year.map((y) => (
              <li key={y.year}>
                <span className="mono">{y.year}</span>
                <span className="ribbon" style={{ width: `${(100 * y.stakers) / maxYear}%` }} />
                <span className="mono muted">{formatCount(y.stakers)}</span>
              </li>
            ))}
          </ul>
          <p className="foot">By the year each staker first staked. The median staker has been in {formatCount(t.median_days)} days.</p>
        </div>
        <div className="panel">
          <span className="label">Stake size · community pool</span>
          <ul className="bars">
            {staking.sizes.map((s) => (
              <li key={s.min}>
                <span>{bucketLabel(s.min, s.max, c.max_stake)}</span>
                <span className="bar"><i style={{ width: `${(100 * s.link) / maxSize}%` }} className={s.max === null ? 'max' : undefined} /></span>
                <span className="mono">{formatCount(s.stakers)}</span>
              </li>
            ))}
          </ul>
          <p className="foot">Stakers per size, bars by LINK. {formatCount(c.at_max)} sit at the {formatCount(c.max_stake)} LINK max; the median stake is {formatCount(c.median)} LINK.</p>
        </div>
        <div className="panel">
          <span className="label">Who holds the pool</span>
          <ul className="bars">
            {staking.holders.map((h) => (
              <li key={h.kind}>
                <span>{HOLDER_LABEL[h.kind]}</span>
                <span className="bar"><i className={`hold-${h.kind}`} style={{ width: `${sharePct(h.link, totalHeld) ?? 0}%` }} /></span>
                <span className="mono">{formatCount(h.stakers)}</span>
              </li>
            ))}
          </ul>
          <p className="foot">
            Stakers per holder, bars by LINK. stake.link's {formatCount(staking.stakelink.community_vaults)} vaults hold {formatCount(staking.stakelink.community_link)} LINK
            for the users of its liquid staking token.
          </p>
        </div>
      </div>
    </section>
  );
}
