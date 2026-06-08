import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = (url && anonKey) ? createClient(url, anonKey) : null;

interface LoginProps {
  onLoginSuccess: (user: any) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError("Cloud connection offline. Local admin/tech desk fallback mode enabled.");
      return;
    }
    setLoading(true);
    setError('');

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      onLoginSuccess(data.user);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0A1628 0%, #0F2055 55%, #1A3A8F 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 24, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 }}>AZAM SERVICE DESK</div>
          <div style={{ color: "rgba(255,255,255,.4)", fontSize: 13, marginTop: 4 }}>Secure Production Sign In</div>
        </div>
        <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 16, padding: 28, border: "1px solid rgba(255,255,255,.1)" }}>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: "rgba(255,255,255,.6)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: .9, display: "block", marginBottom: 6 }}>Email Address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter email" style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 9, border: "1.5px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.08)", color: "#fff", fontSize: 14, outline: "none" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: "rgba(255,255,255,.6)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: .9, display: "block", marginBottom: 6 }}>Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 9, border: "1.5px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.08)", color: "#fff", fontSize: 14, outline: "none" }} />
            </div>
            {error && <div style={{ color: "#FCA5A5", fontSize: 12, marginBottom: 14, textAlign: "center", lineHeight: 1.5 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "12px", borderRadius: 9, border: "none", cursor: loading ? "not-allowed" : "pointer", background: "linear-gradient(135deg, #1A3A8F, #2B52C8)", color: "#fff", fontSize: 15, fontWeight: 700, opacity: loading ? .6 : 1 }}>
              {loading ? "Verifying..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
