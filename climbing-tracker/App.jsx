import { STORAGE_KEYS, uid, useStorage } from "./storage.js";
import { supabase } from "../shared/supabaseClient.js";
import { runDailyBackupIfNeeded } from "../shared/backup.js";
import {
  defaultFieldsForType,
  formatDate,
  formatDuration,
  formatTargetSummary,
  formatPerformedSummary,
  mergeById,
  stripCodeFence,
  buildPerformedFromLog,
  computeTemplateDrift,
  formatDriftSummary,
  groupSteps,
  normalizeSupersets,
} from "./format.js";
import { LLM_GUIDANCE } from "./llmGuidance.js";
import { s, d, C } from "./styles.js";
import { ExerciseForm } from "./components/ExerciseForm.jsx";
import { SessionPage } from "./components/SessionPage.jsx";
import { RoutineEditPage } from "./components/RoutineEditPage.jsx";
import { ConfirmModal } from "./components/ConfirmModal.jsx";
import { Header, TabBar, Sidebar, Sheet, EmptyState, useIsDesktop } from "./components/Layout.jsx";
import { Icon } from "./components/Icons.jsx";

const { useState, useEffect, useRef } = React;

// A superset's round rests live on its last step (see RoutineEditPage).
const roundRests = ({ restSec, restAfterSec }) => ({ restSec, restAfterSec });

const TABS = [
  { id: "Exercises", label: "Exercises", icon: "exercises" },
  { id: "Routines", label: "Routines", icon: "routines" },
  { id: "History", label: "History", icon: "history" },
  { id: "Settings", label: "Settings", icon: "settings" },
];

