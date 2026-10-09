// Local Business discovery via Google Places — LIVE, not stored.
//
// Google's Places policies: place IDs may be stored indefinitely, other Places content may not be cached or
// stored beyond what their terms allow. So:
//   search  → results are shown to the user and NOT saved (no candidates table)
//   import  → a lead is created with the place ID, a Google Maps link built from that ID, and the business
//             NAME the user confirms. Phone, website, address and ratings are NOT copied — open the Maps page /
//             the business website and add what you need (or use the Chrome extension).
import Lead from '../../../models/Lead.js';
import ApiError from '../../../utils/ApiError.js';
import { getEffectivePlan } from '../../billing/planResolver.js';
import { consumeQuota, releaseQuota } from '../../billing/quotaService.js';
import { getCredentials } from '../../integrations/vaultService.js';
import { PERMISSIONS as P, hasPermission } from '../../../config/permissions.js';
import { createLead } from '../leadService.js';
import { searchText, toResult, PlacesError } from './placesClient.js';

async function assertInPlan(tenantId) {
  const plan = await getEffectivePlan(tenantId);
  if (plan.code !== 'unconfigured' && !(plan.connectors || []).includes('LOCAL_BUSINESS')) {
    throw new ApiError(402, `Local business search is not included in your ${plan.name} plan. Please upgrade.`, [{ code: 'PLAN_FEATURE', field: 'source', message: 'LOCAL_BUSINESS' }]);
  }
}

export const mapsLinkFor = (placeId) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

export async function searchLocalBusinesses(auth, { query, pageToken, regionCode }) {
  await assertInPlan(auth.tenantId);
  const creds = await getCredentials('GOOGLE_PLACES', { purpose: 'discovery:local-business', actor: auth });
  if (!creds?.secrets?.apiKey) throw ApiError.badRequest('Connect the Google Places API key in Settings → Integrations first.', [{ code: 'NOT_CONNECTED', field: '', message: 'GOOGLE_PLACES' }]);

  await consumeQuota(auth.tenantId, 'discoverySearches', 1);
  let json;
  try {
    json = await searchText(creds.secrets.apiKey, { textQuery: query, pageToken, regionCode });
  } catch (err) {
    await releaseQuota(auth.tenantId, 'discoverySearches', 1);
    if (err instanceof PlacesError) throw new ApiError(err.status, err.message);
    throw err;
  }
  const results = (json.places || []).map(toResult).filter(Boolean);

  // which of these are already leads (by place ID)? colleagues' leads: existence only
  const existing = await Lead.find({ placeId: { $in: results.map((r) => r.placeId) } }).select('placeId assignedTo createdBy');
  const readAll = hasPermission(auth.role, P.LEADS_READ_ALL);
  const byPlace = new Map(existing.map((l) => [l.placeId, l]));
  for (const r of results) {
    const l = byPlace.get(r.placeId);
    if (!l) r.existing = null;
    else r.existing = readAll || [String(l.assignedTo), String(l.createdBy)].includes(auth.userId) ? { leadId: String(l._id) } : { colleague: true };
  }
  return { results, nextPageToken: typeof json.nextPageToken === 'string' ? json.nextPageToken.slice(0, 2000) : null, attribution: 'Google Maps' };
}

export async function importLocalBusinesses(auth, { places, query, city }) {
  await assertInPlan(auth.tenantId);
  let imported = 0;
  let duplicates = 0;
  let limitReached = false;
  const ids = [];
  for (const p of places) {
    if (await Lead.exists({ placeId: p.placeId })) {
      duplicates += 1;
      continue;
    }
    try {
      const lead = await createLead(auth, {
        name: p.name,
        companyName: p.name,
        city: city || null,
        source: 'LOCAL_BUSINESS',
        sourceUrl: mapsLinkFor(p.placeId),
        searchQuery: query || null,
        placeId: p.placeId,
        force: true, // same name in same city is common for chains; place ID is the real identity
      });
      ids.push(String(lead._id));
      imported += 1;
    } catch (err) {
      if (err.statusCode === 409 || err.code === 11000) duplicates += 1;
      else if (err.statusCode === 402) {
        limitReached = true;
        break;
      } else throw err;
    }
  }
  return { imported, duplicates, limitReached, ids };
}
