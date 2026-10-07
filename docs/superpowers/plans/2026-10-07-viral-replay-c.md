# Viral Replay, Plan C (soundtrack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cinematic synth soundtrack, generated in the browser from the same beats as the visuals:
- a rising pad and pulse, plucks for comets, chimes for joins, booms for milestones, a run for record days, and a final swell;
- it plays live, synced to the scrubber, behind a Sound button;
- it's muxed into recorded MP4s as AAC, or the video records silently with a note.

**Architecture:**
- **Schedule** (`site/src/replay/score/schedule.ts`): a pure `scoreFor(show)` turns the `Show` into timed note events.
- **Synth** (`site/src/replay/score/synth.ts`): renders the events once through `OfflineAudioContext` into an `AudioBuffer`, normalized to −1 dBFS peak.
- **Live playback:** an `AudioBufferSourceNode` started at the playhead offset.
- **Recording:** the recorder adds a mediabunny `AudioBufferSource` AAC track when `getFirstEncodableAudioCodec(['aac'])` succeeds.

**Tech Stack:** Web Audio API, mediabunny 1.61.3 (`AudioBufferSource`, `getFirstEncodableAudioCodec`), Vitest 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-viral-replay-design.md` §10, plus the Sound toggle in §11 and the audio rows of §14. **Depends on:** Plan A complete. It's independent of Plan B.

## Global Constraints

**Repo and workflow** (same as Plans A and B)
- Repo `/Users/rubberduck/GitHub/momentmaker/ccip-dev`, branch `main`. Never push or deploy.
- End every commit with a trailer naming your model.
- Before each commit, run the site test and typecheck. Run the build before the last commit of any task that touches the player.

**Code**
- Test first for pure modules. No new dependencies.
- Add no comments that restate code.

**Music** (spec §10.1)
- D minor with a Lydian lift: the D dorian scale, MIDI 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79 and 81.
- 96 BPM, so a beat is 0.625 s and an eighth is 0.3125 s.
- Pad progression Dm, B♭, F, C, changing every 2 bars.
- At most 8 plucks per second. Eighth-note quantization gives 3.2.
- Milestone booms land exactly on their slam start.
- The final swell is a Dmaj9 chord across the whole finale.
- The master fades in over 0.4 s and out over the last 0.5 s.

**Rendering:** 48 kHz stereo, normalized to a −1 dBFS peak (0.891).

**Audio encoding:** AAC only, at 128 kbps. Without AAC, the video records silently and shows the verbatim note `Recorded without sound — your browser can't encode audio`.

**Sound:** off by default, because of autoplay rules. The Sound button is hidden when `AudioContext` or `OfflineAudioContext` is missing.

## Review Focus

1. **A browser without `AudioEncoder`, or without AAC** (some Linux Chrome builds). The recording still completes, silent, with the note.
   - Task 3: recorder tests with `getFirstEncodableAudioCodec` returning null, and with `AudioEncoder` undefined.
2. **Scrubbing or changing length while sound is on.** The audio restarts in sync at the new offset, and the old source stops; it never doubles.
   - Task 4: a pure `AudioSync` helper is tested for the start, stop and restart decisions.
3. **The length or focus chain changes while sound is on.** The score re-renders for the new show, and the stale buffer is never played.
   - Task 4: the buffer cache is keyed by show identity, and a test checks the key changes with length and focus.
4. **A very short show (15 s) or a focus chain with few comets.** Every event lies within `[0, length)`, and there are no plucks when no comets fly.
   - Task 1: `scoreFor` on a 15 s show, and on a show with no comets.
5. **Clipping.** Dense 2025–26 plucks plus booms never clip.
   - Task 2: a `normalizePeak` test, and a browser check that the rendered peak is ≤ 0.9.

---

## Task 1: The score schedule

**Files:**
- Create: `site/src/replay/score/schedule.ts`
- Test: `site/test/score-schedule.test.ts`

