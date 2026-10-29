// Deck: every card, searchable and filterable; tap one to edit or delete it.
import { searchCards, dayEnd, addDays, germanOf } from "./model.js";
import { formatWait } from "./fsrs.js";
import { pointLabel } from "./grammar.js";
import { Screen, ScreenHeader, IconButton, Chip, Noun, Empty } from "./ui.jsx";

const { useState, useMemo } = React;

const FILTERS = [["all", "All"], ["nouns", "Nouns"], ["verbs", "Verbs"], ["grammar", "Grammar"], ["hard", "Hard ones"]];
// Long decks render in pages so typing in the search stays quick.
const PAGE = 150;

function when(card, today) {
  if (!card.srs) return "new";
  const due = card.srs.due;
  if (due < dayEnd(today)) return "today";
  if (due < dayEnd(addDays(today, 1))) return "tomorrow";
  return `in ${formatWait(due - Date.now())}`;
}

function Title({ card }) {
  if (card.kind === "noun") return <Noun article={card.article}>{card.de}</Noun>;
  if (card.kind === "gap") return germanOf(card);
  if (card.kind === "rule") return pointLabel(card.point);
  return card.de;
}

function subtitle(card) {
  if (card.kind === "verb") return [card.en, card.perfekt].filter(Boolean).join(" · ");
  if (card.kind === "gap") return "grammar · from your writing";
  if (card.kind === "rule") return "grammar rule";
  return card.en;
}

export function Deck({ app }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const found = useMemo(
    () => searchCards(app.cards, query, filter).sort((a, b) => b.added - a.added),
    [app.cards, query, filter]
  );

  return (
    <Screen label="Deck">
      <ScreenHeader back="#/progress" title="Deck" big>
        <IconButton icon="plus" label="Add a word" href="#/add" variant="mint" />
      </ScreenHeader>

      <div>
        <label htmlFor="deck-search" className="sr">Search cards</label>
        <input id="deck-search" type="search" className="g-input g-search" placeholder="Search German or English" value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE); }} />
      </div>

      <div className="g-chips" role="group" aria-label="Filter">
        {FILTERS.map(([k, label]) => (
          <Chip key={k} pressed={filter === k} onClick={() => { setFilter(k); setLimit(PAGE); }}>{label}</Chip>
        ))}
      </div>

      {found.length ? (
        <ul className="g-list">
          {found.slice(0, limit).map(c => (
            <li key={c.id}>
              <a href={`#/card/${c.id}`}>
                <span className="t"><b><Title card={c} /></b><span>{subtitle(c)}</span></span>
                <span className="r">{when(c, app.today)}</span>
              </a>
            </li>
          ))}
          {found.length > limit && (
            <li><button type="button" onClick={() => setLimit(l => l + PAGE)}><span className="g-muted">Show more ({found.length - limit})</span></button></li>
          )}
        </ul>
      ) : (
        <Empty>{app.cards.length ? "No cards match." : "No cards yet. Add a word, or start today's cards to get suggested words."}</Empty>
      )}
    </Screen>
  );
}
