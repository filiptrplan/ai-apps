// Calls the site's own API (server/), signed in through the same-origin
// session cookie. Kept dependency free so index.html can import it as a
// bare ES module too.
//
//   apiFetch("/api/data/german/cards")                      → parsed JSON
//   apiFetch("/api/data/german/cards", { method: "PUT", json: { value } })
//   apiFetch("/api/storage/german-audio/…", { as: "blob" }) → Blob
//
// A response that isn't 2xx throws an Error carrying the server's
// { error } message, with `status` set. A network failure (offline)
// throws fetch's own TypeError.
export async function apiFetch(path, { json, as, headers, ...init } = {}) {
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.method ??= "POST";
    headers = { ...headers, "Content-Type": "application/json" };
  }
  const res = await fetch(path, { credentials: "same-origin", ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new Error(body?.error ?? `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  if (as === "blob") return res.blob();
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
