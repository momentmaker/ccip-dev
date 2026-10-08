import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReserveVault from '../src/components/ReserveVault';

const runtime = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = runtime.cursor++;
      if (!(slot in runtime.slots)) runtime.slots[slot] = initial;
      return [
        runtime.slots[slot],
        (next: unknown) => {
          runtime.slots[slot] = next;
        },
      ];
    },
    useEffect: (effect: () => void | (() => void)) => {
      runtime.effects.push(effect);
    },
  };
});

const FRACTION = 0.87;
const props = { link: 87, target: 100, fraction: FRACTION, coins: 3 };
const LEVEL_SLOT = 2;

const render = () => {
  runtime.cursor = 0;
  runtime.effects = [];
  ReserveVault(props);
};
const runEffects = () => {
  for (const effect of runtime.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') runtime.cleanups.push(cleanup);
  }
};
const cleanUp = () => {
  for (const cleanup of runtime.cleanups.splice(0)) cleanup();
};

describe('ReserveVault level with reduced motion', () => {
  let frames: Map<number, () => void>;

  beforeEach(() => {
    runtime.slots = [];
    runtime.cleanups = [];
    frames = new Map();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      frames.set(nextId, callback);
      return nextId++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    });
  });

  it('ends at the full fraction once the preference resolves to reduced', () => {
    render();
    runEffects();
    cleanUp();
    render();
    runEffects();
    for (const frame of [...frames.values()]) frame();
    expect(runtime.slots[LEVEL_SLOT]).toBe(FRACTION);
  });
});
