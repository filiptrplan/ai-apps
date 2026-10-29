// The writing task: a prompt at your level (or your own topic) with one
// grammar focus, 3–5 sentences, one AI check. The check shows the
// corrected text with a short reason per fix, saves the session to the
// writing history and turns the fixes into cards.
import { nextFocus, sentenceCount, cardsFromCheck, tasksFor, uid } from "./model.js";
import { pointById } from "./grammar.js";
import { writingPrompt, checkWriting } from "./ai.js";
import { go } from "./route.js";
import { Screen, ScreenHeader, Button, LinkButton, Card, Label, Tag, Spinner } from "./ui.jsx";

const { useState, useEffect, useRef } = React;

// Used when the AI can't be reached.
const OFFLINE_PROMPTS = [
  "Was hast du am Wochenende gemacht?",
  "Wie war dein Tag heute?",
  "Was hast du gestern gegessen?",
  "Was machst du morgen nach der Uni?",
  "Beschreib deinen Weg zur Uni.",
  "Was hast du letzte Woche Neues gelernt?",
];

const quote = p => (/^[„"]/.test(p) ? p : `„${p}“`);

// Wraps each fix's corrected words in the corrected text, in order.
function Marked({ text, fixes, focus }) {
  const parts = [];
  let rest = text;
  let key = 0;
  for (const f of fixes) {
    const i = f.to ? rest.indexOf(f.to) : -1;
    if (i < 0) continue;
    parts.push(rest.slice(0, i));
    parts.push(<mark key={key++} className={f.point === focus ? "focus" : undefined}>{f.to}</mark>);
    rest = rest.slice(i + f.to.length);
  }
  parts.push(rest);
  return <>{parts}</>;
}

// Umlaut keys for desktop keyboards without them. Clicking types the
// letter at the cursor of the last focused field; holding Shift (or
// Caps Lock) gives the capitals. Hidden on touch screens.
const UMLAUTS = ["ä", "ö", "ü", "ß"];

function UmlautKeys({ onType }) {
  const [upper, setUpper] = useState(false);
  useEffect(() => {
    const sync = e => setUpper(e.getModifierState("Shift") !== e.getModifierState("CapsLock"));
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
    };
  }, []);
  return (
    <div className="g-umlauts" role="group" aria-label="Type umlauts">
      {UMLAUTS.map(ch => {
        const out = upper && ch !== "ß" ? ch.toUpperCase() : ch;
        return (
          <button key={ch} type="button" tabIndex={-1} title={`Type ${out}`}
            onMouseDown={e => e.preventDefault()}
            onClick={e => onType(e.shiftKey && ch !== "ß" ? ch.toUpperCase() : out)}>
            {out}
          </button>
        );
      })}
    </div>
  );
}

export function Feedback({ session, onFinish }) {
  const n = session.fixes.length;
  const title = n ? `${session.verdict} — ${n} ${n === 1 ? "fix" : "fixes"}` : `${session.verdict} — no fixes`;
  return (
    <>
      <h2 style={{ fontSize: 18, fontWeight: 800 }}>{title}</h2>
      <section className="g-corrected" aria-label="Your text, corrected">
        <Marked text={session.corrected} fixes={session.fixes} focus={session.focus} />
      </section>
      {n > 0 && (
        <ul className="g-fixes" aria-label="Why">
          {session.fixes.map((f, i) => (
            <li key={i} className={f.point === session.focus ? "focus" : undefined}>
              {f.from && <><s>{f.from}</s> → </>}<span className="to">{f.to}</span>
              <br />{f.why}
            </li>
          ))}
        </ul>
      )}
      {session.made?.length > 0 && (
        <div className="g-stack">
          <Label>These become cards</Label>
          <ul className="g-made">
            {session.made.map(m => (
              <li key={m.id + m.type} className={m.type}>
                <Tag tone={m.type === "rule" ? "amber" : undefined}>{m.type === "rule" ? "Rule" : "Gap"}</Tag>
                <span>{m.label}{m.repeat && <span className="g-small"> · example added, card reset</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {onFinish && <div className="g-push"><Button variant="mint" onClick={onFinish}>Finish</Button></div>}
    </>
  );
}

export function Write({ app }) {
  const { today, settings, writing } = app;
  const draft = app.draft && app.draft.day === today ? app.draft : null;
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const answerRef = useRef(null);
  const topicRef = useRef(null);
  const lastField = useRef("text");

  const setDraft = patch => app.setDraft(d => ({ ...d, ...patch }));

  const fetchPrompt = () => {
    const recent = writing.map(s => s.prompt);
    if (!app.session || !navigator.onLine) {
      const pick = OFFLINE_PROMPTS.find(p => !recent.slice(0, 5).includes(p)) || OFFLINE_PROMPTS[0];
      setDraft({ prompt: pick });
      return;
    }
    setBusy("prompt");
    setError(null);
    writingPrompt(app.draft.focus, recent, settings)
      .then(prompt => setDraft({ prompt }))
      .catch(e => {
        setError(e.message);
        setDraft({ prompt: OFFLINE_PROMPTS[Math.floor(Math.random() * OFFLINE_PROMPTS.length)] });
      })
      .finally(() => setBusy(null));
  };

  // A new day's task: pick the focus, then get a prompt.
  useEffect(() => {
    if (!draft) {
      app.setDraft({ day: today, focus: nextFocus(writing, settings.level), prompt: null, own: false, topic: "", text: "", sessionId: null });
    } else if (!draft.prompt && !draft.own && busy !== "prompt") {
      fetchPrompt();
    }
  }, [draft?.day, draft?.prompt, draft?.own]);

  if (!draft) return <Screen center><Spinner /></Screen>;

  const point = pointById(draft.focus);
  const checked = draft.sessionId && writing.find(s => s.id === draft.sessionId);
  const tasks = tasksFor(today, settings);
  const meta = tasks.includes("writing") && tasks.length > 1 ? `Task ${tasks.indexOf("writing") + 1} of ${tasks.length}` : null;
  const count = sentenceCount(draft.text);
  const prompt = draft.own ? `Own topic: ${draft.topic.trim() || "…"}` : draft.prompt;

  // Types `ch` over the selection in the last focused field. insertText
  // goes through the browser's own typing path, so React's onChange runs
  // and Ctrl+Z still undoes it.
  const typeChar = ch => {
    const el = (lastField.current === "topic" && draft.own ? topicRef : answerRef).current;
    if (!el) return;
    el.focus();
    if (document.execCommand("insertText", false, ch)) return;
    el.setRangeText(ch, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const check = () => {
    if (!app.session) return setError("Sign in on the home page to check your German.");
    setBusy("check");
    setError(null);
    checkWriting({ text: draft.text.trim(), prompt, focus: draft.focus }, settings)
      .then(result => {
        const session = {
          id: uid(), day: today, at: Date.now(), prompt, own: draft.own, focus: draft.focus,
          text: draft.text.trim(), corrected: result.corrected, verdict: result.verdict, fixes: result.fixes,
        };
        session.made = cardsFromCheck(app.cards, session).made;
        app.setCards(cs => cardsFromCheck(cs, session).cards);
        app.setWriting(ws => [session, ...ws]);
        setDraft({ sessionId: session.id });
        app.markDone("writing");
      })
      .catch(e => setError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <Screen wide label="Writing">
      <ScreenHeader close="#/" title="Writing" meta={meta} />

      <div className="g-write-cols">
        <section className={checked ? "g-hide-mobile" : undefined}>
          <Card>
            {draft.own ? (
              <div className="g-field">
                <label htmlFor="topic">Your topic</label>
                <input id="topic" ref={topicRef} onFocus={() => (lastField.current = "topic")} className="g-input" style={{ fontSize: 18, fontWeight: 700 }} placeholder="z. B. meine Vorlesung heute" value={draft.topic} disabled={!!checked} onChange={e => setDraft({ topic: e.target.value })} />
              </div>
            ) : (
              <p className="g-prompt">{draft.prompt ? quote(draft.prompt) : <Spinner />}</p>
            )}
            {point && (
              <div className="g-hint">{point.hint}<br /><i>{point.model}</i></div>
            )}
            {!checked && (
              <div className="g-row" style={{ gap: 16 }}>
                {!draft.own && <LinkButton onClick={fetchPrompt}>{busy === "prompt" ? "Getting a prompt…" : "New prompt"}</LinkButton>}
                <LinkButton onClick={() => setDraft({ own: !draft.own })}>{draft.own ? "Use a prompt instead" : "Write about my own topic"}</LinkButton>
              </div>
            )}
          </Card>

          <label htmlFor="answer" className="g-label">Your sentences</label>
          <textarea id="answer" ref={answerRef} onFocus={() => (lastField.current = "text")} className="g-write" lang="de" spellCheck="false" value={checked ? checked.text : draft.text} readOnly={!!checked} onChange={e => setDraft({ text: e.target.value })} />
          <div className="g-between">
            <span className="g-small" style={{ fontSize: 13, padding: "0 4px" }}>
              {checked ? `${sentenceCount(checked.text)} sentences · checked` : `${count} ${count === 1 ? "sentence" : "sentences"} · aim for 3–5`}
            </span>
            {!checked && <UmlautKeys onType={typeChar} />}
          </div>
          {error && <p className="g-error" role="alert">{error}</p>}
          {!checked && (
            <Button variant="amber" busy={busy === "check"} disabled={!draft.text.trim() || (draft.own && !draft.topic.trim())} onClick={check}>
              {busy === "check" ? "Checking…" : "Check my German"}
            </Button>
          )}
        </section>

        {checked && (
          <section aria-label="Feedback">
            <Feedback session={checked} onFinish={() => go("#/")} />
          </section>
        )}
      </div>
    </Screen>
  );
}
