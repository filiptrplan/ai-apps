import { s, C } from "../styles.js";
import { formatTime } from "../format.js";
import { Icon } from "./Icons.jsx";
import { useDrain } from "./useDrain.js";

const { createContext, useContext } = React;

// DOM node of the dock pinned under the session header. When one is
// provided, rest bars render there instead of inline, so a running rest
// stays visible wherever the page is scrolled.
export const RestDockContext = createContext(null);

// Countdown strip used for both between-set and between-exercise rests.
// The tinted fill drains as the rest runs out. remainingMs is the exact time
// left when timeLeft last changed: the fill drains from there to the next
// whole second, so it reaches empty right as the rest ends.
export function RestBar({ label, timeLeft, remainingMs, total, paused, onTogglePause, onSkip, tone = "green" }) {
  const dock = useContext(RestDockContext);
  const color = tone === "green" ? C.green : C.accent;
  const soft = tone === "green" ? "rgba(76,195,138,0.18)" : "rgba(232,176,75,0.18)";
  const pctOf = (sec) => total > 0 ? Math.max(0, Math.min(100, (sec / total) * 100)) : 0;
  const exactSec = remainingMs != null ? remainingMs / 1000 : timeLeft;
  const drain = useDrain(pctOf(exactSec), pctOf(timeLeft - 1), Math.round((exactSec - (timeLeft - 1)) * 1000), !paused);

  const bar = (
    <div style={{
      ...s.restBar,
      ...(tone === "green" ? {} : { background: "rgba(232,176,75,0.08)", borderColor: "rgba(232,176,75,0.35)" }),
      ...(dock && s.restBarDocked),
    }}>
      <div style={{ ...s.restBarFill, width: `${drain.value}%`, background: soft, transition: drain.ms ? `width ${drain.ms}ms linear` : "none" }} />
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
