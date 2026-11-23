import { describe, expect, it } from 'vitest';
import {
  confirmArrivals,
  planPassportPosts,
  stepWireUnit,
  WIRE_UNREAD,
  type ArrivalItem,
  type ArrivingRow,
  type SettledRow,
  type WireChange,
  type WireEvent,
  type WireLog,
  type WireOutcome,
  type WireResult,
  type WireUnitState,
} from '../src/passport-wire';
import { addDays } from '../src/time';

const D = (n: number) => addDays('2026-12-01', n - 1);

const reading = (result: WireResult, extra: Partial<Extract<WireOutcome, { read: true }>> = {}): WireOutcome => ({
  read: true,
  result,
  method: 1,
  baseline: false,
  chainValuesChanged: false,
  corrected: false,
  ...extra,
});
const baseline = (result: WireResult) => reading(result, { baseline: true });
const failed: WireOutcome = { read: false };

function replay(steps: readonly (readonly [string, WireOutcome])[], from: WireUnitState = WIRE_UNREAD) {
  let state = from;
  const events: WireEvent[] = [];
  const logs: WireLog[] = [];
  for (const [day, outcome] of steps) {
    const step = stepWireUnit(state, outcome, day);
    state = step.state;
    if (step.event) events.push(step.event);
    if (step.log) logs.push(step.log);
  }
  return { state, events, logs };
}

const announcedClear = replay([[D(1), baseline('clear')]]).state;
const announcedFlagged = replay([[D(1), baseline('flagged')]]).state;

describe('stepWireUnit, one test per arrow of the state diagram', () => {
  it('Unread to Announced: a first full reading sets the baseline and makes no event (AE6)', () => {
    const { state, events } = replay([[D(1), baseline('flagged')]]);
    expect(state.announced).toBe('flagged');
    expect(state.pending).toBeNull();
    expect(events).toEqual([]);
  });

  it('Unread to Pending: a flagged result first appearing on rows read on an earlier day goes pending', () => {
    const { state, events } = replay([[D(2), reading('flagged')]]);
    expect(state.announced).toBeNull();
    expect(state.pending).toEqual({ result: 'flagged', day: D(2), correction: false });
    expect(events).toEqual([]);
  });

  it('Announced to Pending: a reading that differs from the announced result waits', () => {
    const { state, events } = replay([[D(2), reading('flagged')]], announcedClear);
    expect(state.announced).toBe('clear');
    expect(state.pending).toEqual({ result: 'flagged', day: D(2), correction: false });
    expect(events).toEqual([]);
  });

  it('Pending to Announced: the next reading on a later day agrees and raises the flag', () => {
    const { state, events } = replay(
      [
        [D(2), reading('flagged')],
        [D(3), reading('flagged')],
      ],
      announcedClear,
    );
    expect(state.announced).toBe('flagged');
    expect(state.pending).toBeNull();
    expect(events).toEqual([{ kind: 'raised', day: D(3), correction: false }]);
  });

  it('Pending to Announced: the next reading equals the announced result and drops the pending one', () => {
    const { state, events } = replay(
      [
        [D(2), reading('flagged')],
        [D(3), reading('clear')],
      ],
      announcedClear,
    );
    expect(state.announced).toBe('clear');
    expect(state.pending).toBeNull();
    expect(events).toEqual([]);
  });

  it('Pending to Pending: a reading that differs from both restarts the pending result', () => {
    const { state, events } = replay(
      [
        [D(1), baseline('not readable')],
        [D(2), reading('flagged')],
        [D(3), reading('clear')],
      ],
    );
    expect(state.announced).toBe('not readable');
    expect(state.pending).toEqual({ result: 'clear', day: D(3), correction: false });
    expect(events).toEqual([]);
  });

  it('Pending to Announced: with no reading for more than seven days the pending result is dropped', () => {
    const steps: [string, WireOutcome][] = [[D(2), reading('flagged')]];
    for (let n = 3; n <= 9; n++) steps.push([D(n), failed]);
    const kept = replay(steps, announcedClear).state;
    expect(kept.pending).toEqual({ result: 'flagged', day: D(2), correction: false });
    const { state, events } = replay([[D(10), failed]], kept);
    expect(state.announced).toBe('clear');
    expect(state.pending).toBeNull();
    expect(events).toEqual([]);
  });

  it('Announced to Announced: a different result under a new method on unchanged chain values is re-classified (AE11)', () => {
    const notReadable = replay([[D(1), baseline('not readable')]]).state;
    const { state, events, logs } = replay([[D(2), reading('clear', { method: 2 })]], notReadable);
    expect(state.announced).toBe('clear');
    expect(state.pending).toBeNull();
    expect(state.method).toBe(2);
    expect(events).toEqual([]);
    expect(logs).toEqual(['re-classified']);
  });

  it('a re-classification to not readable keeps the announced flag, so the same flag read again posts nothing', () => {
    const announcedFlagged = replay([[D(1), baseline('flagged')]]).state;
    const reclassified = replay([[D(2), reading('not readable', { method: 2 })]], announcedFlagged);
    expect(reclassified.state.announced).toBe('flagged');
    expect(reclassified.logs).toEqual(['re-classified']);
    const { events } = replay([[D(3), reading('flagged', { method: 2 })], [D(4), reading('flagged', { method: 2 })]], reclassified.state);
    expect(events).toEqual([]);
  });
});

