import { describe, expect, it } from 'vitest';
import { buildHandles, buildLabelIndex, buildProjectRegistry, buildTokenLabels, labelKey, toChecksumAddress, validateChainHandles, validateRegistry } from '../src/labels';

const chains = new Set(['ethereum-mainnet', 'ethereum-mainnet-base-1']);
const LINK = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
const project = (address: string, extra = '') =>
  `name = "Maple Finance"\nx = "maplefinance"\nkind = "protocol"\nverified = true\n${extra}\n[[addresses]]\nchain = "ethereum-mainnet"\naddress = "${address}"\nnote = "test"\n`;

describe('validateRegistry', () => {
  it('accepts a valid project', () => {
    expect(validateRegistry([{ file: 'maple.toml', text: project(LINK) }], chains)).toMatchObject({ errors: [] });
  });

  it('rejects an unknown chain', () => {
    const text = project(LINK).replace('"ethereum-mainnet"', '"not-a-chain"');
    expect(validateRegistry([{ file: 'x.toml', text }], chains).errors).toEqual(['x.toml: unknown CCIP chain "not-a-chain"']);
  });

  it('rejects a wrong EIP-55 checksum but accepts all-lowercase', () => {
    const wrong = '0x514910771aF9Ca656af840dff83E8264EcF986CA';
    expect(validateRegistry([{ file: 'x.toml', text: project(wrong) }], chains).errors).toEqual([
      `x.toml: bad EIP-55 checksum for ${wrong}`,
    ]);
    expect(validateRegistry([{ file: 'x.toml', text: project(LINK.toLowerCase()) }], chains).errors).toEqual([]);
  });

  it('rejects the same address labeled in two files', () => {
    const files = [
      { file: 'a.toml', text: project(LINK) },
      { file: 'b.toml', text: project(LINK.toLowerCase()) },
    ];
    expect(validateRegistry(files, chains).errors).toEqual([`b.toml: ethereum-mainnet ${LINK.toLowerCase()} is already labeled in a.toml`]);
  });

  it('reports invalid TOML and schema errors with the file name', () => {
    expect(validateRegistry([{ file: 'bad.toml', text: 'name = ' }], chains).errors[0]).toMatch(/^bad\.toml: invalid TOML/);
    expect(validateRegistry([{ file: 's.toml', text: 'name = "x"\nkind = "protocol"' }], chains).errors[0]).toMatch(/^s\.toml: verified/);
  });
});

