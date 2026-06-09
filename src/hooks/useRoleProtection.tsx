import React from "react";

// Types matching the App structures
interface User {
  id: string;
  name: string;
  username: string;
  role: string;
  region: string;
  branch?: string;
}

/**
 * Hook to inspect modern role and permission flags.
 */
export function useRole(user: User | null) {
  const currentRole = user?.role || "guest";

  const isRole = (role: string | string[]) => {
    if (Array.isArray(role)) {
      return role.includes(currentRole);
    }
    return currentRole === role;
  };

  return {
    role: currentRole,
    isRole,
    isAdmin: currentRole === "admin",
    isTechnician: currentRole === "technician",
    isManagement: currentRole === "management",
    isTechnicalAnalyst: currentRole === "technical_analyst",
    isOtcManager: currentRole === "otc_manager",
    isOtcUser: currentRole === "otc_user",
    // Permissions: Only Technical Analyst & Admin can download logs / data
    canDownloadData: currentRole === "technical_analyst" || currentRole === "admin",
    // Permissions: Only Admin, OTC Manager can see full customer updates
    canManageOtc: currentRole === "otc_manager" || currentRole === "admin",
  };
}

/**
 * Access Denied screen designed to match the beautiful deep blue/slate color theme.
 */
export function AccessDenied({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "#EEF3FF",
      fontFamily: "'DM Sans', sans-serif"
    }}>
      <div style={{
        maxWidth: 420,
        width: "100%",
        background: "#FFFFFF",
        padding: 36,
        borderRadius: 16,
        boxShadow: "0 10px 25px -5px rgba(26, 58, 143, 0.1), 0 8px 10px -6px rgba(26, 58, 143, 0.1)",
        textAlign: "center",
        border: "1px solid #E2E8F0"
      }}>
        <div style={{
          fontSize: 64,
          marginBottom: 16,
          animation: "bounce 2s infinite"
        }}>
          🛡️
        </div>
        <h2 style={{
          fontSize: 22,
          fontWeight: 800,
          color: "#0A1628",
          margin: "0 0 8px 0",
          letterSpacing: "-0.5px"
        }}>
          Access Restricted
        </h2>
        <p style={{
          fontSize: 14,
          color: "#64748B",
          lineHeight: 1.6,
          margin: "0 0 24px 0"
        }}>
          You do not have the required role permissions to view this screen. 
          Your current registered role is <strong style={{ color: "#CC1B1B", textTransform: "uppercase" }}>{user?.role || "Unknown"}</strong>.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "11px 20px",
              background: "linear-gradient(135deg, #1A3A8F, #2B52C8)",
              color: "#FFF",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(26, 58, 143, 0.2)",
              outline: "none"
            }}
          >
            Retry Validation
          </button>
          
          <button
            onClick={onLogout}
            style={{
              padding: "11px 20px",
              background: "transparent",
              color: "#1A3A8F",
              border: "1.5px solid #E2E8F0",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              outline: "none"
            }}
          >
            Sign Out & Switch User
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * High-Order Component to wrap and protect routes based on role configuration.
 */
export function withRoleProtection<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  allowedRoles: string[]
) {
  return function ProtectedRouteComponent(props: P & { user: User | null; onLogout: () => void }) {
    const { user, onLogout } = props;
    
    if (!user) {
      return <AccessDenied user={null} onLogout={onLogout} />;
    }

    const { isRole } = useRole(user);

    if (!isRole(allowedRoles)) {
      return <AccessDenied user={user} onLogout={onLogout} />;
    }

    // Role authorized, return the child view perfectly
    return <WrappedComponent {...props} />;
  };
}
