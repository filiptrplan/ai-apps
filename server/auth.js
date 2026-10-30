// Sign-in with Pocket ID (OpenID Connect, authorization code + PKCE), and
// our own session cookie after that. There are no passwords here and no
// sign-ups: Pocket ID decides who may sign in (the group on the client),
// and only users already in public.users get a session.
//
//   GET  /auth/login?next=/german  → Pocket ID
//   GET  /auth/callback            → checks state, nonce and PKCE, sets the cookie, → next
//   POST /auth/logout              → deletes the session
//   GET  /api/auth/session         → { user: { id, email } | null }

import { createHash, randomBytes } from "node:crypto";
import express from "express";
import * as oidc from "openid-client";

const SESSION_DAYS = 30;
// A session is pushed back to a full SESSION_DAYS once it has less than
// this left, so someone using the apps regularly never has to sign in again.
const RENEW_DAYS = 15;
const FLOW_SECONDS = 10 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// The Pocket ID client. Discovery runs on first use and is retried on the
// next sign-in if it fails, so the server starts even when Pocket ID is down.
export function createOidcClient({ issuer, clientId, clientSecret }) {
  let config;
  return async function getConfig() {
    if (!config) {
      const url = new URL(issuer);
      // Only tests run a provider over http.
      const options = url.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined;
      config = await oidc.discovery(url, clientId, clientSecret, undefined, options);
    }
    return config;
  };
}

function sha256(token) {
  return createHash("sha256").update(token).digest();
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!(name in out)) out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Only same-origin paths, so /auth/login can't be used as an open redirect.
export function safeNext(next, publicUrl) {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }
  try {
    const url = new URL(next, publicUrl);
    if (url.origin !== new URL(publicUrl).origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

export function createAuth({ sql, getOidcConfig, publicUrl }) {
  const secure = new URL(publicUrl).protocol === "https:";
  // __Host- cookies can't be set by other *.trplan.si sites, but need Secure,
  // so plain names are used in dev over http.
  const SESSION_COOKIE = secure ? "__Host-session" : "session";
  const FLOW_COOKIE = secure ? "__Host-auth-flow" : "auth-flow";
  const cookieOptions = { httpOnly: true, secure, sameSite: "lax", path: "/" };
  const redirectUri = new URL("/auth/callback", publicUrl).toString();

  async function createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await sql`
      insert into public.sessions (token_hash, user_id, expires_at)
      values (${sha256(token)}, ${userId}, ${expiresAt})
    `;
    return { token, expiresAt };
  }

  function setSessionCookie(res, { token, expiresAt }) {
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
  }

  // Looks up the session cookie and sets req.user ({ id, email }) or null.
  async function loadUser(req, res, next) {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    try {
      const hash = sha256(token);
      const [row] = await sql`
        select u.id, u.email, s.expires_at
        from public.sessions s join public.users u on u.id = s.user_id
        where s.token_hash = ${hash} and s.expires_at > now()
      `;
      if (row) {
        req.user = { id: row.id, email: row.email };
        if (row.expires_at.getTime() - Date.now() < RENEW_DAYS * DAY_MS) {
          const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
          await sql`update public.sessions set expires_at = ${expiresAt} where token_hash = ${hash}`;
          setSessionCookie(res, { token, expiresAt });
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Not signed in." });
    next();
  }

  // Finds the user for a Pocket ID identity: by `sub` once linked, otherwise
  // by email, linking `sub` on the way. Null if there's no such user.
  //
  // email_verified isn't required: Pocket ID reports false for emails an
  // admin entered, and only the allowed group can sign in at all. A user
  // already linked to another `sub` is never relinked by email.
  async function findUser(claims) {
    const [linked] = await sql`select id from public.users where oidc_sub = ${claims.sub}`;
    if (linked) return linked.id;
    if (typeof claims.email !== "string") return null;
    const [user] = await sql`
      update public.users set oidc_sub = ${claims.sub}
      where email = ${claims.email.toLowerCase()} and oidc_sub is null
      returning id
    `;
    return user?.id ?? null;
  }

  const router = express.Router();

  router.get("/auth/login", async (req, res) => {
    try {
      const config = await getOidcConfig();
      const flow = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        verifier: oidc.randomPKCECodeVerifier(),
        next: safeNext(req.query.next, publicUrl),
      };
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: "openid email profile",
        code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
        code_challenge_method: "S256",
        state: flow.state,
        nonce: flow.nonce,
      });
      res.cookie(FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString("base64url"), {
        ...cookieOptions,
        maxAge: FLOW_SECONDS * 1000,
      });
      res.redirect(url.toString());
    } catch (err) {
      console.error("auth: can't reach Pocket ID:", err.message);
      res.status(503).type("text").send("Sign-in is unavailable right now. Try again in a few minutes.");
    }
  });

  router.get("/auth/callback", async (req, res, next) => {
    let flow;
    try {
      flow = JSON.parse(Buffer.from(parseCookies(req.headers.cookie)[FLOW_COOKIE] ?? "", "base64url").toString());
    } catch {}
    res.clearCookie(FLOW_COOKIE, cookieOptions);
    if (!flow?.state) {
      return res.status(400).type("text").send("This sign-in link has expired. Go back and sign in again.");
    }

    let claims;
    try {
      const config = await getOidcConfig();
      const tokens = await oidc.authorizationCodeGrant(config, new URL(req.originalUrl, publicUrl), {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (err) {
      console.error("auth: sign-in failed:", err.code ?? "", err.message);
      return res.status(400).type("text").send("Sign-in failed. Go back and try again.");
    }

    try {
      const userId = await findUser(claims);
      if (!userId) {
        console.warn(`auth: no user for ${claims.email ?? "(no email)"}`);
        return res.status(403).type("text").send("This account doesn't have access to the apps.");
      }
      setSessionCookie(res, await createSession(userId));
      res.redirect(safeNext(flow.next, publicUrl));
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/logout", async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) await sql`delete from public.sessions where token_hash = ${sha256(token)}`;
      res.clearCookie(SESSION_COOKIE, cookieOptions);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/auth/session", (req, res) => {
    res.set("Cache-Control", "no-store").json({ user: req.user });
  });

  // Expired sessions are only ever skipped by loadUser; this clears them out.
  async function pruneSessions() {
    await sql`delete from public.sessions where expires_at < now()`;
  }

  return { router, loadUser, requireUser, createSession, pruneSessions, SESSION_COOKIE };
}
