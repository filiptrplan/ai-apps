import { s, C } from "../styles.js";
import { searchLibrary, libraryPhotoUrls, LIBRARY_CREDIT } from "../stretchLibrary.js";
import { Sheet } from "./Layout.jsx";
import { Icon } from "./Icons.jsx";

const { useState } = React;

// Searchable list of the built-in stretches (by name or muscle). `addedIds`
// marks the ones already among the user's exercises.
export function StretchLibraryPicker({ title = "Stretch library", addedIds = new Set(), onPick, onClose }) {
  const [query, setQuery] = useState("");
  const results = searchLibrary(query);
  return (
    <Sheet title={title} onClose={onClose}>
      <input
        style={{ ...s.input, marginBottom: 6 }}
        placeholder="Search, e.g. hip flexors or band"
        value={query}
        onChange={e => setQuery(e.target.value)}
        aria-label="Search stretches"
      />
      {results.length === 0 && <p style={{ ...s.hint, marginTop: 16 }}>No stretch matches "{query}".</p>}
      {results.map(stretch => {
        const photo = libraryPhotoUrls(stretch.id)[0];
        const added = addedIds.has(stretch.id);
        return (
          <button key={stretch.id} style={s.pickerItem} onClick={() => onPick(stretch)}>
            <span style={{ ...s.thumb, width: 52, height: 52, cursor: "inherit" }}>
              {photo ? <img src={photo} alt="" loading="lazy" style={s.thumbImg} /> : <span style={{ color: C.dim, display: "flex" }}><Icon.stretch size={22} /></span>}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 600 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stretch.name}</span>
              </span>
              <span style={{ display: "block", fontSize: 13, color: C.muted, marginTop: 2 }}>
                {stretch.muscles.join(", ")}{stretch.twoSided ? " · both sides" : ""}{stretch.equipment ? ` · ${stretch.equipment}` : ""}
              </span>
            </span>
            <span style={{ color: added ? C.green : C.accent }}>{added ? <Icon.check size={22} /> : <Icon.plus size={22} />}</span>
          </button>
        );
      })}
      <p style={{ ...s.hint, marginTop: 16, marginBottom: 0, textAlign: "center" }}>
        <a href={LIBRARY_CREDIT.url} target="_blank" rel="noopener nofollow" style={{ color: C.muted }}>{LIBRARY_CREDIT.text}</a>
      </p>
    </Sheet>
  );
}
