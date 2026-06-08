import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

export function useAuth(requiredRole = null) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    async function checkUser() {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      // Fetch the role from our custom profiles table
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      setUser({ ...user, role: profile?.role });

      if (requiredRole) {
        setAuthorized(profile?.role === requiredRole);
      } else {
        setAuthorized(true);
      }
      
      setLoading(false);
    }

    checkUser();
  }, [requiredRole]);

  return { user, loading, authorized };
}
