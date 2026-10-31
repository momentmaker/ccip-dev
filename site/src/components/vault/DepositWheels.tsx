import { formatUtcDay } from '../../lib/format';
import { countdown } from '../../lib/reserve-view';
import { useNow } from '../hooks';

/** The countdown's four wheels: days, hours, minutes, seconds. */
export function countdownParts(ms: number): [number, number, number, number] {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 86_400), Math.floor((s % 86_400) / 3_600), Math.floor((s % 3_600) / 60), s % 60];
}

/** The next expected deposit as four ticking wheels, or what the schedule says once it is due. */
export default function DepositWheels({ next, overdue }: { next: string | null; overdue: boolean }) {
  const now = useNow(1000);
  if (!next) return null;
  const state = now ? countdown(next, overdue, now.getTime()) : null;
  const parts = now && state?.kind === 'counting' ? countdownParts(Date.parse(next) - now.getTime()) : null;
  return (
    <div className="deposit">
      <span className="label">
        Next deposit
        <br />
        expected in
      </span>
      {parts ? (
        <div className="deposit-wheels" role="timer" aria-label={`Next deposit in ${parts[0]} days ${parts[1]} hours ${parts[2]} minutes`}>
          {(['Days', 'Hrs', 'Min', 'Sec'] as const).map((l, i) => (
            <span key={l}>
              <strong className="mono">{String(parts[i]).padStart(2, '0')}</strong>
              {l}
            </span>
          ))}
        </div>
      ) : (
        <span className="deposit-state">{state && state.kind !== 'none' && state.kind !== 'counting' ? state.text : `${formatUtcDay(next)}`}</span>
      )}
    </div>
  );
}
