import type { ReserveFile } from '@ccip-dev/core/public';
import { formatLink, formatUtcDay } from '../../lib/format';

export const BAR_WEEKS = 26;

/** LINK deposited a week, the latest week brightest, and this week's expected deposit as a dashed bar. */
export default function WeeklyBars({ weekly, pending }: { weekly: ReserveFile['weekly']; pending: number | null }) {
  const weeks = weekly.filter((w) => w.deposits > 0).slice(-BAR_WEEKS);
  if (weeks.length === 0) return null;
  const W = 600;
  const H = 110;
  const slots = weeks.length + (pending ? 1 : 0);
  const gap = 4;
  const bw = (W - gap * (slots - 1)) / slots;
  const max = Math.max(...weeks.map((w) => w.link), pending ?? 0);
  const h = (link: number) => Math.max(2, (link / max) * (H - 4));
  return (
    <div className="vault-bars">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`LINK deposited a week over the last ${weeks.length} weeks, ${formatLink(weeks.at(-1)!.link)} the latest`}>
        <defs>
          <linearGradient id="vault-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f5c451" />
            <stop offset="1" stopColor="#8a5e10" />
          </linearGradient>
        </defs>
        {weeks.map((w, i) => (
          <rect key={w.week} x={i * (bw + gap)} y={H - h(w.link)} width={bw} height={h(w.link)} rx="2" className={i === weeks.length - 1 ? 'bar bar-last' : 'bar'}>
            <title>{`Week of ${formatUtcDay(w.week)}: ${formatLink(w.link)}`}</title>
          </rect>
        ))}
        {pending ? <rect x={weeks.length * (bw + gap)} y={H - h(pending)} width={bw} height={h(pending)} rx="2" className="bar-due" /> : null}
      </svg>
      <p className="vault-bars-cap">
        <span>LINK deposited a week · last {weeks.length} weeks</span>
        {pending ? <span>dashed: this week, due</span> : null}
      </p>
    </div>
  );
}
