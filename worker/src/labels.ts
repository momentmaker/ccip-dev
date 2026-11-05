import { creKeySet, labelKey, type CreKeySet, type GeneratedCreKeys, type Label, type LabelIndex, type ProjectRegistry, type TokenLabels } from '@ccip-dev/core';
import bundledCre from './generated/cre-keys.json';
import bundled from './generated/labels.json';
import bundledRegistry from './generated/label-projects.json';
import bundledTokenLabels from './generated/label-tokens.json';

export const bundledLabels: LabelIndex = bundled as LabelIndex;
export const bundledProjects: ProjectRegistry = bundledRegistry as ProjectRegistry;
export const bundledLabelTokens: TokenLabels = bundledTokenLabels as TokenLabels;

export const bundledCreKeys: CreKeySet = creKeySet(bundledCre as GeneratedCreKeys);

export function lookupLabel(index: LabelIndex, chainName: string | undefined, address: string): Label | null {
  return chainName ? (index[labelKey(chainName, address)] ?? null) : null;
}
