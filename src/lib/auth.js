import { supabase } from './supabaseClient';

export const loginWithUsername = async (username, password) => {
  // We map the username to a internal email format
  const email = `${username.toLowerCase()}@system.local`;
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
};

export const logout = () => supabase.auth.signOut();
