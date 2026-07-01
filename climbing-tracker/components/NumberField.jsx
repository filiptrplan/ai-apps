import { s } from "../styles.js";

export function NumberField({ label, value, onChange, min = 0, step = 1, suffix = "" }) {
  return (
    <div style={s.numField}>
      <label style={s.label}>{label}</label>
      <div style={s.numFieldInputWrap}>
        <input
          style={s.numFieldInput}
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={e => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
        />
        {suffix && <span style={s.numFieldSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}
