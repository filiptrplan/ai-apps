// Shared visual tokens + small reusable components for both the user and
// admin apps: cozy-storybook palette, the hold-to-confirm control, toasts,
// bottom sheets, empty states, and the sound/haptics context.

const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

export const theme = {
  bg: "#EFE2D3",
  bgGrad: "radial-gradient(120% 80% at 50% 0%, #F7ECE0 0%, #E9DAC8 100%)",
  card: "#FFFCF7",
  cardBorder: "#EFE0D0",
  panel: "#FBF3EA",
  headerGrad: "linear-gradient(180deg,#FDF7F0 0%,#FBF1E6 100%)",
  headerBorder: "#F0E1D1",
  ink: "#3A2E28",
  inkSoft: "#5C4A40",
  muted: "#93806F",
  mutedSoft: "#A8798A",
  rose: "#B4405C",
  roseDeep: "#A03F58",
  roseSoft: "#E08FA3",
  roseBg: "linear-gradient(160deg,#FCEEF1 0%,#F8E2E7 100%)",
  roseBgFlat: "#FCEEF1",
  roseBorder: "#F2D5DC",
  chip: "#F6E9DC",
  chipBorder: "#EBD8C6",
  sand: "#F5F1E7",
  sandBorder: "#E8E2D2",
  sage: "#6F7D52",
  sageBg: "#F1F3E6",
  sageBorder: "#E2E7D0",
  warn: "#8A6A34",
  warnBg: "#F4E3C9",
  warnBorder: "#E7CFAA",
  bad: "#8E3A46",
  badBg: "#F3EBEA",
  fontScript: "Caveat, cursive",
  fontDisplay: "'Baloo 2', system-ui, sans-serif",
  fontBody: "Nunito, system-ui, sans-serif",
};

export const googleFontsHref =
  "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Caveat:wght@500;600;700&family=Nunito:wght@400;600;700;800&display=swap";

// Eases a displayed number toward `target` over ~520ms (skipped entirely
// under reduced motion, where it just jumps).
export function useAnimatedNumber(target, reducedMotion) {
  const [shown, setShown] = useState(target);
  const rafRef = useRef(null);
  const fromRef = useRef(target);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (target === prevTarget.current) return;
    fromRef.current = shown;
    prevTarget.current = target;
    if (reducedMotion) { setShown(target); return; }
    cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 520);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (k < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reducedMotion]);

  return shown;
}

export function useReducedMotionPref() {
  const [rm, setRm] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setRm(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange));
  }, []);
  return rm;
}

// ── sound + haptics ──────────────────────────────────────────────────────
const SoundContext = createContext(null);
export const useSound = () => useContext(SoundContext);

export function SoundProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem("marsova_sound");
      return raw === null ? true : raw === "1";
    } catch {
      return true;
    }
  });
  const acRef = useRef(null);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem("marsova_sound", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const beep = useCallback((kind) => {
    if (!enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      acRef.current = acRef.current || new AC();
      const ac = acRef.current;
      const map = { ok: [523, 784], bad: [220, 165], req: [659, 988] };
      const notes = map[kind] || map.ok;
      notes.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.value = f;
        const t = ac.currentTime + i * 0.09;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.24);
      });
    } catch { /* zvok ni na voljo na tej napravi */ }
  }, [enabled]);

  const buzz = useCallback((ms) => {
    try { navigator.vibrate && navigator.vibrate(ms); } catch {}
  }, []);

  return (
    <SoundContext.Provider value={{ enabled, toggle, beep, buzz }}>
      {children}
    </SoundContext.Provider>
  );
}

