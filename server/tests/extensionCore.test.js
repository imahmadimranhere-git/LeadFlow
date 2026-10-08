// PHASE 12 — pure helpers for pages saved from the Chrome extension (no database needed)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPageUrl, detectPlatform, guessPageKind, urlVariants } from '../src/services/extension/pageUrl.js';

describe('extension page URLs', () => {
  it('the same Instagram post opened in different ways → ONE canonical URL', () => {
    const want = 'https://www.instagram.com/p/ABC123/';
    for (const u of ['https://instagram.com/p/ABC123?igsh=xyz', 'https://www.instagram.com/p/ABC123/', 'http://m.instagram.com/p/ABC123/#comments', 'https://WWW.Instagram.com/p/ABC123']) {
      assert.equal(canonicalPageUrl(u), want, u);
    }
  });

  it('LinkedIn / X / Facebook: tracking parameters removed, permalink ids kept', () => {
    assert.equal(canonicalPageUrl('https://linkedin.com/posts/ali_need-a-website-activity-1?utm_source=share&rcm=x'), 'https://www.linkedin.com/posts/ali_need-a-website-activity-1/');
    assert.equal(canonicalPageUrl('https://twitter.com/ali/status/123?s=20'), 'https://x.com/ali/status/123/');
    assert.equal(canonicalPageUrl('https://m.facebook.com/permalink.php?story_fbid=1&id=2&ref=x'), 'https://www.facebook.com/permalink.php?story_fbid=1&id=2');
  });

  it('other websites: only tracking params dropped, real params kept', () => {
    assert.equal(canonicalPageUrl('https://www.acme.pk/jobs?id=5&utm_source=fb&fbclid=1#top'), 'https://acme.pk/jobs?id=5');
    assert.equal(canonicalPageUrl('https://acme.pk/?utm_campaign=x'), 'https://acme.pk/');
  });

  it('refuses anything that is not a normal web page', () => {
    for (const u of ['javascript:alert(1)', 'chrome://settings', 'file:///C:/x', 'data:text/html,hi', 'https://user:pass@acme.pk/', 'not a url', '']) {
      assert.equal(canonicalPageUrl(u), null, u);
    }
  });

  it('detects the platform from the host (look-alike hosts are NOT matched)', () => {
    assert.equal(detectPlatform('https://www.linkedin.com/in/ali'), 'LINKEDIN');
    assert.equal(detectPlatform('https://pk.linkedin.com/in/ali'), 'LINKEDIN');
    assert.equal(detectPlatform('https://instagram.com.evil.pk/p/x'), 'WEB');
    assert.equal(detectPlatform('https://notinstagram.com/p/x'), 'WEB');
  });

  it('guesses post vs profile from the URL shape', () => {
    assert.equal(guessPageKind('https://www.instagram.com/p/ABC/'), 'POST');
    assert.equal(guessPageKind('https://www.instagram.com/ali.homes/'), 'PROFILE');
    assert.equal(guessPageKind('https://www.instagram.com/explore/'), 'OTHER');
    assert.equal(guessPageKind('https://www.linkedin.com/in/ali-khan/'), 'PROFILE');
    assert.equal(guessPageKind('https://www.linkedin.com/feed/update/urn:li:activity:1/'), 'POST');
    assert.equal(guessPageKind('https://x.com/ali/status/1'), 'POST');
    assert.equal(guessPageKind('https://acme.pk/contact'), 'OTHER');
  });

  it('variants cover with/without trailing slash', () => {
    assert.deepEqual(urlVariants('https://instagram.com/p/A').sort(), ['https://www.instagram.com/p/A', 'https://www.instagram.com/p/A/'].sort());
    assert.deepEqual(urlVariants('javascript:x'), []);
  });
});
