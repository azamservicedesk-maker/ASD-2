// Inside your Login.tsx
const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  // Map username to the internal system email
  const internalEmail = `${username.toLowerCase()}@system.local`;
  
  const { error } = await supabase.auth.signInWithPassword({
    email: internalEmail,
    password: password,
  });

  if (error) alert(error.message);
};
