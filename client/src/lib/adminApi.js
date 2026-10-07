import axios from 'axios';

// Separate API client for the Super Admin panel.
// The admin token lives ONLY in memory: refreshing the page = log in again (with MFA).
// That is intentional — the super admin is the most powerful account on the platform.
const baseURL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1'}/super-admin`;
let adminToken = null;
let onExpired = () => {};

export const setAdminToken = (t) => {
  adminToken = t;
};
export const setAdminExpiredHandler = (fn) => {
  onExpired = fn;
};

const adminApi = axios.create({ baseURL, timeout: 15000 });

adminApi.interceptors.request.use((config) => {
  if (adminToken) config.headers.Authorization = `Bearer ${adminToken}`;
  return config;
});

adminApi.interceptors.response.use(
  (res) => res,
  (error) => {
    const isLoginCall = (error.config?.url || '').startsWith('/auth/login') || (error.config?.url || '').startsWith('/auth/mfa');
    if (error.response?.status === 401 && !isLoginCall) onExpired();
    return Promise.reject(error);
  }
);

export default adminApi;
