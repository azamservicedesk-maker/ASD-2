import { useRouter } from 'next/router'; // or 'next/navigation' for App Router
import { useAuth } from '../hooks/useAuth';

export function withRole(Component, allowedRole) {
  return function ProtectedRoute(props) {
    const { user, loading, authorized } = useAuth(allowedRole);
    const router = useRouter();

    if (loading) return <div>Loading...</div>;

    if (!user) {
      router.push('/login');
      return null;
    }

    if (!authorized) {
      return <div>Access Denied: You do not have the required permissions.</div>;
    }

    return <Component {...props} />;
  };
}
