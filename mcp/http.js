// HTTP side of the MCP server, mounted by worker.js at /mcp (Streamable
// HTTP, stateless: every POST is handled on its own).
//
// Auth is OAuth 2.1 with Supabase Auth as the authorization server: an
// unauthenticated request gets a 401 pointing at the protected resource
// metadata, which names Supabase Auth; the MCP client (claude.ai, using the
// pre-registered public OAuth client) then runs the authorization code flow,
// with the consent step on /oauth-consent. The resulting Supabase access
// token is used as-is for every query, so RLS scopes all data to that user.
import { createClient } from "@supabase/supabase-js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../shared/supabaseClient.js";
import { createAppData } from "./appData.js";
import { createMcpServer } from "./server.js";

export const MCP_PATH = "/mcp";
export const RESOURCE_METADATA_PATHS = [
  "/.well-known/oauth-protected-resource",
  `/.well-known/oauth-protected-resource${MCP_PATH}`,
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

function withCors(response) {
  const res = new Response(response.body, response);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

function jsonResponse(body, status = 200, headers = {}) {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  }));
}

export function handleResourceMetadata(request) {
  const origin = new URL(request.url).origin;
  return jsonResponse({
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "AI Apps",
  });
}

// The user's Supabase client and id, or null if the token is missing or
// not a valid signed-in user's token.
async function authenticate(request) {
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { token: null };
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let claims;
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (!error) claims = data?.claims;
  } catch {
    // Malformed tokens throw instead of returning an error.
  }
  const userId = claims?.sub;
  if (!userId || claims.role !== "authenticated") return { token };
  return { token, supabase, userId };
}

export async function handleMcp(request) {
  if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

  const auth = await authenticate(request);
  if (!auth.userId) {
    const origin = new URL(request.url).origin;
    const params = [`resource_metadata="${origin}${RESOURCE_METADATA_PATHS[1]}"`];
    if (auth.token) params.push('error="invalid_token"');
    return jsonResponse(
      { error: auth.token ? "invalid_token" : "unauthorized", error_description: "Sign in to use this server." },
      401,
      { "WWW-Authenticate": `Bearer ${params.join(", ")}` }
    );
  }

  // Stateless: no server-initiated SSE stream (GET) or sessions (DELETE).
  if (request.method !== "POST") {
    return withCors(new Response("Method not allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } }));
  }

  const server = createMcpServer({ appData: createAppData(auth.supabase, auth.userId) });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
}
