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

  it('still sends the private message when the loading message is already gone', async () => {
    // #given
    const d = discord(new Response('{"message": "Unknown Message"}', { status: 404 }));
    // #when
    await d.api.privateFollowup('tok', 'Something went wrong.');
    // #then
    expect(d.sent.map((s) => s.method)).toEqual(['DELETE', 'POST']);
  });

  it('waits no longer than the time left for a 429, and not at all when none is left', async () => {
    // #given
    const limited = () => new Response(JSON.stringify({ retry_after: 10 }), { status: 429 });
    const some = discord(limited(), new Response(null, { status: 200 }));
    const none = discord(limited());
    // #when
    await some.api.editOriginal('tok', 'x', null, 2000);
    const refused = none.api.editOriginal('tok', 'x', null, 0);
    // #then
    await expect(refused).rejects.toThrow('Discord returned HTTP 429');
    expect({ slept: [some.slept, none.slept], requests: none.sent.length }).toEqual({ slept: [[2000], []], requests: 1 });
  });

  it('releases the body of a successful answer', async () => {
    // #given
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => void (cancelled = true) });
    const d = discord(new Response(body, { status: 200 }));
    // #when
    await d.api.editOriginal('tok', 'x');
    // #then
    expect(cancelled).toBe(true);
  });

  it('hands every request of one call the same abort signal, the retry included', async () => {
    // #given
    const signals: (AbortSignal | null | undefined)[] = [];
    const answers = [new Response(JSON.stringify({ retry_after: 0.1 }), { status: 429 }), new Response(null, { status: 200 })];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal);
      return answers.shift()!;
    }) as unknown as typeof fetch;
    const api = discordApi(APP, { fetch: fetchFn, sleep: async () => {} });
    // #when
    await api.editOriginal('tok', 'x', null, undefined, 5_000);
    // #then
    expect({ count: signals.length, shared: signals[0] === signals[1], isSignal: signals[0] instanceof AbortSignal }).toEqual({ count: 2, shared: true, isSignal: true });
  });

  it('does not retry a 429 that asks for longer than the budget has left', async () => {
    // #given a 2 s budget and a 10 s ask, on a clock that sleeping moves
    const clock = { ms: 0 };
    const sent: number[] = [];
    const fetchFn = (async () => {
      sent.push(clock.ms);
      return new Response(JSON.stringify({ retry_after: 10 }), { status: 429 });
    }) as unknown as typeof fetch;
    const api = discordApi(APP, { fetch: fetchFn, sleep: async (ms) => void (clock.ms += ms), now: () => clock.ms });
    // #when
    const result = api.editOriginal('tok', 'x', null, undefined, 2_000);
    // #then
    await expect(result).rejects.toThrow('Discord returned HTTP 429');
    expect({ sent, ended: clock.ms }).toEqual({ sent: [0], ended: 0 });
  });

  it('retries within the budget when the first attempt was slow but the wait still fits', async () => {
    // #given a 10 s budget, a first attempt taking 4 s, and a 3 s ask
    const clock = { ms: 0 };
    const sent: number[] = [];
    const answers = [new Response(JSON.stringify({ retry_after: 3 }), { status: 429 }), new Response(null, { status: 200 })];
    const fetchFn = (async () => {
      sent.push(clock.ms);
      if (sent.length === 1) clock.ms += 4_000;
      return answers.shift()!;
    }) as unknown as typeof fetch;
    const api = discordApi(APP, { fetch: fetchFn, sleep: async (ms) => void (clock.ms += ms), now: () => clock.ms });
    // #when
    await api.editOriginal('tok', 'x', null, undefined, 10_000);
    // #then
    expect({ sent, ended: clock.ms }).toEqual({ sent: [0, 7_000], ended: 7_000 });
  });

  it('keeps a private reply inside its budget: the delete gets at most half, the reply what is left', async () => {
    // #given a 4 s budget, and Discord asking for 2 s on the delete and 3 s on the reply
    const clock = { ms: 0 };
    const sent: string[] = [];
    const slept: number[] = [];
    const answers = [429, 429, 200].map((status, i) => (status === 429 ? new Response(JSON.stringify({ retry_after: i === 0 ? 2 : 3 }), { status }) : new Response(null, { status })));
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.method));
      return answers.shift()!;
    }) as unknown as typeof fetch;
    const api = discordApi(APP, { fetch: fetchFn, sleep: async (ms) => void (slept.push(ms), (clock.ms += ms)), now: () => clock.ms });
    // #when
    await api.privateFollowup('tok', 'x', 4_000);
    // #then the delete's 2 s did not fit its 2 s half; the reply's 3 s fit the 4 s left
    expect({ sent, slept }).toEqual({ sent: ['DELETE', 'POST', 'POST'], slept: [3_000] });
  });

  it('abandons a hung private reply when its budget runs out', async () => {
    // #given a Discord that answers nothing until the request is aborted
    const hanging = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    const api = discordApi(APP, { fetch: hanging, sleep: async () => {} });
    const started = Date.now();
    // #when
    const replying = api.privateFollowup('tok', 'x', 100);
    // #then
    await expect(replying).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
