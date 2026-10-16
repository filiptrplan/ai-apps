// The diagnoses the trainer knows, the systematic questions, and the real
// recordings to practise on. The recordings and their answer keys are built
// by tools/build_cases.py from PTB-XL, the Shaoxing/Ningbo arrhythmia
// database and the MIT-BIH databases.

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
  { id: "ischaemia", title: "Ischaemia" },
  { id: "metabolic", title: "QT" },
];

// Rhythm diagnoses can be practised on a 2-lead strip; the rest need all 12.
const STRIP_GROUPS = new Set(["sinus", "ventricular", "block"]);

// Questions that need all 12 leads.
const TWELVE_ONLY = new Set(QUESTIONS.filter((q) => q.twelve).map((q) => q.id));

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
    id: "svt", group: "sinus", label: "Supraventricular tachycardia",
    features: ["Regular narrow-complex tachycardia, usually 150–220", "No visible P waves — in AVNRT the retrograde P hides in or just after the QRS (pseudo-r′ in V1, pseudo-S in II)"],
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
    id: "long_qt", group: "metabolic", label: "Long QT",
    features: ["QTc > 470 ms (men) / > 480 ms (women); > 500 ms is high risk", "Quick check: the T wave ends past halfway between consecutive R waves"],
    pearl: "Risk of torsades de pointes. Check drugs (macrolides, antipsychotics, ondansetron, methadone), K⁺, Mg²⁺, Ca²⁺, and congenital LQTS.",
  },
];

export const DX = Object.fromEntries(DIAGNOSES.map((d) => [d.id, d]));

export const SOURCES = {
  ptbxl: { name: "PTB-XL", url: "https://physionet.org/content/ptb-xl/" },
  sx: { name: "Shaoxing/Ningbo arrhythmia database", url: "https://physionet.org/content/ecg-arrhythmia/" },
  vfdb: { name: "MIT-BIH Malignant Ventricular Ectopy Database", url: "https://physionet.org/content/vfdb/" },
  mitdb: { name: "MIT-BIH Arrhythmia Database", url: "https://physionet.org/content/mitdb/" },
};

// --- The case library --------------------------------------------------------

const BASE = "./ekg-trainer/cases/";
let indexPromise = null;

// Every recording: { id, dx, src, ref, age, sex, leads, fs, n, answers, facts }.
export function loadIndex() {
  indexPromise ??= fetch(`${BASE}index.json`).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load the case list (${r.status})`);
    return r.json();
  }).catch((e) => {
    indexPromise = null;
    throw e;
  });
  return indexPromise;
}

export const isTwelveLead = (entry) => entry.leads.length === 8;

// The recordings usable in a mode: 12-lead mode needs a 12-lead recording;
// strip mode takes any rhythm diagnosis and shows two of its leads.
export function casesFor(index, twelve) {
  return index.filter((e) => (twelve ? isTwelveLead(e) : STRIP_GROUPS.has(DX[e.dx]?.group)) && DX[e.dx]);
}

// Diagnoses with at least one recording in the mode, in the library's order.
export function diagnosesFor(index, twelve) {
  const have = new Set(casesFor(index, twelve).map((e) => e.dx));
  return DIAGNOSES.filter((d) => have.has(d.id));
}

let caseCounter = 0;

// Downloads a recording and turns it into a case for the given mode.
export async function loadCase(entry, twelve) {
  const r = await fetch(`${BASE}${entry.id}.bin`);
  if (!r.ok) throw new Error(`Couldn't load the EKG (${r.status})`);
  const raw = new Int16Array(await r.arrayBuffer());
  const leads = {};
  entry.leads.forEach((name, i) => {
    const out = new Float32Array(entry.n);
    for (let j = 0; j < entry.n; j++) out[j] = raw[i * entry.n + j] / 1000;
    leads[name] = out;
  });
  if (isTwelveLead(entry)) addDerivedLeads(leads, entry.n);
  const strip = isTwelveLead(entry) ? ["II", "V1"] : entry.leads;

  const ask = QUESTIONS.map((q) => q.id).filter((q) => entry.answers[q] && (twelve || !TWELVE_ONLY.has(q)));
  const f = entry.facts;
  return {
    id: ++caseCounter,
    entry,
    dx: entry.dx,
    twelve,
    signal: { leads, fs: entry.fs, duration: entry.n / entry.fs, strip },
    ask,
    answers: entry.answers,
    facts: { rate: f.hr, atrialRate: f.atrial, pr: f.pr, qrs: f.qrs, axis: f.axis, qt: f.qt, qtc: f.qtc },
  };
}

// Einthoven and Goldberger: the other four limb leads follow from I and II.
function addDerivedLeads(leads, n) {
  const { I, II } = leads;
  const III = new Float32Array(n), aVR = new Float32Array(n), aVL = new Float32Array(n), aVF = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    III[j] = II[j] - I[j];
    aVR[j] = -(I[j] + II[j]) / 2;
    aVL[j] = I[j] - II[j] / 2;
    aVF[j] = II[j] - I[j] / 2;
  }
  Object.assign(leads, { III, aVR, aVL, aVF });
}

// "PTB-XL #1234 · 62 y, male"
export function describeSource(entry) {
  const who = [entry.age != null && `${entry.age} y`, entry.sex === "M" ? "male" : entry.sex === "F" ? "female" : null]
    .filter(Boolean)
    .join(", ");
  return `${SOURCES[entry.src].name} · ${entry.src === "ptbxl" ? "#" : "record "}${entry.ref}${who ? ` · ${who}` : ""}`;
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
      }[a[0]];
    case "p":
      return {
        normal: "Upright in II, same shape each time, one before every (conducted) QRS.",
        more: `P waves${f.atrialRate ? ` at ≈ ${f.atrialRate}/min` : ""} outnumber the QRS complexes.`,
        absent: "No P waves can be seen before the QRS complexes.",
        retro: "P waves are inverted in II — the atria are activated from below.",
        fib: "No organised atrial activity — just an irregular, wavy baseline.",
        flutter: `Regular sawtooth flutter waves${f.atrialRate ? ` at ≈ ${f.atrialRate}/min` : ""}, clearest in II and V1.`,
      }[a[0]];
    case "pr":
      if (a[0] === "progressive") return "The PR grows beat by beat until a P wave isn't conducted.";
      if (a[0] === "na") return "There are no P waves linked to the QRS, so there is no PR interval.";
      if (a[0] === "variable") return "P waves and QRS complexes beat independently, so the PR changes all the time.";
      return f.pr ? `PR ≈ ${f.pr} ms.` : { normal: "PR 120–200 ms and constant.", short: "PR < 120 ms.", long: "PR > 200 ms and constant." }[a[0]];
    case "qrs":
      return f.qrs ? `QRS ≈ ${f.qrs} ms.` : a[0] === "wide" ? "QRS ≥ 120 ms." : "QRS < 120 ms.";
    case "axis":
      return `Axis ≈ ${f.axis}°.`;
    case "st":
      return {
        normal: "ST segments sit on the baseline and T waves follow the QRS.",
        regional: "ST elevation confined to one coronary territory, usually with reciprocal depression.",
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
