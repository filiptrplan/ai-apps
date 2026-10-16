// Synthesizes 12-lead ECGs from a moving cardiac dipole: every wave (P, the
// parts of the QRS, T, U, ST injury currents) is a 3D vector with a time
// course, and each lead records that vector's projection onto its own
// direction. Axis, R-wave progression and reciprocal ST changes then fall
// out of the geometry instead of being drawn lead by lead.
//
// Coordinates: x = patient's left, y = inferior (feet), z = anterior. mV.

export const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

const DEG = Math.PI / 180;

// Hexaxial angle and gain (the augmented leads are 0.87× by Einthoven).
const LIMB = { I: [0, 1], II: [60, 1], III: [120, 1], aVR: [-150, 0.87], aVL: [-30, 0.87], aVF: [90, 0.87] };
// Angle in the horizontal plane (0 = patient's left, 90 = straight anterior),
// inferior tilt, and gain (chest electrodes sit closer to the heart).
const CHEST = {
  V1: [118, 0, 1.25],
  V2: [96, 0, 1.7],
  V3: [76, 0.1, 1.7],
  V4: [56, 0.2, 1.6],
  V5: [32, 0.2, 1.35],
  V6: [8, 0.2, 1.1],
};

export function leadVector(name) {
  if (LIMB[name]) {
    const [a, gain] = LIMB[name];
    return [Math.cos(a * DEG) * gain, Math.sin(a * DEG) * gain, 0];
  }
  const [a, tilt, gain] = CHEST[name];
  const v = norm([Math.cos(a * DEG), tilt, Math.sin(a * DEG)], 1);
  return v.map((c) => c * gain);
}

const LEAD_VECTORS = LEADS.map(leadVector);

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// A vector of length `mag` in the direction (x, y, z).
export function norm([x, y, z], mag) {
  const n = Math.hypot(x, y, z) || 1;
  return [(x / n) * mag, (y / n) * mag, (z / n) * mag];
}

// A vector at `frontal` degrees on the hexaxial reference (0 = lead I,
// +90 = aVF), tipped forward by z, of length `mag`.
export function vec(frontal, z, mag) {
  return norm([Math.cos(frontal * DEG), Math.sin(frontal * DEG), z], mag);
}

export function rotate(v, frontalDeg) {
  const c = Math.cos(frontalDeg * DEG), s = Math.sin(frontalDeg * DEG);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

export function scale(v, k) {
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// Asymmetric Gaussian hump centred at t (s), with rise/fall widths s1/s2.
export function g(t, s1, s2, v) {
  return { kind: "g", t, s1, s2, v };
}

// A smooth plateau switched on around `from` and off around `to`, e.g. an
// ST-segment injury current or PR-segment depression.
export function plateau(from, to, rise, fall, v) {
  return { kind: "p", from, to, rise, fall, v };
}

function sig(x) {
  return 1 / (1 + Math.exp(-x));
}

function shape(c, tau) {
  if (c.kind === "g") {
    const d = tau - c.t;
    const s = d < 0 ? c.s1 : c.s2;
    return Math.exp(-(d * d) / (2 * s * s));
  }
  return sig((tau - c.from) / c.rise) * sig((c.to - tau) / c.fall);
}

function support(c) {
  if (c.kind === "g") return [c.t - 5 * c.s1, c.t + 5 * c.s2];
  return [c.from - 8 * c.rise, c.to + 8 * c.fall];
}

// Where a set of Gaussian components visibly starts and ends.
export function extent(comps) {
  let on = Infinity, end = -Infinity;
  for (const c of comps) {
    if (c.kind !== "g") continue;
    on = Math.min(on, c.t - 2.5 * c.s1);
    end = Math.max(end, c.t + 2.5 * c.s2);
  }
  return [on, end];
}

// Net area of a set of components as recorded by one lead — the sum of
// positive and negative deflections, as used for the axis.
export function netArea(comps, lead) {
  const lv = leadVector(lead);
  let a = 0;
  for (const c of comps) {
    if (c.kind !== "g") continue;
    a += dot(lv, c.v) * Math.sqrt(Math.PI / 2) * (c.s1 + c.s2);
  }
  return a;
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Renders a recording: `events` place component lists at absolute times,
// `continuous(t)` (optional) adds a vector that isn't beat-locked (atrial
// fibrillation, flutter, VF). Returns one Float32Array per lead, in mV.
export function render({ events, continuous, duration = 10, fs = 500, noise = 1 }) {
  const n = Math.round(duration * fs);
  const out = LEADS.map(() => new Float32Array(n));
  const L = LEADS.length;

  for (const ev of events) {
    for (const c of ev.comps) {
      const proj = LEAD_VECTORS.map((lv) => dot(lv, c.v));
      const [a, b] = support(c);
      const i0 = Math.max(0, Math.ceil((ev.t + a) * fs));
      const i1 = Math.min(n - 1, Math.floor((ev.t + b) * fs));
      for (let i = i0; i <= i1; i++) {
        const s = shape(c, i / fs - ev.t);
        for (let l = 0; l < L; l++) out[l][i] += proj[l] * s;
      }
    }
  }

  if (continuous) {
    for (let i = 0; i < n; i++) {
      const v = continuous(i / fs);
      for (let l = 0; l < L; l++) out[l][i] += dot(LEAD_VECTORS[l], v);
    }
  }

  if (noise > 0) {
    for (let l = 0; l < L; l++) {
      const w1 = (0.02 + Math.random() * 0.03) * noise, f1 = 0.15 + Math.random() * 0.2, p1 = Math.random() * 6.3;
      const w2 = 0.015 * noise, f2 = 0.05 + Math.random() * 0.08, p2 = Math.random() * 6.3;
      const hiss = 0.006 * noise;
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        out[l][i] += w1 * Math.sin(2 * Math.PI * f1 * t + p1) + w2 * Math.sin(2 * Math.PI * f2 * t + p2) + hiss * gauss();
      }
    }
  }

  const leads = {};
  LEADS.forEach((name, l) => (leads[name] = out[l]));
  return { leads, fs, duration };
}
