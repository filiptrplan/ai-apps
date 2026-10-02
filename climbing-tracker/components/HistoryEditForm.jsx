import { s, C } from "../styles.js";
import { isIntervalType } from "../format.js";
import { SetValueInput } from "./SetsCard.jsx";
import { NumberField } from "./NumberField.jsx";
import { Icon } from "./Icons.jsx";

const { useState } = React;

// <input type="datetime-local"> wants local time without a zone.
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const num = v => Number(v) || 0;

// Editor for a logged workout: when it happened, how long it took, and what
// was actually done in each step (sets, reps, weights, interval values).
// Works on a copy; onSave gets the updated entry. Steps can be removed, but
// at least one has to stay - deleting the whole entry is its own action.
export function HistoryEditForm({ entry, onSave, onCancel }) {
  const [date, setDate] = useState(() => toLocalInput(entry.date));
  const [durationMin, setDurationMin] = useState(() => entry.durationSec != null ? Math.round(entry.durationSec / 60) : "");
  const [steps, setSteps] = useState(() => entry.steps.map(step => ({
    ...step,
    performed: { ...step.performed, ...(step.performed.sets && { sets: step.performed.sets.map(x => ({ ...x })) }) },
  })));

  const updatePerformed = (i, patch) => setSteps(steps.map((st, k) => k === i ? { ...st, performed: { ...st.performed, ...patch } } : st));
  const updateSet = (i, j, patch) => updatePerformed(i, { sets: steps[i].performed.sets.map((x, k) => k === j ? { ...x, ...patch } : x) });
  const addSet = (i) => {
    const sets = steps[i].performed.sets;
    updatePerformed(i, { sets: [...sets, { ...sets[sets.length - 1] }] });
  };
  const removeSet = (i, j) => updatePerformed(i, { sets: steps[i].performed.sets.filter((_, k) => k !== j) });
  const removeStep = (i) => setSteps(steps.filter((_, k) => k !== i));

  const save = () => {
    const cleaned = steps.map(st => {
      const p = st.performed;
      if (isIntervalType(p.type)) {
        return { ...st, performed: {
          ...p,
          completedSets: num(p.completedSets), targetSets: num(p.targetSets),
          workSec: num(p.workSec), restSec: num(p.restSec),
          ...(p.type === "weightedInterval" && { weight: num(p.weight) }),
        } };
      }
      return { ...st, performed: {
        ...p,
        sets: p.sets.map(x => p.type === "weighted" ? { reps: num(x.reps), weight: num(x.weight) } : { reps: num(x.reps) }),
      } };
    });
    const dateChanged = date !== toLocalInput(entry.date);
    onSave({
      ...entry,
      date: dateChanged && date ? new Date(date).toISOString() : entry.date,
      durationSec: durationMin === "" ? entry.durationSec : Math.round(num(durationMin) * 60),
      steps: cleaned,
    });
  };

  return (
    <div>
      <div style={s.field}>
        <label style={s.label}>Date</label>
        <input style={{ ...s.input, colorScheme: "dark" }} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div style={s.field}>
        <NumberField label="Duration" value={durationMin} onChange={setDurationMin} min={0} suffix="min" />
      </div>

      {steps.map((st, i) => {
        const p = st.performed;
        return (
          <div key={i} style={{ ...s.card, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{st.exerciseName}</span>
              {steps.length > 1 && (
                <button style={{ ...s.iconBtn, color: C.danger }} onClick={() => removeStep(i)} aria-label={`Remove ${st.exerciseName}`}>
                  <Icon.trash size={18} />
                </button>
              )}
            </div>

            {isIntervalType(p.type) ? (
              <div style={{ ...s.fieldGrid, marginBottom: 0 }}>
                <NumberField label="Sets done" value={p.completedSets} onChange={v => updatePerformed(i, { completedSets: v })} min={0} />
                <NumberField label="Target sets" value={p.targetSets} onChange={v => updatePerformed(i, { targetSets: v })} min={1} />
                <NumberField label="Work" value={p.workSec} onChange={v => updatePerformed(i, { workSec: v })} min={1} suffix="s" />
                <NumberField label="Rest" value={p.restSec} onChange={v => updatePerformed(i, { restSec: v })} min={0} suffix="s" />
                {p.type === "weightedInterval" && (
                  <NumberField label="Weight" value={p.weight} onChange={v => updatePerformed(i, { weight: v })} min={0} step={0.5} inc={2.5} suffix="kg" />
                )}
              </div>
            ) : (
              <>
                {p.sets.map((set, j) => (
                  <div key={j} style={s.setRow}>
                    <span style={s.setIndex}>{j + 1}</span>
                    <SetValueInput value={set.reps} onChange={v => updateSet(i, j, { reps: v })} suffix="reps" label={`${st.exerciseName} set ${j + 1} reps`} />
                    {p.type === "weighted" && (
                      <SetValueInput value={set.weight} onChange={v => updateSet(i, j, { weight: v })} suffix="kg" decimal label={`${st.exerciseName} set ${j + 1} weight`} />
                    )}
                    <button style={s.iconBtn} onClick={() => removeSet(i, j)} disabled={p.sets.length <= 1} aria-label={`Remove set ${j + 1}`}>
                      <Icon.minus size={18} />
                    </button>
                  </div>
                ))}
                <button style={{ ...s.btnSecondary, ...s.btnSmall, ...s.btnBlock }} onClick={() => addSet(i)}>
                  <Icon.plus size={18} /> Add set
                </button>
              </>
            )}
          </div>
        );
      })}

      <div style={{ ...s.btnRow, marginTop: 8 }}>
        <button style={{ ...s.btnSecondary, flex: 1 }} onClick={onCancel}>Cancel</button>
        <button style={{ ...s.btnPrimary, flex: 1 }} onClick={save}>Save</button>
      </div>
    </div>
  );
}
