import { UNITS, SIDES, marginsForPage, extendMargins } from "./margins.js";
import { openPdf } from "./pdfjs.js";
import { useLocalStorage } from "./useLocalStorage.js";

const { useState, useEffect, useRef } = React;

const DEFAULT_SETTINGS = {
  unit: "mm",
  margins: { top: 0, right: 50, bottom: 0, left: 0 },
  linked: false,
  mirror: false,
};

// Resolution the original page is rendered at; the preview scales it down.
const PREVIEW_PX = 1400;

function round(value, unit) {
  const decimals = unit === "in" ? 2 : 1;
  return Number(value.toFixed(decimals));
}

function toPoints(margins, unit) {
  const f = UNITS[unit].pt;
  return Object.fromEntries(SIDES.map((s) => [s, Math.max(0, Number(margins[s]) || 0) * f]));
}

function formatSize(wPt, hPt, unit) {
  const f = UNITS[unit].pt;
  return `${round(wPt / f, unit)} × ${round(hPt / f, unit)} ${unit}`;
}

function outputName(name) {
  return `${name.replace(/\.pdf$/i, "")}-margins.pdf`;
}

export function MarginExtender() {
  const [settings, setSettings] = useLocalStorage("pdf-tools-margins", DEFAULT_SETTINGS);
  const [file, setFile] = useState(null); // { name, bytes, doc }
  const [pageIndex, setPageIndex] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const { unit, margins, linked, mirror } = settings;
  const unitInfo = UNITS[unit];
  const update = (patch) => setSettings({ ...settings, ...patch });

  useEffect(() => () => file?.doc.loadingTask.destroy(), [file]);

  async function loadFile(f) {
    if (!f) return;
    setError("");
    setLoadingFile(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await openPdf(bytes);
      setFile({ name: f.name, bytes, doc });
      setPageIndex(0);
    } catch (err) {
      setError(err?.name === "PasswordException" ? "This PDF is password-protected." : "This file couldn't be opened as a PDF.");
    } finally {
      setLoadingFile(false);
    }
  }

  function setSide(side, value) {
    const v = value === "" ? "" : Number(value);
    update({ margins: linked ? { top: v, right: v, bottom: v, left: v } : { ...margins, [side]: v } });
  }

  function setUnit(next) {
    const f = UNITS[unit].pt / UNITS[next].pt;
    const converted = Object.fromEntries(SIDES.map((s) => [s, round((Number(margins[s]) || 0) * f, next)]));
    update({ unit: next, margins: converted });
  }

  function toggleLinked() {
    if (linked) return update({ linked: false });
    const v = Math.max(...SIDES.map((s) => Number(margins[s]) || 0));
    update({ linked: true, margins: { top: v, right: v, bottom: v, left: v } });
  }

  async function download() {
    setSaving(true);
    setError("");
    try {
      const out = await extendMargins(file.bytes, toPoints(margins, unit), { mirror });
      const url = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = outputName(file.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setError(err.message || "Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
  }

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    loadFile(e.dataTransfer.files[0]);
  };

  const pageMargins = marginsForPage(toPoints(margins, unit), pageIndex, mirror);
  const pageCount = file?.doc.numPages ?? 0;

  return (
    <div className="pt-tool">
      <section className="pt-controls">
        <div
          className={`pt-drop${dragging ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              loadFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
          {file ? (
            <>
              <span className="pt-filename">{file.name}</span>
              <span className="pt-muted">{pageCount} {pageCount === 1 ? "page" : "pages"}</span>
              <button className="pt-link" onClick={() => inputRef.current.click()}>Choose another</button>
            </>
          ) : (
            <>
              <span>{loadingFile ? "Opening…" : "Drop a PDF here"}</span>
              <button className="pt-primary" disabled={loadingFile} onClick={() => inputRef.current.click()}>Choose PDF</button>
            </>
          )}
        </div>

        <div className="pt-card">
          <div className="pt-row">
            <span className="pt-label">Margins to add</span>
            <div className="pt-segmented" role="group" aria-label="Unit">
              {Object.keys(UNITS).map((u) => (
                <button key={u} className={u === unit ? "on" : ""} aria-pressed={u === unit} onClick={() => setUnit(u)}>
                  {UNITS[u].label}
                </button>
              ))}
            </div>
          </div>

          {SIDES.map((side) => (
            <label className="pt-side" key={side}>
              <span className="pt-side-name">{side}</span>
              <input
                type="range"
                min="0"
                max={unitInfo.max}
                step={unitInfo.step}
                value={Math.min(Number(margins[side]) || 0, unitInfo.max)}
                onChange={(e) => setSide(side, e.target.value)}
              />
              <input
                type="number"
                min="0"
                step={unitInfo.step}
                inputMode="decimal"
                value={margins[side]}
                onChange={(e) => setSide(side, e.target.value)}
                aria-label={`${side} margin in ${unit}`}
              />
            </label>
          ))}

          <label className="pt-check">
            <input type="checkbox" checked={linked} onChange={toggleLinked} />
            Same on all sides
          </label>
          <label className="pt-check">
            <input type="checkbox" checked={mirror} onChange={() => update({ mirror: !mirror })} />
            Mirror left and right on even pages (for double-sided printing)
          </label>
        </div>

        {error && <p className="pt-error">{error}</p>}
        <button className="pt-primary" disabled={!file || saving} onClick={download}>
          {saving ? "Saving…" : "Download PDF"}
        </button>
        <p className="pt-muted pt-small">Your PDF never leaves this device. Text, links and annotations are kept as they are.</p>
      </section>

      <section className="pt-preview">
        {file ? (
          <>
            <PagePreview doc={file.doc} pageIndex={pageIndex} margins={pageMargins} unit={unit} />
            {pageCount > 1 && (
              <div className="pt-pager">
                <button onClick={() => setPageIndex(pageIndex - 1)} disabled={pageIndex === 0} aria-label="Previous page">‹</button>
                <span>Page {pageIndex + 1} of {pageCount}</span>
                <button onClick={() => setPageIndex(pageIndex + 1)} disabled={pageIndex === pageCount - 1} aria-label="Next page">›</button>
              </div>
            )}
          </>
        ) : (
          <div className="pt-placeholder">The preview shows up here.</div>
        )}
      </section>
    </div>
  );
}

// Renders the original page once, then redraws it inside the extended page
// on every margin change, so the preview keeps up while dragging a slider.
function PagePreview({ doc, pageIndex, margins, unit }) {
  const canvasRef = useRef(null);
  const [rendered, setRendered] = useState(null); // { image, width, height, scale }

  useEffect(() => {
    let cancelled = false;
    let task = null;
    setRendered(null);
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, PREVIEW_PX / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const image = document.createElement("canvas");
      image.width = Math.round(viewport.width);
      image.height = Math.round(viewport.height);
      task = page.render({ canvasContext: image.getContext("2d"), viewport });
      await task.promise;
      if (!cancelled) setRendered({ image, width: base.width, height: base.height, scale });
    })().catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rendered) return;
    const { image, scale } = rendered;
    const s = (pt) => Math.round(pt * scale);
    canvas.width = image.width + s(margins.left) + s(margins.right);
    canvas.height = image.height + s(margins.top) + s(margins.bottom);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, s(margins.left), s(margins.top));
    // Outline of the original page; it's only drawn in the preview.
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(43, 95, 217, 0.6)";
    ctx.strokeRect(s(margins.left) + 1, s(margins.top) + 1, image.width - 2, image.height - 2);
  }, [rendered, margins.top, margins.right, margins.bottom, margins.left]);

  if (!rendered) return <div className="pt-placeholder">Rendering…</div>;

  const outW = rendered.width + margins.left + margins.right;
  const outH = rendered.height + margins.top + margins.bottom;
  return (
    <>
      <div className="pt-canvas-wrap">
        <canvas ref={canvasRef} className="pt-canvas" />
      </div>
      <p className="pt-muted pt-small pt-size">
        {formatSize(rendered.width, rendered.height, unit)} → <strong>{formatSize(outW, outH, unit)}</strong>
        <span> · dashed line shows the original page (preview only)</span>
      </p>
    </>
  );
}
