const { useState, useEffect, useRef } = React;

const STORAGE_KEYS = {
  exercises: "climbing-tracker-exercises",
  routines: "climbing-tracker-routines",
  history: "climbing-tracker-history",
};

function uid() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function useStorage(key, fallback) {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  });

  const save = (val) => {
    setData(val);
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  };

  return [data, save];
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const EXERCISE_TYPES = [
  { value: "reps", label: "Reps" },
  { value: "weighted", label: "Weighted" },
  { value: "interval", label: "Interval" },
];

function defaultFieldsForType(type) {
  if (type === "weighted") return { sets: 3, reps: 5, weight: 10, weightMode: "added", restSec: 0 };
  if (type === "interval") return { workSec: 10, restSec: 5, sets: 6 };
  return { sets: 3, reps: 10, restSec: 0 };
}

function formatWeightLabel(weightMode, weight) {
  return weightMode === "added" ? `BW +${weight}kg` : `${weight}kg`;
}

function formatTargetSummary(ex) {
  const restPart = ex.type !== "interval" && ex.restSec > 0 ? ` · ${ex.restSec}s rest` : "";
  if (ex.type === "weighted") return `${ex.sets} × ${ex.reps} reps @ ${formatWeightLabel(ex.weightMode, ex.weight)}${restPart}`;
  if (ex.type === "interval") return `${ex.sets} sets · ${ex.workSec}s on / ${ex.restSec}s off`;
  return `${ex.sets} × ${ex.reps} reps${restPart}`;
}

function mergeById(existing, incoming) {
  const result = [...existing];
  incoming.forEach(item => {
    if (!item) return;
    const withId = item.id ? item : { ...item, id: uid() };
    const idx = result.findIndex(e => e.id === withId.id);
    if (idx >= 0) result[idx] = withId; else result.push(withId);
  });
  return result;
}

const LLM_GUIDANCE = `You are generating data for the "Climbing Tracker" web app. The app stores exercises and routines as JSON that gets pasted into its "Import exercises & routines" dialog.

Output ONLY raw JSON (no markdown code fences, no commentary, no trailing commas) matching this exact shape:

{
  "exercises": [ <Exercise>, ... ],
  "routines": [ <Routine>, ... ]
}

Exercise objects use one of three "type" values:

1) "reps" - plain bodyweight reps, e.g. pull-ups, push-ups, core work:
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "reps",
  "sets": <integer, number of sets>,
  "reps": <integer, target reps per set>,
  "restSec": <integer, seconds of rest between sets, 0 for no timed rest>
}

2) "weighted" - sets of reps with a weight, either added to bodyweight (weighted pull-up belt, weight vest) or an absolute total weight (barbell, dumbbell, machine):
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "weighted",
  "sets": <integer>,
  "reps": <integer, target reps per set>,
  "weight": <number, kg>,
  "weightMode": "added" | "total",
  "restSec": <integer, seconds of rest between sets, 0 for no timed rest>
}
Use "added" when the weight is extra load on top of the climber's own bodyweight. Use "total" when it's the full weight being lifted.

3) "interval" - timed work/rest sets, e.g. hangboard repeaters, dead hangs, plank holds, rest-pause finger boarding:
{
  "id": "<unique string>",
  "name": "<exercise name>",
  "type": "interval",
  "workSec": <integer, seconds of work per set>,
  "restSec": <integer, seconds of rest between sets>,
  "sets": <integer, number of work/rest cycles>
}

Routine objects group exercises into an ordered sequence of steps to perform together. Each step points at an exercise and can optionally override that exercise's "sets" and "restSec" just for this routine (leave them null to use the exercise's own defaults). The same exerciseId can appear in multiple steps, e.g. to do a couple of warm-up sets early in the routine and more later:
{
  "id": "<unique string>",
  "name": "<routine name>",
  "steps": [
    { "id": "<unique string>", "exerciseId": "<id of an exercise in the exercises array>", "sets": <integer or null>, "restSec": <integer or null> },
    ...
  ]
}

IMPORTANT - what "restSec" actually does (read this carefully, it is easy to misuse):
"restSec" is a countdown timer that fires ONLY between repeated sets of that SAME exercise within that SAME step, and ONLY when "sets" for that step is 2 or more. There is no concept of "rest between different exercises" anywhere in this app - when a session moves from one exercise/step to the next there is never an automatic pause. Concretely:
- If a step has "sets": 1, its "restSec" is completely inert and will never fire, no matter what number you put there (for "interval" exercises, a rest phase only ever happens between the 1st, 2nd, 3rd, etc. work cycle of that SAME timer, so with "sets": 1 there is only one work cycle and the rest phase never triggers either).
- Do NOT model a "circuit" (e.g. "3 rounds of 5 exercises") as 15 separate one-set steps in the hope that "restSec" will create breaks between the different exercises in each round - it will not, those rest values will silently do nothing. If you want repeated rounds of a circuit, repeating each exercise as its own step multiple times in the desired order is fine for capturing the exercise ORDER, just do not set "restSec" on those steps expecting it to pause between exercises - leave it 0/null and mention in your reply (outside the JSON, if there is room) that this app does not yet support timed rest between different exercises, only between repeated sets of one exercise.
- Only set a step's "restSec" above 0 when you also give that same step "sets" of 2 or more, e.g. to have a genuine rest countdown between the reps/weighted sets of one exercise, or between the work cycles of one interval exercise.

Rules:
- Every "id" must be unique within the file (e.g. "ex-dead-hangs-01").
- Every "exerciseId" referenced by a routine step must also appear as an exercise in the "exercises" array of the same JSON.
- Leave "exercises" or "routines" as an empty array (or omit the key) if you have nothing to add for it.
- Do not invent extra fields, do not wrap the JSON in markdown fences, output nothing but the JSON object.
- Unless told otherwise, pick sensible default sets/reps/weights/durations/rests for an intermediate climber.

Now generate the exercises and/or routines described by the user's request that follows this prompt.`;

