import { uid, parseIng } from "./format.js";

const { useState, useRef, useEffect } = React;

const EDGE_PX = 80;
const SCROLL_PX = 12;

const KINDS = {
  ing: {
    blank: () => ({ id: uid(), q: "", n: "" }),
    fromLine: (line) => ({ id: uid(), ...parseIng(line) }),
    isEmpty: (g) => !g.q.trim() && !g.n.trim(),
    add: "Add ingredient",
  },
  step: {
    blank: () => ({ id: uid(), text: "" }),
    fromLine: (text) => ({ id: uid(), text }),
    isEmpty: (s) => !s.text.trim(),
    add: "Add step",
  },
};

export const blankSection = (kind) => ({ id: uid(), name: "", items: [KINDS[kind].blank()] });

// Trims a section list for saving: drops empty rows, then empty sections.
export function cleanSections(kind, sections) {
  const k = KINDS[kind];
  return sections
    .map((sec) => ({
      id: sec.id,
      name: sec.name.trim(),
      items: sec.items
        .filter((it) => !k.isEmpty(it))
        .map((it) => (kind === "ing" ? { id: it.id, q: it.q.trim(), n: it.n.trim() } : { id: it.id, text: it.text.trim() })),
    }))
    .filter((sec) => sec.items.length);
}

function autosize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// Where a dragged row would land if dropped with its centre at page y:
// the nearest gap between rows, in any section. `index` counts rows with
// the dragged one taken out.
function nearestGap(gaps, y) {
  let best = gaps[0];
  gaps.forEach((g) => {
    if (Math.abs(g.y - y) < Math.abs(best.y - y)) best = g;
  });
  return best;
}

