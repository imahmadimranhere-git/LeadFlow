// PHASE 17 — email building (no database / no mail server)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmail } from '../src/services/outreach/emailBuilder.js';

const base = {
  msg: { subject: 'Website idea\r\nBcc: victim@example.com', body: 'Hi Ali,\n<script>alert(1)</script> & "quotes"' },
  lead: { email: 'ali@bakery.pk' },
  smtpConfig: { fromEmail: 'hello@techbridge.pk', fromName: 'Tech "Bridge"\r\nX-Evil: 1' },
  settings: { outreach: { emailSignature: 'Ahmad\nTechBridge', postalAddress: 'Office 2, Blue Area, Islamabad' } },
  unsubscribeUrl: 'https://api.example.com/api/v1/unsubscribe/abc.def',
};

describe('email builder', () => {
  it('no header injection: CR/LF removed from subject and from-name', () => {
    const m = buildEmail(base);
    assert.ok(!/[\r\n]/.test(m.subject));
    assert.ok(!/[\r\n]/.test(m.from));
    assert.equal(m.subject, 'Website idea Bcc: victim@example.com');
    assert.equal(m.from, '"Tech Bridge X-Evil: 1" <hello@techbridge.pk>');
    assert.equal(m.to, 'ali@bakery.pk');
  });

  it('HTML part is escaped (message text can never become HTML/script)', () => {
    const m = buildEmail(base);
    assert.ok(!m.html.includes('<script>'));
    assert.ok(m.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
    assert.ok(m.html.includes('Hi Ali,<br>'));
  });

  it('every email has an unsubscribe link (text + HTML), one-click headers, signature and postal address', () => {
    const m = buildEmail(base);
    assert.match(m.text, /Unsubscribe: https:\/\/api\.example\.com\/api\/v1\/unsubscribe\/abc\.def/);
    assert.match(m.html, /<a href="https:\/\/api\.example\.com\/api\/v1\/unsubscribe\/abc\.def">Unsubscribe<\/a>/);
    assert.equal(m.headers['List-Unsubscribe'], '<https://api.example.com/api/v1/unsubscribe/abc.def>');
    assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.match(m.text, /Ahmad\nTechBridge/);
    assert.match(m.text, /Blue Area/);
  });

  it('missing subject gets a neutral one; no from-name → plain address', () => {
    const m = buildEmail({ ...base, msg: { subject: '', body: 'Hi' }, smtpConfig: { fromEmail: 'a@b.pk' } });
    assert.equal(m.subject, 'Message from a@b.pk');
    assert.equal(m.from, 'a@b.pk');
  });
});
