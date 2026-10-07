import { useEffect, useState } from 'react';
import { fetchPublic } from '../../lib/data';
import { formatLink, formatPct } from '../../lib/format';
import DepositCountdown from '../DepositCountdown';

interface Snapshot {
  link: number | null | undefined;
  changePct: number | null;
  next: string | null;
  overdue: boolean;
}

export default function ReserveTeaser(initial: Snapshot) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  useEffect(() => {
    let cancelled = false;
    fetchPublic('reserve.json').then(
      (r) => {
        if (cancelled) return;
        setSnap({
          link: r.latest?.link,
          changePct: r.cost_basis?.change_pct ?? null,
          next: r.pace?.next_expected_deposit ?? null,
          overdue: r.pace?.deposit_overdue ?? false,
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <a className="card lift reserve-teaser" href="/reserve/">
      <span className="label">Chainlink Reserve</span>
      <p className="tile-value mono">{formatLink(snap.link)}</p>
      <p className="muted">
        {snap.changePct !== null ? `${formatPct(snap.changePct)} vs cost basis · ` : ''}
        <DepositCountdown next={snap.next} overdue={snap.overdue} />
      </p>
    </a>
  );
}
