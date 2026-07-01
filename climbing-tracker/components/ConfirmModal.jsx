import { s } from "../styles.js";

export function ConfirmModal({ confirm, onCancel }) {
  if (!confirm) return null;
  return (
    <div style={s.overlay} onClick={onCancel}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>{confirm.title}</span>
          <button style={s.modalClose} onClick={onCancel}>&times;</button>
        </div>
        <p style={s.confirmMessage}>{confirm.message}</p>
        <div style={s.modalActions}>
          <button style={{ ...s.exportBtn, flex: 1 }} onClick={onCancel}>Cancel</button>
          <button style={{ ...s.dangerBtn, flex: 1 }} onClick={() => { confirm.onConfirm(); onCancel(); }}>
            {confirm.confirmLabel || "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
