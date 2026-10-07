import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAdminToken, setAdminExpiredHandler } from '../lib/adminApi.js';

const AdminAuthContext = createContext(null);

export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);

  const signIn = useCallback((data) => {
    setAdminToken(data.accessToken);
    setAdmin(data.admin);
  }, []);

  const signOut = useCallback(() => {
    setAdminToken(null);
    setAdmin(null);
  }, []);

  useEffect(() => {
    setAdminExpiredHandler(signOut);
  }, [signOut]);

  const value = useMemo(() => ({ admin, isAuthenticated: Boolean(admin), signIn, signOut }), [admin, signIn, signOut]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>');
  return ctx;
}
