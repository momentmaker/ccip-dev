import { ingestLagSeconds, PAUSED_TEXT, RED_AFTER_FAILURES, type StatusLevel, statusLevel, statusText, statusWord } from '../lib/status-light';
import { useNow } from './hooks';
import { useStatus } from './use-status';

export default function StatusLight() {
  const { status, failures } = useStatus();
  const now = useNow(5000);
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
