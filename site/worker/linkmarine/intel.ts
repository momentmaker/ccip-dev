import type { IntelCards, IntelKind } from '@ccip-dev/core/linkmarine';
import type { VNode } from '../h';
import type { ChainArt } from './chain-hex';
import { dossierTree } from './dossier-card';
import { recordsTree } from './records-card';
import { sitrepTree } from './sitrep-card';
import { vaultTree } from './vault-card';

/** The chains whose icons a card draws. */
export function intelSelectors<K extends IntelKind>(kind: K, card: IntelCards[K]): string[] {
  if (kind === 'sitrep') return (card as IntelCards['sitrep']).lanes.flatMap((l) => [l.src.selector, l.dst.selector]);
  if (kind === 'dossier') {
    const d = card as IntelCards['dossier'];
    return [d.chain.selector, ...d.partners.map((p) => p.chain.selector)];
  }
  return [];
}

export function intelTree<K extends IntelKind>(kind: K, card: IntelCards[K], arts: ReadonlyMap<string, ChainArt>): VNode {
  switch (kind) {
    case 'sitrep':
      return sitrepTree(card as IntelCards['sitrep'], arts);
    case 'dossier':
      return dossierTree(card as IntelCards['dossier'], arts);
    case 'vault':
      return vaultTree(card as IntelCards['vault']);
    case 'records':
      return recordsTree(card as IntelCards['records']);
    default:
      throw new Error(`no intel card called ${String(kind)}`);
  }
}
