import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement, type ComponentType } from 'react';
import type { Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniDocument, type MiniNode } from './fixtures/mini-dom';

const location = { hostname: 'ccip.dev', search: '' };
const wall = { scrollIntoView: vi.fn() };

let doc: MiniDocument;
let RosterView: ComponentType;
let createRoot: typeof import('react-dom/client').createRoot;
let flushSync: typeof import('react-dom').flushSync;
const roots: Root[] = [];

beforeAll(async () => {
  doc = new MiniDocument();
  Object.assign(doc, { getElementById: (id: string) => (id === 'wall' ? wall : null) });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLIFrameElement', class {});
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('location', location);
  vi.stubGlobal('fetch', async () => Response.json(ROSTER_FIXTURE));
  ({ createRoot } = await import('react-dom/client'));
  ({ flushSync } = await import('react-dom'));
  ({ default: RosterView } = await import('../src/components/marines/RosterView'));
});

afterAll(async () => {
  await settle();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  wall.scrollIntoView.mockClear();
});

afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};

async function openRoster(search: string) {
  location.search = search;
  const container = doc.createElement('div');
  const uncaught: string[] = [];
  const root = createRoot(container as unknown as Element, { onUncaughtError: (error) => uncaught.push(String(error)) });
  roots.push(root);
  flushSync(() => root.render(createElement(RosterView)));
  await settle();
  return {
    uncaught,
    text: () => container.textContent,
    find: (match: (node: MiniNode) => boolean) => container.find(match),
  };
}

describe('the roster page opened on ?tag=', () => {
  it('filters the wall to the tag once the roster is in, and scrolls to it', async () => {
    // #when
    const page = await openRoster('?tag=pepe');
    // #then
    expect({ filtered: page.text().includes('2 Marines carry “pepe”'), scrolled: wall.scrollIntoView.mock.calls.length, uncaught: page.uncaught }).toEqual({ filtered: true, scrolled: 1, uncaught: [] });
  });

  it('leaves the wall whole when there is no ?tag=', async () => {
    // #when
    const page = await openRoster('');
    // #then
    expect({ loaded: page.text().includes('Every dog tag.'), filtered: page.text().includes(' carry “'), scrolled: wall.scrollIntoView.mock.calls.length }).toEqual({ loaded: true, filtered: false, scrolled: 0 });
  });

  it('shows an empty wall, not a broken page, for a tag nobody carries', async () => {
    // #when
    const page = await openRoster('?tag=zzznothing');
    // #then
    expect({ filtered: page.text().includes('0 Marines carry “zzznothing”'), empty: page.text().includes('No Marine matches that.'), uncaught: page.uncaught }).toEqual({ filtered: true, empty: true, uncaught: [] });
  });

  it('ignores a ?tag= made of markup, and puts none on the page', async () => {
    // #when
    const page = await openRoster('?tag=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    // #then
    expect({
      filtered: page.text().includes(' carry “'),
      markup: page.text().includes('onerror'),
      injectedImage: page.find((n) => n.nodeName === 'IMG' && n.attributes.src === 'x') !== null,
      scrolled: wall.scrollIntoView.mock.calls.length,
      uncaught: page.uncaught,
    }).toEqual({ filtered: false, markup: false, injectedImage: false, scrolled: 0, uncaught: [] });
  });
});
