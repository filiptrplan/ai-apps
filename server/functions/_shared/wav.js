// Wraps raw 16-bit little-endian PCM (as the speech APIs return it) in a WAV
// file, which every browser plays. Podcast episodes have been stored as WAV
// since the Supabase days, when there was too little CPU to encode mp3.

export function wavFile(chunks, sampleRate, channels) {
  const dataBytes = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (at, s) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // bytes per second
  view.setUint16(32, channels * 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { bytes: out, seconds: dataBytes / (sampleRate * channels * 2) };
}
