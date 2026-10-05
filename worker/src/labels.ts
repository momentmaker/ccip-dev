import { labelKey, type Label, type LabelIndex } from '@ccip-dev/core';
import bundled from './generated/labels.json';

export const bundledLabels: LabelIndex = bundled as LabelIndex;

export function lookupLabel(index: LabelIndex, chainName: string | undefined, address: string): Label | null {
  return chainName ? (index[labelKey(chainName, address)] ?? null) : null;
}