**Interfaces:**
- Consumes: `Show` from Plan A: `length`, `timing`, `warp`, `slams`, `cards`, `frameAt`.
- Produces:
  - `BPM = 96`, `BEAT_S`, `EIGHTH_S`, `MAX_PLUCKS_PER_S = 8`, `SCALE`, `PROGRESSION`, `FINAL_CHORD`;
  - `type ScoreEvent =`
    - `| { kind: 'pad'; time: number; duration: number; chord: readonly number[]; cutoff: number }`
    - `| { kind: 'pulse'; time: number; gain: number }`
    - `| { kind: 'pluck'; time: number; note: number; gain: number }`
    - `| { kind: 'chime'; time: number; note: number }`
    - `| { kind: 'boom'; time: number }`
    - `| { kind: 'run'; time: number; notes: readonly number[] }`
    - `| { kind: 'swell'; time: number; duration: number; chord: readonly number[] }`;
  - `scoreFor(show: ScoreSource): ScoreEvent[]`, where `type ScoreSource = Pick<Show, 'length' | 'timing' | 'warp' | 'slams' | 'cards' | 'frameAt'>`.

- [ ] **Step 1: Write the failing tests**

`site/test/score-schedule.test.ts`:

```ts
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { Show } from '../src/replay/director/show';
import { BEAT_S, MAX_PLUCKS_PER_S, scoreFor, type ScoreEvent } from '../src/replay/score/schedule';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const show = (length = 30) => new Show({ replay, history, stars, length, focus: null, eligible: () => true });

describe('scoreFor', () => {
  it('keeps every event inside the video and in time order', () => {
    for (const length of [15, 30, 60]) {
      const events = scoreFor(show(length));
      expect(events.every((e) => e.time >= 0 && e.time < length)).toBe(true);
      expect(events.map((e) => e.time)).toEqual([...events.map((e) => e.time)].sort((a, b) => a - b));
    }
  });

  it('lands a boom exactly on every milestone slam', () => {
    const fake = { ...show(), slams: [{ start: 10, label: '$1B moved' }, { start: 20.4, label: '1M messages' }] };
    const booms = scoreFor(fake as never).filter((e) => e.kind === 'boom').map((e) => e.time);
    expect(booms).toEqual([10, 20.4]);
  });

  it('chimes for each join card and runs for each record card', () => {
    const s = show();
    const events = scoreFor(s);
    expect(events.filter((e) => e.kind === 'chime')).toHaveLength(s.cards.filter((c) => c.kind !== 'record').length);
    expect(events.filter((e) => e.kind === 'chime').map((e) => e.time)).toEqual(s.cards.filter((c) => c.kind !== 'record').map((c) => c.start));
  });

  it('never plucks more than the cap per second, and plucks only on eighths when comets fly', () => {
    const events = scoreFor(show());
    const plucks = events.filter((e): e is Extract<ScoreEvent, { kind: 'pluck' }> => e.kind === 'pluck');
    for (let second = 0; second < 30; second++) expect(plucks.filter((p) => p.time >= second && p.time < second + 1).length).toBeLessThanOrEqual(MAX_PLUCKS_PER_S);
    for (const p of plucks) expect(Math.abs(p.time / (BEAT_S / 2) - Math.round(p.time / (BEAT_S / 2)))).toBeLessThan(1e-6);
  });

  it('plucks nothing when no comets fly', () => {
    const quiet = { ...show(), frameAt: (t: number) => ({ ...show().frameAt(t), base: { ...show().frameAt(t).base, sky: { ...show().frameAt(t).base.sky, comets: [] } } }) };
    expect(scoreFor(quiet as never).some((e) => e.kind === 'pluck')).toBe(false);
  });

  it('swells across the whole finale', () => {
    const s = show();
    const swell = scoreFor(s).find((e) => e.kind === 'swell')!;
    expect(swell.time).toBe(27);
    expect((swell as Extract<ScoreEvent, { kind: 'swell' }>).duration).toBe(3);
  });

  it('is deterministic', () => {
    expect(scoreFor(show())).toEqual(scoreFor(show()));
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/score-schedule.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/score/schedule.ts`:

