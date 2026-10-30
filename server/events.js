// Live updates over Server-Sent Events, replacing Supabase Realtime. The
// database sends a notification on the "changes" channel for every write to
// app_data and the Marsova tables (see the change_notifications migration);
// one LISTEN connection receives them and passes each on to the open pages.
//
//   GET /api/events?topics=data,mo
//
//   data: the signed-in user's own app_data writes, as
//         { table: "app_data", app_id, key, updated_at }. Needs a session.
//   mo:   Marsova changes, as { table: "mo_chores" } etc. No sign-in, like
//         the Marsova reads.
//
// Each change is a plain `message` event with the JSON as its data. A
// `resync` event means changes may have been missed (the LISTEN connection
// dropped), so pages should read their data again. A page that reconnects
// by itself should do the same.

import express from "express";
import postgres from "postgres";

const CHANNEL = "changes";
const TOPICS = ["data", "mo"];
const HEARTBEAT_MS = 25_000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

// The LISTEN connection, separate from the query pool and kept open. When
// it drops it's reopened, with backoff while the database is unreachable;
// `onResync` runs each time it's back, since notifications sent while it
// was down are lost.
export function listenForChanges(url, { onChange, onResync }) {
  let stopped = false;
  let timer = null;
  let delay = RETRY_MIN_MS;
  let listening = false;

  const sql = postgres(url, {
    max: 1,
    idle_timeout: null,
    max_lifetime: null,
    fetch_types: false,
    connection: { application_name: "ai-apps-listen" },
    onnotice: () => {},
    onnotify(channel, payload) {
      if (channel !== CHANNEL) return;
      let change;
      try {
        change = JSON.parse(payload);
      } catch {
        return;
      }
      onChange(change);
    },
    onclose() {
      if (stopped || !listening) return;
      listening = false;
      console.warn("events: LISTEN connection closed, reconnecting");
      schedule(0);
    },
  });

  function schedule(ms) {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      start(true);
    }, ms);
    timer.unref();
  }

  async function start(isRetry) {
    try {
      await sql.unsafe(`listen ${CHANNEL}`);
      listening = true;
      delay = RETRY_MIN_MS;
      if (isRetry) onResync();
    } catch (err) {
      if (stopped) return;
      console.warn(`events: LISTEN failed (${err.code ?? err.message}), retrying in ${delay / 1000} s`);
      schedule(delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    }
  }

  const ready = start(false);

  return {
    ready,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await sql.end({ timeout: 1 });
    },
  };
}

// Keeps track of the open streams and sends each change only to the
// streams allowed to see it: app_data changes to their owner's streams,
// Marsova changes to every stream that asked for them.
export function createEventHub() {
  const clients = new Set();

  function publish(change) {
    let match;
    if (change.table === "app_data") {
      // The user id is only used for routing; the page knows its own.
      const { user_id, ...rest } = change;
      if (typeof user_id !== "string") return;
      match = (c) => c.topics.has("data") && c.userId === user_id;
      change = rest;
    } else if (typeof change.table === "string" && change.table.startsWith("mo_")) {
      match = (c) => c.topics.has("mo");
    } else {
      return;
    }
    const text = `data: ${JSON.stringify(change)}\n\n`;
    for (const client of clients) if (match(client)) client.res.write(text);
  }

  function resync() {
    for (const client of clients) client.res.write("event: resync\ndata: {}\n\n");
  }

  // Ends every stream, so the server can shut down. Pages reconnect.
  function closeAll() {
    for (const client of clients) client.res.end();
    clients.clear();
  }

  const router = express.Router();

  router.get("/api/events", (req, res) => {
    const topics = new Set(String(req.query.topics ?? "").split(",").filter(Boolean));
    if (topics.size === 0 || [...topics].some((t) => !TOPICS.includes(t))) {
      return res.status(400).json({ error: `topics must be some of: ${TOPICS.join(", ")}.` });
    }
    if (topics.has("data") && !req.user) return res.status(401).json({ error: "Not signed in." });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Don't let a proxy hold events back to fill a buffer.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    // How long EventSource waits before reconnecting after a drop.
    res.write("retry: 3000\n\n");

    const client = { res, topics, userId: req.user?.id ?? null };
    clients.add(client);
    // A comment now and then, so the Cloudflare tunnel doesn't close an idle stream.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    heartbeat.unref();
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(client);
    });
  });

  return { router, publish, resync, closeAll, get size() { return clients.size; } };
}
