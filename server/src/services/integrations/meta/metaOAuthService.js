// "Login with Facebook" for a company's Instagram Business account.
//  start    → random state saved (hashed) for this tenant+user → browser goes to Facebook
//  callback → state checked & used once → code exchanged on the SERVER (app secret never leaves it)
//           → long-lived token encrypted into the vault → browser sent back to our app (fixed URL)
import crypto from 'node:crypto';
import env from '../../../config/env.js';
import OAuthState from '../../../models/OAuthState.js';
import TenantIntegration from '../../../models/TenantIntegration.js';
import ApiError from '../../../utils/ApiError.js';
import { encrypt, maskSecret } from '../../../utils/crypto.js';
import { runAsSystem, runWithTenant } from '../../../utils/tenantContext.js';
import { recordAudit } from '../../audit/auditService.js';
import { logSecurityEvent } from '../../../utils/securityLogger.js';
import * as meta from './metaClient.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function startMetaOAuth(auth) {
  if (!meta.isMetaConfigured()) {
    throw ApiError.badRequest('Instagram connection is not set up on this platform yet (the platform owner must add META_APP_ID / META_APP_SECRET).');
  }
  const state = crypto.randomBytes(32).toString('base64url');
  await runAsSystem('oauth:start', () =>
    OAuthState.create({ stateHash: hash(state), provider: 'META', tenantId: auth.tenantId, userId: auth.userId, expiresAt: new Date(Date.now() + STATE_TTL_MS) })
  );
  return { authUrl: meta.buildAuthUrl(state) };
}

/** Where the browser lands after the callback — always our own app, never a URL from the request. */
export function appRedirect(result, reason) {
  const url = new URL('/app/settings/integrations', env.CORS_ORIGINS[0]);
  url.searchParams.set('meta', result);
  if (reason) url.searchParams.set('reason', reason);
  return url.toString();
}

export async function handleMetaCallback({ code, state, error }, meta2 = {}) {
  if (!state || typeof state !== 'string' || state.length > 200) return appRedirect('error', 'invalid_state');

  // Single use: atomically mark the state as used
  const st = await runAsSystem('oauth:callback', () =>
    OAuthState.findOneAndUpdate(
      { stateHash: hash(state), provider: 'META', usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true }
    )
  );
  if (!st) {
    logSecurityEvent('oauth_state_rejected', { provider: 'META', ip: meta2.ip });
    return appRedirect('error', 'expired_or_invalid');
  }
  if (error || !code || typeof code !== 'string' || code.length > 2000) return appRedirect('error', 'cancelled');

  return runWithTenant({ tenantId: st.tenantId, userId: st.userId }, async () => {
    try {
      const short = await meta.exchangeCode(code);
      const long = await meta.exchangeLongLived(short.access_token);
      const accounts = await meta.listInstagramAccounts(long.access_token);
      if (!accounts.length) return appRedirect('error', 'no_instagram_business_account');

      const token = long.access_token;
      const expiresAt = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000) : null;
      const chosen = accounts[0];
      await TenantIntegration.findOneAndUpdate(
        { provider: 'META_GRAPH' },
        {
          $set: {
            provider: 'META_GRAPH',
            label: `@${chosen.igUsername}`,
            encryptedCredentials: encrypt(JSON.stringify({ userAccessToken: token })),
            maskedHints: { userAccessToken: maskSecret(token) },
            config: {
              igUserId: chosen.igUserId,
              igUsername: chosen.igUsername,
              pageId: chosen.pageId,
              pageName: chosen.pageName,
              accounts: JSON.stringify(accounts.slice(0, 20)),
              tokenExpiresAt: expiresAt ? expiresAt.toISOString() : '',
            },
            status: 'CONNECTED',
            lastTestedAt: new Date(),
            lastError: null,
            updatedBy: st.userId,
          },
          $setOnInsert: { createdBy: st.userId },
        },
        { upsert: true, new: true }
      );
      await recordAudit({ actorType: 'USER', actorId: st.userId, tenantId: st.tenantId, action: 'integration.connected', targetType: 'TenantIntegration', metadata: { provider: 'META_GRAPH', accounts: accounts.length } });
      return appRedirect('connected');
    } catch (err) {
      logSecurityEvent('oauth_failed', { provider: 'META', tenantId: String(st.tenantId), reason: err.message?.slice(0, 100) });
      return appRedirect('error', 'meta_refused');
    }
  });
}

/** Choose which of the connected Instagram accounts to use. */
export async function selectInstagramAccount(auth, igUserId) {
  const doc = await TenantIntegration.findOne({ provider: 'META_GRAPH' });
  if (!doc) throw ApiError.notFound('Instagram is not connected');
  const accounts = JSON.parse(doc.config.get('accounts') || '[]');
  const acc = accounts.find((a) => a.igUserId === igUserId);
  if (!acc) throw ApiError.badRequest('This Instagram account is not part of your connection');
  for (const [k, v] of Object.entries({ igUserId: acc.igUserId, igUsername: acc.igUsername, pageId: acc.pageId, pageName: acc.pageName })) doc.config.set(k, v);
  doc.label = `@${acc.igUsername}`;
  doc.updatedBy = auth.userId;
  await doc.save();
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'integration.updated', metadata: { provider: 'META_GRAPH', igUsername: acc.igUsername } });
  return { igUserId: acc.igUserId, igUsername: acc.igUsername };
}

/** Daily: long-lived tokens last ~60 days → warn a week before; mark expired ones. */
export async function checkMetaTokenExpiry(now = new Date()) {
  return runAsSystem('job:meta-token-expiry', async () => {
    const docs = await TenantIntegration.find({ provider: 'META_GRAPH', status: { $in: ['CONNECTED', 'NOT_TESTED'] } }).limit(5000);
    let flagged = 0;
    for (const d of docs) {
      const exp = d.config.get('tokenExpiresAt');
      if (!exp) continue;
      const left = new Date(exp).getTime() - now.getTime();
      if (left <= 0) {
        await TenantIntegration.updateOne({ _id: d._id }, { $set: { status: 'ERROR', lastError: 'Connection expired — please reconnect Instagram' } });
        flagged += 1;
      } else if (left < 7 * 24 * 60 * 60 * 1000 && !d.lastError) {
        await TenantIntegration.updateOne({ _id: d._id }, { $set: { lastError: `Expires on ${new Date(exp).toDateString()} — reconnect soon` } });
        flagged += 1;
      }
    }
    return { checked: docs.length, flagged };
  });
}
