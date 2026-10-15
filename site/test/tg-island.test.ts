import type { MarineSummary } from '@ccip-dev/core/linkmarine';
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement, useState, type ComponentType, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mainButton, shareLink, STORY_WIDGET, storyText, storyUrl } from '../src/lib/tg';
import { MiniDocument, type MiniNode } from './fixtures/mini-dom';
import { strictTelegram } from './fixtures/strict-telegram';

const MARINE: MarineSummary = {
  serial: 5,
  callsign: 'comfy-painting-sergey',
  tags: ['comfy', 'painting', 'sergey'],
  tier: 'rare',
  percentile: 88.2,
  memes: [
    { tag: 'comfy', file: 'comfy.jpeg', count: 25 },
    { tag: 'painting', file: 'painting.jpeg', count: 1 },
    { tag: 'sergey', file: 'sergey.jpeg', count: 400 },
  ],
  volume: 1,
  cardReady: true,
};
const NEW_RECRUIT = { switch: 'on', marine: null, gate: 'ok' };
const ENLISTED = { switch: 'on', marine: MARINE, gate: 'ok' };
const DRAWN = { already: false, marine: MARINE, banner: 'rare' };

let doc: MiniDocument;
let MiniApp: ComponentType;
let Boundary: ComponentType<{ children: ReactNode }>;
let useMainButton: typeof import('../src/components/tg/use-telegram').useMainButton;
let useBackButton: typeof import('../src/components/tg/use-telegram').useBackButton;
let render: (element: ReactNode) => void;
let createRoot: typeof import('react-dom/client').createRoot;
let flushSync: typeof import('react-dom').flushSync;
const roots: Root[] = [];

beforeAll(async () => {
  doc = new MiniDocument();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLIFrameElement', class {});
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('location', { hostname: 'ccip.dev', search: '', hash: '' });
  ({ createRoot } = await import('react-dom/client'));
  ({ flushSync } = await import('react-dom'));
  ({ default: MiniApp } = await import('../src/components/tg/MiniApp'));
  ({ Boundary } = await import('../src/components/tg/Boundary'));
  ({ useMainButton, useBackButton } = await import('../src/components/tg/use-telegram'));
});

afterAll(async () => {
  await settle();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};

async function mount(element: ReactNode) {
  const container = doc.createElement('div');
  const root = createRoot(container as unknown as Element, { onCaughtError: () => undefined, onUncaughtError: (error) => uncaught.push(String(error)) });
  roots.push(root);
  flushSync(() => root.render(element));
  await settle();
  return {
    container,
    text: () => container.textContent,
    dialog: () => container.find((n) => n.attributes.role === 'dialog'),
    button: (label: string) => container.find((n) => n.nodeName === 'BUTTON' && n.textContent === label) as MiniNode,
  };
}
const uncaught: string[] = [];
beforeEach(() => uncaught.splice(0));

function stubApi(answers: { session: () => Response; enlist?: () => Response }) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/tg/session')) return answers.session();
    if (url.endsWith('/tg/enlist')) return answers.enlist?.() ?? new Response('', { status: 500 });
    if (url.endsWith('/tg/card')) return new Response('', { status: 202 });
    if (url.endsWith('/roster.json')) return Response.json(ROSTER_FIXTURE);
    return new Response('nope', { status: 404 });
  });
}
const json = (body: unknown) => () => Response.json(body);

async function launch(tg: ReturnType<typeof strictTelegram>) {
  vi.stubGlobal('Telegram', { WebApp: tg.app });
  return mount(createElement(MiniApp));
}

