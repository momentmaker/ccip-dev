import { addDays } from '../../src/lib/days';

export interface Cta {
  lead: string;
  path: string;
}

export const CTA_ROTATION: readonly Cta[] = [
  { lead: 'Watch every lane:', path: 'ccip.dev/replay' },
  { lead: 'What does a message cost?', path: 'ccip.dev/flow/30d' },
  { lead: 'Who pays the most:', path: 'ccip.dev/top/chain/7d/fees' },
  { lead: 'Every record:', path: 'ccip.dev/records' },
  { lead: 'Track the Reserve:', path: 'ccip.dev/reserve' },
];

export const RECORDS_CTA: Cta = { lead: 'Every record:', path: 'ccip.dev/records' };
export const RESERVE_CTA: Cta = { lead: 'Track it:', path: 'ccip.dev/reserve' };
export const CHAINS_CTA: Cta = { lead: 'Every chain:', path: 'ccip.dev/chains' };
export const BOARDS_CTA: Cta = { lead: 'Every board:', path: 'ccip.dev/top/chain/7d/fees' };
export const REPLAY_CTA: Cta = { lead: 'Watch every lane:', path: 'ccip.dev/replay' };
export const SENDERS_CTA: Cta = { lead: 'Every sender:', path: 'ccip.dev/top/sender/7d' };
export const HISTORY_CTA: Cta = { lead: 'Every week:', path: 'ccip.dev/history' };

/** Be The Oracle joins the rotation at its launch, set here with its call to action; until then it stays out. */
export const ORACLE: { launch: string; cta: Cta } | null = null;
export const ORACLE_ALTERNATE_DAYS = 30;

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 86_400_000);
const pick = (list: readonly Cta[], n: number) => list[((n % list.length) + list.length) % list.length]!;

export function ctaFor(day: string, oracle: { launch: string; cta: Cta } | null = ORACLE): Cta {
  const n = dayNumber(day);
  if (oracle === null || day < oracle.launch) return pick(CTA_ROTATION, n);
  if (day < addDays(oracle.launch, ORACLE_ALTERNATE_DAYS)) return (n - dayNumber(oracle.launch)) % 2 === 0 ? oracle.cta : pick(CTA_ROTATION, n);
  return pick([...CTA_ROTATION, oracle.cta], n);
}