```ts
import type { Show } from '../director/show';

export const BPM = 96;
export const BEAT_S = 60 / BPM;
export const EIGHTH_S = BEAT_S / 2;
export const MAX_PLUCKS_PER_S = 8;
export const SCALE = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81] as const;
export const PROGRESSION = [[50, 57, 62, 65], [46, 53, 58, 62], [53, 60, 65, 69], [48, 55, 60, 64]] as const;
export const FINAL_CHORD = [50, 57, 62, 66, 69, 73, 76] as const;
const RUN = [74, 76, 77, 79, 81, 86] as const;
const BAR_S = BEAT_S * 8;

export type ScoreEvent =
  | { kind: 'pad'; time: number; duration: number; chord: readonly number[]; cutoff: number }
  | { kind: 'pulse'; time: number; gain: number }
  | { kind: 'pluck'; time: number; note: number; gain: number }
  | { kind: 'chime'; time: number; note: number }
  | { kind: 'boom'; time: number }
  | { kind: 'run'; time: number; notes: readonly number[] }
  | { kind: 'swell'; time: number; duration: number; chord: readonly number[] };

type ScoreSource = Pick<Show, 'length' | 'timing' | 'warp' | 'slams' | 'cards' | 'frameAt'>;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function scoreFor(show: ScoreSource): ScoreEvent[] {
  const length = show.length;
  const storyStart = show.warp.start;
  const storyEnd = show.warp.end;
  const finaleStart = length - show.timing.finale;
  const events: ScoreEvent[] = [];
  for (let i = 0, t = 0; t < finaleStart; i++, t += BAR_S) {
    events.push({ kind: 'pad', time: t, duration: Math.min(BAR_S, finaleStart - t), chord: PROGRESSION[i % PROGRESSION.length]!, cutoff: 0.2 + 0.8 * clamp01((t - storyStart) / (storyEnd - storyStart)) });
  }
  for (let t = Math.ceil(storyStart / BEAT_S) * BEAT_S; t < finaleStart; t += BEAT_S) {
    events.push({ kind: 'pulse', time: t, gain: 0.3 + 0.7 * Math.min(1, show.frameAt(t).base.sky.comets.length / 40) });
  }
  for (let k = Math.ceil(storyStart / EIGHTH_S); k * EIGHTH_S < finaleStart; k++) {
    const t = k * EIGHTH_S;
    const comets = show.frameAt(t).base.sky.comets;
    if (comets.length === 0) continue;
    const index = (comets.reduce((s, c) => s + c.from + 2 * c.to, 0) + k) % SCALE.length;
    events.push({ kind: 'pluck', time: t, note: SCALE[index]!, gain: Math.min(1, 0.25 + 0.15 * Math.log2(1 + comets.length)) });
  }
  show.cards.forEach((c, i) => {
    if (c.kind === 'record') events.push({ kind: 'run', time: c.start, notes: RUN });
    else events.push({ kind: 'chime', time: c.start, note: i % 2 === 0 ? 86 : 93 });
  });
  for (const s of show.slams) events.push({ kind: 'boom', time: s.start });
  events.push({ kind: 'swell', time: finaleStart, duration: length - finaleStart, chord: FINAL_CHORD });
  return events.filter((e) => e.time >= 0 && e.time < length).sort((a, b) => a.time - b.time);
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/score-schedule.test.ts`
Expected: PASS.

Eighth notes at 96 BPM come every 0.3125 s, so there are at most 3.2 plucks per second, well under the cap of 8. The chime test compares against non-record cards in order; that holds because the chime loop preserves `show.cards` order.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/score/schedule.ts site/test/score-schedule.test.ts
git commit -m "feat(site): replay score schedule: pad, pulse, comet plucks, join chimes, milestone booms, record runs, final swell"
```

---

## Task 2: The synth

**Files:**
- Create: `site/src/replay/score/synth.ts`
- Test: `site/test/score-synth.test.ts`

**Interfaces:**
- Consumes: `ScoreEvent` (Task 1); `mulberry32` (`timeline.ts`).
- Produces:
  - `SAMPLE_RATE = 48_000`;
  - `midiHz(note: number): number`;
  - `impulse(seconds: number, rate: number, seed: number): [Float32Array, Float32Array]`;
  - `normalizePeak(channels: Float32Array[], target?: number): number`, which scales in place and returns the gain;
  - `renderScore(events: readonly ScoreEvent[], length: number, createContext?: (frames: number) => OfflineAudioContext): Promise<AudioBuffer>`.

- [ ] **Step 1: Write the failing tests**

`site/test/score-synth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { impulse, midiHz, normalizePeak } from '../src/replay/score/synth';

