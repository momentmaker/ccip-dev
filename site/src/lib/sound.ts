export const PENTATONIC_HZ = [261.63, 293.66, 329.63, 392.0, 440.0] as const;
export const MAX_NOTES_PER_SECOND = 6;
export const SOUND_KEY = 'ccipdev:sound';
const TOP_NOTE = 14;

export function noteIndex(usd: number | null): number {
  if (!usd || usd <= 0) return 0;
  return Math.min(TOP_NOTE, Math.max(0, Math.floor(Math.log10(usd + 1) * 1.6)));
}

export function noteFrequency(usd: number | null): number {
  const i = noteIndex(usd);
  return PENTATONIC_HZ[i % 5]! * 2 ** Math.floor(i / 5);
}

export function chordFrequencies(base: number): number[] {
  return [base, base * 1.25, base * 1.5];
}

export class NoteLimiter {
  private times: number[] = [];

  allow(nowMs: number): boolean {
    this.times = this.times.filter((t) => nowMs - t < 1000);
    if (this.times.length >= MAX_NOTES_PER_SECOND) return false;
    this.times.push(nowMs);
    return true;
  }
}

type AudioSessionNavigator = { audioSession?: { type: string } };

export function preferPlaybackSession(nav: AudioSessionNavigator | undefined = globalThis.navigator as AudioSessionNavigator | undefined): void {
  if (!nav?.audioSession) return;
  try {
    nav.audioSession.type = 'playback';
  } catch (err) {
    console.warn('could not mark the audio session as playback', err);
  }
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export class SkySound {
  enabled: boolean;
  private ctx: AudioContext | null = null;
  private readonly limiter = new NoteLimiter();

  constructor(
    private readonly storage: Storage | null,
    private readonly createContext: () => AudioContext = () => new AudioContext(),
  ) {
    this.enabled = storage?.getItem(SOUND_KEY) === 'on';
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      this.storage?.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch (err) {
      console.warn('could not save the sound setting', err);
    }
    if (!on) return;
    this.ctx ??= this.createContext();
    preferPlaybackSession();
    void this.ctx.resume();
  }

  play(usd: number | null, gold: boolean, nowMs: number, hidden: boolean): void {
    if (!this.enabled || hidden || !this.ctx || !this.limiter.allow(nowMs)) return;
    const base = noteFrequency(usd);
    for (const frequency of gold ? chordFrequencies(base) : [base]) this.tone(frequency, gold ? 0.05 : 0.07);
  }

  private tone(frequency: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.value = frequency;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  }
}
