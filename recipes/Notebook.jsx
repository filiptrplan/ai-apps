import { CATS, allIngs } from "./format.js";
import { Photo } from "./Photo.jsx";

const meta = (r) => `${r.time} min · Serves ${r.serves}`;

function Tags({ tags }) {
  return (
    <div className="ra-tags">
      {tags.map((tg) => (
        <span key={tg} className="ra-tag">{tg}</span>
      ))}
    </div>
  );
}

export { Tags };

// Notebook tab: search and filter recipes, open one, or start a new one.
export function Notebook({ recipes, session, query, setQuery, cat, setCat, openRecipe, openCompose }) {
  const q = query.trim().toLowerCase();
  const filtered = recipes.filter(
    (r) =>
      (cat === "All" || r.cat === cat) &&
      (!q || r.name.toLowerCase().includes(q) || allIngs(r).some((g) => g.n.toLowerCase().includes(q)))
  );
  const [featured, ...rest] = filtered;

  return (
    <main className="ra-screen">
      <div className="ra-eyebrow">
        <a href="./" aria-label="All apps">‹</a>Notebook
      </div>
      <div className="ra-title-row">
        <h1 className="ra-title">Recipes</h1>
        <button className="ra-accent-btn" onClick={openCompose}>
          <span>+</span>Add recipe
        </button>
      </div>

      {recipes.length === 0 ? (
        <div className="ra-empty big">
          <p>No recipes yet.</p>
          <p className="ra-muted">Add one by hand, or let ✦ Magic read it from a screenshot, text or link.</p>
        </div>
      ) : (
        <>
          <input
            className="ra-field ra-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes or ingredients"
          />
          <div className="ra-chips">
            {["All", ...CATS].map((c) => (
              <button key={c} className={`ra-chip sm${cat === c ? " on" : ""}`} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>

          {featured && (
            <button className="ra-card featured" onClick={() => openRecipe(featured.id)}>
              <Photo path={featured.photo} session={session} />
              <div className="ra-card-body">
                <Tags tags={featured.tags} />
                <div className="ra-card-title">{featured.name}</div>
                <div className="ra-card-meta">{meta(featured)}</div>
              </div>
            </button>
          )}
          <div className="ra-grid">
            {rest.map((r) => (
              <button key={r.id} className="ra-card" onClick={() => openRecipe(r.id)}>
                <Photo path={r.photo} session={session} />
                <div className="ra-card-body">
                  <div className="ra-card-name">{r.name}</div>
                  <div className="ra-card-meta">{meta(r)}</div>
                </div>
              </button>
            ))}
          </div>
          {filtered.length === 0 && <p className="ra-empty">No recipes match.</p>}
        </>
      )}
    </main>
  );
}
