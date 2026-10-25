export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function downloadPdf(bytes, name) {
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
}
