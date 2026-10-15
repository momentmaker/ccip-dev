import { dataSharePct } from '@ccip-dev/core/format';
import type { Project, ProjectsFile } from '@ccip-dev/core/public';
import { REPO_URL } from '../config';
import type { ChartPoint } from './charts';
import { formatCount, formatShare } from './format';
import { shortAddress } from './names';

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

/** The slugs the build has pages for; a link to any other would 404. */
export const projectSlugs = (file: ProjectsFile | null): ReadonlySet<string> => new Set((file?.projects ?? []).map((p) => p.slug));

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

/** The page's meta description, naming its chains, lanes and addresses only when the page lists them. */
export function projectDescription(project: Project): string {
  const hasChains = project.chains.length > 0;
  const listed = [
    ...(hasChains ? ['chains'] : []),
    ...(hasChains && project.lanes.length > 0 ? ['lanes'] : []),
    ...(project.addresses.length > 0 ? ['addresses'] : []),
  ];
  const last = listed.pop();
  const what = last === undefined ? '' : `, with its ${listed.length > 0 ? `${listed.join(', ')} and ${last}` : last}`;
  return `${project.name} on Chainlink CCIP: ${formatCount(project.totals['7d'].messages)} messages in the last 7 days${what}.`;
}

/** "1,311 sent by its contracts · 689 via its token, by wallets bridging it"; null for a window with nothing via its token. */
export function viaTokenSplitText(t: Project['totals']['7d']): string | null {
  const via = t.via_token_messages ?? 0;
  return via <= 0 ? null : `${formatCount(t.messages - via)} sent by its contracts · ${formatCount(via)} via its token, by wallets bridging it`;
}

export interface ProjectTokenRow {
  chain: string;
  symbol: string;
  address: string;
  source: string;
}

/** The tokens the project claims; one with no symbol is named by its short address. */
export function projectTokenRows(project: Project): ProjectTokenRow[] {
  return (project.tokens ?? []).map((t) => ({ chain: t.chain, symbol: t.symbol ?? shortAddress(t.address), address: t.address, source: t.source }));
}
