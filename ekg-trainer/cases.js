// The diagnoses the trainer knows, how to generate a random example of
// each, and the answer key for the systematic questions.
import { render, netArea, norm } from "./synth.js";
import {
  rand, pick, chance, Timeline, beat, sinusP, retroP, ectopicP,
  normalMorph, lbbbMorph, rbbbMorph, lafbMorph, lvhMorph, rvhMorph, wpwMorph, ventricularMorph,
  stemiMorph, posteriorMorph, pericarditisMorph, hyperkMorph, hypokMorph, longQtMorph,
} from "./morphology.js";

const START = -2.5;
const END = 12;

export const QUESTIONS = [
  {
    id: "rate",
    title: "Rate",
    hint: "300 ÷ large boxes between R waves, or QRS count in the 10 s strip × 6",
    options: [["slow", "< 60"], ["normal", "60–100"], ["fast", "> 100"]],
  },
  {
    id: "rhythm",
    title: "Rhythm",
    hint: "March out the R–R intervals",
    options: [["regular", "Regular"], ["regIrreg", "Regularly irregular / patterned"], ["irregIrreg", "Irregularly irregular"]],
  },
  {
    id: "p",
    title: "P waves",
    hint: "Look in II and V1",
    options: [
      ["normal", "Normal, one before each QRS"],
      ["more", "More P waves than QRS"],
      ["absent", "Absent / not visible"],
      ["retro", "Inverted / retrograde"],
      ["fib", "Fibrillatory baseline"],
      ["flutter", "Flutter (sawtooth) waves"],
    ],
  },
  {
    id: "pr",
    title: "PR interval",
    hint: "Normal is 3–5 small boxes",
    options: [
      ["normal", "Normal (120–200 ms)"],
      ["short", "Short (< 120 ms)"],
      ["long", "Prolonged, fixed (> 200 ms)"],
      ["progressive", "Progressively lengthening"],
      ["variable", "Variable, no relation to QRS"],
      ["na", "Not measurable"],
    ],
  },
  {
    id: "qrs",
    title: "QRS width",
    hint: "3 small boxes = 120 ms",
    options: [["narrow", "Narrow (< 120 ms)"], ["wide", "Wide (≥ 120 ms)"]],
  },
  {
    id: "axis",
    title: "Axis",
    hint: "Net QRS in I and aVF",
    twelve: true,
    options: [
      ["normal", "Normal (−30° to +90°)"],
      ["left", "Left (−30° to −90°)"],
      ["right", "Right (+90° to +180°)"],
      ["extreme", "Extreme (−90° to ±180°)"],
    ],
  },
  {
    id: "st",
    title: "ST segments & T waves",
    hint: "Compare the ST segment with the PR/TP baseline",
    twelve: true,
    options: [
      ["normal", "Normal"],
      ["regional", "ST elevation in one territory"],
      ["diffuse", "Diffuse ST elevation"],
      ["depression", "ST depression / T inversion"],
      ["peaked", "Peaked T waves"],
      ["flatU", "Flat T waves, U waves"],
      ["secondary", "Secondary to wide QRS"],
    ],
  },
  {
    id: "qt",
    title: "QTc",
    hint: "T ending past halfway between R waves = long",
    twelve: true,
    options: [["normal", "Normal"], ["long", "Prolonged"]],
  },
];

export const GROUPS = [
  { id: "sinus", title: "Sinus & atrial" },
  { id: "ventricular", title: "Ventricular" },
  { id: "block", title: "AV block" },
  { id: "conduction", title: "Conduction & hypertrophy" },
  { id: "ischaemia", title: "Ischaemia & pericardium" },
  { id: "metabolic", title: "Electrolytes & QT" },
];

// Rhythm diagnoses can be practised on a 2-lead strip; the rest need all 12.
const STRIP_GROUPS = new Set(["sinus", "ventricular", "block"]);

// --- Rhythm generators -----------------------------------------------------
// Each returns { tl, morph, truth, facts } (continuous: optional).

function sinusRhythm({ rate, pr = rand(0.13, 0.19), m = normalMorph(), modulation = 0 }) {
  const tl = new Timeline();
  const rr = 60 / rate;
  const b = beat(m, rr);
  const phase = rand(0, 6.3);
  for (let t = START + rand(0, rr); t < END; ) {
    tl.addConducted(t, pr, b, m);
    t += rr * (1 + modulation * Math.sin(phase + (t * 2 * Math.PI) / 4.5));
  }
  return { tl, m, pr };
}

