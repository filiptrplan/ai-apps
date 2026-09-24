import { s } from "../styles.js";
import { Sheet } from "./Layout.jsx";

export function ConfirmModal({ confirm, onCancel }) {
  if (!confirm) return null;
  return (
    <Sheet title={confirm.title} onClose={onCancel}>
      <p style={s.sheetMessage}>{confirm.message}</p>
      <div style={s.btnRow}>
        <button style={{ ...s.btnSecondary, flex: 1 }} onClick={onCancel}>Cancel</button>
        <button style={{ ...s.btnDanger, flex: 1 }} onClick={() => { confirm.onConfirm(); onCancel(); }}>
          {confirm.confirmLabel || "Delete"}
        </button>
      </div>
    </Sheet>
  );
}
