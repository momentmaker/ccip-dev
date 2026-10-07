import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { StoryCounter } from '../src/replay/director/story';
import { linearWarp } from '../src/replay/director/warp';

const days = ['2024-01-01', '2024-01-02'];
const history = [
  { day: '2024-01-01', messages: 10, usd_value: 1000 },
  { day: '2024-01-02', messages: 30, usd_value: 3000 },
];
const replay = {
  chains: [
    { selector: 'A', name: 'a', display_name: 'A', first_day: '2024-01-01' },
    { selector: 'B', name: 'b', display_name: 'B', first_day: '2024-01-02' },
    { selector: 'C', name: 'c', display_name: 'C', first_day: '2024-01-02' },
  ],
  lanes: [[0, 1], [2, 0], [1, 2], [0, 0]],
  days: [
    { day: '2024-01-01', lanes: [[3, 4, 40]] },
    { day: '2024-01-02', lanes: [[0, 5, 500], [1, 6, 600], [2, 7, 700]] },
  ],
} as unknown as ReplayFile;
const warp = linearWarp(2, 2, 4);

describe('StoryCounter', () => {
  it('counts the whole network, interpolated within the day', () => {
    const at = new StoryCounter(days, history, replay, null).at(3.5, warp);
    expect(at).toEqual({ usd: 1000 + 3000 * 0.5, messages: 10 + 30 * 0.5, chains: 3, day: '2024-01-02', timeline: 0.75 });
  });

  it('starts at zero before the story', () => {
    expect(new StoryCounter(days, history, replay, null).at(0, warp)).toMatchObject({ usd: 0, messages: 0, timeline: 0 });
  });

  it('counts only lanes touching the focus chain, and its partners so far', () => {
    const counter = new StoryCounter(days, history, replay, 'A');
    expect(counter.at(4, warp)).toMatchObject({ usd: 40 + 500 + 600, messages: 4 + 5 + 6, chains: 2 });
    expect(counter.dailyMessages()).toEqual([4, 11]);
  });
});
