// Calls one of the AI functions on the server (POST /api/fn/<name>) and
// returns its JSON answer. Throws an Error whose message is the function's
// own { error } text when it sends one (sign-in needed, input too long, ...),
// so apps can show it as is.
import { apiFetch } from "./api.js";

export function callAI(functionName, body) {
  return apiFetch(`/api/fn/${encodeURIComponent(functionName)}`, { json: body ?? {} });
}