// ── hold-to-confirm control ──────────────────────────────────────────────
// Shared by chore completion and reward requests. Phases: idle -> holding
// -> saving -> done (auto-resets to idle) | idle (on cancel or failure).
// onComplete must return a Promise; rejecting it (with an ApiError) leaves
// the balance untouched and restores the idle state - the caller shows the
// error toast.
export function HoldControl({
  durationMs = 800,
  onComplete,
  onError,
  label,
  ariaLabel,
  disabled,
  height = 54,
  radius = 18,
  idleBg = theme.chip,
  idleBorder = theme.chipBorder,
  fillFrom = "#F3C3CE",
  fillTo = "#E8879E",
  textColor = "#5F4640",
}) {
  const [phase, setPhase] = useState("idle");
  const [pct, setPct] = useState(0);
  const rafRef = useRef(null);
  const t0Ref = useRef(0);
  const tickRef = useRef(0);
  const sound = useSound();

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const finish = useCallback(async () => {
    cancelAnimationFrame(rafRef.current);
    setPhase("saving");
    try {
      await onComplete();
      setPhase("done");
      sound && sound.buzz(28);
      setTimeout(() => { setPhase("idle"); setPct(0); }, 1400);
    } catch (err) {
      setPhase("idle");
      setPct(0);
      sound && sound.beep("bad");
      onError && onError(err);
    }
  }, [onComplete, onError, sound]);

  const start = useCallback(() => {
    if (disabled || phase !== "idle") return;
    t0Ref.current = performance.now();
    tickRef.current = 0;
    setPhase("holding");
    const step = (now) => {
      const k = Math.min(1, (now - t0Ref.current) / durationMs);
      if (k > 0.33 && tickRef.current < 1) { tickRef.current = 1; sound && sound.buzz(8); }
      if (k > 0.66 && tickRef.current < 2) { tickRef.current = 2; sound && sound.buzz(8); }
      setPct(k);
      if (k >= 1) { finish(); } else { rafRef.current = requestAnimationFrame(step); }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [disabled, phase, durationMs, finish, sound]);

  const cancel = useCallback(() => {
    if (phase !== "holding") return;
    cancelAnimationFrame(rafRef.current);
    if (pct > 0.12) sound && sound.beep("bad");
    setPhase("idle");
    setPct(0);
  }, [phase, pct, sound]);

  const pctNum = phase === "holding" ? Math.round(pct * 100) : phase === "saving" || phase === "done" ? 100 : 0;
  const fillWidth = phase === "idle" ? "0%" : `${pctNum}%`;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") cancel(); }}
      style={{
        position: "relative", overflow: "hidden", height, borderRadius: radius,
        background: idleBg, border: `1.5px solid ${idleBorder}`,
        display: "grid", placeItems: "center",
        cursor: disabled ? "default" : "pointer", userSelect: "none", touchAction: "none",
        WebkitTapHighlightColor: "transparent",
        opacity: disabled ? 0.55 : 1,
        outlineOffset: 2,
      }}
    >
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        background: `linear-gradient(90deg, ${fillFrom}, ${fillTo})`,
        width: fillWidth, transition: phase === "idle" ? "width .15s ease-out" : "none",
      }} />
      <div style={{ position: "relative", fontWeight: 800, fontSize: 15, color: textColor }}>
        {label(phase, pctNum)}
      </div>
    </div>
  );
}

// ── toasts ────────────────────────────────────────────────────────────────
export function Toast({ toast, onAction }) {
  if (!toast) return null;
  const bad = !!toast.bad;
  return (
    <div style={{
      position: "absolute", left: 14, right: 14, bottom: 96, zIndex: 40,
      animation: "msRise .28s cubic-bezier(.2,.9,.3,1.2)",
    }}>
      <div style={{
        background: bad ? theme.bad : theme.ink, borderRadius: 20, padding: "13px 15px",
        display: "flex", alignItems: "center", gap: 11,
        boxShadow: bad ? "0 12px 26px -10px rgba(142,58,70,.5)" : "0 12px 26px -10px rgba(58,46,40,.55)",
      }}>
        <span style={{ fontSize: 18 }}>{toast.icon}</span>
        <div style={{ flex: 1, minWidth: 0, color: bad ? "#FDF1F2" : "#FBF3EA", fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>
          {toast.text}
        </div>
        {toast.actionLabel && (
          <div
            role="button" tabIndex={0} onClick={onAction}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAction(); } }}
            style={{
              flex: "0 0 auto", height: 38, padding: "0 14px", borderRadius: 12,
              background: bad ? "#A8515D" : "#5C4A40", display: "grid", placeItems: "center",
              color: "#FFF", fontWeight: 800, fontSize: 13.5, cursor: "pointer",
            }}
          >
            {toast.actionLabel}
          </div>
        )}
      </div>
    </div>
  );
}

// ── bottom sheet ─────────────────────────────────────────────────────────
export function Sheet({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div
        role="button" tabIndex={0} aria-label="Zapri" onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }}
        style={{ position: "absolute", inset: 0, background: "rgba(58,46,40,.42)", animation: "msFade .2s ease-out" }}
      />
      <div style={{
        position: "relative", background: "#FDF7F0",
        borderRadius: "32px 32px 0 0", padding: "10px 22px max(30px, env(safe-area-inset-bottom))",
        boxShadow: "0 -14px 40px -14px rgba(58,46,40,.4)",
        animation: "msRise .32s cubic-bezier(.2,.9,.3,1.15)",
        maxHeight: "88%", overflowY: "auto",
      }}>
        <div style={{ width: 44, height: 5, borderRadius: 3, background: "#E6D6C4", margin: "0 auto 16px" }} />
        {children}
      </div>
    </div>
  );
}

