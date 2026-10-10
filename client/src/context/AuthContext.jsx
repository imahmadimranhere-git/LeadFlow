import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { refreshSession, setAccessToken, setSessionExpiredHandler } from '../lib/api.js';

const AuthContext = createContext(null);

const ANONYMOUS = { status: 'anonymous', user: null, tenant: null, permissions: [], access: 'NONE' };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...ANONYMOUS, status: 'loading' });

  const applySession = useCallback((data) => {
    if (data.accessToken) setAccessToken(data.accessToken);
    setState({
      status: 'authenticated',
      user: data.user,
      tenant: data.tenant,
      permissions: data.permissions || [],
      access: data.access || 'FULL', // 'BILLING_ONLY' when the company is suspended for non-payment
    });
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setState(ANONYMOUS);
  }, []);

  // On page load: try to restore the session from the HttpOnly refresh cookie
  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    let active = true;
    refreshSession()
      .then((data) => active && applySession(data))
      .catch(() => active && setState(ANONYMOUS));
    return () => {
      active = false;
    };
  }, [applySession, clearSession]);

  // An API call said "subscription suspended" → refresh who-am-I so the UI switches to billing-only mode
  useEffect(() => {
    const onSuspended = () => {
      api.get('/auth/me').then(({ data }) => applySession(data.data)).catch(() => {});
    };
    window.addEventListener('leadflow:subscription-suspended', onSuspended);
    return () => window.removeEventListener('leadflow:subscription-suspended', onSuspended);
  }, [applySession]);

  const value = useMemo(
    () => ({
      ...state,
      /** UI-only check to hide menus/buttons. The server enforces the real permission. */
      can: (...perms) => perms.some((p) => state.permissions.includes(p)),
      /** → { mfaRequired, mfaToken } when two-step login is on; otherwise logs in and returns {}. */
      async login(body) {
        const { data } = await api.post('/auth/login', body);
        if (data.data.mfaRequired) return { mfaRequired: true, mfaToken: data.data.mfaToken };
        applySession(data.data);
        return {};
      },
      async loginMfa(body) {
        const { data } = await api.post('/auth/login/mfa', body);
        applySession(data.data);
        return { recoveryCodesLeft: data.data.recoveryCodesLeft };
      },
      async register(body) {
        const { data } = await api.post('/auth/register', body);
        applySession(data.data);
      },
      async acceptInvite(body) {
        const { data } = await api.post('/invitations/accept', body);
        applySession(data.data);
      },
      async changePassword(body) {
        const { data } = await api.post('/auth/change-password', body);
        applySession(data.data); // server issued a fresh session for THIS device
      },
      async reloadMe() {
        const { data } = await api.get('/auth/me');
        applySession(data.data);
      },
      async logout() {
        try {
          await api.post('/auth/logout');
        } finally {
          clearSession();
        }
      },
      async logoutAll() {
        try {
          await api.post('/auth/logout-all');
        } finally {
          clearSession();
        }
      },
    }),
    [state, applySession, clearSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
