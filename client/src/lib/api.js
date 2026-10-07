import axios from 'axios';

// SECURITY: the access token lives only in this module variable (memory).
// Not in localStorage → a malicious script can't simply read it from storage,
// and it disappears when the tab closes. The long-lived refresh token is in an
// HttpOnly cookie that JavaScript cannot read at all.
const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';
let accessToken = null;
let onSessionExpired = () => {};

export const setAccessToken = (token) => {
  accessToken = token;
};
export const setSessionExpiredHandler = (fn) => {
  onSessionExpired = fn;
};

const api = axios.create({ baseURL, timeout: 15000, withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Only ONE refresh request at a time. Several parallel 401s (or React StrictMode
// running effects twice) share the same promise → no accidental "token reuse" logout.
let refreshPromise = null;
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${baseURL}/auth/refresh`, null, { withCredentials: true, timeout: 15000 })
      .then((res) => {
        setAccessToken(res.data.data.accessToken);
        return res.data.data;
      })
      .catch((err) => {
        setAccessToken(null);
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Access token expired (15 min)? Refresh once silently and retry the original request.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 402 && error.response.data?.errors?.[0]?.code === 'SUBSCRIPTION_SUSPENDED') {
      window.dispatchEvent(new Event('leadflow:subscription-suspended'));
    }
    const isAuthCall = (original?.url || '').startsWith('/auth/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        onSessionExpired();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
