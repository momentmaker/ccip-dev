import { formatUtcDay } from '@ccip-dev/core/format';
import { chainName, chainNameMap } from '@ccip-dev/core/names';
import { passportShard, type PassportToken } from '@ccip-dev/core/public';
import { passportSlug } from '../../src/lib/card-paths';
import { CHECK_LABEL, RESULT_LABEL, type CheckKind, type CheckValue } from '../../src/lib/passport';
import { h, type VNode } from '../h';
import { bigText, bold, broadcastFrame, cardDay, COLORS, columnLine, momentColumn, nameSize, pill, PILLS, row, type BroadcastInputs } from './broadcast-frame';

const CHECKS: readonly CheckKind[] = ['single-key', 'rate-limit', 'pool-pointer'];
const CHIP: Record<CheckValue | 'none', { color: string; label: string }> = {
  flagged: { color: COLORS.down, label: RESULT_LABEL.flagged },
  'not readable': { color: COLORS.soft, label: RESULT_LABEL['not readable'] },
  clear: { color: COLORS.up, label: RESULT_LABEL.clear },
  none: { color: COLORS.muted, label: 'No result' },
};
const ORDER: Record<CheckValue | 'none', number> = { flagged: 0, 'not readable': 1, clear: 2, none: 3 };
const SHOWN_CHAINS = 4;

function chainsText(token: PassportToken, names: Map<string, string>): string {
  const all = token.chains.map((c) => chainName(names, c));
  return all.length <= SHOWN_CHAINS ? all.join(' · ') : `${all.slice(0, SHOWN_CHAINS - 1).join(' · ')} +${all.length - SHOWN_CHAINS + 1} more`;
}

function resultRow(check: CheckKind, value: CheckValue | 'none'): VNode {
  const chip = CHIP[value];
  return row(
    [
      h('div', { style: { display: 'flex', justifyContent: 'center', width: 200, fontSize: 22, fontWeight: 800, letterSpacing: 1, color: '#070a10', backgroundColor: chip.color, borderRadius: 6, padding: '6px 0', marginRight: 18 } }, chip.label),
      h('div', { style: { display: 'flex', fontSize: 30, fontWeight: 700, color: COLORS.strong } }, CHECK_LABEL[check]),
    ],
    { marginTop: 16 },
  );
}

/** A token's passport page card: its name, chains and three rolled-up results, flagged first, read from its shard. */
export async function passportTree(id: string, inputs: BroadcastInputs): Promise<VNode | null> {
  const [shard, chains] = await Promise.all([inputs.load(passportShard(id)), inputs.load('chains.json')]);
  const token = shard.tokens.find((t) => t.id === id);
  if (token === undefined) return null;
  const names = chainNameMap(chains.chains);
  const results = CHECKS.map((check) => ({ check, value: token.results[check] ?? ('none' as const) })).sort((a, b) => ORDER[a.value] - ORDER[b.value]);
  return broadcastFrame({
    background: [],
    eyebrow: `Token Passport · read ${cardDay(shard.day)}`,
    body: momentColumn(
      pill('TOKEN PASSPORT', PILLS.welcome),
      bigText(token.name, nameSize(token.name)),
      columnLine([...(token.symbol ? [bold(token.symbol), '  on  '] : ['On ']), chainsText(token, names)], { fontSize: 24, color: COLORS.soft }),
      h('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 14 } }, ...results.map((r) => resultRow(r.check, r.value))),
    ),
    insight: ['Recording since ', bold(formatUtcDay(shard.since))],
    cta: { lead: '', path: `ccip.dev/passport/${passportSlug(id)}` },
  });
}
