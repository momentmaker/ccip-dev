import { describe, expect, it } from 'vitest';
import { buildLabelIndex, labelKey, toChecksumAddress, validateRegistry } from '../src/labels';

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
      'ethereum-mainnet:0x514910771af9ca656af840dff83e8264ecf986ca': { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol' },
    });
    expect(index[labelKey('ethereum-mainnet', LINK)]).toBeDefined();
  });
});

describe('toChecksumAddress', () => {
  it('produces the canonical LINK checksum', () => {
    expect(toChecksumAddress(LINK.toLowerCase())).toBe(LINK);
  });
});
