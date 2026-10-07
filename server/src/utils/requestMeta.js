// Small, safe facts about the request for logs / sessions (no headers dump).
export const requestMeta = (req) => ({
  ip: req.ip || null,
  userAgent: (req.get('User-Agent') || '').slice(0, 200) || null,
});
