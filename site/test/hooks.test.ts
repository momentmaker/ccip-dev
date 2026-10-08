import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countUpStart, countUpValue, easeOutCubic, useCountUp, usePrefersReducedMotion } from '../src/components/hooks';

describe('count-up helpers', () => {
  it('eases out and clamps', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(3)).toBe(1);
  });

  it('interpolates from the old value to the new one', () => {
    expect(countUpValue(0, 1000, 0, 900)).toBe(0);
    expect(countUpValue(100, 200, 450, 900)).toBeCloseTo(187.5);
    expect(countUpValue(0, 1000, 2000, 900)).toBe(1000);
  });
});

describe('hook first render', () => {
  const originalWindow = globalThis.window;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  });

  const render = (hook: () => unknown) => {
    const Probe = () => createElement('i', null, String(hook()));
    return renderToString(createElement(Probe));
  };

  it('useCountUp paints the target itself first, not zero', () => {
    expect(render(() => useCountUp(1234, true))).toBe('<i>1234</i>');
  });

  it('countUpStart seeds the first run from the target and later runs from what is shown', () => {
    expect(countUpStart(null, 500)).toBe(500);
    expect(countUpStart(120, 500)).toBe(120);
  });

  it('usePrefersReducedMotion starts false on the client too, so it matches the server markup', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
    expect(render(() => usePrefersReducedMotion())).toBe('<i>false</i>');
  });
});
