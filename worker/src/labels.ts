import { labelKey, type Label, type LabelIndex, type ProjectRegistry } from '@ccip-dev/core';
import bundled from './generated/labels.json';
import bundledRegistry from './generated/label-projects.json';

export const bundledLabels: LabelIndex = bundled as LabelIndex;
export const bundledProjects: ProjectRegistry = bundledRegistry as ProjectRegistry;

export function lookupLabel(index: LabelIndex, chainName: string | undefined, address: string): Label | null {
  return chainName ? (index[labelKey(chainName, address)] ?? null) : null;
}
