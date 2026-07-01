import { STORAGE_KEYS, uid, useStorage } from "./storage.js";
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
} from "./format.js";
import { LLM_GUIDANCE } from "./llmGuidance.js";
import { s } from "./styles.js";
import { ExerciseForm } from "./components/ExerciseForm.jsx";
import { SessionPage } from "./components/SessionPage.jsx";
import { ConfirmModal } from "./components/ConfirmModal.jsx";

const { useState, useEffect, useRef } = React;

const TABS = ["Exercises", "Routines", "History", "Settings"];

export function ClimbingTrackerApp() {
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
  const [newRoutineName, setNewRoutineName] = useState("");
  const [expandedRoutineId, setExpandedRoutineId] = useState(null);
  const [routineAddSelect, setRoutineAddSelect] = useState({});

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
    const step = { id: uid(), exerciseId, sets: null, restSec: null, restAfterSec: null };
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
    setActiveSession({ kind: "exercise", refId: ex.id, refName: ex.name, exercises: [ex], startedAt: Date.now() });
  };
  const startRoutine = (r) => {
    const exs = r.steps.map(step => {
      const ex = exercises.find(e => e.id === step.exerciseId);
      if (!ex) return null;
      return {
        ...ex,
        sets: step.sets ?? ex.sets,
        restSec: step.restSec ?? (ex.restSec ?? 0),
        restAfterSec: step.restAfterSec ?? 0,
      };
    }).filter(Boolean);
    if (exs.length === 0) return;
    sessionLogsRef.current = exs.map(() => null);
    setActiveSession({ kind: "routine", refId: r.id, refName: r.name, exercises: exs, startedAt: Date.now() });
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
      if (performed) results.push({ exerciseId: ex.id, exerciseName: ex.name, performed });
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
    }
    setActiveSession(null);
  };

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

  if (activeSession) {
    return (
      <div style={s.root}>
        <SessionPage session={activeSession} onCancel={requestCancelSession} onLogChange={handleLogChange} onFinish={finishSession} />
        <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} />
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
                <button
                  style={s.deleteBtn}
                  onClick={() => requestConfirm(
                    "Delete exercise?",
                    `Delete "${ex.name}"? This also removes it from any routines that use it.`,
                    () => deleteExercise(ex.id)
                  )}
                >
                  &times;
                </button>
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
                    <button
                      style={s.deleteBtn}
                      onClick={() => requestConfirm(
                        "Delete routine?",
                        `Delete "${r.name}"? This cannot be undone.`,
                        () => deleteRoutine(r.id)
                      )}
                    >
                      &times;
                    </button>
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
                            <label style={s.routineStepFieldLabel}>
                              Rest after (s)
                              <input
                                style={s.routineStepInput}
                                type="number"
                                min={0}
                                value={step.restAfterSec ?? 0}
                                onChange={e => updateRoutineStep(r.id, i, { restAfterSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
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
          {history.length > 0 && <button style={s.clearBtn} onClick={requestClearHistory}>Clear all</button>}
          {history.length === 0 && <p style={s.empty}>No logged sessions yet.</p>}
          {history.map(h => {
            const expanded = expandedHistoryId === h.id;
            return (
              <div key={h.id} style={s.listItem}>
                <div style={s.listMain} onClick={() => setExpandedHistoryId(expanded ? null : h.id)}>
                  <div style={s.listTitle}>
                    {h.refName} <span style={s.kindBadge}>{h.kind === "routine" ? "Routine" : "Exercise"}</span>
                  </div>
                  <div style={s.listMeta}>
                    {formatDate(h.date)}{h.durationSec != null ? ` · ${formatDuration(h.durationSec)}` : ""}
                  </div>

                  {expanded && h.steps.map((step, i) => {
                    const drift = computeTemplateDrift(step, exercises);
                    return (
                      <div key={i} style={s.historyStep}>
                        <div>{h.kind === "routine" ? `${step.exerciseName}: ` : ""}{formatPerformedSummary(step)}</div>
                        {drift && (
                          <div style={s.driftRow}>
                            <span style={s.driftText}>Differs from template ({formatDriftSummary(drift)})</span>
                            <button
                              style={s.driftBtn}
                              onClick={e => { e.stopPropagation(); updateExerciseTemplate(drift.exercise.id, drift.patch); }}
                            >
                              Update template
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button style={s.deleteBtn} onClick={() => requestDeleteHistoryEntry(h.id)}>&times;</button>
              </div>
            );
          })}
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

      <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} />
    </div>
  );
}
