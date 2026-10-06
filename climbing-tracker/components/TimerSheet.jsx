import { s } from "../styles.js";
import { Sheet } from "./Layout.jsx";
import { NumberField } from "./NumberField.jsx";
import { Icon } from "./Icons.jsx";

const { useState } = React;

const PRESETS = [30, 60, 120, 180, 300];
const presetLabel = sec => sec < 60 ? `${sec}s` : `${sec / 60} min`;

// Picks the length of a free-standing countdown started mid-workout (a
// hangboard warm-up, waiting for a wall to free up, ...). Presets start it
// straight away; the steppers are for anything else.
export function TimerSheet({ initialSec = 60, onStart, onClose }) {
  const [min, setMin] = useState(Math.floor(initialSec / 60));
  const [sec, setSec] = useState(initialSec % 60);
  const total = (Number(min) || 0) * 60 + (Number(sec) || 0);

  return (
    <Sheet title="Start a timer" onClose={onClose}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {PRESETS.map(p => (
          <button key={p} style={{ ...s.btnSecondary, ...s.btnSmall }} onClick={() => onStart(p)}>
            {presetLabel(p)}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <NumberField label="Minutes" value={min} onChange={setMin} />
        <NumberField label="Seconds" value={sec} onChange={setSec} inc={15} />
      </div>
      <button style={{ ...s.btnPrimary, ...s.btnBlock }} disabled={total <= 0} onClick={() => onStart(total)}>
        <Icon.play size={18} /> Start
      </button>
    </Sheet>
  );
}
