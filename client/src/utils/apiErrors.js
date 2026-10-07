// Turns API errors into text for the UI. React escapes it automatically (no XSS).
export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!err?.response) return 'Cannot reach the server. Is the backend running?';
  return err.response.data?.message || fallback;
}

/** { email: 'Invalid email', password: '...' } for showing under each input */
export function apiFieldErrors(err) {
  const out = {};
  for (const e of err?.response?.data?.errors || []) {
    if (e.field && !out[e.field]) out[e.field] = e.message;
  }
  return out;
}
