import { describe, expect, it } from 'vitest';
import { avatarUrl, displayName, invoker, optionValue } from '../src/interactions';
import { command } from './helpers';

const user = { id: '80351110224678912', username: 'nelly', global_name: 'Nelly', avatar: '8342729096ea3675442027381ff50dfe' };

describe('the interaction helpers', () => {
  it("names a member as the server shows them: nickname, then global name, then username", () => {
    // #then
    expect([displayName(user, { nick: 'Sgt Nelly' }), displayName(user, { nick: null }), displayName({ ...user, global_name: null }, null)]).toEqual(['Sgt Nelly', 'Nelly', 'nelly']);
  });

  it("finds the avatar: the server's, the account's, else Discord's default for the id", () => {
    // #then the default index is (id >> 22) % 6
    expect([avatarUrl(user, { avatar: 'a_1' }, '41771983423143937'), avatarUrl(user, null, '41771983423143937'), avatarUrl({ ...user, avatar: null }, null, undefined)]).toEqual([
      'https://cdn.discordapp.com/guilds/41771983423143937/users/80351110224678912/avatars/a_1.png?size=128',
      'https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png?size=128',
      `https://cdn.discordapp.com/embed/avatars/${Number((80351110224678912n >> 22n) % 6n)}.png`,
    ]);
  });

  it('reads an option and who ran the command, in a server or a DM', () => {
    // #given
    const dm = { ...command('dogtag'), member: undefined, user };
    // #then
    expect([optionValue(command('ccipchain', [{ name: 'chain', type: 3, value: 'base' }]), 'chain'), optionValue(command('dogtag'), 'marine'), invoker(dm)?.user.id, invoker(command('enlist'))?.member?.nick]).toEqual(['base', null, '80351110224678912', null]);
  });
});
