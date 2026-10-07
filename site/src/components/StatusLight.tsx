import type { StatusFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { trackDataError } from '../lib/analytics';
import { startPoller } from '../lib/poller';
import { ingestLagSeconds, PAUSED_TEXT, RED_AFTER_FAILURES, type StatusLevel, statusLevel, statusText, statusWord } from '../lib/status-light';
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
  const paused = failures > 0 && failures < RED_AFTER_FAILURES;
  const level: StatusLevel | null = status ? statusLevel(lag, failures) : failures >= RED_AFTER_FAILURES ? 'red' : failures > 0 ? 'amber' : null;
  const text = !level ? 'Checking live data…' : paused ? PAUSED_TEXT : statusText(level, lag);
  return (
    <a className={`status-light status-${level ?? 'checking'}`} href="/status/" title={text} aria-label={text}>
      <span className="dot" aria-hidden="true" />
      <span className="status-word">{statusWord(level, failures)}</span>
      <span className="status-text">{text}</span>
    </a>
  );
}
