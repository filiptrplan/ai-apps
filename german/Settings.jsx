// Settings: level (steers every AI word, prompt, example, podcast episode
// and how picky corrections are), topics for suggested words, writing and
// podcast days, how fast the podcast hosts speak, new cards per day, the
// daily reminder, export and sign out.
import { APP_ID, LEVELS, WEEKDAYS, germanOf } from "./model.js";
import { signOut } from "../shared/auth.js";
import { enablePush, pushState } from "../shared/push.js";
import { Screen, ScreenHeader, Card, Chip, Choice, Stepper, Button } from "./ui.jsx";

const { useState, useEffect } = React;

const deviceZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
};

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// The daily reminder: a push notification at a chosen time listing what's
// left of today's tasks (sent by the server, see server/reminders.js). The
// setting is synced; notifications are per device, so a device without
// them gets offered to turn them on.
function ReminderCard({ app, update }) {
  const r = app.settings.reminder;
  const [device, setDevice] = useState(null); // pushState(), null while checking
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setDevice, () => setDevice("unsupported")); }, []);

  // Must run straight from the tap: it may ask for permission.
  const turnOnHere = async () => {
    setBusy(true);
    try {
      const state = await enablePush(APP_ID);
      setDevice(state);
      if (state === "on") return true;
      app.showToast(state === "denied" ? "Notifications are blocked for this site" : "Notifications weren't allowed");
    } catch (err) {
      app.showToast(err.message);
    } finally {
      setBusy(false);
    }
    return false;
  };
  const setOn = async on => {
    if (!on) return update({ reminder: { ...r, on: false } });
    if (await turnOnHere()) update({ reminder: { ...r, on: true, tz: deviceZone() } });
  };

  let note = null;
  if (!app.session) note = "Sign in to get reminders.";
  else if (device === "unsupported") note = isIOS() ? "Add this app to your Home Screen (Share → Add to Home Screen) to get notifications." : "This browser can't show notifications.";
  else if (device === "denied") note = "Notifications are blocked for this site. Allow them in your browser or system settings.";
  const canUse = app.session && device !== "unsupported" && device !== "denied";

  return (
    <Card tight label="Reminder">
      <div className="g-setting">
        <span><b>Daily reminder</b><span className="g-small">What's left of today, if anything</span></span>
        <div style={{ width: 132 }}>
          <Choice label="Daily reminder" value={r.on ? "on" : "off"} onChange={v => !busy && canUse && setOn(v === "on")} options={[["off", "Off"], ["on", "On"]]} />
        </div>
      </div>
      {r.on && (
        <div className="g-setting">
          <span><label htmlFor="reminder-time"><b>Time</b></label><span className="g-small">{r.tz || "UTC"}</span></span>
          <input id="reminder-time" type="time" className="g-input" style={{ width: 120 }} value={r.time}
            onChange={e => e.target.value && update({ reminder: { ...r, time: e.target.value, tz: deviceZone() } })} />
        </div>
      )}
      {note && <span className="g-small" style={{ padding: "10px 0" }}>{note}</span>}
      {!note && r.on && device === "off" && (
        <div className="g-setting">
          <span className="g-small">Notifications aren't on for this device.</span>
          <Button variant="outline" size="sm" busy={busy} onClick={turnOnHere}>Turn on here</Button>
        </div>
      )}
    </Card>
  );
}

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

      <Card label="Podcast">
        <span><b style={{ fontSize: 15 }}>Podcast pace</b><span className="g-small" style={{ display: "block" }}>How fast new episodes are spoken</span></span>
        <Choice label="Podcast pace" value={settings.podcastPace} onChange={v => update({ podcastPace: v })} options={[["slowest", "Slowest"], ["slower", "Slower"], ["natural", "Natural"]]} />
      </Card>

      <Card tight label="Cards">
        <div className="g-setting">
          <span><b>New cards per day</b><span className="g-small">Your words first, AI fills the rest</span></span>
          <Stepper value={settings.newPerDay} onChange={n => update({ newPerDay: n })} />
        </div>
      </Card>

      <ReminderCard app={app} update={update} />

      <nav className="g-navlist" aria-label="Data" style={{ display: "flex" }}>
        <button type="button" onClick={() => exportCards(app.cards)} disabled={!app.cards.length}>Export cards</button>
        {app.session
          ? <button type="button" className="danger" onClick={() => signOut()}>Sign out</button>
          : <a href="./">Sign in on the home page</a>}
      </nav>
    </Screen>
  );
}
