import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChainPicker from '../src/components/controls/ChainPicker';

const runtime = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0 }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => [runtime.cursor in runtime.state ? runtime.state[runtime.cursor++] : (runtime.cursor++, initial), vi.fn()],
    useRef: (initial: unknown) => ({ current: initial }),
    useId: () => 'picker',
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => {},
  };
});

type Node = ReactElement<Record<string, unknown>>;

function find(node: unknown, match: (el: Node) => boolean): Node | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, match);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const el = node as Node;
  return match(el) ? el : find(el.props.children, match);
}

const chains = [
  { selector: 'a', name: 'Alpha', icon: null, value: 300 },
  { selector: 'b', name: 'Beta', icon: null, value: 200 },
];

function renderOpen(onChange = vi.fn()) {
  runtime.cursor = 0;
  runtime.state = [true];
  return { tree: ChainPicker({ chains, value: null, onChange }), onChange };
}

describe('ChainPicker with the list open', () => {
  beforeEach(() => {
    runtime.state = [];
  });

  it('keeps focus in the search box when the list is pressed, so the list stays open until the click lands', () => {
    // #given
    const { tree } = renderOpen();
    const listbox = find(tree, (el) => el.props.role === 'listbox')!;
    const preventDefault = vi.fn();

    // #when
    (listbox.props.onMouseDown as (e: { preventDefault: () => void }) => void)({ preventDefault });

    // #then
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('chooses the chain whose row is clicked', () => {
    // #given
    const { tree, onChange } = renderOpen();
    const beta = find(tree, (el) => el.props.role === 'option' && el.props.id === 'picker-2')!;

    // #when
    (beta.props.onClick as () => void)();

    // #then
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
