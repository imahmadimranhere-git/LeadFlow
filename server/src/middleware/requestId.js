import { randomUUID } from 'node:crypto';

// Every request gets an id → shown in error responses so we can find it in logs
export default function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  // Accept only a safe-looking incoming id; otherwise generate our own
  req.id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