// A sinus rhythm with a morphology, for the 12-lead diagnoses.
function sinusWith(m, truth, opts = {}) {
  const { tl, pr } = sinusRhythm({ rate: opts.rate ?? rand(62, 96), pr: opts.pr, m });
  return {
    tl,
    morph: m,
    truth: { rhythm: "regular", p: "normal", pr: "normal", qrs: "narrow", st: "normal", qt: "normal", ...truth },
    facts: { pr: Math.round(pr * 1000) },
  };
}

function fibrillation(n, ampRange, freqRange, bias) {
  const waves = Array.from({ length: n }, () => ({
    f: rand(...freqRange),
    p: rand(0, 6.3),
    v: norm([rand(-1, 1) + bias[0], rand(-1, 1) + bias[1], rand(-1, 1) + bias[2]], rand(...ampRange)),
    mf: rand(0.1, 0.5),
    mp: rand(0, 6.3),
  }));
  return (t) => {
    const out = [0, 0, 0];
    for (const w of waves) {
      const k = Math.sin(2 * Math.PI * w.f * t + w.p) * (0.6 + 0.4 * Math.sin(2 * Math.PI * w.mf * t + w.mp));
      out[0] += w.v[0] * k;
      out[1] += w.v[1] * k;
      out[2] += w.v[2] * k;
    }
    return out;
  };
}