describe('midiHz', () => {
  it('maps A4 to 440 Hz and an octave to double', () => {
    expect(midiHz(69)).toBe(440);
    expect(midiHz(81)).toBeCloseTo(880, 9);
  });
});

describe('impulse', () => {
  it('is a deterministic stereo decay that starts loud and ends quiet', () => {
    const [l, r] = impulse(1, 1000, 3);
    expect(l).toHaveLength(1000);
    expect(r).toHaveLength(1000);
    const energy = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((s, v) => s + v * v, 0);
    expect(energy(l, 0, 100)).toBeGreaterThan(energy(l, 900, 1000) * 10);
    expect(impulse(1, 1000, 3)[0]).toEqual(l);
    expect(l).not.toEqual(r);
  });
});

describe('normalizePeak', () => {
  it('scales the loudest sample to the target, across channels', () => {
    const a = new Float32Array([0.5, -2]);
    const b = new Float32Array([1, 0]);
    const gain = normalizePeak([a, b], 0.891);
    expect(gain).toBeCloseTo(0.4455, 6);
    expect(Math.max(...[...a, ...b].map(Math.abs))).toBeCloseTo(0.891, 6);
  });

  it('leaves silence alone', () => {
    const a = new Float32Array([0, 0]);
    expect(normalizePeak([a])).toBe(1);
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/score-synth.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/score/synth.ts`:

```ts
import { mulberry32 } from '../timeline';
import type { ScoreEvent } from './schedule';

export const SAMPLE_RATE = 48_000;
const PEAK = 0.891;
const REVERB_S = 2.6;
const FADE_IN_S = 0.4;
const FADE_OUT_S = 0.5;
const SILENT = 0.0001;

export function midiHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function impulse(seconds: number, rate: number, seed: number): [Float32Array, Float32Array] {
  const frames = Math.round(seconds * rate);
  const rng = mulberry32(seed);
  const make = () => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = (rng() * 2 - 1) * (1 - i / frames) ** 3;
    return out;
  };
  return [make(), make()];
}

export function normalizePeak(channels: Float32Array[], target = PEAK): number {
  let peak = 0;
  for (const c of channels) for (const v of c) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return 1;
  const gain = target / peak;
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i]! *= gain;
  return gain;
}

interface Voices {
  ctx: OfflineAudioContext;
  dry: AudioNode;
  wet: AudioNode;
}

function envelope(ctx: BaseAudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(SILENT, at + attack + decay);
  return g;
}

function tone(v: Voices, type: OscillatorType, freq: number, at: number, peak: number, attack: number, decay: number, send: number): void {
  const osc = v.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  const g = envelope(v.ctx, at, peak, attack, decay);
  osc.connect(g);
  g.connect(v.dry);
  if (send > 0) {
    const s = v.ctx.createGain();
    s.gain.value = send;
    g.connect(s);
    s.connect(v.wet);
  }
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

function chord(v: Voices, notes: readonly number[], at: number, duration: number, from: number, to: number, peak: number): void {
  const filter = v.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.linearRampToValueAtTime(to, at + duration);
  const g = v.ctx.createGain();
  const attack = Math.min(1.2, duration / 3);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + duration);
  g.gain.linearRampToValueAtTime(0, at + duration + 1.2);
  filter.connect(g);
  g.connect(v.dry);
  const send = v.ctx.createGain();
  send.gain.value = 0.35;
  g.connect(send);
  send.connect(v.wet);
  for (const note of notes) {
    for (const detune of [-7, 0, 7]) {
      const osc = v.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiHz(note), at);
      osc.detune.setValueAtTime(detune, at);
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + duration + 1.3);
    }
  }
}

function boom(v: Voices, at: number): void {
  const osc = v.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(70, at);
  osc.frequency.exponentialRampToValueAtTime(32, at + 1);
  const g = envelope(v.ctx, at, 0.6, 0.01, 1.6);
  osc.connect(g);
  g.connect(v.dry);
  osc.start(at);
  osc.stop(at + 1.7);
  const frames = Math.round(0.6 * v.ctx.sampleRate);
  const buffer = v.ctx.createBuffer(1, frames, v.ctx.sampleRate);
  const rng = mulberry32(Math.round(at * 1000));
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = rng() * 2 - 1;
  const noise = v.ctx.createBufferSource();
  noise.buffer = buffer;
  const lp = v.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const ng = envelope(v.ctx, at, 0.3, 0.005, 0.5);
  noise.connect(lp);
  lp.connect(ng);
  ng.connect(v.dry);
  ng.connect(v.wet);
  noise.start(at);
}