describe('the Mini App under React, against a Telegram that is as strict as the real one', () => {
  it('opens on the welcome screen with ENLIST set, and does not unmount', async () => {
    // #given
    const tg = strictTelegram();
    stubApi({ session: json(NEW_RECRUIT) });
    // #when
    const app = await launch(tg);
    // #then
    expect({ welcome: app.text().includes('Enlist, Marine.'), main: [tg.main.text, tg.main.visible, tg.main.active], back: tg.back.visible, uncaught }).toEqual({ welcome: true, main: ['ENLIST', true, true], back: false, uncaught: [] });
  });

  it('opens with the bottom button hidden, not blank, while LinkMarines on Telegram is off', async () => {
    // #given
    const tg = strictTelegram();
    stubApi({ session: json({ switch: 'off' }) });
    // #when
    const app = await launch(tg);
    // #then
    expect({ opensSoon: app.text().includes('LinkMarines on Telegram opens soon'), visible: tg.main.visible, blankTexts: tg.sent.filter((p) => p.text !== undefined && p.text.trim() === ''), uncaught }).toEqual({
      opensSoon: true,
      visible: false,
      blankTexts: [],
      uncaught: [],
    });
  });

  it('draws when ENLIST is tapped, with the bottom button held and no way back', async () => {
    // #given
    const tg = strictTelegram();
    stubApi({ session: json(NEW_RECRUIT), enlist: json(DRAWN) });
    const app = await launch(tg);
    // #when
    tg.clickMain();
    await settle();
    // #then
    expect({ drawing: app.text().includes('Drawing your callsign…'), main: [tg.main.text, tg.main.active], back: tg.back.visible, uncaught }).toEqual({ drawing: true, main: ['DRAWING…', false], back: false, uncaught: [] });
  });

  it('locks the hexes with a haptic tap each, then lands on your dog tag, whose bottom button shares the story', async () => {
    // #given
    const tg = strictTelegram();
    stubApi({ session: json(NEW_RECRUIT), enlist: json(DRAWN) });
    const app = await launch(tg);
    tg.clickMain();
    await settle();
    // #when
    await vi.advanceTimersByTimeAsync(3 * 800 + 1_400);
    await settle();
    // #then
    expect({ dogTag: app.text().includes('Stamping your dog tag…'), haptics: tg.haptics, main: [tg.main.text, tg.main.visible], back: tg.back.visible, uncaught }).toEqual({
      dogTag: true,
      haptics: ['impact:medium', 'impact:medium', 'impact:medium', 'notify:success'],
      main: ['SHARE TO STORY', true],
      back: false,
      uncaught: [],
    });
  });

  it('closes another Marine’s sheet when you enlist, so it never covers the draw or your own dog tag', async () => {
    // #given
    const tg = strictTelegram('8.0', 'marine_2');
    stubApi({ session: json(NEW_RECRUIT), enlist: json(DRAWN) });
    const app = await launch(tg);
    const opened = app.dialog() !== null;
    // #when
    tg.clickMain();
    await settle();
    const overTheDraw = app.dialog();
    await vi.advanceTimersByTimeAsync(3 * 800 + 1_400);
    await settle();
    // #then
    expect({ opened, overTheDraw, overTheDogTag: app.dialog(), uncaught }).toEqual({ opened: true, overTheDraw: null, overTheDogTag: null, uncaught: [] });
  });

  it('puts focus on a sheet’s close button when it opens, and closes it from there', async () => {
    // #given
    const tg = strictTelegram('8.0', 'marine_2');
    stubApi({ session: json(NEW_RECRUIT) });
    // #when
    const app = await launch(tg);
    const focused = doc.activeElement?.attributes['aria-label'];
    const modal = app.dialog()?.attributes['aria-modal'];
    app.button('✕').press();
    await settle();
    // #then
    expect({ focused, modal, afterClose: app.dialog() }).toEqual({ focused: 'Close', modal: 'true', afterClose: null });
  });

  it('brings MY DOG TAG back to the dog tag already in the stack, so going back and forth never grows it', async () => {
    // #given
    const tg = strictTelegram();
    stubApi({ session: json(ENLISTED) });
    const app = await launch(tg);
    app.button('🪖 See the roster').press();
    await settle();
    const onRoster = { main: tg.main.text, back: tg.back.visible };
    // #when
    tg.clickMain();
    await settle();
    // #then
    expect({ onRoster, dogTag: app.text().includes('Stamping your dog tag…'), back: tg.back.visible, uncaught }).toEqual({ onRoster: { main: 'MY DOG TAG', back: true }, dogTag: true, back: false, uncaught: [] });
  });

  it('shares the Story card from Telegram’s phone apps, with the card, the line and the Enlist link', async () => {
    // #given
    const tg = strictTelegram('7.8');
    stubApi({ session: json(ENLISTED) });
    await launch(tg);
    // #when
    tg.clickMain();
    // #then
    expect({ stories: tg.stories, opened: tg.opened }).toEqual({ stories: [{ mediaUrl: storyUrl(MARINE.serial), params: { text: storyText(MARINE), widget_link: STORY_WIDGET } }], opened: [] });
  });

  it('opens the share sheet instead in Telegram Desktop, which has no stories', async () => {
    // #given
    const tg = strictTelegram('8.0', undefined, 'tdesktop');
    stubApi({ session: json(ENLISTED) });
    await launch(tg);
    // #when
    tg.clickMain();
    // #then
    expect({ stories: tg.stories, opened: tg.opened }).toEqual({ stories: [], opened: [shareLink(MARINE)] });
  });

  it('says on the welcome screen that the enlist did not go through, and clears it when you try again', async () => {
    // #given
    const tg = strictTelegram();
    stubApi({ session: json(NEW_RECRUIT) });
    const app = await launch(tg);
    // #when
    tg.clickMain();
    await settle();
    const failed = app.text().includes("Couldn't enlist just now. Try again.");
    stubApi({ session: json(NEW_RECRUIT), enlist: json(DRAWN) });
    tg.clickMain();
    await settle();
    // #then
    expect({ failed, cleared: !app.text().includes("Couldn't enlist"), uncaught }).toEqual({ failed: true, cleared: true, uncaught: [] });
  });

  it('says on the welcome screen that LinkMarines is out of reach when Check again fails', async () => {
    // #given
    const tg = strictTelegram();
    stubApi({ session: json({ switch: 'on', marine: null, gate: 'join' }) });
    const app = await launch(tg);
    stubApi({ session: () => new Response('', { status: 503 }) });
    // #when
    app.button('Check again').press();
    await settle();
    // #then
    expect(app.text()).toContain('LinkMarines is out of reach right now. Try again in a minute.');
  });

  it('keeps the out-of-reach line instead of a blank app when Telegram’s script throws', async () => {
    // #given
    const tg = strictTelegram();
    tg.app.MainButton.setParams = () => {
      throw new Error('WebAppBottomButtonParamInvalid');
    };
    stubApi({ session: json(NEW_RECRUIT) });
    // #when
    const app = await launch(tg);
    // #then
    expect(app.text()).toContain('LinkMarines is out of reach right now. Close the app and open it again in a minute.');
  });
});

