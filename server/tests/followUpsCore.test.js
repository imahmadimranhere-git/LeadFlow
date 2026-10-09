// PHASE 19 — pure helpers: company time zones ("today" in Karachi ≠ today on the UTC server) and the
// daily follow-up email (escaping, no header injection).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, zonedDayKey, dayBounds, followUpRanges, bucketOf, zonedParts } from '../src/utils/zonedTime.js';
import { buildDigestEmail } from '../src/services/followUps/digestEmail.js';

describe('Time zones', () => {
  it('"today" is the company\'s day: 01:30 in Karachi is still the previous day on the server (UTC)', () => {
    const now = new Date('2026-10-09T20:30:00Z'); // = 10 Oct 01:30 in Karachi
    assert.equal(zonedDayKey(now, 'Asia/Karachi'), '2026-10-10');
    assert.equal(zonedDayKey(now, 'UTC'), '2026-10-09');
    const k = dayBounds(now, 'Asia/Karachi');
    assert.equal(k.start.toISOString(), '2026-10-09T19:00:00.000Z');
    assert.equal(k.end.toISOString(), '2026-10-10T19:00:00.000Z');
    assert.equal(zonedParts(now, 'Asia/Karachi').hour, 1);
  });

  it('daylight-saving days are 23 / 25 hours long (London, New York)', () => {
    const spring = dayBounds(new Date('2026-03-29T12:00:00Z'), 'Europe/London');
    assert.equal((spring.end - spring.start) / 3600000, 23);
    const autumn = dayBounds(new Date('2026-11-01T15:00:00Z'), 'America/New_York');
    assert.equal((autumn.end - autumn.start) / 3600000, 25);
    assert.equal(autumn.start.toISOString(), '2026-11-01T04:00:00.000Z');
  });

  it('buckets: overdue < today < next 7 days < later (boundaries exact)', () => {
    const tz = 'Asia/Karachi';
    const now = new Date('2026-10-09T07:00:00Z'); // 12:00 Karachi
    const r = followUpRanges(now, tz);
    assert.equal(r.today.$gte.toISOString(), '2026-10-08T19:00:00.000Z');
    assert.equal(r.upcoming.$lt.toISOString(), '2026-10-16T19:00:00.000Z');
    assert.equal(bucketOf(new Date('2026-10-08T18:59:59Z'), now, tz), 'overdue');
    assert.equal(bucketOf(new Date('2026-10-08T19:00:00Z'), now, tz), 'today');
    assert.equal(bucketOf(new Date('2026-10-09T03:00:00Z'), now, tz), 'today', 'earlier today = still today, not overdue');
    assert.equal(bucketOf(new Date('2026-10-09T19:00:00Z'), now, tz), 'upcoming');
    assert.equal(bucketOf(new Date('2026-10-16T19:00:00Z'), now, tz), 'later');
    assert.equal(bucketOf(null, now, tz), null);
  });

  it('only real IANA zone names are accepted (no junk / injection)', () => {
    for (const ok of ['UTC', 'Asia/Karachi', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) assert.equal(isValidTimeZone(ok), true, ok);
    for (const bad of ['', 'Mars/Base', 'Asia/Karachi; drop', '../etc/passwd', { $ne: 1 }, 'a'.repeat(80), null]) assert.equal(isValidTimeZone(bad), false, String(bad));
  });
});

describe('Daily follow-up email', () => {
  const base = { userName: 'Sara', companyName: 'TechBridge', appUrl: 'https://app.leadflow.pk/', timezone: 'Asia/Karachi', day: '2026-10-09' };

  it('lead names / notes are escaped in HTML and can\'t add mail headers', () => {
    const mail = buildDigestEmail({ ...base, items: [{ id: 'abc', name: '<img src=x onerror=alert(1)>\r\nBcc: evil@x.com', date: new Date('2026-10-09T05:00:00Z'), note: '"><script>', overdue: false }] });
    assert.ok(!mail.html.includes('<img'), 'no HTML from data');
    assert.ok(!mail.html.includes('<script>'));
    assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.ok(!/[\r\n]/.test(mail.subject));
    assert.ok(!/\nBcc:/.test(mail.text), 'name is one line in the text part');
  });

  it('counts, overdue marker, local time and links to OUR app only', () => {
    const mail = buildDigestEmail({ ...base, items: [
      { id: 'a1', name: 'Ali Bakery', date: new Date('2026-10-08T05:00:00Z'), note: 'Send quote', overdue: true },
      { id: 'b2', name: 'Sara Salon', date: new Date('2026-10-09T06:00:00Z'), note: null, overdue: false },
    ] });
    assert.equal(mail.subject, '2 follow-ups today (1 overdue) — TechBridge');
    assert.match(mail.text, /Ali Bakery — 08 Oct, 10:00 \(OVERDUE\)\n {2}Send quote\n {2}https:\/\/app\.leadflow\.pk\/app\/leads\/a1/);
    assert.match(mail.text, /Sara Salon — 09 Oct, 11:00\n/);
    const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length === 3 && hrefs.every((h) => h.startsWith('https://app.leadflow.pk/app/')));
  });
});
