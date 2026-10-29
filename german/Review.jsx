// The card session: English on the front, German on the back, rated
// Again / Hard / Good / Easy (keys 1–4; space shows the answer, then
// counts as Good). Cards still in their learning steps come back within
// the session. Closing pauses: what's been rated is saved, and Start picks
// up the rest.
import { planSession, answerCard, makeCard, dayEnd, tasksFor, doneTasks, germanOf } from "./model.js";
import { previews, RATINGS } from "./fsrs.js";
import { speak } from "./audio.js";
import { go } from "./route.js";
import { Screen, ScreenHeader, IconButton, Button, ProgressBar, Noun, Spinner } from "./ui.jsx";

const { useState, useEffect, useMemo, useRef } = React;

// Spreads new cards between the reviews: one after every few reviews.
function interleave(reviews, fresh) {
  if (!fresh.length) return reviews;
  const every = Math.max(1, Math.floor(reviews.length / (fresh.length + 1)));
  const out = [];
  let f = 0;
  reviews.forEach((id, i) => {
    out.push(id);
    if ((i + 1) % every === 0 && f < fresh.length) out.push(fresh[f++]);
  });
  return [...out, ...fresh.slice(f)];
}

const LEARNING = new Set(["learning", "relearning"]);

// The next card: a learning card that's due again, else the next unseen
// one, else (learning ahead) the learning card due soonest.
function pickNext(ids, byId, shown, end, now) {
  const live = ids.map(id => byId.get(id)).filter(Boolean);
  const learning = live.filter(c => shown.has(c.id) && c.srs && LEARNING.has(c.srs.state) && c.srs.due < end).sort((a, b) => a.srs.due - b.srs.due);
  if (learning[0] && learning[0].srs.due <= now) return learning[0];
  return live.find(c => !shown.has(c.id)) || learning[0] || null;
}

// "the application (form)" → ["the application", "(form)"]
function splitEnglish(en) {
  const m = en.match(/^(.*?)\s*(\(.*\))$/);
  return m && m[1] ? [m[1], m[2]] : [en, null];
}

function Front({ card }) {
  if (card.kind === "gap") {
    return (
      <>
        <p className="g-q sentence">{card.text}</p>
        <p className="g-sub">{card.en}</p>
      </>
    );
  }
  if (card.kind === "rule") return <p className="g-q sentence">{card.en}</p>;
  const [main, note] = splitEnglish(card.en);
  return <p className="g-q">{main}{note && <small>{note}</small>}</p>;
}

function Back({ card }) {
  if (card.kind === "noun") {
    return (
      <>
        <p className="g-a"><Noun article={card.article}>{card.de}</Noun></p>
        {card.plural && <p className="g-sub">Plural: {card.plural}</p>}
      </>
    );
  }
  if (card.kind === "verb") {
    return (
      <>
        <p className="g-a">{card.de}</p>
        {(card.perfekt || card.separable) && (
          <p className="g-sub">{card.perfekt}{card.perfekt && card.separable && " · "}{card.separable && "separable"}</p>
        )}
      </>
    );
  }
  if (card.kind === "gap") {
    const [before, after] = card.text.split("___");
    return <p className="g-a sentence">{before}<span className="hl">{card.answer}</span>{after}</p>;
  }
  if (card.kind === "rule") {
    return (
      <>
        <p className="g-a sentence" style={{ fontSize: 22 }}>{card.de}</p>
        {card.examples?.length > 0 && (
          <ul className="g-rule-ex" aria-label="Your sentences">
            {card.examples.map(e => <li key={e}>{e}</li>)}
          </ul>
        )}
      </>
    );
  }
  return <p className="g-a">{card.de}</p>;
}

