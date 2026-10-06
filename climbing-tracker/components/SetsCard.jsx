import { s } from "../styles.js";
import { Icon } from "./Icons.jsx";
import { RestBar } from "./RestBar.jsx";
import { NumberField } from "./NumberField.jsx";
import { useRestTimer } from "./useRestTimer.js";

const { useState, useEffect } = React;

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
// the rest is above zero) before the next tick; inside a session it shows in
// the pinned rest dock rather than under the set. The rest starts from the
// exercise's (or routine step's) restSec but can be changed mid-workout; it
// goes into the log so it survives a reload and ends up in history. Superset
// members get no rest field - the block's round rest replaces it.
export function SetsCard({ exercise, initialLog, onChange }) {
  const targetSets = exercise.sets || 1;
  const [restInput, setRestInput] = useState(() => initialLog?.restSec ?? (exercise.restSec || 0));
  const restSec = Number(restInput) || 0;
  const isWeighted = exercise.type === "weighted";
  // A routine step can specify a per-set target pattern (e.g. 2x12 then
  // 1x24, via exercise.targetSets); fall back to a uniform pattern from the
  // exercise's own reps/weight otherwise.
  const makeRow = (i) => {
    const t = exercise.targetSets && exercise.targetSets[i];
    return { reps: t ? t.reps : (exercise.reps || 0), weight: t ? (t.weight ?? exercise.weight ?? 0) : (exercise.weight || 0), done: false };
  };

  const [rows, setRows] = useState(() => initialLog?.rows?.length ? initialLog.rows : Array.from({ length: targetSets }, (_, i) => makeRow(i)));
  // The running rest goes into the log too, so a reload resumes it.
  const [savedRest, setSavedRest] = useState(() => initialLog?.rest || null);
  const restTimer = useRestTimer({ saved: initialLog?.rest, onSave: setSavedRest });
  const restRowIndex = restTimer.rest ? restTimer.rest.row : null;

  useEffect(() => { onChange({ rows, restSec, rest: savedRest }); }, [rows, restSec, savedRest]);

  const startRest = (row) => restTimer.start(restSec, { row, notice: `Next set: ${exercise.name}` });
  const skipRest = restTimer.stop;

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
              timeLeft={restTimer.rest.timeLeft}
              remainingMs={restTimer.rest.remainingMs}
              total={restTimer.rest.total}
              paused={restTimer.rest.paused}
              onTogglePause={restTimer.togglePause}
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
      {!exercise.supersetGroup && (
        <div style={{ marginTop: 12 }}>
          <NumberField label="Rest between sets" value={restInput} onChange={setRestInput} min={0} inc={15} suffix="s" />
        </div>
      )}
    </div>
  );
}
