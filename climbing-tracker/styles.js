export const s = {
  root: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    maxWidth: 440, margin: "0 auto", minHeight: "100vh",
    background: "#111", color: "#E8E8E8",
  },
  tabs: {
    display: "flex", borderBottom: "1px solid #282828",
    position: "sticky", top: 0, background: "#111", zIndex: 10,
  },
  tab: {
    flex: 1, padding: "14px 0", background: "none", border: "none",
    color: "#666", fontSize: 14, fontWeight: 500, cursor: "pointer",
    borderBottom: "2px solid transparent", transition: "color 0.15s",
  },
  tabActive: { color: "#E8E8E8", borderBottomColor: "#E8E8E8" },
  page: { padding: "20px 16px" },
  label: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
  numField: { flex: 1, minWidth: 0 },
  numFieldInputWrap: {
    display: "flex", alignItems: "center", gap: 6, marginTop: 6,
    background: "#1A1A1A", border: "1px solid #333", borderRadius: 8, padding: "6px 10px",
  },
  numFieldInput: {
    width: "100%", border: "none", outline: "none", background: "transparent",
    color: "#E8E8E8", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums",
  },
  numFieldSuffix: { fontSize: 12, color: "#777", whiteSpace: "nowrap" },
  addBtn: {
    width: "100%", padding: "12px 0", borderRadius: 10, border: "1px dashed #444",
    background: "transparent", color: "#CCC", fontSize: 14, fontWeight: 600, cursor: "pointer",
    marginBottom: 16,
  },
  card: {
    background: "#161616", border: "1px solid #282828", borderRadius: 12,
    padding: 14, marginBottom: 16,
  },
  input: {
    flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 14, outline: "none",
    marginBottom: 12, width: "100%", boxSizing: "border-box",
  },
  select: {
    flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 14, outline: "none",
  },
  typeRow: { display: "flex", gap: 8, marginBottom: 14 },
  typeChip: {
    flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#999", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  typeChipActive: { background: "#D9A441", color: "#1A1300", border: "1px solid #D9A441" },
  fieldRow: { display: "flex", gap: 10, marginBottom: 14 },
  saveBtn: {
    padding: "10px 16px", borderRadius: 8, border: "none",
    background: "#D9A441", color: "#1A1300", fontSize: 13, fontWeight: 700, cursor: "pointer",
    whiteSpace: "nowrap",
  },
  modalActions: { display: "flex", gap: 8, marginTop: 4 },
  exportBtn: {
    flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#CCC", fontSize: 13, fontWeight: 500, cursor: "pointer",
  },
  empty: { color: "#555", fontSize: 14, textAlign: "center", marginTop: 24, marginBottom: 24 },
  listItem: {
    display: "flex", alignItems: "center", padding: "14px 0",
    borderBottom: "1px solid #1E1E1E", gap: 10,
  },
  listMain: { flex: 1, cursor: "pointer", minWidth: 0 },
  listTitle: { fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 },
  listMeta: { fontSize: 13, color: "#666", marginTop: 2 },
  listActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  smallBtn: {
    padding: "8px 12px", borderRadius: 8, border: "none",
    background: "#D9A441", color: "#1A1300", fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  smallBtnGhost: {
    padding: "8px 12px", borderRadius: 8, border: "1px solid #333",
    background: "transparent", color: "#CCC", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  tinyBtn: {
    width: 26, height: 26, borderRadius: 6, border: "1px solid #333",
    background: "#1A1A1A", color: "#CCC", fontSize: 12, cursor: "pointer",
  },
  restBtn: {
    padding: "5px 10px", borderRadius: 6, border: "1px solid #333",
    background: "#1A1A1A", color: "#CCC", fontSize: 12, cursor: "pointer",
    whiteSpace: "nowrap", flexShrink: 0,
  },
  deleteBtn: {
    width: 30, height: 30, borderRadius: 8, border: "none",
    background: "transparent", color: "#555", fontSize: 18, cursor: "pointer", flexShrink: 0,
  },
  kindBadge: {
    fontSize: 10, fontWeight: 700, color: "#999", background: "#222",
    borderRadius: 5, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.04em",
  },
  presetForm: { display: "flex", gap: 8, marginBottom: 16 },
  routineEditor: { marginTop: 6, paddingTop: 10, borderTop: "1px solid #232323" },
  routineStepRow: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    padding: "10px 0", gap: 8, borderBottom: "1px solid #1E1E1E",
  },
  routineStepMain: { minWidth: 0, flex: 1 },
  routineStepName: { fontSize: 14, color: "#DDD", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  routineStepOverrides: { display: "flex", gap: 14, marginTop: 8 },
  routineStepFieldLabel: {
    display: "flex", flexDirection: "column", gap: 4, fontSize: 10, color: "#666",
    textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600,
  },
  routineStepInput: {
    width: 52, padding: "5px 6px", borderRadius: 6, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 13, outline: "none",
    fontVariantNumeric: "tabular-nums",
  },
  routineAddRow: { display: "flex", gap: 8, marginTop: 10 },
  clearBtn: {
    padding: "8px 14px", borderRadius: 8, border: "1px solid #333",
    background: "transparent", color: "#888", fontSize: 13, cursor: "pointer",
    marginBottom: 16, display: "block",
  },
  historyStep: { fontSize: 13, color: "#999", marginTop: 4 },
  settingsSection: { marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid #222" },
  exportRow: { display: "flex", gap: 8 },
  exportHint: { fontSize: 12, color: "#555", marginTop: 8 },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100,
  },
  modal: {
    background: "#1A1A1A", borderRadius: "16px 16px 0 0", width: "100%",
    maxWidth: 440, padding: "20px 16px 24px", maxHeight: "80vh",
    display: "flex", flexDirection: "column",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontSize: 16, fontWeight: 600 },
  modalClose: { background: "none", border: "none", color: "#888", fontSize: 24, cursor: "pointer", padding: "0 4px" },
  confirmMessage: { fontSize: 14, color: "#CCC", lineHeight: 1.5, marginBottom: 16 },
  dangerBtn: {
    padding: "10px 0", borderRadius: 8, border: "none",
    background: "#E8553A", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  transferArea: {
    width: "100%", minHeight: 140, maxHeight: 260, resize: "vertical",
    background: "#111", color: "#CCC", border: "1px solid #333",
    borderRadius: 8, padding: 12, fontSize: 13, fontFamily: "monospace",
    outline: "none", boxSizing: "border-box",
  },
  importError: { color: "#E8553A", fontSize: 13, marginTop: 6 },

  // Session page
  sessionTopBar: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cancelBtn: {
    padding: "8px 14px", borderRadius: 8, border: "1px solid #333",
    background: "transparent", color: "#999", fontSize: 13, fontWeight: 500, cursor: "pointer",
  },
  sessionTitle: { fontSize: 12, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },

  exerciseCard: {
    background: "#161616", border: "1px solid #282828", borderRadius: 12,
    padding: 14, marginBottom: 14,
  },
  exerciseCardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  exerciseCardHeaderMain: { flex: 1, minWidth: 0, cursor: "pointer" },
  exerciseCardName: { fontSize: 17, fontWeight: 700 },
  exerciseCardTarget: { fontSize: 13, color: "#888", marginTop: 2 },
  hidden: { display: "none" },

  setsTarget: { fontSize: 13, color: "#888", margin: "14px 0" },
  setsTable: { marginBottom: 12, marginTop: 14 },
  setsHeaderRow: { display: "flex", gap: 10, marginBottom: 6, alignItems: "center" },
  setsHeaderCell: { fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em", flex: 1 },
  setsRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 8 },
  setsRowDone: { opacity: 0.55 },
  setsCheckbox: { width: 20, height: 20, flexShrink: 0, cursor: "pointer", accentColor: "#D9A441" },
  setsIndex: { width: 22, fontSize: 13, color: "#888", fontWeight: 600, flexShrink: 0 },
  setsInput: {
    flex: 1, padding: "10px 10px", borderRadius: 8, border: "1px solid #333",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 15, outline: "none",
    fontVariantNumeric: "tabular-nums", minWidth: 0,
  },
  restInline: {
    display: "flex", alignItems: "center", gap: 8, margin: "-2px 0 10px 32px",
    padding: "6px 10px", borderRadius: 8, background: "rgba(58,158,110,0.1)",
    border: "1px solid rgba(58,158,110,0.3)",
  },
  restInlineLabel: { fontSize: 13, color: "#3A9E6E", fontWeight: 600, flex: 1, fontVariantNumeric: "tabular-nums" },
  interRestBanner: {
    display: "flex", alignItems: "center", gap: 8, margin: "-6px 0 14px",
    padding: "10px 12px", borderRadius: 10, background: "rgba(217,164,65,0.1)",
    border: "1px solid rgba(217,164,65,0.35)",
  },
  interRestLabel: { fontSize: 13, color: "#D9A441", fontWeight: 600, flex: 1, fontVariantNumeric: "tabular-nums" },
  addSetBtn: {
    width: "100%", padding: "10px 0", borderRadius: 8, border: "1px dashed #444",
    background: "transparent", color: "#CCC", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  startBtn: {
    width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
    background: "#D9A441", color: "#1A1300", fontSize: 16, fontWeight: 700, cursor: "pointer",
  },
  controls: { display: "flex", gap: 10, justifyContent: "center" },
  pauseBtn: {
    flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #444",
    background: "#1A1A1A", color: "#E8E8E8", fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  stopBtn: {
    flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #333",
    background: "transparent", color: "#999", fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  skipBtn: {
    flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #444",
    background: "transparent", color: "#CCC", fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  timerBox: {
    borderRadius: 16, padding: "36px 20px", textAlign: "center",
    border: "1px solid #222", marginBottom: 20, transition: "background 0.3s",
  },
  phaseLabel: { fontSize: 14, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 8 },
  timerDigits: { fontSize: 64, fontWeight: 200, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", lineHeight: 1 },
  timerSub: { marginTop: 12, fontSize: 14, color: "#888" },
};
