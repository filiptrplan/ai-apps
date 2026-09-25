import { s, d, C } from "../styles.js";
import { resolveStepTargetSets, formatTargetSummary, groupSteps } from "../format.js";
import { SetTargetsEditor } from "./SetTargetsEditor.jsx";
import { NumberField } from "./NumberField.jsx";
import { Header, Sheet, useIsDesktop } from "./Layout.jsx";
import { Icon } from "./Icons.jsx";
import { useDragReorder } from "./useDragReorder.js";

const { useState } = React;

const toStepValue = (v) => v === "" ? null : Math.round(v);

// Full-page routine editor, laid out like the active session page (one card
// per exercise) rather than a cramped inline expansion. Reps/weighted steps
// get the same per-set row editor used while actually logging a workout
// (minus the done buttons), so a routine can target a heterogeneous
// pattern like 2 sets of 12 followed by 1 set of 24.
//
// Adjacent reps/weighted steps can be linked into a superset (shared
// step.supersetGroup) with the chip between their cards. A superset is
// bracketed as one unit: numbered 1A/1B, dragged as a whole by the grip in
// its own header, and its rests (stored on the last member) edited at its
// foot. A member card's grip only reorders it within its superset.
export function RoutineEditPage({ routine, exercises, onBack, onStart, onDelete, onRename, onAddStep, onUpdateStep, onRemoveStep, onMoveStep, onToggleLink }) {
  const desktop = useIsDesktop();
  const [pickerOpen, setPickerOpen] = useState(false);
  const resolved = routine.steps
    .map(step => ({ step, exercise: exercises.find(e => e.id === step.exerciseId) }))
    .filter(x => x.exercise)
    .map((x, i) => ({ ...x, i }));
  const blocks = groupSteps(resolved, x => x.step.supersetGroup || null);
  const linkable = x => x && x.exercise.type !== "interval";

  // "top" orders whole blocks; each superset's members are their own list.
  const { handleProps, draggingList } = useDragReorder((listId, from, to) => {
    if (listId === "top") onMoveStep(blocks[from][0].i, to - from, true);
    else onMoveStep(blocks.find(block => block[0].step.id === listId)[from].i, to - from, false);
  });
  const grip = (listId, index, name) => (
    <button {...handleProps(listId, index)} style={{ ...s.dragHandle, ...handleProps(listId, index).style }} aria-label={`Reorder ${name}`}>
      <Icon.grip size={20} />
    </button>
  );

  const restFields = (step, ex, restLabel) => (
    <div style={{ ...s.fieldGrid, marginBottom: 0 }}>
      <NumberField label={restLabel} value={step.restSec ?? (ex.restSec ?? 0)} onChange={v => onUpdateStep(step.id, { restSec: toStepValue(v) })} min={0} inc={15} suffix="s" />
      <NumberField label="Rest after" value={step.restAfterSec ?? 0} onChange={v => onUpdateStep(step.id, { restAfterSec: toStepValue(v) })} min={0} inc={15} suffix="s" />
    </div>
  );

  // Chip between two cards: links them (or the superset either belongs to)
  // when apart, splits the superset there when already linked.
  const linkChip = (i, linked, label) => (
    <button
      key={`link-${i}`}
      style={{ ...s.linkChip, ...(linked ? s.linkChipActive : {}), ...(draggingList && { visibility: "hidden" }) }}
      onClick={() => onToggleLink(i)}
      aria-pressed={linked}
    >
      <Icon.link size={16} /> {label}
    </button>
  );

  const renderCard = ({ step, exercise: ex, i }, label, listId, index, inSuperset) => (
    <div key={step.id} data-drag-list={listId} style={s.exerciseCard}>
      <div style={{ ...s.exerciseCardHeader, paddingLeft: 6 }}>
        {grip(listId, index, ex.name)}
        <div style={{ ...s.exerciseCardHeaderMain, cursor: "default", paddingLeft: 2 }}>
          <div style={s.exerciseCardName}>
            <span style={s.stepNumber}>{label}</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{ex.name}</span>
          </div>
        </div>
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
            {!inSuperset && restFields(step, ex, "Rest / set")}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Header
        title="Edit routine"
        left={<button style={s.textBtn} onClick={onBack}><Icon.back size={20} /> Routines</button>}
        right={null}
      />
      <div style={{ ...s.pageWithBottomBar, ...(desktop && { ...d.pageWithBottomBar, ...d.editorColumn }) }}>
        <input
          style={s.titleInput}
          value={routine.name}
          onChange={e => onRename(e.target.value)}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          placeholder="Routine name"
          autoFocus={!routine.name}
        />

        {blocks.map((block, b) => {
          const first = block[0], last = block[block.length - 1];
          const nextFirst = blocks[b + 1]?.[0];
          const joinsSuperset = block.length > 1 || blocks[b + 1]?.length > 1;
          const after = linkable(last) && linkable(nextFirst)
            ? linkChip(last.i, false, joinsSuperset ? "Add to superset" : "Make superset")
            : null;

          if (block.length === 1) {
            return (
              <React.Fragment key={first.step.id}>
                {renderCard(first, b + 1, "top", b, false)}
                {nextFirst && after}
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={`ss-${first.step.id}`}>
              <div data-drag-list="top" style={{ ...s.supersetBlock, background: C.bg }}>
                <div style={s.supersetHeader}>
                  {grip("top", b, `superset ${b + 1}`)}
                  <div style={{ ...s.supersetLabel, margin: 0, flex: 1 }}>
                    <Icon.link size={14} /> Superset {b + 1} · alternate sets
                  </div>
                </div>
                {block.map((x, k) => (
                  <React.Fragment key={x.step.id}>
                    {renderCard(x, `${b + 1}${String.fromCharCode(65 + k)}`, first.step.id, k, true)}
                    {k < block.length - 1 && linkChip(x.i, true, "Unlink")}
                  </React.Fragment>
                ))}
                <div style={s.supersetFooter}>
                  <div style={s.supersetHint}>No rest between exercises. Rest after each full round:</div>
                  {restFields(last.step, last.exercise, "Rest / round")}
                </div>
              </div>
              {nextFirst && after}
            </React.Fragment>
          );
        })}

        <button style={{ ...s.btnDashed, marginTop: resolved.length ? 12 : 0 }} onClick={() => setPickerOpen(true)}>
          <Icon.plus size={20} /> Add exercise
        </button>

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
