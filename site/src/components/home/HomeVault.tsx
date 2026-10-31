import { useEffect, useState } from 'react';
import { fetchPublic } from '../../lib/data';
import { formatCount, formatLink, formatUsd } from '../../lib/format';
import { subscribeToday, type LiveToday } from '../../lib/live-store';
import VaultPanel, { type VaultReserve } from '../vault/VaultPanel';

export type { VaultReserve };

export default function HomeVault({ initial, today: initialToday }: { initial: VaultReserve; today: LiveToday }) {
  const [reserve, setReserve] = useState(initial);
  const [today, setToday] = useState(initialToday);
  useEffect(() => subscribeToday(setToday), []);
  useEffect(() => {
    let cancelled = false;
    fetchPublic('reserve.json').then(
      (fresh) => {
        if (!cancelled) setReserve(fresh);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const link = reserve.latest?.link ?? null;
  const pace = reserve.pace;
  return (
    <>
      <div className="flow">
        <div className="flow-node">
          <span className="label">Today</span>
          <strong className="mono">{formatCount(today.messages)}</strong>
          <span>CCIP messages sent</span>
        </div>
        <svg className="flow-link" viewBox="0 0 70 20" aria-hidden="true">
          <path d="M2 10H60" />
          <path className="flow-head" d="M56 4l8 6-8 6" />
        </svg>
        <div className="flow-node">
          <span className="label">Paying</span>
          <strong className="mono">{formatUsd(today.fees)}</strong>
          <span>in fees to Chainlink today</span>
        </div>
        <svg className="flow-link" viewBox="0 0 70 20" aria-hidden="true">
          <path d="M2 10H60" />
          <path className="flow-head" d="M56 4l8 6-8 6" />
        </svg>
        <div className="flow-node flow-gold">
          <span className="label">Stacking</span>
          <strong className="mono">{formatLink(link)}</strong>
          <span>in the Reserve{pace?.deposit_streak ? `, ${pace.deposit_streak} weeks running` : ''}</span>
        </div>
      </div>
      <VaultPanel reserve={reserve} />
    </>
  );
}
