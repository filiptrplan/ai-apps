// Joins mp3 clips (one per podcast line) into one file. MPEG audio is a
// plain run of frames, so clips can be concatenated, but each clip from the
// speech API may start with an ID3 tag and a Xing/Info frame that tells
// players the length of that one clip; those are dropped so players work
// out the length of the whole file. Counting the frames gives the exact
// length, which the app shows instead of trusting the player's estimate.

const BITRATES: Record<string, number[]> = {
  // kbit/s by bitrate index, Layer III
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

interface Frame {
  length: number;
  samples: number;
  sampleRate: number;
  sideInfo: number;
}

// The Layer III frame starting at `i`, or null if there isn't one.
function frameAt(b: Uint8Array, i: number): Frame | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  const bitrateIndex = b[i + 2] >> 4;
  const rateIndex = (b[i + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const bitrate = BITRATES[mpeg1 ? "v1" : "v2"][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const padding = (b[i + 2] >> 1) & 1;
  const mono = b[i + 3] >> 6 === 3;
  return {
    length: Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding,
    samples: mpeg1 ? 1152 : 576,
    sampleRate,
    sideInfo: mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17),
  };
}

function id3Length(b: Uint8Array) {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0; // "ID3"
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

function hasTag(b: Uint8Array, at: number, tags: string[]) {
  const s = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  return tags.includes(s);
}

// The audio frames of one clip, without its tags and info frame.
function audioFrames(clip: Uint8Array) {
  const parts: Uint8Array[] = [];
  let seconds = 0;
  let i = id3Length(clip);
  let first = true;
  while (i < clip.length) {
    const f = frameAt(clip, i);
    if (!f || i + f.length > clip.length) {
      // Skip junk between frames; stop at a trailing tag or the end.
      if (clip[i] === 0x54 && clip[i + 1] === 0x41 && clip[i + 2] === 0x47) break; // ID3v1 "TAG"
      i++;
      continue;
    }
    const info = first && (hasTag(clip, i + 4 + f.sideInfo, ["Xing", "Info"]) || hasTag(clip, i + 36, ["VBRI"]));
    if (!info) {
      parts.push(clip.subarray(i, i + f.length));
      seconds += f.samples / f.sampleRate;
    }
    first = false;
    i += f.length;
  }
  return { parts, seconds };
}

// A Xing frame for the whole file: a silent frame shaped like `model`
// carrying the frame and byte counts, so players show the right length.
function xingFrame(model: Uint8Array, frames: number, audioBytes: number) {
  const header = model.slice(0, 4);
  header[2] &= ~0x02; // no padding
  const f = frameAt(header, 0)!;
  const out = new Uint8Array(f.length);
  out.set(header);
  const view = new DataView(out.buffer);
  let at = 4 + f.sideInfo;
  out.set([0x58, 0x69, 0x6e, 0x67], at); // "Xing"
  view.setUint32(at + 4, 0x3); // frame and byte counts present
  view.setUint32(at + 8, frames + 1);
  view.setUint32(at + 12, audioBytes + out.length);
  return out;
}

export function joinMp3(clips: Uint8Array[]): { bytes: Uint8Array; seconds: number } {
  const all: Uint8Array[] = [];
  let seconds = 0;
  for (const clip of clips) {
    const { parts, seconds: s } = audioFrames(clip);
    all.push(...parts);
    seconds += s;
  }
  if (all.length) {
    const audioBytes = all.reduce((n, p) => n + p.length, 0);
    all.unshift(xingFrame(all[0], all.length, audioBytes));
  }
  const bytes = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    bytes.set(p, at);
    at += p.length;
  }
  return { bytes, seconds };
}
