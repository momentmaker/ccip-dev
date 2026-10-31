import { stakerShard } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { fetchPublic } from '../../lib/data';
import { formatCount, formatUtcDay } from '../../lib/format';
import { addressFromPath, findStaker, sizeText, stakerFacts, stakerTitle, topShare, type StakerFacts } from '../../lib/staker';
import { etherscanAddress, VIA_LABEL } from '../../lib/staking-view';
import ShareButton from '../ShareButton';
import StakerLookup from './StakerLookup';

type State = { kind: 'lookup' } | { kind: 'loading'; address: string } | { kind: 'missing'; address: string } | { kind: 'failed'; address: string } | { kind: 'found'; facts: StakerFacts };

function StatusLine({ f }: { f: StakerFacts }) {
  const s = f.status;
  switch (s.kind) {
    case 'staked':
      return <p className="sc-status ok">Staked · not unbonding</p>;
    case 'unbonding':
      return <p className="sc-status warn">Unbonding · claim window opens {formatUtcDay(s.opensAt)}, in {formatCount(s.days)} day{s.days === 1 ? '' : 's'}</p>;
    case 'claimable':
      return <p className="sc-status hot">Claim window open · closes {formatUtcDay(s.closesAt)}, in {formatCount(s.days)} day{s.days === 1 ? '' : 's'}</p>;
    case 'lapsed':
      return <p className="sc-status ok">Stayed · its claim window closed {formatUtcDay(s.closedAt)} and the LINK is still staked</p>;
  }
}

function Card({ f }: { f: StakerFacts }) {
  const top = topShare(f);
  const headline = `${stakerTitle(f.address)}: ${formatCount(f.stake)} LINK staked in Chainlink staking for ${formatCount(f.days)} days`;
  return (
    <>
      <article className={`staker-card${f.atMax ? ' maxed' : ''}`}>
        <div className="sc-top">
          <p className="eyebrow">{f.pool === 'operator' ? 'Node operator · Chainlink staking' : 'Community staker · Chainlink staking'}</p>
          <span className="sc-rank mono">#{formatCount(f.sinceRank)}</span>
        </div>
        {f.operatorName && <p className="sc-name">{f.operatorName}</p>}
        <a className="sc-address mono" href={etherscanAddress(f.address)} rel="noopener">{f.address}</a>
        <p className="sc-stake mono">
          {formatCount(f.stake)} <small>LINK</small>
          {f.atMax && <span className="chip chip-max">MAX</span>}
        </p>
        <dl className="sc-facts">
          <div><dt>Staking since</dt><dd>{formatUtcDay(f.since)}</dd><span>{formatCount(f.days)} days</span></div>
          <div><dt>In line</dt><dd className="mono">#{formatCount(f.sinceRank)}</dd><span>of {formatCount(f.poolStakers)} by first stake</span></div>
          <div><dt>By size</dt><dd className="mono">{f.atMaxCount !== null ? 'Max' : `#${formatCount(f.stakeRank)}`}</dd><span>{f.atMaxCount !== null ? sizeText(f) : (top ?? `of ${formatCount(f.poolStakers)}`)}</span></div>
          <div><dt>Earning</dt><dd className="mono">{f.yearly === null ? '—' : `≈ ${formatCount(f.yearly)}`}</dd><span>LINK a year at today's rate</span></div>
        </dl>
        <ul className="sc-badges">
          {f.dayOne && <li className="gold">Day one: staked in the first month</li>}
          {f.grabs > 0 && <li>Gap hunter · took open space {formatCount(f.grabs)} time{f.grabs === 1 ? '' : 's'}</li>}
          {f.atMax && <li className="gold">At the {formatCount(f.maxStake)} LINK max</li>}
          {f.holder !== 'wallet' && <li>{VIA_LABEL[f.holder]}</li>}
        </ul>
        <StatusLine f={f} />
      </article>
      <div className="sc-share">
        <ShareButton view="staker" headline={headline} url={`https://ccip.dev/staking/${f.address}/`} cardUrl={`/og/staker/${f.address}.png`} />
        <a href="/staking/">The whole pool →</a>
      </div>
    </>
  );
}

/** A staker's card at /staking/<address>/, from the stakers file that holds the address and staking.json for the pool around it. */
export default function StakerView() {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    const address = addressFromPath(window.location.pathname);
    if (address === null) {
      setState({ kind: 'lookup' });
      return;
    }
    setState({ kind: 'loading', address });
    let cancelled = false;
    Promise.all([fetchPublic(stakerShard(address)), fetchPublic('staking.json')]).then(
      ([stakers, staking]) => {
        if (cancelled) return;
        const row = findStaker(stakers, address);
        setState(row === null ? { kind: 'missing', address } : { kind: 'found', facts: stakerFacts(row, staking, new Date()) });
      },
      () => {
        if (!cancelled) setState({ kind: 'failed', address });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="staker-page">
      {state?.kind === 'found' && <Card f={state.facts} />}
      {state?.kind === 'loading' && <p className="muted">Reading the pool…</p>}
      {state?.kind === 'missing' && (
        <div className="panel">
          <h1 className="sc-missing">Not staking right now</h1>
          <p className="muted mono">{state.address}</p>
          <p>This address holds no stake in either Chainlink staking pool. If it unstaked, its card is gone with its stake.</p>
        </div>
      )}
      {state?.kind === 'failed' && <p className="muted">The staking data is unavailable right now. Try again in a minute.</p>}
      {state?.kind === 'lookup' && <h1>Find a staker</h1>}
      <StakerLookup label={state?.kind === 'found' ? 'Look up another staker' : 'Staking address'} />
    </section>
  );
}
