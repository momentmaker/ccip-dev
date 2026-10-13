import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';

export const GUILD = '1100000000000000001';
export const APP = '1200000000000000002';

/** A slash command run in the LinkMarine server by momentmaker. */
export function command(name: string, options: CommandOption[] = [], extra: Partial<Interaction> = {}): Interaction {
  return {
    id: '1300000000000000003',
    type: 2,
    token: 'tok',
    application_id: APP,
    guild_id: GUILD,
    member: { user: { id: '1400000000000000004', username: 'momentmaker', global_name: 'moment maker', avatar: 'abc' }, nick: null, avatar: null },
    data: { name, options },
    ...extra,
  };
}

const TAGS = [
  { tag: 'sergey', count: 400, memes: ['s1.jpeg', 's2.jpeg', 's3.png'] },
  { tag: 'pepe', count: 100, memes: ['p1.jpeg', 'shared.gif'] },
  { tag: 'comfy', count: 25, memes: ['c1.png'] },
  { tag: 'painting', count: 1, memes: ['shared.gif'] },
  { tag: 'space', count: 1, memes: ['sp1.jpeg'] },
  { tag: 'prophecy', count: 3, memes: ['pr1.jpg', 'pr2.jpeg', 'pr3.png'] },
];

/** A six-tag snapshot, simulated as the real one is, with fewer draws. */
export const SNAPSHOT: CallsignSnapshot = {
  version: 3,
  archive: { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee' },
  tags: TAGS,
  lore: { blood: [{ text: 'LINK+', weight: 3 }, { text: 'O-LINK', weight: 1 }], faith: [{ text: '4IR', weight: 1 }] },
  ...simulate(TAGS, 20_000, 1),
};
