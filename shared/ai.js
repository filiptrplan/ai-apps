// Calls one of the AI edge functions in supabase/functions and returns its
// JSON answer. Throws an Error whose message is the function's own { error }
// text when it sends one (sign-in needed, input too long, ...), so apps can
// show it as is.
import { supabase } from "./supabaseClient.js";

export async function callAI(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    // Non-2xx responses carry the function's { error } message in the body.
    const details = await error.context?.json?.().catch(() => null);
    throw new Error(details?.error ?? error.message);
  }
  return data;
}
