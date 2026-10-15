import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe("the Mini App's @BotFather photo", () => {
  it('is committed as a 640×360 PNG', () => {
    // #given
    const png = readFileSync(join(import.meta.dirname, '..', 'public', 'marines-app-640x360.png'));
    // #then
    expect({ signature: [...png.subarray(0, 4)], width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ signature: [137, 80, 78, 71], width: 640, height: 360 });
  });
});
