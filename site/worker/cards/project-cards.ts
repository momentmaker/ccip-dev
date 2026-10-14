import { formatCount, formatUtcDay } from '@ccip-dev/core/format';
import { chainName, shortAddress } from '@ccip-dev/core/names';
import { newcomerSpanWords, parseSenderKey, senderKeyAddress } from '@ccip-dev/core/senders';
import type { Child, VNode } from '../h';
import {
  bigText, bold, broadcastFrame, cardDay, COLORS, columnLine, eyebrow, hasReplayDay, iconsFor, loadMomentFiles, momentColumn, nameSize, namesOf, pill, PILLS, skyFor,
  TEXT_COLUMN, type BroadcastInputs,
} from './broadcast-frame';
import { SENDERS_CTA, type Cta } from './cta';
import { skyNodes } from './orbit-sky';

const counted = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;
const listed = (names: readonly string[]): Child[] => names.flatMap((n, i): Child[] => [...(i > 0 ? [' · '] : []), bold(n)]);
export const projectCta = (slug: string): Cta => ({ lead: 'Its page:', path: `ccip.dev/projects/${slug}` });

/** A new sender big in the column, its busiest chain gold in the day's sky. */
export async function newcomerTree(key: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const files = await loadMomentFiles(inputs);
  if (files === null) return null;
  const { moments, replay, chains } = files;
  const arrival = (moments.arrivals.senders ?? []).find((s) => s.key === key);
  if (arrival === undefined || !hasReplayDay(replay, arrival.day)) return null;
  const names = namesOf(replay, chains);
  const sky = skyFor(replay, names, arrival.day, arrival.day, { gold: arrival.chains[0] ?? null, starFree: [TEXT_COLUMN] });
  const name = arrival.label ?? shortAddress(senderKeyAddress(arrival.key));
  const parsed = parseSenderKey(arrival.key);
  return broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky, inputs.icon)),
    eyebrow: `New on CCIP · ${cardDay(arrival.day)}`,
    body: momentColumn(
      pill('NEW ON CCIP', PILLS.green, 'star'),
      eyebrow(`#${arrival.rank} sender of the day`, { marginTop: 24 }),
      bigText(name, nameSize(name)),
      columnLine([bold(`${counted(arrival.total_messages, 'message')} `), newcomerSpanWords(arrival.first_day, arrival.day, formatUtcDay)]),
      columnLine(['First message ', bold(`${formatUtcDay(arrival.first_day)} `), `· ${counted(arrival.chains.length, 'chain')}`], { fontSize: 24, color: COLORS.soft }),
    ),
    insight: arrival.chains.length === 0 ? [] : ['On ', ...listed(arrival.chains.slice(0, 3).map((s) => chainName(names, s)))],
    cta: parsed.kind === 'project' ? projectCta(parsed.slug) : SENDERS_CTA,
  });
}
