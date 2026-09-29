import { useSyncedStorage } from "../shared/syncStorage.js";
import { useSession } from "../shared/auth.js";
import { supabase } from "../shared/supabaseClient.js";
import { runDailyBackupIfNeeded } from "../shared/backup.js";
import { callAI } from "../shared/ai.js";
import { CATEGORY_ORDER, amountLabel, buildList, formatAmount, listToText } from "./aggregate.js";
import { runEstimate, estimateKey, priceTotals, chf, priceDetail, monthLabel } from "../shared/prices.js";

const { useState, useEffect, useMemo, useRef } = React;

const APP_ID = "shopping-list";

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newRecipe() {
  return { id: newId(), text: "" };
}

// Shown in turn while the AI call runs; stays on the last one if it's slow.
const BUILD_STEPS = ["Reading recipes…", "Matching ingredients…", "Adding up amounts…", "Sorting by aisle…"];

function BuildingList() {
  const [step, setStep] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t = setInterval(() => setStep((s) => Math.min(s + 1, BUILD_STEPS.length - 1)), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="sl-loading" role="status" aria-live="polite" ref={ref}>
      <div className="sl-loading-head">
        <span className="sl-spinner" aria-hidden="true" />
        <span className="sl-loading-text" key={step}>{BUILD_STEPS[step]}</span>
      </div>
      <div className="sl-skeleton" aria-hidden="true">
        {[62, 40, 54, 32, 48].map((w, i) => (
          <div className="sl-skel-row" key={i} style={{ animationDelay: `${i * 0.12}s` }}>
            <span className="sl-skel-box" />
            <span className="sl-skel-line" style={{ width: `${w}%` }} />
            <span className="sl-skel-amt" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Free-text row for adding your own items to the list.
function AddItem({ onAdd }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ id: newId(), name: name.trim(), amount: amount.trim(), category });
    setName("");
    setAmount("");
    setCategory("Other");
  };
  return (
    <form className="sl-add" onSubmit={submit}>
      <div className="sl-add-row">
        <input className="sl-add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an item, e.g. paper towels" aria-label="Item" />
        <input className="sl-add-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount (optional)" />
      </div>
      <div className="sl-add-row">
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Aisle">
          {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="submit" className="sl-add-btn" disabled={!name.trim()}>Add</button>
      </div>
    </form>
  );
}

// What the unticked items cost at Aldi Suisse, from an estimate kept by
// the app (see shared/prices.js).
function PricePanel({ est, stale, onRefresh, onClose }) {
  if (est.loading) {
    return (
      <div className="sl-price" role="status" aria-live="polite">
        <div className="sl-loading-head">
          <span className="sl-spinner" aria-hidden="true" />
          <span>Looking up Aldi prices…</span>
        </div>
      </div>
    );
  }
  if (est.error) {
    return (
      <div className="sl-price">
        <p className="sl-error">{est.error}</p>
        <div className="sl-price-actions">
          <button className="sl-link" onClick={onRefresh}>Try again</button>
          <button className="sl-link" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }
  const byId = new Map(est.result.items.map((i) => [i.id, i]));
  const t = priceTotals(est.result);
  return (
    <div className="sl-price">
      <div className="sl-price-total">
        <span>At Aldi Suisse</span>
        <strong>{chf(t.buy)}</strong>
      </div>
      {t.missing > 0 && (
        <p className="sl-note">
          {t.missing === 1 ? "1 item has" : `${t.missing} items have`} no price and {t.missing === 1 ? "isn't" : "aren't"} counted.
        </p>
      )}
      {stale && (
        <p className="sl-price-stale">
          The list changed. <button className="sl-link" onClick={onRefresh}>Recalculate</button>
        </p>
      )}
      <ul>
        {est.items.map((row) => {
          const p = byId.get(row.id) || { source: "none" };
          return (
            <li key={row.id} className={p.source === "none" ? "none" : ""}>
              <span className="sl-price-main">
                <span className="sl-item-top">
                  <span className="sl-name">{row.name}</span>
                  {row.q && <span className="sl-price-q">{row.q}</span>}
                </span>
                <span className="sl-sub">
                  {p.source === "aldi" && <>{p.product}{p.size ? ` · ${p.size}` : ""} · {priceDetail(p)}</>}
                  {p.source === "produce" && (
                    <>
                      <span className="sl-price-tag">Swiss avg.</span>
                      {p.product} · {priceDetail(p)}
                    </>
                  )}
                  {p.source === "none" && "No price found"}
                </span>
                {p.note && <span className="sl-sub">{p.note}</span>}
              </span>
              {p.source !== "none" && <span className="sl-amount">{chf(p.buy)}</span>}
            </li>
          );
        })}
      </ul>
      <p className="sl-note">
        Prices from aldi-suisse.ch.
        {t.produce && ` Swiss avg.: fresh produce, Swiss retail average ${monthLabel(est.result.produceMonth)} (BLW), as Aldi doesn't list it online.`}
      </p>
      <div className="sl-price-actions">
        {!stale && <button className="sl-link" onClick={onRefresh}>Refresh</button>}
        <button className="sl-link" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function useStorage(key, fallback) {
  return useSyncedStorage(APP_ID, key, fallback);
}

export function ShoppingListApp() {
  const session = useSession();
  const [recipes, setRecipes] = useStorage("shopping-list-recipes", [newRecipe()]);
  // The raw API result; the combined list is derived from it on render.
  const [result, setResult] = useStorage("shopping-list-result", null);
  // Items added by hand; they survive rebuilding from recipes.
  const [extras, setExtras] = useStorage("shopping-list-extras", []);
  const [checked, setChecked] = useStorage("shopping-list-checked", {});
  const [tab, setTab] = useState(result || extras.length ? "list" : "recipes");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // Price estimate for the unticked items, kept while the app is open.
  const [price, setPrice] = useState(null);

  useEffect(() => {
    if (session) runDailyBackupIfNeeded(supabase, session);
  }, [session]);

  const groups = useMemo(() => buildList(result, extras), [result, extras]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = groups.reduce((n, g) => n + g.items.filter((it) => checked[it.key]).length, 0);
  const filled = recipes.filter((r) => r.text.trim());
  // What's still to get, as sent for a price estimate.
  const priceItems = groups.flatMap((g) => g.items).filter((it) => !checked[it.key]).map((it) => ({ id: it.key, q: amountLabel(it) || "", name: it.name }));
  const estimate = () => runEstimate(priceItems, setPrice);

  const updateRecipe = (id, text) => setRecipes(recipes.map((r) => (r.id === id ? { ...r, text } : r)));
  const removeRecipe = (id) => {
    const rest = recipes.filter((r) => r.id !== id);
    setRecipes(rest.length ? rest : [newRecipe()]);
  };

  async function build() {
    setLoading(true);
    setError("");
    try {
      const data = await callAI("shopping-list", { recipes: filled.map((r) => r.text) });
      setResult(data);
      // Keep ticks on hand-added items; recipe items are all new.
      setChecked((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k.startsWith("extra:"))));
      setTab("list");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(listToText(groups, checked));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  const addExtra = (item) => setExtras((prev) => [...prev, item]);
  const removeExtra = (id) => {
    setExtras((prev) => prev.filter((x) => x.id !== id));
    setChecked((prev) => {
      const next = { ...prev };
      delete next[`extra:${id}`];
      return next;
    });
  };

  // First tap arms the button, second tap within a few seconds clears.
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  function clearList() {
    if (!confirmClear) return setConfirmClear(true);
    setResult(null);
    setExtras([]);
    setChecked({});
    setConfirmClear(false);
  }

  const toggle = (key) => {
    const next = { ...checked };
    if (next[key]) delete next[key];
    else next[key] = true;
    setChecked(next);
  };

  return (
    <div className="sl">
      <header className="sl-header">
        <a className="sl-back" href="./" aria-label="All apps">‹</a>
        <h1>Shopping List</h1>
      </header>

      <nav className="sl-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "recipes"} className={tab === "recipes" ? "on" : ""} onClick={() => setTab("recipes")}>
          Recipes{filled.length ? ` (${filled.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "list"} className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>
          List{total ? ` (${total - done})` : ""}
        </button>
      </nav>

      {tab === "recipes" && (
        <main className="sl-main">
          <p className="sl-hint">
            Paste each recipe (or just its ingredient list) into its own box. The AI merges them into one list, adding up
            matching ingredients and sorting them by aisle.
          </p>
          {recipes.map((r, i) => (
            <div className="sl-recipe" key={r.id}>
              <div className="sl-recipe-head">
                <span>Recipe {i + 1}</span>
                {(recipes.length > 1 || r.text) && (
                  <button className="sl-link" onClick={() => removeRecipe(r.id)}>Remove</button>
                )}
              </div>
              <textarea
                value={r.text}
                onChange={(e) => updateRecipe(r.id, e.target.value)}
                placeholder={"Chicken curry\n200 g chicken breast\n1 onion\n2 cloves garlic\n…"}
                rows={7}
              />
            </div>
          ))}
          <button className="sl-secondary" onClick={() => setRecipes([...recipes, newRecipe()])}>+ Add another recipe</button>

          {error && <p className="sl-error">{error}</p>}
          {session === null && (
            <p className="sl-note">
              <a href="./">Sign in on the home page</a> to build lists with AI.
            </p>
          )}
          <button className="sl-primary" disabled={!session || loading || filled.length === 0} onClick={build}>
            {loading ? (
              <span className="sl-busy"><span className="sl-spinner sl-spinner-sm" aria-hidden="true" />Building…</span>
            ) : result ? "Rebuild shopping list" : "Build shopping list"}
          </button>
          {loading && <BuildingList />}
          {result && !loading && (
            <p className="sl-note">Rebuilding replaces the recipe items and their ticks. Items you added yourself stay.</p>
          )}
        </main>
      )}

      {tab === "list" && (
        <main className="sl-main">
          {total === 0 ? (
            <>
              <div className="sl-empty">
                <p>No list yet. Build one from recipes, or add items yourself below.</p>
                <button className="sl-primary" onClick={() => setTab("recipes")}>Add recipes</button>
              </div>
              <AddItem onAdd={addExtra} />
            </>
          ) : (
            <>
              <div className="sl-toolbar">
                <span className="sl-progress">{done} of {total} in the basket</span>
                <button className="sl-link" onClick={copyList}>{copied ? "Copied" : "Copy"}</button>
                {!price && priceItems.length > 0 && (
                  <button
                    className="sl-link"
                    disabled={!session}
                    title={session ? undefined : "Sign in on the home page to estimate prices"}
                    onClick={estimate}
                  >
                    Estimate cost
                  </button>
                )}
                {done > 0 && <button className="sl-link" onClick={() => setChecked({})}>Untick all</button>}
                <button className={`sl-link sl-danger${confirmClear ? " armed" : ""}`} onClick={clearList}>
                  {confirmClear ? "Tap to confirm" : "Clear list"}
                </button>
              </div>
              {price && (
                <PricePanel
                  est={price}
                  stale={!price.loading && price.key !== estimateKey(priceItems)}
                  onRefresh={estimate}
                  onClose={() => setPrice(() => null)}
                />
              )}
              <AddItem onAdd={addExtra} />
              {result?.recipes.length > 0 && (
                <p className="sl-from">From: {result.recipes.map((r) => r.title).join(" · ")}</p>
              )}
              {groups.map(({ category, items }) => {
                const sorted = [...items].sort((a, b) => !!checked[a.key] - !!checked[b.key]);
                return (
                  <section className="sl-group" key={category}>
                    <h2>{category}</h2>
                    <ul>
                      {sorted.map((it) => (
                        <li key={it.key} className={checked[it.key] ? "done" : ""}>
                          <label>
                            <input type="checkbox" checked={!!checked[it.key]} onChange={() => toggle(it.key)} />
                            <span className="sl-item">
                              <span className="sl-item-top">
                                <span className="sl-name">{it.name}</span>
                                <span className="sl-amount">{amountLabel(it)}</span>
                              </span>
                              {(it.notes.length > 0 || it.sources.length > 1) && (
                                <span className="sl-sub">
                                  {[
                                    ...it.notes,
                                    ...(it.sources.length > 1
                                      ? [it.sources.map((s) => `${s.title}: ${s.amounts.map(formatAmount).join(" + ")}`).join(" · ")]
                                      : []),
                                  ].join(" — ")}
                                </span>
                              )}
                            </span>
                          </label>
                          {it.extraId && (
                            <button className="sl-remove" onClick={() => removeExtra(it.extraId)} aria-label={`Remove ${it.name}`}>×</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}
        </main>
      )}
    </div>
  );
}
