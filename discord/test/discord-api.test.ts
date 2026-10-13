import { describe, expect, it } from 'vitest';
import { DISCORD_API, discordApi } from '../src/discord-api';
import { APP } from './helpers';

interface Sent {
  method: string;
  url: string;
  body: unknown;
  files: { name: string; filename: string; type: string; size: number }[];
}

/** Discord as a list of answers, one per request, recording what was sent; multipart bodies are read back. */
function discord(...answers: Response[]) {
  const sent: Sent[] = [];
  const slept: number[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    let body: unknown = null;
    const files: Sent['files'] = [];
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await request.formData();
      body = JSON.parse(form.get('payload_json') as string);
      for (const [name, value] of form) if (typeof value !== 'string') files.push({ name, filename: value.name, type: value.type, size: value.size });
    } else if (init?.body) {
      body = JSON.parse(init.body as string);
    }
    sent.push({ method: request.method, url: request.url, body, files });
    return answers.shift() ?? new Response(null, { status: 204 });
  }) as typeof globalThis.fetch;
  return { api: discordApi(APP, { fetch, sleep: async (ms) => void slept.push(ms) }), sent, slept };
}

const WEBHOOK = `${DISCORD_API}/webhooks/${APP}/tok`;

describe('the Discord webhook client', () => {
  it('edits the deferred reply with text, never pinging anyone', async () => {
    // #given
    const d = discord();
    // #when
    await d.api.editOriginal('tok', 'Drawing your callsign… ▮▮▮');
    // #then
    expect(d.sent).toEqual([{ method: 'PATCH', url: `${WEBHOOK}/messages/@original`, body: { content: 'Drawing your callsign… ▮▮▮', allowed_mentions: { parse: [] }, attachments: [] }, files: [] }]);
  });

  it('edits in an image as multipart: payload_json naming attachment 0, and files[0]', async () => {
    // #given
    const d = discord();
    // #when
    await d.api.editOriginal('tok', 'painting-space-prophecy', { name: 'marine-7.gif', type: 'image/gif', bytes: new Uint8Array(12) });
    // #then
    expect(d.sent).toEqual([
      {
        method: 'PATCH',
        url: `${WEBHOOK}/messages/@original`,
        body: { content: 'painting-space-prophecy', allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: 'marine-7.gif' }] },
        files: [{ name: 'files[0]', filename: 'marine-7.gif', type: 'image/gif', size: 12 }],
      },
    ]);
  });

  it("answers privately by deleting the loading message first, since Discord would edit it instead and ignore the flag", async () => {
    // #given
    const d = discord();
    // #when
    await d.api.privateFollowup('tok', 'No chain called \'x\' on CCIP.');
    // #then
    expect(d.sent.map((s) => [s.method, s.url, s.body])).toEqual([
      ['DELETE', `${WEBHOOK}/messages/@original`, null],
      ['POST', WEBHOOK, { content: "No chain called 'x' on CCIP.", flags: 64, allowed_mentions: { parse: [] } }],
    ]);
  });

  it("waits out a 429's retry_after once, at most 10 s, sending the whole message again; a second 429 fails", async () => {
    // #given
    const limited = (seconds: number) => new Response(JSON.stringify({ retry_after: seconds, global: false }), { status: 429 });
    const d = discord(limited(0.35), new Response(null, { status: 200 }), limited(60), new Response(null, { status: 200 }), limited(1), limited(1));
    // #when
    await d.api.editOriginal('tok', 'PAINTING ▮▮');
    await d.api.editOriginal('tok', 'PAINTING · SPACE ▮', { name: 'x.png', type: 'image/png', bytes: new Uint8Array(3) });
    const third = d.api.editOriginal('tok', 'again');
    // #then
    await expect(third).rejects.toThrow('Discord returned HTTP 429');
    expect({ slept: d.slept, requests: d.sent.length, resent: d.sent[3]!.files }).toEqual({ slept: [350, 10_000, 1000], requests: 6, resent: [{ name: 'files[0]', filename: 'x.png', type: 'image/png', size: 3 }] });
  });

  it('throws what Discord said when an edit fails', async () => {
    // #given an expired token
    const d = discord(new Response('{"message": "Unknown Webhook", "code": 10015}', { status: 404 }));
    // #then
    await expect(d.api.editOriginal('tok', 'x')).rejects.toThrow('Discord returned HTTP 404: {"message": "Unknown Webhook", "code": 10015}');
  });
});
