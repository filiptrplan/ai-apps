import { s } from "../styles.js";
import { resolveStepTargetSets } from "../format.js";
import { SetTargetsEditor } from "./SetTargetsEditor.jsx";

const { useState } = React;

// Full-page routine editor, laid out like the active session page (one card
// per exercise) rather than a cramped inline expansion. Reps/weighted steps
// get the same per-set row editor used while actually logging a workout
// (minus the done checkboxes), so a routine can target a heterogeneous
// pattern like 2 sets of 12 followed by 1 set of 24.
export function RoutineEditPage({ routine, exercises, onBack, onRename, onAddStep, onUpdateStep, onRemoveStep, onMoveStep }) {
  const [addSelect, setAddSelect] = useState("");
  const resolved = routine.steps
    .map(step => ({ step, exercise: exercises.find(e => e.id === step.exerciseId) }))
    .filter(x => x.exercise);

  return (
    <div style={s.page}>
      <div style={s.sessionTopBar}>
        <button style={s.cancelBtn} onClick={onBack}>Back</button>
        <div style={s.sessionTitle}>Edit routine</div>
      </div>

      <input style={s.input} value={routine.name} onChange={e => onRename(e.target.value)} placeholder="Routine name" />

      {resolved.length === 0 && <p style={s.empty}>No exercises in this routine yet.</p>}

      {resolved.map(({ step, exercise: ex }, i) => (
        <div key={step.id} style={s.exerciseCard}>
          <div style={s.exerciseCardHeader}>
            <div style={s.exerciseCardHeaderMain}>
              <div style={s.exerciseCardName}>{i + 1}. {ex.name}</div>
            </div>
            <div style={s.listActions}>
              <button style={s.tinyBtn} onClick={() => onMoveStep(i, -1)} disabled={i === 0}>&uarr;</button>
              <button style={s.tinyBtn} onClick={() => onMoveStep(i, 1)} disabled={i === resolved.length - 1}>&darr;</button>
              <button style={s.deleteBtn} onClick={() => onRemoveStep(i)}>&times;</button>
            </div>
          </div>

          {ex.type === "interval" ? (
            <div style={s.fieldRow}>
              <label style={s.routineStepFieldLabel}>
                Sets
                <input
                  style={s.routineStepInput}
                  type="number"
                  min={1}
                  value={step.sets ?? ex.sets}
                  onChange={e => onUpdateStep(step.id, { sets: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                />
              </label>
              <label style={s.routineStepFieldLabel}>
                Rest (s)
                <input
                  style={s.routineStepInput}
                  type="number"
                  min={0}
                  value={step.restSec ?? (ex.restSec ?? 0)}
                  onChange={e => onUpdateStep(step.id, { restSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                />
              </label>
              <label style={s.routineStepFieldLabel}>
                Rest after (s)
                <input
                  style={s.routineStepInput}
                  type="number"
                  min={0}
                  value={step.restAfterSec ?? 0}
                  onChange={e => onUpdateStep(step.id, { restAfterSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                />
              </label>
            </div>
          ) : (
            <>
              <SetTargetsEditor
                sets={resolveStepTargetSets(step, ex)}
                isWeighted={ex.type === "weighted"}
                onChange={targetSets => onUpdateStep(step.id, { targetSets })}
              />
              <div style={s.fieldRow}>
                <label style={s.routineStepFieldLabel}>
                  Rest between sets (s)
                  <input
                    style={s.routineStepInput}
                    type="number"
                    min={0}
                    value={step.restSec ?? (ex.restSec ?? 0)}
                    onChange={e => onUpdateStep(step.id, { restSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                  />
                </label>
                <label style={s.routineStepFieldLabel}>
                  Rest after exercise (s)
                  <input
                    style={s.routineStepInput}
                    type="number"
                    min={0}
                    value={step.restAfterSec ?? 0}
                    onChange={e => onUpdateStep(step.id, { restAfterSec: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      ))}

      {exercises.length === 0 ? (
        <p style={s.empty}>No exercises defined yet.</p>
      ) : (
        <div style={s.routineAddRow}>
          <select style={s.select} value={addSelect} onChange={e => setAddSelect(e.target.value)}>
            <option value="">Add exercise&hellip;</option>
            {exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
          </select>
          <button
            style={s.saveBtn}
            onClick={() => { onAddStep(addSelect); setAddSelect(""); }}
            disabled={!addSelect}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
