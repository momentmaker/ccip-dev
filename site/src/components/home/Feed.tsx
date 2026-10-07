import type { LiveMessage } from '@ccip-dev/core/public';
import { formatUsd } from '../../lib/format';
import { laneLabel, type ChainNames } from '../../lib/names';
import { GOLD_USD } from '../../sky/scene';

export const FEED_SIZE = 20;

export function newestFirst(messages: readonly LiveMessage[]): LiveMessage[] {
  return [...messages].sort((a, b) => (a.send_ts < b.send_ts ? 1 : a.send_ts > b.send_ts ? -1 : 0)).slice(0, FEED_SIZE);
}

export default function Feed({ messages, names }: { messages: readonly LiveMessage[]; names: ChainNames }) {
  const rows = newestFirst(messages);
  if (rows.length === 0) return <p className="muted">No messages in the last 15 minutes.</p>;
  return (
    <ol className="feed">
      {rows.map((m) => (
        <li key={m.id} className={(m.usd ?? 0) >= GOLD_USD ? 'gold' : undefined}>
          <span className="mono muted">{m.send_ts.slice(11, 19)}</span>
          <span className="lane">{laneLabel(names, `${m.src}>${m.dst}`)}</span>
          <span className="mono">
            {m.token ?? 'data'}
            {m.usd ? ` ${formatUsd(m.usd)}` : ''}
          </span>
          {m.sender_label && (
            <span className="sender">
              {m.sender_label}
              <span className="verified" title="Verified label" aria-label="verified">
                ✓
              </span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
