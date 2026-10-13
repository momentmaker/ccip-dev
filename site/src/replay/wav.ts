export interface PcmAudio {
  channels: readonly Float32Array[];
  sampleRate: number;
}

/** A 16-bit PCM WAV of the channels, interleaved: the soundtrack ffmpeg muxes into the silent video as AAC. */
export function wavBytes({ channels, sampleRate }: PcmAudio): Uint8Array<ArrayBuffer> {
  const frames = channels[0]?.length ?? 0;
  const blockAlign = channels.length * 2;
  const dataBytes = frames * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let f = 0; f < frames; f++) {
    channels.forEach((channel, c) => {
      const v = Math.max(-1, Math.min(1, channel[f] ?? 0));
      view.setInt16(44 + (f * channels.length + c) * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
    });
  }
  return new Uint8Array(view.buffer);
}