// Turns a card's live log into a history "performed" record, or null if
// nothing was actually logged (so untouched cards are dropped silently).
function buildPerformedFromLog(exercise, log) {
  if (!log) return null;
  if (exercise.type === "interval") {
    if (!log.completedSets) return null;
    return {
      type: "interval",
      workSec: exercise.workSec,
      restSec: exercise.restSec,
      targetSets: exercise.sets,
      completedSets: log.completedSets,
    };
  }
  const doneRows = (log.rows || []).filter(r => r.done);
  if (doneRows.length === 0) return null;
  if (exercise.type === "weighted") {
    return {
      type: "weighted",
      weightMode: exercise.weightMode,
      targetSets: exercise.sets,
      targetReps: exercise.reps,
      targetWeight: exercise.weight,
      sets: doneRows.map(r => ({ reps: Number(r.reps) || 0, weight: Number(r.weight) || 0 })),
    };
  }
  return {
    type: "reps",
    targetSets: exercise.sets,
    targetReps: exercise.reps,
    sets: doneRows.map(r => ({ reps: Number(r.reps) || 0 })),
  };
}

function formatPerformedSummary(step) {
  const p = step.performed;
  if (p.type === "weighted") {
    return `${p.sets.length} sets: ` + p.sets.map(s => `${s.reps}×${formatWeightLabel(p.weightMode, s.weight)}`).join(", ");
  }
  if (p.type === "interval") {
    return `${p.completedSets}/${p.targetSets} sets · ${p.workSec}s on / ${p.restSec}s off`;
  }
  return `${p.sets.length} sets: ` + p.sets.map(s => s.reps).join(", ") + " reps";
}

