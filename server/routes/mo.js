// Marsova opravila's API, replacing its PostgREST reads and RPC calls. There
// is no sign-in, as before: the app is link-only, and the admin functions
// check the admin session token (p_token) themselves.
//
//   GET  /api/mo/:table  → the table's rows, in the order the app shows them
//   POST /api/mo/rpc/:fn { p_arg: value, ... } → the function's result
//
// Errors raised by the functions come back as { error: "<code>" } (e.g.
// "invalid_pin", "unauthorized"), the same codes the app already handles.

import express from "express";

// The tables the app reads, with their ordering. `single`: the app reads
// one row (PostgREST's .single()), so it's returned as an object.
const TABLES = {
  mo_categories: { order: "order by sort_order" },
  mo_chores: { order: "order by sort_order" },
  mo_rewards: { order: "order by sort_order" },
  mo_reward_requests: { order: "order by requested_at desc" },
  mo_activity_log: { order: "order by created_at desc limit 300" },
  mo_settings: { order: "", single: true },
};

// Every function marsova-opravila/api.js calls, with its parameters.
// `value`: returns a scalar (or nothing) rather than a row.
const FUNCTIONS = {
  mo_points_summary: { params: [] },
  mo_complete_chore: { params: ["p_chore_id"] },
  mo_undo_chore_completion: { params: ["p_log_id"] },
  mo_request_reward: { params: ["p_reward_id"] },
  mo_cancel_reward_request: { params: ["p_id"] },
  mo_admin_pin_status: { params: [] },
  mo_admin_bootstrap_pin: { params: ["p_pin"] },
  mo_admin_login: { params: ["p_pin"] },
  mo_admin_session_valid: { params: ["p_token"], value: true },
  mo_admin_logout: { params: ["p_token"], value: true },
  mo_admin_create_category: { params: ["p_token", "p_emoji", "p_name", "p_color"] },
  mo_admin_update_category: { params: ["p_token", "p_id", "p_emoji", "p_name", "p_color"] },
  mo_admin_reorder_categories: { params: ["p_token", "p_ids"], value: true },
  mo_admin_delete_category: { params: ["p_token", "p_id", "p_reassign_to"], value: true },
  mo_admin_create_chore: { params: ["p_token", "p_emoji", "p_title", "p_description", "p_category_id", "p_points"] },
  mo_admin_update_chore: { params: ["p_token", "p_id", "p_emoji", "p_title", "p_description", "p_category_id", "p_points"] },
  mo_admin_set_chore_active: { params: ["p_token", "p_id", "p_active"] },
  mo_admin_reorder_chores: { params: ["p_token", "p_ids"], value: true },
  mo_admin_create_reward: { params: ["p_token", "p_emoji", "p_title", "p_description", "p_cost"] },
  mo_admin_update_reward: { params: ["p_token", "p_id", "p_emoji", "p_title", "p_description", "p_cost"] },
  mo_admin_set_reward_active: { params: ["p_token", "p_id", "p_active"] },
  mo_admin_reorder_rewards: { params: ["p_token", "p_ids"], value: true },
  mo_admin_approve_request: { params: ["p_token", "p_id", "p_message"] },
  mo_admin_decline_request: { params: ["p_token", "p_id", "p_message"] },
  mo_admin_fulfill_request: { params: ["p_token", "p_id"] },
  mo_admin_adjust_points: { params: ["p_token", "p_delta"] },
  mo_admin_update_settings: { params: ["p_token", "p_display_name"] },
};

// Postgres errors that are the caller's fault: raised by the functions
// (P0001, and 28000 for "unauthorized"), a malformed uuid or number, a
// missing argument, or a check constraint.
const CLIENT_ERRORS = new Set(["P0001", "28000", "22P02", "22003", "42883", "23514", "23503"]);

export function moRoutes({ sql }) {
  const router = express.Router();

  router.get("/api/mo/:table", async (req, res) => {
    const table = Object.hasOwn(TABLES, req.params.table) && TABLES[req.params.table];
    if (!table) return res.status(404).json({ error: "not_found" });
    // Table and ordering come from TABLES, never from the request.
    const rows = await sql.unsafe(`select * from public.${req.params.table} ${table.order}`);
    res.set("Cache-Control", "no-store").json(table.single ? rows[0] ?? null : rows);
  });

  router.post("/api/mo/rpc/:fn", async (req, res) => {
    const fn = Object.hasOwn(FUNCTIONS, req.params.fn) && FUNCTIONS[req.params.fn];
    if (!fn) return res.status(404).json({ error: "not_found" });
    const args = req.body ?? {};
    if (typeof args !== "object" || Array.isArray(args)) return res.status(400).json({ error: "invalid_arguments" });
    const names = Object.keys(args);
    if (names.some((n) => !fn.params.includes(n))) return res.status(400).json({ error: "invalid_arguments" });

    // Function and argument names come from FUNCTIONS; values are parameters.
    const list = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
    const call = `public.${req.params.fn}(${list})`;
    try {
      const rows = await sql.unsafe(
        fn.value ? `select ${call} as value` : `select * from ${call}`,
        names.map((n) => args[n])
      );
      const result = fn.value ? rows[0]?.value ?? null : rows[0] ?? null;
      res.json(result === "" ? null : result);
    } catch (err) {
      if (CLIENT_ERRORS.has(err.code)) {
        return res.status(err.code === "28000" ? 401 : 400).json({ error: err.message });
      }
      throw err;
    }
  });

  return router;
}
