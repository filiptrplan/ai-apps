// Request plumbing shared by the AI edge functions: CORS, JSON responses and
// the signed-in check. Functions using serveSignedIn are deployed with
// verify_jwt = false, since the gateway's JWT check also lets through the
// public key; the check here only accepts a real user's access token.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// The signed-in user ({ id, ... }) behind the request's access token, or
// null for the public key (which is also sent as a bearer token when
// logged out) and invalid tokens.
export async function signedInUser(request: Request): Promise<{ id: string } | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: auth },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

export async function isSignedIn(request: Request) {
  return (await signedInUser(request)) !== null;
}

// Serves a POST-only JSON endpoint for signed-in users. The handler gets the
// parsed request body, the user and the request, and returns a Response
// (usually via json()).
export function serveSignedIn(
  signedOutMessage: string,
  handler: (body: any, user: { id: string }, request: Request) => Promise<Response>,
) {
  Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const user = await signedInUser(request);
    if (!user) return json({ error: signedOutMessage }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    return handler(body, user, request);
  });
}
