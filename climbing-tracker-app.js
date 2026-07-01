(() => {
  // climbing-tracker/storage.js
  var { useState } = React;
  var STORAGE_KEYS = {
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

  // climbing-tracker/format.js
  var EXERCISE_TYPES = [
    { value: "reps", label: "Reps" },
    { value: "weighted", label: "Weighted" },
    { value: "interval", label: "Interval" }
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
    const restPart = ex.type !== "interval" && ex.restSec > 0 ? ` \xB7 ${ex.restSec}s rest` : "";
    if (ex.type === "weighted") return `${ex.sets} \xD7 ${ex.reps} reps @ ${formatWeightLabel(ex.weightMode, ex.weight)}${restPart}`;
    if (ex.type === "interval") return `${ex.sets} sets \xB7 ${ex.workSec}s on / ${ex.restSec}s off`;
    return `${ex.sets} \xD7 ${ex.reps} reps${restPart}`;
  }
  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s2 = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
  }
  function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec % 3600 / 60);
    const s2 = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s2}s`;
    return `${s2}s`;
  }
  function stripCodeFence(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
    return match ? match[1] : trimmed;
  }
  function mergeById(existing, incoming) {
    const result = [...existing];
    incoming.forEach((item) => {
      if (!item) return;
      const withId = item.id ? item : { ...item, id: uid() };
      const idx = result.findIndex((e) => e.id === withId.id);
      if (idx >= 0) result[idx] = withId;
      else result.push(withId);
    });
    return result;
  }
  function isStepComplete(exercise, log) {
    var _a, _b;
    if (!log) return false;
    if (exercise.type === "interval") {
      const target = (_b = (_a = log.targetSets) != null ? _a : exercise.sets) != null ? _b : 1;
      return (log.completedSets || 0) >= target;
    }
    const rows = log.rows || [];
    return rows.length > 0 && rows.every((r) => r.done);
  }
  function buildPerformedFromLog(exercise, log) {
    var _a, _b, _c;
    if (!log) return null;
    if (exercise.type === "interval") {
      if (!log.completedSets) return null;
      return {
        type: "interval",
        workSec: (_a = log.workSec) != null ? _a : exercise.workSec,
        restSec: (_b = log.restSec) != null ? _b : exercise.restSec,
        targetSets: (_c = log.targetSets) != null ? _c : exercise.sets,
        completedSets: log.completedSets
      };
    }
    const doneRows = (log.rows || []).filter((r) => r.done);
    if (doneRows.length === 0) return null;
    if (exercise.type === "weighted") {
      return {
        type: "weighted",
        weightMode: exercise.weightMode,
        targetSets: exercise.sets,
        targetReps: exercise.reps,
        targetWeight: exercise.weight,
        sets: doneRows.map((r) => ({ reps: Number(r.reps) || 0, weight: Number(r.weight) || 0 }))
      };
    }
    return {
      type: "reps",
      targetSets: exercise.sets,
      targetReps: exercise.reps,
      sets: doneRows.map((r) => ({ reps: Number(r.reps) || 0 }))
    };
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
  function uniformValue(values) {
    return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : null;
  }
  function computeTemplateDrift(step, exercises) {
    const ex = exercises.find((e) => e.id === step.exerciseId);
    if (!ex) return null;
    const p = step.performed;
    const patch = {};
    if (p.type === "interval") {
      if (p.targetSets !== ex.sets) patch.sets = p.targetSets;
      if (p.workSec !== ex.workSec) patch.workSec = p.workSec;
      if (p.restSec !== ex.restSec) patch.restSec = p.restSec;
    } else {
      if (p.sets.length !== ex.sets) patch.sets = p.sets.length;
      const reps = uniformValue(p.sets.map((row) => row.reps));
      if (reps !== null && reps !== ex.reps) patch.reps = reps;
      if (p.type === "weighted") {
        const weight = uniformValue(p.sets.map((row) => row.weight));
        if (weight !== null && weight !== ex.weight) patch.weight = weight;
      }
    }
    return Object.keys(patch).length > 0 ? { exercise: ex, patch } : null;
  }
  function formatDriftSummary(drift) {
    const { exercise: ex, patch } = drift;
    const parts = [];
    if ("sets" in patch) parts.push(`Sets: ${ex.sets}\u2192${patch.sets}`);
    if ("reps" in patch) parts.push(`Reps: ${ex.reps}\u2192${patch.reps}`);
    if ("weight" in patch) parts.push(`Weight: ${ex.weight}\u2192${patch.weight}kg`);
    if ("workSec" in patch) parts.push(`Work: ${ex.workSec}s\u2192${patch.workSec}s`);
    if ("restSec" in patch) parts.push(`Rest: ${ex.restSec}s\u2192${patch.restSec}s`);
    return parts.join(" \xB7 ");
  }

  // climbing-tracker/llmGuidance.js
  var LLM_GUIDANCE = `You are generating data for the "Climbing Tracker" web app. The app stores exercises and routines as JSON that gets pasted into its "Import exercises & routines" dialog.