const GENERATORS = {
  nsr: () => sinusWith(normalMorph(), {}, { rate: rand(64, 96) }),
  sinus_brady: () => sinusWith(normalMorph(), {}, { rate: rand(38, 54) }),
  sinus_tachy: () => sinusWith(normalMorph(), {}, { rate: rand(108, 150), pr: rand(0.12, 0.16) }),

  sinus_arrhythmia: () => {
    const m = normalMorph();
    const { tl, pr } = sinusRhythm({ rate: rand(66, 86), m, modulation: rand(0.18, 0.24) });
    return {
      tl, morph: m,
      truth: { rhythm: "regIrreg", p: "normal", pr: "normal", qrs: "narrow", st: "normal", qt: "normal" },
      facts: { pr: Math.round(pr * 1000) },
    };
  },

  pac: () => {
    const m = normalMorph();
    const rr = 60 / rand(64, 88);
    const pr = rand(0.13, 0.18);
    const b = beat(m, rr);
    const tl = new Timeline();
    const count = pick([2, 2, 3]);
    let last = -1;
    let made = 0;
    for (let t = START + rand(0, rr); t < END; ) {
      tl.addConducted(t, pr, b, m);
      const canPac = t > 0.3 && t < 8.8 && made < count && last !== tl.qrs.length - 1;
      if (canPac && chance(0.35)) {
        const at = t + rr * rand(0.58, 0.7);
        const ppr = rand(0.14, 0.18);
        tl.addP(at - ppr, ectopicP());
        tl.addQrs(at, b);
        last = tl.qrs.length - 1;
        made++;
        t = at + rr; // the PAC resets the sinus node: no compensatory pause
      } else {
        t += rr;
      }
    }
    return {
      tl, morph: m,
      truth: { rhythm: "regIrreg", p: "normal", pr: "normal", qrs: "narrow", st: "normal", qt: "normal" },
      facts: { pr: Math.round(pr * 1000), note: `${made} premature atrial beat${made === 1 ? "" : "s"}` },
      valid: made >= 1,
    };
  },

  af: () => {
    const m = normalMorph();
    const mean = 60 / rand(72, 150);
    const b = beat(m, mean);
    const tl = new Timeline();
    for (let t = START + rand(0, mean); t < END; ) {
      tl.addQrs(t, b);
      t += Math.max(0.32, mean * rand(0.6, 1.4));
    }
    const coarse = chance(0.4);
    return {
      tl, morph: m,
      continuous: fibrillation(5, coarse ? [0.04, 0.07] : [0.02, 0.04], [4.5, 8], [0, 0.3, 0.9]),
      truth: { rhythm: "irregIrreg", p: "fib", pr: "na", qrs: "narrow", st: "normal" },
      facts: { pr: "—", note: coarse ? "coarse fibrillatory waves" : "fine fibrillatory waves" },
    };
  },

  aflutter: () => {
    const m = normalMorph();
    const ar = rand(270, 320);
    const period = 60 / ar;
    const block = pick([2, 2, 4, "variable"]);
    const mean = period * (block === "variable" ? 3 : block);
    const b = beat(m, mean);
    const tl = new Timeline();
    const phase = rand(0, period);
    const conduction = rand(0.2, 0.26);
    for (let n = Math.ceil((START - phase) / period); ; ) {
      const t = phase + n * period + conduction;
      if (t > END) break;
      tl.addQrs(t, b);
      n += block === "variable" ? pick([2, 3, 4, 4]) : block;
    }
    const amp = rand(0.24, 0.3);
    const dir = norm([0.1, -1, 0.35], 1);
    return {
      tl, morph: m,
      continuous: (t) => {
        // Slow rise then fast fall along a superior vector: the classic
        // negative sawtooth in II, III, aVF.
        const u = ((((t - phase) % period) + period) % period) / period;
        const s = u < 0.8 ? -1 + (2 * u) / 0.8 : 1 - (2 * (u - 0.8)) / 0.2;
        return [dir[0] * s * amp, dir[1] * s * amp, dir[2] * s * amp];
      },
      truth: {
        rhythm: block === "variable" ? ["regIrreg", "irregIrreg"] : "regular",
        p: "flutter", pr: "na", qrs: "narrow", st: "normal",
      },
      facts: {
        pr: "—",
        atrialRate: Math.round(ar),
        note: block === "variable" ? "variable block" : `${block}:1 block`,
      },
    };
  },

  svt: () => {
    const m = normalMorph();
    const rr = 60 / rand(155, 215);
    const b = beat(m, rr);
    // Retrograde P buried at the very end of the QRS.
    b.comps = [...b.comps, ...retroP(0.05).map((c) => ({ ...c, t: c.t + 0.045 }))];
    const tl = new Timeline();
    for (let t = START + rand(0, rr); t < END; t += rr) tl.addQrs(t, b);
    return {
      tl, morph: m,
      truth: { rhythm: "regular", p: "absent", pr: "na", qrs: "narrow", st: "normal" },
      facts: { pr: "—" },
    };
  },

  junctional: () => {
    const m = normalMorph();
    const rr = 60 / rand(42, 56);
    const b = beat(m, rr);
    const before = chance(0.6);
    const pr = rand(0.06, 0.09);
    const tl = new Timeline();
    for (let t = START + rand(0, rr); t < END; t += rr) {
      if (before) tl.addP(t - pr, retroP());
      tl.addQrs(t, b);
    }
    return {
      tl, morph: m,
      truth: {
        rhythm: "regular",
        p: before ? "retro" : "absent",
        pr: before ? "short" : "na",
        qrs: "narrow", st: "normal", qt: "normal",
      },
      facts: { pr: before ? Math.round(pr * 1000) : "—", note: before ? "retrograde P before each QRS" : "P waves hidden in the QRS" },
    };
  },

  pvc: () => {
    const m = normalMorph();
    const pvc = ventricularMorph();
    const rr = 60 / rand(62, 90);
    const pr = rand(0.13, 0.18);
    const b = beat(m, rr);
    const bp = beat(pvc, rr);
    const bigeminy = chance(0.35);
    const tl = new Timeline();
    let made = 0;
    let lastPvc = -10;
    let blocked = false;
    for (let i = 0, t = START + rand(0, rr); t < END; i++, t += rr) {
      if (blocked) {
        // This sinus P falls inside the PVC and isn't conducted.
        tl.addP(t - pr, sinusP());
        blocked = false;
        continue;
      }
      tl.addConducted(t, pr, b, m);
      const want = bigeminy ? true : t > 0.3 && t < 8.5 && i - lastPvc > 2 && made < 3 && chance(0.3);
      if (want) {
        tl.addQrs(t + rr * rand(0.55, 0.65), bp);
        lastPvc = i;
        made++;
        blocked = true;
      }
    }
    return {
      tl, morph: m,
      truth: { rhythm: "regIrreg", p: "normal", pr: "normal", qrs: "narrow", st: "normal", qt: "normal" },
      facts: { pr: Math.round(pr * 1000), note: bigeminy ? "ventricular bigeminy" : "isolated PVCs" },
      valid: made >= 1,
    };
  },

  vt: () => {
    const m = ventricularMorph();
    const rr = 60 / rand(150, 210);
    const b = beat(m, rr);
    const tl = new Timeline();
    for (let t = START + rand(0, rr); t < END; t += rr) tl.addQrs(t, b);
    // Sinus P waves carry on independently (AV dissociation), mostly hidden.
    const prr = 60 / rand(70, 95);
    for (let t = START + rand(0, prr); t < END; t += prr) tl.addP(t, sinusP(0.06));
    return {
      tl, morph: m,
      truth: { rhythm: "regular", p: "absent", pr: ["na", "variable"], qrs: "wide" },
      facts: { pr: "—" },
    };
  },

  vf: () => ({
    tl: new Timeline(),
    morph: null,
    continuous: fibrillation(4, [0.25, 0.5], [3.5, 7], [0, 0, 0]),
    truth: {},
    facts: {},
  }),

  avb1: () => sinusWith(normalMorph(), { pr: "long" }, { rate: rand(62, 90), pr: rand(0.24, 0.36) }),

  mobitz1: () => {
    const m = normalMorph();
    const pp = 60 / rand(74, 100);
    const n = pick([3, 4, 4, 5]); // P waves per group, the last one dropped
    const pr0 = rand(0.15, 0.19);
    const b = beat(m, pp * (n / (n - 1)));
    const tl = new Timeline();
    let k = Math.floor(rand(0, n));
    let longest = pr0;
    for (let t = START + rand(0, pp); t < END; t += pp, k = (k + 1) % n) {
      if (k === n - 1) {
        tl.addP(t, sinusP());
        continue;
      }
      let pr = pr0;
      for (let j = 1; j <= k; j++) pr += 0.1 * Math.pow(0.6, j - 1);
      tl.addP(t, sinusP());
      tl.addQrs(t + pr, b);
      longest = Math.max(longest, pr);
    }
    return {
      tl, morph: m,
      truth: { rhythm: "regIrreg", p: "more", pr: "progressive", qrs: "narrow", st: "normal" },
      facts: { pr: `${Math.round(pr0 * 1000)} to ${Math.round(longest * 1000)}`, atrialRate: Math.round(60 / pp), note: `${n}:${n - 1} Wenckebach` },
    };
  },

  mobitz2: () => {
    const wide = chance(0.55);
    const m = wide ? rbbbMorph() : normalMorph();
    const pp = 60 / rand(76, 100);
    const n = pick([3, 4]);
    const pr = rand(0.14, 0.19);
    const b = beat(m, pp * (n / (n - 1)));
    const tl = new Timeline();
    let k = Math.floor(rand(0, n));
    for (let t = START + rand(0, pp); t < END; t += pp, k = (k + 1) % n) {
      tl.addP(t, sinusP());
      if (k !== n - 1) tl.addQrs(t + pr, b);
    }
    return {
      tl, morph: m,
      truth: { rhythm: "regIrreg", p: "more", pr: "normal", qrs: wide ? "wide" : "narrow", st: wide ? ["secondary", "depression", "normal"] : "normal" },
      facts: { pr: Math.round(pr * 1000), atrialRate: Math.round(60 / pp), note: `${n}:${n - 1} conduction${wide ? " with RBBB" : ""}` },
    };
  },

  avb3: () => {
    const ventricular = chance(0.45);
    const m = ventricular ? ventricularMorph() : normalMorph();
    const rr = 60 / (ventricular ? rand(26, 40) : rand(38, 52));
    const b = beat(m, rr);
    const tl = new Timeline();
    for (let t = START + rand(0, rr); t < END; t += rr) tl.addQrs(t, b);
    const pp = 60 / rand(70, 100);
    for (let t = START + rand(0, pp); t < END; t += pp) tl.addP(t, sinusP());
    return {
      tl, morph: m,
      truth: { rhythm: "regular", p: "more", pr: "variable", qrs: ventricular ? "wide" : "narrow", st: ventricular ? ["secondary", "depression"] : "normal" },
      facts: { pr: "varies", atrialRate: Math.round(60 / pp), note: ventricular ? "ventricular escape rhythm" : "junctional escape rhythm" },
    };
  },

  lbbb: () => sinusWith(lbbbMorph(), { qrs: "wide", st: "secondary" }),
  rbbb: () => sinusWith(rbbbMorph(), { qrs: "wide", st: ["secondary", "depression"] }),
  lafb: () => sinusWith(lafbMorph(), {}),
  lvh: () => {
    const strain = chance(0.65);
    const r = sinusWith(lvhMorph(strain), { st: strain ? ["depression", "secondary"] : "normal" });
    r.facts.note = strain ? "with strain pattern" : "voltage criteria only";
    return r;
  },
  rvh: () => sinusWith(rvhMorph(), { st: ["depression", "secondary"] }),
  wpw: () => sinusWith(wpwMorph(), { pr: "short", qrs: "wide", st: ["secondary", "depression", "normal"] }, { pr: rand(0.085, 0.105) }),

  stemi_inf: () => sinusWith(stemiMorph("inferior"), { st: "regional" }),
  stemi_ant: () => sinusWith(stemiMorph("anterior"), { st: "regional" }),
  stemi_lat: () => sinusWith(stemiMorph("lateral"), { st: "regional" }),
  stemi_post: () => sinusWith(posteriorMorph(), { st: "depression" }),
  pericarditis: () => sinusWith(pericarditisMorph(), { st: "diffuse" }, { rate: rand(70, 96) }),

  hyperk: () => sinusWith(hyperkMorph(), { st: "peaked" }),
  hypok: () => sinusWith(hypokMorph(), { st: ["flatU", "depression"], qt: ["normal", "long"] }),
  long_qt: () => sinusWith(longQtMorph(), { qt: "long" }, { rate: rand(62, 82) }),
};

