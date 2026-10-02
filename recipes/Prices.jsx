import { priceTotals, chf, priceDetail, monthLabel, PRICE_TIERS } from "../shared/prices.js";

// Chips for choosing whether estimates look for the cheapest, normal or
// premium products.
export function TierPicker({ tier, setTier }) {
  return (
    <div className="ra-chips tight" role="group" aria-label="Price level">
      {PRICE_TIERS.map((t) => (
        <button key={t.id} className={`ra-chip sm${tier === t.id ? " on" : ""}`} aria-pressed={tier === t.id} onClick={() => setTier(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// The cost breakdown for an estimate. With `servings` (a recipe) it shows
// what the recipe uses next to what you'd pay; without (a list), only what
// you'd pay.
export function PriceBreakdown({ est, servings, stale, tier, setTier, onRefresh, onClose }) {
  if (est.loading) {
    return (
      <div className="ra-price" role="status" aria-live="polite">
        <p className="ra-muted">Looking up Aldi prices…</p>
      </div>
    );
  }
  if (est.error) {
    return (
      <div className="ra-price">
        <p className="ra-error">{est.error}</p>
        <div className="ra-price-actions">
          <button className="ra-small-btn" onClick={onRefresh}>Try again</button>
          <button className="ra-small-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const byId = new Map(est.result.items.map((i) => [i.id, i]));
  const t = priceTotals(est.result);
  const recipe = servings != null;

  return (
    <div className="ra-price">
      <div className="ra-price-totals">
        <div>
          <span className="ra-muted sm">At the till</span>
          <strong>{chf(t.buy)}</strong>
        </div>
        {recipe && (
          <div>
            <span className="ra-muted sm">Used</span>
            <strong>{chf(t.used)}</strong>
          </div>
        )}
        {recipe && servings > 0 && (
          <div>
            <span className="ra-muted sm">Per serving</span>
            <strong>{chf(t.used / servings)}</strong>
          </div>
        )}
      </div>
      {t.missing > 0 && (
        <p className="ra-muted sm">
          {t.missing === 1 ? "1 item has" : `${t.missing} items have`} no price and {t.missing === 1 ? "isn't" : "aren't"} counted.
        </p>
      )}
      {stale && (
        <p className="ra-price-stale">
          {recipe ? "Servings, ingredients or price level changed." : "The list or price level changed."}{" "}
          <button className="ra-link" onClick={onRefresh}>Recalculate</button>
        </p>
      )}

      <TierPicker tier={tier} setTier={setTier} />

      <ul className="ra-price-rows">
        {est.items.map((row) => {
          const p = byId.get(row.id) || { source: "none" };
          return (
            <li key={row.id} className={p.source === "none" ? "none" : ""}>
              <div className="ra-price-main">
                <span className="ra-price-name">
                  {row.name}
                  {row.q && <span className="ra-row-q">{row.q}</span>}
                </span>
                <span className="ra-price-sub">
                  {p.source === "aldi" && <>{p.product}{p.size ? ` · ${p.size}` : ""}</>}
                  {p.source === "produce" && (
                    <>
                      <span className="ra-price-tag">Swiss avg.</span>
                      {p.product}
                    </>
                  )}
                  {p.source === "none" && "No price found"}
                  {p.source !== "none" && <span className="ra-price-calc"> · {priceDetail(p)}</span>}
                </span>
                {p.note && <span className="ra-price-note">{p.note}</span>}
              </div>
              {p.source !== "none" && (
                <div className="ra-price-cost">
                  <span>{chf(recipe ? p.used : p.buy)}</span>
                  {recipe && p.buy !== p.used && <span className="ra-muted sm">of {chf(p.buy)}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="ra-muted sm ra-price-src">
        Prices from aldi-suisse.ch.
        {t.produce && ` Swiss avg.: fresh produce, Swiss retail average ${monthLabel(est.result.produceMonth)} (BLW), as Aldi doesn't list it online.`}
      </p>
      <div className="ra-price-actions">
        {!stale && <button className="ra-small-btn" onClick={onRefresh}>Refresh</button>}
        <button className="ra-small-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
