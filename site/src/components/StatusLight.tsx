import type { StatusFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { trackDataError } from '../lib/analytics';
import { startPoller } from '../lib/poller';
import { ingestLagSeconds, statusLevel, statusText } from '../lib/status-light';
import { useNow } from './hooks';

export default function StatusLight() {
  const [status, setStatus] = useState<StatusFile | null>(null);
  const [failures, setFailures] = useState(0);
  const now = useNow(5000);
  useEffect(
    () =>
      startPoller({
        name: 'status.json',
        onData: (s) => {
          setStatus(s);
          setFailures(0);
        },
        onError: (_error, n) => {
          setFailures(n);
          trackDataError('status.json');
        },
      }),
    [],
  );
  const lag = status && now ? ingestLagSeconds(status, now) : null;
  const level = status ? statusLevel(lag, failures) : failures >= 3 ? 'red' : 'checking';
  const text = level === 'checking' ? 'Checking live data…' : statusText(level, lag);
  return (
    <a className={`status-light status-${level}`} href="/status/" title={text} aria-label={text}>
      <span className="dot" aria-hidden="true" />
      <span className="status-text">{text}</span>
    </a>
  );
}
