import type { LiveMessage } from '@ccip-dev/core/public';
import { useEffect, useRef } from 'react';
import { formatUsd } from '../../lib/format';
import { laneLabel, type ChainNames } from '../../lib/names';
import { GOLD_USD } from '../../sky/scene';
import ChainIcons from '../ChainIcons';

export const FEED_SIZE = 20;
/** The COMMS log shows the newest few; the full 15 minutes crawl along the hero. */
export const LOG_SIZE = 11;
/** Big enough to stand out in the log, short of a sky-lighting $1M. */
export const BIG_USD = 10_000;

export function newestFirst(messages: readonly LiveMessage[]): LiveMessage[] {
  return [...messages].sort((a, b) => (a.send_ts < b.send_ts ? 1 : a.send_ts > b.send_ts ? -1 : 0)).slice(0, FEED_SIZE);
}

export function rowClass(m: LiveMessage, fresh: boolean): string | undefined {
  const usd = m.usd ?? 0;
  const tone = usd >= GOLD_USD ? 'gold' : usd >= BIG_USD ? 'big' : '';
  return [tone, fresh ? 'in' : ''].filter(Boolean).join(' ') || undefined;
}

const SLIDE_MS = 900;

/** The newest messages; rows that arrive after the first paint slide in. */
export default function Feed({ messages, names, size = LOG_SIZE }: { messages: readonly LiveMessage[]; names: ChainNames; size?: number }) {
  const rows = newestFirst(messages).slice(0, size);
  const firstSeen = useRef(new Map<string, number>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const now = Date.now();
  for (const m of rows) if (!firstSeen.current.has(m.id)) firstSeen.current.set(m.id, mounted.current ? now : 0);
  const fresh = (id: string) => now - (firstSeen.current.get(id) ?? 0) < SLIDE_MS;
  if (rows.length === 0) return <p className="muted">No messages in the last 15 minutes.</p>;
  return (
    <ol className="comms">
      {rows.map((m) => (
        <li key={m.id} className={rowClass(m, fresh(m.id))}>
          <span className="comms-t mono">{m.send_ts.slice(11, 19)}</span>
          <span className="comms-lane">
            <ChainIcons selectors={[m.src, m.dst]} size={18} />
            <span className="comms-text">
              {laneLabel(names, `${m.src}>${m.dst}`)}
              {m.sender_label && (
                <span className="comms-sender">
                  {m.sender_label}
                  <span className="verified" title="Verified label" aria-label="verified">
                    ✓
                  </span>
                </span>
              )}
            </span>
          </span>
          <span className="comms-amt mono">
            {m.token ?? 'data'}
            {m.usd ? <span className="comms-usd">{formatUsd(m.usd)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
