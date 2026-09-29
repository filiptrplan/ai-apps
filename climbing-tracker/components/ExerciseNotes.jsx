import { s } from "../styles.js";
import { Icon } from "./Icons.jsx";

const { useState } = React;

// An exercise's free-form notes (grip, setup, how the last session felt).
// Edits are kept in a local draft and only saved on blur, so a synced
// storage write doesn't go out on every keystroke.
export function ExerciseNotes({ notes, onSave }) {
  const [draft, setDraft] = useState(null); // null while not editing

  if (draft !== null) {
    const commit = () => {
      const text = draft.trim();
      if (text !== (notes || "")) onSave(text);
      setDraft(null);
    };
    return (
      <textarea
        style={s.notesArea}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        placeholder="Grip, setup, cues, how it went…"
        autoFocus
        rows={3}
      />
    );
  }

  return notes ? (
    <button style={s.notes} onClick={() => setDraft(notes)} aria-label="Edit notes">{notes}</button>
  ) : (
    <button style={{ ...s.textBtn, ...s.btnSmall, marginLeft: -14 }} onClick={() => setDraft("")}>
      <Icon.plus size={16} /> Add note
    </button>
  );
}
