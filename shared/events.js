// Live updates from the server (server/events.js), replacing Supabase
// Realtime. One EventSource per page, shared by every subscriber, and
// reopened when the set of topics or the signed-in user changes.
//
//   const stop = subscribe("data", (change) => ...);
//
// Topics: "data" for the signed-in user's own app_data writes
// ({ table: "app_data", app_id, key, updated_at }; subscribe only while
// signed in), "mo" for Marsova changes ({ table: "mo_chores" } etc.).
//
// A change of { resync: true } means some changes may have been missed (the
// connection dropped and came back), so the subscriber should read its data
// again.
import { onSessionChange } from "./auth.js";

const RETRY_MS = 30_000;

const subs = new Set();
let source = null;
let openTopics = "";
let queued = false;
let forced = false;
let retryTimer = null;

function wantedTopics() {
  return [...new Set([...subs].map((s) => s.topic))].sort().join(",");
}

function dispatch(change) {
  const topic = change.resync ? null : change.table === "app_data" ? "data" : "mo";
  for (const s of [...subs]) if (!topic || s.topic === topic) s.fn(change);
}

function open(topics) {
  clearTimeout(retryTimer);
  source?.close();
  source = null;
  openTopics = topics;
  if (!topics) return;

  const es = new EventSource(`/api/events?topics=${topics}`);
  source = es;
  // EventSource reconnects by itself after a drop; anything sent in between
  // is lost, so a reopen means a resync. The first open doesn't: subscribers
  // read their data when they start.
  let opened = false;
  es.onopen = () => {
    if (opened) dispatch({ resync: true });
    opened = true;
  };
  es.onmessage = (e) => {
    let change;
    try {
      change = JSON.parse(e.data);
    } catch {
      return;
    }
    dispatch(change);
  };
  es.addEventListener("resync", () => dispatch({ resync: true }));
  es.onerror = () => {
    // CLOSED means the server refused (e.g. 401), which EventSource doesn't
    // retry. Try again later, as a fresh stream.
    if (es.readyState !== EventSource.CLOSED || source !== es) return;
    source = null;
    openTopics = "";
    retryTimer = setTimeout(() => {
      if (opened) dispatch({ resync: true });
      update();
    }, RETRY_MS);
  };
}

// Opens, reopens or closes the stream to match the subscribers, once per
// tick, so a page subscribing several times opens it only once.
function update(force = false) {
  forced ||= force;
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const topics = wantedTopics();
    if (forced || topics !== openTopics || (topics && !source)) open(topics);
    forced = false;
  });
}

export function subscribe(topic, fn) {
  const sub = { topic, fn };
  subs.add(sub);
  update();
  return () => {
    subs.delete(sub);
    update();
  };
}

// The stream is tied to the session cookie it was opened with.
onSessionChange(() => {
  if (source) update(true);
});
