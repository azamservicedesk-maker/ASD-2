import { createClient } from "@supabase/supabase-js";

// Grab variables from either Node server runtime or Vite compile-time meta environments
const SUPABASE_URL = 
  (typeof process !== "undefined" ? process.env?.SUPABASE_URL : "") || 
  (import.meta.env ? import.meta.env.VITE_SUPABASE_URL : "");

const SUPABASE_ANON_KEY = 
  (typeof process !== "undefined" ? process.env?.SUPABASE_ANON_KEY : "") || 
  (import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : "");

// Strictly fail-fast: If variables are missing, throw an error to halt compilation
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "CRITICAL INITIALIZATION ERROR: Supabase environment variables are missing! " +
    "Please verify that SUPABASE_URL and SUPABASE_ANON_KEY are declared in your Render dashboard."
  );
}

// Export the live client instance securely
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
