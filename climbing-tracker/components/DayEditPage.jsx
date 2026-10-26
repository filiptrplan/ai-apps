import { s, d, C } from "../styles.js";
import { uid } from "../data.js";
import { isRoutineItem } from "../plan.js";
import { Header, Sheet, useIsDesktop } from "./Layout.jsx";
import { Icon } from "./Icons.jsx";
import { useDragReorder } from "./useDragReorder.js";

const { useState } = React;

// Full-page editor for one plan day: title, description, and an ordered mix
// of linked routines and free-text notes (reordered with the same drag grip
// as routine steps).
export function DayEditPage({ label, day, routines, onBack, onDelete, onChange, onMoveItem }) {
  const desktop = useIsDesktop();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { handleProps } = useDragReorder((_, from, to) => onMoveItem(from, to));

  const setItems = items => onChange({ items });
  const addRoutine = routineId => setItems([...day.items, { id: uid(), routineId }]);
  const addNote = () => setItems([...day.items, { id: uid(), text: "" }]);
  const updateNote = (id, text) => setItems(day.items.map(it => it.id === id ? { ...it, text } : it));
  const removeItem = id => setItems(day.items.filter(it => it.id !== id));

  return (
    <>
      <Header
        title="Edit day"
        left={<button style={s.textBtn} onClick={onBack}><Icon.back size={20} /> Plan</button>}
        right={null}
      />
      <div style={{ ...s.pagePlain, ...(desktop && d.editorColumn) }}>
        <div style={{ ...s.rowMeta, marginBottom: 4 }}>{label}</div>
        <input
          style={s.titleInput}
          value={day.title}
          onChange={e => onChange({ title: e.target.value })}
          onKeyDown={e => e.key === "Enter" && e.target.blur()}
          placeholder="Title (optional)"
        />
        <textarea
          style={s.descriptionArea}
          value={day.description}
          onChange={e => onChange({ description: e.target.value })}
          placeholder="Short description"
        />

        <div style={s.label}>Routines &amp; notes</div>
        {day.items.map((item, i) => {
          const routine = isRoutineItem(item) ? routines.find(r => r.id === item.routineId) : null;
          return (
            <div key={item.id} data-drag-list="items" style={s.planItemRow}>
              <button {...handleProps("items", i)} style={{ ...s.dragHandle, ...handleProps("items", i).style }} aria-label="Reorder">
                <Icon.grip size={20} />
              </button>
              {isRoutineItem(item) ? (
                <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, padding: "8px 4px" }}>
                  {routine ? (routine.name || "Untitled routine") : "Missing routine"}
                </div>
              ) : (
                <input
                  style={s.planNoteInput}
                  value={item.text}
                  onChange={e => updateNote(item.id, e.target.value)}
                  placeholder="Note, e.g. Run 5k"
                  autoFocus={!item.text}
                />
              )}
              <button style={s.iconBtn} onClick={() => removeItem(item.id)} aria-label="Remove"><Icon.x size={20} /></button>
            </div>
          );
        })}

        <div style={{ ...s.btnRow, marginTop: day.items.length ? 12 : 0 }}>
          <button style={{ ...s.btnDashed, flex: 1 }} onClick={() => setPickerOpen(true)}>
            <Icon.plus size={20} /> Routine
          </button>
          <button style={{ ...s.btnDashed, flex: 1 }} onClick={addNote}>
            <Icon.plus size={20} /> Note
          </button>
        </div>

        <button style={{ ...s.btnDangerText, ...(desktop ? {} : s.btnBlock), marginTop: 28 }} onClick={onDelete}>
          <Icon.trash size={18} /> Delete day
        </button>
      </div>

      {pickerOpen && (
        <Sheet title="Add routine" onClose={() => setPickerOpen(false)}>
          {routines.length === 0 && (
            <p style={s.sheetMessage}>No routines yet — create some in the Routines tab first.</p>
          )}
          {routines.map(r => (
            <button key={r.id} style={s.pickerItem} onClick={() => { addRoutine(r.id); setPickerOpen(false); }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}>{r.name || "Untitled routine"}</span>
              <span style={{ color: C.accent }}><Icon.plus size={22} /></span>
            </button>
          ))}
        </Sheet>
      )}
    </>
  );
}
