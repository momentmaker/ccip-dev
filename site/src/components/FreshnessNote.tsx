import { formatAgo } from '../lib/format';
import { useNow } from './hooks';

export default function FreshnessNote({ updatedAt, paused }: { updatedAt: string | null; paused: boolean }) {
  const now = useNow(1000);
  const age = updatedAt && now ? formatAgo(updatedAt, now) : null;
  if (paused) {
    return (
      <p className="freshness paused" role="status">
        Live data paused — retrying{age ? ` · data from ${age}` : ''}
      </p>
    );
  }
  return <p className="freshness">{age ? `Updated ${age}` : ' '}</p>;
}