Output the JSON inside a single fenced code block (\`\`\`json ... \`\`\`) so it's easy to copy, with no commentary before or after the block and no trailing commas. The JSON must match this exact shape:

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
    { "id": "<unique string>", "exerciseId": "<id of an exercise in the exercises array>", "sets": <integer or null>, "restSec": <integer or null>, "restAfterSec": <integer or null> },
    ...
  ]
}

IMPORTANT - there are TWO different kinds of rest, don't mix them up:
- "restSec" (on the exercise or overridden on a step) fires ONLY between repeated sets of that SAME exercise within that SAME step, and ONLY when that step's "sets" is 2 or more. If a step has "sets": 1, its "restSec" is completely inert (for "interval" exercises, a rest phase only ever happens between work cycles of that SAME timer, so "sets": 1 means the rest phase never triggers either). Only set "restSec" above 0 when that same step also has "sets" of 2 or more.
- "restAfterSec" (only settable per routine step, defaults to 0/null) is the rest countdown shown after this step is fully finished, before moving on to the NEXT exercise in the routine. This is what to use for circuits/supersets, e.g. "3 rounds of 5 exercises with 20s between each exercise" - give every step in the round "restAfterSec": 20 (except it is harmless to leave it on the very last step too, since it is simply never shown after the last card). Do not set "restAfterSec" on a step and expect it to do anything other than pause AFTER that step completes and BEFORE the next one - it has no effect on rest within the step itself, that is still "restSec"'s job.

Rules:
- Every "id" must be unique within the file (e.g. "ex-dead-hangs-01").
- Every "exerciseId" referenced by a routine step must also appear as an exercise in the "exercises" array of the same JSON.
- Leave "exercises" or "routines" as an empty array (or omit the key) if you have nothing to add for it.
- Do not invent extra fields. Put the JSON in exactly one \`\`\`json code block and nothing else outside it.
- Unless told otherwise, pick sensible default sets/reps/weights/durations/rests for an intermediate climber.

Now generate the exercises and/or routines described by the user's request that follows this prompt.`;

  // climbing-tracker/styles.js
  var s = {
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
    restBtn: {
      padding: "5px 10px",
      borderRadius: 6,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#CCC",
      fontSize: 12,
      cursor: "pointer",
      whiteSpace: "nowrap",
      flexShrink: 0
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
      alignItems: "flex-start",
      justifyContent: "space-between",
      padding: "10px 0",
      gap: 8,
      borderBottom: "1px solid #1E1E1E"
    },
    routineStepMain: { minWidth: 0, flex: 1 },
    routineStepName: { fontSize: 14, color: "#DDD", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    routineStepOverrides: { display: "flex", gap: 14, marginTop: 8 },
    routineStepFieldLabel: {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      fontSize: 10,
      color: "#666",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      fontWeight: 600
    },
    routineStepInput: {
      width: 52,
      padding: "5px 6px",
      borderRadius: 6,
      border: "1px solid #333",
      background: "#1A1A1A",
      color: "#E8E8E8",
      fontSize: 13,
      outline: "none",
      fontVariantNumeric: "tabular-nums"
    },
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
    driftRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
    driftText: { fontSize: 12, color: "#D9A441" },
    driftBtn: {
      padding: "3px 9px",
      borderRadius: 6,
      border: "1px solid #D9A441",
      background: "rgba(217,164,65,0.12)",
      color: "#D9A441",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer"
    },
    settingsSection: { marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid #222" },
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
    confirmMessage: { fontSize: 14, color: "#CCC", lineHeight: 1.5, marginBottom: 16 },
    dangerBtn: {
      padding: "10px 0",
      borderRadius: 8,
      border: "none",
      background: "#E8553A",
      color: "#fff",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer"
    },
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
    // Session page
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
    sessionTitle: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
    exerciseCard: {
      background: "#161616",
      border: "1px solid #282828",
      borderRadius: 12,
      padding: 14,
      marginBottom: 14
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
    restInline: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      margin: "-2px 0 10px 32px",
      padding: "6px 10px",
      borderRadius: 8,
      background: "rgba(58,158,110,0.1)",
      border: "1px solid rgba(58,158,110,0.3)"
    },
    restInlineLabel: { fontSize: 13, color: "#3A9E6E", fontWeight: 600, flex: 1, fontVariantNumeric: "tabular-nums" },
    interRestBanner: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      margin: "-6px 0 14px",
      padding: "10px 12px",
      borderRadius: 10,
      background: "rgba(217,164,65,0.1)",
      border: "1px solid rgba(217,164,65,0.35)"
    },
    interRestLabel: { fontSize: 13, color: "#D9A441", fontWeight: 600, flex: 1, fontVariantNumeric: "tabular-nums" },
    addSetBtn: {
      width: "100%",
      padding: "10px 0",
      borderRadius: 8,
      border: "1px dashed #444",
      background: "transparent",
      color: "#CCC",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer"
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

  // climbing-tracker/components/NumberField.jsx
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

  // climbing-tracker/components/ExerciseForm.jsx
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
    ))), draft.type === "reps" && /* @__PURE__ */ React.createElement("div", { style: s.fieldRow }, /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set({ sets: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Reps", value: draft.reps, onChange: (v) => set({ reps: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: draft.restSec, onChange: (v) => set({ restSec: v }), min: 0, suffix: "s" })), draft.type === "weighted" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: s.fieldRow }, /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: draft.sets, onChange: (v) => set({ sets: v }), min: 1 }), /* @__PURE__ */ React.createElement(NumberField, { label: "Reps", value: draft.reps, onChange: (v) => set({ reps: v }), min: 1 })), /* @__PURE__ */ React.createElement("div", { style: s.fieldRow }, /* @__PURE__ */ React.createElement(NumberField, { label: "Weight", value: draft.weight, onChange: (v) => set({ weight: v }), min: 0, step: 0.5, suffix: "kg" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: draft.restSec, onChange: (v) => set({ restSec: v }), min: 0, suffix: "s" })), /* @__PURE__ */ React.createElement("div", { style: s.typeRow }, /* @__PURE__ */ React.createElement(
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

  // climbing-tracker/sounds.js
  var audioCtx = null;
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
  var sounds = {
    countdown: () => beep(880, 0.1, 0.18, "sine"),
    workStart: () => beep(660, 0.18, 0.22, "square"),
    restStart: () => beep(440, 0.18, 0.22, "sine"),
    finish: () => {
      beep(523, 0.15, 0.22, "sine", 0);
      beep(659, 0.15, 0.22, "sine", 0.15);
      beep(784, 0.3, 0.24, "sine", 0.3);
    }
  };

  // climbing-tracker/components/SetsCard.jsx
  var { useState: useState2, useEffect, useRef } = React;
  function SetsCard({ exercise, onChange }) {
    const targetSets = exercise.sets || 1;
    const restSec = exercise.restSec || 0;
    const isWeighted = exercise.type === "weighted";
    const makeRow = () => ({ reps: exercise.reps || 0, weight: exercise.weight || 0, done: false });
    const [rows, setRows] = useState2(() => Array.from({ length: targetSets }, makeRow));
    const [restRowIndex, setRestRowIndex] = useState2(null);
    const [restTimeLeft, setRestTimeLeft] = useState2(restSec);
    const [restPaused, setRestPaused] = useState2(false);
    const intervalRef = useRef(null);
    const timeLeftRef = useRef(restSec);
    useEffect(() => {
      onChange({ rows });
    }, [rows]);
    useEffect(() => () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }, []);
    const clearTick = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
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
      intervalRef.current = setInterval(tick, 1e3);
    };
    const skipRest = () => {
      clearTick();
      setRestRowIndex(null);
    };
    const toggleRestPause = () => {
      if (restPaused) {
        intervalRef.current = setInterval(tick, 1e3);
        setRestPaused(false);
      } else {
        clearTick();
        setRestPaused(true);
      }
    };
    const updateRow = (i, patch) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
    const removeRow = (i) => {
      setRows(rows.filter((_, idx) => idx !== i));
      if (restRowIndex === i) skipRest();
    };
    const addRow = () => setRows([...rows, { ...rows[rows.length - 1] || makeRow(), done: false }]);
    const toggleDone = (i) => {
      const nowDone = !rows[i].done;
      updateRow(i, { done: nowDone });
      const otherSetsRemain = rows.some((r, idx) => idx !== i && !r.done);
      if (nowDone && restSec > 0 && otherSetsRemain) startRest(i);
      else if (!nowDone && restRowIndex === i) skipRest();
    };
    const doneCount = rows.filter((r) => r.done).length;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: s.setsTarget }, doneCount, " / ", rows.length, " sets done \xB7 target ", formatTargetSummary(exercise)), /* @__PURE__ */ React.createElement("div", { style: s.setsTable }, /* @__PURE__ */ React.createElement("div", { style: s.setsHeaderRow }, /* @__PURE__ */ React.createElement("span", { style: { ...s.setsHeaderCell, width: 22 } }), /* @__PURE__ */ React.createElement("span", { style: s.setsHeaderCell }, "Set"), /* @__PURE__ */ React.createElement("span", { style: s.setsHeaderCell }, "Reps"), isWeighted && /* @__PURE__ */ React.createElement("span", { style: s.setsHeaderCell }, "Weight (kg)"), /* @__PURE__ */ React.createElement("span", { style: { ...s.setsHeaderCell, width: 28 } })), rows.map((row, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: i }, /* @__PURE__ */ React.createElement("div", { style: { ...s.setsRow, ...row.done ? s.setsRowDone : {} } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", style: s.setsCheckbox, checked: row.done, onChange: () => toggleDone(i) }), /* @__PURE__ */ React.createElement("span", { style: s.setsIndex }, i + 1), /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.setsInput,
        type: "number",
        min: 0,
        value: row.reps,
        onChange: (e) => updateRow(i, { reps: e.target.value })
      }
    ), isWeighted && /* @__PURE__ */ React.createElement(
      "input",
      {
        style: s.setsInput,
        type: "number",
        min: 0,
        step: 0.5,
        value: row.weight,
        onChange: (e) => updateRow(i, { weight: e.target.value })
      }
    ), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => removeRow(i), disabled: rows.length <= 1 }, "\xD7")), restRowIndex === i && /* @__PURE__ */ React.createElement("div", { style: s.restInline }, /* @__PURE__ */ React.createElement("span", { style: s.restInlineLabel }, "Rest ", formatTime(restTimeLeft)), /* @__PURE__ */ React.createElement("button", { style: s.restBtn, onClick: toggleRestPause }, restPaused ? "Resume" : "Pause"), /* @__PURE__ */ React.createElement("button", { style: s.restBtn, onClick: skipRest }, "Skip"))))), /* @__PURE__ */ React.createElement("button", { style: s.addSetBtn, onClick: addRow }, "+ Add set"));
  }

  // climbing-tracker/components/IntervalCard.jsx
  var { useState: useState3, useEffect: useEffect2, useRef: useRef2 } = React;
  function IntervalCard({ exercise, onChange }) {
    const [phase, setPhase] = useState3("idle");
    const [workSec, setWorkSec] = useState3(exercise.workSec);
    const [restSec, setRestSec] = useState3(exercise.restSec);
    const [totalSets, setTotalSets] = useState3(exercise.sets);
    const [currentSet, setCurrentSet] = useState3(1);
    const [timeLeft, setTimeLeft] = useState3(exercise.workSec);
    const [paused, setPaused] = useState3(false);
    const intervalRef = useRef2(null);
    const phaseRef = useRef2("idle");
    const currentSetRef = useRef2(1);
    const timeLeftRef = useRef2(exercise.workSec);
    const completedRef = useRef2(0);
    const configRef = useRef2({ workSec: exercise.workSec, restSec: exercise.restSec, totalSets: exercise.sets });
    useEffect2(() => {
      configRef.current = { workSec, restSec, totalSets };
    }, [workSec, restSec, totalSets]);
    const report = () => onChange({
      type: "interval",
      completedSets: completedRef.current,
      workSec: configRef.current.workSec,
      restSec: configRef.current.restSec,
      targetSets: configRef.current.totalSets
    });
    const clearTick = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
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
          if (currentSetRef.current >= configRef.current.totalSets) {
            phaseRef.current = "done";
            setPhase("done");
            clearTick();
            sounds.finish();
            return;
          }
          phaseRef.current = "rest";
          timeLeftRef.current = configRef.current.restSec;
          setPhase("rest");
          setTimeLeft(configRef.current.restSec);
          sounds.restStart();
        } else if (phaseRef.current === "rest") {
          currentSetRef.current += 1;
          phaseRef.current = "work";
          timeLeftRef.current = configRef.current.workSec;
          setPhase("work");
          setCurrentSet(currentSetRef.current);
          setTimeLeft(configRef.current.workSec);
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
      timeLeftRef.current = configRef.current.workSec;
      completedRef.current = 0;
      setPhase("work");
      setCurrentSet(1);
      setTimeLeft(configRef.current.workSec);
      setPaused(false);
      sounds.workStart();
      intervalRef.current = setInterval(runTick, 1e3);
    };
    const restart = () => {
      clearTick();
      completedRef.current = 0;
      phaseRef.current = "idle";
      currentSetRef.current = 1;
      timeLeftRef.current = configRef.current.workSec;
      setPhase("idle");
      setCurrentSet(1);
      setTimeLeft(configRef.current.workSec);
      setPaused(false);
      report();
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
        timeLeftRef.current = configRef.current.workSec;
        setPhase("work");
        setCurrentSet(currentSetRef.current);
        setTimeLeft(configRef.current.workSec);
      } else if (phaseRef.current === "work") {
        completedRef.current += 1;
        report();
        if (currentSetRef.current >= configRef.current.totalSets) {
          finishNow();
        } else {
          phaseRef.current = "rest";
          timeLeftRef.current = configRef.current.restSec;
          setPhase("rest");
          setTimeLeft(configRef.current.restSec);
        }
      }
    };
    useEffect2(() => () => clearTick(), []);
    const running = phase === "work" || phase === "rest";
    const phaseColor = phase === "work" ? "#D9A441" : phase === "rest" ? "#3A9E6E" : "#888";
    const phaseBg = phase === "work" ? "rgba(217,164,65,0.08)" : phase === "rest" ? "rgba(58,158,110,0.08)" : "transparent";
    const completed = phase === "done" ? completedRef.current >= totalSets ? totalSets : completedRef.current : completedRef.current;
    return /* @__PURE__ */ React.createElement("div", null, phase === "idle" && /* @__PURE__ */ React.createElement("div", { style: s.fieldRow }, /* @__PURE__ */ React.createElement(NumberField, { label: "Work", value: workSec, onChange: setWorkSec, min: 1, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Rest", value: restSec, onChange: setRestSec, min: 0, suffix: "s" }), /* @__PURE__ */ React.createElement(NumberField, { label: "Sets", value: totalSets, onChange: setTotalSets, min: 1 })), /* @__PURE__ */ React.createElement("div", { style: { ...s.timerBox, background: phaseBg } }, phase === "idle" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: s.timerDigits }, formatTime(workSec)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, totalSets, " sets \xB7 ", formatTime(workSec), " on \xB7 ", formatTime(restSec), " off")), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: phaseColor } }, phase.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { ...s.timerDigits, color: phaseColor } }, formatTime(timeLeft)), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, "Set ", currentSet, " / ", totalSets), paused && /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: "#F0AD4E", marginTop: 8, fontSize: 13 } }, "PAUSED")), phase === "done" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { ...s.phaseLabel, color: "#3A9E6E" } }, "DONE"), /* @__PURE__ */ React.createElement("div", { style: s.timerSub }, completed, " / ", totalSets, " sets completed"))), /* @__PURE__ */ React.createElement("div", { style: s.controls }, phase === "idle" && /* @__PURE__ */ React.createElement("button", { style: s.startBtn, onClick: start }, "Start"), running && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: s.pauseBtn, onClick: togglePause }, paused ? "Resume" : "Pause"), /* @__PURE__ */ React.createElement("button", { style: s.skipBtn, onClick: skip }, "Skip"), /* @__PURE__ */ React.createElement("button", { style: s.stopBtn, onClick: finishNow }, "Finish now")), phase === "done" && /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: restart }, "Restart")));
  }

  // climbing-tracker/components/ExerciseCard.jsx
  var { useState: useState4 } = React;
  function ExerciseCard({ exercise, position, total, onChange, onMove }) {
    const [collapsed, setCollapsed] = useState4(false);
    return /* @__PURE__ */ React.createElement("div", { style: s.exerciseCard }, /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardHeader }, /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardHeaderMain, onClick: () => setCollapsed(!collapsed) }, /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardName }, exercise.name), /* @__PURE__ */ React.createElement("div", { style: s.exerciseCardTarget }, formatTargetSummary(exercise))), /* @__PURE__ */ React.createElement("div", { style: s.listActions }, total > 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: s.tinyBtn, onClick: () => onMove(-1), disabled: position === 0 }, "\u2191"), /* @__PURE__ */ React.createElement("button", { style: s.tinyBtn, onClick: () => onMove(1), disabled: position === total - 1 }, "\u2193")), /* @__PURE__ */ React.createElement("button", { style: s.tinyBtn, onClick: () => setCollapsed(!collapsed) }, collapsed ? "+" : "\u2212"))), /* @__PURE__ */ React.createElement("div", { style: collapsed ? s.hidden : void 0 }, exercise.type === "interval" ? /* @__PURE__ */ React.createElement(IntervalCard, { exercise, onChange }) : /* @__PURE__ */ React.createElement(SetsCard, { exercise, onChange })));
  }

  // climbing-tracker/components/SessionPage.jsx
  var { useState: useState5, useEffect: useEffect3, useRef: useRef3 } = React;
  function SessionPage({ session, onCancel, onLogChange, onFinish }) {
    const [order, setOrder] = useState5(() => session.exercises.map((_, i) => i));
    const completedRef = useRef3(session.exercises.map(() => false));
    const [interRest, setInterRest] = useState5(null);
    const intervalRef = useRef3(null);
    const timeLeftRef = useRef3(0);
    const clearTick = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    const tick = () => {
      timeLeftRef.current -= 1;
      if (timeLeftRef.current <= 0) {
        clearTick();
        sounds.workStart();
        setInterRest(null);
      } else {
        setInterRest((r) => r && { ...r, timeLeft: timeLeftRef.current });
        if (timeLeftRef.current <= 3 && timeLeftRef.current >= 1) sounds.countdown();
      }
    };
    const startInterRest = (afterPos, restAfterSec) => {
      clearTick();
      timeLeftRef.current = restAfterSec;
      setInterRest({ afterPos, timeLeft: restAfterSec, paused: false });
      sounds.restStart();
      intervalRef.current = setInterval(tick, 1e3);
    };
    const skipInterRest = () => {
      clearTick();
      setInterRest(null);
    };
    const toggleInterRestPause = () => {
      setInterRest((r) => {
        if (!r) return r;
        if (r.paused) {
          intervalRef.current = setInterval(tick, 1e3);
          return { ...r, paused: false };
        }
        clearTick();
        return { ...r, paused: true };
      });
    };
    useEffect3(() => () => clearTick(), []);
    const moveCard = (position, dir) => {
      skipInterRest();
      setOrder((o) => {
        const arr = [...o];
        const j = position + dir;
        if (j < 0 || j >= arr.length) return o;
        [arr[position], arr[j]] = [arr[j], arr[position]];
        return arr;
      });
    };
    const handleCardChange = (exIdx, log) => {
      onLogChange(exIdx, log);
      const exercise = session.exercises[exIdx];
      const wasComplete = completedRef.current[exIdx];
      const nowComplete = isStepComplete(exercise, log);
      completedRef.current[exIdx] = nowComplete;
      if (nowComplete && !wasComplete && exercise.restAfterSec > 0) {
        const pos = order.indexOf(exIdx);
        if (pos !== -1 && pos < order.length - 1) startInterRest(pos, exercise.restAfterSec);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { style: s.page }, /* @__PURE__ */ React.createElement("div", { style: s.sessionTopBar }, /* @__PURE__ */ React.createElement("button", { style: s.cancelBtn, onClick: onCancel }, "Cancel"), /* @__PURE__ */ React.createElement("div", { style: s.sessionTitle }, session.kind === "routine" ? session.refName : "Exercise")), order.map((exIdx, position) => /* @__PURE__ */ React.createElement(React.Fragment, { key: exIdx }, /* @__PURE__ */ React.createElement(
      ExerciseCard,
      {
        exercise: session.exercises[exIdx],
        position,
        total: order.length,
        onChange: (log) => handleCardChange(exIdx, log),
        onMove: (dir) => moveCard(position, dir)
      }
    ), interRest && interRest.afterPos === position && /* @__PURE__ */ React.createElement("div", { style: s.interRestBanner }, /* @__PURE__ */ React.createElement("span", { style: s.interRestLabel }, "Rest before next exercise: ", formatTime(interRest.timeLeft)), /* @__PURE__ */ React.createElement("button", { style: s.restBtn, onClick: toggleInterRestPause }, interRest.paused ? "Resume" : "Pause"), /* @__PURE__ */ React.createElement("button", { style: s.restBtn, onClick: skipInterRest }, "Skip")))), /* @__PURE__ */ React.createElement("button", { style: s.startBtn, onClick: onFinish }, "Finish workout"));
  }

  // climbing-tracker/components/ConfirmModal.jsx
  function ConfirmModal({ confirm, onCancel }) {
    if (!confirm) return null;
    return /* @__PURE__ */ React.createElement("div", { style: s.overlay, onClick: onCancel }, /* @__PURE__ */ React.createElement("div", { style: s.modal, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: s.modalHeader }, /* @__PURE__ */ React.createElement("span", { style: s.modalTitle }, confirm.title), /* @__PURE__ */ React.createElement("button", { style: s.modalClose, onClick: onCancel }, "\xD7")), /* @__PURE__ */ React.createElement("p", { style: s.confirmMessage }, confirm.message), /* @__PURE__ */ React.createElement("div", { style: s.modalActions }, /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: onCancel }, "Cancel"), /* @__PURE__ */ React.createElement("button", { style: { ...s.dangerBtn, flex: 1 }, onClick: () => {
      confirm.onConfirm();
      onCancel();
    } }, confirm.confirmLabel || "Delete"))));
  }

  // climbing-tracker/App.jsx
  var { useState: useState6, useEffect: useEffect4, useRef: useRef4 } = React;
  var TABS = ["Exercises", "Routines", "History", "Settings"];
  function ClimbingTrackerApp() {
    const [tab, setTab] = useState6("Exercises");
    const [exercises, setExercises] = useStorage(STORAGE_KEYS.exercises, []);
    const [routines, setRoutines] = useStorage(STORAGE_KEYS.routines, []);
    const [history, setHistory] = useStorage(STORAGE_KEYS.history, []);
    const [activeSession, setActiveSession] = useState6(null);
    const [confirm, setConfirm] = useState6(null);
    const requestConfirm = (title, message, onConfirm, confirmLabel) => {
      setConfirm({ title, message, onConfirm, confirmLabel });
    };
    const [formOpen, setFormOpen] = useState6(false);
    const [editingId, setEditingId] = useState6(null);
    const [draft, setDraft] = useState6({ name: "", type: "reps", ...defaultFieldsForType("reps") });
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
      setRoutines(routines.map((r) => ({ ...r, steps: r.steps.filter((step) => step.exerciseId !== id) })));
    };
    const [newRoutineName, setNewRoutineName] = useState6("");
    const [expandedRoutineId, setExpandedRoutineId] = useState6(null);
    const [routineAddSelect, setRoutineAddSelect] = useState6({});
    useEffect4(() => {
      if (routines.some((r) => !Array.isArray(r.steps))) {
        setRoutines(routines.map((r) => Array.isArray(r.steps) ? r : {
          id: r.id,
          name: r.name,
          steps: (r.exerciseIds || []).map((exerciseId) => ({ id: uid(), exerciseId, sets: null, restSec: null, restAfterSec: null }))
        }));
      }
    }, []);
    const addRoutine = () => {
      if (!newRoutineName.trim()) return;
      const r = { id: uid(), name: newRoutineName.trim(), steps: [] };
      setRoutines([...routines, r]);
      setNewRoutineName("");
      setExpandedRoutineId(r.id);
    };
    const deleteRoutine = (id) => setRoutines(routines.filter((r) => r.id !== id));
    const addStepToRoutine = (routineId, exerciseId) => {
      if (!exerciseId) return;
      const step = { id: uid(), exerciseId, sets: null, restSec: null, restAfterSec: null };
      setRoutines(routines.map((r) => r.id === routineId ? { ...r, steps: [...r.steps, step] } : r));
    };
    const updateRoutineStep = (routineId, idx, patch) => {
      setRoutines(routines.map((r) => r.id === routineId ? { ...r, steps: r.steps.map((step, i) => i === idx ? { ...step, ...patch } : step) } : r));
    };
    const removeFromRoutine = (routineId, idx) => {
      setRoutines(routines.map((r) => r.id === routineId ? { ...r, steps: r.steps.filter((_, i) => i !== idx) } : r));
    };
    const moveInRoutine = (routineId, idx, dir) => {
      setRoutines(routines.map((r) => {
        if (r.id !== routineId) return r;
        const steps = [...r.steps];
        const j = idx + dir;
        if (j < 0 || j >= steps.length) return r;
        [steps[idx], steps[j]] = [steps[j], steps[idx]];
        return { ...r, steps };
      }));
    };
    const sessionLogsRef = useRef4([]);
    const startExercise = (ex) => {
      sessionLogsRef.current = [null];
      setActiveSession({ kind: "exercise", refId: ex.id, refName: ex.name, exercises: [ex], startedAt: Date.now() });
    };
    const startRoutine = (r) => {
      const exs = r.steps.map((step) => {
        var _a, _b, _c, _d;
        const ex = exercises.find((e) => e.id === step.exerciseId);
        if (!ex) return null;
        return {
          ...ex,
          sets: (_a = step.sets) != null ? _a : ex.sets,
          restSec: (_c = step.restSec) != null ? _c : (_b = ex.restSec) != null ? _b : 0,
          restAfterSec: (_d = step.restAfterSec) != null ? _d : 0
        };
      }).filter(Boolean);
      if (exs.length === 0) return;
      sessionLogsRef.current = exs.map(() => null);
      setActiveSession({ kind: "routine", refId: r.id, refName: r.name, exercises: exs, startedAt: Date.now() });
    };
    const cancelSession = () => setActiveSession(null);
    const requestCancelSession = () => {
      const hasProgress = sessionLogsRef.current.some((log) => {
        if (!log) return false;
        if (log.type === "interval") return (log.completedSets || 0) > 0;
        return (log.rows || []).some((r) => r.done);
      });
      if (hasProgress) {
        requestConfirm("Cancel workout?", "You'll lose any sets you've logged in this session.", cancelSession, "Discard");
      } else {
        cancelSession();
      }
    };
    const handleLogChange = (i, log) => {
      sessionLogsRef.current[i] = log;
    };
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
          date: (/* @__PURE__ */ new Date()).toISOString(),
          kind: current.kind,
          refId: current.refId,
          refName: current.refName,
          durationSec: Math.round((Date.now() - current.startedAt) / 1e3),
          steps: results
        };
        setHistory([entry, ...history]);
      }
      setActiveSession(null);
    };
    const [expandedHistoryId, setExpandedHistoryId] = useState6(null);
    const deleteHistoryEntry = (id) => setHistory(history.filter((h) => h.id !== id));
    const requestDeleteHistoryEntry = (id) => {
      requestConfirm("Delete history entry?", "This workout log will be permanently removed.", () => deleteHistoryEntry(id));
    };
    const clearHistory = () => setHistory([]);
    const requestClearHistory = () => {
      requestConfirm("Clear all history?", "All logged workouts will be permanently deleted. This cannot be undone.", clearHistory, "Clear all");
    };
    const updateExerciseTemplate = (exerciseId, patch) => {
      setExercises(exercises.map((e) => e.id === exerciseId ? { ...e, ...patch } : e));
    };
    const fileInputRef = useRef4(null);
    const [transferMode, setTransferMode] = useState6(null);
    const [transferScope, setTransferScope] = useState6("all");
    const [transferText, setTransferText] = useState6("");
    const [copied, setCopied] = useState6(false);
    const [importError, setImportError] = useState6("");
    const [llmCopied, setLlmCopied] = useState6(false);
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
      a.download = `climbing-tracker-${transferScope === "all" ? "all" : "exercises-routines"}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
    const commitImport = (data) => {
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
    };
    const applyImport = (text) => {
      try {
        const data = JSON.parse(stripCodeFence(text || transferText));
        if (transferScope === "all") {
          requestConfirm(
            "Replace all data?",
            "This will overwrite all your exercises, routines, and history with the imported data. This cannot be undone.",
            () => commitImport(data),
            "Replace"
          );
        } else {
          commitImport(data);
        }
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
    const copyLlmGuidance = async () => {
      try {
        await navigator.clipboard.writeText(LLM_GUIDANCE);
        setLlmCopied(true);
        setTimeout(() => setLlmCopied(false), 2e3);
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
        setTimeout(() => setLlmCopied(false), 2e3);
      }
    };
    if (activeSession) {
      return /* @__PURE__ */ React.createElement("div", { style: s.root }, /* @__PURE__ */ React.createElement(SessionPage, { session: activeSession, onCancel: requestCancelSession, onLogChange: handleLogChange, onFinish: finishSession }), /* @__PURE__ */ React.createElement(ConfirmModal, { confirm, onCancel: () => setConfirm(null) }));
    }
    return /* @__PURE__ */ React.createElement("div", { style: s.root }, /* @__PURE__ */ React.createElement("div", { style: s.tabs }, TABS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t, onClick: () => setTab(t), style: { ...s.tab, ...tab === t ? s.tabActive : {} } }, t, t === "History" && history.length > 0 ? ` (${history.length})` : ""))), tab === "Exercises" && /* @__PURE__ */ React.createElement("div", { style: s.page }, !formOpen && /* @__PURE__ */ React.createElement("button", { style: s.addBtn, onClick: openNewExercise }, "+ New exercise"), formOpen && /* @__PURE__ */ React.createElement(ExerciseForm, { draft, onChange: setDraft, onSave: saveExercise, onCancel: () => setFormOpen(false) }), exercises.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No exercises yet. Add one to get started."), exercises.map((ex) => /* @__PURE__ */ React.createElement("div", { key: ex.id, style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, ex.name), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, formatTargetSummary(ex))), /* @__PURE__ */ React.createElement("div", { style: s.listActions }, /* @__PURE__ */ React.createElement("button", { style: s.smallBtn, onClick: () => startExercise(ex) }, "Start"), /* @__PURE__ */ React.createElement("button", { style: s.smallBtnGhost, onClick: () => openEditExercise(ex) }, "Edit"), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: s.deleteBtn,
        onClick: () => requestConfirm(
          "Delete exercise?",
          `Delete "${ex.name}"? This also removes it from any routines that use it.`,
          () => deleteExercise(ex.id)
        )
      },
      "\xD7"
    ))))), tab === "Routines" && /* @__PURE__ */ React.createElement("div", { style: s.page }, /* @__PURE__ */ React.createElement("div", { style: s.presetForm }, /* @__PURE__ */ React.createElement(
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
      const resolved = r.steps.map((step) => ({ step, exercise: exercises.find((e) => e.id === step.exerciseId) })).filter((x) => x.exercise);
      return /* @__PURE__ */ React.createElement("div", { key: r.id, style: s.card }, /* @__PURE__ */ React.createElement("div", { style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain, onClick: () => setExpandedRoutineId(expanded ? null : r.id) }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, r.name), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, resolved.length, " exercise", resolved.length === 1 ? "" : "s")), /* @__PURE__ */ React.createElement("div", { style: s.listActions }, /* @__PURE__ */ React.createElement("button", { style: s.smallBtn, onClick: () => startRoutine(r), disabled: resolved.length === 0 }, "Start"), /* @__PURE__ */ React.createElement(
        "button",
        {
          style: s.deleteBtn,
          onClick: () => requestConfirm(
            "Delete routine?",
            `Delete "${r.name}"? This cannot be undone.`,
            () => deleteRoutine(r.id)
          )
        },
        "\xD7"
      ))), expanded && /* @__PURE__ */ React.createElement("div", { style: s.routineEditor }, resolved.map(({ step, exercise: ex }, i) => {
        var _a, _b, _c, _d;
        return /* @__PURE__ */ React.createElement("div", { key: step.id, style: s.routineStepRow }, /* @__PURE__ */ React.createElement("div", { style: s.routineStepMain }, /* @__PURE__ */ React.createElement("span", { style: s.routineStepName }, i + 1, ". ", ex.name), /* @__PURE__ */ React.createElement("div", { style: s.routineStepOverrides }, /* @__PURE__ */ React.createElement("label", { style: s.routineStepFieldLabel }, "Sets", /* @__PURE__ */ React.createElement(
          "input",
          {
            style: s.routineStepInput,
            type: "number",
            min: 1,
            value: (_a = step.sets) != null ? _a : ex.sets,
            onChange: (e) => updateRoutineStep(r.id, i, { sets: e.target.value === "" ? null : parseInt(e.target.value, 10) })
          }
        )), /* @__PURE__ */ React.createElement("label", { style: s.routineStepFieldLabel }, "Rest (s)", /* @__PURE__ */ React.createElement(
          "input",
          {
            style: s.routineStepInput,
            type: "number",
            min: 0,
            value: (_c = step.restSec) != null ? _c : (_b = ex.restSec) != null ? _b : 0,
            onChange: (e) => updateRoutineStep(r.id, i, { restSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })
          }
        )), /* @__PURE__ */ React.createElement("label", { style: s.routineStepFieldLabel }, "Rest after (s)", /* @__PURE__ */ React.createElement(
          "input",
          {
            style: s.routineStepInput,
            type: "number",
            min: 0,
            value: (_d = step.restAfterSec) != null ? _d : 0,
            onChange: (e) => updateRoutineStep(r.id, i, { restAfterSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })
          }
        )))), /* @__PURE__ */ React.createElement("div", { style: s.listActions }, /* @__PURE__ */ React.createElement("button", { style: s.tinyBtn, onClick: () => moveInRoutine(r.id, i, -1), disabled: i === 0 }, "\u2191"), /* @__PURE__ */ React.createElement("button", { style: s.tinyBtn, onClick: () => moveInRoutine(r.id, i, 1), disabled: i === resolved.length - 1 }, "\u2193"), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => removeFromRoutine(r.id, i) }, "\xD7")));
      }), exercises.length === 0 ? /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No exercises defined yet.") : /* @__PURE__ */ React.createElement("div", { style: s.routineAddRow }, /* @__PURE__ */ React.createElement(
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
            addStepToRoutine(r.id, routineAddSelect[r.id]);
            setRoutineAddSelect({ ...routineAddSelect, [r.id]: "" });
          },
          disabled: !routineAddSelect[r.id]
        },
        "Add"
      ))));
    })), tab === "History" && /* @__PURE__ */ React.createElement("div", { style: s.page }, history.length > 0 && /* @__PURE__ */ React.createElement("button", { style: s.clearBtn, onClick: requestClearHistory }, "Clear all"), history.length === 0 && /* @__PURE__ */ React.createElement("p", { style: s.empty }, "No logged sessions yet."), history.map((h) => {
      const expanded = expandedHistoryId === h.id;
      return /* @__PURE__ */ React.createElement("div", { key: h.id, style: s.listItem }, /* @__PURE__ */ React.createElement("div", { style: s.listMain, onClick: () => setExpandedHistoryId(expanded ? null : h.id) }, /* @__PURE__ */ React.createElement("div", { style: s.listTitle }, h.refName, " ", /* @__PURE__ */ React.createElement("span", { style: s.kindBadge }, h.kind === "routine" ? "Routine" : "Exercise")), /* @__PURE__ */ React.createElement("div", { style: s.listMeta }, formatDate(h.date), h.durationSec != null ? ` \xB7 ${formatDuration(h.durationSec)}` : ""), expanded && h.steps.map((step, i) => {
        const drift = computeTemplateDrift(step, exercises);
        return /* @__PURE__ */ React.createElement("div", { key: i, style: s.historyStep }, /* @__PURE__ */ React.createElement("div", null, h.kind === "routine" ? `${step.exerciseName}: ` : "", formatPerformedSummary(step)), drift && /* @__PURE__ */ React.createElement("div", { style: s.driftRow }, /* @__PURE__ */ React.createElement("span", { style: s.driftText }, "Differs from template (", formatDriftSummary(drift), ")"), /* @__PURE__ */ React.createElement(
          "button",
          {
            style: s.driftBtn,
            onClick: (e) => {
              e.stopPropagation();
              updateExerciseTemplate(drift.exercise.id, drift.patch);
            }
          },
          "Update template"
        )));
      })), /* @__PURE__ */ React.createElement("button", { style: s.deleteBtn, onClick: () => requestDeleteHistoryEntry(h.id) }, "\xD7"));
    })), tab === "Settings" && /* @__PURE__ */ React.createElement("div", { style: s.page }, /* @__PURE__ */ React.createElement("div", { style: s.settingsSection }, /* @__PURE__ */ React.createElement("div", { style: { ...s.label, marginBottom: 10 } }, "Generate with AI"), /* @__PURE__ */ React.createElement("div", { style: s.exportHint }, 'Copy this prompt into an LLM (ChatGPT, Claude, etc.) along with what you want (e.g. "a finger-strength routine with dead hangs and weighted pull-ups"), then paste the JSON it gives you into "Import exercises & routines" below.'), /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, marginTop: 10 }, onClick: copyLlmGuidance }, llmCopied ? "Copied!" : "Copy AI prompt")), /* @__PURE__ */ React.createElement("div", { style: s.settingsSection }, /* @__PURE__ */ React.createElement("div", { style: { ...s.label, marginBottom: 10 } }, "Exercises & routines"), /* @__PURE__ */ React.createElement("div", { style: s.exportRow }, /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: () => openExport("partial") }, "Export"), /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: () => openImport("partial") }, "Import")), /* @__PURE__ */ React.createElement("div", { style: s.exportHint }, "Share or AI-generate exercises and routines. Imported items are added to (or update) your existing ones \u2014 nothing is deleted.")), /* @__PURE__ */ React.createElement("div", { style: s.settingsSection }, /* @__PURE__ */ React.createElement("div", { style: { ...s.label, marginBottom: 10 } }, "All data"), /* @__PURE__ */ React.createElement("div", { style: s.exportRow }, /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: () => openExport("all") }, "Export"), /* @__PURE__ */ React.createElement("button", { style: s.exportBtn, onClick: () => openImport("all") }, "Import")), /* @__PURE__ */ React.createElement("div", { style: s.exportHint }, "Full backup, including history. Importing replaces everything currently stored."))), transferMode && /* @__PURE__ */ React.createElement("div", { style: s.overlay, onClick: () => setTransferMode(null) }, /* @__PURE__ */ React.createElement("div", { style: s.modal, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: s.modalHeader }, /* @__PURE__ */ React.createElement("span", { style: s.modalTitle }, transferMode === "export" ? "Export" : "Import", " ", transferScope === "all" ? "all data" : "exercises & routines"), /* @__PURE__ */ React.createElement("button", { style: s.modalClose, onClick: () => setTransferMode(null) }, "\xD7")), transferMode === "export" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("textarea", { "data-transfer-text": true, style: s.transferArea, value: transferText, readOnly: true, onFocus: (e) => e.target.select() }), /* @__PURE__ */ React.createElement("div", { style: s.modalActions }, /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: copyExport }, copied ? "Copied!" : "Copy"), /* @__PURE__ */ React.createElement("button", { style: { ...s.exportBtn, flex: 1 }, onClick: downloadExport }, "Download"))), transferMode === "import" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
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
    } }, "From file"), /* @__PURE__ */ React.createElement("input", { ref: fileInputRef, type: "file", accept: ".json", onChange: importFromFile, style: { display: "none" } }))))), /* @__PURE__ */ React.createElement(ConfirmModal, { confirm, onCancel: () => setConfirm(null) }));
  }

  // climbing-tracker-app.jsx
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(ClimbingTrackerApp, null));
})();
