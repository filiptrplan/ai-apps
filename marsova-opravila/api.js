import { apiFetch } from "../shared/api.js";
import { subscribe } from "../shared/events.js";

const ADMIN_TOKEN_KEY = "marsova_admin_token";
const ADMIN_EXPIRES_KEY = "marsova_admin_token_expires";

export function getAdminSession() {
  try {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    const expiresAt = localStorage.getItem(ADMIN_EXPIRES_KEY);
    if (!token || !expiresAt) return null;
    if (new Date(expiresAt).getTime() <= Date.now()) return null;
    return { token, expiresAt };
  } catch {
    return null;
  }
}

export function setAdminSession(token, expiresAt) {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    localStorage.setItem(ADMIN_EXPIRES_KEY, expiresAt);
  } catch {
    /* localStorage unavailable - session just won't be remembered */
  }
}

export function clearAdminSession() {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_EXPIRES_KEY);
  } catch {}
}

export class ApiError extends Error {
  constructor(code, offline) {
    super(code);
    this.code = code;
    this.offline = offline;
  }
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// The server answers errors with { error: "<code>" } (e.g. "invalid_pin"),
// the codes the functions raise.
async function call(path, args) {
  try {
    return await apiFetch(path, args === undefined ? {} : { json: args });
  } catch (err) {
    throw new ApiError(err.message || "unknown_error", isOffline());
  }
}

const table = (name) => call(`/api/mo/${name}`);
// Functions that return a row or a value come back as that row or value.
const rpc = (name, args = {}) => call(`/api/mo/rpc/${name}`, args);

// ── reads ──────────────────────────────────────────────────────────────
export const fetchCategories = () =>
  table("mo_categories");
export const fetchChores = () =>
  table("mo_chores");
export const fetchRewards = () =>
  table("mo_rewards");
export const fetchRewardRequests = () =>
  table("mo_reward_requests");
export const fetchActivityLog = () =>
  table("mo_activity_log");
export const fetchPointsSummary = () =>
  rpc("mo_points_summary");
export const fetchSettings = () =>
  table("mo_settings");

// ── user-side actions ─────────────────────────────────────────────────
export const completeChore = (choreId) =>
  rpc("mo_complete_chore", { p_chore_id: choreId });
export const undoChoreCompletion = (logId) =>
  rpc("mo_undo_chore_completion", { p_log_id: logId });
export const requestReward = (rewardId) =>
  rpc("mo_request_reward", { p_reward_id: rewardId });
export const cancelRewardRequest = (id) =>
  rpc("mo_cancel_reward_request", { p_id: id });

// ── admin auth ─────────────────────────────────────────────────────────
export const adminPinStatus = () =>
  rpc("mo_admin_pin_status");
export const adminBootstrapPin = (pin) =>
  rpc("mo_admin_bootstrap_pin", { p_pin: pin });
export const adminLogin = (pin) =>
  rpc("mo_admin_login", { p_pin: pin });
export const adminSessionValid = (token) =>
  rpc("mo_admin_session_valid", { p_token: token });
export const adminLogout = (token) =>
  rpc("mo_admin_logout", { p_token: token });

// ── admin content CRUD ────────────────────────────────────────────────
export const adminCreateCategory = (token, emoji, name, color) =>
  rpc("mo_admin_create_category", { p_token: token, p_emoji: emoji, p_name: name, p_color: color });
export const adminUpdateCategory = (token, id, emoji, name, color) =>
  rpc("mo_admin_update_category", { p_token: token, p_id: id, p_emoji: emoji, p_name: name, p_color: color });
export const adminReorderCategories = (token, ids) =>
  rpc("mo_admin_reorder_categories", { p_token: token, p_ids: ids });
export const adminDeleteCategory = (token, id, reassignTo) =>
  rpc("mo_admin_delete_category", { p_token: token, p_id: id, p_reassign_to: reassignTo });

export const adminCreateChore = (token, emoji, title, description, categoryId, points) =>
  rpc("mo_admin_create_chore", { p_token: token, p_emoji: emoji, p_title: title, p_description: description, p_category_id: categoryId, p_points: points });
export const adminUpdateChore = (token, id, emoji, title, description, categoryId, points) =>
  rpc("mo_admin_update_chore", { p_token: token, p_id: id, p_emoji: emoji, p_title: title, p_description: description, p_category_id: categoryId, p_points: points });
export const adminSetChoreActive = (token, id, active) =>
  rpc("mo_admin_set_chore_active", { p_token: token, p_id: id, p_active: active });
export const adminReorderChores = (token, ids) =>
  rpc("mo_admin_reorder_chores", { p_token: token, p_ids: ids });

export const adminCreateReward = (token, emoji, title, description, cost) =>
  rpc("mo_admin_create_reward", { p_token: token, p_emoji: emoji, p_title: title, p_description: description, p_cost: cost });
export const adminUpdateReward = (token, id, emoji, title, description, cost) =>
  rpc("mo_admin_update_reward", { p_token: token, p_id: id, p_emoji: emoji, p_title: title, p_description: description, p_cost: cost });
export const adminSetRewardActive = (token, id, active) =>
  rpc("mo_admin_set_reward_active", { p_token: token, p_id: id, p_active: active });
export const adminReorderRewards = (token, ids) =>
  rpc("mo_admin_reorder_rewards", { p_token: token, p_ids: ids });

// ── admin reward-request actions ────────────────────────────────────────
export const adminApproveRequest = (token, id, message) =>
  rpc("mo_admin_approve_request", { p_token: token, p_id: id, p_message: message });
export const adminDeclineRequest = (token, id, message) =>
  rpc("mo_admin_decline_request", { p_token: token, p_id: id, p_message: message });
export const adminFulfillRequest = (token, id) =>
  rpc("mo_admin_fulfill_request", { p_token: token, p_id: id });

// ── admin point adjustment ────────────────────────────────────────────
export const adminAdjustPoints = (token, delta) =>
  rpc("mo_admin_adjust_points", { p_token: token, p_delta: delta });

// ── admin settings ─────────────────────────────────────────────────────
export const adminUpdateSettings = (token, displayName) =>
  rpc("mo_admin_update_settings", { p_token: token, p_display_name: displayName });

// ── live updates ───────────────────────────────────────────────────────
const TABLES = ["mo_categories", "mo_chores", "mo_rewards", "mo_reward_requests", "mo_activity_log", "mo_settings"];

// Fires `onChange({ table })` whenever any of the app's tables change, so
// callers can refetch just what they show; for every table when changes may
// have been missed (the stream reconnected). One shared stream is enough -
// there's exactly one household, so no per-row filtering.
export function subscribeToChanges(onChange) {
  return subscribe("mo", (change) => {
    if (change.resync) TABLES.forEach((table) => onChange({ table }));
    else onChange({ table: change.table });
  });
}
