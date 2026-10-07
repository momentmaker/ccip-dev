import type { APIRoute } from 'astro';
import { buildData } from '../lib/build-data';
import { buildLayout } from '../sky/layout';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(buildLayout((await buildData('replay.json')).chains)), {
    headers: { 'content-type': 'application/json' },
  });
