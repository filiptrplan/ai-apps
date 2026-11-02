const { useState, useEffect, useRef } = React;

// Zoom steps, relative to fitting the whole page on screen.
const ZOOMS = [1, 1.5, 2, 3];
// Keeps the rendered canvas within what browsers will reliably draw.
const MAX_PIXELS = 24_000_000;

// A full-screen view of one page, to check what's on it before splitting.
// Arrow keys flip pages, +/- zoom, Escape closes.
export function PageViewer({ doc, pageIndex, onPage, onClose, parts, partColor, activePart, onToggle, canToggle }) {
  const pageCount = doc.numPages;
  const stageRef = useRef(null);
  const holderRef = useRef(null);
  const [zoom, setZoom] = useState(0);
  const [screen, setScreen] = useState(() => [window.innerWidth, window.innerHeight]);
  const [size, setSize] = useState(null); // CSS size of the drawn page

  useEffect(() => {
    const onResize = () => setScreen([window.innerWidth, window.innerHeight]);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const go = (step) => onPage(Math.min(pageCount - 1, Math.max(0, pageIndex + step)));
  const zoomBy = (step) => setZoom((z) => Math.min(ZOOMS.length - 1, Math.max(0, z + step)));

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "-") zoomBy(-1);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => (document.body.style.overflow = prev);
  }, []);

  // Draws into a fresh canvas and swaps it in when done, so flipping pages
  // doesn't flash an empty frame.
  useEffect(() => {
    let cancelled = false;
    let task = null;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const stage = stageRef.current;
      const fit = Math.min((stage.clientWidth - 32) / base.width, (stage.clientHeight - 32) / base.height);
      const cssScale = Math.max(fit, 0.1) * ZOOMS[zoom];
      const dpr = window.devicePixelRatio || 1;
      const pixelScale = Math.min(cssScale * dpr, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale: pixelScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      await task.promise;
      if (cancelled) return;
      holderRef.current.replaceChildren(canvas);
      setSize([Math.round(base.width * cssScale), Math.round(base.height * cssScale)]);
    })().catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageIndex, zoom, screen]);

  const selected = parts.includes(activePart);

  return (
    <div className="pt-viewer" role="dialog" aria-modal="true" aria-label={`Page ${pageIndex + 1}`}>
      <div className="pt-viewer-bar">
        <span className="pt-viewer-title">
          Page {pageIndex + 1} <span className="pt-viewer-dim">of {pageCount}</span>
          {parts.map((p) => (
            <span key={p} className="pt-badge" style={{ "--part": partColor(p) }}>
              {p + 1}
            </span>
          ))}
        </span>
        <span className="pt-viewer-tools">
          <button onClick={() => zoomBy(-1)} disabled={zoom === 0} aria-label="Zoom out">−</button>
          <span className="pt-viewer-zoom">{ZOOMS[zoom] * 100}%</span>
          <button onClick={() => zoomBy(1)} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">+</button>
          <button onClick={onClose} aria-label="Close">✕</button>
        </span>
      </div>

      <div
        className={`pt-viewer-stage${zoom === ZOOMS.length - 1 ? " max" : ""}`}
        ref={stageRef}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          className="pt-viewer-page"
          ref={holderRef}
          style={size ? { width: size[0], height: size[1] } : undefined}
          onClick={() => zoomBy(zoom === ZOOMS.length - 1 ? -ZOOMS.length : 1)}
        />
      </div>

      <div className="pt-viewer-bar pt-viewer-foot">
        <button onClick={() => go(-1)} disabled={pageIndex === 0} aria-label="Previous page">‹</button>
        <button
          className="pt-viewer-toggle"
          style={{ "--part": partColor(activePart) }}
          disabled={!canToggle}
          onClick={onToggle}
        >
          <span className="pt-dot" aria-hidden="true" />
          {selected ? `Remove from file ${activePart + 1}` : `Add to file ${activePart + 1}`}
        </button>
        <button onClick={() => go(1)} disabled={pageIndex === pageCount - 1} aria-label="Next page">›</button>
      </div>
    </div>
  );
}
