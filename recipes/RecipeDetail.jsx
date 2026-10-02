import { scaleQty, stepMin, fmtClock, allIngs } from "./format.js";
import { Tags } from "./Notebook.jsx";
import { Photo } from "./Photo.jsx";
import { runEstimate, estimateKey } from "../shared/prices.js";
import { PriceBreakdown, TierPicker } from "./Prices.jsx";

// Per-step timer: closed -> setting (pick minutes) -> active (running,
// paused or done). Timers live in the app so they keep running when you
// leave the recipe.
function StepTimer({ tm, detected, open, update, close }) {
  if (!tm) {
    return (
      <button className="ra-timer-open" onClick={open}>
        {detected ? `Timer · ${detected} min` : "+ Timer"}
      </button>
    );
  }
  if (!tm.started) {
    return (
      <div className="ra-timer-set">
        <button onClick={() => update((o) => ({ ...o, dur: Math.max(60, o.dur - 60) }))} aria-label="One minute less">−</button>
        <span>{Math.round(tm.dur / 60)} min</span>
        <button onClick={() => update((o) => ({ ...o, dur: o.dur + 60 }))} aria-label="One minute more">+</button>
        <button
          className="start"
          onClick={() => update((o) => ({ ...o, started: true, running: true, endAt: Date.now() + o.dur * 1000, left: o.dur }))}
        >
          Start
        </button>
        <button className="close" onClick={close} aria-label="Close timer">✕</button>
      </div>
    );
  }
  const left = tm.running ? (tm.endAt - Date.now()) / 1000 : tm.left;
  const progress = Math.min(100, 100 - (left / tm.dur) * 100);
  const pause = () =>
    update((o) =>
      o.done
        ? { ...o, done: false, running: true, endAt: Date.now() + o.dur * 1000, left: o.dur }
        : o.running
          ? { ...o, running: false, left: Math.max(0, (o.endAt - Date.now()) / 1000) }
          : { ...o, running: true, endAt: Date.now() + o.left * 1000 }
    );
  return (
    <div className={`ra-timer-run${tm.done ? " done" : ""}`}>
      <span className="ra-timer-bar" style={{ width: `${progress}%` }} />
      <span className="ra-timer-clock">{tm.done ? "Time's up" : fmtClock(left)}</span>
      <button className="pause" onClick={pause}>{tm.done ? "Restart" : tm.running ? "Pause" : "Resume"}</button>
      <button className="reset" onClick={() => update((o) => ({ dur: o.dur, label: o.label }))}>Reset</button>
    </div>
  );
}

export function RecipeDetail({ recipe, session, list, servings, setServings, timers, setTimer, price, setPrice, tier, setTier, onBack, onEdit, addToList }) {
  const sv = servings ?? recipe.serves;
  const k = sv > 0 ? sv / recipe.serves : 1;
  // Which of this recipe's ingredients are on the list, even when they've
  // been combined with the same ingredient from another recipe.
  const have = new Set(list.items.filter((i) => !i.checked).flatMap((i) => i.src || []));
  const src = (g) => `${recipe.id}:${g.id}`;
  const toAdd = (g) => ({ q: scaleQty(g.q, k), n: g.n, src: src(g) });
  const missing = allIngs(recipe).filter((g) => !have.has(src(g)));
  // Every ingredient at the chosen servings, as sent for a price estimate.
  const priceItems = allIngs(recipe).map((g) => ({ id: g.id, q: scaleQty(g.q, k), name: g.n }));
  const estimate = () => runEstimate(priceItems, setPrice, tier);

  return (
    <main className="ra-detail">
      <Photo path={recipe.photo} session={session} className={`ra-detail-ph${recipe.photo ? " has-photo" : ""}`}>
        <button className="ra-round-btn" onClick={onBack} aria-label="Back">←</button>
        <button className="ra-round-btn text" onClick={onEdit}>Edit</button>
      </Photo>
      <div className="ra-detail-body">
        <Tags tags={recipe.tags} />
        <h1 className="ra-title detail">{recipe.name}</h1>

        <div className="ra-servings">
          <div>
            <span className="ra-muted sm">Servings</span>
            <span className="ra-muted">{recipe.time} min</span>
          </div>
          <div className="ra-stepper">
            <button onClick={() => setServings(Math.max(1, (sv || 1) - 1))} aria-label="Fewer servings">−</button>
            <input
              value={sv || ""}
              inputMode="numeric"
              aria-label="Servings"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 2);
                setServings(v ? parseInt(v, 10) : 0);
              }}
            />
            <button className="plus" onClick={() => setServings(Math.min(99, (sv || 0) + 1))} aria-label="More servings">+</button>
          </div>
        </div>

        <div className="ra-sub-head">
          <h2>Ingredients</h2>
          <button
            className={`ra-pill-btn${missing.length ? " accent" : ""}`}
            disabled={!missing.length}
            onClick={() => addToList(missing.map(toAdd))}
          >
            {missing.length ? `Add ${missing.length} to ${list.name}` : `All on ${list.name}`}
          </button>
        </div>
        {recipe.ingredients.map((sec) => (
          <section key={sec.id}>
            {sec.name && <h3 className="ra-sec-head">{sec.name}</h3>}
            {sec.items.map((g) => (
              <div key={g.id} className="ra-ing">
                <span className="ra-ing-q">{scaleQty(g.q, k)}</span>
                <span className="ra-ing-n">{g.n}</span>
                {have.has(src(g)) ? (
                  <span className="ra-on-list">On list</span>
                ) : (
                  <button className="ra-ing-add" onClick={() => addToList([toAdd(g)])} aria-label={`Add ${g.n} to shopping list`}>+</button>
                )}
              </div>
            ))}
          </section>
        ))}

        {priceItems.length > 0 && (
          <>
            <div className="ra-sub-head">
              <h2>Cost</h2>
              {!price && (
                <button className="ra-pill-btn" disabled={!session} onClick={estimate}>
                  Estimate at Aldi
                </button>
              )}
            </div>
            {!price && <TierPicker tier={tier} setTier={setTier} />}
            {!price && session === null && (
              <p className="ra-muted sm ra-price-hint">
                <a href="./">Sign in on the home page</a> to estimate prices.
              </p>
            )}
            {price && (
              <PriceBreakdown
                est={price}
                servings={sv}
                stale={!price.loading && price.key !== estimateKey(priceItems, tier)}
                tier={tier}
                setTier={setTier}
                onRefresh={estimate}
                onClose={() => setPrice(() => null)}
              />
            )}
          </>
        )}

        {recipe.method.some((sec) => sec.items.length) && <h2 className="ra-method-head">Method</h2>}
        {recipe.method.map((sec) => (
          <section key={sec.id}>
            {sec.name && <h3 className="ra-sec-head">{sec.name}</h3>}
            <ol className="ra-steps">
              {sec.items.map((step, i) => {
                const key = `${recipe.id}:${step.id}`;
                const detected = stepMin(step.text);
                const label = `${recipe.name}, ${sec.name ? `${sec.name} ` : ""}step ${i + 1}`;
                return (
                  <li key={step.id}>
                    <span className="ra-step-n">{i + 1}</span>
                    <div>
                      <p>{step.text}</p>
                      <StepTimer
                        tm={timers[key]}
                        detected={detected}
                        open={() => setTimer(key, () => ({ dur: (detected || 5) * 60, label }))}
                        update={(fn) => setTimer(key, fn)}
                        close={() => setTimer(key, () => null)}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
