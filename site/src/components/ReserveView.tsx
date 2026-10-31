import type { ReserveFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { trackDataError } from '../lib/analytics';
import { fetchPublic } from '../lib/data';
import { formatLink, formatPct } from '../lib/format';
import FreshnessNote from './FreshnessNote';
import BoughtLowHigh from './reserve/BoughtLowHigh';
import Road from './reserve/Road';
import StackCalc from './reserve/StackCalc';
import Streak from './reserve/Streak';
import Transfers from './reserve/Transfers';
import ShareButton from './ShareButton';
import VaultPanel from './vault/VaultPanel';

export default function ReserveView({ initial }: { initial: ReserveFile }) {
  const [reserve, setReserve] = useState(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchPublic('reserve.json').then(
      (fresh) => {
        if (!cancelled) setReserve(fresh);
      },
      () => {
        if (cancelled) return;
        setFailed(true);
        trackDataError('reserve.json');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const cost = reserve.cost_basis;
  const headline = `The Chainlink Reserve holds ${formatLink(reserve.latest?.link)}${cost?.change_pct != null ? `, ${formatPct(cost.change_pct)} vs its cost basis` : ''}`;

  return (
    <>
      <div className="reserve-top">
        <FreshnessNote updatedAt={reserve.updated_at} paused={failed} />
        <ShareButton view="reserve" headline={headline} url="https://ccip.dev/reserve/" cardUrl="/og/reserve.png" />
      </div>
      <VaultPanel reserve={reserve} heading />
      <Road reserve={reserve} />
      <Streak weekly={reserve.weekly} streak={reserve.pace?.deposit_streak ?? 0} />
      <BoughtLowHigh reserve={reserve} />
      <StackCalc reserve={reserve} />
      <Transfers transfers={reserve.transfers} />
    </>
  );
}
