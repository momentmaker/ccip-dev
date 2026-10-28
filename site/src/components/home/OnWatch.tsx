import { useEffect, useState } from 'react';
import { formatCount, formatUsd } from '../../lib/format';
import { useNow } from '../hooks';

const pad = (n: number) => String(n).padStart(2, '0');

/** "04:09", or "1:04:09" past an hour. */
export function watchTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return h > 0 ? `${h}:${mm}` : mm;
}

/** How long this visitor has watched, and what landed while they did. */
export default function OnWatch({ count, usd }: { count: number; usd: number }) {
  const now = useNow(1000);
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => setStart(Date.now()), []);
  const seconds = now && start !== null ? (now.getTime() - start) / 1000 : 0;
  return (
    <span className="watch">
      On watch <span className="mono">{watchTime(seconds)}</span> · <span className="mono">{formatCount(count)}</span> {count === 1 ? 'message' : 'messages'} · <span className="mono">{formatUsd(usd)}</span>{' '}
      witnessed
    </span>
  );
}
