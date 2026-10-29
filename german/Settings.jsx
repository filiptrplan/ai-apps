// Settings: level (steers every AI word, prompt, example, podcast episode
// and how picky corrections are), topics for suggested words, writing and
// podcast days, new cards per day, export and sign out.
import { LEVELS, WEEKDAYS, germanOf } from "./model.js";
import { signOut } from "../shared/auth.js";
import { Screen, ScreenHeader, Card, Chip, Stepper } from "./ui.jsx";

const { useState } = React;

// Tab-separated, one card per line: German, English, example. Anki and
// spreadsheets import it as is.
function exportCards(cards) {
  const clean = v => (v || "").replace(/[\t\n]+/g, " ").trim();
  const rows = cards
    .filter(c => c.kind !== "rule")
    .map(c => [germanOf(c), c.kind === "noun" ? [c.en, c.plural].filter(Boolean).join(" · ") : c.en, c.example].map(clean).join("\t"));
  const blob = new Blob([["German\tEnglish\tExample", ...rows].join("\n")], { type: "text/tab-separated-values" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `deutsch-cards-${new Date().toISOString().slice(0, 10)}.tsv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function Settings({ app }) {
  const { settings, setSettings } = app;
  const [topic, setTopic] = useState(null);
  const update = patch => setSettings(s => ({ ...s, ...patch }));

  const addTopic = () => {
    const t = (topic || "").trim();
    if (t && !settings.topics.includes(t)) update({ topics: [...settings.topics, t] });
    setTopic(null);
  };
  const toggleDay = (field, i) => update({
    [field]: settings[field].includes(i) ? settings[field].filter(d => d !== i) : [...settings[field], i].sort(),
  });

  return (
    <Screen label="Settings">
      <ScreenHeader back="#/progress" title="Settings" big />

      <Card label="Level and topics">
        <div className="g-setting">
          <span><label htmlFor="level"><b>Your level</b></label><span className="g-small">Words, prompts, examples, corrections</span></span>
          <select id="level" className="g-input" value={settings.level} onChange={e => update({ level: e.target.value })}>
            {LEVELS.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>
        <span className="g-muted" style={{ fontSize: 13 }}>Topics for new words (mixed with general words)</span>
        <div className="g-chips">
          {settings.topics.map(t => (
            <Chip key={t} removeLabel={`Remove ${t}`} onRemove={() => update({ topics: settings.topics.filter(x => x !== t) })}>{t}</Chip>
          ))}
          {topic === null ? (
            <Chip dashed onClick={() => setTopic("")}>+ Topic</Chip>
          ) : (
            <form onSubmit={e => { e.preventDefault(); addTopic(); }} style={{ display: "flex" }}>
              <label htmlFor="topic" className="sr">New topic</label>
              <input id="topic" className="g-input" style={{ minHeight: 36, padding: "0 12px", borderRadius: 999, width: 160 }} autoFocus value={topic} onChange={e => setTopic(e.target.value)} onBlur={addTopic} />
            </form>
          )}
        </div>
      </Card>

      <Card label="Routine">
        <b style={{ fontSize: 15 }}>Writing days</b>
        <div className="g-days" role="group" aria-label="Writing days">
          {WEEKDAYS.map((d, i) => (
            <button key={d} type="button" aria-pressed={settings.writingDays.includes(i)} onClick={() => toggleDay("writingDays", i)}>{d}</button>
          ))}
        </div>
        <b style={{ fontSize: 15 }}>Podcast days</b>
        <div className="g-days" role="group" aria-label="Podcast days">
          {WEEKDAYS.map((d, i) => (
            <button key={d} type="button" aria-pressed={settings.podcastDays.includes(i)} onClick={() => toggleDay("podcastDays", i)}>{d}</button>
          ))}
        </div>
        <span className="g-small">Cards are every weekday; weekends are optional.</span>
      </Card>

      <Card tight label="Cards">
        <div className="g-setting">
          <span><b>New cards per day</b><span className="g-small">Your words first, AI fills the rest</span></span>
          <Stepper value={settings.newPerDay} onChange={n => update({ newPerDay: n })} />
        </div>
      </Card>

      <nav className="g-navlist" aria-label="Data" style={{ display: "flex" }}>
        <button type="button" onClick={() => exportCards(app.cards)} disabled={!app.cards.length}>Export cards</button>
        {app.session
          ? <button type="button" className="danger" onClick={() => signOut()}>Sign out</button>
          : <a href="./">Sign in on the home page</a>}
      </nav>
    </Screen>
  );
}