// Editor for a recipe's ingredients or method: named sections of rows.
// Drag a row by its grip to reorder it, also into another section. Enter
// adds a row below, Backspace in an empty row removes it, and pasting
// several lines makes one row per line.
export function SectionEditor({ kind, sections, setSections, disabled }) {
  const k = KINDS[kind];
  const [focusId, setFocusId] = useState(null);
  const [confirmSec, setConfirmSec] = useState(null);
  // { id, secId, off, target: { secId, index } } while a row is dragged.
  const [drag, setDrag] = useState(null);
  const rootRef = useRef(null);
  const rowEls = useRef(new Map());
  const listEls = useRef(new Map());
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const showHeads = sections.length > 1 || !!sections[0]?.name;

  // Focuses a row (or section name) once it's rendered.
  useEffect(() => {
    if (!focusId) return;
    const el = rootRef.current && rootRef.current.querySelector(`[data-focus="${focusId}"]`);
    if (el) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
    setFocusId(null);
  }, [focusId]);

  const updateSec = (secId, fn) => setSections((ss) => ss.map((s) => (s.id === secId ? fn(s) : s)));
  const updateItem = (secId, id, patch) =>
    updateSec(secId, (s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));

  function insertAfter(secId, afterId, items) {
    updateSec(secId, (s) => {
      const at = afterId ? s.items.findIndex((it) => it.id === afterId) + 1 : s.items.length;
      return { ...s, items: [...s.items.slice(0, at), ...items, ...s.items.slice(at)] };
    });
    setFocusId(items[items.length - 1].id);
  }

  function removeItem(secId, id) {
    const sec = sections.find((s) => s.id === secId);
    const i = sec.items.findIndex((it) => it.id === id);
    updateSec(secId, (s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
    return sec.items[i - 1] || sec.items[i + 1];
  }

  function addSection() {
    const sec = { ...blankSection(kind), items: [] };
    setSections((ss) => [...ss, sec]);
    setFocusId(sec.id);
  }

  function removeSection(sec) {
    if (sec.items.some((it) => !k.isEmpty(it)) && confirmSec !== sec.id) {
      setConfirmSec(sec.id);
      return;
    }
    setConfirmSec(null);
    setSections((ss) => ss.filter((s) => s.id !== sec.id));
  }

  function onKeyDown(e, sec, it) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      insertAfter(sec.id, it.id, [k.blank()]);
    } else if (e.key === "Backspace" && k.isEmpty(it) && sec.items.length > 1) {
      e.preventDefault();
      const next = removeItem(sec.id, it.id);
      if (next) setFocusId(next.id);
    }
  }

  // A multi-line paste becomes one row per line. Into an empty row, even a
  // single line is split into quantity and name.
  function onPaste(e, sec, it) {
    const lines = e.clipboardData.getData("text").split("\n").map((x) => x.trim()).filter(Boolean);
    const empty = k.isEmpty(it);
    if (!lines.length || (lines.length === 1 && !(empty && kind === "ing"))) return;
    e.preventDefault();
    const rows = lines.map(k.fromLine);
    if (empty) {
      const [first, ...rest] = rows;
      updateItem(sec.id, it.id, { ...first, id: it.id });
      if (rest.length) insertAfter(sec.id, it.id, rest);
      else setFocusId(it.id);
    } else {
      insertAfter(sec.id, it.id, rows);
    }
  }

  // ---- dragging ----

  function startDrag(e, secId, id) {
    if (disabled || e.button > 0) return;
    e.preventDefault();
    const pageY = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
    };
    const dragged = pageY(rowEls.current.get(id));
    const gaps = [];
    sectionsRef.current.forEach((sec) => {
      const rest = sec.items.filter((it) => it.id !== id);
      const from = sec.items.findIndex((it) => it.id === id);
      for (let j = 0; j <= rest.length; j++) {
        let y;
        if (sec.id === secId && j === from) y = (dragged.top + dragged.bottom) / 2;
        else if (rest[j - 1] && rest[j]) y = (pageY(rowEls.current.get(rest[j - 1].id)).bottom + pageY(rowEls.current.get(rest[j].id)).top) / 2;
        else if (rest[j]) y = pageY(rowEls.current.get(rest[j].id)).top;
        else if (rest[j - 1]) y = pageY(rowEls.current.get(rest[j - 1].id)).bottom;
        else y = pageY(listEls.current.get(sec.id)).top;
        gaps.push({ secId: sec.id, index: j, y });
      }
    });
    const home = { secId, index: sectionsRef.current.find((s) => s.id === secId).items.findIndex((it) => it.id === id) };
    const d = { id, secId, startY: e.clientY + window.scrollY, centre: (dragged.top + dragged.bottom) / 2, clientY: e.clientY, target: home };
    let raf = 0;

    function update() {
      const off = d.clientY + window.scrollY - d.startY;
      d.target = nearestGap(gaps, d.centre + off);
      setDrag({ id, secId, off, target: d.target, home });
    }
    // Scrolls the page while the row is held near the top or bottom edge.
    function tick() {
      const dir = d.clientY < EDGE_PX ? -1 : d.clientY > window.innerHeight - EDGE_PX ? 1 : 0;
      if (dir) {
        window.scrollBy(0, dir * SCROLL_PX);
        update();
      }
      raf = requestAnimationFrame(tick);
    }
    function onMove(ev) {
      d.clientY = ev.clientY;
      update();
    }
    function onTouchMove(ev) {
      ev.preventDefault();
    }
    function onUp() {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      setDrag(null);
      const t = d.target;
      if (t.secId === home.secId && t.index === home.index) return;
      setSections((ss) => {
        const item = ss.find((s) => s.id === secId).items.find((it) => it.id === id);
        const out = ss.map((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) }));
        return out.map((s) => (s.id === t.secId ? { ...s, items: [...s.items.slice(0, t.index), item, ...s.items.slice(t.index)] } : s));
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    if (navigator.vibrate) navigator.vibrate(8);
    update();
    raf = requestAnimationFrame(tick);
  }

  const moved = drag && (drag.target.secId !== drag.home.secId || drag.target.index !== drag.home.index);

  function renderRow(sec, it, n) {
    const dragging = drag && drag.id === it.id;
    return (
      <div
        ref={(el) => (el ? rowEls.current.set(it.id, el) : rowEls.current.delete(it.id))}
        className={`ra-ed-row${dragging ? " dragging" : ""}`}
        style={dragging ? { transform: `translateY(${drag.off}px)` } : undefined}
      >
        <button
          className="ra-ed-grip"
          onPointerDown={(e) => startDrag(e, sec.id, it.id)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          <span className="ra-grip"><span /><span /><span /></span>
        </button>
        {kind === "ing" ? (
          <>
            <input
              className="ra-ed-field q"
              value={it.q}
              onChange={(e) => updateItem(sec.id, it.id, { q: e.target.value })}
              onPaste={(e) => onPaste(e, sec, it)}
              placeholder="Qty"
              aria-label="Quantity"
              disabled={disabled}
            />
            <input
              className="ra-ed-field"
              data-focus={it.id}
              value={it.n}
              onChange={(e) => updateItem(sec.id, it.id, { n: e.target.value })}
              onKeyDown={(e) => onKeyDown(e, sec, it)}
              onPaste={(e) => onPaste(e, sec, it)}
              placeholder="Ingredient"
              aria-label="Ingredient"
              disabled={disabled}
            />
          </>
        ) : (
          <>
            <span className="ra-step-n sm">{n}</span>
            <textarea
              className="ra-ed-field step"
              data-focus={it.id}
              ref={(el) => autosize(el)}
              rows={1}
              value={it.text}
              onChange={(e) => {
                autosize(e.target);
                updateItem(sec.id, it.id, { text: e.target.value });
              }}
              onKeyDown={(e) => onKeyDown(e, sec, it)}
              onPaste={(e) => onPaste(e, sec, it)}
              placeholder="Describe this step"
              aria-label={`Step ${n}`}
              disabled={disabled}
            />
          </>
        )}
        <button className="ra-ed-remove" onClick={() => removeItem(sec.id, it.id)} aria-label="Remove" disabled={disabled}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="ra-ed" ref={rootRef}>
      {sections.map((sec) => {
        const rest = drag ? sec.items.filter((it) => it.id !== drag.id) : sec.items;
        const dropAt = moved && drag.target.secId === sec.id ? drag.target.index : -1;
        const dropBefore = dropAt >= 0 && rest[dropAt] ? rest[dropAt].id : null;
        return (
          <div key={sec.id} className="ra-ed-sec">
            {showHeads && (
              <div className="ra-ed-head">
                <input
                  className="ra-ed-name"
                  data-focus={sec.id}
                  value={sec.name}
                  onChange={(e) => updateSec(sec.id, (s) => ({ ...s, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      insertAfter(sec.id, null, [k.blank()]);
                    }
                  }}
                  placeholder="Section name, e.g. Sauce"
                  aria-label="Section name"
                  disabled={disabled}
                />
                {sections.length > 1 && (
                  <button
                    className={`ra-ed-sec-remove${confirmSec === sec.id ? " confirm" : ""}`}
                    onClick={() => removeSection(sec)}
                    onBlur={() => setConfirmSec(null)}
                    disabled={disabled}
                  >
                    {confirmSec === sec.id ? "Remove section?" : "Remove"}
                  </button>
                )}
              </div>
            )}
            <div className="ra-ed-list" ref={(el) => (el ? listEls.current.set(sec.id, el) : listEls.current.delete(sec.id))}>
              {sec.items.map((it, i) => (
                <React.Fragment key={it.id}>
                  {dropBefore === it.id && <div className="ra-ed-drop" />}
                  {renderRow(sec, it, i + 1)}
                </React.Fragment>
              ))}
              {dropAt >= 0 && !dropBefore && <div className="ra-ed-drop" />}
            </div>
            <button className="ra-ed-add" onClick={() => insertAfter(sec.id, null, [k.blank()])} disabled={disabled}>
              + {k.add}
            </button>
          </div>
        );
      })}
      <button className="ra-ed-add-sec" onClick={addSection} disabled={disabled}>
        + Add section
      </button>
    </div>
  );
}
