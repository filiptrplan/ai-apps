import { scaleQty, stepMin, fmtClock } from "./format.js";
import { Tags } from "./Notebook.jsx";
import { Photo } from "./Photo.jsx";

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

export function RecipeDetail({ recipe, session, list, servings, setServings, timers, setTimer, onBack, onEdit, addToList }) {
  const sv = servings ?? recipe.serves;
  const k = sv > 0 ? sv / recipe.serves : 1;
  const have = new Set(list.items.filter((i) => !i.checked).map((i) => i.name.toLowerCase()));
  const missing = recipe.ings.filter((g) => !have.has(g.n.toLowerCase()));

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
            onClick={() => addToList(missing)}
          >
            {missing.length ? `Add ${missing.length} to ${list.name}` : `All on ${list.name}`}
          </button>
        </div>
        <div>
          {recipe.ings.map((g, i) => (
            <div key={i} className="ra-ing">
              <span className="ra-ing-q">{scaleQty(g.q, k)}</span>
              <span className="ra-ing-n">{g.n}</span>
              {have.has(g.n.toLowerCase()) ? (
                <span className="ra-on-list">On list</span>
              ) : (
                <button className="ra-ing-add" onClick={() => addToList([g])} aria-label={`Add ${g.n} to shopping list`}>+</button>
              )}
            </div>
          ))}
        </div>

        {recipe.steps.length > 0 && <h2 className="ra-method-head">Method</h2>}
        <ol className="ra-steps">
          {recipe.steps.map((text, i) => {
            const key = `${recipe.id}:${i}`;
            const detected = stepMin(text);
            return (
              <li key={i}>
                <span className="ra-step-n">{i + 1}</span>
                <div>
                  <p>{text}</p>
                  <StepTimer
                    tm={timers[key]}
                    detected={detected}
                    open={() => setTimer(key, () => ({ dur: (detected || 5) * 60, label: `${recipe.name}, step ${i + 1}` }))}
                    update={(fn) => setTimer(key, fn)}
                    close={() => setTimer(key, () => null)}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </main>
  );
}
