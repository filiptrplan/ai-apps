// Beat shapes for the dipole model in synth.js. A "morph" describes one kind
// of ventricular complex (QRS parts, T wave, ST currents, U wave); beat()
// turns it into components timed for a given R–R interval.
import { g, plateau, vec, norm, extent, dot, leadVector } from "./synth.js";

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// --- P waves (time 0 = P centre) -------------------------------------------

// Right then left atrial activation: upright in II, biphasic in V1.
export function sinusP(amp = 0.1) {
  return [
    g(-0.012, 0.015, 0.015, norm([0.25, 0.9, 0.45], amp)),
    g(0.014, 0.016, 0.016, norm([0.85, 0.45, -0.5], amp)),
  ];
}

// Atria activated from below: inverted in II, III, aVF.
export function retroP(amp = 0.09) {
  return [g(0, 0.018, 0.018, norm([-0.3, -0.9, 0.15], amp))];
}

// An ectopic atrial focus: a differently shaped (often flatter) P wave.
export function ectopicP() {
  const dir = pick([[0.9, 0.1, -0.3], [-0.2, 0.7, 0.6], [0.7, 0.3, 0.6]]);
  return [g(0, 0.019, 0.019, norm(dir, rand(0.07, 0.09)))];
}

// --- Ventricular complexes (time 0 = main QRS deflection) ------------------

function normalQrs(axis, amp, { septal = true, terminal = true, widen = 1 } = {}) {
  const c = [];
  if (septal) c.push(g(-0.024 * widen, 0.009 * widen, 0.008 * widen, norm([-0.6, 0.15, 0.8], 0.22)));
  c.push(g(0, 0.0105 * widen, 0.0105 * widen, vec(axis, -0.2, amp)));
  if (terminal) c.push(g(0.024 * widen, 0.009 * widen, 0.009 * widen, norm([-0.55, -0.6, -0.45], 0.3)));
  return c;
}

function normalT(axis, amp = rand(0.3, 0.42)) {
  return vec(clamp(axis, -5, 65), 0.45, amp);
}

export function normalMorph({ axis = rand(5, 75), amp = rand(1.2, 1.7) } = {}) {
  return { qrs: normalQrs(axis, amp), tVec: normalT(axis), qtc: rand(0.38, 0.43), st: [], axis };
}

export function lbbbMorph() {
  return {
    qrs: [
      // Septum depolarises right-to-left: no septal q in I/V6, no r in V1.
      g(-0.045, 0.016, 0.016, norm([0.8, 0.2, -0.1], 0.6)),
      g(0, 0.018, 0.018, norm([0.75, 0.35, -0.75], rand(1.6, 1.9))),
      g(0.042, 0.016, 0.016, norm([0.7, 0.05, -0.6], 0.9)),
    ],
    tVec: norm([-0.75, -0.2, 0.75], 0.42),
    tS1: 0.06,
    st: [{ v: norm([-0.75, -0.2, 0.75], 0.12), rise: 0.01, fall: 0.04 }],
    qtc: rand(0.42, 0.45),
  };
}

export function rbbbMorph(axis = rand(10, 55)) {
  return {
    qrs: [
      ...normalQrs(axis, rand(1.0, 1.4), { terminal: false }),
      // Late, slow right-ventricular activation: R′ in V1, wide S in I/V6.
      g(0.058, 0.019, 0.019, norm([-0.6, 0.05, 0.8], rand(0.75, 0.9))),
    ],
    tVec: norm([0.75, 0.55, -0.35], 0.33),
    qtc: rand(0.41, 0.44),
    st: [],
  };
}

export function lafbMorph() {
  const axis = rand(-75, -52);
  return {
    qrs: [
      // Initial forces inferior-rightward: small r in II/III/aVF, q in I/aVL.
      g(-0.026, 0.009, 0.009, norm([-0.3, 0.85, 0.3], 0.32)),
      g(0, 0.011, 0.011, vec(axis, -0.45, rand(1.2, 1.6))),
      g(0.024, 0.009, 0.009, norm([-0.3, -0.3, -0.75], 0.3)),
    ],
    tVec: vec(rand(10, 45), 0.45, rand(0.25, 0.35)),
    qtc: rand(0.38, 0.43),
    st: [],
  };
}

