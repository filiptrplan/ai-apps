// Design tokens. Everything is dark-only (the app is used on a phone at the
// wall/gym), with one warm accent for primary actions and green for rest/done.
export const C = {
  bg: "#0E0E10",
  surface: "#17171A",
  surface2: "#202024",
  border: "#2A2A2F",
  text: "#F2F2F3",
  muted: "#8E8E96",
  dim: "#5E5E66",
  accent: "#E8B04B",
  accentInk: "#1B1400",
  accentSoft: "rgba(232,176,75,0.12)",
  green: "#4CC38A",
  greenInk: "#04140C",
  greenSoft: "rgba(76,195,138,0.12)",
  danger: "#F0604D",
  dangerSoft: "rgba(240,96,77,0.12)",
};

const SAFE_TOP = "env(safe-area-inset-top, 0px)";
const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";
export const TAB_BAR_HEIGHT = 60;

const btnBase = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  minHeight: 48, padding: "0 18px", borderRadius: 12, fontSize: 16, fontWeight: 600,
  cursor: "pointer", border: "none", whiteSpace: "nowrap",
};

export const s = {
  root: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', Roboto, sans-serif",
    maxWidth: 480, margin: "0 auto", minHeight: "100dvh",
    background: C.bg, color: C.text, WebkitFontSmoothing: "antialiased",
  },

  // App chrome
  header: {
    position: "sticky", top: 0, zIndex: 20,
    display: "flex", alignItems: "center", gap: 8, minHeight: 56,
    padding: `calc(${SAFE_TOP} + 8px) 16px 8px`,
    background: "rgba(14,14,16,0.86)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
    borderBottom: `1px solid ${C.border}`,
  },
  headerTitle: { flex: 1, minWidth: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" },
  headerTitleSmall: {
    flex: 1, minWidth: 0, fontSize: 17, fontWeight: 600, textAlign: "center",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  headerSub: { fontSize: 12, color: C.muted, fontWeight: 500, fontVariantNumeric: "tabular-nums", marginTop: 1 },
  headerSide: { minWidth: 72, display: "flex", alignItems: "center" },
  tabBar: {
    position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
    width: "100%", maxWidth: 480, zIndex: 30, display: "flex",
    paddingBottom: SAFE_BOTTOM,
    background: "rgba(20,20,23,0.92)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
    borderTop: `1px solid ${C.border}`,
  },
  tab: {
    flex: 1, height: TAB_BAR_HEIGHT, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 3,
    background: "none", border: "none", color: C.dim, fontSize: 11, fontWeight: 600, cursor: "pointer",
  },
  tabActive: { color: C.accent },
  page: { padding: `16px 16px calc(${TAB_BAR_HEIGHT + 28}px + ${SAFE_BOTTOM})` },
  pagePlain: { padding: `16px 16px calc(28px + ${SAFE_BOTTOM})` },
  pageWithBottomBar: { padding: `16px 16px calc(104px + ${SAFE_BOTTOM})` },
  bottomBar: {
    position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
    width: "100%", maxWidth: 480, zIndex: 30,
    padding: `12px 16px calc(12px + ${SAFE_BOTTOM})`,
    background: "linear-gradient(to top, rgba(14,14,16,1) 65%, rgba(14,14,16,0))",
  },

  // Buttons
  btnPrimary: { ...btnBase, background: C.accent, color: C.accentInk, fontWeight: 700 },
  btnSecondary: { ...btnBase, background: C.surface2, color: C.text, border: `1px solid ${C.border}` },
  btnDanger: { ...btnBase, background: C.danger, color: "#fff", fontWeight: 700 },
  btnDangerText: { ...btnBase, background: "transparent", color: C.danger, fontWeight: 600 },
  btnDashed: { ...btnBase, width: "100%", background: "transparent", color: C.muted, border: `1.5px dashed ${C.border}` },
  btnBlock: { width: "100%" },
  btnSmall: { minHeight: 40, padding: "0 14px", fontSize: 14, borderRadius: 10 },
  textBtn: {
    display: "inline-flex", alignItems: "center", gap: 2, minHeight: 40, padding: "0 6px",
    marginLeft: -6, background: "none", border: "none", color: C.accent,
    fontSize: 16, fontWeight: 500, cursor: "pointer",
  },
  iconBtn: {
    width: 40, height: 40, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 20, border: "none", background: "transparent", color: C.muted, cursor: "pointer",
  },
  iconBtnFilled: {
    width: 40, height: 40, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 20, border: "none", background: C.accent, color: C.accentInk, cursor: "pointer",
  },
  playBtn: {
    width: 46, height: 46, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 23, border: "none", background: C.accent, color: C.accentInk, cursor: "pointer",
  },
  btnRow: { display: "flex", gap: 10 },

  // Lists
  list: { display: "flex", flexDirection: "column", gap: 10 },
  row: {
    display: "flex", alignItems: "center", gap: 12,
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
    padding: "6px 12px 6px 4px",
  },
  rowMain: {
    flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
    color: "inherit", padding: "10px 12px", cursor: "pointer", font: "inherit",
  },
  rowTitle: {
    fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    display: "flex", alignItems: "center", gap: 8,
  },
  rowMeta: {
    fontSize: 13, color: C.muted, marginTop: 3, lineHeight: 1.35,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  badge: {
    fontSize: 10, fontWeight: 700, color: C.muted, background: C.surface2,
    borderRadius: 6, padding: "3px 6px", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0,
  },
  empty: { textAlign: "center", padding: "56px 24px", color: C.muted },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, margin: "0 auto 16px", background: C.surface,
    display: "flex", alignItems: "center", justifyContent: "center", color: C.dim,
  },
  emptyTitle: { fontSize: 17, fontWeight: 600, color: C.text, marginBottom: 6 },
  emptyText: { fontSize: 14, lineHeight: 1.5, marginBottom: 20 },

  // Cards / sections
  card: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
    padding: 16, marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em",
    fontWeight: 600, margin: "4px 4px 8px",
  },
  sectionTitle: { fontSize: 16, fontWeight: 600, marginBottom: 4 },
  hint: { fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 14 },
  stats: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 },
  stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 16px" },
  statValue: { fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 },
  statLabel: { fontSize: 12, color: C.muted, marginTop: 4, fontWeight: 500 },

  // Form controls
  label: {
    display: "block", fontSize: 12, color: C.muted, textTransform: "uppercase",
    letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8,
  },
  input: {
    width: "100%", height: 48, padding: "0 14px", borderRadius: 12,
    border: `1px solid ${C.border}`, background: C.surface2, color: C.text,
    fontSize: 16, outline: "none",
  },
  titleInput: {
    width: "100%", padding: "4px 0 12px", marginBottom: 12, border: "none",
    borderBottom: `1px solid ${C.border}`, borderRadius: 0, background: "transparent",
    color: C.text, fontSize: 24, fontWeight: 700, outline: "none",
  },
  field: { marginBottom: 18 },
  fieldGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))",
    gap: 14, marginBottom: 18,
  },
  segmented: {
    display: "flex", padding: 3, gap: 3, borderRadius: 12,
    background: C.surface2, border: `1px solid ${C.border}`,
  },
  segment: {
    flex: 1, minHeight: 40, borderRadius: 9, border: "none", background: "transparent",
    color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
  segmentActive: { background: C.accent, color: C.accentInk },

  stepper: {
    display: "flex", alignItems: "center", height: 48, borderRadius: 12,
    background: C.surface2, border: `1px solid ${C.border}`, overflow: "hidden",
  },
  stepperBtn: {
    width: 44, height: "100%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent", color: C.text, cursor: "pointer",
  },
  stepperValue: { flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 2 },
  stepperInput: {
    width: "100%", minWidth: 0, border: "none", outline: "none", background: "transparent",
    color: C.text, fontSize: 17, fontWeight: 600, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: 0,
  },
  stepperSuffix: { fontSize: 13, color: C.muted, flexShrink: 0, paddingRight: 4 },

  // Bottom sheet
  overlay: {
    position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "flex-end", justifyContent: "center",
    animation: "ct-fade .18s ease-out",
  },
  sheet: {
    width: "100%", maxWidth: 480, maxHeight: "88dvh", display: "flex", flexDirection: "column",
    background: C.surface, borderRadius: "20px 20px 0 0", borderTop: `1px solid ${C.border}`,
    animation: "ct-sheet .24s cubic-bezier(.2,.8,.2,1)",
  },
  sheetHandle: { width: 36, height: 5, borderRadius: 3, background: C.border, margin: "8px auto 0" },
  sheetHeader: { display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 4px 20px" },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: 700 },
  sheetBody: {
    overflowY: "auto", WebkitOverflowScrolling: "touch",
    padding: `8px 20px calc(20px + ${SAFE_BOTTOM})`,
  },
  sheetMessage: { fontSize: 15, color: "#C8C8CE", lineHeight: 1.5, margin: "0 0 20px" },
  pickerItem: {
    display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
    padding: "14px 4px", background: "none", border: "none", borderBottom: `1px solid ${C.border}`,
    color: C.text, cursor: "pointer", font: "inherit",
  },
  transferArea: {
    width: "100%", height: 220, resize: "vertical", background: C.bg, color: "#C8C8CE",
    border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", outline: "none", marginBottom: 12,
  },
  error: { color: C.danger, fontSize: 14, margin: "-4px 0 12px" },

  // Template drift
  drift: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginTop: 8,
    borderRadius: 12, background: C.accentSoft, border: `1px solid rgba(232,176,75,0.3)`,
  },
  driftText: { flex: 1, minWidth: 0, fontSize: 13, color: C.accent, lineHeight: 1.4 },
  driftBtn: {
    minHeight: 34, padding: "0 12px", borderRadius: 9, border: "none", flexShrink: 0,
    background: C.accent, color: C.accentInk, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },

  // History
  historyCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, marginBottom: 10, overflow: "hidden" },
  historyHead: {
    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
    padding: "14px 12px 14px 16px", background: "none", border: "none", color: "inherit", cursor: "pointer", font: "inherit",
  },
  historyBody: { padding: "0 16px 14px" },
  historySteps: { borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4 },
  historyStep: { display: "flex", gap: 10, padding: "6px 0", fontSize: 14, lineHeight: 1.4 },
  historyStepName: { color: C.text, fontWeight: 600, flexShrink: 0, maxWidth: "45%" },
  historyStepValue: { color: C.muted, flex: 1, minWidth: 0 },

  // Session / exercise cards
  exerciseCard: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18,
    marginBottom: 12, overflow: "hidden", transition: "border-color .2s",
  },
  exerciseCardDone: { borderColor: "rgba(76,195,138,0.45)" },
  exerciseCardHeader: { display: "flex", alignItems: "center", gap: 4, padding: "6px 6px 6px 0" },
  exerciseCardHeaderMain: {
    flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
    color: "inherit", padding: "10px 8px 10px 16px", cursor: "pointer", font: "inherit",
  },
  exerciseCardName: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8 },
  exerciseCardTarget: { fontSize: 13, color: C.muted, marginTop: 3, lineHeight: 1.35 },
  exerciseCardBody: { padding: "4px 16px 16px" },
  stepNumber: {
    minWidth: 26, height: 26, padding: "0 6px", borderRadius: 13, flexShrink: 0, background: C.surface2,
    color: C.muted, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
  },
  progressPill: {
    flexShrink: 0, minWidth: 44, height: 28, padding: "0 10px", borderRadius: 14,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
    background: C.surface2, color: C.muted, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
  },
  progressPillDone: { background: C.greenSoft, color: C.green },
  hidden: { display: "none" },

  // Superset: consecutive steps performed in alternating rounds, bracketed
  // by an accent rule down the left edge.
  supersetBlock: { borderLeft: `3px solid ${C.accent}`, paddingLeft: 10, marginBottom: 12 },
  supersetHeader: { display: "flex", alignItems: "center", gap: 2, margin: "-6px 0 4px -6px" },
  // Grip for drag-to-reorder; a full 40px touch target around a small icon.
  dragHandle: {
    width: 36, height: 40, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "none", borderRadius: 10, background: "transparent", color: C.dim,
    userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
  },
  supersetLabel: {
    display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
    letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent, margin: "2px 0 8px",
  },
  supersetFooter: { padding: "4px 4px 2px" },
  supersetHint: { fontSize: 13, color: C.muted, lineHeight: 1.4, marginBottom: 10 },
  // Link/unlink chip sitting in the gap between two routine editor cards.
  linkChip: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "fit-content", margin: "-2px auto 10px",
    minHeight: 32, padding: "0 12px", borderRadius: 16, fontSize: 13, fontWeight: 600, cursor: "pointer",
    background: "none", border: `1px dashed ${C.border}`, color: C.muted,
  },
  linkChipActive: { borderStyle: "solid", borderColor: "rgba(232,176,75,0.45)", background: C.accentSoft, color: C.accent },

  setRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  setIndex: { width: 22, flexShrink: 0, fontSize: 14, fontWeight: 700, color: C.dim, textAlign: "center" },
  setInputWrap: {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", height: 48, padding: "0 12px",
    borderRadius: 12, background: C.surface2, border: `1px solid ${C.border}`, transition: "opacity .15s",
  },
  setInput: {
    flex: 1, minWidth: 0, width: "100%", border: "none", outline: "none", background: "transparent",
    color: C.text, fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums", padding: 0,
  },
  setInputSuffix: { fontSize: 13, color: C.muted, flexShrink: 0, marginLeft: 4 },
  setDone: { opacity: 0.45 },
  checkBtn: {
    width: 52, height: 48, flexShrink: 0, borderRadius: 12, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: C.surface2, border: `1.5px solid ${C.border}`, color: C.dim,
  },
  checkBtnDone: { background: C.green, borderColor: C.green, color: C.greenInk },
  setFooter: { display: "flex", gap: 8, marginTop: 4 },

  restBar: {
    position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 6,
    margin: "0 0 10px", padding: "6px 6px 6px 14px", borderRadius: 12,
    background: C.greenSoft, border: "1px solid rgba(76,195,138,0.35)",
  },
  restBarFill: { position: "absolute", left: 0, top: 0, bottom: 0, transition: "width 1s linear" },
  restBarLabel: { position: "relative", flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 },
  restBarTime: { position: "relative", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginRight: 4 },
  restBarBtn: {
    position: "relative", width: 40, height: 40, borderRadius: 10, border: "none", flexShrink: 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.25)", cursor: "pointer",
  },

  // Interval timer
  timer: {
    display: "flex", flexDirection: "column", alignItems: "center",
    borderRadius: 16, padding: "20px 0 22px", marginBottom: 14, transition: "background .3s",
  },
  timerRing: { position: "relative", width: 220, height: 220 },
  timerCenter: {
    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
  },
  phaseLabel: { fontSize: 13, fontWeight: 800, letterSpacing: "0.16em", marginBottom: 6 },
  timerDigits: { fontSize: 60, fontWeight: 300, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", lineHeight: 1 },
  timerSub: { marginTop: 8, fontSize: 14, color: C.muted, fontVariantNumeric: "tabular-nums" },
  controls: { display: "flex", gap: 10 },
};

