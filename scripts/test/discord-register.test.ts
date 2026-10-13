import { describe, expect, it } from 'vitest';
import { guildIdFrom, registerRequest } from '../discord/commands';

describe('command registration', () => {
  it('overwrites the guild commands with a bot-token PUT of the six commands', () => {
    // #when
    const { url, init } = registerRequest('1200000000000000002', '1100000000000000001', 'secret');
    const commands = JSON.parse(init.body as string) as { name: string; options?: { name: string; type: number; required: boolean; autocomplete?: boolean; max_length?: number }[] }[];
    // #then
    expect({ url, method: init.method, headers: init.headers, names: commands.map((c) => c.name), chain: commands[3]!.options, marine: commands[1]!.options }).toEqual({
      url: 'https://discord.com/api/v10/applications/1200000000000000002/guilds/1100000000000000001/commands',
      method: 'PUT',
      headers: { authorization: 'Bot secret', 'content-type': 'application/json' },
      names: ['enlist', 'dogtag', 'cciptoday', 'ccipchain', 'linkreserve', 'cciprecords'],
      chain: [{ type: 3, name: 'chain', description: 'The chain', required: true, autocomplete: true, max_length: 64 }],
      marine: [{ type: 6, name: 'marine', description: 'Whose tags (yours if left out)', required: false }],
    });
  });

  it("reads the server id from the Worker's config, and refuses an empty one", () => {
    // #then
    expect(guildIdFrom('name = "x"\n[vars]\nDISCORD_GUILD_ID = "1100000000000000001"\n')).toBe('1100000000000000001');
    expect(() => guildIdFrom('[vars]\nDISCORD_GUILD_ID = ""\n')).toThrow('set [vars] DISCORD_GUILD_ID to the LinkMarine server id first');
  });
});