describe('buildLabelIndex', () => {
  it('indexes only verified projects under a lowercase key that matches stored message addresses', () => {
    const draft = project('0x1111111111111111111111111111111111111111').replace('verified = true', 'verified = false');
    const { projects } = validateRegistry(
      [
        { file: 'maple.toml', text: project(LINK) },
        { file: '_candidate.toml', text: draft },
      ],
      chains,
    );
    const index = buildLabelIndex(projects);
    expect(index).toEqual({
      'ethereum-mainnet:0x514910771af9ca656af840dff83e8264ecf986ca': { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol', slug: 'maple' },
    });
    expect(index[labelKey('ethereum-mainnet', LINK)]).toBeDefined();
  });
});

describe('toChecksumAddress', () => {
  it('produces the canonical LINK checksum', () => {
    expect(toChecksumAddress(LINK.toLowerCase())).toBe(LINK);
  });
});

describe('token entries', () => {
  const SYRUP = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
  const withToken = (source: string, address = SYRUP, chain = 'ethereum-mainnet') =>
    `${project(LINK)}\n[[tokens]]\nchain = "${chain}"\naddress = "${address}"\nsource = "${source}"\n`;

  it('accepts a token with an https source', () => {
    // #when
    const { errors, projects } = validateRegistry([{ file: 'maple.toml', text: withToken('https://docs.maple.finance/syrup') }], chains);
    // #then
    expect({ errors, tokens: projects[0]?.tokens }).toEqual({ errors: [], tokens: [{ chain: 'ethereum-mainnet', address: SYRUP, source: 'https://docs.maple.finance/syrup' }] });
  });

  it('rejects a token without an https source, on an unknown chain, or claimed by two projects', () => {
    // #when
    const http = validateRegistry([{ file: 'a.toml', text: withToken('http://maple.finance') }], chains).errors;
    const unknown = validateRegistry([{ file: 'b.toml', text: withToken('https://maple.finance', SYRUP, 'not-a-chain') }], chains).errors;
    const twice = validateRegistry(
      [
        { file: 'c.toml', text: withToken('https://maple.finance') },
        { file: 'd.toml', text: withToken('https://maple.finance', toChecksumAddress(SYRUP)).replace(LINK, '0x1111111111111111111111111111111111111111') },
      ],
      chains,
    ).errors;
    // #then the second claim is caught whatever the address's letter case
    expect({ http, unknown, twice }).toEqual({
      http: ['a.toml: tokens.0.source: must be an https URL'],
      unknown: ['b.toml: unknown CCIP chain "not-a-chain" for a token'],
      twice: [`d.toml: token ethereum-mainnet ${SYRUP} already belongs to c.toml`],
    });
  });
});

describe('validateChainHandles', () => {
  it('accepts handles with an https source on known chains', () => {
    // #when
    const result = validateChainHandles('{"ethereum-mainnet":{"x":"ethereum","source":"https://ethereum.org"}}', chains);
    // #then
    expect(result).toEqual({ handles: { 'ethereum-mainnet': { x: 'ethereum', source: 'https://ethereum.org' } }, errors: [] });
  });

  it('names the file and the problem for an unknown chain, a bad handle, a non-https source and broken JSON', () => {
    // #when
    const unknown = validateChainHandles('{"mars-mainnet":{"x":"mars","source":"https://mars.io"}}', chains).errors;
    const handle = validateChainHandles('{"ethereum-mainnet":{"x":"@ethereum","source":"https://ethereum.org"}}', chains).errors;
    const source = validateChainHandles('{"ethereum-mainnet":{"x":"ethereum","source":"http://ethereum.org"}}', chains).errors;
    const json = validateChainHandles('{', chains).errors;
    // #then
    expect({ unknown, handle, source, json: json.map((e) => e.startsWith('labels/chain-x.json: invalid JSON: ')) }).toEqual({
      unknown: ['labels/chain-x.json: unknown CCIP chain "mars-mainnet"'],
      handle: ['labels/chain-x.json: ethereum-mainnet.x: Invalid string: must match pattern /^[A-Za-z0-9_]{1,15}$/'],
      source: ['labels/chain-x.json: ethereum-mainnet.source: must be an https URL'],
      json: [true],
    });
  });
});

describe('buildHandles', () => {
  it('maps chains to handles and keeps tokens of verified projects with a handle, lowercased', () => {
    // #given a verified project with a checksummed token address, and a draft with a token
    const MIXED = toChecksumAddress('0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b');
    const token = (verified: boolean, address: string) =>
      `name = "Maple"\nx = "maplefinance"\nkind = "issuer"\nverified = ${verified}\n\n[[tokens]]\nchain = "ethereum-mainnet"\naddress = "${address}"\nsource = "https://maple.finance"\n`;
    const { projects } = validateRegistry([{ file: 'maple.toml', text: token(true, MIXED) }, { file: '_draft.toml', text: token(false, '0x2222222222222222222222222222222222222222') }], chains);
    // #when
    const handles = buildHandles(projects, { 'ethereum-mainnet-base-1': { x: 'base', source: 'https://base.org' } });
    // #then
    expect(handles).toEqual({
      chains: { 'ethereum-mainnet-base-1': 'base' },
      tokens: [{ chain: 'ethereum-mainnet', address: MIXED.toLowerCase(), project: 'Maple', x: 'maplefinance' }],
    });
  });
});

describe('slugs, sources and spread', () => {
  const XBRIDGE = '0x9ec0e4a4c411493773e01e2abf4d42395788846b';
  const xstocks = (extra = '') =>
    `name = "xStocks"\nx = "xStocksFi"\nkind = "protocol"\nverified = true\n${extra}\n` +
    `# Source: https://api.xstocks.fi/api/v2/public/bridges (the xBridge)\n[[addresses]]\nchain = "ethereum-mainnet"\naddress = "${XBRIDGE}"\n`;

  it('names a project by its file, keeps its first source line, and spreads by default', () => {
    // #when
    const { projects } = validateRegistry([{ file: 'labels/projects/xstocks.toml', text: xstocks() }], chains);
    // #then
    expect(projects.map((p) => [p.slug, p.source, p.spread])).toEqual([['xstocks', 'https://api.xstocks.fi/api/v2/public/bridges (the xBridge)', true]]);
  });

  it('refuses a verified project whose file name is not a slug', () => {
    // #when
    const { errors } = validateRegistry([{ file: 'labels/projects/xStocks.toml', text: xstocks() }], chains);
    // #then
    expect(errors).toEqual(['labels/projects/xStocks.toml: a verified project needs a file name of lowercase letters, digits and dashes']);
  });

  it('indexes the slug, and writes spread = false only for a project that turns spreading off', () => {
    // #given
    const { projects } = validateRegistry([{ file: 'xstocks.toml', text: xstocks('spread = false') }, { file: 'maple.toml', text: project(LINK) }], chains);
    // #when
    const index = buildLabelIndex(projects);
    // #then
    expect(index).toEqual({
      [`ethereum-mainnet:${XBRIDGE}`]: { name: 'xStocks', x: 'xStocksFi', kind: 'protocol', slug: 'xstocks', spread: false },
      [`ethereum-mainnet:${LINK.toLowerCase()}`]: { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol', slug: 'maple' },
    });
  });
});

describe('buildProjectRegistry', () => {
  it('keeps each verified project by slug, with its link, source and lowercased addresses, and leaves drafts out', () => {
    // #given
    const draft = project('0x1111111111111111111111111111111111111111').replace('verified = true', 'verified = false');
    const { projects } = validateRegistry([{ file: 'maple.toml', text: project(LINK) }, { file: '_draft.toml', text: draft }], chains);
    // #when
    const registry = buildProjectRegistry(projects);
    // #then
    expect(registry).toEqual({
      maple: { name: 'Maple Finance', x: 'maplefinance', url: null, kind: 'protocol', source: null, addresses: [{ chain: 'ethereum-mainnet', address: LINK.toLowerCase(), note: 'test' }], tokens: [] },
    });
  });
});

describe('token labels', () => {
  const SYRUP = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
  const OTHER = '0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d';
  const tokenFile = (address: string, extra: string) =>
    `name = "Maple Finance"\nkind = "issuer"\n${extra}\n[[tokens]]\nchain = "ethereum-mainnet"\naddress = "${address}"\nsource = "https://docs.maple.finance/integrate"\n`;

  it("maps each verified project's tokens to its slug, with or without an x, and leaves drafts out", () => {
    // #given Maple has no x; the draft has one but is not verified
    const { projects } = validateRegistry(
      [{ file: 'maple.toml', text: tokenFile(SYRUP, 'verified = true') }, { file: '_draft.toml', text: tokenFile(OTHER, 'x = "draft"\nverified = false') }],
      chains,
    );
    // #then
    expect(buildTokenLabels(projects)).toEqual({ [`ethereum-mainnet:${SYRUP}`]: 'maple' });
  });

  it("carries each verified project's tokens in the registry, for its page", () => {
    // #given
    const { projects } = validateRegistry([{ file: 'maple.toml', text: tokenFile(SYRUP, 'verified = true') }], chains);
    // #then
    expect(buildProjectRegistry(projects).maple?.tokens).toEqual([{ chain: 'ethereum-mainnet', address: SYRUP, source: 'https://docs.maple.finance/integrate' }]);
  });
});