function pulse(v: Voices, at: number, gain: number): void {
  const osc = v.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
  const g = envelope(v.ctx, at, 0.5 * gain, 0.005, 0.35);
  osc.connect(g);
  g.connect(v.dry);
  osc.start(at);
  osc.stop(at + 0.4);
}

export async function renderScore(
  events: readonly ScoreEvent[],
  length: number,
  createContext: (frames: number) => OfflineAudioContext = (frames) => new OfflineAudioContext(2, frames, SAMPLE_RATE),
): Promise<AudioBuffer> {
  const ctx = createContext(Math.ceil(length * SAMPLE_RATE));
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 12;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.25;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(1, FADE_IN_S);
  master.gain.setValueAtTime(1, Math.max(FADE_IN_S, length - FADE_OUT_S));
  master.gain.linearRampToValueAtTime(0, length);
  compressor.connect(master);
  master.connect(ctx.destination);
  const reverb = ctx.createConvolver();
  const [left, right] = impulse(REVERB_S, ctx.sampleRate, 7);
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.copyToChannel(left, 0);
  ir.copyToChannel(right, 1);
  reverb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  reverb.connect(wet);
  wet.connect(compressor);
  const voices: Voices = { ctx, dry: compressor, wet: reverb };
  for (const e of events) {
    switch (e.kind) {
      case 'pad':
        chord(voices, e.chord, e.time, e.duration, 300 + 2600 * e.cutoff, 300 + 2600 * e.cutoff, 0.035);
        break;
      case 'pulse':
        pulse(voices, e.time, e.gain);
        break;
      case 'pluck':
        tone(voices, 'triangle', midiHz(e.note), e.time, 0.12 * e.gain, 0.005, 0.45, 0.4);
        break;
      case 'chime':
        tone(voices, 'sine', midiHz(e.note), e.time, 0.08, 0.005, 1.8, 0.6);
        tone(voices, 'sine', midiHz(e.note) * 2.01, e.time, 0.03, 0.005, 1.2, 0.6);
        break;
      case 'boom':
        boom(voices, e.time);
        break;
      case 'run':
        e.notes.forEach((note, i) => tone(voices, 'triangle', midiHz(note), e.time + i * 0.07, 0.1, 0.005, 0.5, 0.5));
        break;
      case 'swell':
        chord(voices, e.chord, e.time, e.duration, 400, 3200, 0.05);
        break;
    }
  }
  const buffer = await ctx.startRendering();
  normalizePeak(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
  return buffer;
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/score-synth.test.ts`
Expected: PASS. `renderScore` itself has no Node test, because Node has no `OfflineAudioContext`; Step 3 covers it.

`renderScore` has no Node test, because Node has no `OfflineAudioContext`. Task 4 verifies the real render end to end: it records an MP4 and measures its audio with `ffprobe` and `volumedetect`.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/score/synth.ts site/test/score-synth.test.ts
git commit -m "feat(site): replay synth renders the score offline: pad, pulse, plucks, chimes, booms, runs, swell, reverb, normalized"
```

---

## Task 3: Audio in recordings

**Files:**
- Modify: `site/src/replay/recorder.ts`
- Test: `site/test/recorder.test.ts`

**Interfaces:**
- Produces:
  - `audioCodecAvailable(): Promise<boolean>`, which is true only if `AudioEncoder` exists and `getFirstEncodableAudioCodec(['aac'], { numberOfChannels: 2, sampleRate: 48_000 })` returns `'aac'`;
  - `RecordOptions.audio?: AudioBuffer | null`. When given, an AAC `AudioBufferSource` track at 128 kbps is added before `output.start()`, and the buffer is added right after.

- [ ] **Step 1: Write the failing tests**

In `site/test/recorder.test.ts`, extend the `vi.mock('mediabunny', …)` factory:
- add `audioAdds: [] as unknown[]`, `audioTracks: 0` and `codec: 'aac' as string | null` to the hoisted `calls`;
- add this class:

```ts
  class AudioBufferSource {
    constructor(readonly config: unknown) {}
    async add(buffer: unknown) {
      calls.audioAdds.push(buffer);
    }
  }
```

- add `addAudioTrack() { calls.audioTracks += 1; }` to `Output`;
- add `getFirstEncodableAudioCodec: async () => calls.codec`;
- return the new class and function from the factory;
- reset the new fields in `afterEach`.

Add these tests:

```ts
describe('audio', () => {
  it('adds an AAC track and the score buffer when audio is given', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const audio = { duration: 1 } as unknown as AudioBuffer;
    await recordReplay({ draw: () => {}, aspect: '1:1', lengthS: 1, onProgress: () => {}, signal: new AbortController().signal, audio });
    expect(calls.audioTracks).toBe(1);
    expect(calls.audioAdds).toEqual([audio]);
  });

  it('records silently without audio', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    await recordReplay({ draw: () => {}, aspect: '1:1', lengthS: 1, onProgress: () => {}, signal: new AbortController().signal });
    expect(calls.audioTracks).toBe(0);
  });

  it('reports AAC only when the encoder exists and supports it', async () => {
    expect(await audioCodecAvailable()).toBe(false);
    vi.stubGlobal('AudioEncoder', class {});
    calls.codec = 'aac';
    expect(await audioCodecAvailable()).toBe(true);
    calls.codec = null;
    expect(await audioCodecAvailable()).toBe(false);
  });
});
```

Import `audioCodecAvailable` from the recorder.

If the existing test "draws and encodes every frame" still expects 90 draws for `lengthS: 1`, it is out of date after Plan A Task 7 removed the 2 s end card: the right value is 30. Plan A should already have fixed it; if not, update it and note it.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/recorder.test.ts`
Expected: FAIL. `audioCodecAvailable` is missing, and no audio track is added.

- [ ] **Step 2: Implement**

In `site/src/replay/recorder.ts`:
- add `audio?: AudioBuffer | null;` to `RecordOptions`;
- add:

```ts
export const AUDIO_BITRATE = 128_000;

export async function audioCodecAvailable(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  const { getFirstEncodableAudioCodec } = await import('mediabunny');
  return (await getFirstEncodableAudioCodec(['aac'], { numberOfChannels: 2, sampleRate: 48_000 })) === 'aac';
}
```

- in `recordReplay`, import `AudioBufferSource` with the other mediabunny names. After `output.addVideoTrack(…)`, add:

```ts
  const audioSource = opts.audio ? new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
```

- immediately after `await output.start();`, still inside the `try`, add:

```ts
    if (audioSource && opts.audio) await audioSource.add(opts.audio);
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/recorder.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/recorder.ts site/test/recorder.test.ts
git commit -m "feat(site): recordings carry the soundtrack as AAC when the browser can encode it"
```

---

## Task 4: The Sound button, live playback and recording with sound

**Files:**
- Create: `site/src/replay/score/sync.ts`
- Modify: `site/src/replay/player.tsx`, `site/src/styles/controls.css`
- Test: `site/test/score-sync.test.ts`

**Interfaces:**
- Consumes: `scoreFor` (Task 1), `renderScore` (Task 2), `audioCodecAvailable` (Task 3), and Plan A's `Show`.
- Produces:
  - `scoreKey(show: Pick<Show, 'length' | 'focus'>, lastDay: string): string`;
  - `type SyncAction = { kind: 'start'; offset: number } | { kind: 'stop' } | { kind: 'none' }`;
  - `syncAction(prev: { playing: boolean; soundOn: boolean; t: number }, next: { playing: boolean; soundOn: boolean; t: number; scrubbed: boolean }): SyncAction`.

- [ ] **Step 1: Write the failing tests**

`site/test/score-sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scoreKey, syncAction } from '../src/replay/score/sync';

describe('scoreKey', () => {
  it('changes with length, focus and data day', () => {
    const base = scoreKey({ length: 30, focus: null }, '2026-10-06');
    expect(scoreKey({ length: 15, focus: null }, '2026-10-06')).not.toBe(base);
    expect(scoreKey({ length: 30, focus: 'b' }, '2026-10-06')).not.toBe(base);
    expect(scoreKey({ length: 30, focus: null }, '2026-10-07')).not.toBe(base);
    expect(scoreKey({ length: 30, focus: null }, '2026-10-06')).toBe(base);
  });
});

describe('syncAction', () => {
  const idle = { playing: false, soundOn: false, t: 0 };
  it('starts audio at the playhead when playback starts with sound on', () => {
    expect(syncAction({ ...idle, soundOn: true }, { playing: true, soundOn: true, t: 4, scrubbed: false })).toEqual({ kind: 'start', offset: 4 });
  });

  it('starts when sound is switched on mid-play, and stops when it is switched off', () => {
    expect(syncAction({ playing: true, soundOn: false, t: 5 }, { playing: true, soundOn: true, t: 5.1, scrubbed: false })).toEqual({ kind: 'start', offset: 5.1 });
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: true, soundOn: false, t: 5.1, scrubbed: false })).toEqual({ kind: 'stop' });
  });

  it('restarts at the new offset after a scrub, and stops on pause', () => {
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: true, soundOn: true, t: 12, scrubbed: true })).toEqual({ kind: 'start', offset: 12 });
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: false, soundOn: true, t: 5, scrubbed: false })).toEqual({ kind: 'stop' });
  });

  it('does nothing while playing steadily', () => {
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: true, soundOn: true, t: 5.03, scrubbed: false })).toEqual({ kind: 'none' });
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/score-sync.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement the sync helpers**

