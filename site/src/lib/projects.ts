import { dataSharePct } from '@ccip-dev/core/format';
import type { Project, ProjectsFile } from '@ccip-dev/core/public';
import { REPO_URL } from '../config';
import type { ChartPoint } from './charts';
import { formatShare } from './format';

export const PROJECT_KIND_LABEL: Readonly<Record<string, string>> = {
  protocol: 'Protocol',
  app: 'App',
  institution: 'Institution',
  exchange: 'Exchange',
  issuer: 'Token issuer',
  unknown: 'Project',
};

export const kindLabel = (kind: string): string => PROJECT_KIND_LABEL[kind] ?? 'Project';
export const projectHref = (slug: string): string => `/projects/${slug}/`;
/** One URL serves every chain family, so Solana and EVM senders link alike. */
export const addressExplorerUrl = (address: string): string => `https://ccip.chain.link/address/${address}`;
export const xProfileUrl = (handle: string): string => `https://x.com/${handle}`;
export const labelFileUrl = (slug: string): string => `${REPO_URL}/blob/main/labels/projects/${slug}.toml`;

export function projectPaths(file: ProjectsFile | null): { params: { slug: string }; props: { project: Project } }[] {
  return (file?.projects ?? []).map((project) => ({ params: { slug: project.slug }, props: { project } }));
}

export interface ProjectIndexRow {
  slug: string;
  href: string;
  name: string;
  kind: string;
  x: string | null;
  messages7d: number;
  share7d: number | null;
  usd30d: number;
  chains: string[];
}

export function projectIndexRows(projects: readonly Project[]): ProjectIndexRow[] {
  return projects.map((p) => ({
    slug: p.slug,
    href: projectHref(p.slug),
    name: p.name,
    kind: kindLabel(p.kind),
    x: p.x,
    messages7d: p.totals['7d'].messages,
    share7d: p.totals['7d'].share_pct,
    usd30d: p.totals['30d'].usd,
    chains: p.chains,
  }));
}

export function seriesPoints(series: Project['series']): ChartPoint[] {
  return series.map((s) => ({ day: s.day, value: s.messages }));
}

export function splitText(split: Project['split']): string | null {
  const data = dataSharePct(split.data_messages + split.token_messages, split.data_messages);
  return data === null ? null : `${formatShare(data)} data messages · ${formatShare(100 - data)} token transfers`;
}
