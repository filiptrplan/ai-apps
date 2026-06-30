(() => {
  const { useState, useEffect, useRef } = React;
  const STORAGE_KEYS = {
    exercises: "climbing-tracker-exercises",
    routines: "climbing-tracker-routines",
    history: "climbing-tracker-history"
  };
  function uid() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch {
      }
    };
    return [data, save];
  }
  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  const EXERCISE_TYPES = [
    { value: "reps", label: "Reps" },
    { value: "weighted", label: "Weighted" },
    { value: "interval", label: "Interval" }
  ];
  function defaultFieldsForType(type) {
    if (type === "weighted") return { sets: 3, reps: 5, weight: 10, weightMode: "added" };
    if (type === "interval") return { workSec: 10, restSec: 5, sets: 6 };
    return { sets: 3, reps: 10 };
  }
  function formatWeightLabel(weightMode, weight) {
    return weightMode === "added" ? `BW +${weight}kg` : `${weight}kg`;
  }
  function formatTargetSummary(ex) {
    if (ex.type === "weighted") return `${ex.sets} \xD7 ${ex.reps} reps @ ${formatWeightLabel(ex.weightMode, ex.weight)}`;
    if (ex.type === "interval") return `${ex.sets} sets \xB7 ${ex.workSec}s on / ${ex.restSec}s off`;
    return `${ex.sets} \xD7 ${ex.reps} reps`;
  }
  function formatPerformedSummary(step) {
    const p = step.performed;
    if (p.type === "weighted") {
      return `${p.sets.length} sets: ` + p.sets.map((s2) => `${s2.reps}\xD7${formatWeightLabel(p.weightMode, s2.weight)}`).join(", ");
    }
    if (p.type === "interval") {
      return `${p.completedSets}/${p.targetSets} sets \xB7 ${p.workSec}s on / ${p.restSec}s off`;
    }
    return `${p.sets.length} sets: ` + p.sets.map((s2) => s2.reps).join(", ") + " reps";
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
      gain.gain.exponentialRampToValueAtTime(1e-3, t0 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch {
    }
  }
  const sounds = {
    countdown: () => beep(880, 0.1, 0.18, "sine"),
    workStart: () => beep(660, 0.18, 0.22, "square"),
    restStart: () => beep(440, 0.18, 0.22, "sine"),
    finish: () => {
      beep(523, 0.15, 0.22, "sine", 0);
      beep(659, 0.15, 0.22, "sine", 0.15);
      beep(784, 0.3, 0.24, "sine", 0.3);
    }
  };
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s2 = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
  }
  function NumberField({ label, value, onChange, min = 0, step = 1, suffix = "" }) {
    return /* @__PURE__ */ React.createElement("div", { style: s.numField }, /* @__PURE__ */ React.createElement("label", { style: s.label }, label), /* @__PURE__ */ React.createElement("div", { style: s.numFieldInputWrap }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.numFieldInput,
        type: "number",
        min,
        step,
        value,
        onChange: (e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))
      }
    ), suffix && /* @__PURE__ */ React.createElement("span", { style: s.numFieldSuffix }, suffix)));
  }
  function ExerciseForm({ draft, onChange, onSave, onCancel }) {
    const set = (patch) => onChange({ ...draft, ...patch });
    return /* @__PURE__ */ React.createElement("div", { style: s.card }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.input,
        placeholder: "Exercise name",
        value: draft.name,
        onChange: (e) => set({ name: e.target.value }),
        autoFocus: true
      }
    ), /* @__PURE__ */ React.createElement("div", { style: s.typeRow }, EXERCISE_TYPES.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t.value,
        style: { ...s.typeChip, ...draft.type === t.value ? s.typeChipActive : {} },
        onClick: () => set({ type: t.value, ...defaultFieldsForType(t.value) })
      },
      t.label
    ))), draft.type === "reps" && /* @__PURE__ */ React.createElement("div", { style: s.fieldRow }, /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set({ sets: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Reps", value: draft.reps, onChange: (v) => set({ reps: v }), min: 1 })), draft.type === "weighted" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: s.fieldRow }, /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set({ sets: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Reps", value: draft.reps, onChange: (v) => set({ reps: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Weight", value: draft.weight, onChange: (v) => set({ weight: v }), min: 0, step: 0.5, suffix: "kg" })), /* @__PURE__ */ React.createElement("div", { style: s.typeRow }, /* @__PURE__ */ React.createElement(
      "button",
      {
        style: { ...s.typeChip, ...draft.weightMode === "added" ? s.typeChipActive : {} },
        onClick: () => set({ weightMode: "added" })
      },
      "Bodyweight + kg"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: { ...s.typeChip, ...draft.weightMode === "total" ? s.typeChipActive : {} },
        onClick: () => set({ weightMode: "total" })
      },
      "Total weight"
    ))), draft.type === "interval" && /* @__PURE__ */ React.createElement("div", { style: s.fieldRow }, /* @__PURE__ */ React.createElement(NumberField, { label: "Work", value: draft.workSec, onChange: (v) => set({ workSec: v }), min: 1, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: draft.restSec, onChange: (v) => set({ restSec: v }), min: 0, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set({ sets: v }), min: 1 })), /* @__PURE__ */ React.createElement("div", { style: s.modalActions }, /* @__PURE__ */ React.createElement("button", { style: { ...s.saveBtn, flex: 1 }, onClick: onSave, disabled: !draft.name.trim() }, "Save"), /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: onCancel }, "Cancel")));
  }
  function SetsRunner({ exercise, onComplete }) {
    const [sets, setSets] = useState(
      () => Array.from({ length: exercise.sets || 1 }, () => ({ reps: exercise.reps || 0, weight: exercise.weight || 0 }))
    );
    const updateSet = (i, patch) => setSets(sets.map((row, idx) => idx === i ? { ...row, ...patch } : row));
    const removeSet = (i) => setSets(sets.filter((_, idx) => idx !== i));
    const addSet = () => {
      const last = sets[sets.length - 1] || { reps: exercise.reps || 0, weight: exercise.weight || 0 };
      setSets([...sets, { ...last }]);
    };
    const finish = () => {
      if (exercise.type === "weighted") {
        onComplete({
          type: "weighted",
          weightMode: exercise.weightMode,
          targetSets: exercise.sets,
          targetReps: exercise.reps,
          targetWeight: exercise.weight,
          sets: sets.map((r) => ({ reps: Number(r.reps) || 0, weight: Number(r.weight) || 0 }))
        });
      } else {
        onComplete({
          type: "reps",
          targetSets: exercise.sets,
          targetReps: exercise.reps,
          sets: sets.map((r) => ({ reps: Number(r.reps) || 0 }))
        });
      }
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: s.setsTarget }, "Target: ", formatTargetSummary(exercise)), /* @__PURE__ */ React.createElement("div", { style: s.setsTable }, /* @__PURE__ */ React.createElement("div", { style: s.setsHeaderRow }, /* @__PURE__ */ React.createElement("span", { style: s.setsHeaderCell }, "Set"), /* @__PURE__ */ React.createElement("span", { style: s.setsHeaderCell }, "Reps"), exercise.type === "weighted" && /* @__PURE__ */ React.createElement("span", { style: s.setsHeaderCell }, "Weight (kg)"), /* @__PURE__ */ React.createElement("span", { style: { ...s.setsHeaderCell, width: 28 } })), sets.map((row, i) => /* @__PURE__ */ React.createElement("div", { style: s.setsRow, key: i }, /* @__PURE__ */ React.createElement("span", { style: s.setsIndex }, i + 1), /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.setsInput,
        type: "number",
        min: 0,
        value: row.reps,
        onChange: (e) => updateSet(i, { reps: e.target.value })
      }
    ), exercise.type === "weighted" && /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.setsInput,
        type: "number",
        min: 0,
        step: 0.5,
        value: row.weight,
        onChange: (e) => updateSet(i, { weight: e.target.value })
      }
    ), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => removeSet(i), disabled: sets.length <= 1 }, "\xD7")))), /* @__PURE__ */ React.createElement("button", { style: s.addSetBtn, onClick: addSet }, "+ Add set"), /* @__PURE__ */ React.createElement("button", { style: s.startBtn, onClick: finish }, "Finish exercise"));
  }
  function IntervalRunner({ exercise, onComplete }) {
    const [phase, setPhase] = useState("idle");
    const [currentSet, setCurrentSet] = useState(1);
    const [timeLeft, setTimeLeft] = useState(exercise.workSec);
    const [paused, setPaused] = useState(false);
    const intervalRef = useRef(null);
    const phaseRef = useRef("idle");
    const currentSetRef = useRef(1);
    const timeLeftRef = useRef(exercise.workSec);
    const completedRef = useRef(0);
    const clearTick = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    const finishNow = () => {
      clearTick();
      setPhase("done");
    };
    const runTick = () => {
      timeLeftRef.current -= 1;
      if (timeLeftRef.current <= 0) {
        if (phaseRef.current === "work") {
          completedRef.current += 1;
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
      intervalRef.current = setInterval(runTick, 1e3);
    };
    const togglePause = () => {
      if (paused) {
        intervalRef.current = setInterval(runTick, 1e3);
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
    const completed = phase === "done" ? completedRef.current >= exercise.sets ? exercise.sets : completedRef.current : completedRef.current;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { ...s.timerBox, background: phaseBg } }, phase === "idle" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: s.timerDigits }, formatTime(exercise.workSec)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, exercise.sets, " sets \xB7 ", formatTime(exercise.workSec), " on \xB7 ", formatTime(exercise.restSec), " off")), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: phaseColor } }, phase.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { ...s.timerDigits, color: phaseColor } }, formatTime(timeLeft)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, "Set ", currentSet, " / ", exercise.sets), paused && /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: "#F0AD4E", marginTop: 8, fontSize: 13 } }, "PAUSED")), phase === "done" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: "#3A9E6E" } }, "DONE"), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, completed, " / ", exercise.sets, " sets completed"))), /* @__PURE__ */ React.createElement("div", { style: s.controls }, phase === "idle" && /* @__PURE__ */ React.createElement("button", { style: s.startBtn, onClick: start }, "Start"), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: s.pauseBtn, onClick: togglePause }, paused ? "Resume" : "Pause"), /* @__PURE__ */ React.createElement("button", { style: s.skipBtn, onClick: skip }, "Skip"), /* @__PURE__ */ React.createElement("button", { style: s.stopBtn, onClick: finishNow }, "Finish now")), phase === "done" && /* @__PURE__ */ React.createElement("button", { style: s.startBtn, onClick: () => onComplete({
      type: "interval",
      workSec: exercise.workSec,
      restSec: exercise.restSec,
      targetSets: exercise.sets,
      completedSets: completed
    }) }, "Continue")));
  }
  function SessionRunner({ session, onCancel, onStepComplete }) {
    const exercise = session.steps[session.stepIndex];
    const isRoutine = session.kind === "routine";
    return /* @__PURE__ */ React.createElement("div", { style: s.page }, /* @__PURE__ */ React.createElement("div", { style: s.sessionTopBar }, /* @__PURE__ */ React.createElement("button", { style: s.cancelBtn, onClick: onCancel }, "Cancel"), isRoutine && /* @__PURE__ */ React.createElement("div", { style: s.sessionProgress }, "Step ", session.stepIndex + 1, " / ", session.steps.length)), /* @__PURE__ */ React.createElement("div", { style: s.sessionTitle }, isRoutine ? session.refName : "Exercise"), /* @__PURE__ */ React.createElement("div", { style: s.sessionExerciseName }, exercise.name), exercise.type === "interval" ? /* @__PURE__ */ React.createElement(IntervalRunner, { key: session.stepIndex, exercise, onComplete: onStepComplete }) : /* @__PURE__ */ React.createElement(SetsRunner, { key: session.stepIndex, exercise, onComplete: onStepComplete }));
  }
  const TABS = ["Exercises", "Routines", "History"];
  function ClimbingTrackerApp() {
    const [tab, setTab] = useState("Exercises");
    const [exercises, setExercises] = useStorage(STORAGE_KEYS.exercises, []);
    const [routines, setRoutines] = useStorage(STORAGE_KEYS.routines, []);
    const [history, setHistory] = useStorage(STORAGE_KEYS.history, []);
    const [activeSession, setActiveSession] = useState(null);
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
        setExercises(exercises.map((e) => e.id === editingId ? { ...draft, id: editingId } : e));
      } else {
        setExercises([...exercises, { ...draft, id: uid() }]);
      }
      setFormOpen(false);
    };
    const deleteExercise = (id) => {
      setExercises(exercises.filter((e) => e.id !== id));
      setRoutines(routines.map((r) => ({ ...r, exerciseIds: r.exerciseIds.filter((eid) => eid !== id) })));
    };
    const [newRoutineName, setNewRoutineName] = useState("");
    const [expandedRoutineId, setExpandedRoutineId] = useState(null);
    const [routineAddSelect, setRoutineAddSelect] = useState({});
    const addRoutine = () => {
      if (!newRoutineName.trim()) return;
      const r = { id: uid(), name: newRoutineName.trim(), exerciseIds: [] };
      setRoutines([...routines, r]);
      setNewRoutineName("");
      setExpandedRoutineId(r.id);
    };
    const deleteRoutine = (id) => setRoutines(routines.filter((r) => r.id !== id));
    const addExerciseToRoutine = (routineId, exerciseId) => {
      if (!exerciseId) return;
      setRoutines(routines.map((r) => r.id === routineId ? { ...r, exerciseIds: [...r.exerciseIds, exerciseId] } : r));
    };
    const removeFromRoutine = (routineId, idx) => {
      setRoutines(routines.map((r) => r.id === routineId ? { ...r, exerciseIds: r.exerciseIds.filter((_, i) => i !== idx) } : r));
    };
    const moveInRoutine = (routineId, idx, dir) => {
      setRoutines(routines.map((r) => {
        if (r.id !== routineId) return r;
        const ids = [...r.exerciseIds];
        const j = idx + dir;
        if (j < 0 || j >= ids.length) return r;
        [ids[idx], ids[j]] = [ids[j], ids[idx]];
        return { ...r, exerciseIds: ids };
      }));
    };
    const startExercise = (ex) => setActiveSession({ kind: "exercise", refId: ex.id, refName: ex.name, steps: [ex], stepIndex: 0, results: [] });
    const startRoutine = (r) => {
      const steps = r.exerciseIds.map((id) => exercises.find((e) => e.id === id)).filter(Boolean);
      if (steps.length === 0) return;
      setActiveSession({ kind: "routine", refId: r.id, refName: r.name, steps, stepIndex: 0, results: [] });
    };
    const cancelSession = () => setActiveSession(null);
    const completeStep = (performed) => {
      const current = activeSession;
      const stepExercise = current.steps[current.stepIndex];
      const results = [...current.results, { exerciseId: stepExercise.id, exerciseName: stepExercise.name, performed }];
      if (current.stepIndex + 1 < current.steps.length) {
        setActiveSession({ ...current, stepIndex: current.stepIndex + 1, results });
      } else {
        const entry = {
          id: uid(),
          date: (/* @__PURE__ */ new Date()).toISOString(),
          kind: current.kind,
          refId: current.refId,
          refName: current.refName,
          steps: results
        };
        setHistory([entry, ...history]);
        setActiveSession(null);
      }
    };
    const deleteHistoryEntry = (id) => setHistory(history.filter((h) => h.id !== id));
    const clearHistory = () => setHistory([]);
    const fileInputRef = useRef(null);
    const [transferMode, setTransferMode] = useState(null);
    const [transferText, setTransferText] = useState("");
    const [copied, setCopied] = useState(false);
    const [importError, setImportError] = useState("");
    const openExport = () => {
      setTransferText(JSON.stringify({ exercises, routines, history }, null, 2));
      setCopied(false);
      setTransferMode("export");
    };
    const openImport = () => {
      setTransferText("");
      setImportError("");
      setTransferMode("import");
    };
    const copyExport = async () => {
      try {
        await navigator.clipboard.writeText(transferText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2e3);
      } catch {
        const ta = document.querySelector("[data-transfer-text]");
        if (ta) {
          ta.select();
          document.execCommand("copy");
          setCopied(true);
          setTimeout(() => setCopied(false), 2e3);
        }
      }
    };
    const downloadExport = () => {
      const blob = new Blob([transferText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `climbing-tracker-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
    const applyImport = (text) => {
      try {
        const data = JSON.parse(text || transferText);
        if (Array.isArray(data.exercises)) setExercises(data.exercises);
        if (Array.isArray(data.routines)) setRoutines(data.routines);
        if (Array.isArray(data.history)) setHistory(data.history);
        setTransferMode(null);
        setImportError("");
      } catch {
        setImportError("Invalid JSON");
      }
    };
    const importFromFile = (e) => {
      var _a;
      const file = (_a = e.target.files) == null ? void 0 : _a[0];
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
    if (activeSession) {
      return /* @__PURE__ */ React.createElement("div", { style: s.root }, /* @__PURE__ */ React.createElement(SessionRunner, { session: activeSession, onCancel: cancelSession, onStepComplete: completeStep }));
    }
    return /* @__PURE__ */ React.createElement("div", { style: s.root }, /* @__PURE__ */ React.createElement("div", { style: s.tabs }, TABS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t, onClick: () => setTab(t), style: { ...s.tab, ...tab === t ? s.tabActive : {} } }, t, t === "History" && history.length > 0 ? ` (${history.length})` : ""))), tab === "Exercises" && /* @__PURE__ */ React.createElement("div", { style: s.page }, !formOpen && /* @__PURE__ */ React.createElement("button", { style: s.addBtn, onClick: openNewExercise }, "+ New exercise"), formOpen && /* @__PURE__ */ React.createElement(ExerciseForm, { draft, onChange: setDraft, onSave: saveExercise, onCancel: () => setFormOpen(false) }), exercises.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No exercises yet. Add one to get started."), exercises.map((ex) => /* @__PURE__ */ React.createElement("div", { key: ex.id, style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, ex.name), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, formatTargetSummary(ex))), /* @__PURE__ */ React.createElement("div", { style: s.listActions }, /* @__PURE__ */ React.createElement("button", { style: s.smallBtn, onClick: () => startExercise(ex) }, "Start"), /* @__PURE__ */ React.createElement("button", { style: s.smallBtnGhost, onClick: () => openEditExercise(ex) }, "Edit"), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => deleteExercise(ex.id) }, "\xD7"))))), tab === "Routines" && /* @__PURE__ */ React.createElement("div", { style: s.page }, /* @__PURE__ */ React.createElement("div", { style: s.presetForm }, /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.input,
        placeholder: "Routine name",
        value: newRoutineName,
        onChange: (e) => setNewRoutineName(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && addRoutine()
      }
    ), /* @__PURE__ */ React.createElement("button", { style: s.saveBtn, onClick: addRoutine, disabled: !newRoutineName.trim() }, "Add")), routines.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No routines yet. Create one and add exercises to it."), routines.map((r) => {
      const expanded = expandedRoutineId === r.id;
      const steps = r.exerciseIds.map((id) => exercises.find((e) => e.id === id)).filter(Boolean);
      return /* @__PURE__ */ React.createElement("div", { key: r.id, style: s.card }, /* @__PURE__ */ React.createElement("div", { style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain, onClick: () => setExpandedRoutineId(expanded ? null : r.id) }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, r.name), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, steps.length, " exercise", steps.length === 1 ? "" : "s")), /* @__PURE__ */ React.createElement("div", { style: s.listActions }, /* @__PURE__ */ React.createElement("button", { style: s.smallBtn, onClick: () => startRoutine(r), disabled: steps.length === 0 }, "Start"), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => deleteRoutine(r.id) }, "\xD7"))), expanded && /* @__PURE__ */ React.createElement("div", { style: s.routineEditor }, steps.map((ex, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: s.routineStepRow }, /* @__PURE__ */ React.createElement("span", { style: s.routineStepName }, i + 1, ". ", ex.name), /* @__PURE__ */ React.createElement("div", { style: s.listActions }, /* @__PURE__ */ React.createElement("button", { style: s.tinyBtn, onClick: () => moveInRoutine(r.id, i, -1), disabled: i === 0 }, "\u2191"), /* @__PURE__ */ React.createElement("button", { style: s.tinyBtn, onClick: () => moveInRoutine(r.id, i, 1), disabled: i === steps.length - 1 }, "\u2193"), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => removeFromRoutine(r.id, i) }, "\xD7")))), exercises.length === 0 ? /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No exercises defined yet.") : /* @__PURE__ */ React.createElement("div", { style: s.routineAddRow }, /* @__PURE__ */ React.createElement(
        "select",
        {
          style: s.select,
          value: routineAddSelect[r.id] || "",
          onChange: (e) => setRoutineAddSelect({ ...routineAddSelect, [r.id]: e.target.value })
        },
        /* @__PURE__ */ React.createElement("option", { value: "" }, "Add exercise\u2026"),
        exercises.map((ex) => /* @__PURE__ */ React.createElement("option", { key: ex.id, value: ex.id }, ex.name))
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          style: s.saveBtn,
          onClick: () => {
            addExerciseToRoutine(r.id, routineAddSelect[r.id]);
            setRoutineAddSelect({ ...routineAddSelect, [r.id]: "" });
          },
          disabled: !routineAddSelect[r.id]
        },
        "Add"
      ))));
    })), tab === "History" && /* @__PURE__ */ React.createElement("div", { style: s.page }, history.length > 0 && /* @__PURE__ */ React.createElement("button", { style: s.clearBtn, onClick: clearHistory }, "Clear all"), history.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No logged sessions yet."), history.map((h) => /* @__PURE__ */ React.createElement("div", { key: h.id, style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, h.refName, " ", /* @__PURE__ */ React.createElement("span", { style: s.kindBadge }, h.kind === "routine" ? "Routine" : "Exercise")), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, formatDate(h.date)), h.steps.map((step, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: s.historyStep }, h.kind === "routine" ? `${step.exerciseName}: ` : "", formatPerformedSummary(step)))), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => deleteHistoryEntry(h.id) }, "\xD7"))), /* @__PURE__ */ React.createElement("div", { style: s.exportSection }, /* @__PURE__ */ React.createElement("div", { style: { ...s.label, marginBottom: 10 } }, "Transfer data"), /* @__PURE__ */ React.createElement("div", { style: s.exportRow }, /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: openExport }, "Export"), /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: openImport }, "Import")), /* @__PURE__ */ React.createElement("div", { style: s.exportHint }, "Move exercises, routines and history between devices."))), transferMode && /* @__PURE__ */ React.createElement("div", { style: s.overlay, onClick: () => setTransferMode(null) }, /* @__PURE__ */ React.createElement("div", { style: s.modal, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: s.modalHeader }, /* @__PURE__ */ React.createElement("span", { style: s.modalTitle }, transferMode === "export" ? "Export" : "Import"), /* @__PURE__ */ React.createElement("button", { style: s.modalClose, onClick: () => setTransferMode(null) }, "\xD7")), transferMode === "export" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("textarea", { "data-transfer-text": true, style: s.transferArea, value: transferText, readOnly: true, onFocus: (e) => e.target.select() }), /* @__PURE__ */ React.createElement("div", { style: s.modalActions }, /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: copyExport }, copied ? "Copied!" : "Copy"), /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: downloadExport }, "Download"))), transferMode === "import" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "textarea",
      {
        style: s.transferArea,
        value: transferText,
        onChange: (e) => {
          setTransferText(e.target.value);
          setImportError("");
        },
        placeholder: "Paste exported JSON here..."
      }
    ), importError && /* @__PURE__ */ React.createElement("div", { style: s.importError }, importError), /* @__PURE__ */ React.createElement("div", { style: s.modalActions }, /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: () => applyImport(), disabled: !transferText.trim() }, "Apply"), /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: () => {
      var _a;
      return (_a = fileInputRef.current) == null ? void 0 : _a.click();
    } }, "From file"), /* @__PURE__ */ React.createElement("input", { ref: fileInputRef, type: "file", accept: ".json", onChange: importFromFile, style: { display: "none" } }))))));
  }
  const s = {
    root: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      maxWidth: 440,
      margin: "0 auto",
      minHeight: "100vh",
      background: "#111",
      color: "#E8E8E8"
    },
    tabs: {
      display: "flex",
      borderBottom: "1px solid #282828",
      position: "sticky",
      top: 0,
      background: "#111",
      zIndex: 10
    },
    tab: {
      flex: 1,
      padding: "14px 0",
      background: "none",
      border: "none",
      color: "#666",
      fontSize: 14,
      fontWeight: 500,
      cursor: "pointer",
      borderBottom: "2px solid transparent",
      transition: "color 0.15s"
    },
    tabActive: { color: "#E8E8E8", borderBottomColor: "#E8E8E8" },
    page: { padding: "20px 16px" },
    label: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
    numField: { flex: 1, minWidth: 0 },
    numFieldInputWrap: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginTop: 6,
      background: "#1A1A1A",
      border: "1px solid #333",
      borderRadius: 8,
      padding: "6px 10px"
    },
    numFieldInput: {
      width: "100%",
      border: "none",
      outline: "none",
      background: "transparent",
      color: "#E8E8E8",
      fontSize: 15,
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums"
    },
    numFieldSuffix: { fontSize: 12, color: "#777", whiteSpace: "nowrap" },
    addBtn: {
      width: "100%",
      padding: "12px 0",
      borderRadius: 10,
      border: "1px dashed #444",
      background: "transparent",
      color: "#CCC",
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
      marginBottom: 16
    },
    card: {
      background: "#161616",
      border: "1px solid #282828",
      borderRadius: 12,
      padding: 14,
      marginBottom: 16
    },
    input: {
      flex: 1,
      padding: "10px 12px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#E8E8E8",
      fontSize: 14,
      outline: "none",
      marginBottom: 12,
      width: "100%",
      boxSizing: "border-box"
    },
    select: {
      flex: 1,
      padding: "10px 12px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#E8E8E8",
      fontSize: 14,
      outline: "none"
    },
    typeRow: { display: "flex", gap: 8, marginBottom: 14 },
    typeChip: {
      flex: 1,
      padding: "9px 0",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#999",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer"
    },
    typeChipActive: { background: "#D9A441", color: "#1A1300", border: "1px solid #D9A441" },
    fieldRow: { display: "flex", gap: 10, marginBottom: 14 },
    saveBtn: {
      padding: "10px 16px",
      borderRadius: 8,
      border: "none",
      background: "#D9A441",
      color: "#1A1300",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
      whiteSpace: "nowrap"
    },
    modalActions: { display: "flex", gap: 8, marginTop: 4 },
    exportBtn: {
      flex: 1,
      padding: "10px 0",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#CCC",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer"
    },
    empty: { color: "#555", fontSize: 14, textAlign: "center", marginTop: 24, marginBottom: 24 },
    listItem: {
      display: "flex",
      alignItems: "center",
      padding: "14px 0",
      borderBottom: "1px solid #1E1E1E",
      gap: 10
    },
    listMain: { flex: 1, cursor: "pointer", minWidth: 0 },
    listTitle: { fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 },
    listMeta: { fontSize: 13, color: "#666", marginTop: 2 },
    listActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
    smallBtn: {
      padding: "8px 12px",
      borderRadius: 8,
      border: "none",
      background: "#D9A441",
      color: "#1A1300",
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer"
    },
    smallBtnGhost: {
      padding: "8px 12px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "transparent",
      color: "#CCC",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer"
    },
    tinyBtn: {
      width: 26,
      height: 26,
      borderRadius: 6,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#CCC",
      fontSize: 12,
      cursor: "pointer"
    },
    deleteBtn: {
      width: 30,
      height: 30,
      borderRadius: 8,
      border: "none",
      background: "transparent",
      color: "#555",
      fontSize: 18,
      cursor: "pointer",
      flexShrink: 0
    },
    kindBadge: {
      fontSize: 10,
      fontWeight: 700,
      color: "#999",
      background: "#222",
      borderRadius: 5,
      padding: "2px 6px",
      textTransform: "uppercase",
      letterSpacing: "0.04em"
    },
    presetForm: { display: "flex", gap: 8, marginBottom: 16 },
    routineEditor: { marginTop: 6, paddingTop: 10, borderTop: "1px solid #232323" },
    routineStepRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 0",
      gap: 8
    },
    routineStepName: { fontSize: 14, color: "#DDD", minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    routineAddRow: { display: "flex", gap: 8, marginTop: 10 },
    clearBtn: {
      padding: "8px 14px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "transparent",
      color: "#888",
      fontSize: 13,
      cursor: "pointer",
      marginBottom: 16,
      display: "block"
    },
    historyStep: { fontSize: 13, color: "#999", marginTop: 4 },
    exportSection: { marginTop: 32, paddingTop: 20, borderTop: "1px solid #222" },
    exportRow: { display: "flex", gap: 8 },
    exportHint: { fontSize: 12, color: "#555", marginTop: 8 },
    overlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      zIndex: 100
    },
    modal: {
      background: "#1A1A1A",
      borderRadius: "16px 16px 0 0",
      width: "100%",
      maxWidth: 440,
      padding: "20px 16px 24px",
      maxHeight: "80vh",
      display: "flex",
      flexDirection: "column"
    },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    modalTitle: { fontSize: 16, fontWeight: 600 },
    modalClose: { background: "none", border: "none", color: "#888", fontSize: 24, cursor: "pointer", padding: "0 4px" },
    transferArea: {
      width: "100%",
      minHeight: 140,
      maxHeight: 260,
      resize: "vertical",
      background: "#111",
      color: "#CCC",
      border: "1px solid #333",
      borderRadius: 8,
      padding: 12,
      fontSize: 13,
      fontFamily: "monospace",
      outline: "none",
      boxSizing: "border-box"
    },
    importError: { color: "#E8553A", fontSize: 13, marginTop: 6 },
    // Session runner
    sessionTopBar: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    cancelBtn: {
      padding: "8px 14px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "transparent",
      color: "#999",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer"
    },
    sessionProgress: { fontSize: 13, color: "#777", fontWeight: 600 },
    sessionTitle: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
    sessionExerciseName: { fontSize: 22, fontWeight: 700, marginTop: 4, marginBottom: 18 },
    setsTarget: { fontSize: 13, color: "#888", marginBottom: 14 },
    setsTable: { marginBottom: 12 },
    setsHeaderRow: { display: "flex", gap: 10, marginBottom: 6, alignItems: "center" },
    setsHeaderCell: { fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em", flex: 1 },
    setsRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 8 },
    setsIndex: { width: 22, fontSize: 13, color: "#888", fontWeight: 600, flexShrink: 0 },
    setsInput: {
      flex: 1,
      padding: "10px 10px",
      borderRadius: 8,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#E8E8E8",
      fontSize: 15,
      outline: "none",
      fontVariantNumeric: "tabular-nums",
      minWidth: 0
    },
    addSetBtn: {
      width: "100%",
      padding: "10px 0",
      borderRadius: 8,
      border: "1px dashed #444",
      background: "transparent",
      color: "#CCC",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      marginBottom: 20
    },
    startBtn: {
      width: "100%",
      padding: "14px 0",
      borderRadius: 10,
      border: "none",
      background: "#D9A441",
      color: "#1A1300",
      fontSize: 16,
      fontWeight: 700,
      cursor: "pointer"
    },
    controls: { display: "flex", gap: 10, justifyContent: "center" },
    pauseBtn: {
      flex: 1,
      padding: "14px 0",
      borderRadius: 10,
      border: "1px solid #444",
      background: "#1A1A1A",
      color: "#E8E8E8",
      fontSize: 15,
      fontWeight: 500,
      cursor: "pointer"
    },
    stopBtn: {
      flex: 1,
      padding: "14px 0",
      borderRadius: 10,
      border: "1px solid #333",
      background: "transparent",
      color: "#999",
      fontSize: 15,
      fontWeight: 500,
      cursor: "pointer"
    },
    skipBtn: {
      flex: 1,
      padding: "14px 0",
      borderRadius: 10,
      border: "1px solid #444",
      background: "transparent",
      color: "#CCC",
      fontSize: 15,
      fontWeight: 500,
      cursor: "pointer"
    },
    timerBox: {
      borderRadius: 16,
      padding: "36px 20px",
      textAlign: "center",
      border: "1px solid #222",
      marginBottom: 20,
      transition: "background 0.3s"
    },
    phaseLabel: { fontSize: 14, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 8 },
    timerDigits: { fontSize: 64, fontWeight: 200, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", lineHeight: 1 },
    timerSub: { marginTop: 12, fontSize: 14, color: "#888" }
  };
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(ClimbingTrackerApp, null));
})();
