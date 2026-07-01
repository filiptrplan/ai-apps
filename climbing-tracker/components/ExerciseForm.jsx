import { s } from "../styles.js";
import { EXERCISE_TYPES, defaultFieldsForType } from "../format.js";
import { NumberField } from "./NumberField.jsx";

export function ExerciseForm({ draft, onChange, onSave, onCancel }) {
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
