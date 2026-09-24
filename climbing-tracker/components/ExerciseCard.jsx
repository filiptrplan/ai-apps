import { s } from "../styles.js";
import { formatTargetSummary } from "../format.js";
import { SetsCard } from "./SetsCard.jsx";
import { IntervalCard } from "./IntervalCard.jsx";
import { Icon } from "./Icons.jsx";

const { useState } = React;

function progressOf(exercise, log) {
  if (exercise.type === "interval") {
    return { done: log?.completedSets || 0, total: log?.targetSets ?? exercise.sets ?? 1 };
  }
  const rows = log?.rows || [];
  return { done: rows.filter(r => r.done).length, total: rows.length || exercise.sets || 1 };
}

export function ExerciseCard({ exercise, position, total, label, onChange, onMove }) {
  const [collapsed, setCollapsed] = useState(false);
  const [progress, setProgress] = useState(() => progressOf(exercise, null));
  const complete = progress.total > 0 && progress.done >= progress.total;

  const handleChange = (log) => {
    setProgress(progressOf(exercise, log));
    onChange(log);
  };

  return (
    <div style={{ ...s.exerciseCard, ...(complete ? s.exerciseCardDone : {}) }}>
      <div style={s.exerciseCardHeader}>
        <button style={s.exerciseCardHeaderMain} onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <div style={s.exerciseCardName}>
            {(label || total > 1) && <span style={s.stepNumber}>{label || position + 1}</span>}
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{exercise.name}</span>
          </div>
          <div style={s.exerciseCardTarget}>{formatTargetSummary(exercise)}</div>
        </button>
        <span style={{ ...s.progressPill, ...(complete ? s.progressPillDone : {}) }}>
          {complete ? <Icon.check size={16} /> : `${progress.done}/${progress.total}`}
        </span>
        {total > 1 && !collapsed && (
          <>
            <button style={s.iconBtn} onClick={() => onMove(-1)} disabled={position === 0} aria-label="Move up"><Icon.up size={20} /></button>
            <button style={s.iconBtn} onClick={() => onMove(1)} disabled={position === total - 1} aria-label="Move down"><Icon.down size={20} /></button>
          </>
        )}
        {collapsed && (
          <button style={s.iconBtn} onClick={() => setCollapsed(false)} aria-label="Expand"><Icon.chevronDown size={20} /></button>
        )}
      </div>
      {/* Kept mounted (just hidden) so ticked sets / timer progress survive collapsing. */}
      <div style={collapsed ? s.hidden : s.exerciseCardBody}>
        {exercise.type === "interval"
          ? <IntervalCard exercise={exercise} onChange={handleChange} />
          : <SetsCard exercise={exercise} onChange={handleChange} />}
      </div>
    </div>
  );
}
