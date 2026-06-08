import React from 'react';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login'; // Create this page
import Dashboard from './pages/Dashboard';
import AnalystPortal from './pages/AnalystPortal'; // For downloads

// --- PROTECTED ROUTE COMPONENT ---
const ProtectedRoute = ({ 
  children, 
  allowedRoles, 
  userProfile 
}: { 
  children: React.ReactNode, 
  allowedRoles: string[], 
  userProfile: any 
}) => {
  if (!userProfile) return null;
  
  if (!allowedRoles.includes(userProfile.role)) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>Only {allowedRoles.join(' or ')} can access this page.</p>
      </div>
    );
  }
  return <>{children}</>;
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  // If not logged in, show Login page
  if (!session) {
    return <Login />;
  }

  return (
    <div className="app-container">
      <nav className="p-4 bg-gray-800 text-white flex justify-between">
        <span>ASD-2 System | User: {profile?.username} ({profile?.role})</span>
        <button onClick={() => supabase.auth.signOut()}>Logout</button>
      </nav>

      <main className="p-6">
        {/* Dashboard: Available to everyone logged in */}
        <Dashboard />

        {/* Sensitive Section: Only Admin or Technical Analyst */}
        <ProtectedRoute 
          userProfile={profile} 
          allowedRoles={['Admin', 'Technical Analyst']}
        >
          <div className="mt-8 p-4 border-t">
            <h3>Technical Analytics & Data Download</h3>
            <button className="bg-blue-500 text-white p-2 rounded">
              Download Regional Reports
            </button>
          </div>
        </ProtectedRoute>

        {/* Technician Section: Only Admin or Technician */}
        <ProtectedRoute 
          userProfile={profile} 
          allowedRoles={['Admin', 'Technician']}
        >
          <div className="mt-8 p-4 border-t">
            <h3>Field Technician Tools</h3>
            <p>View assigned field jobs and updates.</p>
          </div>
        </ProtectedRoute>
      </main>
    </div>
  );
}
