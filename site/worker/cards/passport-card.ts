import type { CheckValue } from '@ccip-dev/core';
import { formatUtcDay } from '@ccip-dev/core/format';
import { chainName, chainNameMap } from '@ccip-dev/core/names';
import { passportShard, type PassportFile, type PassportFileName, type PassportToken } from '@ccip-dev/core/public-passport';
import { passportSlug } from '../../src/lib/card-paths';
import { rollup, type ResultChip } from '../../src/lib/passport';
import { h, type VNode } from '../h';
import { bigText, bold, broadcastFrame, cardDay, COLORS, columnLine, momentColumn, nameSize, pill, PILLS, row, type BroadcastInputs } from './broadcast-frame';

/** A passport card reads its shard through its own loader, so fetchPublic and the browser never carry the passport schemas. */
export interface PassportInputs extends BroadcastInputs {
  loadPassport: <N extends PassportFileName>(name: N) => Promise<PassportFile<N>>;
}

const CHIP_COLOR: Record<CheckValue | 'none', string> = { flagged: COLORS.down, 'not readable': COLORS.soft, clear: COLORS.up, none: COLORS.muted };
const SHOWN_CHAINS = 4;

function chainsText(token: PassportToken, names: Map<string, string>): string {
  const all = token.chains.map((c) => chainName(names, c));
  return all.length <= SHOWN_CHAINS ? all.join(' · ') : `${all.slice(0, SHOWN_CHAINS - 1).join(' · ')} +${all.length - SHOWN_CHAINS + 1} more`;
}

function resultRow(chip: ResultChip): VNode {
  return row(
    [
      h('div', { style: { display: 'flex', justifyContent: 'center', width: 200, fontSize: 22, fontWeight: 800, letterSpacing: 1, color: '#070a10', backgroundColor: CHIP_COLOR[chip.value ?? 'none'], borderRadius: 6, padding: '6px 0', marginRight: 18 } }, chip.label),
      h('div', { style: { display: 'flex', fontSize: 30, fontWeight: 700, color: COLORS.strong } }, chip.checkLabel),
    ],
    { marginTop: 16 },
  );
}

/** A token's passport page card: its name, chains and three rolled-up results, flagged first, read from its shard. */
export async function passportTree(id: string, inputs: PassportInputs): Promise<VNode | null> {
  const [shard, chains] = await Promise.all([inputs.loadPassport(passportShard(id)), inputs.load('chains.json')]);
  const token = shard.tokens.find((t) => t.id === id);
  if (token === undefined) return null;
  const names = chainNameMap(chains.chains);
  return broadcastFrame({
    background: [],
    eyebrow: `Token Passport · read ${cardDay(shard.day)}`,
    body: momentColumn(
      pill('TOKEN PASSPORT', PILLS.welcome),
      bigText(token.name, nameSize(token.name)),
      columnLine([...(token.symbol ? [bold(token.symbol), '  on  '] : ['On ']), chainsText(token, names)], { fontSize: 24, color: COLORS.soft }),
      h('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 14 } }, ...rollup(token.results).map(resultRow)),
    ),
    insight: ['Recording since ', bold(formatUtcDay(shard.since))],
    cta: { lead: '', path: `ccip.dev/passport/${passportSlug(id)}` },
  });
}