// --- Diagnoses and teaching points -----------------------------------------

export const DIAGNOSES = [
  {
    id: "nsr", group: "sinus", label: "Normal sinus rhythm",
    features: ["Rate 60–100, regular", "Upright P wave in II before every QRS, PR 120–200 ms", "Narrow QRS (< 120 ms)"],
    pearl: "Read every ECG the same way — rate, rhythm, P, PR, QRS, axis, ST/T, QT — and normal becomes easy to call.",
  },
  {
    id: "sinus_brady", group: "sinus", label: "Sinus bradycardia",
    features: ["Sinus P waves with a normal PR", "Rate < 60"],
    pearl: "Normal in athletes and during sleep. Otherwise think β-blockers, hypothyroidism, hypothermia, raised ICP, inferior MI.",
  },
  {
    id: "sinus_tachy", group: "sinus", label: "Sinus tachycardia",
    features: ["Sinus P waves before every QRS (may merge into the preceding T at higher rates)", "Rate > 100, usually ≤ 150 at rest"],
    pearl: "Treat the cause: pain, fever, hypovolaemia, PE, anaemia, thyrotoxicosis. A rate fixed at ~150 should make you look for flutter with 2:1 block.",
  },
  {
    id: "sinus_arrhythmia", group: "sinus", label: "Sinus arrhythmia",
    features: ["Identical sinus P waves and PR intervals", "R–R interval varies cyclically (shortens with inspiration)"],
    pearl: "A normal finding, especially in young people.",
  },
  {
    id: "pac", group: "sinus", label: "Premature atrial complexes",
    features: ["Early beat with a P wave of different shape", "Narrow QRS identical to the sinus beats", "Non-compensatory pause — the sinus node resets"],
    pearl: "Usually benign (caffeine, stress, alcohol). Frequent PACs can herald atrial fibrillation.",
  },
  {
    id: "af", group: "sinus", label: "Atrial fibrillation",
    features: ["Irregularly irregular R–R intervals", "No P waves — fine or coarse fibrillatory baseline, often best seen in V1", "Narrow QRS"],
    pearl: "Decide on rate vs rhythm control, and score CHA₂DS₂-VASc for anticoagulation.",
  },
  {
    id: "aflutter", group: "sinus", label: "Atrial flutter",
    features: ["Sawtooth flutter waves at ~300/min — negative in II, III, aVF, positive in V1", "Fixed block gives a regular rhythm (2:1 → ~150, 4:1 → ~75); variable block is irregular"],
    pearl: "A regular narrow tachycardia at ~150 is flutter with 2:1 block until proven otherwise — hunt for the second flutter wave hidden in the QRS or T.",
  },
  {
    id: "svt", group: "sinus", label: "SVT (AVNRT)",
    features: ["Regular narrow-complex tachycardia, usually 150–220", "No visible P waves — the retrograde P hides in or just after the QRS (pseudo-r′ in V1, pseudo-S in II)"],
    pearl: "Vagal manoeuvres (modified Valsalva) first, then adenosine.",
  },
  {
    id: "junctional", group: "sinus", label: "Junctional rhythm",
    features: ["Regular, narrow QRS at 40–60", "P waves absent, or inverted in II/III/aVF with a short PR (retrograde activation)"],
    pearl: "An escape rhythm when the sinus node fails — look for digoxin toxicity, β-blockers, ischaemia, sick sinus.",
  },
  {
    id: "pvc", group: "ventricular", label: "Premature ventricular complexes",
    features: ["Early wide, bizarre QRS (≥ 120 ms) with no P wave before it", "ST/T pointing opposite to the PVC's QRS", "Full compensatory pause — the sinus P that falls inside the PVC isn't conducted"],
    pearl: "Every other beat = bigeminy. If frequent, check K⁺ and Mg²⁺, look for ischaemia and structural heart disease.",
  },
  {
    id: "vt", group: "ventricular", label: "Ventricular tachycardia",
    features: ["Regular wide-complex tachycardia, usually 120–250", "AV dissociation: P waves march through independently; capture or fusion beats clinch it", "Often extreme axis and concordance across the chest leads"],
    pearl: "Treat any wide-complex tachycardia as VT until proven otherwise. Pulseless → defibrillate; pulse but unstable → synchronised cardioversion.",
  },
  {
    id: "vf", group: "ventricular", label: "Ventricular fibrillation",
    features: ["Chaotic deflections of varying amplitude and shape", "No identifiable P waves, QRS complexes or T waves"],
    pearl: "Cardiac arrest: CPR and immediate defibrillation.",
  },
  {
    id: "avb1", group: "block", label: "First-degree AV block",
    features: ["Every P wave is followed by a QRS", "Fixed PR > 200 ms (more than one large box)"],
    pearl: "Usually benign: athletes, AV-nodal blocking drugs, inferior MI.",
  },
  {
    id: "mobitz1", group: "block", label: "Second-degree AV block, Mobitz I (Wenckebach)",
    features: ["PR lengthens beat by beat until a P wave isn't conducted", "The PR after the dropped beat is the shortest", "Grouped beating"],
    pearl: "Block in the AV node — often benign (high vagal tone, inferior MI).",
  },
  {
    id: "mobitz2", group: "block", label: "Second-degree AV block, Mobitz II",
    features: ["Constant PR in the conducted beats", "P waves suddenly fail to conduct, with no PR lengthening beforehand", "Often with a bundle branch block (wide QRS)"],
    pearl: "Block below the AV node with a high risk of complete heart block — needs a pacemaker.",
  },
  {
    id: "avb3", group: "block", label: "Third-degree (complete) AV block",
    features: ["P waves and QRS complexes are completely dissociated — the PR varies at random", "Atrial rate faster than the ventricular rate, both regular", "Escape rhythm: junctional (narrow, 40–60) or ventricular (wide, 20–40)"],
    pearl: "Needs pacing. Atropine rarely helps a wide ventricular escape.",
  },
  {
    id: "lbbb", group: "conduction", label: "Left bundle branch block",
    features: ["QRS ≥ 120 ms", "Broad, notched or slurred R in I, aVL, V5–V6 with no septal q waves", "Deep QS or rS in V1–V3", "ST/T discordant — opposite the main QRS deflection"],
    pearl: "Mnemonic WiLLiaM: W in V1, M in V6. Use the Sgarbossa criteria to look for MI on top of LBBB.",
  },
  {
    id: "rbbb", group: "conduction", label: "Right bundle branch block",
    features: ["QRS ≥ 120 ms", "rSR′ (“M”) in V1–V2", "Wide, slurred S wave in I, aVL, V5–V6", "T inversion in V1–V3 is secondary"],
    pearl: "Mnemonic MaRRoW: M in V1, W in V6. Can be normal; also PE, RV strain, ASD.",
  },
  {
    id: "lafb", group: "conduction", label: "Left anterior fascicular block",
    features: ["Left axis deviation (−45° to −90°)", "qR in I and aVL, rS in II, III, aVF", "QRS < 120 ms"],
    pearl: "The commonest cause of left axis deviation. LAFB + RBBB = bifascicular block.",
  },
  {
    id: "wpw", group: "conduction", label: "Wolff-Parkinson-White",
    features: ["Short PR (< 120 ms)", "Delta wave: slurred upstroke at the start of the QRS", "Wide QRS with secondary ST/T changes"],
    pearl: "Accessory pathway. In pre-excited AF avoid AV-nodal blockers (adenosine, verapamil, digoxin, β-blockers) — risk of VF.",
  },
  {
    id: "lvh", group: "conduction", label: "Left ventricular hypertrophy",
    features: ["Voltage, e.g. Sokolow-Lyon: S in V1 + R in V5 or V6 ≥ 35 mm, or R in aVL ≥ 11 mm", "“Strain”: asymmetric ST depression and T inversion in I, aVL, V5–V6"],
    pearl: "Hypertension and aortic stenosis. High voltage alone in a young, thin patient can be normal.",
  },
  {
    id: "rvh", group: "conduction", label: "Right ventricular hypertrophy",
    features: ["Right axis deviation (> +90°)", "Dominant R in V1 (R/S > 1), deep S in V5–V6", "RV strain: ST depression / T inversion in V1–V3"],
    pearl: "Pulmonary hypertension, chronic lung disease, pulmonary stenosis, congenital heart disease.",
  },
  {
    id: "stemi_inf", group: "ischaemia", label: "Inferior STEMI",
    features: ["ST elevation in II, III, aVF (III > II suggests the RCA)", "Reciprocal ST depression in aVL (and I)", "Hyperacute T waves"],
    pearl: "Record right-sided leads (V4R) for RV infarction — avoid nitrates; watch for AV block and bradycardia.",
  },
  {
    id: "stemi_ant", group: "ischaemia", label: "Anterior STEMI",
    features: ["ST elevation in V1–V4 (septal V1–V2, anterior V3–V4)", "Hyperacute T waves", "Culprit: the LAD"],
    pearl: "Elevation across V1–V6 plus I and aVL = extensive anterior MI (proximal LAD).",
  },
  {
    id: "stemi_lat", group: "ischaemia", label: "Lateral STEMI",
    features: ["ST elevation in I, aVL, V5–V6", "Reciprocal ST depression in III and aVF", "Culprit: circumflex or a diagonal branch"],
    pearl: "Reciprocal inferior depression is what separates a lateral STEMI from pericarditis.",
  },
  {
    id: "stemi_post", group: "ischaemia", label: "Posterior STEMI",
    features: ["Horizontal ST depression in V1–V3 with upright T waves", "Tall, broad R waves in V1–V2 (R/S > 1)", "Confirm with ST elevation in V7–V9"],
    pearl: "ST depression maximal in V1–V3 is posterior STEMI until proven otherwise — flip the page over and look again.",
  },
  {
    id: "pericarditis", group: "ischaemia", label: "Acute pericarditis",
    features: ["Diffuse concave (“saddle”) ST elevation in limb and chest leads", "PR depression — with PR elevation and ST depression in aVR", "No reciprocal ST depression apart from aVR (± V1)"],
    pearl: "Pleuritic pain, better leaning forward; friction rub. NSAIDs + colchicine.",
  },
  {
    id: "hyperk", group: "metabolic", label: "Hyperkalaemia",
    features: ["Tall, narrow, peaked (“tented”) T waves, best seen in V2–V4", "Then: flattening P waves, longer PR, widening QRS → sine wave"],
    pearl: "IV calcium to stabilise the myocardium first, then shift K⁺ (insulin + glucose, salbutamol).",
  },
  {
    id: "hypok", group: "metabolic", label: "Hypokalaemia",
    features: ["Flattened T waves", "Prominent U waves after the T", "ST depression; apparent long QT (really a long QU)"],
    pearl: "Replace magnesium too — potassium won't correct while Mg²⁺ is low.",
  },
  {
    id: "long_qt", group: "metabolic", label: "Long QT",
    features: ["QTc > 470 ms (men) / > 480 ms (women); > 500 ms is high risk", "Quick check: the T wave ends past halfway between consecutive R waves"],
    pearl: "Risk of torsades de pointes. Check drugs (macrolides, antipsychotics, ondansetron, methadone), K⁺, Mg²⁺, Ca²⁺, and congenital LQTS.",
  },
];