`site/src/replay/score/sync.ts`:

```ts
export type SyncAction = { kind: 'start'; offset: number } | { kind: 'stop' } | { kind: 'none' };

export function scoreKey(show: { length: number; focus: string | null }, lastDay: string): string {
  return `${show.length}|${show.focus ?? 'all'}|${lastDay}`;
}

export function syncAction(
  prev: { playing: boolean; soundOn: boolean; t: number },
  next: { playing: boolean; soundOn: boolean; t: number; scrubbed: boolean },
): SyncAction {
  const wasAudible = prev.playing && prev.soundOn;
  const isAudible = next.playing && next.soundOn;
  if (!isAudible) return wasAudible ? { kind: 'stop' } : { kind: 'none' };
  if (!wasAudible || next.scrubbed) return { kind: 'start', offset: next.t };
  return { kind: 'none' };
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/score-sync.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire the player**

In `site/src/replay/player.tsx`:

1. **State and refs:**

```tsx
  const audioSupported = typeof window !== 'undefined' && typeof AudioContext !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
  const [soundOn, setSoundOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const scoreRef = useRef<{ key: string; buffer: Promise<AudioBuffer> } | null>(null);
  const audioStateRef = useRef({ playing: false, soundOn: false, t: 0 });
  const [recordNote, setRecordNote] = useState<string | null>(null);
```

2. **The score buffer for the current show, cached by key:**

```tsx
  const scoreBuffer = useCallback((): Promise<AudioBuffer> | null => {
    if (!show || !audioSupported) return null;
    const key = scoreKey(show, lastDay);
    if (scoreRef.current?.key !== key) scoreRef.current = { key, buffer: renderScore(scoreFor(show), show.length) };
    return scoreRef.current.buffer;
  }, [show, lastDay, audioSupported]);
```

3. **Applying sync actions:**

```tsx
  const applyAudio = useCallback(
    (next: { playing: boolean; soundOn: boolean; t: number; scrubbed: boolean }) => {
      const action = syncAction(audioStateRef.current, next);
      audioStateRef.current = { playing: next.playing, soundOn: next.soundOn, t: next.t };
      if (action.kind === 'none') return;
      sourceRef.current?.stop();
      sourceRef.current = null;
      if (action.kind === 'stop') return;
      const pending = scoreBuffer();
      if (!pending) return;
      audioCtxRef.current ??= new AudioContext();
      const ctx = audioCtxRef.current;
      void ctx.resume();
      void pending.then((buffer) => {
        if (!audioStateRef.current.playing || !audioStateRef.current.soundOn) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0, Math.min(action.offset, buffer.duration));
        sourceRef.current?.stop();
        sourceRef.current = source;
      });
    },
    [scoreBuffer],
  );