function PlayRow({ text, session, showToast }) {
  const [busy, setBusy] = useState(false);
  const play = () => {
    setBusy(true);
    speak(text, session)
      .catch(e => showToast(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="g-example">
      <IconButton icon="play" label="Play sentence" variant="mint" round busy={busy} onClick={play} iconSize={18} />
      <p>{text}</p>
    </div>
  );
}

const RATE = [
  ["again", "Again", "1"],
  ["hard", "Hard", "2"],
  ["good", "Good", "space"],
  ["easy", "Easy", "4"],
];

export function Review({ app }) {
  const { today } = app;
  const end = dayEnd(today);

  // The session's cards are fixed when it starts; AI suggestions needed to
  // fill today's new-card slots become cards now. With nothing to study
  // while suggested words are still on their way, it waits for them.
  const [start, setStart] = useState(null);
  const plan = planSession(app.cards, app.suggest, app.settings, today);
  const empty = !plan.reviews.length && !plan.fresh.length && !plan.fromSuggestions;
  useEffect(() => {
    if (start || (empty && app.refilling)) return;
    const made = app.suggest.slice(0, plan.fromSuggestions).map(s => makeCard(s, "ai"));
    setStart({ made, ids: interleave(plan.reviews, [...plan.fresh, ...made.map(c => c.id)]) });
    if (!made.length) return;
    const used = new Set(made.map(c => c.de));
    app.setCards(cs => [...cs, ...made]);
    app.setSuggest(s => s.filter(x => !used.has(x.de)));
  }, [start, empty, app.refilling]);
  const ids = start ? start.ids : [];
  const [shown, setShown] = useState(() => new Set());
  const [flipped, setFlipped] = useState(false);
  const [now, setNow] = useState(Date.now);
  const finishedRef = useRef(false);

  // Cards made from suggestions count before the deck update lands.
  const byId = useMemo(() => new Map([...(start ? start.made : []), ...app.cards].map(c => [c.id, c])), [app.cards, start]);
  const card = pickNext(ids, byId, shown, end, now);
  const done = ids.filter(id => {
    const c = byId.get(id);
    return !c || (c.srs && c.srs.due >= end);
  }).length;

  // Finished: log the task and move on to the next one.
  const finish = () => {
    finishedRef.current = true;
    app.markDone("cards");
    const writingLeft = tasksFor(today, app.settings).includes("writing") && !doneTasks(app.log, today).includes("writing");
    go(writingLeft ? "#/write" : "#/");
  };
  useEffect(() => {
    if (card || !ids.length || finishedRef.current) return;
    finish();
  }, [card, ids.length]);

  const rate = name => {
    if (!card) return;
    const t = Date.now();
    app.updateCard(card.id, c => answerCard(c, RATINGS[name], today, t));
    setShown(s => new Set(s).add(card.id));
    setFlipped(false);
    setNow(t);
  };

  const keys = useRef();
  keys.current = e => {
    if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!flipped && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      setFlipped(true);
      return;
    }
    if (!flipped) return;
    const name = { 1: "again", 2: "hard", 3: "good", 4: "easy", " ": "good", Enter: "good" }[e.key];
    if (name) {
      e.preventDefault();
      rate(name);
    }
  };
  useEffect(() => {
    const on = e => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (!start) {
    return (
      <Screen center label="Flashcards">
        <div className="g-stack" style={{ alignItems: "center", textAlign: "center", gap: 12 }}>
          <Spinner />
          <p className="g-muted">Getting new words ready…</p>
        </div>
      </Screen>
    );
  }
  // Nothing due and no new words (offline with an empty word stock, or a
  // new-card limit of 0).
  if (!ids.length) {
    return (
      <Screen label="Flashcards">
        <ScreenHeader close="#/" />
        <div className="g-stack" style={{ flex: 1, justifyContent: "center", alignItems: "center", textAlign: "center", gap: 12 }}>
          <p style={{ fontSize: 22, fontWeight: 800 }}>No cards to study</p>
          <p className="g-muted">{app.session ? "Nothing is due and there are no new words yet. Add a word, or try again in a minute." : "Nothing is due. Sign in on the home page to get suggested words."}</p>
        </div>
        <Button href="#/add" variant="mint">Add a word</Button>
      </Screen>
    );
  }
  if (!card) return <Screen />;

  const wait = previews(card.srs, now);
  const spoken = card.kind === "gap" ? germanOf(card) : card.example;

  return (
    <Screen label="Flashcards">
      <header className="g-head">
        <IconButton icon="close" label="Pause and go back" href="#/" />
        <ProgressBar value={done} max={ids.length} />
        <span className="g-count">{done}/{ids.length}</span>
      </header>

      <section className="g-flash" aria-label="Card" aria-live="polite">
        {flipped && (
          <div className="g-flash-top">
            <span>{card.en}</span>
            <IconButton icon="edit" label="Edit card" href={`#/card/${card.id}`} variant="ghost" iconSize={18} />
          </div>
        )}
        <div className="g-flash-mid">
          {flipped ? <Back card={card} /> : <Front card={card} />}
        </div>
        {flipped && spoken && <PlayRow key={spoken} text={spoken} session={app.session} showToast={app.showToast} />}
      </section>

      {flipped ? (
        <div className="g-grid4 g-rate">
          {RATE.map(([name, label, key]) => (
            <button key={name} type="button" className={name} onClick={() => rate(name)}>
              <b>{label}</b>
              <span>{wait[name]}<span className="g-keys"> · {key === "space" ? "space" : `key ${key}`}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="g-btn" style={{ minHeight: 68 }} onClick={() => setFlipped(true)}>Show answer</button>
      )}
    </Screen>
  );
}
