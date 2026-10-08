// Pure helpers for pages saved from the Chrome extension (no database → easy to test).
//
// The same post can be opened with many different URLs:
//   https://instagram.com/p/ABC?igsh=xyz   https://www.instagram.com/p/ABC/   https://m.instagram.com/p/ABC/#comments
// We turn all of them into ONE canonical URL, so "Check existing lead" and duplicate detection work.

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|igsh|igshid|si|ref|ref_src|ref_url|trk|trackingid|lipi|rcm|mibextid|s|t)$/i;

const PLATFORMS = [
  ['INSTAGRAM', /(^|\.)instagram\.com$/],
  ['FACEBOOK', /(^|\.)(facebook\.com|fb\.com)$/],
  ['LINKEDIN', /(^|\.)linkedin\.com$/],
  ['X', /(^|\.)(x\.com|twitter\.com)$/],
  ['TIKTOK', /(^|\.)tiktok\.com$/],
  ['YOUTUBE', /(^|\.)(youtube\.com|youtu\.be)$/],
];

const CANONICAL_HOST = {
  INSTAGRAM: 'www.instagram.com',
  FACEBOOK: 'www.facebook.com',
  LINKEDIN: 'www.linkedin.com',
  X: 'x.com',
  TIKTOK: 'www.tiktok.com',
};

function parse(url) {
  try {
    const u = new URL(String(url).trim());
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export function detectPlatform(url) {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  return PLATFORMS.find(([, rx]) => rx.test(host))?.[0] || 'WEB';
}

/** One canonical form per page (null for anything that isn't a normal http(s) URL). */
export function canonicalPageUrl(url) {
  const u = parse(url);
  if (!u) return null;
  const platform = detectPlatform(u.toString());
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();

  if (CANONICAL_HOST[platform]) {
    u.protocol = 'https:';
    u.hostname = CANONICAL_HOST[platform];
    u.port = '';
    // Facebook's old permalink pages keep their id parameters; everything else drops the query
    const keep = platform === 'FACEBOOK' && /\/(permalink|story)\.php$/i.test(u.pathname) ? ['story_fbid', 'id'] : [];
    const params = new URLSearchParams();
    for (const k of keep) if (u.searchParams.get(k)) params.set(k, u.searchParams.get(k));
    u.search = params.toString();
    if (!u.pathname.endsWith('/') && !/\.php$/i.test(u.pathname)) u.pathname += '/';
    return u.toString().slice(0, 2048);
  }

  // Other websites: drop tracking parameters only
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  u.hostname = u.hostname.replace(/^www\./, '');
  return u.toString().replace(/\?$/, '').slice(0, 2048);
}

/** Variants to search for (with/without trailing slash). */
export function urlVariants(url) {
  const c = canonicalPageUrl(url);
  if (!c) return [];
  const noSlash = c.replace(/\/$/, '');
  return [...new Set([c, noSlash, `${noSlash}/`])];
}

/** POST, PROFILE or OTHER — from the URL shape only. */
export function guessPageKind(url) {
  const u = parse(canonicalPageUrl(url));
  if (!u) return 'OTHER';
  const platform = detectPlatform(u.toString());
  const segs = u.pathname.split('/').filter(Boolean);
  switch (platform) {
    case 'INSTAGRAM':
      if (['p', 'reel', 'reels', 'tv'].includes(segs[0])) return 'POST';
      if (segs.length === 1 && !['explore', 'accounts', 'direct', 'stories'].includes(segs[0])) return 'PROFILE';
      return 'OTHER';
    case 'LINKEDIN':
      if (segs[0] === 'posts' || (segs[0] === 'feed' && segs[1] === 'update')) return 'POST';
      if (['in', 'company'].includes(segs[0]) && segs[1]) return segs[2] === 'posts' || segs[2] === 'recent-activity' ? 'OTHER' : 'PROFILE';
      return 'OTHER';
    case 'FACEBOOK':
      if (segs.includes('posts') || segs.includes('videos') || segs.includes('photos') || /\.php$/.test(u.pathname) || segs[0] === 'groups' && segs[2] === 'posts') return 'POST';
      if (segs.length === 1 && !['groups', 'watch', 'marketplace', 'events'].includes(segs[0])) return 'PROFILE';
      return 'OTHER';
    case 'X':
      if (segs[1] === 'status') return 'POST';
      if (segs.length === 1 && !['home', 'explore', 'search', 'i', 'settings'].includes(segs[0])) return 'PROFILE';
      return 'OTHER';
    case 'TIKTOK':
      if (segs[1] === 'video') return 'POST';
      if (segs.length === 1 && segs[0].startsWith('@')) return 'PROFILE';
      return 'OTHER';
    default:
      return 'OTHER';
  }
}
