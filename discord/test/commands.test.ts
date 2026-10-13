import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/commands';
import { botHandlers } from '../src/index';
import { fakeBot } from './helpers';

describe('the commands', () => {
  it('routes every command it registers, and registers every command it routes', () => {
    // #when
    const routed = Object.keys(botHandlers(fakeBot()).commands).sort();
    // #then
    expect(routed).toEqual(COMMANDS.map((c) => c.name).sort());
  });

  it('bounds the /ccipchain argument, so a huge one cannot overflow the error reply', () => {
    // #given
    const ccipchain = COMMANDS.find((c) => c.name === 'ccipchain');
    // #then
    expect(ccipchain?.options?.[0]).toMatchObject({ name: 'chain', max_length: 64 });
  });

  it('limits every command to server installs and server channels, so no user install or DM can run one', () => {
    // #then
    expect(COMMANDS.map((c) => ({ name: c.name, integration_types: c.integration_types, contexts: c.contexts }))).toEqual(
      COMMANDS.map((c) => ({ name: c.name, integration_types: [0], contexts: [0] })),
    );
  });
});
