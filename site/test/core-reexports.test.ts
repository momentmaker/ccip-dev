import * as coreFormat from '@ccip-dev/core/format';
import * as coreNames from '@ccip-dev/core/names';
import * as coreRecords from '@ccip-dev/core/records';
import { describe, expect, it } from 'vitest';
import * as format from '../src/lib/format';
import * as names from '../src/lib/names';
import * as records from '../src/lib/records';

describe('site re-exports of the core modules', () => {
  it('serves the very functions core exports, so posts and pages format alike', () => {
    // #when
    const same = [format.formatUsd === coreFormat.formatUsd, names.laneLabel === coreNames.laneLabel, records.computeRecords === coreRecords.computeRecords];
    // #then
    expect(same).toEqual([true, true, true]);
  });
});
