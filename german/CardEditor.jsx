// Add word and Edit card. Adding: type German or English and tap the wand;
// the AI fills in article, plural, English and an example (or offers 2–3
// translations to pick from for an ambiguous English word). Everything
// stays editable, and the example can be regenerated.
import { germanOf } from "./model.js";
import { fillWord, newExample } from "./ai.js";
import { Screen, ScreenHeader, IconButton, Button, Card, Field, Input, TextArea, ArticlePicker, Choice, Chip, Noun, LinkButton } from "./ui.jsx";

const { useState } = React;

const BLANK = { kind: "noun", de: "", article: "der", plural: "", perfekt: "", separable: false, en: "", example: "", text: "", answer: "", examples: [] };

function fieldsOf(card) {
  return { ...BLANK, ...card, examples: card.examples || [] };
}

function back() {
  if (history.length > 1) history.back();
  else location.hash = "/";
}

// Strips what doesn't belong to the kind before saving.
function cleanFields(f) {
  const out = { kind: f.kind, de: f.de, en: f.en, example: f.example };
  if (f.kind === "noun") Object.assign(out, { article: f.article, plural: f.plural });
  if (f.kind === "verb") Object.assign(out, { perfekt: f.perfekt, separable: f.separable });
  if (f.kind === "gap") Object.assign(out, { text: f.text, answer: f.answer, point: f.point });
  if (f.kind === "rule") Object.assign(out, { point: f.point, examples: f.examples });
  return out;
}

function Options({ options, onPick }) {
  return (
    <section aria-label="Which meaning?" className="g-stack">
      <span className="g-label">Which one do you mean?</span>
      {options.map((o, i) => (
        <button key={i} type="button" className="g-option" onClick={() => onPick(o)}>
          <b>{o.kind === "noun" ? <Noun article={o.article}>{o.de}</Noun> : o.de}</b>
          <span>{o.sense || o.en}</span>
        </button>
      ))}
    </section>
  );
}

function Form({ f, set, onExample, exampleBusy, editing }) {
  return (
    <>
      {f.kind === "noun" && <ArticlePicker value={f.article} onChange={v => set({ article: v })} />}
      {editing && (f.kind === "noun" || f.kind === "verb" || f.kind === "word") && (
        <Field id="de" label="German"><Input id="de" value={f.de} onChange={v => set({ de: v })} /></Field>
      )}
      {f.kind === "gap" && (
        <>
          <Field id="text" label="Sentence (___ marks the gap)"><Input id="text" value={f.text} onChange={v => set({ text: v })} /></Field>
          <Field id="answer" label="Answer"><Input id="answer" value={f.answer} onChange={v => set({ answer: v })} /></Field>
        </>
      )}
      {f.kind === "rule" && (
        <>
          <Field id="en" label="Question"><TextArea id="en" value={f.en} onChange={v => set({ en: v })} /></Field>
          <Field id="de" label="Rule"><TextArea id="de" value={f.de} onChange={v => set({ de: v })} /></Field>
          <Field id="examples" label="Your sentences, one per line">
            <TextArea id="examples" rows={3} value={f.examples.join("\n")} onChange={v => set({ examples: v.split("\n") })} />
          </Field>
        </>
      )}
      {f.kind !== "rule" && (
        <div className="g-grid2">
          {f.kind === "noun" && <Field id="plural" label="Plural"><Input id="plural" value={f.plural} onChange={v => set({ plural: v })} /></Field>}
          {f.kind === "verb" && <Field id="perfekt" label="Perfekt"><Input id="perfekt" value={f.perfekt} placeholder="hat gemacht" onChange={v => set({ perfekt: v })} /></Field>}
          <div className="g-field" style={f.kind === "noun" || f.kind === "verb" ? null : { gridColumn: "1 / -1" }}>
            <label htmlFor="english">English</label>
            <Input id="english" value={f.en} onChange={v => set({ en: v })} />
          </div>
        </div>
      )}
      {f.kind === "verb" && (
        <div><Chip pressed={f.separable} onClick={() => set({ separable: !f.separable })}>Separable verb</Chip></div>
      )}
      {(f.kind === "noun" || f.kind === "verb" || f.kind === "word") && (
        <Field
          id="example"
          label="Example"
          right={<IconButton icon="refresh" label="New example" variant="ghost" small iconSize={16} busy={exampleBusy} onClick={onExample} />}
        >
          <TextArea id="example" value={f.example} onChange={v => set({ example: v })} />
        </Field>
      )}
    </>
  );
}

