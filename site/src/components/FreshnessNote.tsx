import { formatAgo } from '../lib/format';
import { useNow } from './hooks';

export default function FreshnessNote({ updatedAt, paused }: { updatedAt: string | null; paused: boolean }) {
  const now = useNow(1000);
  const age = updatedAt && now ? formatAgo(updatedAt, now) : null;
  return (
    <>
      <p className={paused ? 'freshness paused' : 'visually-hidden'} role="status">
        {paused ? `Live data paused — retrying${age ? ` · data from ${age}` : ''}` : ''}
      </p>
      {!paused && <p className="freshness">{age ? `Updated ${age}` : ' '}</p>}
    </>
  );
}
