import { s } from "../styles.js";

// Per-set target editor, deliberately the same row layout as the live
// SetsCard logger (minus the checkbox/done state) so defining a routine's
// targets feels like the same interface as actually doing the sets. Lets a
// step's target pattern be heterogeneous - e.g. 2 sets of 12 then 1 of 24 -
// instead of one uniform reps count for every set.
export function SetTargetsEditor({ sets, isWeighted, onChange }) {
  const updateRow = (i, patch) => onChange(sets.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const removeRow = (i) => onChange(sets.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...sets, { ...(sets[sets.length - 1] || { reps: 10, weight: 0 }) }]);

  return (
    <div>
      <div style={s.setsTable}>
        <div style={s.setsHeaderRow}>
          <span style={s.setsHeaderCell}>Set</span>
          <span style={s.setsHeaderCell}>Reps</span>
          {isWeighted && <span style={s.setsHeaderCell}>Weight (kg)</span>}
          <span style={{ ...s.setsHeaderCell, width: 28 }} />
        </div>
        {sets.map((row, i) => (
          <div key={i} style={s.setsRow}>
            <span style={s.setsIndex}>{i + 1}</span>
            <input
              style={s.setsInput}
              type="number"
              min={0}
              value={row.reps}
              onChange={e => updateRow(i, { reps: e.target.value === "" ? "" : parseInt(e.target.value, 10) || 0 })}
            />
            {isWeighted && (
              <input
                style={s.setsInput}
                type="number"
                min={0}
                step={0.5}
                value={row.weight}
                onChange={e => updateRow(i, { weight: e.target.value === "" ? "" : parseFloat(e.target.value) || 0 })}
              />
            )}
            <button style={s.deleteBtn} onClick={() => removeRow(i)} disabled={sets.length <= 1}>&times;</button>
          </div>
        ))}
      </div>
      <button style={s.addSetBtn} onClick={addRow}>+ Add set</button>
    </div>
  );
}
