import { supabase } from "../shared/supabaseClient.js";

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

async function unwrap(queryPromise) {
  const { data, error } = await queryPromise;
  if (error) throw new ApiError(error.message || "unknown_error", isOffline());
  return data;
}

// ── reads ──────────────────────────────────────────────────────────────
export const fetchCategories = () =>
  unwrap(supabase.from("mo_categories").select("*").order("sort_order"));
export const fetchChores = () =>
  unwrap(supabase.from("mo_chores").select("*").order("sort_order"));
export const fetchRewards = () =>
  unwrap(supabase.from("mo_rewards").select("*").order("sort_order"));
export const fetchRewardRequests = () =>
  unwrap(supabase.from("mo_reward_requests").select("*").order("requested_at", { ascending: false }));
export const fetchActivityLog = () =>
  unwrap(supabase.from("mo_activity_log").select("*").order("created_at", { ascending: false }).limit(300));
export const fetchPointsSummary = () =>
  unwrap(supabase.rpc("mo_points_summary").single());
export const fetchSettings = () =>
  unwrap(supabase.from("mo_settings").select("*").single());

// ── user-side actions ─────────────────────────────────────────────────
export const completeChore = (choreId) =>
  unwrap(supabase.rpc("mo_complete_chore", { p_chore_id: choreId }));
export const undoChoreCompletion = (logId) =>
  unwrap(supabase.rpc("mo_undo_chore_completion", { p_log_id: logId }));
export const requestReward = (rewardId) =>
  unwrap(supabase.rpc("mo_request_reward", { p_reward_id: rewardId }));
export const cancelRewardRequest = (id) =>
  unwrap(supabase.rpc("mo_cancel_reward_request", { p_id: id }));

// ── admin auth ─────────────────────────────────────────────────────────
export const adminPinStatus = () =>
  unwrap(supabase.rpc("mo_admin_pin_status").single());
export const adminBootstrapPin = (pin) =>
  unwrap(supabase.rpc("mo_admin_bootstrap_pin", { p_pin: pin }).single());
export const adminLogin = (pin) =>
  unwrap(supabase.rpc("mo_admin_login", { p_pin: pin }).single());
export const adminSessionValid = (token) =>
  unwrap(supabase.rpc("mo_admin_session_valid", { p_token: token }));
export const adminLogout = (token) =>
  unwrap(supabase.rpc("mo_admin_logout", { p_token: token }));

// ── admin content CRUD ────────────────────────────────────────────────
export const adminCreateCategory = (token, emoji, name, color) =>
  unwrap(supabase.rpc("mo_admin_create_category", { p_token: token, p_emoji: emoji, p_name: name, p_color: color }));
export const adminUpdateCategory = (token, id, emoji, name, color) =>
  unwrap(supabase.rpc("mo_admin_update_category", { p_token: token, p_id: id, p_emoji: emoji, p_name: name, p_color: color }));
export const adminReorderCategories = (token, ids) =>
  unwrap(supabase.rpc("mo_admin_reorder_categories", { p_token: token, p_ids: ids }));
export const adminDeleteCategory = (token, id, reassignTo) =>
  unwrap(supabase.rpc("mo_admin_delete_category", { p_token: token, p_id: id, p_reassign_to: reassignTo }));

export const adminCreateChore = (token, emoji, title, description, categoryId, points) =>
  unwrap(supabase.rpc("mo_admin_create_chore", { p_token: token, p_emoji: emoji, p_title: title, p_description: description, p_category_id: categoryId, p_points: points }));
export const adminUpdateChore = (token, id, emoji, title, description, categoryId, points) =>
  unwrap(supabase.rpc("mo_admin_update_chore", { p_token: token, p_id: id, p_emoji: emoji, p_title: title, p_description: description, p_category_id: categoryId, p_points: points }));
export const adminSetChoreActive = (token, id, active) =>
  unwrap(supabase.rpc("mo_admin_set_chore_active", { p_token: token, p_id: id, p_active: active }));
export const adminReorderChores = (token, ids) =>
  unwrap(supabase.rpc("mo_admin_reorder_chores", { p_token: token, p_ids: ids }));

export const adminCreateReward = (token, emoji, title, description, cost) =>
  unwrap(supabase.rpc("mo_admin_create_reward", { p_token: token, p_emoji: emoji, p_title: title, p_description: description, p_cost: cost }));
export const adminUpdateReward = (token, id, emoji, title, description, cost) =>
  unwrap(supabase.rpc("mo_admin_update_reward", { p_token: token, p_id: id, p_emoji: emoji, p_title: title, p_description: description, p_cost: cost }));
export const adminSetRewardActive = (token, id, active) =>
  unwrap(supabase.rpc("mo_admin_set_reward_active", { p_token: token, p_id: id, p_active: active }));
export const adminReorderRewards = (token, ids) =>
  unwrap(supabase.rpc("mo_admin_reorder_rewards", { p_token: token, p_ids: ids }));

// ── admin reward-request actions ────────────────────────────────────────
export const adminApproveRequest = (token, id, message) =>
  unwrap(supabase.rpc("mo_admin_approve_request", { p_token: token, p_id: id, p_message: message }));
export const adminDeclineRequest = (token, id, message) =>
  unwrap(supabase.rpc("mo_admin_decline_request", { p_token: token, p_id: id, p_message: message }));
export const adminFulfillRequest = (token, id) =>
  unwrap(supabase.rpc("mo_admin_fulfill_request", { p_token: token, p_id: id }));

// ── admin point adjustment ────────────────────────────────────────────
export const adminAdjustPoints = (token, delta) =>
  unwrap(supabase.rpc("mo_admin_adjust_points", { p_token: token, p_delta: delta }));

// ── admin settings ─────────────────────────────────────────────────────
export const adminUpdateSettings = (token, displayName) =>
  unwrap(supabase.rpc("mo_admin_update_settings", { p_token: token, p_display_name: displayName }));

// ── realtime ───────────────────────────────────────────────────────────
// Fires `onChange({ table })` whenever any of the app's tables change, so
// callers can refetch just what they show. One shared channel per mounted
// app is enough - there's exactly one household, so no per-row filtering.
export function subscribeToChanges(onChange) {
  const channel = supabase
    .channel("marsova-opravila-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "mo_categories" }, () => onChange({ table: "mo_categories" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "mo_chores" }, () => onChange({ table: "mo_chores" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "mo_rewards" }, () => onChange({ table: "mo_rewards" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "mo_reward_requests" }, () => onChange({ table: "mo_reward_requests" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "mo_activity_log" }, () => onChange({ table: "mo_activity_log" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "mo_settings" }, () => onChange({ table: "mo_settings" }))
    .subscribe();
  return () => supabase.removeChannel(channel);
}