export function lvhMorph(strain) {
  const axis = rand(-10, 40);
  const m = {
    qrs: normalQrs(axis, rand(2.6, 3.2), { widen: 1.12 }),
    tVec: normalT(axis, rand(0.35, 0.5)),
    qtc: rand(0.39, 0.44),
    st: [],
    axis,
  };
  if (strain) {
    const a = axis * (Math.PI / 180);
    m.tVec = norm([-Math.cos(a), -Math.sin(a) * 0.5, 0.6], rand(0.3, 0.4));
    m.tS1 = 0.06;
    m.tS2 = 0.032;
    m.st.push({ v: vec(axis, -0.4, -rand(0.1, 0.14)), rise: 0.01, fall: 0.05 });
  }
  return m;
}

export function rvhMorph() {
  const axis = rand(108, 140);
  return {
    qrs: [
      g(-0.026, 0.008, 0.008, norm([0.2, 0.3, 0.6], 0.15)),
      // Dominant right-anterior forces: tall R in V1, deep S in V6.
      g(0, 0.012, 0.012, vec(axis, 0.75, rand(1.3, 1.6))),
      g(0.026, 0.01, 0.01, norm([-0.5, -0.3, 0.2], 0.35)),
    ],
    tVec: norm([0.65, 0.6, -0.6], 0.3),
    qtc: rand(0.39, 0.43),
    st: [{ v: norm([0.05, 0.1, -1], 0.08), rise: 0.01, fall: 0.05 }],
  };
}

export function wpwMorph() {
  const axis = rand(10, 70);
  const a = axis * (Math.PI / 180);
  return {
    qrs: [
      // Delta wave: early, slow pre-excitation through the accessory pathway.
      g(-0.03, 0.022, 0.03, vec(axis, 0.1, 0.45)),
      g(0, 0.011, 0.011, vec(axis, -0.5, rand(1.3, 1.7))),
      g(0.024, 0.009, 0.009, norm([-0.4, -0.5, -0.75], 0.35)),
    ],
    tVec: norm([-Math.cos(a) * 0.8, -Math.sin(a) * 0.8, 0.5], 0.25),
    qtc: rand(0.39, 0.43),
    st: [],
  };
}

// An ectopic ventricular focus: wide, bizarre, with discordant ST/T.
// RV origin looks LBBB-like, LV origin RBBB-like.
export function ventricularMorph() {
  const z = chance(0.5) ? -0.8 : 0.8;
  // Point it so the beat stands out on the rhythm strip (II and V1), rather
  // than running nearly perpendicular to those leads.
  let axis;
  do axis = rand(-180, 180);
  while (Math.abs(dot(vec(axis, z, 1), leadVector("II"))) < 0.45);
  const turn = rand(15, 35) * (chance(0.5) ? 1 : -1);
  return {
    qrs: [
      g(-0.035, 0.022, 0.022, vec(axis + turn, z, rand(0.5, 0.8))),
      g(0.022, 0.026, 0.026, vec(axis, z, rand(1.8, 2.3))),
    ],
    tVec: vec(axis + 180, -z, rand(0.45, 0.6)),
    tS1: 0.06,
    tS2: 0.045,
    st: [{ v: vec(axis + 180, -z, 0.1), rise: 0.015, fall: 0.05 }],
    qtc: rand(0.43, 0.46),
    axis,
  };
}

const INJURY = {
  inferior: [-0.3, 1, 0.05],
  anterior: [0.25, 0.15, 1],
  lateral: [1, -0.55, 0.15],
};

export function stemiMorph(territory) {
  const m = normalMorph();
  const v = norm(INJURY[territory], rand(0.3, 0.42));
  m.st.push({ v, rise: 0.006, fall: 0.03 });
  // Hyperacute T waves point the same way as the injury current.
  m.tVec = m.tVec.map((c, i) => c + v[i] * 0.6);
  return m;
}

