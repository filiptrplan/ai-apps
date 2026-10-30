import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAppData } from "../mcp/appData.js";
import { ConflictError } from "./appData.js";
import { mockFetch, setup } from "./testing.mjs";

const ISSUER = "https://id.example.test";
const CLIENT = "ai-apps-mcp";

let t;
let key; // Pocket ID's signing key
let otherKey; // anyone else's
let keysDown = false;
before(async () => {
  key = await generateKeyPair("RS256");
  otherKey = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const local = createLocalJWKSet({ keys: [jwk] });
  // Stands in for fetching Pocket ID's keys, which may fail.
  const keys = (header, token) => {
    if (keysDown) throw new TypeError("fetch failed");
    return local(header, token);
  };
  t = await setup({ mcp: { issuer: ISSUER, clientId: CLIENT, keys } });
});
after(() => t.close());

// A user linked to a Pocket ID subject, as after their first app sign-in.
async function linkedUser() {
  const sub = randomUUID();
  const id = await t.addUser(`${sub.slice(0, 8)}@example.com`);
  await t.sql`update public.users set oidc_sub = ${sub} where id = ${id}`;
  return { id, sub };
}

// An access token as Pocket ID issues it for ai-apps-mcp; `claims` and
// `options` override parts of it.
async function token(sub, claims = {}, { typ = "at+jwt", signWith = key.privateKey, expiresIn = "1h" } = {}) {
  return new SignJWT({ client_id: CLIENT, scope: "openid", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1", typ })
    .setIssuer(ISSUER)
    .setAudience([CLIENT, ISSUER])
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setJti(randomUUID())
    .sign(signWith);
}

let rpcId = 0;
function rpc(bearer, method, params = {}) {
  return t.request("/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, accept: "application/json, text/event-stream" },
    json: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
}

// Calls a tool and returns its parsed JSON answer, or { error } for a tool error.
async function tool(bearer, name, args = {}) {
  const res = await rpc(bearer, "tools/call", { name, arguments: args });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  const text = result.content[0].text;
  return result.isError ? { error: text } : JSON.parse(text);
}

const metadataLink = (base) => `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;

test("without a token: 401 pointing at the protected resource metadata", async () => {
  const res = await t.request("/mcp", { method: "POST", json: {} });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), `Bearer ${metadataLink(t.base)}`);
  assert.equal(res.headers.get("access-control-expose-headers"), "WWW-Authenticate, Mcp-Session-Id");
  assert.equal((await res.json()).error, "unauthorized");
});

test("the protected resource metadata names Pocket ID", async () => {
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const res = await t.request(path);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await res.json(), {
      resource: `${t.base}/mcp`,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ["header"],
      resource_name: "AI Apps",
    });
  }
});

test("CORS preflight is answered without a token", async () => {
  const res = await t.request("/mcp", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-headers"), /Authorization/);
});

test("a valid token lists and calls the tools as its user", async () => {
  const u = await linkedUser();
  const bearer = await token(u.sub);
  const res = await rpc(bearer, "tools/list");
  assert.equal(res.status, 200);
  const names = (await res.json()).result.tools.map((x) => x.name);
  for (const name of ["german_get_overview", "recipes_save_list", "climbing_log_workout"]) assert.ok(names.includes(name), name);

  const saved = await tool(bearer, "recipes_save_list", { name: "Party" });
  assert.equal(saved.name, "Party");
  const row = await t.appData.get(u.id, "recipes", "recipes-lists");
  assert.ok(row.value.some((l) => l.id === saved.id && l.name === "Party"));

  // And nobody else's data.
  const other = await linkedUser();
  assert.equal(await t.appData.get(other.id, "recipes", "recipes-lists"), null);
});

test("bad tokens get 401 invalid_token", async () => {
  const u = await linkedUser();
  const bad = {
    expired: await token(u.sub, {}, { expiresIn: Math.floor(Date.now() / 1000) - 60 }),
    "wrong issuer": await new SignJWT({ client_id: CLIENT })
      .setProtectedHeader({ alg: "RS256", kid: "k1", typ: "at+jwt" })
      .setIssuer("https://evil.example").setAudience([CLIENT]).setSubject(u.sub).setExpirationTime("1h")
      .sign(key.privateKey),
    "wrong audience": await new SignJWT({ client_id: CLIENT })
      .setProtectedHeader({ alg: "RS256", kid: "k1", typ: "at+jwt" })
      .setIssuer(ISSUER).setAudience(["ai-apps", ISSUER]).setSubject(u.sub).setExpirationTime("1h")
      .sign(key.privateKey),
    "the app client's token": await token(u.sub, { client_id: "ai-apps" }),
    "an ID token": await token(u.sub, {}, { typ: "JWT" }),
    "someone else's key": await token(u.sub, {}, { signWith: otherKey.privateKey }),
    "unknown subject": await token(randomUUID()),
    garbage: "not.a.jwt",
  };
  for (const [what, bearer] of Object.entries(bad)) {
    const res = await rpc(bearer, "tools/list");
    assert.equal(res.status, 401, what);
    assert.equal(res.headers.get("www-authenticate"), `Bearer ${metadataLink(t.base)}, error="invalid_token"`, what);
    assert.equal((await res.json()).error, "invalid_token", what);
  }
});

test("a user who never signed in to the apps is told to do that first", async () => {
  await t.addUser("new@example.com"); // no oidc_sub yet
  const res = await rpc(await token(randomUUID()), "tools/list");
  assert.match((await res.json()).error_description, /sign in once at/);
});

test("when Pocket ID's keys can't be fetched: 503, not a token error", async () => {
  const u = await linkedUser();
  const bearer = await token(u.sub);
  keysDown = true;
  try {
    const res = await rpc(bearer, "tools/list");
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("www-authenticate"), null);
  } finally {
    keysDown = false;
  }
  assert.equal((await rpc(bearer, "tools/list")).status, 200);
});

test("GET and DELETE are 405 (no sessions)", async () => {
  const u = await linkedUser();
  const bearer = await token(u.sub);
  for (const method of ["GET", "DELETE"]) {
    const res = await t.request("/mcp", { method, headers: { authorization: `Bearer ${bearer}` } });
    assert.equal(res.status, 405, method);
  }
});

test("deleting a recipe removes its photo from storage", async () => {
  const u = await linkedUser();
  const photo = `${u.id}/r1.webp`;
  const { token: cookie } = await t.auth.createSession(u.id);
  const headers = { cookie: `${t.auth.SESSION_COOKIE}=${cookie}` };
  await t.request(`/api/storage/recipe-photos/${photo}`, { method: "PUT", headers: { ...headers, "content-type": "image/webp" }, body: "img" });
  await t.appData.put(u.id, "recipes", "recipes-recipes", [{ id: "r1", name: "Toast", cat: "Breakfast", photo, ingredients: [], method: [] }]);

  const res = await tool(await token(u.sub), "recipes_delete", { kind: "recipe", id: "r1" });
  assert.ok(!res.error, res.error);
  assert.deepEqual((await t.appData.get(u.id, "recipes", "recipes-recipes")).value, []);
  assert.equal((await t.request(`/api/storage/recipe-photos/${photo}`, { headers })).status, 404);
});

test("tools that need AI call the function modules directly", async () => {
  const u = await linkedUser();
  process.env.OPENAI_API_KEY = "test-key";
  const option = { kind: "noun", de: "Antrag", article: "der", plural: "die Anträge", perfekt: "", separable: false, en: "the application", example: "Ich stelle einen Antrag.", sense: "" };
  const mock = mockFetch(() => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ options: [option] }) } }] }));
  try {
    const res = await tool(await token(u.sub), "german_add_cards", { words: ["application"] });
    assert.ok(!res.error, res.error);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].body.messages[1].content, "application");
  } finally {
    mock.restore();
  }
  const cards = (await t.appData.get(u.id, "german", "german-cards")).value;
  assert.deepEqual(cards.map((c) => c.de), ["Antrag"]);

  // A function's error comes back as the tool's per-word failure.
  const mock2 = mockFetch(() => new Response("", { status: 429 }));
  try {
    const res = await tool(await token(u.sub), "german_add_cards", { words: ["Haus"] });
    assert.match(JSON.stringify(res), /Too many requests/);
  } finally {
    mock2.restore();
  }
});

test("mcp/appData retries when the row changes during a tool's update", async () => {
  const u = await linkedUser();
  await t.appData.put(u.id, "recipes", "recipes-lists", ["a"]);
  // An open app saves between the tool's read and its write.
  let appSaved = false;
  const store = {
    ...t.appData,
    async put(...args) {
      if (!appSaved) {
        appSaved = true;
        await t.appData.put(u.id, "recipes", "recipes-lists", ["a", "app"]);
      }
      return t.appData.put(...args);
    },
  };
  let runs = 0;
  const result = await createAppData(store, u.id).update("recipes", "recipes-lists", [], (lists) => {
    runs++;
    return [...lists, "tool"];
  });
  // The app's save survived; the tool's change was applied on top of it.
  assert.equal(runs, 2);
  assert.deepEqual(result, ["a", "app", "tool"]);
  assert.deepEqual((await t.appData.get(u.id, "recipes", "recipes-lists")).value, ["a", "app", "tool"]);
});

test("mcp/appData creates a missing row, and gives up after repeated conflicts", async () => {
  const u = await linkedUser();
  const data = createAppData(t.appData, u.id);
  assert.deepEqual(await data.update("german", "german-cards", [], (cards) => [...cards, 1]), [1]);
  assert.deepEqual(await data.read("german", "german-cards", []), [1]);
  assert.equal(await data.read("german", "nothing", "fallback"), "fallback");

  // A store whose row changes on every write.
  const flaky = { ...t.appData, put: async () => { throw new ConflictError(); } };
  await assert.rejects(
    createAppData(flaky, u.id).update("german", "german-cards", [], (c) => [...c, 2]),
    /kept changing while saving, try again/
  );
});
