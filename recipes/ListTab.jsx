import { uid, plural, parseIng, ingToLine } from "./format.js";
import { runEstimate, estimateKey } from "../shared/prices.js";
import { PriceBreakdown } from "./Prices.jsx";

const { useState, useRef, useEffect } = React;

const ROW_H = 54;
const HOLD_MS = 300;
const SETTLE_MS = 380;

const focusRef = (el) => el && el.focus();
const selectRef = (el) => {
  if (el) {
    el.focus();
    el.select();
  }
};
const stop = (e) => e.stopPropagation();

// Shopping list tab: tick items (they sink into "In the cart" after a beat),
// hold a row to drag it, tap a name or the list title to rename it (an empty
// name deletes it), switch lists with the chips. Items and edits are typed
// amount first ("2 Onions"); the amount shows after the name. A typed item
// that's already on the list is combined with it, like recipe ingredients.
export function ListTab({ lists, list, setActive, setLists, updateItems, queueMerge, showToast, session, price, setPrice }) {
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState("");
  const [addDraft, setAddDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  // The item just ticked: it shows its new state but stays in its old group
  // until the timer moves it, so a mis-tap is easy to undo.
  const [settle, setSettle] = useState(null);
  const settleRef = useRef(null);
  const settleT = useRef(null);
  // { id, order: todo ids, off: px } while a row is being dragged.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const pressRef = useRef(null);
  const pressT = useRef(null);
  const justDragged = useRef(false);
  const latest = useRef({});
  latest.current = { list, updateItems };

  function finishSettle() {
    const st = settleRef.current;
    if (!st) return;
    clearTimeout(settleT.current);
    settleRef.current = null;
    setSettle(null);
    latest.current.updateItems(st.listId, (items) => {
      const it = items.find((i) => i.id === st.id);
      if (!it) return items;
      const moved = { ...it, checked: !it.checked };
      const rest = items.filter((i) => i.id !== st.id);
      const todo = rest.filter((i) => !i.checked);
      return [...todo, moved, ...rest.filter((i) => i.checked)];
    });
  }

  function toggle(id) {
    finishSettle();
    settleRef.current = { id, listId: list.id };
    setSettle(id);
    settleT.current = setTimeout(finishSettle, SETTLE_MS);
  }

  // Global pointer listeners for press-and-hold dragging. They only act
  // while a press or drag is in progress.
  useEffect(() => {
    function onMove(e) {
      const d = dragRef.current;
      if (d) {
        e.preventDefault();
        let off = e.clientY - d.y;
        const steps = Math.round(off / ROW_H);
        if (steps) {
          const idx = d.order.indexOf(d.id);
          const ni = Math.max(0, Math.min(d.order.length - 1, idx + steps));
          if (ni !== idx) {
            const order = d.order.filter((x) => x !== d.id);
            order.splice(ni, 0, d.id);
            d.order = order;
            d.y += (ni - idx) * ROW_H;
            off -= (ni - idx) * ROW_H;
          }
        }
        setDrag({ id: d.id, order: d.order, off });
      } else if (pressRef.current) {
        const p = pressRef.current;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
          clearTimeout(pressT.current);
          pressRef.current = null;
        }
      }
    }
    function onUp() {
      clearTimeout(pressT.current);
      pressRef.current = null;
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 60);
      setDrag(null);
      latest.current.updateItems(d.listId, (items) => {
        const byId = new Map(items.map((i) => [i.id, i]));
        const todo = d.order.map((id) => byId.get(id)).filter((i) => i && !i.checked);
        const seen = new Set(todo.map((i) => i.id));
        return [...todo, ...items.filter((i) => !seen.has(i.id))];
      });
    }
    // Stops the page from scrolling under a dragged row on touch screens.
    function onTouchMove(e) {
      if (dragRef.current) e.preventDefault();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      clearTimeout(pressT.current);
      clearTimeout(settleT.current);
    };
  }, []);

  function down(id, e) {
    if (editingId || e.button > 0) return;
    pressRef.current = { x: e.clientX, y: e.clientY };
    clearTimeout(pressT.current);
    pressT.current = setTimeout(() => {
      if (!pressRef.current) return;
      const cur = latest.current.list;
      const order = cur.items.filter((i) => !i.checked).map((i) => i.id);
      dragRef.current = { id, listId: cur.id, y: pressRef.current.y, order };
      pressRef.current = null;
      setDrag({ id, order, off: 0 });
      if (navigator.vibrate) navigator.vibrate(8);
    }, HOLD_MS);
  }

  function edit(item) {
    if (justDragged.current || drag) return;
    finishSettle();
    setEditingTitle(false);
    setEditingId(item.id);
    setDraft(ingToLine({ q: item.q, n: item.name }));
  }
  function commitItem() {
    if (!editingId) return;
    const v = draft.trim();
    const { q, n } = parseIng(v);
    updateItems(list.id, (items) =>
      v ? items.map((i) => (i.id === editingId ? { ...i, name: n, q } : i)) : items.filter((i) => i.id !== editingId)
    );
    setEditingId(null);
  }
  const onItemKey = (e) => {
    if (e.key === "Enter") commitItem();
    if (e.key === "Escape") setEditingId(null);
  };

  function startTitleEdit() {
    setEditingId(null);
    setEditingTitle(true);
    setDraft(list.name);
  }
  function commitTitle() {
    if (!editingTitle) return;
    setEditingTitle(false);
    const v = draft.trim();
    if (v) {
      setLists((ls) => ls.map((l) => (l.id === list.id ? { ...l, name: v } : l)));
    } else if (lists.length > 1) {
      const rest = lists.filter((l) => l.id !== list.id);
      setLists(rest);
      setActive(rest[0].id);
      showToast(`Deleted ${list.name}`);
    }
  }
  const onTitleKey = (e) => {
    if (e.key === "Enter") commitTitle();
    if (e.key === "Escape") setEditingTitle(false);
  };

  function addList() {
    finishSettle();
    const id = uid();
    setLists((ls) => [...ls, { id, name: "New list", items: [] }]);
    setActive(id);
    setEditingId(null);
    setEditingTitle(true);
    setDraft("New list");
  }
  function switchList(id) {
    if (id === list.id) return startTitleEdit();
    finishSettle();
    setEditingId(null);
    setEditingTitle(false);
    setConfirmClear(false);
    setActive(id);
  }

  function addItem(e) {
    e.preventDefault();
    const v = addDraft.trim();
    if (!v) return;
    const { q, n } = parseIng(v);
    const id = uid();
    updateItems(list.id, (items) => [{ id, name: n, q, checked: false }, ...items]);
    queueMerge(list.id, [id]);
    setAddDraft("");
  }
  function clearDone() {
    finishSettle();
    const n = list.items.filter((i) => i.checked).length;
    if (!n) return;
    updateItems(list.id, (items) => items.filter((i) => !i.checked));
    showToast(`Cleared ${plural(n, "item")}`);
  }
  function clearAll() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    finishSettle();
    const n = list.items.length;
    updateItems(list.id, () => []);
    showToast(`Cleared ${plural(n, "item")}`);
  }

  // The group an item is shown in: a settling item stays where it was.
  const inCart = (i) => i.checked;
  const shownChecked = (i) => (settle === i.id ? !i.checked : i.checked);
  let todo = list.items.filter((i) => !inCart(i));
  if (drag) {
    const byId = new Map(todo.map((i) => [i.id, i]));
    todo = drag.order.map((id) => byId.get(id)).filter(Boolean);
  }
  const done = list.items.filter(inCart);
  // What's still to get, as sent for a price estimate.
  const priceItems = list.items.filter((i) => !i.checked).map((i) => ({ id: i.id, q: i.q || "", name: i.name }));
  const estimate = () => runEstimate(priceItems, setPrice);

  const renderRow = (i, draggable) => {
    const dragging = draggable && drag && drag.id === i.id;
    const checked = shownChecked(i);
    return (
      <div
        key={i.id}
        className={`ra-row${draggable ? " drag" : ""}${dragging ? " dragging" : ""}`}
        style={dragging ? { transform: `translateY(${drag.off}px) scale(1.02)` } : undefined}
        onPointerDown={draggable ? (e) => down(i.id, e) : undefined}
        onContextMenu={draggable ? (e) => e.preventDefault() : undefined}
      >
        <button
          className={`ra-check${checked ? " on" : ""}`}
          onPointerDown={stop}
          onClick={() => toggle(i.id)}
          aria-label={checked ? `Untick ${i.name}` : `Tick ${i.name}`}
        >
          {checked ? "✓" : ""}
        </button>
        {editingId === i.id ? (
          <input
            ref={focusRef}
            className="ra-row-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onItemKey}
            onBlur={commitItem}
            onPointerDown={stop}
          />
        ) : (
          <span className={`ra-row-name${checked ? " done" : ""}`} onClick={() => edit(i)}>
            {i.name}
            {i.q && <span className="ra-row-q">{i.q}</span>}
          </span>
        )}
        {draggable && (
          <span className="ra-grip" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
    );
  };

  return (
    <main className="ra-screen">
      <div className="ra-eyebrow">
        <a href="./" aria-label="All apps">‹</a>Shopping list
      </div>
      {editingTitle ? (
        <input
          ref={selectRef}
          className="ra-title ra-title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onTitleKey}
          onBlur={commitTitle}
          aria-label="List name"
        />
      ) : (
        <h1 className="ra-title editable" onClick={startTitleEdit}>{list.name}</h1>
      )}

      <div className="ra-chips">
        {lists.map((l) => {
          const n = l.items.filter((i) => !i.checked).length;
          return (
            <button key={l.id} className={`ra-chip${l.id === list.id ? " on" : ""}`} onClick={() => switchList(l.id)}>
              {l.name}
              {n > 0 && <span className="ra-chip-count">{n}</span>}
            </button>
          );
        })}
        <button className="ra-chip dashed" onClick={addList}>+ New list</button>
      </div>

      <form className="ra-add" onSubmit={addItem}>
        <input value={addDraft} onChange={(e) => setAddDraft(e.target.value)} placeholder="Add an item, e.g. 2 Lemons" aria-label="New item" />
        <button type="submit" aria-label="Add item">+</button>
      </form>

      <div className="ra-section-head">
        <span>{todo.length ? `${todo.length} to get` : "All set"}</span>
        <span className="ra-section-btns">
          {todo.length > 0 && !price && (
            <button
              className="ra-small-btn"
              disabled={!session}
              title={session ? undefined : "Sign in on the home page to estimate prices"}
              onClick={estimate}
            >
              Estimate cost
            </button>
          )}
          {list.items.length > 0 && (
            <button
              className={`ra-small-btn${confirmClear ? " confirm" : ""}`}
              onClick={clearAll}
              onBlur={() => setConfirmClear(false)}
            >
              {confirmClear ? "Tap again to clear" : "Clear list"}
            </button>
          )}
        </span>
      </div>
      {price && (
        <PriceBreakdown
          est={price}
          stale={!price.loading && price.key !== estimateKey(priceItems)}
          onRefresh={estimate}
          onClose={() => setPrice(() => null)}
        />
      )}
      <div>{todo.map((i) => renderRow(i, true))}</div>
      {todo.length === 0 && <p className="ra-empty">Nothing left to get.</p>}

      {done.length > 0 && (
        <>
          <div className="ra-section-head cart">
            <span>In the cart · {done.length}</span>
            <button className="ra-small-btn" onClick={clearDone}>Clear</button>
          </div>
          {done.map((i) => renderRow(i, false))}
        </>
      )}
    </main>
  );
}
