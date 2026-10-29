// Progress tab: this week, a few counts, and the way to everything else
// (deck, listening, writing history, settings).
import { stats, WEEKDAYS } from "./model.js";
import { pointLabel } from "./grammar.js";
import { Screen, Card, Stat, NavList } from "./ui.jsx";

const fmtMinutes = m => (m < 60 ? `${m} min` : `${(m / 60).toFixed(1).replace(/\.0$/, "")} h`);

const LINKS = [
  { href: "#/deck", label: "Deck", note: "Browse and edit cards" },
  { href: "#/listening", label: "Listening", note: "Resources and log" },
  { href: "#/history", label: "Writing history", note: "Past texts and fixes" },
  { href: "#/settings", label: "Settings", note: "Level, topics, routine" },
];

export function Progress({ app }) {
  const s = stats(app.cards, app.writing, app.listening, app.log, app.today);
  const current = app.listening.resources.find(r => r.id === app.listening.current);
  return (
    <Screen tab wide label="Progress">
      <h1 className="g-title g-mobile-only">Progress</h1>

      <Card label="This week">
        <div className="g-between" style={{ alignItems: "baseline" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>This week</span>
          <span className="g-small" style={{ fontSize: 13 }}>
            {s.cardDays} card {s.cardDays === 1 ? "day" : "days"} · {s.writingDays} writing
          </span>
        </div>
        <div className="g-week">
          {s.week.map((d, i) => (
            <div key={d.key}>
              <span className={["sq", d.cards && "cards", d.writing && "writing", d.future && !d.cards && !d.writing && "future"].filter(Boolean).join(" ")} />
              <span className={d.key === app.today ? "today" : undefined}>{WEEKDAYS[i]}</span>
            </div>
          ))}
        </div>
        <div className="g-legend"><span><i />Cards</span><span><i className="amber" />Writing</span></div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <Stat label="Cards learned" value={s.learned} note={`${s.dueTomorrow} due tomorrow`} />
        <Stat label="Listening" value={fmtMinutes(s.listeningMin)} note={current ? `this week · ${current.name}` : "this week"} />
        <div className="g-hide-mobile" style={{ display: "contents" }}>
          <Stat label="Writing sessions" value={s.writingSessions} note={s.topFix ? `Most common fix: ${pointLabel(s.topFix.point)}` : null} />
        </div>
      </div>

      <NavList label="More" items={LINKS} />
    </Screen>
  );
}
