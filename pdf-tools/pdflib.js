import { PDFDocument, EncryptedPDFError } from "pdf-lib";

export async function loadPdfDocument(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError) throw new Error("This PDF is encrypted, so its pages can't be changed.");
    throw new Error("This file couldn't be read as a PDF.");
  }
}
