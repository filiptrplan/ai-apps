// Writing history: the most frequent fixes, then every past session; tap
// one to see its feedback again.
import { fixCounts } from "./model.js";
import { pointLabel } from "./grammar.js";
import { Feedback } from "./Write.jsx";
import { Screen, ScreenHeader, Card, Empty } from "./ui.jsx";

function shortDate(day) {
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
  return `${wd} ${d}.${m}.`;
}

function Excerpt({ s }) {
  // The corrected text with the fixed words in mint.
  const marks = s.fixes.map(f => f.to).filter(Boolean);
  if (!marks.length) return <p>{s.corrected}</p>;
  const re = new RegExp(`(${marks.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return <p>{s.corrected.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</p>;
}

export function History({ app, sessionId }) {
  const { writing } = app;
  const open = sessionId && writing.find(s => s.id === sessionId);

  if (open) {
    return (
      <Screen label="Writing session">
        <ScreenHeader back="#/history" title={shortDate(open.day)} big />
        <Card>
          <p className="g-prompt" style={{ fontSize: 18 }}>{open.prompt}</p>
          <p className="g-muted" style={{ fontSize: 15 }}>{open.text}</p>
        </Card>
        <Feedback session={open} />
      </Screen>
    );
  }

  const top = fixCounts(writing).slice(0, 3);
  return (
    <Screen label="Writing history">
      <ScreenHeader back="#/progress" title="Writing history" big />
      {top.length > 0 && (
        <Card amber label="Recurring mistakes">
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--amber)" }}>Most frequent fixes</span>
          <div className="g-stack" style={{ gap: 6 }}>
            {top.map(t => (
              <div key={t.point} className="g-between" style={{ fontSize: 14 }}>
                <span>{pointLabel(t.point)}</span><span style={{ color: "var(--amber-muted)" }}>{t.count}×</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {writing.length ? (
        writing.map(s => (
          <a key={s.id} href={`#/history/${s.id}`} className="g-session" style={{ textDecoration: "none" }}>
            <div className="g-between g-small" style={{ fontWeight: 600 }}>
              <span>{shortDate(s.day)}</span>
              <span>{s.fixes.length} {s.fixes.length === 1 ? "fix" : "fixes"} · {s.own ? "own topic" : `focus: ${pointLabel(s.focus)}`}</span>
            </div>
            <b style={{ fontSize: 15 }}>{s.prompt}</b>
            <Excerpt s={s} />
          </a>
        ))
      ) : (
        <Empty>Your writing sessions show up here.</Empty>
      )}
    </Screen>
  );
}
