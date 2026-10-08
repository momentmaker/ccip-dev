import type { TodayFile } from '@ccip-dev/core/public';
import { formatCount, formatUsd } from '../../lib/format';
import { useCountUp } from '../hooks';
import InfoLink from '../InfoLink';

export default function Headline({ today, yesterday, animate }: { today: TodayFile; yesterday: { messages: number; usd_value: number; fee_usd: number | null } | null; animate: boolean | null }) {
  const messages = useCountUp(today.totals.messages, animate);
  const usd = useCountUp(today.totals.usd_value, animate);
  const fees = useCountUp(today.totals.fee_usd ?? 0, animate);
  return (
    <div className="headline card">
      <span className="label">
        Today so far · UTC
        <InfoLink metric="messages" label="messages" />
      </span>
      <p className="headline-number mono">{formatCount(messages)}</p>
      <p className="headline-sub">
        messages · <span className="mono">{formatUsd(usd)}</span> moved
        <InfoLink metric="value" label="value transferred" />
        {today.totals.fee_usd !== null && (
          <>
            {' · '}
            <a className="headline-fees" href="/reserve/" title="Fees paid to Chainlink, the revenue behind the Chainlink Reserve">
              <span className="mono">{formatUsd(fees)}</span> fees
            </a>
          </>
        )}
      </p>
      {yesterday && (
        <p className="muted small">
          Yesterday: {formatCount(yesterday.messages)} messages · {formatUsd(yesterday.usd_value)}
          {yesterday.fee_usd !== null && ` · ${formatUsd(yesterday.fee_usd)} fees`}
        </p>
      )}
    </div>
  );
}
