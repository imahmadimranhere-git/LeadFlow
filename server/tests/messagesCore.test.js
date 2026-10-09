// PHASE 15 — templates + message safety checks (no database)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectTemplate, templateContext, renderTemplate } from '../src/services/messages/templateRender.js';
import { checkMessage } from '../src/services/messages/messageChecks.js';

describe('templates', () => {
  it('finds variables, refuses unknown ones and broken braces', () => {
    const r = inspectTemplate('Hi {{firstName|there}}, {{companyName}} {{password}} {{ city }}');
    assert.deepEqual(r.used.sort(), ['city', 'companyName', 'firstName']);
    assert.deepEqual(r.unknown, ['password']);
    assert.equal(inspectTemplate('Hi {{firstName').broken, true);
    assert.equal(inspectTemplate('Hi {firstName}}').broken, true);
    assert.equal(inspectTemplate('Hi {{firstName}}').broken, false);
  });

  it('renders plain text; fallback when empty; missing values stay visible (never silently blank)', () => {
    const ctx = templateContext({ lead: { personName: 'Ali Khan', companyName: '', city: 'Lahore' }, company: { name: 'TechBridge' } });
    const r = renderTemplate('Hi {{firstName}}, {{companyName|your team}} in {{city}} — {{myCompany}} / {{industry}}', ctx);
    assert.equal(r.text, 'Hi Ali, your team in Lahore — TechBridge / {{industry}}');
    assert.deepEqual(r.missing, ['industry']);
  });

  it('{{evidence}} only from REAL evidence (no fallback allowed); long evidence cut at a word', () => {
    const none = renderTemplate('I saw "{{evidence|your post}}"', templateContext({ lead: {} }));
    assert.deepEqual(none.missing, ['evidence'], 'fallback is ignored for evidence');
    const long = templateContext({ lead: { evidence: 'word '.repeat(100) } }).evidence;
    assert.ok(long.length <= 182 && long.endsWith('…'));
  });

  it('lead text is inserted as plain text (template syntax inside a lead value is NOT executed again)', () => {
    const r = renderTemplate('Hi {{companyName}}', templateContext({ lead: { companyName: '{{myCompany}} <script>' }, company: { name: 'X' } }));
    assert.equal(r.text, 'Hi {{myCompany}} <script>');
  });
});

describe('message safety checks', () => {
  const allowed = { hosts: ['techbridge.pk', 'spicehouse.pk'], emails: ['hello@techbridge.pk'], phones: ['+92 300 1112223'] };

  it('sensitive topics: price, contract, deadline, guarantee, property', () => {
    const r = checkMessage({ text: 'Our price is Rs 50,000, guaranteed delivery within 5 days, contract attached. 5 marla plot available.', allowed });
    assert.deepEqual(r.sensitive.sort(), ['CONTRACT', 'DEADLINE', 'GUARANTEE', 'PRICING', 'PROPERTY']);
    assert.equal(r.flags.find((f) => f.code === 'SENSITIVE').blocking, false);
    assert.deepEqual(checkMessage({ text: 'Hi Ali, I saw your post about a new website. Happy to share ideas.', allowed }).sensitive, []);
  });

  it('fake familiarity ("as we discussed") blocks approval — unless a real conversation exists', () => {
    assert.ok(checkMessage({ text: 'Hi, as we discussed on our call…', allowed }).flags.some((f) => f.code === 'FALSE_FAMILIARITY' && f.blocking));
    assert.ok(!checkMessage({ text: 'Hi, as we discussed…', allowed, hasConversation: true }).flags.some((f) => f.code === 'FALSE_FAMILIARITY'));
  });

  it('unknown links / emails / phones (e.g. invented by AI or from an injected post) block approval', () => {
    const r = checkMessage({ text: 'Visit https://evil.example/pay or write to boss@evil.example or call 0333 9876543. Our site: https://www.techbridge.pk/work, hello@techbridge.pk, +92 300 1112223', allowed });
    const codes = r.flags.map((f) => f.code);
    assert.ok(codes.includes('UNKNOWN_LINK'));
    assert.equal(r.flags.filter((f) => f.code === 'UNKNOWN_CONTACT').length, 2);
    assert.ok(!JSON.stringify(r.flags).includes('techbridge.pk/work'), 'own site allowed');
    assert.equal(checkMessage({ text: 'See https://shop.spicehouse.pk', allowed }).flags.length, 0, 'lead subdomain ok');
  });

  it('placeholders left in the text block approval', () => {
    for (const t of ['Hi {{firstName}}', 'Hi [Name], ', 'TODO add price']) {
      assert.ok(checkMessage({ text: t, allowed }).flags.some((f) => f.code === 'UNFILLED_PLACEHOLDER'), t);
    }
  });

  it('AI personal statements must match the evidence (unmatched → flagged, not blocking)', () => {
    const evidence = 'Looking for a web developer for our bakery in Lahore';
    const r = checkMessage({ text: 'x', allowed, evidence, claims: [{ statement: 'You run a bakery', quote: 'our bakery in Lahore' }, { statement: 'Your site is slow', quote: 'our website is very slow' }] });
    assert.equal(r.unverifiedClaims.length, 1);
    assert.equal(r.unverifiedClaims[0].statement, 'Your site is slow');
    assert.equal(r.flags.find((f) => f.code === 'UNVERIFIED_CLAIM').blocking, false);
  });
});
