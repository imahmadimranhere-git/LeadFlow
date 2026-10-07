import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { FullPageLoader } from '../components/ui.jsx';

// NOTE: these only control what the UI shows. Real protection is on the server (every API checks the token).
export function ProtectedRoute({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function GuestRoute({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to="/app" replace />;
  return children;
}

/** Hides a page from users without permission (server still enforces it). */
export function RequirePermission({ permissions, children }) {
  const { can } = useAuth();
  if (permissions && !can(...permissions)) return <Navigate to="/app" replace />;
  return children;
}
