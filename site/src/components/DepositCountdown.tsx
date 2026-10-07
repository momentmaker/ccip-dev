import { formatUtcDay, formatUtcTime } from '../lib/format';
import { countdown } from '../lib/reserve-view';
import { useNow } from './hooks';

export default function DepositCountdown({ next, overdue }: { next: string | null; overdue: boolean }) {
  const now = useNow(1000);
  if (!next) return <span className="muted">No deposit schedule yet</span>;
  const state = now ? countdown(next, overdue, now.getTime()) : null;
  if (!state || state.kind === 'none') {
    return <span className="countdown">Next deposit expected {formatUtcDay(next)} {formatUtcTime(next)}</span>;
  }
  return (
    <span className={`countdown countdown-${state.kind}`} role="timer">
      {state.kind === 'counting' ? `Next deposit in ${state.text}` : state.text}
    </span>
  );
}
