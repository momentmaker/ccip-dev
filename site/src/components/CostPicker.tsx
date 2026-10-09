import type { CostFile } from '@ccip-dev/core/public';
import { useEffect, useId, useMemo, useState } from 'react';
import { trackDataError } from '../lib/analytics';
import {
  chainIndex, chainOf, destinationOptions, routeForSource, routeFromQuery, routeOf, routeQuery, sourceOptions, type ChainIndex, type CostChain, type CostRoute,
} from '../lib/cost';
import { fetchPublic } from '../lib/data';
import { formatCount, formatFee, formatUtcDay } from '../lib/format';
import ChainIcons from './ChainIcons';
import InfoLink from './InfoLink';

export const COST_TITLE = 'What does a message cost?';
export const NOT_ENOUGH = 'Not enough messages in the last 30 days to say.';
export const COST_UNAVAILABLE = 'Fee data is not available right now.';
export const NO_ROUTES = 'No route has enough priced fees in the last 30 days yet.';

export type CostState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; cost: CostFile; route: CostRoute | null };

interface Choosing {
  index: ChainIndex;
  onChange: (route: CostRoute) => void;
}

export function CostView({ cost, route, index, onChange }: Choosing & { cost: CostFile; route: CostRoute }) {
  const id = useId();
  const lane = route.lane;
  return (
    <div className="cost-body">
      <div className="cost-selects">
        <label className="cost-field" htmlFor={`${id}-from`}>
          <span className="label">From</span>
          <select id={`${id}-from`} name="cost-from" value={route.src} onChange={(e) => onChange(routeForSource(cost, e.target.value, route.dst))}>
            {sourceOptions(cost, index, route.src).map((c) => (
              <option key={c.selector} value={c.selector}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="cost-field" htmlFor={`${id}-to`}>
          <span className="label">To</span>
          <select id={`${id}-to`} name="cost-to" value={route.dst} onChange={(e) => onChange(routeOf(cost, route.src, e.target.value))}>
            {destinationOptions(cost, index, route.src, route.dst).map((c) => (
              <option key={c.selector} value={c.selector}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="cost-result" aria-live="polite">
        <p className="cost-route">
          <ChainIcons selectors={[route.src, route.dst]} />
          {chainOf(index, route.src).name} → {chainOf(index, route.dst).name}
        </p>
        {lane ? (
          <>
            <span className="label">
              Typical fee
              <InfoLink metric="typical_fee" label="the typical fee" />
            </span>
            <p className="cost-typical mono">{formatFee(lane.median_usd)}</p>
            <p>
              most between {formatFee(lane.p10_usd)} and {formatFee(lane.p90_usd)}
            </p>
            <p className="muted small">
              based on {formatCount(lane.messages)} messages, {formatUtcDay(cost.from)}–{formatUtcDay(cost.to)}
            </p>
            {lane.link && (
              <p className="small">
                Paid in LINK: {formatFee(lane.link.median_usd)}
                {lane.gas && ` · in gas tokens: ${formatFee(lane.gas.median_usd)}`}
              </p>
            )}
          </>
        ) : (
          <p className="muted">{NOT_ENOUGH}</p>
        )}
      </div>
    </div>
  );
}

export function CostPanel({ state, index, onChange }: Choosing & { state: CostState }) {
  if (state.status === 'loading') {
    return (
      <div className="cost-skeleton">
        <span className="visually-hidden">Loading fees…</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </div>
    );
  }
  if (state.status === 'failed') return <p className="muted">{COST_UNAVAILABLE}</p>;
  if (state.route === null) return <p className="muted">{NO_ROUTES}</p>;
  return <CostView cost={state.cost} route={state.route} index={index} onChange={onChange} />;
}

export default function CostPicker({ chains }: { chains: CostChain[] }) {
  const titleId = useId();
  const index = useMemo(() => chainIndex(chains), [chains]);
  const [state, setState] = useState<CostState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetchPublic('cost.json').then(
      (cost) => {
        if (!cancelled) setState({ status: 'ready', cost, route: routeFromQuery(cost, index, window.location.search) });
      },
      () => {
        if (cancelled) return;
        setState({ status: 'failed' });
        trackDataError('cost.json');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [index]);
  const choose = (route: CostRoute) => {
    setState((s) => (s.status === 'ready' ? { ...s, route } : s));
    window.history.replaceState(null, '', `${window.location.pathname}${routeQuery(index, route)}`);
  };
  return (
    <section className="card cost-picker" aria-labelledby={titleId} aria-busy={state.status === 'loading'}>
      <h2 id={titleId}>{COST_TITLE}</h2>
      <CostPanel state={state} index={index} onChange={choose} />
    </section>
  );
}
