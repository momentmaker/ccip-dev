import { DASH, formatUtcDay, formatUtcTime } from '../lib/format';
import { ingestLagSeconds, statusLevel, statusText } from '../lib/status-light';
import FreshnessNote from './FreshnessNote';
import { useNow } from './hooks';
import { useStatus } from './use-status';

export default function StatusPanel() {
  const { status, failures } = useStatus();
  const now = useNow(1000);
  const lag = status && now ? ingestLagSeconds(status, now) : null;
  const level = status ? statusLevel(lag, failures) : failures >= 3 ? 'red' : null;
  const ingest = status?.last_ingest_ok_at;
  return (
    <section className="card">
      <p className={`status-big status-${level ?? 'checking'}`}>
        <span className="dot" aria-hidden="true" /> {level ? statusText(level, lag) : 'Checking live data…'}
      </p>
      <dl className="facts">
        <dt>Last successful ingest</dt>
        <dd className="mono">{ingest ? `${formatUtcDay(ingest)} ${formatUtcTime(ingest)}` : DASH}</dd>
        <dt>Last finalized day</dt>
        <dd className="mono">{status?.last_finalize_day ?? DASH}</dd>
        <dt>History since</dt>
        <dd className="mono">{status?.coverage_from ?? DASH}</dd>
      </dl>
      <FreshnessNote updatedAt={status?.updated_at ?? null} paused={failures > 0} />
    </section>
  );
}
