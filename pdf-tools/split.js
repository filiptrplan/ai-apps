import { PDFDocument } from "pdf-lib";
import { loadPdfDocument } from "./pdflib.js";

// Collapses sorted-or-not 0-based page indices into "1-3, 5" style text.
export function describePages(pages) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i] + 1}-${pages[j] + 1}` : `${pages[i] + 1}`);
    i = j;
  }
  return out.join(", ");
}

// Parses one output file per line (or per ";"). Within a line, pages are
// comma-separated numbers or ranges; "8-" runs to the last page and "-3"
// starts at the first. Returns { parts: [{ pages }], error }.
export function parseRanges(text, pageCount) {
  const parts = [];
  const lines = text.split(/[\n;]/);
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l].trim();
    if (!line) continue;
    const where = `Line ${l + 1}`;
    const pages = [];
    for (const piece of line.split(",")) {
      const p = piece.trim();
      if (!p) continue;
      const m = p.match(/^(\d*)\s*[-–]\s*(\d*)$/) ?? p.match(/^(\d+)$/);
      if (!m || (m[1] === "" && m[2] === "")) return { parts, error: `${where}: “${p}” isn't a page or a range like 2-5.` };
      const start = m[1] === "" ? 1 : Number(m[1]);
      const end = m.length === 2 ? start : m[2] === "" ? pageCount : Number(m[2]);
      if (start < 1 || end < 1) return { parts, error: `${where}: pages start at 1.` };
      if (start > pageCount || end > pageCount)
        return { parts, error: `${where}: page ${Math.max(start, end)} is past the end (${pageCount} pages).` };
      if (start > end) return { parts, error: `${where}: ${start}-${end} runs backwards.` };
      for (let i = start; i <= end; i++) pages.push(i - 1);
    }
    if (pages.length) parts.push({ pages });
  }
  return { parts, error: "" };
}

// Consecutive chunks of `size` pages; the last one may be shorter.
export function everyNPages(size, pageCount) {
  const parts = [];
  for (let start = 0; start < pageCount; start += size) {
    const pages = [];
    for (let i = start; i < Math.min(start + size, pageCount); i++) pages.push(i);
    parts.push({ pages });
  }
  return parts;
}

// File names for each part, e.g. "notes-p1-3.pdf", made unique if two parts
// cover the same pages.
export function partNames(name, parts) {
  const base = name.replace(/\.pdf$/i, "");
  const seen = new Map();
  return parts.map(({ pages }) => {
    const stem = `${base}-p${describePages(pages).replace(/, /g, "_")}`;
    const n = (seen.get(stem) ?? 0) + 1;
    seen.set(stem, n);
    return `${stem}${n > 1 ? `-${n}` : ""}.pdf`;
  });
}

// Copies each part's pages into a new PDF. Page content and annotations come
// along; document-level things like bookmarks don't.
export async function splitPdf(bytes, parts) {
  const src = await loadPdfDocument(bytes);
  const outputs = [];
  for (const { pages } of parts) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pages);
    copied.forEach((p) => out.addPage(p));
    outputs.push(await out.save());
  }
  return outputs;
}
