import { s } from "../styles.js";
import { Icon } from "./Icons.jsx";

// Labelled − value + stepper. The value stays directly editable for big
// jumps; the buttons move by `inc` (defaults to `step`), clamped at `min`.
export function NumberField({ label, value, onChange, min = 0, step = 1, inc, suffix = "" }) {
  const delta = inc ?? step;
  const num = typeof value === "number" && !isNaN(value) ? value : min;
  const bump = (dir) => {
    const next = Math.round((num + dir * delta) * 100) / 100;
    onChange(Math.max(min, next));
  };

  return (
    <div>
      <label style={s.label}>{label}</label>
      <div style={s.stepper}>
        <button style={s.stepperBtn} onClick={() => bump(-1)} disabled={num <= min} aria-label={`Decrease ${label}`}>
          <Icon.minus size={20} />
        </button>
        <div style={s.stepperValue}>
          <input
            style={s.stepperInput}
            type="number"
            inputMode={step % 1 === 0 ? "numeric" : "decimal"}
            min={min}
            step={step}
            value={value}
            onFocus={e => e.target.select()}
            onChange={e => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
            aria-label={label}
          />
          {suffix && <span style={s.stepperSuffix}>{suffix}</span>}
        </div>
        <button style={s.stepperBtn} onClick={() => bump(1)} aria-label={`Increase ${label}`}>
          <Icon.plus size={20} />
        </button>
      </div>
    </div>
  );
}
