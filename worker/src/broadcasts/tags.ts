import { normalizeAddress } from '@ccip-dev/core';
import { chainNameMap } from '@ccip-dev/core/names';
import type { RunContext } from '../context';
import * as store from '../store';

/** A project, sender or chain a post names: tagged as @x when it has a verified handle, otherwise written as its name. */
export interface Player {
  name: string;
  x: string | null;
}

export interface Tagger {
  chain(selector: string): Player;
  tokenProject(key: string): Player | null;
  /** The project of a registry token group, through any of its tokens' entries. */
  groupProject(group: string): Player | null;
}

const splitKey = (key: string) => {
  const at = key.indexOf(':');
  return { chain: key.slice(0, at), address: key.slice(at + 1) };
};

/** `tokenKeys` are the `${selector}:${address}` tokens whose project a post may tag; their groups are read from D1 up front. */
export async function createTagger(c: RunContext, tokenKeys: readonly string[]): Promise<Tagger> {
  const db = c.env.DB;
  const display = await store.chainDisplayNames(db);
  const shortNames = chainNameMap([...display].map(([selector, n]) => ({ selector, name: n.name, display_name: n.display_name })));
  const selectorOf = new Map([...display].flatMap(([selector, n]) => (n.name ? [[n.name, selector] as const] : [])));
  const entries = c.handles.tokens.flatMap((e) => {
    const selector = selectorOf.get(e.chain);
    return selector ? [{ ...e, selector }] : [];
  });
  const groups = await store.tokenGroupIds(db, [...tokenKeys.map(splitKey), ...entries.map((e) => ({ chain: e.selector, address: e.address }))]);
  const groupOf = (chain: string, address: string) => groups.get(`${chain}:${normalizeAddress(address)}`) ?? null;
  const projects = new Map<string, Player>();
  for (const key of tokenKeys) {
    const { chain, address } = splitKey(key);
    const group = groupOf(chain, address);
    const match = entries.find(
      (e) => (group !== null && groupOf(e.selector, e.address) === group) || (e.selector === chain && e.address === normalizeAddress(address)),
    );
    if (match) projects.set(key, { name: match.project, x: match.x });
  }
  const chainHandle = (selector: string) => {
    const name = display.get(selector)?.name;
    return name && Object.hasOwn(c.handles.chains, name) ? c.handles.chains[name]! : null;
  };
  return {
    chain: (selector) => ({ name: shortNames.get(selector) ?? selector, x: chainHandle(selector) }),
    tokenProject: (key) => projects.get(key) ?? null,
    groupProject: (group) => {
      const match = entries.find((e) => groupOf(e.selector, e.address) === group);
      return match ? { name: match.project, x: match.x } : null;
    },
  };
}
