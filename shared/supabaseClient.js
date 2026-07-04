import { createClient } from "@supabase/supabase-js";

// Public client (anon/publishable) key — safe to commit, access is enforced
// by Row Level Security on the `app_data` table.
const SUPABASE_URL = "https://zqxvlczqfqmcojbgwogs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_IYIQPdhNqRWKj2SCS3pHKA_kp4jbYVr";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
