import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReplayCaption } from '../src/components/staking/Hive';
import type { ReplayStep } from '../src/lib/staking-view';

const STEP: ReplayStep = { openedAt: '2026-10-31T13:07:00.000Z', gap: 58, seconds: 12, blocks: 1, grabs: ['0x5474d4de11e60bfc843404dc1b5dc1aef7776dda', '0xaa'], cells: 1, holdMs: 1_200 };

/** The caption's lines as text, one per line element. */
const lines = (step: ReplayStep | undefined, phase: 'gap' | 'fill' | null) =>
  [...renderToString(createElement(ReplayCaption, { step, phase })).matchAll(/<span class="replay-line">(.*?)<\/span>(?=<span class="replay-line">|<\/p>)/g)].map((m) =>
    m[1]!.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim(),
  );

describe('the hive replay caption', () => {
  it('keeps two lines while a gap is open, so nothing under it moves', () => {
    // #when
    const open = lines(STEP, 'gap');
    // #then
    expect(open).toEqual(['Oct 31, 2026 · 58 LINK opened', 'hunters racing…']);
  });

  it('says who filled the gap on the second line once it fills', () => {
    // #when
    const filled = lines(STEP, null);
    // #then
    expect(filled).toEqual(['Oct 31, 2026 · 58 LINK opened', '→ filled in 12s (1 block) by 0x5474…6dda +1']);
  });

  it('keeps two lines when no space opened in the last week', () => {
    // #when
    const quiet = lines(undefined, null);
    // #then
    expect(quiet).toEqual(['No space opened in the last 7 days.', '']);
  });
});
