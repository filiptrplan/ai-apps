import { s } from "../styles.js";
import { formatTargetSummary, formatTime } from "../format.js";
import { sounds } from "../sounds.js";

const { useState, useEffect, useRef } = React;

// Checklist-style set logger: every set is visible at once and can be ticked
// done in any order. Ticking a set starts an inline, non-blocking rest countdown
// (when the exercise has a restSec configured) before the next tick.
export function SetsCard({ exercise, onChange }) {
  const targetSets = exercise.sets || 1;
  const restSec = exercise.restSec || 0;
  const isWeighted = exercise.type === "weighted";
  // A routine step can specify a per-set target pattern (e.g. 2x12 then
  // 1x24, via exercise.targetSets); fall back to a uniform pattern from the
  // exercise's own reps/weight otherwise.
  const makeRow = (i) => {
    const t = exercise.targetSets && exercise.targetSets[i];
    return { reps: t ? t.reps : (exercise.reps || 0), weight: t ? (t.weight ?? exercise.weight ?? 0) : (exercise.weight || 0), done: false };
  };

  const [rows, setRows] = useState(() => Array.from({ length: targetSets }, (_, i) => makeRow(i)));
  const [restRowIndex, setRestRowIndex] = useState(null);
  const [restTimeLeft, setRestTimeLeft] = useState(restSec);
  const [restPaused, setRestPaused] = useState(false);
  const intervalRef = useRef(null);
  const timeLeftRef = useRef(restSec);

  useEffect(() => { onChange({ rows }); }, [rows]);
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const clearTick = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  const tick = () => {
    timeLeftRef.current -= 1;
    if (timeLeftRef.current <= 0) {
      clearTick();
      sounds.workStart();
      setRestRowIndex(null);
    } else {
      setRestTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 3 && timeLeftRef.current >= 1) sounds.countdown();
    }
  };

  const startRest = (rowIndex) => {
    clearTick();
    timeLeftRef.current = restSec;
    setRestTimeLeft(restSec);
    setRestPaused(false);
    setRestRowIndex(rowIndex);
    sounds.restStart();
    intervalRef.current = setInterval(tick, 1000);
  };

  const skipRest = () => { clearTick(); setRestRowIndex(null); };
  const toggleRestPause = () => {
    if (restPaused) { intervalRef.current = setInterval(tick, 1000); setRestPaused(false); }
    else { clearTick(); setRestPaused(true); }
  };

  const updateRow = (i, patch) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRow = (i) => {
    setRows(rows.filter((_, idx) => idx !== i));
    if (restRowIndex === i) skipRest();
  };
  const addRow = () => setRows([...rows, { ...(rows[rows.length - 1] || makeRow()), done: false }]);

  const toggleDone = (i) => {
    const nowDone = !rows[i].done;
    updateRow(i, { done: nowDone });
    const otherSetsRemain = rows.some((r, idx) => idx !== i && !r.done);
    if (nowDone && restSec > 0 && otherSetsRemain) startRest(i);
    else if (!nowDone && restRowIndex === i) skipRest();
  };

  const doneCount = rows.filter(r => r.done).length;

  return (
    <div>
      <div style={s.setsTarget}>{doneCount} / {rows.length} sets done &middot; target {formatTargetSummary(exercise)}</div>
      <div style={s.setsTable}>
        <div style={s.setsHeaderRow}>
          <span style={{ ...s.setsHeaderCell, width: 22 }} />
          <span style={s.setsHeaderCell}>Set</span>
          <span style={s.setsHeaderCell}>Reps</span>
          {isWeighted && <span style={s.setsHeaderCell}>Weight (kg)</span>}
          <span style={{ ...s.setsHeaderCell, width: 28 }} />
        </div>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            <div style={{ ...s.setsRow, ...(row.done ? s.setsRowDone : {}) }}>
              <input type="checkbox" style={s.setsCheckbox} checked={row.done} onChange={() => toggleDone(i)} />
              <span style={s.setsIndex}>{i + 1}</span>
              <input
                style={s.setsInput}
                type="number"
                min={0}
                value={row.reps}
                onChange={e => updateRow(i, { reps: e.target.value })}
              />
              {isWeighted && (
                <input
                  style={s.setsInput}
                  type="number"
                  min={0}
                  step={0.5}
                  value={row.weight}
                  onChange={e => updateRow(i, { weight: e.target.value })}
                />
              )}
              <button style={s.deleteBtn} onClick={() => removeRow(i)} disabled={rows.length <= 1}>&times;</button>
            </div>
            {restRowIndex === i && (
              <div style={s.restInline}>
                <span style={s.restInlineLabel}>Rest {formatTime(restTimeLeft)}</span>
                <button style={s.restBtn} onClick={toggleRestPause}>{restPaused ? "Resume" : "Pause"}</button>
                <button style={s.restBtn} onClick={skipRest}>Skip</button>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      <button style={s.addSetBtn} onClick={addRow}>+ Add set</button>
    </div>
  );
}
