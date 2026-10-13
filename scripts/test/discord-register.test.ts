import { describe, expect, it } from 'vitest';
import { parseRegisterArgs, registerRequest } from '../discord/commands';

const APP = '1200000000000000002';
const SERVER = '1100000000000000001';
const NAMES = ['enlist', 'dogtag', 'cciptoday', 'ccipchain', 'linkreserve', 'cciprecords'];
const bodyOf = (init: RequestInit) => JSON.parse(init.body as string) as { name: string; integration_types: number[]; contexts: number[]; options?: { name: string; type: number; required: boolean; autocomplete?: boolean; max_length?: number }[] }[];

describe('command registration', () => {
  it('by default overwrites the global commands with a bot-token PUT of the six commands', () => {
    // #when
    const { url, init } = registerRequest(APP, {}, 'secret');
    const commands = bodyOf(init);
    // #then
    expect({ url, method: init.method, headers: init.headers, names: commands.map((c) => c.name), chain: commands[3]!.options, marine: commands[1]!.options }).toEqual({
      url: `https://discord.com/api/v10/applications/${APP}/commands`,
      method: 'PUT',
      headers: { authorization: 'Bot secret', 'content-type': 'application/json' },
      names: NAMES,
      chain: [{ type: 3, name: 'chain', description: 'The chain', required: true, autocomplete: true, max_length: 64 }],
      marine: [{ type: 6, name: 'marine', description: 'Whose tags (yours if left out)', required: false }],
    });
  });

  it('sends every command as server-install and server-channel only', () => {
    // #when
    const commands = bodyOf(registerRequest(APP, {}, 'secret').init);
    // #then
    expect(commands.map((c) => [c.integration_types, c.contexts])).toEqual(NAMES.map(() => [[0], [0]]));
  });

  it('with a server puts the six commands to that server only', () => {
    // #when
    const { url, init } = registerRequest(APP, { guild: SERVER }, 'secret');
    // #then
    expect({ url, method: init.method, names: bodyOf(init).map((c) => c.name) }).toEqual({ url: `https://discord.com/api/v10/applications/${APP}/guilds/${SERVER}/commands`, method: 'PUT', names: NAMES });
  });

  it("with clearGuild puts an empty list, which removes that server's own copies", () => {
    // #when
    const { url, init } = registerRequest(APP, { clearGuild: SERVER }, 'secret');
    // #then
    expect({ url, method: init.method, body: init.body }).toEqual({ url: `https://discord.com/api/v10/applications/${APP}/guilds/${SERVER}/commands`, method: 'PUT', body: '[]' });
  });

  it('puts the token only in the Authorization header', () => {
    // #when
    const requests = [{}, { guild: SERVER }, { clearGuild: SERVER }].map((target) => registerRequest(APP, target, 'tok-123456'));
    // #then
    expect(requests.map(({ url, init }) => [url, init.body].join(' ').includes('tok-123456'))).toEqual([false, false, false]);
  });

  it('refuses a server id that is not 17 to 20 digits', () => {
    // #then
    for (const bad of ['', '123', 'abc', '1100000000000000001x', '123456789012345678901', '../x']) {
      expect(() => registerRequest(APP, { guild: bad }, 'secret')).toThrow('server id');
      expect(() => registerRequest(APP, { clearGuild: bad }, 'secret')).toThrow('server id');
    }
  });
});

describe('register arguments', () => {
  it('registers globally with no flag', () => {
    // #then
    expect(parseRegisterArgs([])).toEqual({});
  });

  it('reads --guild and --clear-guild with their server ids', () => {
    // #then
    expect([parseRegisterArgs(['--guild', SERVER]), parseRegisterArgs(['--clear-guild', SERVER])]).toEqual([{ guild: SERVER }, { clearGuild: SERVER }]);
  });

  it('refuses a flag without a valid id, both flags together, and anything unknown', () => {
    // #then
    expect(() => parseRegisterArgs(['--guild'])).toThrow('--guild needs a server id');
    expect(() => parseRegisterArgs(['--clear-guild', 'nope'])).toThrow('server id');
    expect(() => parseRegisterArgs(['--guild', SERVER, '--clear-guild', SERVER])).toThrow('one of');
    expect(() => parseRegisterArgs(['--nope'])).toThrow('Unknown argument --nope');
  });
});
