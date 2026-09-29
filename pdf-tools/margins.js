import { PDFDocument, EncryptedPDFError } from "pdf-lib";

export const UNITS = {
  mm: { label: "mm", pt: 72 / 25.4, max: 100, step: 1 },
  in: { label: "in", pt: 72, max: 4, step: 0.05 },
  pt: { label: "pt", pt: 1, max: 288, step: 1 },
};

export const SIDES = ["top", "right", "bottom", "left"];

// Margins as seen on page `index` (0-based). With `mirror`, left and right
// swap on even page numbers so the extra space stays on the outer (or inner)
// edge of a bound double-sided print.
export function marginsForPage(margins, index, mirror) {
  if (mirror && index % 2 === 1) return { ...margins, left: margins.right, right: margins.left };
  return margins;
}

// Maps margins as the page is displayed to the sides of the unrotated page
// box. /Rotate turns the page clockwise for display, so with 90° the box's
// left edge ends up on top, its top edge on the right, and so on.
function toBoxSides({ top, right, bottom, left }, rotation) {
  switch (rotation) {
    case 90:
      return { left: top, top: right, right: bottom, bottom: left };
    case 180:
      return { left: right, top: bottom, right: left, bottom: top };
    case 270:
      return { left: bottom, top: left, right: top, bottom: right };
    default:
      return { left, top, right, bottom };
  }
}

// Grows every page's boxes outwards by the given margins (in points). The
// page content isn't touched, so text, links and annotations all survive;
// viewers and printers show the new area as blank paper.
export async function extendMargins(bytes, margins, { mirror = false } = {}) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError) throw new Error("This PDF is encrypted, so its pages can't be changed.");
    throw new Error("This file couldn't be read as a PDF.");
  }

  doc.getPages().forEach((page, i) => {
    const rotation = (((page.getRotation().angle % 360) + 360) % 360);
    const m = toBoxSides(marginsForPage(margins, i, mirror), rotation);
    const box = page.getCropBox();
    const x = box.x - m.left;
    const y = box.y - m.bottom;
    const width = box.width + m.left + m.right;
    const height = box.height + m.top + m.bottom;
    page.setMediaBox(x, y, width, height);
    page.setCropBox(x, y, width, height);
    // Keep print boxes in step so a print shop doesn't trim the margins off.
    page.setBleedBox(x, y, width, height);
    page.setTrimBox(x, y, width, height);
  });

  return doc.save();
}
