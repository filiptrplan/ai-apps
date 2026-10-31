// /mcp: the MCP server for the apps (mcp/server.js) over Streamable HTTP,
// stateless (every POST is handled on its own; GET and DELETE are 405).
//
// Auth is OAuth 2.1 with Pocket ID as the authorization server. A request
// without a valid token gets a 401 pointing at the protected resource
// metadata, which names Pocket ID; the MCP client (claude.ai, configured
// with the pre-registered public client ai-apps-mcp) runs the authorization
// code flow there and sends the access token as a bearer token.
//
// claude.ai asks for a token for this server (the `resource` parameter,
// RFC 8707), which Pocket ID only issues if `<PUBLIC_URL>/mcp` is set up as
// an API there and ai-apps-mcp may use it (see server/README.md); the token's
// aud is then that URL. Access tokens are RS256 JWTs (typ at+jwt) with no
// email in them, so the user is found by `sub` (users.oidc_sub), which is
// linked when they first sign in to the apps. Until then the token is refused.

import express from "express";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAppData } from "../mcp/appData.js";
import { createMcpServer } from "../mcp/server.js";

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

// What a bad token fails with, as opposed to Pocket ID being unreachable.
const TOKEN_ERRORS = [
  errors.JWTExpired, errors.JWTClaimValidationFailed, errors.JWTInvalid, errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed, errors.JOSEAlgNotAllowed, errors.JOSENotSupported,
  errors.JWKSNoMatchingKey, errors.JWKSMultipleMatchingKeys,
];

// Pocket ID's signing keys. They're kept for a day, so /mcp keeps working
// while the NAS (and Pocket ID with it) is down; a token signed with a key
// we don't have yet makes jose fetch them again.
export function pocketIdKeys(issuer) {
  return createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`), {
    cacheMaxAge: 24 * 60 * 60 * 1000,
  });
}

export class AuthUnavailableError extends Error {}

// Returns verify(token): the user ({ id, email }) the access token is for,
// or null if it isn't a valid ai-apps-mcp token for `resource` (this
// server's /mcp URL) and a known user. Throws AuthUnavailableError when the
// keys can't be fetched. Logs why a token is refused, never the token.
export function createTokenVerifier({ sql, issuer, clientId, keys, resource }) {
  const refuse = (why) => {
    console.warn(`mcp: token refused: ${why}`);
    return null;
  };
  return async function verify(token) {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, { issuer, audience: resource, typ: "at+jwt" }));
    } catch (err) {
      if (TOKEN_ERRORS.some((E) => err instanceof E)) return refuse(err.claim ? `${err.claim}: ${err.message}` : err.code);
      throw new AuthUnavailableError(err.message);
    }
    // aud only says the token is for this server, so client_id is what
    // tells an ai-apps-mcp token from one issued to another client.
    if (payload.client_id !== clientId) return refuse(`client_id is ${JSON.stringify(payload.client_id)}`);
    if (typeof payload.sub !== "string") return refuse("no sub");
    const [user] = await sql`select id, email from public.users where oidc_sub = ${payload.sub}`;
    return user ?? refuse("no user with this sub (never signed in to the apps)");
  };
}

export function mcpRoutes({ appData, storage, fn, verifyToken, publicUrl, issuer }) {
  const origin = new URL(publicUrl).origin;
  const router = express.Router();
  const paths = [MCP_PATH, ...RESOURCE_METADATA_PATHS];

  router.use(paths, (req, res, next) => {
    res.set(CORS_HEADERS);
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  router.get(RESOURCE_METADATA_PATHS, (req, res) => {
    res.json({
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      resource_name: "AI Apps",
    });
  });

  function unauthorized(res, invalid, description) {
    const params = [`resource_metadata="${origin}${RESOURCE_METADATA_PATHS[1]}"`];
    if (invalid) params.push('error="invalid_token"');
    res
      .status(401)
      .set("WWW-Authenticate", `Bearer ${params.join(", ")}`)
      .json({ error: invalid ? "invalid_token" : "unauthorized", error_description: description });
  }

  router.all(
    MCP_PATH,
    async (req, res, next) => {
      const token = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return unauthorized(res, false, "Sign in to use this server.");
      try {
        req.mcpUser = await verifyToken(token);
      } catch (err) {
        if (!(err instanceof AuthUnavailableError)) return next(err);
        console.error("mcp: can't check tokens:", err.message);
        return res.status(503).set("Retry-After", "60").json({ error: "temporarily_unavailable", error_description: "Sign-in can't be checked right now. Try again in a few minutes." });
      }
      if (!req.mcpUser) {
        return unauthorized(res, true, `Sign in to use this server. If you never have, sign in once at ${origin} first.`);
      }
      // Stateless: no server-initiated SSE stream (GET) or sessions (DELETE).
      if (req.method !== "POST") return res.status(405).set("Allow", "POST, OPTIONS").type("text").send("Method not allowed");
      next();
    },
    express.json({ limit: "4mb" }),
    async (req, res) => {
      const user = req.mcpUser;
      const server = createMcpServer({
        appData: createAppData(appData, user.id),
        removePhoto: (path) => storage.remove("recipe-photos", path.split("/"), user.id),
        callFunction: (name, body) => fn.call(name, body, user),
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }
  );

  return router;
}
