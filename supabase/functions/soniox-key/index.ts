// Supabase Edge Function: hands a signed-in user a short-lived Soniox API key
// for real-time speech-to-text, so the browser can stream audio straight to
// Soniox without ever seeing the real key. The temporary key only has to be
// valid when the WebSocket opens; the session itself can run longer.
//
// Needs the SONIOX_API_KEY secret:
//   supabase secrets set SONIOX_API_KEY=...
// Deploy with:
//   supabase functions deploy soniox-key

import { json, serveSignedIn } from "../_shared/http.ts";

serveSignedIn("Sign in to use dictation.", async () => {
  const apiKey = Deno.env.get("SONIOX_API_KEY");
  if (!apiKey) return json({ error: "The server has no Soniox API key configured." }, 500);

  let res;
  try {
    res = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: 60 }),
    });
  } catch {
    return json({ error: "Couldn't reach the dictation service." }, 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.api_key !== "string") {
    return json({ error: `Dictation isn't available right now (${res.status}).` }, 502);
  }
  return json({ apiKey: data.api_key });
});
