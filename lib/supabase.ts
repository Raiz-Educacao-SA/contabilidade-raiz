import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const configured = Boolean(url && key);
export const supabase = createClient(url || "https://example.supabase.co", key || "public-placeholder", {
  auth: { persistSession: true, autoRefreshToken: true },
});
