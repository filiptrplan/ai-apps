import { s, C } from "../styles.js";
import { formatTime } from "../format.js";
import { Icon } from "./Icons.jsx";

// Countdown strip used for both between-set and between-exercise rests.
// The tinted fill drains as the rest runs out.
export function RestBar({ label, timeLeft, total, paused, onTogglePause, onSkip, tone = "green" }) {
  const color = tone === "green" ? C.green : C.accent;
  const soft = tone === "green" ? "rgba(76,195,138,0.18)" : "rgba(232,176,75,0.18)";
  const pct = total > 0 ? Math.max(0, Math.min(100, (timeLeft / total) * 100)) : 0;

  return (
    <div style={{ ...s.restBar, ...(tone === "green" ? {} : { background: "rgba(232,176,75,0.08)", borderColor: "rgba(232,176,75,0.35)" }) }}>
      <div style={{ ...s.restBarFill, width: `${pct}%`, background: soft }} />
      <span style={{ ...s.restBarLabel, color }}>{paused ? "Paused" : label}</span>
      <span style={{ ...s.restBarTime, color }}>{formatTime(timeLeft)}</span>
      <button style={{ ...s.restBarBtn, color }} onClick={onTogglePause} aria-label={paused ? "Resume rest" : "Pause rest"}>
        {paused ? <Icon.play size={18} /> : <Icon.pause size={18} />}
      </button>
      <button style={{ ...s.restBarBtn, color }} onClick={onSkip} aria-label="Skip rest">
        <Icon.skip size={18} />
      </button>
    </div>
  );
}
