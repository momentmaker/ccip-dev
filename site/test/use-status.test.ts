import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useStatus } from '../src/components/use-status';

describe('useStatus', () => {
  it('starts with no status and no failed polls', () => {
    const Probe = () => createElement('i', null, JSON.stringify(useStatus()));
    expect(renderToString(createElement(Probe))).toBe('<i>{&quot;status&quot;:null,&quot;failures&quot;:0}</i>');
  });
});
