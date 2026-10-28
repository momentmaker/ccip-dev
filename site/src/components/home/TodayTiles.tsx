import type { TodayFile } from '@ccip-dev/core/public';
import { formatCount, formatDuration, formatUsd, linkShareText } from '../../lib/format';
import type { MetricKey } from '../../lib/metric-anchors';
import InfoLink from '../InfoLink';

interface Stat {
  label: string;
  metric: MetricKey;
  info: string;
  value: string;
  sub: string;
}

/** Today's figures beside the chart, as one strip. */
export default function TodayTiles({ totals, yesterdaySenders = null }: { totals: TodayFile['totals']; yesterdaySenders?: number | null }) {
  const stats: Stat[] = [
    { label: 'Token transfers', metric: 'messages', info: 'token transfers', value: formatCount(totals.token_messages), sub: `of ${formatCount(totals.messages)} messages` },
    { label: 'Unique senders', metric: 'senders', info: 'unique senders', value: formatCount(totals.unique_senders), sub: yesterdaySenders === null ? 'today so far' : `yesterday ${formatCount(yesterdaySenders)}` },
    { label: 'Median delivery', metric: 'delivery', info: 'delivery time', value: formatDuration(totals.median_delivery_s), sub: 'send to execution' },
    { label: 'Fees', metric: 'fees', info: 'fees', value: formatUsd(totals.fee_usd), sub: totals.fee_link_share_pct === null ? 'paid to Chainlink' : linkShareText(totals.fee_link_share_pct) },
    { label: 'Unpriced', metric: 'unpriced', info: 'unpriced messages', value: formatCount(totals.unpriced_messages), sub: 'with a token we cannot price' },
  ];
  return (
    <div className="stats">
      {stats.map((s) => (
        <div key={s.label} className="stat">
          <span className="label">
            <span className="hexb" aria-hidden="true">
              ⬡
            </span>
            {s.label}
            <InfoLink metric={s.metric} label={s.info} />
          </span>
          <p className="stat-value mono">{s.value}</p>
          <span className="stat-sub">{s.sub}</span>
        </div>
      ))}
    </div>
  );
}