let audioCtx = null;
function getAudioCtx() {
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

const sounds = {
  countdown: () => beep(880, 0.1, 0.18, "sine"),
  workStart: () => beep(660, 0.18, 0.22, "square"),
  restStart: () => beep(440, 0.18, 0.22, "sine"),
  finish: () => {
    beep(523, 0.15, 0.22, "sine", 0);
    beep(659, 0.15, 0.22, "sine", 0.15);
    beep(784, 0.3, 0.24, "sine", 0.3);
  },
};

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function NumberField({ label, value, onChange, min = 0, step = 1, suffix = "" }) {
  return (
    <div style={s.numField}>
      <label style={s.label}>{label}</label>
      <div style={s.numFieldInputWrap}>
        <input
          style={s.numFieldInput}
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={e => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
        />
        {suffix && <span style={s.numFieldSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

function ExerciseForm({ draft, onChange, onSave, onCancel }) {
  const set = (patch) => onChange({ ...draft, ...patch });

  return (
    <div style={s.card}>
      <input
        style={s.input}
        placeholder="Exercise name"
        value={draft.name}
        onChange={e => set({ name: e.target.value })}
        autoFocus
      />
      <div style={s.typeRow}>
        {EXERCISE_TYPES.map(t => (
          <button
            key={t.value}
            style={{ ...s.typeChip, ...(draft.type === t.value ? s.typeChipActive : {}) }}
            onClick={() => set({ type: t.value, ...defaultFieldsForType(t.value) })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {draft.type === "reps" && (
        <div style={s.fieldRow}>
          <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
          <NumberField label="Reps" value={draft.reps} onChange={v => set({ reps: v })} min={1} />
          <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} suffix="s" />
        </div>
      )}

      {draft.type === "weighted" && (
        <>
          <div style={s.fieldRow}>
            <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
            <NumberField label="Reps" value={draft.reps} onChange={v => set({ reps: v })} min={1} />
          </div>
          <div style={s.fieldRow}>
            <NumberField label="Weight" value={draft.weight} onChange={v => set({ weight: v })} min={0} step={0.5} suffix="kg" />
            <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} suffix="s" />
          </div>
          <div style={s.typeRow}>
            <button
              style={{ ...s.typeChip, ...(draft.weightMode === "added" ? s.typeChipActive : {}) }}
              onClick={() => set({ weightMode: "added" })}
            >
              Bodyweight + kg
            </button>
            <button
              style={{ ...s.typeChip, ...(draft.weightMode === "total" ? s.typeChipActive : {}) }}
              onClick={() => set({ weightMode: "total" })}
            >
              Total weight
            </button>
          </div>
        </>
      )}

      {draft.type === "interval" && (
        <div style={s.fieldRow}>
          <NumberField label="Work" value={draft.workSec} onChange={v => set({ workSec: v })} min={1} suffix="s" />
          <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} suffix="s" />
          <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
        </div>
      )}

      <div style={s.modalActions}>
        <button style={{ ...s.saveBtn, flex: 1 }} onClick={onSave} disabled={!draft.name.trim()}>Save</button>
        <button style={{ ...s.exportBtn, flex: 1 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Checklist-style set logger: every set is visible at once and can be ticked
// done in any order. Ticking a set starts an inline, non-blocking rest countdown
// (when the exercise has a restSec configured) before the next tick.
function SetsCard({ exercise, onChange }) {
  const targetSets = exercise.sets || 1;
  const restSec = exercise.restSec || 0;
  const isWeighted = exercise.type === "weighted";
  const makeRow = () => ({ reps: exercise.reps || 0, weight: exercise.weight || 0, done: false });

  const [rows, setRows] = useState(() => Array.from({ length: targetSets }, makeRow));
  const [restRowIndex, setRestRowIndex] = useState(null);
  const [restTimeLeft, setRestTimeLeft] = useState(restSec);
  const [restPaused, setRestPaused] = useState(false);
  const intervalRef = useRef(null);
  const timeLeftRef = useRef(restSec);

  useEffect(() => { onChange({ rows }); }, [rows]);
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const clearTick = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  const tick = () => {
    timeLeftRef.current -= 1;
    if (timeLeftRef.current <= 0) {
      clearTick();
      sounds.workStart();
      setRestRowIndex(null);
    } else {
      setRestTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 3 && timeLeftRef.current >= 1) sounds.countdown();
    }
  };

  const startRest = (rowIndex) => {
    clearTick();
    timeLeftRef.current = restSec;
    setRestTimeLeft(restSec);
    setRestPaused(false);
    setRestRowIndex(rowIndex);
    sounds.restStart();
    intervalRef.current = setInterval(tick, 1000);
  };

  const skipRest = () => { clearTick(); setRestRowIndex(null); };
  const toggleRestPause = () => {
    if (restPaused) { intervalRef.current = setInterval(tick, 1000); setRestPaused(false); }
    else { clearTick(); setRestPaused(true); }
  };

  const updateRow = (i, patch) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRow = (i) => {
    setRows(rows.filter((_, idx) => idx !== i));
    if (restRowIndex === i) skipRest();
  };
  const addRow = () => setRows([...rows, { ...(rows[rows.length - 1] || makeRow()), done: false }]);

  const toggleDone = (i) => {
    const nowDone = !rows[i].done;
    updateRow(i, { done: nowDone });
    const otherSetsRemain = rows.some((r, idx) => idx !== i && !r.done);
    if (nowDone && restSec > 0 && otherSetsRemain) startRest(i);
    else if (!nowDone && restRowIndex === i) skipRest();
  };

  const doneCount = rows.filter(r => r.done).length;

  return (
    <div>
      <div style={s.setsTarget}>{doneCount} / {rows.length} sets done &middot; target {formatTargetSummary(exercise)}</div>
      <div style={s.setsTable}>
        <div style={s.setsHeaderRow}>
          <span style={{ ...s.setsHeaderCell, width: 22 }} />
          <span style={s.setsHeaderCell}>Set</span>
          <span style={s.setsHeaderCell}>Reps</span>
          {isWeighted && <span style={s.setsHeaderCell}>Weight (kg)</span>}
          <span style={{ ...s.setsHeaderCell, width: 28 }} />
        </div>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            <div style={{ ...s.setsRow, ...(row.done ? s.setsRowDone : {}) }}>
              <input type="checkbox" style={s.setsCheckbox} checked={row.done} onChange={() => toggleDone(i)} />
              <span style={s.setsIndex}>{i + 1}</span>
              <input
                style={s.setsInput}
                type="number"
                min={0}
                value={row.reps}
                onChange={e => updateRow(i, { reps: e.target.value })}
              />
              {isWeighted && (
                <input
                  style={s.setsInput}
                  type="number"
                  min={0}
                  step={0.5}
                  value={row.weight}
                  onChange={e => updateRow(i, { weight: e.target.value })}
                />
              )}
              <button style={s.deleteBtn} onClick={() => removeRow(i)} disabled={rows.length <= 1}>&times;</button>
            </div>
            {restRowIndex === i && (
              <div style={s.restInline}>
                <span style={s.restInlineLabel}>Rest {formatTime(restTimeLeft)}</span>
                <button style={s.tinyBtn} onClick={toggleRestPause}>{restPaused ? "Resume" : "Pause"}</button>
                <button style={s.tinyBtn} onClick={skipRest}>Skip</button>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <button style={s.addSetBtn} onClick={addRow}>+ Add set</button>
    </div>
  );
}

// Reports its progress live via onChange (rather than a one-shot onComplete)
// so the containing page can read the current completedSets at any time,
// including mid-timer, when the workout is finished.
function IntervalCard({ exercise, onChange }) {
  const [phase, setPhase] = useState("idle"); // idle | work | rest | done
  const [currentSet, setCurrentSet] = useState(1);
  const [timeLeft, setTimeLeft] = useState(exercise.workSec);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef(null);
  const phaseRef = useRef("idle");
  const currentSetRef = useRef(1);
  const timeLeftRef = useRef(exercise.workSec);
  const completedRef = useRef(0);

  const report = () => onChange({ type: "interval", completedSets: completedRef.current });

  const clearTick = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const finishNow = () => {
    clearTick();
    setPhase("done");
    report();
  };

  const runTick = () => {
    timeLeftRef.current -= 1;
    if (timeLeftRef.current <= 0) {
      if (phaseRef.current === "work") {
        completedRef.current += 1;
        report();
        if (currentSetRef.current >= exercise.sets) {
          phaseRef.current = "done";
          setPhase("done");
          clearTick();
          sounds.finish();
          return;
        }
        phaseRef.current = "rest";
        timeLeftRef.current = exercise.restSec;
        setPhase("rest");
        setTimeLeft(exercise.restSec);
        sounds.restStart();
      } else if (phaseRef.current === "rest") {
        currentSetRef.current += 1;
        phaseRef.current = "work";
        timeLeftRef.current = exercise.workSec;
        setPhase("work");
        setCurrentSet(currentSetRef.current);
        setTimeLeft(exercise.workSec);
        sounds.workStart();
      }
    } else {
      setTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 3 && timeLeftRef.current >= 1) sounds.countdown();
    }
  };

  const start = () => {
    getAudioCtx();
    phaseRef.current = "work";
    currentSetRef.current = 1;
    timeLeftRef.current = exercise.workSec;
    completedRef.current = 0;
    setPhase("work");
    setCurrentSet(1);
    setTimeLeft(exercise.workSec);
    setPaused(false);
    sounds.workStart();
    intervalRef.current = setInterval(runTick, 1000);
  };

  const restart = () => {
    clearTick();
    completedRef.current = 0;
    phaseRef.current = "idle";
    currentSetRef.current = 1;
    timeLeftRef.current = exercise.workSec;
    setPhase("idle");
    setCurrentSet(1);
    setTimeLeft(exercise.workSec);
    setPaused(false);
    report();
  };

  const togglePause = () => {
    if (paused) {
      intervalRef.current = setInterval(runTick, 1000);
      setPaused(false);
    } else {
      clearTick();
      setPaused(true);
    }
  };

  const skip = () => {
    if (phaseRef.current === "rest") {
      currentSetRef.current += 1;
      phaseRef.current = "work";
      timeLeftRef.current = exercise.workSec;
      setPhase("work");
      setCurrentSet(currentSetRef.current);
      setTimeLeft(exercise.workSec);
    } else if (phaseRef.current === "work") {
      completedRef.current += 1;
      report();
      if (currentSetRef.current >= exercise.sets) {
        finishNow();
      } else {
        phaseRef.current = "rest";
        timeLeftRef.current = exercise.restSec;
        setPhase("rest");
        setTimeLeft(exercise.restSec);
      }
    }
  };

  useEffect(() => () => clearTick(), []);

  const running = phase === "work" || phase === "rest";
  const phaseColor = phase === "work" ? "#D9A441" : phase === "rest" ? "#3A9E6E" : "#888";
  const phaseBg = phase === "work" ? "rgba(217,164,65,0.08)" : phase === "rest" ? "rgba(58,158,110,0.08)" : "transparent";
  const completed = phase === "done" ? (completedRef.current >= exercise.sets ? exercise.sets : completedRef.current) : completedRef.current;

  return (
    <div>
      <div style={{ ...s.timerBox, background: phaseBg }}>
        {phase === "idle" && (
          <>
            <div style={s.timerDigits}>{formatTime(exercise.workSec)}</div>
            <div style={s.timerSub}>{exercise.sets} sets &middot; {formatTime(exercise.workSec)} on &middot; {formatTime(exercise.restSec)} off</div>
          </>
        )}
        {running && (
          <>
            <div style={{ ...s.phaseLabel, color: phaseColor }}>{phase.toUpperCase()}</div>
            <div style={{ ...s.timerDigits, color: phaseColor }}>{formatTime(timeLeft)}</div>
            <div style={s.timerSub}>Set {currentSet} / {exercise.sets}</div>
            {paused && <div style={{ ...s.phaseLabel, color: "#F0AD4E", marginTop: 8, fontSize: 13 }}>PAUSED</div>}
          </>
        )}
        {phase === "done" && (
          <>
            <div style={{ ...s.phaseLabel, color: "#3A9E6E" }}>DONE</div>
            <div style={s.timerSub}>{completed} / {exercise.sets} sets completed</div>
          </>
        )}
      </div>

      <div style={s.controls}>
        {phase === "idle" && <button style={s.startBtn} onClick={start}>Start</button>}
        {running && (
          <>
            <button style={s.pauseBtn} onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
            <button style={s.skipBtn} onClick={skip}>Skip</button>
            <button style={s.stopBtn} onClick={finishNow}>Finish now</button>
          </>
        )}
        {phase === "done" && (
          <button style={s.exportBtn} onClick={restart}>Restart</button>
        )}
      </div>
    </div>
  );
}

function ExerciseCard({ exercise, position, total, onChange, onMove }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={s.exerciseCard}>
      <div style={s.exerciseCardHeader}>
        <div style={s.exerciseCardHeaderMain} onClick={() => setCollapsed(!collapsed)}>
          <div style={s.exerciseCardName}>{exercise.name}</div>
          <div style={s.exerciseCardTarget}>{formatTargetSummary(exercise)}</div>
        </div>
        <div style={s.listActions}>
          {total > 1 && (
            <>
              <button style={s.tinyBtn} onClick={() => onMove(-1)} disabled={position === 0}>&uarr;</button>
              <button style={s.tinyBtn} onClick={() => onMove(1)} disabled={position === total - 1}>&darr;</button>
            </>
          )}
          <button style={s.tinyBtn} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "+" : "−"}</button>
        </div>
      </div>
      {/* Kept mounted (just hidden) so ticked sets / timer progress survive collapsing. */}
      <div style={collapsed ? s.hidden : undefined}>
        {exercise.type === "interval"
          ? <IntervalCard exercise={exercise} onChange={onChange} />
          : <SetsCard exercise={exercise} onChange={onChange} />}
      </div>
    </div>
  );
}

// All exercises in the session are shown on one page at once, so a routine
// can be worked through in whatever order feels right rather than a forced
// step-by-step sequence. Each card reports its live progress via onLogChange;
// "Finish workout" reads whatever has been ticked/logged so far.
function SessionPage({ session, onCancel, onLogChange, onFinish }) {
  const [order, setOrder] = useState(() => session.exercises.map((_, i) => i));

  const moveCard = (position, dir) => {
    setOrder(o => {
      const arr = [...o];
      const j = position + dir;
      if (j < 0 || j >= arr.length) return o;
      [arr[position], arr[j]] = [arr[j], arr[position]];
      return arr;
    });
  };

  return (
    <div style={s.page}>
      <div style={s.sessionTopBar}>
        <button style={s.cancelBtn} onClick={onCancel}>Cancel</button>
        <div style={s.sessionTitle}>{session.kind === "routine" ? session.refName : "Exercise"}</div>
      </div>
      {order.map((exIdx, position) => (
        <ExerciseCard
          key={exIdx}
          exercise={session.exercises[exIdx]}
          position={position}
          total={order.length}
          onChange={log => onLogChange(exIdx, log)}
          onMove={dir => moveCard(position, dir)}
        />
      ))}
      <button style={s.startBtn} onClick={onFinish}>Finish workout</button>
    </div>
  );
}

const TABS = ["Exercises", "Routines", "History", "Settings"];

function ClimbingTrackerApp() {
  const [tab, setTab] = useState("Exercises");
  const [exercises, setExercises] = useStorage(STORAGE_KEYS.exercises, []);
  const [routines, setRoutines] = useStorage(STORAGE_KEYS.routines, []);
  const [history, setHistory] = useStorage(STORAGE_KEYS.history, []);

  const [activeSession, setActiveSession] = useState(null);

  // Exercise form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: "", type: "reps", ...defaultFieldsForType("reps") });

  const openNewExercise = () => {
    setDraft({ name: "", type: "reps", ...defaultFieldsForType("reps") });
    setEditingId(null);
    setFormOpen(true);
  };
  const openEditExercise = (ex) => {
    setDraft({ ...ex });
    setEditingId(ex.id);
    setFormOpen(true);
  };
  const saveExercise = () => {
    if (!draft.name.trim()) return;
    if (editingId) {
      setExercises(exercises.map(e => e.id === editingId ? { ...draft, id: editingId } : e));
    } else {
      setExercises([...exercises, { ...draft, id: uid() }]);
    }
    setFormOpen(false);
  };
  const deleteExercise = (id) => {
    setExercises(exercises.filter(e => e.id !== id));
    setRoutines(routines.map(r => ({ ...r, steps: r.steps.filter(step => step.exerciseId !== id) })));
  };

  // Routine state
  const [newRoutineName, setNewRoutineName] = useState("");
  const [expandedRoutineId, setExpandedRoutineId] = useState(null);
  const [routineAddSelect, setRoutineAddSelect] = useState({});

  // One-time migration for routines saved before per-step sets/rest overrides existed.
  useEffect(() => {
    if (routines.some(r => !Array.isArray(r.steps))) {
      setRoutines(routines.map(r => Array.isArray(r.steps) ? r : {
        id: r.id,
        name: r.name,
        steps: (r.exerciseIds || []).map(exerciseId => ({ id: uid(), exerciseId, sets: null, restSec: null })),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRoutine = () => {
    if (!newRoutineName.trim()) return;
    const r = { id: uid(), name: newRoutineName.trim(), steps: [] };
    setRoutines([...routines, r]);
    setNewRoutineName("");
    setExpandedRoutineId(r.id);
  };
  const deleteRoutine = (id) => setRoutines(routines.filter(r => r.id !== id));
  const addStepToRoutine = (routineId, exerciseId) => {
    if (!exerciseId) return;
    const step = { id: uid(), exerciseId, sets: null, restSec: null };
    setRoutines(routines.map(r => r.id === routineId ? { ...r, steps: [...r.steps, step] } : r));
  };
  const updateRoutineStep = (routineId, idx, patch) => {
    setRoutines(routines.map(r => r.id === routineId ? { ...r, steps: r.steps.map((step, i) => i === idx ? { ...step, ...patch } : step) } : r));
  };
  const removeFromRoutine = (routineId, idx) => {
    setRoutines(routines.map(r => r.id === routineId ? { ...r, steps: r.steps.filter((_, i) => i !== idx) } : r));
  };
  const moveInRoutine = (routineId, idx, dir) => {
    setRoutines(routines.map(r => {
      if (r.id !== routineId) return r;
      const steps = [...r.steps];
      const j = idx + dir;
      if (j < 0 || j >= steps.length) return r;
      [steps[idx], steps[j]] = [steps[j], steps[idx]];
      return { ...r, steps };
    }));
  };

  // Session control. Logs for the active session live in a ref (not state) since
  // cards report progress on every tick/timer-tick; we only need to read the
  // latest values once, when the workout is finished.
  const sessionLogsRef = useRef([]);

  const startExercise = (ex) => {
    sessionLogsRef.current = [null];
    setActiveSession({ kind: "exercise", refId: ex.id, refName: ex.name, exercises: [ex] });
  };
  const startRoutine = (r) => {
    const exs = r.steps.map(step => {
      const ex = exercises.find(e => e.id === step.exerciseId);
      if (!ex) return null;
      return {
        ...ex,
        sets: step.sets ?? ex.sets,
        restSec: step.restSec ?? (ex.restSec ?? 0),
      };
    }).filter(Boolean);
    if (exs.length === 0) return;
    sessionLogsRef.current = exs.map(() => null);
    setActiveSession({ kind: "routine", refId: r.id, refName: r.name, exercises: exs });
  };
  const cancelSession = () => setActiveSession(null);
  const handleLogChange = (i, log) => { sessionLogsRef.current[i] = log; };
  const finishSession = () => {
    const current = activeSession;
    const results = [];
    current.exercises.forEach((ex, i) => {
      const performed = buildPerformedFromLog(ex, sessionLogsRef.current[i]);
      if (performed) results.push({ exerciseId: ex.id, exerciseName: ex.name, performed });
    });
    if (results.length > 0) {
      const entry = {
        id: uid(),
        date: new Date().toISOString(),
        kind: current.kind,
        refId: current.refId,
        refName: current.refName,
        steps: results,
      };
      setHistory([entry, ...history]);
    }
    setActiveSession(null);
  };

  const deleteHistoryEntry = (id) => setHistory(history.filter(h => h.id !== id));
  const clearHistory = () => setHistory([]);

  // Export / import
  const fileInputRef = useRef(null);
  const [transferMode, setTransferMode] = useState(null); // null | "export" | "import"
  const [transferScope, setTransferScope] = useState("all"); // "all" | "partial" (exercises + routines only)
  const [transferText, setTransferText] = useState("");
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState("");
  const [llmCopied, setLlmCopied] = useState(false);

  const openExport = (scope) => {
    const payload = scope === "all" ? { exercises, routines, history } : { exercises, routines };
    setTransferText(JSON.stringify(payload, null, 2));
    setTransferScope(scope);
    setCopied(false);
    setTransferMode("export");
  };
  const openImport = (scope) => {
    setTransferText("");
    setTransferScope(scope);
    setImportError("");
    setTransferMode("import");
  };
  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(transferText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.querySelector("[data-transfer-text]");
      if (ta) { ta.select(); document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    }
  };
  const downloadExport = () => {
    const blob = new Blob([transferText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `climbing-tracker-${transferScope === "all" ? "all" : "exercises-routines"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const applyImport = (text) => {
    try {
      const data = JSON.parse(text || transferText);
      if (transferScope === "all") {
        if (Array.isArray(data.exercises)) setExercises(data.exercises);
        if (Array.isArray(data.routines)) setRoutines(data.routines);
        if (Array.isArray(data.history)) setHistory(data.history);
      } else {
        if (Array.isArray(data.exercises)) setExercises(mergeById(exercises, data.exercises));
        if (Array.isArray(data.routines)) setRoutines(mergeById(routines, data.routines));
      }
      setTransferMode(null);
      setImportError("");
    } catch {
      setImportError("Invalid JSON");
    }
  };
  const importFromFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      setTransferText(text);
      applyImport(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const copyLlmGuidance = async () => {
    try {
      await navigator.clipboard.writeText(LLM_GUIDANCE);
      setLlmCopied(true);
      setTimeout(() => setLlmCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = LLM_GUIDANCE;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setLlmCopied(true);
      setTimeout(() => setLlmCopied(false), 2000);
    }
  };

  if (activeSession) {
    return (
      <div style={s.root}>
        <SessionPage session={activeSession} onCancel={cancelSession} onLogChange={handleLogChange} onFinish={finishSession} />
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={s.tabs}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>
            {t}{t === "History" && history.length > 0 ? ` (${history.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "Exercises" && (
        <div style={s.page}>
          {!formOpen && <button style={s.addBtn} onClick={openNewExercise}>+ New exercise</button>}
          {formOpen && (
            <ExerciseForm draft={draft} onChange={setDraft} onSave={saveExercise} onCancel={() => setFormOpen(false)} />
          )}

          {exercises.length === 0 && <p style={s.empty}>No exercises yet. Add one to get started.</p>}
          {exercises.map(ex => (
            <div key={ex.id} style={s.listItem}>
              <div style={s.listMain}>
                <div style={s.listTitle}>{ex.name}</div>
                <div style={s.listMeta}>{formatTargetSummary(ex)}</div>
              </div>
              <div style={s.listActions}>
                <button style={s.smallBtn} onClick={() => startExercise(ex)}>Start</button>
                <button style={s.smallBtnGhost} onClick={() => openEditExercise(ex)}>Edit</button>
                <button style={s.deleteBtn} onClick={() => deleteExercise(ex.id)}>&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "Routines" && (
        <div style={s.page}>
          <div style={s.presetForm}>
            <input
              style={s.input}
              placeholder="Routine name"
              value={newRoutineName}
              onChange={e => setNewRoutineName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addRoutine()}
            />
            <button style={s.saveBtn} onClick={addRoutine} disabled={!newRoutineName.trim()}>Add</button>
          </div>

          {routines.length === 0 && <p style={s.empty}>No routines yet. Create one and add exercises to it.</p>}
          {routines.map(r => {
            const expanded = expandedRoutineId === r.id;
            const resolved = r.steps.map(step => ({ step, exercise: exercises.find(e => e.id === step.exerciseId) })).filter(x => x.exercise);
            return (
              <div key={r.id} style={s.card}>
                <div style={s.listItem}>
                  <div style={s.listMain} onClick={() => setExpandedRoutineId(expanded ? null : r.id)}>
                    <div style={s.listTitle}>{r.name}</div>
                    <div style={s.listMeta}>{resolved.length} exercise{resolved.length === 1 ? "" : "s"}</div>
                  </div>
                  <div style={s.listActions}>
                    <button style={s.smallBtn} onClick={() => startRoutine(r)} disabled={resolved.length === 0}>Start</button>
                    <button style={s.deleteBtn} onClick={() => deleteRoutine(r.id)}>&times;</button>
                  </div>
                </div>

                {expanded && (
                  <div style={s.routineEditor}>
                    {resolved.map(({ step, exercise: ex }, i) => (
                      <div key={step.id} style={s.routineStepRow}>
                        <div style={s.routineStepMain}>
                          <span style={s.routineStepName}>{i + 1}. {ex.name}</span>
                          <div style={s.routineStepOverrides}>
                            <label style={s.routineStepFieldLabel}>
                              Sets
                              <input
                                style={s.routineStepInput}
                                type="number"
                                min={1}
                                value={step.sets ?? ex.sets}
                                onChange={e => updateRoutineStep(r.id, i, { sets: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                              />
                            </label>
                            <label style={s.routineStepFieldLabel}>
                              Rest (s)
                              <input
                                style={s.routineStepInput}
                                type="number"
                                min={0}
                                value={step.restSec ?? (ex.restSec ?? 0)}
                                onChange={e => updateRoutineStep(r.id, i, { restSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                              />
                            </label>
                          </div>
                        </div>
                        <div style={s.listActions}>
                          <button style={s.tinyBtn} onClick={() => moveInRoutine(r.id, i, -1)} disabled={i === 0}>&uarr;</button>
                          <button style={s.tinyBtn} onClick={() => moveInRoutine(r.id, i, 1)} disabled={i === resolved.length - 1}>&darr;</button>
                          <button style={s.deleteBtn} onClick={() => removeFromRoutine(r.id, i)}>&times;</button>
                        </div>
                      </div>
                    ))}
                    {exercises.length === 0 ? (
                      <p style={s.empty}>No exercises defined yet.</p>
                    ) : (
                      <div style={s.routineAddRow}>
                        <select
                          style={s.select}
                          value={routineAddSelect[r.id] || ""}
                          onChange={e => setRoutineAddSelect({ ...routineAddSelect, [r.id]: e.target.value })}
                        >
                          <option value="">Add exercise&hellip;</option>
                          {exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                        </select>
                        <button
                          style={s.saveBtn}
                          onClick={() => { addStepToRoutine(r.id, routineAddSelect[r.id]); setRoutineAddSelect({ ...routineAddSelect, [r.id]: "" }); }}
                          disabled={!routineAddSelect[r.id]}
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "History" && (
        <div style={s.page}>
          {history.length > 0 && <button style={s.clearBtn} onClick={clearHistory}>Clear all</button>}
          {history.length === 0 && <p style={s.empty}>No logged sessions yet.</p>}
          {history.map(h => (
            <div key={h.id} style={s.listItem}>
              <div style={s.listMain}>
                <div style={s.listTitle}>
                  {h.refName} <span style={s.kindBadge}>{h.kind === "routine" ? "Routine" : "Exercise"}</span>
                </div>
                <div style={s.listMeta}>{formatDate(h.date)}</div>
                {h.steps.map((step, i) => (
                  <div key={i} style={s.historyStep}>
                    {h.kind === "routine" ? `${step.exerciseName}: ` : ""}{formatPerformedSummary(step)}
                  </div>
                ))}
              </div>
              <button style={s.deleteBtn} onClick={() => deleteHistoryEntry(h.id)}>&times;</button>
            </div>
          ))}
        </div>
      )}

      {tab === "Settings" && (
        <div style={s.page}>
          <div style={s.settingsSection}>
            <div style={{ ...s.label, marginBottom: 10 }}>Generate with AI</div>
            <div style={s.exportHint}>
              Copy this prompt into an LLM (ChatGPT, Claude, etc.) along with what you want
              (e.g. "a finger-strength routine with dead hangs and weighted pull-ups"), then
              paste the JSON it gives you into "Import exercises &amp; routines" below.
            </div>
            <button style={{ ...s.exportBtn, marginTop: 10 }} onClick={copyLlmGuidance}>
              {llmCopied ? "Copied!" : "Copy AI prompt"}
            </button>
          </div>

          <div style={s.settingsSection}>
            <div style={{ ...s.label, marginBottom: 10 }}>Exercises &amp; routines</div>
            <div style={s.exportRow}>
              <button style={s.exportBtn} onClick={() => openExport("partial")}>Export</button>
              <button style={s.exportBtn} onClick={() => openImport("partial")}>Import</button>
            </div>
            <div style={s.exportHint}>Share or AI-generate exercises and routines. Imported items are added to (or update) your existing ones — nothing is deleted.</div>
          </div>

          <div style={s.settingsSection}>
            <div style={{ ...s.label, marginBottom: 10 }}>All data</div>
            <div style={s.exportRow}>
              <button style={s.exportBtn} onClick={() => openExport("all")}>Export</button>
              <button style={s.exportBtn} onClick={() => openImport("all")}>Import</button>
            </div>
            <div style={s.exportHint}>Full backup, including history. Importing replaces everything currently stored.</div>
          </div>
        </div>
      )}

      {transferMode && (
        <div style={s.overlay} onClick={() => setTransferMode(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>
                {transferMode === "export" ? "Export" : "Import"} {transferScope === "all" ? "all data" : "exercises & routines"}
              </span>
              <button style={s.modalClose} onClick={() => setTransferMode(null)}>&times;</button>
            </div>

            {transferMode === "export" && (
              <>
                <textarea data-transfer-text style={s.transferArea} value={transferText} readOnly onFocus={e => e.target.select()} />
                <div style={s.modalActions}>
                  <button style={{ ...s.exportBtn, flex: 1 }} onClick={copyExport}>{copied ? "Copied!" : "Copy"}</button>
                  <button style={{ ...s.exportBtn, flex: 1 }} onClick={downloadExport}>Download</button>
                </div>
              </>
            )}

            {transferMode === "import" && (
              <>
                <textarea
                  style={s.transferArea}
                  value={transferText}
                  onChange={e => { setTransferText(e.target.value); setImportError(""); }}
                  placeholder="Paste exported JSON here..."
                />
                {importError && <div style={s.importError}>{importError}</div>}
                <div style={s.modalActions}>
                  <button style={{ ...s.exportBtn, flex: 1 }} onClick={() => applyImport()} disabled={!transferText.trim()}>Apply</button>
                  <button style={{ ...s.exportBtn, flex: 1 }} onClick={() => fileInputRef.current?.click()}>From file</button>
                  <input ref={fileInputRef} type="file" accept=".json" onChange={importFromFile} style={{ display: "none" }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  root: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    maxWidth: 440, margin: "0 auto", minHeight: "100vh",
    background: "#111", color: "#E8E8E8",
  },
  tabs: {
    display: "flex", borderBottom: "1px solid #282828",
    position: "sticky", top: 0, background: "#111", zIndex: 10,
  },
  tab: {
    flex: 1, padding: "14px 0", background: "none", border: "none",
    color: "#666", fontSize: 14, fontWeight: 500, cursor: "pointer",
    borderBottom: "2px solid transparent", transition: "color 0.15s",
  },
  tabActive: { color: "#E8E8E8", borderBottomColor: "#E8E8E8" },
  page: { padding: "20px 16px" },
  label: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
  numField: { flex: 1, minWidth: 0 },
  numFieldInputWrap: {
    display: "flex", alignItems: "center", gap: 6, marginTop: 6,
    background: "#1A1A1A", border: "1px solid #333", borderRadius: 8, padding: "6px 10px",
  },
  numFieldInput: {
    width: "100%", border: "none", outline: "none", background: "transparent",
    color: "#E8E8E8", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums",
  },
  numFieldSuffix: { fontSize: 12, color: "#777", whiteSpace: "nowrap" },
  addBtn: {
    width: "100%", padding: "12px 0", borderRadius: 10, border: "1px dashed #444",
    background: "transparent", color: "#CCC", fontSize: 14, fontWeight: 600, cursor: "pointer",
    marginBottom: 16,
  },
  card: {
    background: "#161616", border: "1px solid #282828", borderRadius: 12,
    padding: 14, marginBottom: 16,
  },
  input: {
    flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 14, outline: "none",
    marginBottom: 12, width: "100%", boxSizing: "border-box",
  },
  select: {
    flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 14, outline: "none",
  },
  typeRow: { display: "flex", gap: 8, marginBottom: 14 },
  typeChip: {
    flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#999", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  typeChipActive: { background: "#D9A441", color: "#1A1300", border: "1px solid #D9A441" },
  fieldRow: { display: "flex", gap: 10, marginBottom: 14 },
  saveBtn: {
    padding: "10px 16px", borderRadius: 8, border: "none",
    background: "#D9A441", color: "#1A1300", fontSize: 13, fontWeight: 700, cursor: "pointer",
    whiteSpace: "nowrap",
  },
  modalActions: { display: "flex", gap: 8, marginTop: 4 },
  exportBtn: {
    flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#CCC", fontSize: 13, fontWeight: 500, cursor: "pointer",
  },
  empty: { color: "#555", fontSize: 14, textAlign: "center", marginTop: 24, marginBottom: 24 },
  listItem: {
    display: "flex", alignItems: "center", padding: "14px 0",
    borderBottom: "1px solid #1E1E1E", gap: 10,
  },
  listMain: { flex: 1, cursor: "pointer", minWidth: 0 },
  listTitle: { fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 },
  listMeta: { fontSize: 13, color: "#666", marginTop: 2 },
  listActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  smallBtn: {
    padding: "8px 12px", borderRadius: 8, border: "none",
    background: "#D9A441", color: "#1A1300", fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  smallBtnGhost: {
    padding: "8px 12px", borderRadius: 8, border: "1px solid #333",
    background: "transparent", color: "#CCC", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  tinyBtn: {
    width: 26, height: 26, borderRadius: 6, border: "1px solid #333",
    background: "#1A1A1A", color: "#CCC", fontSize: 12, cursor: "pointer",
  },
  deleteBtn: {
    width: 30, height: 30, borderRadius: 8, border: "none",
    background: "transparent", color: "#555", fontSize: 18, cursor: "pointer", flexShrink: 0,
  },
  kindBadge: {
    fontSize: 10, fontWeight: 700, color: "#999", background: "#222",
    borderRadius: 5, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.04em",
  },
  presetForm: { display: "flex", gap: 8, marginBottom: 16 },
  routineEditor: { marginTop: 6, paddingTop: 10, borderTop: "1px solid #232323" },
  routineStepRow: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    padding: "10px 0", gap: 8, borderBottom: "1px solid #1E1E1E",
  },
  routineStepMain: { minWidth: 0, flex: 1 },
  routineStepName: { fontSize: 14, color: "#DDD", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  routineStepOverrides: { display: "flex", gap: 14, marginTop: 8 },
  routineStepFieldLabel: {
    display: "flex", flexDirection: "column", gap: 4, fontSize: 10, color: "#666",
    textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600,
  },
  routineStepInput: {
    width: 52, padding: "5px 6px", borderRadius: 6, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 13, outline: "none",
    fontVariantNumeric: "tabular-nums",
  },
  routineAddRow: { display: "flex", gap: 8, marginTop: 10 },
  clearBtn: {
    padding: "8px 14px", borderRadius: 8, border: "1px solid #333",
    background: "transparent", color: "#888", fontSize: 13, cursor: "pointer",
    marginBottom: 16, display: "block",
  },
  historyStep: { fontSize: 13, color: "#999", marginTop: 4 },
  settingsSection: { marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid #222" },
  exportRow: { display: "flex", gap: 8 },
  exportHint: { fontSize: 12, color: "#555", marginTop: 8 },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100,
  },
  modal: {
    background: "#1A1A1A", borderRadius: "16px 16px 0 0", width: "100%",
    maxWidth: 440, padding: "20px 16px 24px", maxHeight: "80vh",
    display: "flex", flexDirection: "column",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontSize: 16, fontWeight: 600 },
  modalClose: { background: "none", border: "none", color: "#888", fontSize: 24, cursor: "pointer", padding: "0 4px" },
  transferArea: {
    width: "100%", minHeight: 140, maxHeight: 260, resize: "vertical",
    background: "#111", color: "#CCC", border: "1px solid #333",
    borderRadius: 8, padding: 12, fontSize: 13, fontFamily: "monospace",
    outline: "none", boxSizing: "border-box",
  },
  importError: { color: "#E8553A", fontSize: 13, marginTop: 6 },

  // Session page
  sessionTopBar: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cancelBtn: {
    padding: "8px 14px", borderRadius: 8, border: "1px solid #333",
    background: "transparent", color: "#999", fontSize: 13, fontWeight: 500, cursor: "pointer",
  },
  sessionTitle: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },

  exerciseCard: {
    background: "#161616", border: "1px solid #282828", borderRadius: 12,
    padding: 14, marginBottom: 14,
  },
  exerciseCardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  exerciseCardHeaderMain: { flex: 1, minWidth: 0, cursor: "pointer" },
  exerciseCardName: { fontSize: 17, fontWeight: 700 },
  exerciseCardTarget: { fontSize: 13, color: "#888", marginTop: 2 },
  hidden: { display: "none" },

  setsTarget: { fontSize: 13, color: "#888", margin: "14px 0" },
  setsTable: { marginBottom: 12, marginTop: 14 },
  setsHeaderRow: { display: "flex", gap: 10, marginBottom: 6, alignItems: "center" },
  setsHeaderCell: { fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em", flex: 1 },
  setsRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 8 },
  setsRowDone: { opacity: 0.55 },
  setsCheckbox: { width: 20, height: 20, flexShrink: 0, cursor: "pointer", accentColor: "#D9A441" },
  setsIndex: { width: 22, fontSize: 13, color: "#888", fontWeight: 600, flexShrink: 0 },
  setsInput: {
    flex: 1, padding: "10px 10px", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 15, outline: "none",
    fontVariantNumeric: "tabular-nums", minWidth: 0,
  },
  restInline: {
    display: "flex", alignItems: "center", gap: 8, margin: "-2px 0 10px 32px",
    padding: "6px 10px", borderRadius: 8, background: "rgba(58,158,110,0.1)",
    border: "1px solid rgba(58,158,110,0.3)",
  },
  restInlineLabel: { fontSize: 13, color: "#3A9E6E", fontWeight: 600, flex: 1, fontVariantNumeric: "tabular-nums" },
  addSetBtn: {
    width: "100%", padding: "10px 0", borderRadius: 8, border: "1px dashed #444",
    background: "transparent", color: "#CCC", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  startBtn: {
    width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
    background: "#D9A441", color: "#1A1300", fontSize: 16, fontWeight: 700, cursor: "pointer",
  },
  controls: { display: "flex", gap: 10, justifyContent: "center" },
  pauseBtn: {
    flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #444",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  stopBtn: {
    flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #333",
    background: "transparent", color: "#999", fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  skipBtn: {
    flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #444",
    background: "transparent", color: "#CCC", fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  timerBox: {
    borderRadius: 16, padding: "36px 20px", textAlign: "center",
    border: "1px solid #222", marginBottom: 20, transition: "background 0.3s",
  },
  phaseLabel: { fontSize: 14, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 8 },
  timerDigits: { fontSize: 64, fontWeight: 200, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", lineHeight: 1 },
  timerSub: { marginTop: 12, fontSize: 14, color: "#888" },
};

ReactDOM.createRoot(document.getElementById("app")).render(<ClimbingTrackerApp />);
