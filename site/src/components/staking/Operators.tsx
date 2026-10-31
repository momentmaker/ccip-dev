import type { StakingFile } from '@ccip-dev/core/public';
import { formatCompactCount, formatCount, formatUtcDay } from '../../lib/format';
import { etherscanAddress, sharePct, shortHex, VIA_LABEL } from '../../lib/staking-view';

const EVENTS = 12;
const VERB: Record<StakingFile['operator_events'][number]['kind'], string> = {
  added: 'joined the operator pool',
  removed: 'was removed from the operator pool',
  staked: 'staked',
  unstaked: 'unstaked',
  unbonding: 'started unbonding',
};

type Operator = StakingFile['operators'][number];

const opName = (o: { name: string | null; address: string }) => o.name ?? shortHex(o.address);

function Roster({ operators, max }: { operators: Operator[]; max: number }) {
  return (
    <div className="table-wrap">
      <table className="roster">
        <thead>
          <tr><th scope="col">Operator</th><th scope="col">Staked through</th><th scope="col" className="num">Stake</th><th scope="col">Since</th></tr>
        </thead>
        <tbody>
          {operators.map((o) => (
            <tr key={o.address}>
              <td>
                <a href={etherscanAddress(o.address)} className={o.name ? 'op-name' : 'mono'} rel="noopener">{opName(o)}</a>
                {o.name && <span className="mono muted op-addr">{shortHex(o.address)}</span>}
              </td>
              <td><span className={`via via-${o.via}`}>{VIA_LABEL[o.via]}</span></td>
              <td className="num">
                <span className="mono">{formatCount(o.stake)}</span>
                <span className="stake-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (100 * o.stake) / max)}%` }} className={o.stake >= max - 0.01 ? 'max' : undefined} /></span>
              </td>
              <td className="mono muted">{o.since ? formatUtcDay(o.since) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The two pools, how stake.link carries users' LINK into the operator pool, and the operators themselves. */
export default function Operators({ staking }: { staking: StakingFile }) {
  const c = staking.community;
  const o = staking.operator;
  const sl = staking.stakelink;
  const active = staking.operators.filter((x) => x.status === 'active' && x.stake > 0);
  const idle = staking.operators.filter((x) => x.status === 'active' && x.stake <= 0);
  const removed = staking.operators.filter((x) => x.status === 'removed');
  const named = active.filter((x) => x.name !== null).length;
  const slShare = sharePct(sl.operator_link, o.total);
  const events = staking.operator_events.slice(0, EVENTS);
  // An unbonding event carries no amount: it covers the whole stake, which the roster has as it is now.
  const stakeNow = new Map(staking.operators.map((x) => [x.address, x.stake]));
  return (
    <section className="band" id="operators" aria-labelledby="ops-title">
      <div className="band-head">
        <div>
          <p className="eyebrow">Two pools</p>
          <h2 id="ops-title">
            Node operators <span className="t">vs the community</span>.
          </h2>
          <p className="lead">
            Community stakers don't pick an operator. Operators stake in their own allowlisted pool and earn a share of the community's rewards,
            split by their stake. stake.link is how users stake through operators anyway.
          </p>
        </div>
      </div>
      <div className="pools">
        <div className="panel">
          <span className="label">Community · anyone · {formatCount(c.min_stake)} to {formatCount(c.max_stake)} LINK</span>
          <p className="pool-big mono">{formatCompactCount(c.total)} <small>of {formatCompactCount(c.cap)}</small></p>
          <div className="fill" aria-hidden="true"><i style={{ width: `${sharePct(c.total, c.cap) ?? 0}%` }} /></div>
          <p className="foot">{formatCount(c.stakers)} stakers · {formatCount(c.ever)} have ever staked</p>
        </div>
        <div className="panel">
          <span className="label">Node operators · allowlisted · {formatCount(o.min_stake)} to {formatCount(o.max_stake)} LINK</span>
          <p className="pool-big mono">{formatCompactCount(o.total)} <small>of {formatCompactCount(o.cap)}</small></p>
          <div className="fill op" aria-hidden="true"><i style={{ width: `${sharePct(o.total, o.cap) ?? 0}%` }} /></div>
          <p className="foot">{formatCount(o.stakers)} operators staked · {formatCount(o.at_max)} at the max · {formatCount(o.allowlisted)} allowlisted</p>
        </div>
        <div className="panel meta">
          <span className="label">Meta-staking</span>
          <p className="meta-big mono">{slShare === null ? '—' : `${Math.round(slShare)}%`}</p>
          <p className="meta-text">
            of the operator pool is stake.link: {formatCount(sl.operator_vaults)} vaults holding {formatCount(sl.operator_link)} LINK for operators, paid for by its users'
            LINK, plus {formatCount(sl.community_vaults)} community vaults.
          </p>
        </div>
      </div>
      <div className="panel roster-panel">
        <div className="panel-head">
          <span className="label">The roster · {active.length} operators staked</span>
          <span className="muted roster-named">{named} named from public sources</span>
        </div>
        <Roster operators={active} max={o.max_stake} />
        {(idle.length > 0 || removed.length > 0) && (
          <details className="roster-more">
            <summary>
              {idle.length > 0 ? `${idle.length} allowlisted with no stake` : ''}
              {idle.length > 0 && removed.length > 0 ? ' · ' : ''}
              {removed.length > 0 ? `${removed.length} removed` : ''}
            </summary>
            <Roster operators={[...idle, ...removed]} max={o.max_stake} />
          </details>
        )}
      </div>
      <div className="panel">
        <span className="label">Operator watch</span>
        <ol className="op-feed">
          {events.map((e, i) => (
            <li key={`${e.ts}-${e.address}-${i}`}>
              <span className="mono muted">{formatUtcDay(e.ts)}</span>
              <span>
                <b>{opName(e)}</b> {VERB[e.kind]}
                {e.amount !== null && e.kind !== 'removed' ? ` ${formatCount(e.amount)} LINK` : ''}
                {e.kind === 'removed' && e.amount !== null ? ` with ${formatCount(e.amount)} LINK staked` : ''}
                {e.kind === 'unbonding' && (stakeNow.get(e.address) ?? 0) > 0 ? <span className="muted"> · {formatCount(stakeNow.get(e.address)!)} LINK staked now</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