describe('stepWireUnit scenarios', () => {
  it('AE2: clear, then flagged on day 1 waits, and flagged again on day 2 raises dated day 2', () => {
    const day1 = replay([[D(2), reading('flagged')]], announcedClear);
    expect(day1.events).toEqual([]);
    expect(day1.state.pending?.result).toBe('flagged');
    const day2 = replay([[D(3), reading('flagged')]], day1.state);
    expect(day2.events).toEqual([{ kind: 'raised', day: D(3), correction: false }]);
  });

  it('AE3: clear, flagged on day 1, clear on day 2 drops the pending result and makes no event', () => {
    const { state, events } = replay(
      [
        [D(2), reading('flagged')],
        [D(3), reading('clear')],
      ],
      announcedClear,
    );
    expect(state).toMatchObject({ announced: 'clear', pending: null, result: 'clear', day: D(3) });
    expect(events).toEqual([]);
  });

  it('AE10: flagged Monday, failed read Tuesday, flagged Wednesday raises on Wednesday', () => {
    const { state, events } = replay(
      [
        [D(2), reading('flagged')],
        [D(3), failed],
        [D(4), reading('flagged')],
      ],
      announcedClear,
    );
    expect(state.announced).toBe('flagged');
    expect(events).toEqual([{ kind: 'raised', day: D(4), correction: false }]);
  });

  it('a failed read keeps the last result and its method', () => {
    const { state } = replay([[D(2), failed]], announcedFlagged);
    expect(state).toMatchObject({ announced: 'flagged', result: 'flagged', method: 1, day: D(2) });
  });

  it('a pending result eight days old is not confirmed by an agreeing reading, which starts a new pending result', () => {
    const { state, events } = replay(
      [
        [D(2), reading('flagged')],
        [D(10), reading('flagged')],
      ],
      announcedClear,
    );
    expect(state.announced).toBe('clear');
    expect(state.pending).toEqual({ result: 'flagged', day: D(10), correction: false });
    expect(events).toEqual([]);
  });

  it('a pending result seven days old is confirmed by an agreeing reading', () => {
    const { events } = replay(
      [
        [D(2), reading('flagged')],
        [D(9), reading('flagged')],
      ],
      announcedClear,
    );
    expect(events).toEqual([{ kind: 'raised', day: D(9), correction: false }]);
  });

  it('a second evaluation on the same day with the same result does not confirm it', () => {
    const { state, events } = replay(
      [
        [D(2), reading('flagged')],
        [D(2), reading('flagged')],
      ],
      announcedClear,
    );
    expect(state.announced).toBe('clear');
    expect(state.pending).toEqual({ result: 'flagged', day: D(2), correction: false });
    expect(events).toEqual([]);
  });

  it('a second evaluation on the day of a confirmation replaces that day’s outcome', () => {
    const confirmed = replay(
      [
        [D(2), reading('flagged')],
        [D(3), reading('flagged')],
      ],
      announcedClear,
    ).state;
    const { state, events } = replay([[D(3), reading('clear')]], confirmed);
    expect(state).toMatchObject({ announced: 'clear', pending: null, result: 'clear' });
    expect(events).toEqual([]);
  });

  it('announced flagged, "not readable" twice keeps the flag silently, then clear twice clears it', () => {
    const { state, events } = replay(
      [
        [D(2), reading('not readable')],
        [D(3), reading('not readable')],
      ],
      announcedFlagged,
    );
    expect(state.announced).toBe('flagged');
    expect(state.result).toBe('not readable');
    expect(events).toEqual([]);
    const after = replay(
      [
        [D(4), reading('clear')],
        [D(5), reading('clear')],
      ],
      state,
    );
    expect(after.events).toEqual([{ kind: 'cleared', day: D(5), correction: false }]);
  });

  it('announced "not readable", clear twice updates silently, then flagged twice raises', () => {
    const notReadable = replay([[D(1), baseline('not readable')]]).state;
    const quiet = replay(
      [
        [D(2), reading('clear')],
        [D(3), reading('clear')],
      ],
      notReadable,
    );
    expect(quiet.state.announced).toBe('clear');
    expect(quiet.events).toEqual([]);
    const loud = replay(
      [
        [D(4), reading('flagged')],
        [D(5), reading('flagged')],
      ],
      quiet.state,
    );
    expect(loud.events).toEqual([{ kind: 'raised', day: D(5), correction: false }]);
  });

  it('a re-classification drops a pending result', () => {
    const pending = replay([[D(2), reading('flagged')]], announcedClear).state;
    const { state, events, logs } = replay([[D(3), reading('not readable', { method: 2 })]], pending);
    expect(state).toMatchObject({ announced: 'clear', pending: null, method: 2 });
    expect(events).toEqual([]);
    expect(logs).toEqual(['re-classified']);
  });

  it('on the day of a method change, a limit switch turned off goes pending and raises on the next agreeing reading', () => {
    const { state, events, logs } = replay(
      [
        [D(2), reading('flagged', { method: 2, chainValuesChanged: true })],
        [D(3), reading('flagged', { method: 2 })],
      ],
      announcedClear,
    );
    expect(logs).toEqual([]);
    expect(state.announced).toBe('flagged');
    expect(events).toEqual([{ kind: 'raised', day: D(3), correction: false }]);
  });

  it('AE9: a correction that turns an announced flag clear on two evaluations clears it as a correction', () => {
    const { state, events } = replay(
      [
        [D(2), reading('clear', { corrected: true })],
        [D(3), reading('clear', { corrected: true })],
      ],
      announcedFlagged,
    );
    expect(state.announced).toBe('clear');
    expect(events).toEqual([{ kind: 'cleared', day: D(3), correction: true }]);
  });

  it('a correction that brings a pending result back to the announced state drops it with no event', () => {
    const { state, events } = replay(
      [
        [D(2), reading('flagged')],
        [D(3), reading('clear', { corrected: true })],
      ],
      announcedClear,
    );
    expect(state).toMatchObject({ announced: 'clear', pending: null });
    expect(events).toEqual([]);
  });

  it('AE13: a new lane flagged on a row read before goes pending and raises; a row read for the first time sets a baseline', () => {
    const newLane = replay([
      [D(2), reading('flagged')],
      [D(3), reading('flagged')],
    ]);
    expect(newLane.events).toEqual([{ kind: 'raised', day: D(3), correction: false }]);
    const newChain = replay([
      [D(2), baseline('flagged')],
      [D(3), reading('flagged')],
    ]);
    expect(newChain.state.announced).toBe('flagged');
    expect(newChain.events).toEqual([]);
  });

  it('keeps its state JSON-serialisable', () => {
    const { state } = replay([[D(2), reading('flagged')]], announcedClear);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

const SINCE = D(1);
const row = (over: Partial<ArrivingRow> & Pick<ArrivingRow, 'row' | 'groupId'>): ArrivingRow => ({
  chain: 'ethereum',
  firstSeen: D(2),
  readableByDesign: true,
  readings: [],
  ...over,
});

describe('confirmArrivals', () => {
  it('AE8: a token added after launch, flagged on both readings, gives one new-token item naming the flag', () => {
    const r = row({ row: 'eth:0xa', groupId: 'g1', readings: [{ day: D(2), flags: ['rate limit off to Base'] }] });
    expect(confirmArrivals({ today: D(2), since: SINCE, arriving: [r], settled: [] })).toEqual([]);
    const next = { ...r, readings: [...r.readings, { day: D(3), flags: ['rate limit off to Base'] }] };
    expect(confirmArrivals({ today: D(3), since: SINCE, arriving: [next], settled: [] })).toEqual([
      { kind: 'new token', groupId: 'g1', chains: [{ row: 'eth:0xa', chain: 'ethereum', readable: true, flags: ['rate limit off to Base'] }], otherChainFlags: 0 },
    ]);
  });

  it('waits while readings differ, then names the flags of the two that agree, and no raise follows', () => {
    const readings = [
      { day: D(2), flags: [] },
      { day: D(3), flags: ['single key'] },
    ];
    const arriving = (n: number) => [row({ row: 'eth:0xa', groupId: 'g1', readings: [...readings, { day: D(4), flags: ['single key'] }].slice(0, n) })];
    expect(confirmArrivals({ today: D(3), since: SINCE, arriving: arriving(2), settled: [] })).toEqual([]);
    const items = confirmArrivals({ today: D(4), since: SINCE, arriving: arriving(3), settled: [] });
    expect(items.map((i) => i.chains[0]!.flags)).toEqual([['single key']]);
    const unit = replay([
      [D(4), baseline('flagged')],
      [D(5), reading('flagged')],
    ]);
    expect(unit.events).toEqual([]);
  });

  it('does not confirm two agreeing readings more than seven days apart', () => {
    const r = row({ row: 'eth:0xa', groupId: 'g1', readings: [{ day: D(2), flags: [] }, { day: D(10), flags: [] }] });
    expect(confirmArrivals({ today: D(10), since: SINCE, arriving: [r], settled: [] })).toEqual([]);
  });

  it('confirms a new Solana row at its second daily evaluation, named as not readable', () => {
    const r = row({ row: 'sol:abc', groupId: 'g1', chain: 'solana', readableByDesign: false });
    expect(confirmArrivals({ today: D(2), since: SINCE, arriving: [r], settled: [] })).toEqual([]);
    expect(confirmArrivals({ today: D(3), since: SINCE, arriving: [r], settled: [] })).toEqual([
      { kind: 'new token', groupId: 'g1', chains: [{ row: 'sol:abc', chain: 'solana', readable: false, flags: [] }], otherChainFlags: 0 },
    ]);
  });

  it('confirms a new row whose reads keep failing after seven days, named as not readable', () => {
    const r = row({ row: 'eth:0xa', groupId: 'g1' });
    expect(confirmArrivals({ today: D(8), since: SINCE, arriving: [r], settled: [] })).toEqual([]);
    expect(confirmArrivals({ today: D(9), since: SINCE, arriving: [r], settled: [] })).toEqual([
      { kind: 'new token', groupId: 'g1', chains: [{ row: 'eth:0xa', chain: 'ethereum', readable: false, flags: [] }], otherChainFlags: 0 },
    ]);
  });

  it('gives a new-chain item for a later row joining a group with an older row, counting the flags on its other chains', () => {
    const r = row({ row: 'base:0xb', groupId: 'g1', chain: 'base', readings: [{ day: D(2), flags: [] }, { day: D(3), flags: [] }] });
    const settled: SettledRow[] = [
      { groupId: 'g1', chain: 'ethereum', flags: 2 },
      { groupId: 'g1', chain: 'arbitrum', flags: 1 },
      { groupId: 'g2', chain: 'ethereum', flags: 5 },
    ];
    expect(confirmArrivals({ today: D(3), since: SINCE, arriving: [r], settled })).toEqual([
      { kind: 'new chain', groupId: 'g1', chains: [{ row: 'base:0xb', chain: 'base', readable: true, flags: [] }], otherChainFlags: 3 },
    ]);
  });

  it('gives no arrival for a group first seen before the watermark', () => {
    const r = row({ row: 'eth:0xa', groupId: 'g1', firstSeen: SINCE, readings: [{ day: D(2), flags: [] }, { day: D(3), flags: [] }] });
    expect(confirmArrivals({ today: D(3), since: SINCE, arriving: [r], settled: [] })).toEqual([]);
  });
});

const raise = (groupId: string, unit = 'single-key'): WireChange => ({ groupId, unit, kind: 'raised', day: D(3), correction: false });
const arrival = (groupId: string, kind: ArrivalItem['kind'] = 'new token'): ArrivalItem => ({
  kind,
  groupId,
  chains: [{ row: `eth:${groupId}`, chain: 'ethereum', readable: true, flags: [] }],
  otherChainFlags: 0,
});
const tokenName = (n: number) => `Token ${String(n).padStart(2, '0')}`;

describe('planPassportPosts', () => {
  it('gives a token with a flag raise and a new chain on one day one record carrying both', () => {
    const records = planPassportPosts({ day: D(3), changes: [raise('g1')], arrivals: [arrival('g1', 'new chain')], names: { g1: 'Alpha' } });
    expect(records).toEqual([
      { id: `${D(3)}-g1`, day: D(3), kind: 'token', groupId: 'g1', name: 'Alpha', changes: [raise('g1')], arrivals: [arrival('g1', 'new chain')] },
    ]);
  });

  const busyDay = () => {
    const names: Record<string, string> = {};
    for (let n = 1; n <= 25; n++) names[`g${n}`] = tokenName(n);
    const flagged = [20, 22, 24];
    const changes = flagged.map((n) => raise(`g${n}`));
    const arrivals = Array.from({ length: 25 }, (_, i) => i + 1)
      .filter((n) => !flagged.includes(n))
      .map((n) => arrival(`g${n}`, n % 2 === 0 ? 'new chain' : 'new token'));
    return { day: D(3), changes, arrivals, names };
  };

  it('AE12: 25 tokens, 3 with flag changes, give ten token records with the flag changes first and one summary of fifteen', () => {
    const records = planPassportPosts(busyDay());
    expect(records.map((r) => r.id)).toEqual([
      ...['g20', 'g22', 'g24', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'].map((g) => `${D(3)}-${g}`),
      `${D(3)}-summary`,
    ]);
    expect(records.at(-1)).toEqual({
      id: `${D(3)}-summary`,
      day: D(3),
      kind: 'summary',
      groupIds: ['g8', 'g9', 'g10', 'g11', 'g12', 'g13', 'g14', 'g15', 'g16', 'g17', 'g18', 'g19', 'g21', 'g23', 'g25'],
      counts: { raised: 0, cleared: 0, newToken: 9, newChain: 6 },
    });
  });

  it('gives exactly ten tokens ten token records and no summary', () => {
    const groups = Array.from({ length: 10 }, (_, i) => `g${i + 1}`);
    const names = Object.fromEntries(groups.map((g, i) => [g, tokenName(i + 1)]));
    const records = planPassportPosts({ day: D(3), changes: [], arrivals: groups.map((g) => arrival(g)), names });
    expect(records).toHaveLength(10);
    expect(records.every((r) => r.kind === 'token')).toBe(true);
  });

  it('gives the same records for the same events in a different order', () => {
    const input = busyDay();
    const shuffled = {
      ...input,
      changes: [...input.changes, raise('g20', 'rate-limit:base')].reverse(),
      arrivals: [...input.arrivals.slice(11), ...input.arrivals.slice(0, 11)].reverse(),
    };
    const ordered = { ...input, changes: [...input.changes, raise('g20', 'rate-limit:base')] };
    expect(planPassportPosts(shuffled)).toEqual(planPassportPosts(ordered));
  });

  it('orders tokens with the same name by group id', () => {
    const records = planPassportPosts({ day: D(3), changes: [], arrivals: [arrival('gb'), arrival('ga')], names: { ga: 'EARNM', gb: 'EARNM' } });
    expect(records.map((r) => r.id)).toEqual([`${D(3)}-ga`, `${D(3)}-gb`]);
  });
});
