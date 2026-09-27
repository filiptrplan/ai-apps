import { s, C } from "../styles.js";
import { BULK_FIELDS } from "../format.js";
import { NumberField } from "./NumberField.jsx";
import { Segmented } from "./ExerciseForm.jsx";

const { useState } = React;

const MODES = [
  { value: "keep", label: "Keep" },
  { value: "set", label: "Set to" },
  { value: "adjust", label: "Change by" },
];

// Rendered inside a bottom sheet. Each field is left alone unless switched
// to "Set to" (same value everywhere) or "Change by" (relative, e.g. +2.5kg);
// fields only show when they apply to at least one selected exercise.
export function BulkEditForm({ exercises, onSave }) {
  const [edits, setEdits] = useState({});
  const fields = BULK_FIELDS
    .map(field => ({ ...field, count: exercises.filter(ex => field.types.includes(ex.type)).length }))
    .filter(field => field.count > 0);

  const setMode = (field, mode) => {
    if (mode === "keep") {
      const { [field.key]: _, ...rest } = edits;
      setEdits(rest);
      return;
    }
    // Start "Set to" from the first exercise's value so it's a quick tweak.
    const first = exercises.find(ex => field.types.includes(ex.type));
    const value = mode === "set" ? (first?.[field.key] ?? field.min) : 0;
    setEdits({ ...edits, [field.key]: { mode, value } });
  };
  const setValue = (field, value) => setEdits({ ...edits, [field.key]: { ...edits[field.key], value } });

  const valid = Object.values(edits).some(e => typeof e.value === "number" && !isNaN(e.value) && !(e.mode === "adjust" && e.value === 0));

  return (
    <div>
      {fields.map(field => {
        const edit = edits[field.key];
        return (
          <div key={field.key} style={s.field}>
            <label style={s.label}>
              {field.label}
              {field.count < exercises.length && (
                <span style={{ color: C.dim, textTransform: "none", letterSpacing: 0 }}> · {field.count} of {exercises.length}</span>
              )}
            </label>
            <Segmented options={MODES} value={edit ? edit.mode : "keep"} onChange={mode => setMode(field, mode)} />
            {edit && (
              <div style={{ marginTop: 10 }}>
                <NumberField
                  label={edit.mode === "set" ? `New ${field.label.toLowerCase()}` : `${field.label} change`}
                  value={edit.value}
                  onChange={v => setValue(field, v)}
                  min={edit.mode === "set" ? field.min : -999}
                  step={field.step}
                  inc={field.inc}
                  suffix={field.suffix}
                />
              </div>
            )}
          </div>
        );
      })}

      <button style={{ ...s.btnPrimary, ...s.btnBlock }} onClick={() => onSave(edits)} disabled={!valid}>
        Update {exercises.length} exercise{exercises.length === 1 ? "" : "s"}
      </button>
    </div>
  );
}