export const DX = Object.fromEntries(DIAGNOSES.map((d) => [d.id, d]));

export function stripDiagnoses() {
  return DIAGNOSES.filter((d) => STRIP_GROUPS.has(d.group));
}

// --- Assembling a case -----------------------------------------------------

function rateOf(qrs) {
  const q = qrs.filter((t) => t >= 0 && t <= 10).sort((a, b) => a - b);
  if (q.length < 2) return null;
  return 60 / ((q[q.length - 1] - q[0]) / (q.length - 1));
}

function axisOf(m) {
  if (!m) return null;
  const x = netArea(m.qrs, "I");
  const y = netArea(m.qrs, "aVF") / 0.87;
  return Math.round((Math.atan2(y, x) * 180) / Math.PI);
}

function axisClass(a) {
  if (a >= -30 && a <= 90) return "normal";
  if (a < -30 && a >= -90) return "left";
  if (a > 90 && a <= 180) return "right";
  return "extreme";
}

function nearAny(x, marks, d) {
  return marks.some((m) => Math.abs(x - m) < d);
}

let caseCounter = 0;

const NO_QT = new Set(["af", "aflutter", "svt", "vt", "vf", "pvc", "pac", "mobitz1", "mobitz2", "avb3", "sinus_arrhythmia", "lbbb", "rbbb", "wpw"]);

