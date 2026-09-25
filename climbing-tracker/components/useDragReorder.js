const { useRef, useState } = React;

const EDGE = 80; // px from the viewport edge where dragging auto-scrolls

// Drag-to-reorder for lists of siblings, driven by pointer events so it works
// with touch as well as a mouse (HTML5 drag-and-drop never fires on touch
// screens). Each draggable element is tagged with data-drag-list="<list id>"
// and handleProps(listId, index) goes on its grip. While dragging, the
// element follows the pointer and its siblings slide out of the way with
// transforms only - React doesn't re-render until onDrop(listId, from, to).
// The grip also takes ArrowUp/ArrowDown for keyboard reordering.
export function useDragReorder(onDrop) {
  const drag = useRef(null);
  const [draggingList, setDraggingList] = useState(null);

  const siblings = listId => [...document.querySelectorAll(`[data-drag-list="${listId}"]`)];

  const layout = (st) => {
    const { els, rects, from, pointerY, startY } = st;
    const dy = pointerY + window.scrollY - startY;
    const self = rects[from];
    const center = self.top + self.height / 2 + dy;
    let to = 0;
    rects.forEach((r, i) => { if (i !== from && r.top + r.height / 2 < center) to++; });
    // Distance a sibling slides to fill or open the dragged element's slot.
    const shift = from < rects.length - 1 ? rects[from + 1].top - self.top : self.top - rects[from - 1].top;
    els.forEach((el, i) => {
      if (i === from) { el.style.transform = `translateY(${dy}px)`; return; }
      const offset = from < to && i > from && i <= to ? -shift : to < from && i >= to && i < from ? shift : 0;
      el.style.transform = offset ? `translateY(${offset}px)` : "";
    });
    st.to = to;
  };

  const onPointerMove = (e) => {
    const st = drag.current;
    if (!st || e.pointerId !== st.pointerId) return;
    st.pointerY = e.clientY;
    if (e.clientY < EDGE) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12);
    layout(st);
  };

  const finish = (e) => {
    const st = drag.current;
    if (!st || e.pointerId !== st.pointerId) return;
    drag.current = null;
    e.currentTarget.removeEventListener("pointermove", onPointerMove);
    st.els.forEach(el => { el.style.transform = ""; el.style.transition = ""; el.style.zIndex = ""; el.style.position = ""; el.style.boxShadow = ""; });
    setDraggingList(null);
    if (st.to !== st.from) onDrop(st.listId, st.from, st.to);
  };

  const handleProps = (listId, index) => ({
    style: { touchAction: "none", cursor: draggingList === listId ? "grabbing" : "grab" },
    onPointerDown: (e) => {
      if (e.button !== 0 || drag.current) return;
      e.preventDefault();
      const els = siblings(listId);
      if (els.length < 2) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.addEventListener("pointermove", onPointerMove);
      els.forEach((el, i) => {
        el.style.transition = i === index ? "none" : "transform .15s ease";
        if (i === index) Object.assign(el.style, { position: "relative", zIndex: 20, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" });
      });
      drag.current = {
        listId, els, from: index, to: index, pointerId: e.pointerId,
        startY: e.clientY + window.scrollY, pointerY: e.clientY,
        rects: els.map(el => { const r = el.getBoundingClientRect(); return { top: r.top + window.scrollY, height: r.height }; }),
      };
      setDraggingList(listId);
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onKeyDown: (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const to = index + (e.key === "ArrowUp" ? -1 : 1);
        if (to >= 0 && to < siblings(listId).length) onDrop(listId, index, to);
      }
    },
  });

  return { handleProps, draggingList };
}