export function CardEditor({ app, cardId }) {
  const existing = cardId ? app.cards.find(c => c.id === cardId) : null;
  const editing = !!cardId;
  const [input, setInput] = useState("");
  const [f, setF] = useState(() => (existing ? fieldsOf(existing) : BLANK));
  // "empty" (nothing yet), "choose" (pick a translation) or "form".
  const [stage, setStage] = useState(editing ? "form" : "empty");
  const [options, setOptions] = useState([]);
  // True once the AI filled the form (hides the kind picker).
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = patch => setF(prev => ({ ...prev, ...patch }));

  if (editing && !existing) {
    return (
      <Screen>
        <ScreenHeader back="#/deck" title="Card" big />
        <p className="g-empty">This card was deleted.</p>
      </Screen>
    );
  }

  const fill = () => {
    const word = input.trim();
    if (!word) return;
    if (!app.session) {
      setError("Sign in on the home page to fill in words — or fill them in by hand.");
      return;
    }
    setBusy("fill");
    setError(null);
    fillWord(word, app.settings)
      .then(opts => {
        if (opts.length === 1) {
          pick(opts[0]);
        } else {
          setOptions(opts);
          setStage("choose");
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setBusy(null));
  };

  // Takes an AI option; the big field then shows the German word.
  const pick = o => {
    setF({ ...BLANK, ...o });
    setInput(o.de);
    setFilled(true);
    setStage("form");
  };

  const regenerate = () => {
    if (!app.session) return setError("Sign in on the home page to get a new example.");
    setBusy("example");
    setError(null);
    newExample(editing ? f : { ...f, de: input.trim() }, app.settings)
      .then(example => set({ example }))
      .catch(e => setError(e.message))
      .finally(() => setBusy(null));
  };

  const byHand = () => {
    setF(BLANK);
    setFilled(false);
    setStage("form");
  };

  // While adding, the German word is whatever is in the big field.
  const current = editing ? f : { ...f, de: input };
  const canSave = current.kind === "gap" ? current.text.includes("___") && current.answer.trim() : current.de.trim() && current.en.trim();

  const save = () => {
    const fields = cleanFields(current);
    if (editing) {
      app.updateCard(existing.id, c => ({ ...c, ...fields, examples: fields.examples?.map(x => x.trim()).filter(Boolean) ?? c.examples }));
      app.showToast("Card saved");
      back();
      return;
    }
    const { card, duplicate } = app.addCard(fields, "own");
    app.showToast(duplicate ? `${germanOf(card)} is already in your deck` : `Added ${germanOf(card)}`);
    if (duplicate) location.hash = `/card/${card.id}`;
    else back();
  };

  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true);
    app.deleteCard(existing.id);
    app.showToast("Card deleted");
    back();
  };

  return (
    <Screen label={editing ? "Edit card" : "Add word"}>
      <header className="g-head">
        <IconButton icon="close" label="Close" onClick={back} />
        <h1 style={{ fontSize: 20 }}>{editing ? "Edit card" : "Add word"}</h1>
        {editing && (
          <div className="g-head-right">
            <Button size="sm" variant="outline" className={confirmDelete ? "danger" : undefined} onClick={remove}>{confirmDelete ? "Delete?" : "Delete"}</Button>
          </div>
        )}
      </header>

      {!editing && (
        <div className="g-stack" style={{ gap: 6 }}>
          <label htmlFor="word" className="g-label">German or English</label>
          <form className="g-bigfield" onSubmit={e => { e.preventDefault(); fill(); }}>
            <input id="word" value={input} autoFocus autoComplete="off" autoCapitalize="off" spellCheck="false" onChange={e => setInput(e.target.value)} />
            <IconButton icon="wand" label="Fill in details" variant="wand" busy={busy === "fill"} disabled={!input.trim()} onClick={fill} />
          </form>
        </div>
      )}

      {error && <p className="g-error" role="alert">{error}</p>}

      {stage === "empty" && (
        <div className="g-stack" style={{ alignItems: "flex-start" }}>
          <p className="g-muted" style={{ padding: "0 4px" }}>Type a word and tap the wand: article, plural, English and an example get filled in.</p>
          <LinkButton mint onClick={byHand}>Fill in by hand</LinkButton>
        </div>
      )}

      {stage === "choose" && <Options options={options} onPick={pick} />}

      {stage === "form" && (
        <Card label="Card details">
          {!editing && (filled
            ? <span className="g-small" style={{ fontWeight: 700, color: "var(--mint)" }}>Filled in — check and save</span>
            : <Choice label="Kind of word" value={f.kind} onChange={kind => set({ kind })} options={[["noun", "Noun"], ["verb", "Verb"], ["word", "Other"]]} />)}
          <Form f={f} set={set} onExample={regenerate} exampleBusy={busy === "example"} editing={editing} />
        </Card>
      )}

      {stage === "form" && (
        <div className="g-push">
          <Button variant="mint" disabled={!canSave} onClick={save}>{editing ? "Save" : "Save card"}</Button>
        </div>
      )}
    </Screen>
  );
}