// Builds a random case for `dxId`. `twelve` = full 12-lead (adds axis,
// ST/T and QT questions) rather than a 2-lead rhythm strip.
export function generateCase(dxId, twelve) {
  for (let attempt = 0; ; attempt++) {
    const r = GENERATORS[dxId]();
    const rate = rateOf(r.tl.qrs);
    const axis = axisOf(r.morph);
    const last = attempt > 40;
    if (!last) {
      if (r.valid === false) continue;
      // Keep away from cut-offs so every answer is unambiguous.
      if (rate != null && nearAny(rate, [60, 100], 4)) continue;
      if (twelve && axis != null && nearAny(axis, [-30, 90, -90], 9)) continue;
      if (twelve && axis != null && Math.abs(axis) > 171) continue;
    }

    const truth = { ...r.truth };
    if (rate != null) truth.rate = rate < 60 ? "slow" : rate > 100 ? "fast" : "normal";
    if (axis != null) truth.axis = axisClass(axis);

    const rr = rate ? 60 / rate : 1;
    const b = r.morph ? beat(r.morph, rr) : null;
    const qrsMs = b ? Math.round(((b.end - b.onset) * 1000) / 5) * 5 : null;
    const qtMs = b ? Math.round((b.qt * 1000) / 5) * 5 : null;
    const qtcMs = b ? Math.round((b.qt / Math.sqrt(rr)) * 1000 / 5) * 5 : null;

    const ask = [];
    if (dxId !== "vf") {
      ask.push("rate", "rhythm", "p", "pr", "qrs");
      if (twelve && dxId !== "vt") {
        ask.push("axis", "st");
        if (!NO_QT.has(dxId) && truth.qrs === "narrow" && rate <= 100) ask.push("qt");
      }
    }
    const answers = {};
    for (const q of ask) answers[q] = [].concat(truth[q]);

    const signal = render({ events: r.tl.events, continuous: r.continuous, duration: 10 });
    return {
      id: ++caseCounter,
      dx: dxId,
      twelve,
      signal,
      ask,
      answers,
      facts: {
        ...r.facts,
        rate: rate != null ? Math.round(rate) : null,
        axis,
        qrs: qrsMs,
        qt: qtMs,
        qtc: qtcMs,
      },
    };
  }
}

