let audioCtx = null;
export function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function beep(freq, duration, volume = 0.2, type = "sine", delay = 0) {
  try {
    const ctx = getAudioCtx();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch {}
}

export const sounds = {
  countdown: () => beep(880, 0.1, 0.18, "sine"),
  workStart: () => beep(660, 0.18, 0.22, "square"),
  restStart: () => beep(440, 0.18, 0.22, "sine"),
  finish: () => {
    beep(523, 0.15, 0.22, "sine", 0);
    beep(659, 0.15, 0.22, "sine", 0.15);
    beep(784, 0.3, 0.24, "sine", 0.3);
  },
};
