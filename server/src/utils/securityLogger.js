// Security events (failed logins, permission denied, role changes, admin actions...).
// Written to the server log AND stored in the auditLogs collection.
import logger from '../config/logger.js';
import { recordAudit } from '../services/audit/auditService.js';

const securityLog = logger.child({ channel: 'security' });

export function logSecurityEvent(type, details = {}) {
  // Never put passwords/tokens/keys in `details` — they are also filtered before saving.
  securityLog.warn({ event: type, ...details }, `security:${type}`);

  const { actorType, actorId, userId, tenantId, targetType, targetId, ip, ...rest } = details;
  // fire-and-forget: auditing must never slow down or break the request
  void recordAudit({
    actorType: actorType || (actorId || userId ? 'USER' : 'ANONYMOUS'),
    actorId: actorId || userId || null,
    tenantId: tenantId || null,
    action: `security.${type}`,
    targetType: targetType || null,
    targetId: targetId || null,
    metadata: rest,
    ip: ip || null,
  });
}
