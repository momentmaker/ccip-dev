import type { TodayFile } from '@ccip-dev/core/public';
import { formatCount, formatUsd } from '../../lib/format';
import { useCountUp } from '../hooks';
import InfoLink from '../InfoLink';

export default function Headline({ today, yesterday, animate }: { today: TodayFile; yesterday: { messages: number; usd_value: number } | null; animate: boolean }) {
  const messages = useCountUp(today.totals.messages, animate);
  const usd = useCountUp(today.totals.usd_value, animate);
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
      </p>
      {yesterday && (
        <p className="muted small">
          Yesterday: {formatCount(yesterday.messages)} messages · {formatUsd(yesterday.usd_value)}
        </p>
      )}
    </div>
  );
}