export function posteriorMorph() {
  const m = normalMorph();
  // Loss of posterior forces shows up as tall R waves in V1–V2.
  m.qrs.push(g(0.004, 0.012, 0.012, norm([0, 0, 1], rand(0.8, 1.0))));
  m.st.push({ v: norm([0.1, 0.15, -1], rand(0.26, 0.34)), rise: 0.006, fall: 0.03 });
  return m;
}

export function pericarditisMorph() {
  const m = normalMorph({ axis: rand(30, 70) });
  m.st.push({ v: norm([0.45, 0.75, 0.45], rand(0.2, 0.26)), rise: 0.02, fall: 0.04 });
  m.prSeg = norm([-0.45, -0.75, -0.3], rand(0.08, 0.1));
  return m;
}

export function hyperkMorph() {
  const axis = rand(15, 70);
  return {
    qrs: normalQrs(axis, rand(1.1, 1.5), { widen: 1.12 }),
    tVec: vec(clamp(axis, 20, 60), 0.75, rand(0.75, 1.0)),
    tS1: 0.032,
    tS2: 0.03,
    qtc: rand(0.37, 0.4),
    st: [],
    pAmp: 0.045,
  };
}

export function hypokMorph() {
  const m = normalMorph();
  const tDir = m.tVec;
  m.tVec = tDir.map((c) => c * 0.35);
  m.u = norm(tDir, rand(0.13, 0.17));
  m.st.push({ v: norm(tDir, -0.07), rise: 0.01, fall: 0.06 });
  return m;
}

export function longQtMorph() {
  const m = normalMorph();
  m.qtc = rand(0.52, 0.6);
  m.tS1 = 0.08;
  m.tS2 = 0.058;
  return m;
}

// Times the T (and ST, U) of a morph for an R–R interval. Returns
// components with time 0 = the morph's own zero, plus where the QRS starts
// and ends and the QT.
export function beat(m, rr) {
  const [onset, end] = extent(m.qrs);
  const f = Math.sqrt(clamp(rr, 0.45, 1.3));
  const s1 = (m.tS1 ?? 0.055) * f;
  const s2 = (m.tS2 ?? 0.04) * f;
  const qt = m.qtc * Math.cbrt(clamp(rr, 0.3, 2)); // Fridericia
  const tPeak = onset + qt - 2.5 * s2;
  const comps = [...m.qrs, g(tPeak, s1, s2, m.tVec)];
  for (const st of m.st) comps.push(plateau(end - 0.004, tPeak + 0.03, st.rise, st.fall, st.v));
  if (m.u) comps.push(g(tPeak + 2.5 * s2 + 0.07, 0.035, 0.035, m.u));
  return { comps, onset, end, qt };
}

// Collects P waves and QRS complexes on a shared timeline (seconds).
export class Timeline {
  constructor() {
    this.events = [];
    this.qrs = []; // QRS onsets
    this.p = []; // P onsets
  }

  // A P wave starting at `onset`. `segment` (PR-segment current) runs from
  // the end of the P to `segmentUntil`.
  addP(onset, comps, segment, segmentUntil) {
    const [on, end] = extent(comps);
    const all = segment ? [...comps, plateau(end, segmentUntil - onset + on, 0.008, 0.008, segment)] : comps;
    this.events.push({ t: onset - on, comps: all });
    this.p.push(onset);
  }

  // A ventricular complex (from beat()) whose QRS starts at `onset`.
  addQrs(onset, b) {
    this.events.push({ t: onset - b.onset, comps: b.comps });
    this.qrs.push(onset);
  }

  // A sinus-conducted beat: P, then QRS after `pr`.
  addConducted(qrsOnset, pr, b, m) {
    this.addP(qrsOnset - pr, sinusP(m.pAmp ?? rand(0.09, 0.12)), m.prSeg, qrsOnset);
    this.addQrs(qrsOnset, b);
  }
}
