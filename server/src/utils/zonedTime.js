// Time-zone aware "days" without extra packages (uses the built-in Intl time-zone database).
// Why: "today's follow-ups" for a company in Karachi is a different 24 hours than in London or on the
// server (which runs in UTC). Pure functions — unit-tested.

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
  return fmtCache.get(tz);
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$|^UTC$/.test(tz)) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour === 24 ? 0 : p.hour, minute: p.minute, second: p.second };
}

/** Offset (ms) of the zone from UTC at an instant. Karachi → +5 h. */
function offsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/** "2026-10-09" — the calendar day in that zone. */
export function zonedDayKey(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The instant a local calendar day (y, m, d) starts at 00:00 in the zone. */
export function zonedMidnight(year, month, day, tz) {
  const guess = Date.UTC(year, month - 1, day);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz); // second pass handles a DST change near midnight
  return new Date(t);
}

/** Start of "today" + following day boundaries in the zone. */
export function dayBounds(now, tz, days = 1) {
  const p = zonedParts(now, tz);
  const start = zonedMidnight(p.year, p.month, p.day, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  const end = zonedMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), tz);
  return { start, end };
}

export const FOLLOW_UP_BUCKETS = ['overdue', 'today', 'upcoming', 'later'];

/** Follow-up date ranges for "now" in a company's zone: overdue < today < next 7 days < later. */
export function followUpRanges(now, tz) {
  const today = dayBounds(now, tz, 1);
  const week = dayBounds(now, tz, 8);
  return {
    overdue: { $lt: today.start },
    today: { $gte: today.start, $lt: today.end },
    upcoming: { $gte: today.end, $lt: week.end },
    later: { $gte: week.end },
  };
}

export function bucketOf(date, now, tz) {
  if (!date) return null;
  const r = followUpRanges(now, tz);
  const t = new Date(date).getTime();
  if (t < r.overdue.$lt.getTime()) return 'overdue';
  if (t < r.today.$lt.getTime()) return 'today';
  if (t < r.upcoming.$lt.getTime()) return 'upcoming';
  return 'later';
}
