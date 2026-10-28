import { etaText, milestoneText, type MilestoneGoal } from '../../lib/all-time';
import { formatCount, formatLink, formatUtcDay } from '../../lib/format';
import { formatProgressUsd, type MilestoneMetric } from '../../lib/records';
import { useNow } from '../hooks';
import { METRIC_WORD } from './Hud';

export const HEX_CELLS = 20;
/** Under a day away, a card turns gold and says so. */
const IMMINENT_DAYS = 1;

export interface ReserveGoal {
  link: number;
  previous: number;
  next: number;
  /** pace.next_milestone's ETA, when it is this milestone's. */
  eta: string | null;
}

export type LastCrossed = Partial<Record<MilestoneMetric, { threshold: number; day: string }>>;

/** The hex bar's cells: full, one part-full (its fill in %), and empty. */
export function hexCells(progress: number, cells = HEX_CELLS): (number | 'on' | 'off')[] {
  const filled = Math.min(1, Math.max(0, progress)) * cells;
  return Array.from({ length: cells }, (_, i) => (i + 1 <= filled ? 'on' : i < filled ? Math.round((filled - i) * 100) : 'off'));
}

function HexBar({ progress }: { progress: number }) {
  return (
    <span className="hexbar" aria-hidden="true">
      {hexCells(progress).map((c, i) => (typeof c === 'number' ? <i key={i} className="part" style={{ ['--p' as string]: `${c}%` }} /> : <i key={i} className={c === 'on' ? 'on' : undefined} />))}
    </span>
  );
}

interface Card {
  key: string;
  label: string;
  target: string;
  now: string;
  progress: number;
  daysLeft: number | null;
  from: string | null;
  crossed: string | null;
}

const NOW_TEXT: Record<MilestoneMetric, (n: number) => string> = { value: formatProgressUsd, fees: formatProgressUsd, messages: formatCount };
const LABEL: Record<MilestoneMetric, string> = { value: 'Moved · all time', messages: 'Messages · all time', fees: 'Fees · all time' };

function goalCard(goal: MilestoneGoal, last: LastCrossed, crossed: { metric: MilestoneMetric; threshold: number } | null): Card {
  const before = last[goal.metric];
  const crossedHere = crossed?.metric === goal.metric ? crossed.threshold : null;
  return {
    key: goal.metric,
    label: LABEL[goal.metric],
    target: `${milestoneText(goal.metric, goal.next)}`,
    now: NOW_TEXT[goal.metric](goal.total),
    progress: goal.progress,
    daysLeft: goal.daysLeft,
    from: crossedHere !== null ? `from ${milestoneText(goal.metric, crossedHere)}, crossed today` : before ? `from ${milestoneText(goal.metric, before.threshold)} on ${formatUtcDay(before.day)}` : null,
    crossed: crossedHere !== null ? `Crossed ${milestoneText(goal.metric, crossedHere)} today` : null,
  };
}

function reserveCard(r: ReserveGoal, nowMs: number | null): Card {
  const millions = (n: number) => `${n / 1e6}M`;
  return {
    key: 'reserve',
    label: 'Chainlink Reserve',
    target: `${millions(r.next)} LINK`,
    now: formatLink(r.link),
    progress: Math.min(1, Math.max(0, (r.link - r.previous) / (r.next - r.previous))),
    daysLeft: r.eta && nowMs !== null ? Math.max(0, (Date.parse(r.eta) - nowMs) / 86_400_000) : null,
    from: r.previous > 0 ? `from ${millions(r.previous)} LINK` : null,
    crossed: null,
  };
}

export default function Milestones({ goals, reserve, last, crossed }: { goals: readonly MilestoneGoal[]; reserve: ReserveGoal | null; last: LastCrossed; crossed: { metric: MilestoneMetric; threshold: number } | null }) {
  const now = useNow(60_000);
  const nowMs = now?.getTime() ?? null;
  const cards = [...goals.map((g) => goalCard(g, last, crossed)), ...(reserve ? [reserveCard(reserve, nowMs)] : [])];
  return (
    <section className="band" aria-labelledby="ms-title">
      <div className="band-head">
        <div>
          <p className="eyebrow">Countdown</p>
          <h2 id="ms-title">
            The next <span className="g">milestones</span>.
          </h2>
        </div>
        <a className="more-link" href="/records/">
          Every milestone so far →
        </a>
      </div>
      <div className="ms-grid">
        {cards.map((c) => {
          const hot = c.daysLeft !== null && c.daysLeft < IMMINENT_DAYS;
          const eta = c.daysLeft === null || nowMs === null ? null : `${etaText(c.daysLeft, nowMs, formatUtcDay)}${c.daysLeft >= 1.5 ? ` · ${Math.round(c.daysLeft)} days` : ''}`;
          return (
            <article key={c.key} className={`mc${hot ? ' hot' : ''}${c.crossed ? ' won' : ''}`}>
              <div className="mc-top">
                <span className="label">{c.label}</span>
                {c.crossed ? <span className="chip chip-won">{c.crossed}</span> : hot ? <span className="chip chip-hot">Imminent</span> : <span className="chip">{(c.progress * 100).toFixed(1)}%</span>}
              </div>
              <p className="mc-target">{c.target}</p>
              <p className="mc-now">
                now <span className="mono">{c.now}</span>
                {c.key !== 'reserve' && c.key in METRIC_WORD ? ` ${METRIC_WORD[c.key as MilestoneMetric]}` : ''}
              </p>
              <HexBar progress={c.progress} />
              <p className="mc-foot">
                {eta && <span>{eta}</span>}
                {c.from && <span>{c.from}</span>}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
