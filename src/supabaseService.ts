import { createClient } from "@supabase/supabase-js";

// Vite builds require VITE_ prefix on client-side, while Node backend reads process.env
const SUPABASE_URL = 
  (typeof process !== "undefined" ? process.env.SUPABASE_URL : "") || 
  (import.meta.env ? import.meta.env.VITE_SUPABASE_URL : "");

const SUPABASE_ANON_KEY = 
  (typeof process !== "undefined" ? process.env.SUPABASE_ANON_KEY : "") || 
  (import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : "");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("CRITICAL: Supabase environment variables are missing!");
}

export const supabase = createClient(SUPABASE_URL || "", SUPABASE_ANON_KEY || "");

/**
 * Securely signs in a user with an email and password.
 * Supabase handles all encryption, sessions, and token management automatically.
 */
export async function secureLogin(emailInput: string, passwordInput: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailInput.trim(),
    password: passwordInput,
  });
  return { data, error };
}
