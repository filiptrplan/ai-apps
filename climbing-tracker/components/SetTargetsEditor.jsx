import { s } from "../styles.js";
import { Icon } from "./Icons.jsx";
import { SetValueInput } from "./SetsCard.jsx";

// Per-set target editor, deliberately the same row layout as the live
// SetsCard logger (minus the done button) so defining a routine's targets
// feels like the same interface as actually doing the sets. Lets a step's
// target pattern be heterogeneous - e.g. 2 sets of 12 then 1 of 24 -
// instead of one uniform reps count for every set.
export function SetTargetsEditor({ sets, isWeighted, onChange }) {
  const updateRow = (i, patch) => onChange(sets.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const removeRow = (i) => onChange(sets.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...sets, { ...(sets[sets.length - 1] || { reps: 10, weight: 0 }) }]);

  return (
    <div style={{ marginBottom: 18 }}>
      {sets.map((row, i) => (
        <div key={i} style={s.setRow}>
          <span style={s.setIndex}>{i + 1}</span>
          <SetValueInput
            value={row.reps}
            onChange={v => updateRow(i, { reps: v === "" ? "" : parseInt(v, 10) || 0 })}
            suffix="reps"
            label={`Set ${i + 1} reps`}
          />
          {isWeighted && (
            <SetValueInput
              value={row.weight}
              onChange={v => updateRow(i, { weight: v === "" ? "" : parseFloat(v) || 0 })}
              suffix="kg"
              decimal
              label={`Set ${i + 1} weight`}
            />
          )}
          <button style={s.iconBtn} onClick={() => removeRow(i)} disabled={sets.length <= 1} aria-label={`Remove set ${i + 1}`}>
            <Icon.x size={20} />
          </button>
        </div>
      ))}
      <button style={{ ...s.btnSecondary, ...s.btnSmall, ...s.btnBlock, marginTop: 4 }} onClick={addRow}>
        <Icon.plus size={18} /> Add set
      </button>
    </div>
  );
}
