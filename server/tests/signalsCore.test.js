// PHASE 11 — EXTRACTING PUBLICLY STATED CONTACTS & HASHTAGS (pure functions, no database)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPublicContacts, extractHashtags, dataCompleteness } from '../src/services/signals/extract.js';

describe('Public contact extraction (only what the author wrote)', () => {
  it('finds emails, phones and websites written in the post', () => {
    const c = extractPublicContacts('Need 5 marla plot in Bahria. Budget 2025 approved. Call 0300-1234567 or mail ALI@Example.com, see https://ali.example.com/plots.');
    assert.deepEqual(c, [
      { type: 'EMAIL', value: 'ali@example.com' },
      { type: 'PHONE', value: '0300-1234567' },
      { type: 'WEBSITE', value: 'https://ali.example.com/plots' },
    ]);
  });

  it('marks numbers as WhatsApp when the post says so, and reads wa.me links', () => {
    const c = extractPublicContacts('WhatsApp me +92 321 7654321 or https://wa.me/923001112222');
    assert.ok(c.some((x) => x.type === 'WHATSAPP' && x.value === '+92 321 7654321'));
    assert.ok(c.some((x) => x.type === 'WHATSAPP' && x.value === '+923001112222'));
  });

  it('does not mistake prices, sizes, years or dates for phone numbers', () => {
    assert.deepEqual(extractPublicContacts('Budget 2,50,00,000 for 10 marla, 2026-10-08, plot 125 sq yd, PKR 45000000'), []);
  });

  it('returns nothing for text without contacts', () => {
    assert.deepEqual(extractPublicContacts('Looking for an apartment in F-11 #needapartment'), []);
  });
});

describe('Hashtags & completeness', () => {
  it('extracts all hashtags (any language), lower-cased and unique', () => {
    assert.deepEqual(extractHashtags('#NeedAPlot in #Islamabad #needaplot #پلاٹ'), ['needaplot', 'islamabad', 'پلاٹ']);
  });

  it('completeness: COMPLETE / PARTIAL / MINIMAL with reasons', () => {
    assert.equal(dataCompleteness({ authorProvided: true, contactCount: 1 }).level, 'COMPLETE');
    assert.equal(dataCompleteness({ authorProvided: false, contactCount: 1 }).level, 'PARTIAL');
    const m = dataCompleteness({ authorProvided: false, contactCount: 0 });
    assert.equal(m.level, 'MINIMAL');
    assert.equal(m.reasons.length, 2);
  });
});
