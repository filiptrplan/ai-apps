import { s } from "../styles.js";
import { EXERCISE_TYPES, defaultFieldsForType } from "../format.js";
import { NumberField } from "./NumberField.jsx";
import { Icon } from "./Icons.jsx";

function Segmented({ options, value, onChange }) {
  return (
    <div style={s.segmented}>
      {options.map(o => (
        <button
          key={o.value}
          style={{ ...s.segment, ...(value === o.value ? s.segmentActive : {}) }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Rendered inside a bottom sheet; onDelete is only passed when editing.
export function ExerciseForm({ draft, onChange, onSave, onDelete }) {
  const set = (patch) => onChange({ ...draft, ...patch });

  return (
    <div>
      <div style={s.field}>
        <label style={s.label}>Name</label>
        <input
          style={s.input}
          placeholder="e.g. Max hangs 20mm"
          value={draft.name}
          onChange={e => set({ name: e.target.value })}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          autoFocus={!draft.name}
        />
      </div>

      <div style={s.field}>
        <label style={s.label}>Type</label>
        <Segmented
          options={EXERCISE_TYPES}
          value={draft.type}
          onChange={type => set({ type, ...defaultFieldsForType(type) })}
        />
      </div>

      {draft.type === "reps" && (
        <div style={s.fieldGrid}>
          <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
          <NumberField label="Reps" value={draft.reps} onChange={v => set({ reps: v })} min={1} />
          <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} inc={15} suffix="s" />
        </div>
      )}

      {draft.type === "weighted" && (
        <>
          <div style={s.field}>
            <Segmented
              options={[{ value: "added", label: "Bodyweight + kg" }, { value: "total", label: "Total weight" }]}
              value={draft.weightMode}
              onChange={weightMode => set({ weightMode })}
            />
          </div>
          <div style={s.fieldGrid}>
            <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
            <NumberField label="Reps" value={draft.reps} onChange={v => set({ reps: v })} min={1} />
            <NumberField label="Weight" value={draft.weight} onChange={v => set({ weight: v })} min={0} step={0.5} inc={2.5} suffix="kg" />
            <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} inc={15} suffix="s" />
          </div>
        </>
      )}

      {draft.type === "interval" && (
        <div style={s.fieldGrid}>
          <NumberField label="Work" value={draft.workSec} onChange={v => set({ workSec: v })} min={1} suffix="s" />
          <NumberField label="Rest" value={draft.restSec} onChange={v => set({ restSec: v })} min={0} suffix="s" />
          <NumberField label="Sets" value={draft.sets} onChange={v => set({ sets: v })} min={1} />
        </div>
      )}

      <button style={{ ...s.btnPrimary, ...s.btnBlock }} onClick={onSave} disabled={!draft.name.trim()}>
        Save exercise
      </button>
      {onDelete && (
        <button style={{ ...s.btnDangerText, ...s.btnBlock, marginTop: 8 }} onClick={onDelete}>
          <Icon.trash size={18} /> Delete exercise
        </button>
      )}
    </div>
  );
}