describe('the boundary', () => {
  function Boom(): never {
    throw new Error('boom');
  }

  it('shows its children while they render', async () => {
    // #when
    const app = await mount(createElement(Boundary, null, createElement('p', null, 'all well')));
    // #then
    expect(app.text()).toBe('all well');
  });

  it('shows the out-of-reach line, and warns once, when a child throws', async () => {
    // #when
    const app = await mount(createElement(Boundary, null, createElement('p', null, 'all well'), createElement(Boom)));
    // #then
    expect({ text: app.text(), warnings: vi.mocked(console.warn).mock.calls }).toEqual({ text: 'LinkMarines is out of reach right now. Close the app and open it again in a minute.', warnings: [['boom']] });
  });

  it('hides Telegram’s bottom button and back button when a child throws, so neither is left on screen with no handler', async () => {
    // #given
    const tg = strictTelegram();
    let trip: () => void = () => undefined;
    function Fragile() {
      const [broken, setBroken] = useState(false);
      trip = () => setBroken(true);
      useMainButton(tg.app, mainButton('welcome', { switch: 'on', marine: null, gate: 'ok' }), () => undefined);
      useBackButton(tg.app, true, () => undefined);
      if (broken) throw new Error('boom');
      return createElement('p', null, 'all well');
    }
    await mount(createElement(Boundary, null, createElement(Fragile)));
    const shown = { main: tg.main.visible, back: tg.back.visible };
    // #when
    flushSync(() => trip());
    await settle();
    // #then
    expect({ shown, afterThrow: { main: tg.main.visible, back: tg.back.visible } }).toEqual({ shown: { main: true, back: true }, afterThrow: { main: false, back: false } });
  });
});
