import type { APIRoute } from 'astro';
import { buildData } from '../lib/build-data';
import { iconDataUri } from '../lib/chain-icons-server';
import { slugMap } from '../lib/chain-slug';
import { daysBetween } from '../lib/days';
import { shortChainName } from '../lib/names';
import { StoryCounter } from '../replay/director/story';
import { linearWarp } from '../replay/director/warp';

export const GET: APIRoute = async () => {
  const [replay, history] = await Promise.all([buildData('replay.json'), buildData('history.json')]);
  const first = replay.since ?? replay.days[0]?.day ?? '';
  const last = replay.days.at(-1)?.day ?? first;
  const days = first ? daysBetween(first, last) : [];
  const slugs = slugMap(replay.chains);
  const out: Record<string, unknown> = {};
  for (const chain of replay.chains) {
    const counter = new StoryCounter(days, history.days, replay, chain.selector);
    const totals = counter.dailyTotals();
    out[slugs.get(chain.selector)!] = {
      name: shortChainName(chain),
      since: chain.first_day,
      usd: totals.reduce((s, d) => s + d.usd_value, 0),
      messages: totals.reduce((s, d) => s + d.messages, 0),
      partners: counter.at(Number.POSITIVE_INFINITY, linearWarp(days.length, 0, 1)).chains,
      coin: iconDataUri(chain.selector),
    };
  }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
};