```

4. **Call sites:**
   - when `playing` turns true: in `play()` after `setPlaying(true)`, call `applyAudio({ playing: true, soundOn, t: from, scrubbed: false })`;
   - when paused (any path that sets `playing` false, including reaching the end): `applyAudio({ playing: false, soundOn, t: tRef.current, scrubbed: false })`;
   - in `scrub(value)`: `applyAudio({ playing, soundOn, t: value, scrubbed: true })`;
   - on the Sound toggle: `setSoundOn(on)`, then `applyAudio({ playing, soundOn: on, t: tRef.current, scrubbed: false })`;
   - when `show` changes, through length or focus: an effect on `[show]` that stops the current source, sets `audioStateRef.current.playing = false`, and clears `scoreRef`;
   - on unmount: stop the source and `void audioCtxRef.current?.close()`.

5. **The Sound button** in `.player-bar`, after the time readout, only when `audioSupported`:

```tsx
          {audioSupported && (
            <button
              type="button"
              className="icon-btn sound-toggle"
              aria-pressed={soundOn}
              aria-label={soundOn ? 'Mute soundtrack' : 'Play soundtrack'}
              onClick={() => {
                const on = !soundOn;
                setSoundOn(on);
                applyAudio({ playing, soundOn: on, t: tRef.current, scrubbed: false });
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
                {soundOn ? <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.4" fill="none" /> : <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.4" />}
              </svg>
            </button>
          )}
```

   Add `.sound-toggle { color: var(--fg); } .sound-toggle[aria-pressed='true'] { background: #13244d; border-color: var(--blue-2); }` to `site/src/styles/controls.css`.

6. **Recording with sound.** In `record()`, after the compositor is built and before `recordReplay`:

```tsx
      const canAac = await audioCodecAvailable();
      const audio = canAac ? await (scoreBuffer() ?? Promise.resolve(null)).catch(() => null) : null;
      if (controller.signal.aborted) return;
```

   Pass `audio` to `recordReplay({ …, audio })`. After a successful download, call `setRecordNote(audio ? null : "Recorded without sound — your browser can't encode audio")`. Render `{recordNote && <span className="muted">{recordNote}</span>}` in the studio row.

Import `scoreFor`, `renderScore`, `scoreKey`, `syncAction` and `audioCodecAvailable`.

- [ ] **Step 4: Build and check in the browser**

1. Run the site suite, the typecheck and the build. Quote the replay budget line.
2. On the preview at port 4321, open `/replay/`:
   - Confirm the Sound button shows in the bar with `aria-pressed="false"`.
   - Turn sound on, play for a few seconds, then scrub. The button state toggles, and there are no console errors.
   - Record a 15 s 1:1 MP4.
3. Check the MP4's audio with ffmpeg:
   - `ffprobe -v error -select_streams a -show_entries stream=codec_name,channels,sample_rate -of compact <file>` should show `codec_name=aac|channels=2|sample_rate=48000`;
   - `ffmpeg -i <file> -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"` should show `max_volume` ≤ −0.5 dB and `mean_volume` above −40 dB, meaning there's real sound and no clipping.
4. Report the numbers. If AAC isn't available in the test browser, report the silent-recording note instead.

- [ ] **Step 5: Commit**

```bash
git add site/src/replay/score/sync.ts site/src/replay/player.tsx site/src/styles/controls.css site/test/score-sync.test.ts
git commit -m "feat(site): replay soundtrack plays live behind a Sound button and records into the MP4"
```

---

## After the last task (controller)

1. **Full checks.** Run the full suite, the typecheck and the build with its budgets.
2. **Recordings.** Record 30 s MP4s in 16:9 and 1:1.
   - `ffprobe` must show an AAC stereo 48 kHz stream.
   - `volumedetect` must show a peak ≤ −0.5 dB.
   - Spot-check frame-accurate sync: the boom at a slam. Pick a milestone time from `show.milestoneMarks()` and use `ffmpeg -ss <t-0.2> -t 0.6 -af astats` to confirm an energy jump within one frame of the slam.
3. **Status.** Update `IMPLEMENTATION_PLAN.md` Stage 10 with "Plan C complete".
4. **Owner step.** The owner uploads a 30 s 1:1 MP4 with sound to X and confirms it plays and loops.
5. **Release.** After the final whole-branch review is clean, push.