// Explains the right answer to one question, using the case's numbers.
export function explain(c, qid) {
  const f = c.facts;
  const a = c.answers[qid] ?? [];
  switch (qid) {
    case "rate":
      return `Ventricular rate ≈ ${f.rate} bpm${f.atrialRate ? `, atrial ≈ ${f.atrialRate}` : ""}.`;
    case "rhythm":
      return {
        regular: "R–R intervals are constant.",
        regIrreg: "R–R intervals vary, but in a repeating pattern or because of individual early/dropped beats.",
        irregIrreg: "No two R–R intervals are alike and there is no pattern.",
      }[a[0]] + (f.note && STRIP_GROUPS.has(DX[c.dx].group) ? ` (${f.note})` : "");
    case "p":
      return {
        normal: "Upright in II, same shape each time, one before every (conducted) QRS.",
        more: `P waves at ≈ ${f.atrialRate}/min outnumber the QRS complexes.`,
        absent: "No P waves can be seen before the QRS complexes.",
        retro: "P waves are inverted in II — the atria are activated from below.",
        fib: "No organised atrial activity — just an irregular, wavy baseline.",
        flutter: `Regular sawtooth flutter waves at ≈ ${f.atrialRate}/min, clearest in II and V1.`,
      }[a[0]];
    case "pr":
      if (typeof f.pr === "number") return `PR ≈ ${f.pr} ms${a[0] === "normal" ? " and constant" : ""}.`;
      return {
        progressive: `PR grows from ${f.pr} ms, then a P wave isn't conducted.`,
        na: "There are no P waves linked to the QRS, so there is no PR interval.",
        variable: "P waves and QRS complexes beat independently, so the PR changes all the time.",
      }[a[0]];
    case "qrs":
      return `QRS ≈ ${f.qrs} ms.`;
    case "axis":
      return `Axis ≈ ${f.axis}°.`;
    case "st":
      return {
        normal: "ST segments sit on the baseline and T waves follow the QRS.",
        regional: "ST elevation confined to one coronary territory, with reciprocal depression.",
        diffuse: "ST elevation across most leads, without a single territory.",
        depression: "ST depression and/or inverted T waves.",
        peaked: "Tall, narrow, symmetrical T waves.",
        flatU: "Low, flat T waves followed by a prominent U wave.",
        secondary: "ST/T changes caused by the abnormal depolarisation, pointing opposite the QRS.",
      }[a[0]];
    case "qt":
      return `QT ≈ ${f.qt} ms, QTc ≈ ${f.qtc} ms (Bazett).`;
    default:
      return "";
  }
}
