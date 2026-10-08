import { formatAgo } from '../lib/format';
import { useNow } from './hooks';

export default function FreshnessNote({ updatedAt, paused }: { updatedAt: string | null; paused: boolean }) {
  const now = useNow(1000);
  const age = updatedAt && now ? formatAgo(updatedAt, now) : null;
  const visible = paused ? (age ? `Data from ${age}` : ' ') : age ? `Updated ${age}` : ' ';
  return (
    <>
      <p className={paused ? 'freshness paused' : 'visually-hidden'} role="status">
        {paused ? 'Live data paused — retrying' : ''}
      </p>
      <p className="freshness">{visible}</p>
    </>
  );
}
