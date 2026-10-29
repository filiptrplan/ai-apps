// Listening: the resource you're on with a quick minutes log, the rest of
// your list (add, remove, reorder) and this week's log. Listening doesn't
// count toward the daily time.
import { weekKeys, minutesIn, uid } from "./model.js";
import { Screen, ScreenHeader, Card, Button, IconButton, LinkButton, Field, Input, Tag, Label } from "./ui.jsx";

const { useState } = React;

const wd = day => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
};

function AddResource({ onAdd, onCancel }) {
  const [r, setR] = useState({ name: "", desc: "", level: "", url: "" });
  const set = patch => setR(v => ({ ...v, ...patch }));
  return (
    <Card label="Add a resource">
      <Field id="res-name" label="Name"><Input id="res-name" value={r.name} autoFocus onChange={v => set({ name: v })} /></Field>
      <div className="g-grid2">
        <Field id="res-level" label="Level"><Input id="res-level" value={r.level} placeholder="B1" onChange={v => set({ level: v })} /></Field>
        <Field id="res-desc" label="What it is"><Input id="res-desc" value={r.desc} placeholder="Podcast" onChange={v => set({ desc: v })} /></Field>
      </div>
      <Field id="res-url" label="Link"><Input id="res-url" type="url" value={r.url} placeholder="https://" onChange={v => set({ url: v })} /></Field>
      <div className="g-row">
        <Button size="sm" variant="mint" disabled={!r.name.trim()} onClick={() => onAdd({ id: uid(), name: r.name.trim(), desc: r.desc.trim(), level: r.level.trim(), url: r.url.trim() })}>Add</Button>
        <LinkButton onClick={onCancel}>Cancel</LinkButton>
      </div>
    </Card>
  );
}

export function Listening({ app }) {
  const { listening, today } = app;
  const { resources, current, log } = listening;
  const [adding, setAdding] = useState(false);
  const res = resources.find(r => r.id === current);
  const idx = resources.indexOf(res);
  const save = patch => app.setListening(l => ({ ...listening, ...patch }));
  const week = weekKeys(today);
  const weekLog = log.filter(e => week.includes(e.day));
  const name = id => resources.find(r => r.id === id)?.name || "Removed resource";

  const logMinutes = min => {
    save({ log: [{ id: uid(), day: today, res: current, min }, ...log] });
    app.showToast(`Logged ${min} min · ${res.name}`);
  };
  const move = (i, d) => {
    const next = [...resources];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    save({ resources: next });
  };

  return (
    <Screen label="Listening">
      <ScreenHeader back="#/progress" title="Listening" big />
      <p className="g-muted" style={{ margin: "0 4px" }}>Aim to follow about 70%. German subtitles, not English. Doesn't count toward your daily time.</p>

      {res && (
        <Card big label="Current resource">
          <div className="g-between">
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mint)" }}>Listening now</span>
            {res.level && <Tag>{res.level}</Tag>}
          </div>
          <div className="g-stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 24, fontWeight: 800 }}>{res.name}</span>
            {res.desc && <span className="g-muted">{res.desc}</span>}
          </div>
          <div className="g-grid2" style={{ gap: 8 }}>
            <Button size="md" variant="mint" onClick={() => logMinutes(15)}>+15 min</Button>
            <Button size="md" onClick={() => logMinutes(30)}>+30 min</Button>
          </div>
          <div className="g-between">
            {res.url ? <LinkButton href={res.url}>Open ↗</LinkButton> : <span />}
            {idx < resources.length - 1 && (
              <Button size="sm" variant="outline" onClick={() => save({ current: resources[idx + 1].id })}>Feels easy — move up</Button>
            )}
          </div>
        </Card>
      )}

      <section aria-label="Your list" className="g-stack">
        <Label>Your list</Label>
        {resources.length > 0 && (
          <ul className="g-list">
            {resources.map((r, i) => (
              <li key={r.id}>
                <div className="g-between" style={{ padding: "10px 8px 10px 18px", borderBottom: i < resources.length - 1 ? "1px solid var(--line)" : 0 }}>
                  <button type="button" className="t" style={{ background: "none", border: 0, padding: 0, textAlign: "left", flex: 1 }} onClick={() => save({ current: r.id })} aria-label={`Listen to ${r.name} now`}>
                    <b style={{ fontSize: 15, color: r.id === current ? "var(--mint)" : undefined }}>{r.name}</b>
                    <span>{[r.level, r.desc].filter(Boolean).join(" · ")}</span>
                  </button>
                  <div className="g-row" style={{ gap: 0 }}>
                    <IconButton icon="up" label={`Move ${r.name} up`} variant="ghost" small disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon="down" label={`Move ${r.name} down`} variant="ghost" small disabled={i === resources.length - 1} onClick={() => move(i, 1)} />
                    <IconButton icon="trash" label={`Remove ${r.name}`} variant="ghost" small iconSize={16} onClick={() => save({ resources: resources.filter(x => x.id !== r.id) })} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {adding ? (
          <AddResource onCancel={() => setAdding(false)} onAdd={r => { save({ resources: [...resources, r], current: current || r.id }); setAdding(false); }} />
        ) : (
          <div><LinkButton mint onClick={() => setAdding(true)}>+ Add a resource</LinkButton></div>
        )}
      </section>

      <section aria-label="This week" className="g-stack" style={{ gap: 6 }}>
        <div className="g-between"><Label>This week</Label><span className="g-small">{minutesIn(log, week)} min</span></div>
        {weekLog.length ? weekLog.map(e => (
          <div key={e.id} className="g-between" style={{ fontSize: 14, padding: "0 4px" }}>
            <span>{wd(e.day)} · {name(e.res)}</span>
            <span className="g-row" style={{ gap: 4, color: "var(--muted)" }}>
              {e.min} min
              <IconButton icon="close" label="Remove this entry" variant="ghost" small iconSize={14} onClick={() => save({ log: log.filter(x => x.id !== e.id) })} />
            </span>
          </div>
        )) : <p className="g-muted" style={{ padding: "0 4px" }}>Nothing logged yet this week.</p>}
      </section>
    </Screen>
  );
}
