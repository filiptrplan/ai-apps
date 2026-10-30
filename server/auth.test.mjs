import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import * as jose from "jose";
import { createOidcClient, safeNext } from "./auth.js";
import { setup } from "./testing.mjs";

const CLIENT_ID = "ai-apps";
const CLIENT_SECRET = "test-secret";

// A minimal OpenID provider: discovery, JWKS, and a token endpoint that
// answers codes handed out by issueCode(). It checks the client secret and
// the PKCE verifier; openid-client checks everything else.
async function startProvider() {
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map();
  const app = express();
  let issuer;

  app.get("/.well-known/openid-configuration", (req, res) =>
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    })
  );
  app.get("/jwks", (req, res) => res.json({ keys: [jwk] }));
  app.post("/token", express.urlencoded({ extended: false }), async (req, res) => {
    const basic = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString();
    const secret = req.body.client_secret ?? decodeURIComponent(basic.split(":")[1] ?? "");
    const grant = codes.get(req.body.code);
    codes.delete(req.body.code);
    const challenge = createHash("sha256").update(req.body.code_verifier ?? "").digest("base64url");
    if (secret !== CLIENT_SECRET || !grant || grant.challenge !== challenge) {
      return res.status(400).json({ error: "invalid_grant" });
    }
    const id_token = await new jose.SignJWT(grant.claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    res.json({ access_token: "at", token_type: "Bearer", expires_in: 300, id_token });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  issuer = `http://127.0.0.1:${server.address().port}`;
  return {
    issuer,
    issueCode(claims, challenge) {
      const code = randomBytes(8).toString("hex");
      codes.set(code, { claims, challenge });
      return code;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

let provider;
let t;
before(async () => {
  provider = await startProvider();
  t = await setup({
    getOidcConfig: createOidcClient({ issuer: provider.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  });
});
after(async () => {
  await t.close();
  await provider.close();
});

function cookiesOf(res) {
  return Object.fromEntries(res.headers.getSetCookie().map((c) => {
    const [pair, ...attrs] = c.split("; ");
    const i = pair.indexOf("=");
    return [pair.slice(0, i), { value: pair.slice(i + 1), attrs }];
  }));
}

// Starts a sign-in and returns what the browser would carry to Pocket ID.
async function startLogin(next = "/german") {
  const res = await t.request(`/auth/login?next=${encodeURIComponent(next)}`);
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get("location"));
  const flow = cookiesOf(res)["auth-flow"];
  return {
    url,
    flowCookie: flow,
    state: url.searchParams.get("state"),
    nonce: url.searchParams.get("nonce"),
    challenge: url.searchParams.get("code_challenge"),
    cookie: `auth-flow=${flow.value}`,
  };
}

// Pocket ID redirecting back with a code for `claims`.
function finishLogin(login, claims, { state = login.state, nonce = login.nonce, cookie = login.cookie } = {}) {
  const code = provider.issueCode({ nonce, ...claims }, login.challenge);
  return t.request(`/auth/callback?code=${code}&state=${state}`, { headers: { cookie } });
}

function sessionCookie(res) {
  const c = cookiesOf(res).session;
  return c?.value ? `session=${c.value}` : null;
}

async function sessionUser(cookie) {
  return (await (await t.request("/api/auth/session", { headers: cookie ? { cookie } : {} })).json()).user;
}

test("/auth/login sends the browser to Pocket ID with PKCE, state and nonce", async () => {
  const login = await startLogin();
  assert.equal(login.url.origin + login.url.pathname, `${provider.issuer}/authorize`);
  assert.equal(login.url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(login.url.searchParams.get("redirect_uri"), `${t.base}/auth/callback`);
  assert.equal(login.url.searchParams.get("response_type"), "code");
  assert.equal(login.url.searchParams.get("code_challenge_method"), "S256");
  assert.match(login.url.searchParams.get("scope"), /\bopenid\b.*\bemail\b/);
  assert.ok(login.state && login.nonce && login.challenge);
  assert.ok(login.flowCookie.attrs.includes("HttpOnly"));
  assert.ok(login.flowCookie.attrs.includes("SameSite=Lax"));
});

test("first sign-in links the user by email, later ones by sub", async () => {
  const id = await t.addUser("owner@example.com");
  assert.equal(await sessionUser(null), null);

  const res = await finishLogin(await startLogin("/recipes?x=1"), { sub: "sub-owner", email: "Owner@Example.com", email_verified: true });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/recipes?x=1");
  const session = cookiesOf(res).session;
  assert.ok(session.attrs.includes("HttpOnly"));
  assert.ok(session.attrs.includes("SameSite=Lax"));
  assert.ok(session.attrs.some((a) => a.startsWith("Expires=")));
  assert.equal(cookiesOf(res)["auth-flow"].value, "", "flow cookie is cleared");
  assert.deepEqual(await sessionUser(sessionCookie(res)), { id, email: "owner@example.com" });

  const [row] = await t.sql`select oidc_sub from public.users where id = ${id}`;
  assert.equal(row.oidc_sub, "sub-owner");
  const [stored] = await t.sql`select token_hash from public.sessions where user_id = ${id}`;
  assert.ok(!sessionCookie(res).includes(stored.token_hash.toString("base64url")), "only a hash is stored");

  // Once linked, the email in Pocket ID doesn't matter any more.
  const again = await finishLogin(await startLogin(), { sub: "sub-owner", email: "changed@example.com", email_verified: false });
  assert.equal(again.status, 302);
  assert.deepEqual(await sessionUser(sessionCookie(again)), { id, email: "owner@example.com" });
});

test("an unknown email, or none, gets a 403 and no session", async () => {
  for (const claims of [
    { sub: "sub-stranger", email: "stranger@example.com", email_verified: true },
    { sub: "sub-no-email" },
  ]) {
    const res = await finishLogin(await startLogin(), claims);
    assert.equal(res.status, 403, claims.sub);
    assert.equal(sessionCookie(res), null);
  }
});

test("an unverified email still links, as Pocket ID reports admin-entered emails as unverified", async () => {
  const id = await t.addUser("unverified@example.com");
  const res = await finishLogin(await startLogin(), { sub: "sub-unverified", email: "unverified@example.com", email_verified: false });
  assert.equal(res.status, 302);
  assert.equal((await sessionUser(sessionCookie(res))).id, id);
});

test("an account already linked to another sub can't be taken over by email", async () => {
  await t.addUser("linked@example.com");
  const first = await finishLogin(await startLogin(), { sub: "sub-linked", email: "linked@example.com", email_verified: true });
  assert.equal(first.status, 302);
  const other = await finishLogin(await startLogin(), { sub: "sub-impostor", email: "linked@example.com", email_verified: true });
  assert.equal(other.status, 403);
});

test("a wrong state, nonce or PKCE verifier, or no flow cookie, fails the sign-in", async () => {
  await t.addUser("checks@example.com");
  const claims = { sub: "sub-checks", email: "checks@example.com", email_verified: true };

  const login1 = await startLogin();
  const badState = await finishLogin(login1, claims, { state: "forged" });
  assert.equal(badState.status, 400);
  assert.equal(sessionCookie(badState), null);

  const badNonce = await finishLogin(await startLogin(), claims, { nonce: "forged" });
  assert.equal(badNonce.status, 400);
  assert.equal(sessionCookie(badNonce), null);

  // Another sign-in's flow cookie: the state and the PKCE verifier don't match.
  const a = await startLogin();
  const b = await startLogin();
  const swapped = await finishLogin(a, claims, { cookie: b.cookie });
  assert.equal(swapped.status, 400);

  const noCookie = await finishLogin(await startLogin(), claims, { cookie: "" });
  assert.equal(noCookie.status, 400);

  const ok = await finishLogin(await startLogin(), claims);
  assert.equal(ok.status, 302);
});

test("`next` only ever redirects within the site", async () => {
  await t.addUser("next@example.com");
  for (const next of ["//evil.example", "https://evil.example/", "/\\evil.example", "javascript:alert(1)", "german"]) {
    const res = await finishLogin(await startLogin(next), { sub: "sub-next", email: "next@example.com", email_verified: true });
    assert.equal(res.headers.get("location"), "/", next);
  }
});

test("safeNext keeps same-origin paths and drops everything else", () => {
  const base = "https://apps.example";
  assert.equal(safeNext("/german?tab=1#x", base), "/german?tab=1#x");
  assert.equal(safeNext("/", base), "/");
  for (const bad of [undefined, "", "//evil.example", "/\\evil.example", "https://evil.example", " /german", ["/german"]]) {
    assert.equal(safeNext(bad, base), "/", String(bad));
  }
});

test("logout deletes the session", async () => {
  const user = await t.signedIn();
  assert.equal((await sessionUser(user.headers.cookie)).id, user.id);
  const res = await t.request("/auth/logout", { method: "POST", headers: user.headers });
  assert.equal(res.status, 204);
  assert.equal(cookiesOf(res).session.value, "");
  assert.equal(await sessionUser(user.headers.cookie), null);
  assert.equal((await t.request("/api/data/a/b", { headers: user.headers })).status, 401);
});

test("an expired session is ignored, and a session close to expiry is renewed", async () => {
  const user = await t.signedIn();
  await t.sql`update public.sessions set expires_at = now() - interval '1 minute' where user_id = ${user.id}`;
  assert.equal(await sessionUser(user.headers.cookie), null);

  const fresh = await t.signedIn();
  await t.sql`update public.sessions set expires_at = now() + interval '2 days' where user_id = ${fresh.id}`;
  const res = await t.request("/api/auth/session", { headers: fresh.headers });
  assert.ok(cookiesOf(res).session, "cookie re-sent with the new expiry");
  const [row] = await t.sql`select expires_at from public.sessions where user_id = ${fresh.id}`;
  assert.ok(row.expires_at.getTime() > Date.now() + 29 * 24 * 3600 * 1000);
});

test("over https, cookies are Secure and __Host- prefixed", async () => {
  const https = await setup({
    publicUrl: "https://apps.example",
    getOidcConfig: createOidcClient({ issuer: provider.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  });
  try {
    const res = await https.request("/auth/login");
    const flow = cookiesOf(res)["__Host-auth-flow"];
    assert.ok(flow.attrs.includes("Secure"));
    assert.ok(flow.attrs.includes("Path=/"));
    assert.equal(new URL(res.headers.get("location")).searchParams.get("redirect_uri"), "https://apps.example/auth/callback");
    assert.equal(https.auth.SESSION_COOKIE, "__Host-session");
  } finally {
    await https.close();
  }
});

test("when Pocket ID can't be reached, /auth/login says so", async () => {
  const down = await setup({
    getOidcConfig: createOidcClient({ issuer: "http://127.0.0.1:1", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  });
  try {
    assert.equal((await down.request("/auth/login")).status, 503);
  } finally {
    await down.close();
  }
});
