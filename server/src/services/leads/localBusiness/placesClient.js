// Google Places API (New) — Text Search. Fixed host, key only in a header, through SafeFetch.
// https://developers.google.com/maps/documentation/places/web-service/text-search
import { safeFetch } from '../../../utils/safeFetch.js';

export class PlacesError extends Error {
  constructor(message, { fatal = false, status = 502 } = {}) {
    super(message);
    this.name = 'PlacesError';
    this.fatal = fatal;
    this.status = status;
  }
}

// Only the fields we show. Fewer fields = cheaper SKU (website/phone/rating are a higher tier).
export const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.googleMapsUri', 'places.businessStatus', 'places.types',
  'places.websiteUri', 'places.nationalPhoneNumber', 'places.rating', 'places.userRatingCount', 'nextPageToken',
].join(',');

let transport = async (url, { headers, body }) => {
  const res = await safeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 0 });
  return { status: res.status, json: () => res.json() };
};
export function setPlacesTransport(fn) {
  transport = fn;
}

export async function searchText(apiKey, { textQuery, pageToken, pageSize = 20, languageCode = 'en', regionCode }) {
  let res;
  try {
    res = await transport('https://places.googleapis.com/v1/places:searchText', {
      headers: { 'x-goog-api-key': apiKey, 'x-goog-fieldmask': FIELD_MASK },
      body: { textQuery, pageSize, languageCode, ...(regionCode ? { regionCode } : {}), ...(pageToken ? { pageToken } : {}) },
    });
  } catch {
    throw new PlacesError('Could not reach Google Places — try again later');
  }
  let json = {};
  try {
    json = res.json();
  } catch {
    /* ignore */
  }
  if (res.status === 400 && pageToken) throw new PlacesError('This page of results expired — search again', { status: 400 });
  if (res.status === 401 || res.status === 403) throw new PlacesError('Google rejected the API key (or Places API (New) is not enabled for it)', { fatal: true, status: 400 });
  if (res.status === 429) throw new PlacesError('Google Places quota/rate limit reached — try later', { status: 503 });
  if (res.status < 200 || res.status >= 300) throw new PlacesError('Google Places refused the request', { status: 502 });
  return json;
}

const MAPS_RX = /^https:\/\/(maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)\//i;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

/** Raw API place → what we SHOW (validated, capped). Nothing here is stored except place ID + the name the user confirms. */
export function toResult(p) {
  if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{10,300}$/.test(p.id)) return null;
  const site = str(p.websiteUri, 2048);
  return {
    placeId: p.id,
    name: str(p.displayName?.text, 150) || '(no name)',
    address: str(p.formattedAddress, 300),
    googleMapsUri: MAPS_RX.test(p.googleMapsUri || '') ? p.googleMapsUri.slice(0, 2048) : `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    websiteUri: site && /^https?:\/\//i.test(site) ? site : null,
    phone: str(p.nationalPhoneNumber, 40),
    rating: Number.isFinite(p.rating) ? p.rating : null,
    ratingCount: Number.isFinite(p.userRatingCount) ? p.userRatingCount : null,
    businessStatus: str(p.businessStatus, 30),
    types: Array.isArray(p.types) ? p.types.slice(0, 3).map((t) => str(t, 40)) : [],
  };
}
