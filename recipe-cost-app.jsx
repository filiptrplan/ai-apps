import { useSession } from "./shared/auth.js";

const { useState, useEffect, useRef } = React;

const HISTORY_KEY = "recipe-cost:history";
const MAX_HISTORY = 20;
const STATUS_LABEL = { found: "Aldi price", estimated: "Estimate", pantry: "Pantry" };

const chf = (n) => `CHF ${n.toFixed(2)}`;

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable - history lasts for this visit only */
  }
}

// Streams NDJSON events from the server, calling onEvent for each line.
async function analyzeRecipe({ recipe, servings, token, signal, onEvent }) {
  const res = await fetch("/api/recipe-cost", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipe, servings }),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

function Summary({ breakdown }) {
  return (
    <dl className="stats">
      <div>
        <dt>Used in recipe</dt>
        <dd>{chf(breakdown.totalUsed)}</dd>
      </div>
      <div>
        <dt>Per serving</dt>
        <dd>{breakdown.perServing == null ? "–" : chf(breakdown.perServing)}</dd>
      </div>
      <div>
        <dt>Shopping bill</dt>
        <dd>{chf(breakdown.totalToBuy)}</dd>
      </div>
    </dl>
  );
}

function ItemRow({ item }) {
  const product =
    item.productName ?? (item.status === "pantry" ? "Assumed already at home" : "No product matched");
  return (
    <li className="item">
      <div className="item-main">
        <p className="item-name">
          {item.ingredient} <span className="muted">· {item.quantityNeeded}</span>
        </p>
        <p className="small muted">
          {item.productUrl ? (
            <a href={item.productUrl} target="_blank" rel="noopener noreferrer">
              {product}
            </a>
          ) : (
            product
          )}
          {item.packageSize && ` · ${item.packageSize}`}
          {item.status !== "pantry" && ` · ${chf(item.packagePrice)}`}
          {item.packagesToBuy > 1 && ` × ${item.packagesToBuy}`}
        </p>
        {item.note && <p className="small muted note">{item.note}</p>}
      </div>
      <div className="item-cost">
        <span className="cost">{item.status === "pantry" ? "–" : chf(item.costUsed)}</span>
        <span className={`badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </div>
    </li>
  );
}

function Breakdown({ breakdown }) {
  const estimated = breakdown.items.filter((i) => i.status === "estimated").length;
  return (
    <section className="card result">
      <div>
        <h2>{breakdown.title}</h2>
        {breakdown.servings && (
          <p className="small muted">
            {breakdown.servings} serving{breakdown.servings === 1 ? "" : "s"}
          </p>
        )}
      </div>
      <Summary breakdown={breakdown} />
      <p className="hint">
        <b>Used in recipe</b> counts only the part of each pack the recipe uses.{" "}
        <b>Shopping bill</b> is what you pay at the till buying whole packs.
        {estimated > 0 &&
          ` ${estimated} price${estimated === 1 ? " is an estimate" : "s are estimates"} - Aldi's site didn't show ${estimated === 1 ? "it" : "them"}.`}
      </p>
      <ul className="items">
        {breakdown.items.map((item, i) => (
          <ItemRow key={i} item={item} />
        ))}
      </ul>
      {breakdown.notes && <p className="small muted">{breakdown.notes}</p>}
    </section>
  );
}

function RecipeCostApp() {
  const session = useSession();
  const [recipe, setRecipe] = useState("");
  const [servings, setServings] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [selectedId, setSelectedId] = useState(() => loadHistory()[0]?.id ?? null);
  const abort = useRef(null);

  useEffect(() => () => abort.current?.abort(), []);

  const selected = history.find((h) => h.id === selectedId) ?? null;

  const run = async () => {
    const text = recipe.trim();
    if (!text || !session) return;
    const n = parseInt(servings, 10);
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    setLog([]);
    setSelectedId(null);
    try {
      let breakdown = null;
      await analyzeRecipe({
        recipe: text,
        servings: n > 0 ? n : null,
        token: session.access_token,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "status") setLog((l) => [...l, event.text]);
          else if (event.type === "error") throw new Error(event.error);
          else if (event.type === "result") breakdown = event.breakdown;
        },
      });
      if (!breakdown) throw new Error("The analysis ended without a result. Try again.");
      const entry = { id: Date.now().toString(36), date: new Date().toISOString(), recipe: text, breakdown };
      setHistory((h) => {
        const next = [entry, ...h].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
      setSelectedId(entry.id);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const cancel = () => abort.current?.abort();

  const remove = (id) => {
    setHistory((h) => {
      const next = h.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  };

  const reuse = (entry) => {
    setRecipe(entry.recipe);
    setServings(entry.breakdown.servings ? String(entry.breakdown.servings) : "");
    setSelectedId(entry.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main>
      <header>
        <h1>Recipe Cost</h1>
        <p className="muted">Paste a recipe to see what it costs at Aldi Suisse.</p>
      </header>

      {session === null && (
        <p className="card">
          <a href="./">Sign in on the home page</a> to use this app - each analysis uses paid AI
          credits.
        </p>
      )}

      <section className="card">
        <label className="field-label" htmlFor="recipe">
          Recipe
        </label>
        <textarea
          id="recipe"
          className="input"
          rows={10}
          placeholder={"Spaghetti Bolognese (serves 4)\n400 g spaghetti\n500 g minced beef\n1 onion\n2 cloves garlic\n400 g chopped tomatoes\n…"}
          value={recipe}
          onChange={(e) => setRecipe(e.target.value)}
          disabled={busy}
        />
        <div className="row">
          <div>
            <label className="field-label" htmlFor="servings">
              Servings
            </label>
            <input
              id="servings"
              className="input narrow"
              type="number"
              inputMode="numeric"
              min="1"
              max="100"
              placeholder="As written"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              disabled={busy}
            />
          </div>
          {busy ? (
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button className="btn primary" onClick={run} disabled={!recipe.trim() || !session}>
              Analyze
            </button>
          )}
        </div>
        <p className="hint">Takes a minute or two - it looks up every ingredient on aldi-suisse.ch.</p>
      </section>

      {(busy || error) && (
        <section className="card log" aria-live="polite">
          {log.map((line, i) => (
            <p key={i} className={busy && i === log.length - 1 ? "current" : "muted"}>
              {line}
            </p>
          ))}
          {busy && log.length === 0 && <p className="current">Starting…</p>}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {selected && <Breakdown breakdown={selected.breakdown} />}

      {history.length > 0 && (
        <section className="card">
          <p className="field-label">Past recipes</p>
          <ul className="history">
            {history.map((entry) => (
              <li key={entry.id} className={entry.id === selectedId ? "active" : ""}>
                <button className="link" onClick={() => setSelectedId(entry.id)}>
                  <span>{entry.breakdown.title}</span>
                  <span className="small muted">
                    {new Date(entry.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {" · "}
                    {chf(entry.breakdown.totalUsed)}
                  </span>
                </button>
                <button className="small-btn" onClick={() => reuse(entry)} disabled={busy}>
                  Edit
                </button>
                <button className="small-btn" onClick={() => remove(entry.id)} aria-label="Delete">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="small muted">
        Prices come from aldi-suisse.ch via AI web search and can be off - check the links.{" "}
        <a href="./">All apps</a>
      </footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<RecipeCostApp />);
