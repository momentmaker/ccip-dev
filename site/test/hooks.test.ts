import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countUpPlan, countUpValue, easeOutCubic, useCountUp, useMotionPreference, usePrefersReducedMotion } from '../src/components/hooks';

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

  it('countUpPlan waits until the motion preference is known', () => {
    expect(countUpPlan(null, 500, null)).toEqual({ kind: 'wait' });
  });

  it('countUpPlan runs the first animation from just under the target, so the jump from the server value is slight', () => {
    expect(countUpPlan(null, 1000, true)).toEqual({ kind: 'animate', from: 880 });
  });

  it('countUpPlan starts later animations from what is shown', () => {
    expect(countUpPlan(120, 500, true)).toEqual({ kind: 'animate', from: 120 });
  });

  it('countUpPlan snaps when motion is reduced, or nothing changed', () => {
    expect(countUpPlan(null, 500, false)).toEqual({ kind: 'set' });
    expect(countUpPlan(120, 500, false)).toEqual({ kind: 'set' });
    expect(countUpPlan(500, 500, true)).toEqual({ kind: 'set' });
  });

  it('useMotionPreference is unresolved on the first render', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
    expect(render(() => useMotionPreference())).toBe('<i>null</i>');
  });

  it('usePrefersReducedMotion starts false on the client too, so it matches the server markup', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
    expect(render(() => usePrefersReducedMotion())).toBe('<i>false</i>');
  });
});
