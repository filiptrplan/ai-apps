// pdf.js is only used to draw previews, so it's loaded from a CDN on first use
// instead of being bundled (it ships as an ES module plus a separate worker).
const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build";

// Kept out of esbuild's sight: the URL isn't a module it should bundle, and
// the build target predates import().
const importUrl = new Function("url", "return import(url)");

let loading = null;

function loadPdfjs() {
  if (!loading) {
    loading = importUrl(`${PDFJS_URL}/pdf.min.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_URL}/pdf.worker.min.mjs`;
      return pdfjs;
    });
    loading.catch(() => (loading = null));
  }
  return loading;
}

export async function openPdf(bytes) {
  const pdfjs = await loadPdfjs();
  // pdf.js hands the buffer over to its worker, so give it a copy.
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}
