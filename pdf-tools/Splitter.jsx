import { describePages, parseRanges, everyNPages, partNames, splitPdf } from "./split.js";
import { usePdfFile, PdfDrop } from "./PdfDrop.jsx";
import { downloadBlob, downloadPdf } from "./download.js";
import { zipFiles } from "./zip.js";
import { useLocalStorage } from "./useLocalStorage.js";

const { useState, useEffect, useRef } = React;

const DEFAULT_SETTINGS = { mode: "ranges", every: 1 };

// Thumbnails are rendered at this width (CSS px, doubled for sharpness).
const THUMB_PX = 150;

// Parts cycle through these so neighbouring files are easy to tell apart.
const PART_COLORS = ["#2B5FD9", "#D2602A", "#1E9468", "#9C3FC4", "#B3870F", "#CC3A68", "#2795A6", "#6E7F22"];
const partColor = (i) => PART_COLORS[i % PART_COLORS.length];

export function Splitter() {
  const [settings, setSettings] = useLocalStorage("pdf-tools-split", DEFAULT_SETTINGS);
  const { file, loading, open } = usePdfFile();
  const [ranges, setRanges] = useState("");
  const [busy, setBusy] = useState(null); // "all" or a part index
  const [error, setError] = useState("");

  const { mode, every } = settings;
  const update = (patch) => setSettings({ ...settings, ...patch });
  const pageCount = file?.doc.numPages ?? 0;
  const everyN = Math.max(1, Math.floor(Number(every)) || 1);

  const { parts, error: rangeError } = !file
    ? { parts: [], error: "" }
    : mode === "every"
      ? { parts: everyNPages(everyN, pageCount), error: "" }
      : parseRanges(ranges, pageCount);
  const names = file ? partNames(file.name, parts) : [];

  // Which parts each page ends up in, for the thumbnail badges.
  const pageParts = Array.from({ length: pageCount }, () => []);
  parts.forEach(({ pages }, i) => pages.forEach((p) => pageParts[p].includes(i) || pageParts[p].push(i)));
  const unused = pageParts.filter((p) => p.length === 0).length;

  async function loadFile(f) {
    setError("");
    try {
      await open(f);
    } catch (err) {
      setError(err.message);
    }
  }

  async function run(which, task) {
    setBusy(which);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err.message || "Something went wrong while saving.");
    } finally {
      setBusy(null);
    }
  }

  const downloadPart = (i) =>
    run(i, async () => {
      const [out] = await splitPdf(file.bytes, [parts[i]]);
      downloadPdf(out, names[i]);
    });

  const downloadAll = () =>
    run("all", async () => {
      const outs = await splitPdf(file.bytes, parts);
      if (outs.length === 1) return downloadPdf(outs[0], names[0]);
      const zip = zipFiles(outs.map((bytes, i) => ({ name: names[i], bytes })));
      downloadBlob(zip, `${file.name.replace(/\.pdf$/i, "")}-split.zip`);
    });

  const canSave = file && parts.length > 0 && !rangeError && busy === null;

  return (
    <div className="pt-tool">
      <section className="pt-controls">
        <PdfDrop file={file} loading={loading} onFile={loadFile} />

        <div className="pt-card">
          <div className="pt-row">
            <span className="pt-label">Split</span>
            <div className="pt-segmented" role="group" aria-label="Split mode">
              {[
                ["ranges", "By ranges"],
                ["every", "Every N pages"],
              ].map(([id, label]) => (
                <button key={id} className={id === mode ? "on" : ""} aria-pressed={id === mode} onClick={() => update({ mode: id })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "ranges" ? (
            <>
              <textarea
                className="pt-ranges"
                rows={5}
                value={ranges}
                onChange={(e) => setRanges(e.target.value)}
                placeholder={"1-3\n4-10\n11-"}
                spellCheck={false}
                aria-label="Page ranges, one file per line"
              />
              <p className="pt-muted pt-small">
                One file per line. Combine pages with commas, like <code>1-3, 7</code>. <code>8-</code> runs to the last page.
              </p>
            </>
          ) : (
            <label className="pt-row">
              <span>Pages per file</span>
              <input
                className="pt-num"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={every}
                onChange={(e) => update({ every: e.target.value })}
              />
            </label>
          )}
        </div>

        {(rangeError || error) && <p className="pt-error">{rangeError || error}</p>}

        {file && parts.length > 0 && !rangeError && (
          <div className="pt-card pt-files">
            <div className="pt-row">
              <span className="pt-label">
                {parts.length} {parts.length === 1 ? "file" : "files"}
              </span>
              {unused > 0 && (
                <span className="pt-muted pt-small">
                  {unused} {unused === 1 ? "page" : "pages"} left out
                </span>
              )}
            </div>
            <ol className="pt-file-list">
              {parts.map(({ pages }, i) => (
                <li key={i} className="pt-file" style={{ "--part": partColor(i) }}>
                  <span className="pt-dot" aria-hidden="true" />
                  <span className="pt-file-pages">
                    {pages.length === 1 ? "Page" : "Pages"} {describePages(pages)}
                  </span>
                  <button className="pt-link" disabled={busy !== null} onClick={() => downloadPart(i)}>
                    {busy === i ? "Saving…" : "Download"}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        <button className="pt-primary" disabled={!canSave} onClick={downloadAll}>
          {busy === "all" ? "Saving…" : parts.length > 1 ? "Download all (.zip)" : "Download PDF"}
        </button>
        <p className="pt-muted pt-small">Your PDF never leaves this device. Pages keep their text, links and annotations; bookmarks aren't carried over.</p>
      </section>

      <section className="pt-preview">
        {file ? (
          <div className="pt-thumbs">
            {pageParts.map((inParts, i) => (
              <Thumb key={i} doc={file.doc} pageIndex={i} parts={inParts} />
            ))}
          </div>
        ) : (
          <div className="pt-placeholder">Page thumbnails show up here.</div>
        )}
      </section>
    </div>
  );
}

// A page thumbnail that renders only once it scrolls into view, so long
// documents don't render every page up front.
function Thumb({ doc, pageIndex, parts }) {
  const ref = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), { rootMargin: "400px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task = null;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (THUMB_PX * 2) / base.width });
      const canvas = canvasRef.current;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      await task.promise;
      if (!cancelled) setReady(true);
    })().catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageIndex]);

  const used = parts.length > 0;
  return (
    <figure ref={ref} className={`pt-thumb${used ? "" : " unused"}`} style={used ? { "--part": partColor(parts[0]) } : undefined}>
      <div className="pt-thumb-page">
        <canvas ref={canvasRef} className={ready ? "" : "pending"} />
        {used && (
          <div className="pt-badges">
            {parts.map((p) => (
              <span key={p} className="pt-badge" style={{ "--part": partColor(p) }}>
                {p + 1}
              </span>
            ))}
          </div>
        )}
      </div>
      <figcaption className="pt-muted">{pageIndex + 1}</figcaption>
    </figure>
  );
}
