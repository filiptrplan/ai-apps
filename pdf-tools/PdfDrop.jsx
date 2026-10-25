import { openPdf } from "./pdfjs.js";

const { useState, useEffect, useRef } = React;

// The PDF a tool works on: its bytes for editing plus a pdf.js document for
// previews. `open` throws an Error with a message fit to show.
export function usePdfFile() {
  const [file, setFile] = useState(null); // { name, bytes, doc }
  const [loading, setLoading] = useState(false);

  useEffect(() => () => file?.doc.loadingTask.destroy(), [file]);

  async function open(f) {
    setLoading(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await openPdf(bytes);
      setFile({ name: f.name, bytes, doc });
    } catch (err) {
      throw new Error(err?.name === "PasswordException" ? "This PDF is password-protected." : "This file couldn't be opened as a PDF.");
    } finally {
      setLoading(false);
    }
  }

  return { file, loading, open };
}

export function PdfDrop({ file, loading, onFile }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const pageCount = file?.doc.numPages ?? 0;

  const pick = (f) => f && onFile(f);

  return (
    <div
      className={`pt-drop${dragging ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          pick(e.target.files[0]);
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
          <span>{loading ? "Opening…" : "Drop a PDF here"}</span>
          <button className="pt-primary" disabled={loading} onClick={() => inputRef.current.click()}>Choose PDF</button>
        </>
      )}
    </div>
  );
}
