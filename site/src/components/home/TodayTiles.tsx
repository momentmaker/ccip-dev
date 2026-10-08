import type { TodayFile } from '@ccip-dev/core/public';
import { formatCount, formatDuration, formatUsd, linkShareText } from '../../lib/format';
import InfoLink from '../InfoLink';

export default function TodayTiles({ totals }: { totals: TodayFile['totals'] }) {
  const linkShare = totals.fee_link_share_pct === null ? null : linkShareText(totals.fee_link_share_pct);
  return (
    <div className="tiles">
      <div className="tile">
        <span className="label">Token transfers<InfoLink metric="messages" label="token transfers" /></span>
        <p className="value">{formatCount(totals.token_messages)}</p>
        <span className="sub">of {formatCount(totals.messages)} messages</span>
      </div>
      <div className="tile">
        <span className="label">Unique senders<InfoLink metric="senders" label="unique senders" /></span>
        <p className="value">{formatCount(totals.unique_senders)}</p>
      </div>
      <div className="tile">
        <span className="label">Median delivery<InfoLink metric="delivery" label="delivery time" /></span>
        <p className="value">{formatDuration(totals.median_delivery_s)}</p>
      </div>
      <div className="tile">
        <span className="label">Fees<InfoLink metric="fees" label="fees" /></span>
        <p className="value">{formatUsd(totals.fee_usd)}</p>
        <span className="sub">{linkShare ?? ' '}</span>
      </div>
      <div className="tile">
        <span className="label">Unpriced<InfoLink metric="unpriced" label="unpriced messages" /></span>
        <p className="value">{formatCount(totals.unpriced_messages)}</p>
        <span className="sub">messages with a token we cannot price</span>
      </div>
    </div>
  );
}
