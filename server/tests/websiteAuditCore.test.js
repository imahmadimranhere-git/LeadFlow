// PHASE 16 — website audit logic without network/database: only OBSERVED facts, honest summary
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, robotsDisallowsHome, decodeEntities } from '../src/services/websiteAudit/htmlFacts.js';
import { runChecks, summarize, findingsText } from '../src/services/websiteAudit/auditChecks.js';

const GOOD = `<!doctype html><html lang="en"><head>
<title>Spice House — Restaurant in Lahore</title>
<meta name="description" content="Spice House serves Pakistani food in Gulberg, Lahore. Order online or book a table today.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Spice House">
<link rel="canonical" href="https://spicehouse.pk/"><link rel="icon" href="/favicon.ico">
<script type="application/ld+json">{"@type":"Restaurant"}</script>
</head><body><h1>Spice House</h1><img src="/a.jpg" alt="Food">
<a href="/menu">Menu</a> <a href="tel:+923001234567">Call us</a> <a href="https://wa.me/923001234567">WhatsApp</a>
<a class="btn" href="/order">Order online</a><footer>© 2026 Spice House</footer></body></html>`;

const BAD = `<html><head><title>Home</title><script src="http://cdn.old.example/jquery.js"></script></head>
<body><!-- <title>Hidden</title> --><img src="http://spicehouse.pk/x.jpg"><img src="b.jpg"><p>Welcome to our website &amp; more</p>
<a href="/about">About</a><a href="https://other.example/x">Other</a><a href="mailto:">x</a><div>Copyright 2016</div></body></html>`;

const NOW = new Date('2026-10-08T00:00:00Z');

describe('website audit (pure)', () => {
  it('extracts only what is in the HTML (comments ignored, entities decoded, internal links same-host only)', () => {
    const f = extractFacts(BAD, 'https://spicehouse.pk/');
    assert.equal(f.title, 'Home');
    assert.equal(f.metaDescription, null);
    assert.equal(f.images, 2);
    assert.equal(f.imagesMissingAlt, 2);
    assert.deepEqual(f.internalLinks, ['https://spicehouse.pk/about']);
    assert.deepEqual(f.mixedContent.sort(), ['http://cdn.old.example/jquery.js', 'http://spicehouse.pk/x.jpg']);
    assert.equal(f.copyrightYear, 2016);
    assert.equal(decodeEntities('a &amp; b &#39;c&#x27; &#0;'), "a & b 'c' ");
  });

  it('a GOOD website is reported as good — no invented problems', () => {
    const f = extractFacts(GOOD, 'https://spicehouse.pk/');
    const checks = runChecks(f, { finalUrl: 'https://spicehouse.pk/', responseMs: 420, htmlBytes: 3000, httpRedirectsToHttps: true, linksChecked: 2, brokenLinks: [], now: NOW });
    const s = summarize(checks, ['Website Development', 'SEO', 'Plot Sales']);
    assert.equal(checks.filter((c) => c.status === 'FAIL').length, 0, JSON.stringify(checks.filter((c) => c.status !== 'PASS')));
    assert.equal(s.looksGood, true);
    assert.match(s.summary, /^This website looks good/);
    assert.ok(s.score >= 90, `score ${s.score}`);
    assert.deepEqual(s.potentialServices, [], 'no problems → no services pushed');
  });

  it('a weak website: every problem has observed evidence; services matched from YOUR list only', () => {
    const f = extractFacts(BAD, 'http://spicehouse.pk/');
    const checks = runChecks(f, { finalUrl: 'http://spicehouse.pk/', responseMs: 5200, htmlBytes: 900, linksChecked: 1, brokenLinks: [{ url: 'http://spicehouse.pk/about', status: 404 }], now: NOW });
    const s = summarize(checks, ['Website Development', 'SEO', 'Plot Sales']);
    const failed = checks.filter((c) => c.status === 'FAIL').map((c) => c.id).sort();
    assert.deepEqual(failed, ['brokenLinks', 'description', 'https', 'speed', 'viewport']);
    assert.ok(!checks.some((c) => c.id === 'mixedContent'), 'mixed content only makes sense on https pages');
    assert.equal(checks.find((c) => c.id === 'copyright').evidence, '© 2016');
    assert.equal(s.looksGood, false);
    assert.ok(s.score < 50);
    assert.deepEqual(s.potentialServices.sort(), ['SEO', 'Website Development']);
    assert.ok(s.recommendations.length >= 5);
  });

  it('things we could not see are NOT_CHECKED (not counted as bad)', () => {
    const f = extractFacts('<html><head><title>A normal title here</title></head><body></body></html>', 'https://x.pk/');
    const checks = runChecks(f, { finalUrl: 'https://x.pk/', httpRedirectsToHttps: null, linksChecked: 0, now: NOW });
    assert.equal(checks.find((c) => c.id === 'altText').status, 'NOT_CHECKED');
    assert.equal(checks.find((c) => c.id === 'httpsRedirect').status, 'NOT_CHECKED');
    assert.equal(checks.find((c) => c.id === 'brokenLinks').status, 'NOT_CHECKED');
    assert.ok(!checks.some((c) => c.id === 'speed'), 'no measurement → no speed claim');
    assert.ok(!checks.some((c) => c.id === 'copyright'), 'no footer year → nothing said');
  });

  it('noindex is reported; hidden HTML comments are ignored', () => {
    const f = extractFacts('<html><head><meta name="robots" content="noindex, nofollow"><!-- <meta name="viewport" content="width=device-width"> --></head></html>', 'https://x.pk/');
    const checks = runChecks(f, { finalUrl: 'https://x.pk/', now: NOW });
    assert.equal(checks.find((c) => c.id === 'noindex').status, 'FAIL');
    assert.equal(checks.find((c) => c.id === 'viewport').status, 'FAIL');
  });

  it('robots.txt: respected when the site disallows everything (for * or for us)', () => {
    assert.equal(robotsDisallowsHome('User-agent: *\nDisallow: /'), true);
    assert.equal(robotsDisallowsHome('User-agent: *\nDisallow: /admin\nDisallow:'), false);
    assert.equal(robotsDisallowsHome('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /'), false);
    assert.equal(robotsDisallowsHome('User-agent: LeadFlowAuditBot\nDisallow: /\n'), true);
    assert.equal(robotsDisallowsHome(''), false);
    assert.equal(robotsDisallowsHome('User-agent: *\nDisallow: /\nAllow: /$'), true);
  });

  it('findings text for AI = only FAIL/WARN observations', () => {
    const f = extractFacts(GOOD, 'https://spicehouse.pk/');
    const t = findingsText({ checks: runChecks(f, { finalUrl: 'https://spicehouse.pk/', responseMs: 5000, now: NOW }) });
    assert.match(t, /Server response time/);
    assert.ok(!/Page title/.test(t), 'good things are not listed as problems');
  });
});