export function ClimbingTrackerApp() {
  const desktop = useIsDesktop();
  const [tab, setTab] = useState("Exercises");
  const [exercises, setExercises] = useStorage(STORAGE_KEYS.exercises, []);
  const [routines, setRoutines] = useStorage(STORAGE_KEYS.routines, []);
  const [history, setHistory] = useStorage(STORAGE_KEYS.history, []);

  const [activeSession, setActiveSession] = useState(null);

  // Confirmation modal for destructive actions (delete / clear / overwrite).
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm, confirmLabel }
  const requestConfirm = (title, message, onConfirm, confirmLabel) => {
    setConfirm({ title, message, onConfirm, confirmLabel });
  };

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
  const [editingRoutineId, setEditingRoutineId] = useState(null);

  // One-time migration for routines saved before per-step sets/rest overrides existed.
  useEffect(() => {
    if (routines.some(r => !Array.isArray(r.steps))) {
      setRoutines(routines.map(r => Array.isArray(r.steps) ? r : {
        id: r.id,
        name: r.name,
        steps: (r.exerciseIds || []).map(exerciseId => ({ id: uid(), exerciseId, sets: null, restSec: null, restAfterSec: null })),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Take today's backup snapshot (no-op if already done, or logged out).
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      runDailyBackupIfNeeded(supabase, session);
    });
  }, []);

  // New routines open straight into the editor (name field focused); one
  // abandoned with no name and no exercises is discarded on the way out.
  const createRoutine = () => {
    const r = { id: uid(), name: "", steps: [] };
    setRoutines([...routines, r]);
    setEditingRoutineId(r.id);
  };
  const closeRoutineEditor = () => {
    const r = routines.find(x => x.id === editingRoutineId);
    if (r && !r.name.trim() && r.steps.length === 0) deleteRoutine(r.id);
    setEditingRoutineId(null);
  };
  const deleteRoutine = (id) => setRoutines(routines.filter(r => r.id !== id));
  const renameRoutine = (id, name) => setRoutines(routines.map(r => r.id === id ? { ...r, name } : r));
  const addStepToRoutine = (routineId, exerciseId) => {
    if (!exerciseId) return;
    const step = { id: uid(), exerciseId, sets: null, restSec: null, restAfterSec: null, targetSets: null };
    setRoutines(routines.map(r => r.id === routineId ? { ...r, steps: [...r.steps, step] } : r));
  };
  const updateRoutineStepById = (routineId, stepId, patch) => {
    setRoutines(routines.map(r => r.id === routineId ? { ...r, steps: r.steps.map(step => step.id === stepId ? { ...step, ...patch } : step) } : r));
  };
  const removeFromRoutine = (routineId, idx) => {
    setRoutines(routines.map(r => r.id === routineId ? { ...r, steps: normalizeSupersets(r.steps.filter((_, i) => i !== idx), exercises) } : r));
  };
  // Links step idx with step idx+1 into one superset (merging whatever
  // groups either already belongs to), or splits the superset between them.
  // The round rests live on a superset's last step, so they're carried over
  // to whichever step becomes last instead of changing under the user.
  const toggleSupersetLink = (routineId, idx) => {
    setRoutines(routines.map(r => {
      if (r.id !== routineId) return r;
      const steps = [...r.steps];
      const a = steps[idx], b = steps[idx + 1];
      if (!a || !b) return r;
      if (a.supersetGroup && a.supersetGroup === b.supersetGroup) {
        const fresh = uid();
        let i = idx + 1;
        for (; i < steps.length && steps[i].supersetGroup === a.supersetGroup; i++) {
          steps[i] = { ...steps[i], supersetGroup: fresh };
        }
        steps[idx] = { ...steps[idx], ...roundRests(steps[i - 1]) };
      } else {
        const group = a.supersetGroup || uid();
        steps[idx] = { ...a, supersetGroup: group };
        const old = b.supersetGroup;
        for (let i = idx + 1; i < steps.length && (i === idx + 1 || (old && steps[i].supersetGroup === old)); i++) {
          steps[i] = { ...steps[i], supersetGroup: group };
        }
        if (a.supersetGroup && !old) steps[idx + 1] = { ...steps[idx + 1], ...roundRests(a) };
      }
      return { ...r, steps: normalizeSupersets(steps, exercises) };
    }));
  };
  // Moves step idx by delta blocks (a lone step or a whole superset each).
  // With wholeBlock, idx's entire superset moves instead. A superset member
  // otherwise only reorders within its superset, keeping the round rests on
  // whichever step ends up last.
  const moveInRoutine = (routineId, idx, delta, wholeBlock) => {
    setRoutines(routines.map(r => {
      if (r.id !== routineId) return r;
      const blocks = groupSteps(r.steps, step => step.supersetGroup || null);
      let end = 0;
      const b = blocks.findIndex(block => (end += block.length) > idx);
      if (b < 0) return r;
      const block = blocks[b];
      const clamp = (v, max) => Math.max(0, Math.min(max, v));
      if (block.length > 1 && !wholeBlock) {
        const k = idx - (end - block.length), j = clamp(k + delta, block.length - 1);
        if (j === k) return r;
        const rests = roundRests(block[block.length - 1]);
        block.splice(j, 0, block.splice(k, 1)[0]);
        block[block.length - 1] = { ...block[block.length - 1], ...rests };
      } else {
        const c = clamp(b + delta, blocks.length - 1);
        if (c === b) return r;
        blocks.splice(c, 0, blocks.splice(b, 1)[0]);
      }
      return { ...r, steps: normalizeSupersets(blocks.flat(), exercises) };
    }));
  };

  // Session control. Logs for the active session live in a ref (not state) since
  // cards report progress on every tick/timer-tick; we only need to read the
  // latest values once, when the workout is finished.
  const sessionLogsRef = useRef([]);

  const startExercise = (ex) => {
    sessionLogsRef.current = [null];
    setActiveSession({ kind: "exercise", refId: ex.id, refName: ex.name, exercises: [ex], startedAt: Date.now() });
  };
  const startRoutine = (r) => {
    const exs = normalizeSupersets(r.steps, exercises).map(step => {
      const ex = exercises.find(e => e.id === step.exerciseId);
      if (!ex) return null;
      return {
        ...ex,
        sets: step.targetSets ? step.targetSets.length : (step.sets ?? ex.sets),
        targetSets: step.targetSets ?? null,
        restSec: step.restSec ?? (ex.restSec ?? 0),
        restAfterSec: step.restAfterSec ?? 0,
        routineStepId: step.id,
        supersetGroup: step.supersetGroup || null,
      };
    }).filter(Boolean);
    if (exs.length === 0) return;
    sessionLogsRef.current = exs.map(() => null);
    setActiveSession({ kind: "routine", refId: r.id, refName: r.name || "Untitled routine", exercises: exs, startedAt: Date.now() });
  };
  const cancelSession = () => setActiveSession(null);
  const requestCancelSession = () => {
    const hasProgress = sessionLogsRef.current.some(log => {
      if (!log) return false;
      if (log.type === "interval") return (log.completedSets || 0) > 0;
      return (log.rows || []).some(r => r.done);
    });
    if (hasProgress) {
      requestConfirm("Cancel workout?", "You'll lose any sets you've logged in this session.", cancelSession, "Discard");
    } else {
      cancelSession();
    }
  };
  const handleLogChange = (i, log) => { sessionLogsRef.current[i] = log; };
  const finishSession = () => {
    const current = activeSession;
    const results = [];
    current.exercises.forEach((ex, i) => {
      const performed = buildPerformedFromLog(ex, sessionLogsRef.current[i]);
      if (performed) results.push({ exerciseId: ex.id, exerciseName: ex.name, performed, routineStepId: ex.routineStepId });
    });
    if (results.length > 0) {
      const entry = {
        id: uid(),
        date: new Date().toISOString(),
        kind: current.kind,
        refId: current.refId,
        refName: current.refName,
        durationSec: Math.round((Date.now() - current.startedAt) / 1000),
        steps: results,
      };
      setHistory([entry, ...history]);
      const drifts = entry.steps.map(step => computeTemplateDrift(entry, step, exercises, routines)).filter(Boolean);
      if (drifts.length > 0) setPostSessionDrifts(drifts);
    }
    setActiveSession(null);
  };

  const [postSessionDrifts, setPostSessionDrifts] = useState([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const deleteHistoryEntry = (id) => setHistory(history.filter(h => h.id !== id));
  const requestDeleteHistoryEntry = (id) => {
    requestConfirm("Delete history entry?", "This workout log will be permanently removed.", () => deleteHistoryEntry(id));
  };
  const clearHistory = () => setHistory([]);
  const requestClearHistory = () => {
    requestConfirm("Clear all history?", "All logged workouts will be permanently deleted. This cannot be undone.", clearHistory, "Clear all");
  };
  const updateExerciseTemplate = (exerciseId, patch) => {
    setExercises(exercises.map(e => e.id === exerciseId ? { ...e, ...patch } : e));
  };
  // A drift can span both places at once - e.g. sets came from a routine
  // override while reps came from the exercise itself - so apply whichever
  // patch is non-empty to wherever it actually lives.
  const applyDrift = (drift) => {
    if (drift.targetSetsPatch) {
      if (drift.routineStep) {
        updateRoutineStepById(drift.routine.id, drift.routineStep.id, { targetSets: drift.targetSetsPatch });
      } else {
        updateExerciseTemplate(drift.exercise.id, { targetSets: drift.targetSetsPatch });
      }
      return;
    }
    if (Object.keys(drift.routinePatch).length > 0 && drift.routine && drift.routineStep) {
      updateRoutineStepById(drift.routine.id, drift.routineStep.id, drift.routinePatch);
    }
    if (Object.keys(drift.exercisePatch).length > 0) {
      updateExerciseTemplate(drift.exercise.id, drift.exercisePatch);
    }
  };
  const driftKey = (drift) => drift.routineStep ? drift.routineStep.id : drift.exercise.id;
  const applyPostSessionDrift = (drift) => {
    applyDrift(drift);
    setPostSessionDrifts(postSessionDrifts.filter(d => driftKey(d) !== driftKey(drift)));
  };

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

  const rootStyle = { ...s.root, ...(desktop && d.root) };

  // The workout takes over the whole screen on desktop too (no sidebar), so
  // it can't be left half-finished by switching tabs.
  if (activeSession) {
    return (
      <div style={rootStyle}>
        <div style={desktop ? d.focus : undefined}>
          <SessionPage session={activeSession} onCancel={requestCancelSession} onLogChange={handleLogChange} onFinish={finishSession} />
        </div>
        <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} />
      </div>
    );
  }

  const editingRoutine = editingRoutineId ? routines.find(r => r.id === editingRoutineId) : null;
  const changeTab = (t) => {
    if (editingRoutine) closeRoutineEditor();
    setTab(t);
    window.scrollTo(0, 0);
  };

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const sessionsThisWeek = history.filter(h => new Date(h.date).getTime() >= weekAgo).length;
  const sessionsThisMonth = history.filter(h => new Date(h.date).getTime() >= monthAgo).length;
  const totalTrainingSec = history.reduce((sum, h) => sum + (h.durationSec || 0), 0);
  const addButton = (onClick, label) => (
    <button style={s.iconBtnFilled} onClick={onClick} aria-label={label}><Icon.plus size={22} /></button>
  );
  const pageStyle = { ...s.page, ...(desktop && d.page) };
  const listStyle = desktop ? d.grid : s.list;
  const cardStyle = desktop ? { ...s.card, marginBottom: 0 } : s.card;

  return (
    <div style={rootStyle}>
      {desktop && (
        <Sidebar
          tabs={TABS}
          active={tab}
          onChange={changeTab}
          footer={history.length > 0 && (
            <div style={d.sidebarStat}>
              <div style={{ ...s.statValue, fontSize: 22 }}>{sessionsThisWeek}</div>
              <div style={s.statLabel}>Sessions, last 7 days</div>
            </div>
          )}
        />
      )}

      <main style={desktop ? d.main : undefined}>
      {editingRoutine ? (
        <RoutineEditPage
          routine={editingRoutine}
          exercises={exercises}
          onBack={closeRoutineEditor}
          onStart={() => { closeRoutineEditor(); startRoutine(editingRoutine); }}
          onDelete={() => requestConfirm(
            "Delete routine?",
            `Delete "${editingRoutine.name || "Untitled routine"}"? This cannot be undone.`,
            () => { deleteRoutine(editingRoutine.id); setEditingRoutineId(null); }
          )}
          onRename={name => renameRoutine(editingRoutine.id, name)}
          onAddStep={exerciseId => addStepToRoutine(editingRoutine.id, exerciseId)}
          onUpdateStep={(stepId, patch) => updateRoutineStepById(editingRoutine.id, stepId, patch)}
          onRemoveStep={idx => removeFromRoutine(editingRoutine.id, idx)}
          onMoveStep={(idx, delta, wholeBlock) => moveInRoutine(editingRoutine.id, idx, delta, wholeBlock)}
          onToggleLink={idx => toggleSupersetLink(editingRoutine.id, idx)}
        />
      ) : (
      <>
      {tab === "Exercises" && (
        <>
          <Header title="Exercises" right={exercises.length > 0 && addButton(openNewExercise, "New exercise")} />
          <div style={pageStyle}>
            {exercises.length === 0 ? (
              <EmptyState
                icon="exercises"
                title="No exercises yet"
                text="Add hangs, pull-ups, core work — anything you want to track."
                action={<button style={s.btnPrimary} onClick={openNewExercise}><Icon.plus size={20} /> New exercise</button>}
              />
            ) : (
              <div style={listStyle}>
                {exercises.map(ex => (
                  <div key={ex.id} style={s.row}>
                    <button style={s.rowMain} onClick={() => openEditExercise(ex)}>
                      <div style={s.rowTitle}>{ex.name}</div>
                      <div style={s.rowMeta}>{formatTargetSummary(ex)}</div>
                    </button>
                    <button style={s.playBtn} onClick={() => startExercise(ex)} aria-label={`Start ${ex.name}`}>
                      <Icon.play size={20} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "Routines" && (
        <>
          <Header title="Routines" right={routines.length > 0 && addButton(createRoutine, "New routine")} />
          <div style={pageStyle}>
            {routines.length === 0 ? (
              <EmptyState
                icon="routines"
                title="No routines yet"
                text="Chain exercises into a session with per-set targets and rests."
                action={<button style={s.btnPrimary} onClick={createRoutine}><Icon.plus size={20} /> New routine</button>}
              />
            ) : (
              <div style={listStyle}>
                {routines.map(r => {
                  const nameOf = step => exercises.find(e => e.id === step.exerciseId)?.name;
                  const names = r.steps.map(nameOf).filter(Boolean);
                  const blocks = groupSteps(r.steps.filter(nameOf), step => step.supersetGroup || null)
                    .map(block => block.map(nameOf).join(" + "));
                  return (
                    <div key={r.id} style={s.row}>
                      <button style={s.rowMain} onClick={() => setEditingRoutineId(r.id)}>
                        <div style={s.rowTitle}>{r.name || "Untitled routine"}</div>
                        <div style={s.rowMeta}>
                          {names.length === 0 ? "No exercises" : `${names.length} · ${blocks.join(", ")}`}
                        </div>
                      </button>
                      <button
                        style={s.playBtn}
                        onClick={() => startRoutine(r)}
                        disabled={names.length === 0}
                        aria-label={`Start ${r.name || "routine"}`}
                      >
                        <Icon.play size={20} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "History" && (
        <>
          <Header title="History" />
          <div style={{ ...pageStyle, ...(desktop && d.pageNarrow) }}>
            {history.length === 0 ? (
              <EmptyState icon="history" title="Nothing logged yet" text="Finished workouts show up here." />
            ) : (
              <>
                <div style={{ ...s.stats, ...(desktop && d.stats) }}>
                  <div style={s.stat}>
                    <div style={s.statValue}>{sessionsThisWeek}</div>
                    <div style={s.statLabel}>Last 7 days</div>
                  </div>
                  {desktop && (
                    <div style={s.stat}>
                      <div style={s.statValue}>{sessionsThisMonth}</div>
                      <div style={s.statLabel}>Last 30 days</div>
                    </div>
                  )}
                  <div style={s.stat}>
                    <div style={s.statValue}>{history.length}</div>
                    <div style={s.statLabel}>Total sessions</div>
                  </div>
                  {desktop && (
                    <div style={s.stat}>
                      <div style={s.statValue}>{formatDuration(totalTrainingSec)}</div>
                      <div style={s.statLabel}>Total time</div>
                    </div>
                  )}
                </div>

                {history.map(h => {
                  const expanded = expandedHistoryId === h.id;
                  const drifts = h.steps
                    .map(step => ({ step, drift: computeTemplateDrift(h, step, exercises, routines) }))
                    .filter(x => x.drift);
                  return (
                    <div key={h.id} style={s.historyCard}>
                      <button style={s.historyHead} onClick={() => setExpandedHistoryId(expanded ? null : h.id)} aria-expanded={expanded}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={s.rowTitle}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{h.refName}</span>
                            {h.kind === "routine" && <span style={s.badge}>Routine</span>}
                          </div>
                          <div style={s.rowMeta}>
                            {formatDate(h.date)}{h.durationSec != null ? ` · ${formatDuration(h.durationSec)}` : ""}
                          </div>
                        </div>
                        <span style={{ color: C.dim, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s", display: "flex" }}>
                          <Icon.chevronDown size={20} />
                        </span>
                      </button>

                      {(drifts.length > 0 || expanded) && (
                        <div style={s.historyBody}>
                          {drifts.map(({ step, drift }, i) => (
                            <div key={`drift-${i}`} style={{ ...s.drift, marginTop: i === 0 ? 0 : 8 }}>
                              <span style={s.driftText}>
                                {h.kind === "routine" ? `${step.exerciseName}: ` : ""}differs from template ({formatDriftSummary(drift)})
                              </span>
                              <button style={s.driftBtn} onClick={() => applyDrift(drift)}>Update</button>
                            </div>
                          ))}

                          {expanded && (
                            <div style={{ ...s.historySteps, ...(drifts.length > 0 ? { marginTop: 12 } : {}) }}>
                              {h.steps.map((step, i) => (
                                <div key={i} style={s.historyStep}>
                                  {h.kind === "routine" && <span style={s.historyStepName}>{step.exerciseName}</span>}
                                  <span style={s.historyStepValue}>{formatPerformedSummary(step)}</span>
                                </div>
                              ))}
                              <button
                                style={{ ...s.btnDangerText, ...s.btnSmall, marginTop: 6, marginLeft: -14 }}
                                onClick={() => requestDeleteHistoryEntry(h.id)}
                              >
                                <Icon.trash size={16} /> Delete entry
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      {tab === "Settings" && (
        <>
          <Header title="Settings" />
          <div style={pageStyle}>
            <div style={desktop ? d.settingsGrid : undefined}>
            <div style={cardStyle}>
              <div style={s.sectionTitle}>Generate with AI</div>
              <div style={s.hint}>
                Copy this prompt into an LLM along with what you want (e.g. "a finger-strength
                routine with dead hangs and weighted pull-ups"), then paste the JSON it gives you
                into Import below.
              </div>
              <button style={{ ...s.btnSecondary, ...s.btnBlock }} onClick={copyLlmGuidance}>
                {llmCopied ? <><Icon.check size={18} /> Copied</> : "Copy AI prompt"}
              </button>
            </div>

            <div style={cardStyle}>
              <div style={s.sectionTitle}>Exercises &amp; routines</div>
              <div style={s.hint}>Imported items are added to (or update) your existing ones — nothing is deleted.</div>
              <div style={s.btnRow}>
                <button style={{ ...s.btnSecondary, flex: 1 }} onClick={() => openExport("partial")}>Export</button>
                <button style={{ ...s.btnSecondary, flex: 1 }} onClick={() => openImport("partial")}>Import</button>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={s.sectionTitle}>All data</div>
              <div style={s.hint}>Full backup including history. Importing replaces everything.</div>
              <div style={s.btnRow}>
                <button style={{ ...s.btnSecondary, flex: 1 }} onClick={() => openExport("all")}>Export</button>
                <button style={{ ...s.btnSecondary, flex: 1 }} onClick={() => openImport("all")}>Import</button>
              </div>
            </div>

            {history.length > 0 && (
              <div style={cardStyle}>
                <div style={s.sectionTitle}>Danger zone</div>
                <div style={s.hint}>Permanently delete all {history.length} logged workouts.</div>
                <button style={{ ...s.btnSecondary, ...s.btnBlock, color: C.danger }} onClick={requestClearHistory}>
                  Clear history
                </button>
              </div>
            )}
            </div>
          </div>
        </>
      )}
      </>
      )}
      </main>

      {!desktop && !editingRoutine && <TabBar tabs={TABS} active={tab} onChange={changeTab} />}

      {formOpen && (
        <Sheet title={editingId ? "Edit exercise" : "New exercise"} onClose={() => setFormOpen(false)}>
          <ExerciseForm
            draft={draft}
            onChange={setDraft}
            onSave={saveExercise}
            onDelete={editingId ? () => requestConfirm(
              "Delete exercise?",
              `Delete "${draft.name}"? This also removes it from any routines that use it.`,
              () => { deleteExercise(editingId); setFormOpen(false); }
            ) : null}
          />
        </Sheet>
      )}

      {transferMode && (
        <Sheet
          title={`${transferMode === "export" ? "Export" : "Import"} ${transferScope === "all" ? "all data" : "exercises & routines"}`}
          onClose={() => setTransferMode(null)}
        >
          {transferMode === "export" && (
            <>
              <textarea data-transfer-text style={s.transferArea} value={transferText} readOnly onFocus={e => e.target.select()} />
              <div style={s.btnRow}>
                <button style={{ ...s.btnPrimary, flex: 1 }} onClick={copyExport}>{copied ? "Copied!" : "Copy"}</button>
                <button style={{ ...s.btnSecondary, flex: 1 }} onClick={downloadExport}>Download</button>
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
              {importError && <div style={s.error}>{importError}</div>}
              <div style={s.btnRow}>
                <button style={{ ...s.btnPrimary, flex: 1 }} onClick={() => applyImport()} disabled={!transferText.trim()}>Apply</button>
                <button style={{ ...s.btnSecondary, flex: 1 }} onClick={() => fileInputRef.current?.click()}>From file</button>
                <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={importFromFile} style={{ display: "none" }} />
              </div>
            </>
          )}
        </Sheet>
      )}

      {postSessionDrifts.length > 0 && (
        <Sheet title="Update templates?" onClose={() => setPostSessionDrifts([])}>
          <p style={s.sheetMessage}>What you just logged differs from the saved targets.</p>
          {postSessionDrifts.map(drift => (
            <div key={driftKey(drift)} style={s.drift}>
              <span style={s.driftText}>{drift.exercise.name}: {formatDriftSummary(drift)}</span>
              <button style={s.driftBtn} onClick={() => applyPostSessionDrift(drift)}>Update</button>
            </div>
          ))}
          <button style={{ ...s.btnSecondary, ...s.btnBlock, marginTop: 16 }} onClick={() => setPostSessionDrifts([])}>Done</button>
        </Sheet>
      )}

      <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} />
    </div>
  );
}
