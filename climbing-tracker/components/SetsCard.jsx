import { s } from "../styles.js";
import { sounds } from "../sounds.js";
import { Icon } from "./Icons.jsx";
import { RestBar } from "./RestBar.jsx";

const { useState, useEffect, useRef } = React;

export function SetValueInput({ value, onChange, suffix, decimal, dim, label }) {
  return (
    <div style={{ ...s.setInputWrap, ...(dim ? s.setDone : {}) }}>
      <input
        style={s.setInput}
        type="number"
        inputMode={decimal ? "decimal" : "numeric"}
        min={0}
        step={decimal ? 0.5 : 1}
        value={value}
        onFocus={e => e.target.select()}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
      />
      <span style={s.setInputSuffix}>{suffix}</span>
    </div>
  );
}

// Checklist-style set logger: every set is visible at once and can be ticked
// done in any order. Ticking a set starts a non-blocking rest countdown (when
// the exercise has a restSec configured) before the next tick; inside a
// session it shows in the pinned rest dock rather than under the set.
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
  const removeLastRow = () => {
    const last = rows.length - 1;
    setRows(rows.slice(0, last));
    if (restRowIndex === last) skipRest();
  };
  const addRow = () => setRows([...rows, { ...(rows[rows.length - 1] || makeRow()), done: false }]);

  const toggleDone = (i) => {
    const nowDone = !rows[i].done;
    updateRow(i, { done: nowDone });
    const otherSetsRemain = rows.some((r, idx) => idx !== i && !r.done);
    if (nowDone && restSec > 0 && otherSetsRemain) startRest(i);
    else if (!nowDone && restRowIndex === i) skipRest();
  };

  return (
    <div>
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          <div style={s.setRow}>
            <span style={s.setIndex}>{i + 1}</span>
            <SetValueInput
              value={row.reps}
              onChange={v => updateRow(i, { reps: v })}
              suffix="reps"
              dim={row.done}
              label={`Set ${i + 1} reps`}
            />
            {isWeighted && (
              <SetValueInput
                value={row.weight}
                onChange={v => updateRow(i, { weight: v })}
                suffix="kg"
                decimal
                dim={row.done}
                label={`Set ${i + 1} weight`}
              />
            )}
            <button
              style={{ ...s.checkBtn, ...(row.done ? s.checkBtnDone : {}) }}
              onClick={() => toggleDone(i)}
              aria-pressed={row.done}
              aria-label={`Set ${i + 1} ${row.done ? "done" : "not done"}`}
            >
              <Icon.check size={24} />
            </button>
          </div>
          {restRowIndex === i && (
            <RestBar
              label={`Rest · ${exercise.name}`}
              timeLeft={restTimeLeft}
              total={restSec}
              paused={restPaused}
              onTogglePause={toggleRestPause}
              onSkip={skipRest}
            />
          )}
        </React.Fragment>
      ))}
      <div style={s.setFooter}>
        <button style={{ ...s.btnSecondary, ...s.btnSmall, flex: 1 }} onClick={addRow}>
          <Icon.plus size={18} /> Add set
        </button>
        <button style={{ ...s.btnSecondary, ...s.btnSmall }} onClick={removeLastRow} disabled={rows.length <= 1} aria-label="Remove last set">
          <Icon.minus size={18} />
        </button>
      </div>
    </div>
  );
}
