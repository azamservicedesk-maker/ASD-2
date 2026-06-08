import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (typeof process !== "undefined" ? process.env?.REACT_APP_SUPABASE_URL : "") || import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = (typeof process !== "undefined" ? process.env?.REACT_APP_SUPABASE_ANON_KEY : "") || import.meta.env?.VITE_SUPABASE_ANON_KEY || "";

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null as any;

export async function checkUserLogin(usernameInput: string) {
  if (!supabase) {
    console.warn("Supabase not initialized; checkUserLogin bypassed.");
    return { data: null, error: new Error("Supabase is not configured") };
  }
  const response = await supabase
    .from("users")
    .select("*")
    .eq("username", usernameInput.trim())
    .maybeSingle();
    
  return response;
}