// Desktop overrides, merged over `s` when useIsDesktop() is true. The phone
// layout above stays the source of truth; these only widen and re-flow it.
export const DESKTOP_QUERY = "(min-width: 900px)";
const SIDEBAR_WIDTH = 232;
const CONTENT_MAX = 1120;

export const d = {
  root: { maxWidth: "none", margin: 0 },
  main: { flex: 1, minWidth: 0, marginLeft: SIDEBAR_WIDTH },
  // Full-screen pages without the sidebar (active workout).
  focus: { maxWidth: CONTENT_MAX, margin: "0 auto" },

  sidebar: {
    position: "fixed", top: 0, bottom: 0, left: 0, width: SIDEBAR_WIDTH, zIndex: 30,
    display: "flex", flexDirection: "column", gap: 2, padding: "20px 12px",
    background: C.surface, borderRight: `1px solid ${C.border}`,
  },
  brand: {
    display: "flex", alignItems: "center", gap: 10, padding: "4px 10px 22px",
    fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em",
  },
  navItem: {
    display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 42, padding: "0 12px",
    borderRadius: 10, border: "none", background: "transparent", color: C.muted,
    fontSize: 15, fontWeight: 600, textAlign: "left", cursor: "pointer",
  },
  navItemActive: { background: C.accentSoft, color: C.accent },
  sidebarStat: {
    margin: "0 4px", padding: "12px 14px", borderRadius: 12,
    background: C.surface2, border: `1px solid ${C.border}`,
  },

  // Right padding keeps header actions aligned with the capped content width.
  header: { padding: "18px 40px 14px", paddingRight: `max(40px, calc(100% - ${CONTENT_MAX - 40}px))`, minHeight: 72 },
  headerTitle: { fontSize: 28 },
  page: { padding: "28px 40px 56px", maxWidth: CONTENT_MAX },
  pageNarrow: { padding: "28px 40px 56px", maxWidth: 820 },
  pageWithBottomBar: { padding: "28px 40px 24px", maxWidth: CONTENT_MAX },
  // Sticky within the content column instead of pinned to a 480px phone frame.
  bottomBar: {
    position: "sticky", left: "auto", transform: "none", maxWidth: CONTENT_MAX,
    padding: "16px 40px 24px", display: "flex", justifyContent: "flex-end",
  },
  bottomBarBtn: { width: "auto", minWidth: 260 },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16, alignItems: "start" },
  fullRow: { gridColumn: "1 / -1" },
  // Routine editor stays one column: link chips sit between consecutive cards.
  editorColumn: { maxWidth: 760 },
  stats: { gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 },
  settingsGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, maxWidth: 900 },

  overlay: { alignItems: "center", padding: 24 },
  sheet: {
    maxWidth: 520, maxHeight: "84dvh", borderRadius: 20, border: `1px solid ${C.border}`,
    boxShadow: "0 24px 64px rgba(0,0,0,0.5)", animation: "ct-pop .18s ease-out",
  },
  sheetBody: { padding: "8px 20px 20px" },
};
