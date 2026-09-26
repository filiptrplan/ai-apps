import { s, C } from "../styles.js";
import { formatTime } from "../format.js";
import { Icon } from "./Icons.jsx";

const { createContext, useContext } = React;

// DOM node of the dock pinned under the session header. When one is
// provided, rest bars render there instead of inline, so a running rest
// stays visible wherever the page is scrolled.
export const RestDockContext = createContext(null);

// Countdown strip used for both between-set and between-exercise rests.
// The tinted fill drains as the rest runs out.
export function RestBar({ label, timeLeft, total, paused, onTogglePause, onSkip, tone = "green" }) {
  const dock = useContext(RestDockContext);
  const color = tone === "green" ? C.green : C.accent;
  const soft = tone === "green" ? "rgba(76,195,138,0.18)" : "rgba(232,176,75,0.18)";
  const pct = total > 0 ? Math.max(0, Math.min(100, (timeLeft / total) * 100)) : 0;

  const bar = (
    <div style={{
      ...s.restBar,
      ...(tone === "green" ? {} : { background: "rgba(232,176,75,0.08)", borderColor: "rgba(232,176,75,0.35)" }),
      ...(dock && s.restBarDocked),
    }}>
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
  return dock ? ReactDOM.createPortal(bar, dock) : bar;
}
