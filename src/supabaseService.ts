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

/**
 * Registers a new user securely with Supabase Auth
 * and attaches metadata that triggers automatic database syncing.
 */
export async function signUpUser(emailInput: string, passwordInput: string, usernameInput: string) {
  const { data, error } = await supabase.auth.signUp({
    email: emailInput.trim(),
    password: passwordInput,
    options: {
      data: {
        username: usernameInput.trim()
      }
    }
  });

  return { data, error };
}