// ── empty state ──────────────────────────────────────────────────────────
export function EmptyState({ image, emoji, title, body, size = 120 }) {
  return (
    <div style={{ padding: "34px 30px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}>
      {image ? (
        <img src={image} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "3px solid #FFFFFF", boxShadow: "0 6px 16px rgba(120,80,50,.18)" }} />
      ) : (
        <div style={{ fontSize: 34 }}>{emoji}</div>
      )}
      <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 27, lineHeight: 1, color: theme.ink }}>{title}</div>
      <div style={{ fontSize: 13.5, color: theme.muted, lineHeight: 1.45, maxWidth: 250 }}>{body}</div>
    </div>
  );
}

// ── filter chip ───────────────────────────────────────────────────────────
export function Chip({ active, onClick, children }) {
  return (
    <div
      role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 15px",
        borderRadius: 14, whiteSpace: "nowrap", cursor: "pointer", fontWeight: active ? 800 : 700, fontSize: 13.5,
        background: active ? theme.ink : "#FFFCF7",
        border: active ? "none" : `1px solid ${theme.cardBorder}`,
        color: active ? "#FBF3EA" : "#6E5A4E",
        boxShadow: active ? "0 3px 0 rgba(58,46,40,.2)" : "none",
      }}
    >
      {children}
    </div>
  );
}

// ── skeleton loading ──────────────────────────────────────────────────────
export function SkeletonList({ count = 3 }) {
  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          height: 132, borderRadius: 26,
          background: i === count - 1 ? "#F5E9DC" : "linear-gradient(90deg,#F5E9DC 0%,#FBF3EA 50%,#F5E9DC 100%)",
          backgroundSize: "240px 100%",
          animation: i === count - 1 ? "none" : "msShim 1.1s linear infinite",
          opacity: i === count - 1 ? 0.6 : 1,
        }} />
      ))}
    </div>
  );
}

// ── generic confirm sheet (admin) ────────────────────────────────────────
export function ConfirmSheet({ open, title, body, confirmLabel, cancelLabel = "Prekliči", onConfirm, onCancel, danger }) {
  return (
    <Sheet open={open} onClose={onCancel}>
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <div style={{ fontFamily: theme.fontScript, fontWeight: 700, fontSize: 26, color: theme.ink, lineHeight: 1.1 }}>{title}</div>
        {body && <div style={{ fontSize: 14, color: "#7C6A5C", lineHeight: 1.45 }}>{body}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <div role="button" tabIndex={0} onClick={onCancel}
            style={{ flex: 1, height: 52, borderRadius: 17, background: "#F3EDE4", border: "1px solid #E7DACC", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#7C6A5C", cursor: "pointer" }}>
            {cancelLabel}
          </div>
          <div role="button" tabIndex={0} onClick={onConfirm}
            style={{ flex: 1, height: 52, borderRadius: 17, background: danger ? theme.bad : theme.ink, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, color: "#FBF3EA", cursor: "pointer" }}>
            {confirmLabel}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export const globalCss = `
  *{box-sizing:border-box}
  body{margin:0;background:${theme.bg};font-family:${theme.fontBody};-webkit-font-smoothing:antialiased}
  a{color:${theme.rose};text-decoration:none}
  a:hover{color:${theme.roseDeep}}
  .mo-hs::-webkit-scrollbar{display:none}
  .mo-hs{scrollbar-width:none}
  input, textarea, select { font-family: ${theme.fontBody}; }
  @keyframes msRise{from{transform:translateY(120%)}to{transform:translateY(0)}}
  @keyframes msFade{from{opacity:0}to{opacity:1}}
  @keyframes msPop{0%{transform:scale(.7);opacity:0}55%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}
  @keyframes msFly{0%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-70px) scale(.7);opacity:0}}
  @keyframes msShim{0%{background-position:-240px 0}100%{background-position:240px 0}}
  @keyframes msCelebrate{0%{transform:scale(1) rotate(0deg)}16%{transform:scale(1.05) rotate(-1.3deg)}34%{transform:scale(1.035) rotate(1.2deg)}54%{transform:scale(1.022) rotate(-.8deg)}74%{transform:scale(1.01) rotate(.45deg)}100%{transform:scale(1) rotate(0deg)}}
`;
