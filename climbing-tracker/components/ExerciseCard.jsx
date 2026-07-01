import { s } from "../styles.js";
import { formatTargetSummary } from "../format.js";
import { SetsCard } from "./SetsCard.jsx";
import { IntervalCard } from "./IntervalCard.jsx";

const { useState } = React;

export function ExerciseCard({ exercise, position, total, onChange, onMove }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={s.exerciseCard}>
      <div style={s.exerciseCardHeader}>
        <div style={s.exerciseCardHeaderMain} onClick={() => setCollapsed(!collapsed)}>
          <div style={s.exerciseCardName}>{exercise.name}</div>
          <div style={s.exerciseCardTarget}>{formatTargetSummary(exercise)}</div>
        </div>
        <div style={s.listActions}>
          {total > 1 && (
            <>
              <button style={s.tinyBtn} onClick={() => onMove(-1)} disabled={position === 0}>&uarr;</button>
              <button style={s.tinyBtn} onClick={() => onMove(1)} disabled={position === total - 1}>&darr;</button>
            </>
          )}
          <button style={s.tinyBtn} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "+" : "−"}</button>
        </div>
      </div>
      {/* Kept mounted (just hidden) so ticked sets / timer progress survive collapsing. */}
      <div style={collapsed ? s.hidden : undefined}>
        {exercise.type === "interval"
          ? <IntervalCard exercise={exercise} onChange={onChange} />
          : <SetsCard exercise={exercise} onChange={onChange} />}
      </div>
    </div>
  );
}
