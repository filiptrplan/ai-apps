import { s, d, C } from "../styles.js";
import { resolveStepTargetSets, formatTargetSummary } from "../format.js";
import { SetTargetsEditor } from "./SetTargetsEditor.jsx";
import { NumberField } from "./NumberField.jsx";
import { Header, Sheet, useIsDesktop } from "./Layout.jsx";
import { Icon } from "./Icons.jsx";

const { useState } = React;

const toStepValue = (v) => v === "" ? null : Math.round(v);

// Full-page routine editor, laid out like the active session page (one card
// per exercise) rather than a cramped inline expansion. Reps/weighted steps
// get the same per-set row editor used while actually logging a workout
// (minus the done buttons), so a routine can target a heterogeneous
// pattern like 2 sets of 12 followed by 1 set of 24.
export function RoutineEditPage({ routine, exercises, onBack, onStart, onDelete, onRename, onAddStep, onUpdateStep, onRemoveStep, onMoveStep }) {
  const desktop = useIsDesktop();
  const [pickerOpen, setPickerOpen] = useState(false);
  const resolved = routine.steps
    .map(step => ({ step, exercise: exercises.find(e => e.id === step.exerciseId) }))
    .filter(x => x.exercise);

  return (
    <>
      <Header
        title="Edit routine"
        left={<button style={s.textBtn} onClick={onBack}><Icon.back size={20} /> Routines</button>}
        right={null}
      />
      <div style={{ ...s.pageWithBottomBar, ...(desktop && d.pageWithBottomBar) }}>
        <input
          style={s.titleInput}
          value={routine.name}
          onChange={e => onRename(e.target.value)}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          placeholder="Routine name"
          autoFocus={!routine.name}
        />

        <div style={desktop ? d.cardGrid : undefined}>
        {resolved.map(({ step, exercise: ex }, i) => (
          <div key={step.id} style={{ ...s.exerciseCard, ...(desktop && { marginBottom: 0 }) }}>
            <div style={s.exerciseCardHeader}>
              <div style={{ ...s.exerciseCardHeaderMain, cursor: "default" }}>
                <div style={s.exerciseCardName}>
                  <span style={s.stepNumber}>{i + 1}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{ex.name}</span>
                </div>
              </div>
              <button style={s.iconBtn} onClick={() => onMoveStep(i, -1)} disabled={i === 0} aria-label="Move up"><Icon.up size={20} /></button>
              <button style={s.iconBtn} onClick={() => onMoveStep(i, 1)} disabled={i === resolved.length - 1} aria-label="Move down"><Icon.down size={20} /></button>
              <button style={s.iconBtn} onClick={() => onRemoveStep(i)} aria-label={`Remove ${ex.name}`}><Icon.x size={20} /></button>
            </div>

            <div style={s.exerciseCardBody}>
              {ex.type === "interval" ? (
                <div style={{ ...s.fieldGrid, marginBottom: 0 }}>
                  <NumberField label="Sets" value={step.sets ?? ex.sets} onChange={v => onUpdateStep(step.id, { sets: toStepValue(v) })} min={1} />
                  <NumberField label="Rest" value={step.restSec ?? (ex.restSec ?? 0)} onChange={v => onUpdateStep(step.id, { restSec: toStepValue(v) })} min={0} suffix="s" />
                  <NumberField label="Rest after" value={step.restAfterSec ?? 0} onChange={v => onUpdateStep(step.id, { restAfterSec: toStepValue(v) })} min={0} inc={15} suffix="s" />
                </div>
              ) : (
                <>
                  <SetTargetsEditor
                    sets={resolveStepTargetSets(step, ex)}
                    isWeighted={ex.type === "weighted"}
                    onChange={targetSets => onUpdateStep(step.id, { targetSets })}
                  />
                  <div style={{ ...s.fieldGrid, marginBottom: 0 }}>
                    <NumberField label="Rest / set" value={step.restSec ?? (ex.restSec ?? 0)} onChange={v => onUpdateStep(step.id, { restSec: toStepValue(v) })} min={0} inc={15} suffix="s" />
                    <NumberField label="Rest after" value={step.restAfterSec ?? 0} onChange={v => onUpdateStep(step.id, { restAfterSec: toStepValue(v) })} min={0} inc={15} suffix="s" />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        <button style={{ ...s.btnDashed, ...(desktop && { ...d.fullRow, marginTop: resolved.length ? 0 : undefined }) }} onClick={() => setPickerOpen(true)}>
          <Icon.plus size={20} /> Add exercise
        </button>
        </div>

        <button style={{ ...s.btnDangerText, ...(desktop ? {} : s.btnBlock), marginTop: 28 }} onClick={onDelete}>
          <Icon.trash size={18} /> Delete routine
        </button>
      </div>

      <div style={{ ...s.bottomBar, ...(desktop && d.bottomBar) }}>
        <button style={{ ...s.btnPrimary, ...s.btnBlock, minHeight: 54, ...(desktop && d.bottomBarBtn) }} onClick={onStart} disabled={resolved.length === 0}>
          <Icon.play size={18} /> Start routine
        </button>
      </div>

      {pickerOpen && (
        <Sheet title="Add exercise" onClose={() => setPickerOpen(false)}>
          {exercises.length === 0 && (
            <p style={s.sheetMessage}>No exercises yet — create some in the Exercises tab first.</p>
          )}
          {exercises.map(ex => (
            <button
              key={ex.id}
              style={s.pickerItem}
              onClick={() => { onAddStep(ex.id); setPickerOpen(false); }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>{ex.name}</span>
                <span style={{ display: "block", fontSize: 13, color: C.muted, marginTop: 2 }}>{formatTargetSummary(ex)}</span>
              </span>
              <span style={{ color: C.accent }}><Icon.plus size={22} /></span>
            </button>
          ))}
        </Sheet>
      )}
    </>
  );
}
