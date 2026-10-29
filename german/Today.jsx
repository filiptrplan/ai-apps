// Today tab: the one task to do now with a Start button, a preview of the
// day's tasks, and "Fertig für heute" once they're all done. Weekends
// without writing have no tasks; cards can still be done then.
import { tasksFor, doneTasks, planSession, sessionMinutes, addDays, dayEnd, uid } from "./model.js";
import { Screen, Button, IconButton, Icon, Card } from "./ui.jsx";

const TASK = {
  cards: { name: "Flashcards", icon: "cards", href: "#/cards", variant: "mint" },
  writing: { name: "Writing", icon: "pen", href: "#/write", variant: "amber" },
};

function germanDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

export function cardPlanSize(app) {
  const plan = planSession(app.cards, app.suggest, app.settings, app.today);
  return plan.reviews.length + plan.fresh.length + plan.fromSuggestions;
}

function taskMeta(task, cardCount) {
  if (task === "cards") return `${sessionMinutes(cardCount)} min`;
  return "10 min";
}

function Hero({ icon, title, sub, children }) {
  return (
    <section className="g-hero">
      <span style={{ color: "var(--mint)" }}><Icon name={icon} size={52} stroke={1.6} /></span>
      <h1>{title}</h1>
      <p>{sub}</p>
      {children}
    </section>
  );
}

function TaskList({ tasks, done, now, cardCount }) {
  return (
    <ol className="g-tasks" aria-label="Today's tasks">
      {tasks.map((t, i) => {
        const state = done.includes(t) ? "done" : t === now ? "now" : "";
        return (
          <li key={t} className={state}>
            <span className="n">{state === "done" ? <Icon name="check" size={14} stroke={3} /> : i + 1}</span>
            <span className="name">{TASK[t].name}</span>
            <span className="meta">{state === "done" ? "Done" : taskMeta(t, cardCount)}</span>
            {state === "now" && <span className="tagnow">Now</span>}
          </li>
        );
      })}
    </ol>
  );
}

// The listening shortcut on the done screen: logs 15 minutes of the
// current resource.
function ListenLog({ app }) {
  const { listening, today } = app;
  const res = listening.resources.find(r => r.id === listening.current);
  if (!res) return null;
  const add = () => {
    app.setListening(l => ({ ...l, current: res.id, resources: listening.resources, log: [{ id: uid(), day: today, res: res.id, min: 15 }, ...listening.log] }));
    app.showToast(`Logged 15 min · ${res.name}`);
  };
  return (
    <Card className="g-between" label="Listening">
      <div className="g-between" style={{ width: "100%", textAlign: "left" }}>
        <div className="g-stack" style={{ gap: 2 }}>
          <b style={{ fontSize: 14 }}>Listened to something?</b>
          <span className="g-small" style={{ fontSize: 13 }}>{res.name} · optional</span>
        </div>
        <Button size="sm" onClick={add}>+15 min</Button>
      </div>
    </Card>
  );
}

function Done({ app, tasks }) {
  const tomorrow = addDays(app.today, 1);
  const next = tasksFor(tomorrow, app.settings);
  const dueTomorrow = app.cards.filter(c => c.srs && c.srs.due < dayEnd(tomorrow)).length;
  const nextCount = Math.min(dueTomorrow + app.settings.newPerDay, 60);
  const names = tasks.map(t => (t === "cards" ? "Cards" : "writing"));
  const tomorrowText = next.length
    ? `Tomorrow: ${next.map(t => (t === "cards" ? `cards, about ${sessionMinutes(nextCount)} min` : "writing")).join(" + ")}.`
    : "Tomorrow is free.";
  return (
    <>
      <div className="g-done-mark"><Icon name="check" size={48} stroke={2.4} /></div>
      <h1 style={{ marginTop: 8, fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>Fertig für heute.</h1>
      <p className="g-muted" style={{ fontSize: 16 }}>
        {names.join(" and ").replace(/^./, c => c.toUpperCase())} done.<br />{tomorrowText}
      </p>
      <div style={{ marginTop: 24, width: "100%" }}><ListenLog app={app} /></div>
    </>
  );
}

export function Today({ app }) {
  const { today, settings, log } = app;
  const tasks = tasksFor(today, settings);
  const done = doneTasks(log, today);
  const pending = tasks.filter(t => !done.includes(t));
  const now = pending[0];
  const cardCount = cardPlanSize(app);

  let body;
  if (tasks.length && !now) {
    body = <Done app={app} tasks={tasks} />;
  } else if (!tasks.length) {
    body = (
      <Hero icon="sun" title="Frei heute" sub="Nothing planned today.">
        {cardCount > 0 && !done.includes("cards") && <Button href="#/cards" variant="outline">Review {cardCount} cards anyway</Button>}
      </Hero>
    );
  } else {
    const t = TASK[now];
    const sub = now === "cards"
      ? cardCount ? `${cardCount} ${cardCount === 1 ? "card" : "cards"} · about ${sessionMinutes(cardCount)} min` : "Nothing due right now"
      : "3–5 sentences · about 10 min";
    body = (
      <>
        <Hero icon={t.icon} title={t.name} sub={sub}>
          <Button href={t.href} variant={t.variant}>Start</Button>
        </Hero>
        <TaskList tasks={tasks} done={done} now={now} cardCount={cardCount} />
      </>
    );
  }

  return (
    <Screen tab label="Today">
      <header className="g-between g-mobile-only">
        <span className="g-date" style={{ paddingLeft: 4 }}>{germanDate(today)}</span>
        <IconButton icon="plus" label="Add a word" href="#/add" variant="accent" />
      </header>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 16, maxWidth: 520, width: "100%", margin: "0 auto", textAlign: "center", paddingBottom: 48 }}>
        <span className="g-date g-desktop-only">{germanDate(today)}</span>
        {body}
      </div>
    </Screen>
  );
}
