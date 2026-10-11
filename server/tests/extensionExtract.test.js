// Chrome extension auto-fill: Google Maps place + selected text → suggested form values (no database).
// Why: the user should not have to type name/phone/website by hand — but we must only use what is
// visible, never invent values, and only produce values the server will accept.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMapsPlaceUrl, isMapsListUrl, cleanTitle, unwrapGoogleLink, cleanPhone, cityFromAddress, contactsFromText, suggestFields,
} from '../../extension/lib/extract.js';
import { canonicalPageUrl, cleanPageTitle } from '../src/services/extension/pageUrl.js';
import { saveLeadBody } from '../src/validators/extension.validators.js';

const PLACE = 'https://www.google.com/maps/place/Ideal+Rent+a+Car+Islamabad/@33.6165203,72.7564389,10z/data=!4m9!1m2!2m1!1srent+a+cars+in+islamabad!3m5!1s0x38dfbf7f649f342d:0xb4a922a1a9ec07aa!8m2!3d33.6771509!4d73.016088!16s%2Fg%2F11zdj09l3d?entry=ttu';
const LIST = 'https://www.google.com/maps/search/rent+a+cars+in+islamabad/@33.6165203,72.7564389,10z?entry=ttu';

describe('extension auto-fill — Google Maps', () => {
  it('knows a single place page from the search list', () => {
    assert.equal(isMapsPlaceUrl(PLACE), true);
    assert.equal(isMapsPlaceUrl(LIST), false);
    assert.equal(isMapsListUrl(LIST), true);
    assert.equal(isMapsPlaceUrl('https://www.google.com.pk/maps/place/X/'), true);
    assert.equal(isMapsPlaceUrl('https://evil.example/maps/place/X/'), false);
  });

  it('a full Maps place panel → name, phone, website (domain), city and a useful note', () => {
    const s = suggestFields({
      url: PLACE,
      title: 'Ideal Rent a Car Islamabad - Google Maps',
      selection: '',
      maps: {
        name: 'Ideal Rent a Car Islamabad',
        phone: '+923002776070',
        website: 'https://www.google.com/url?q=https://idealrentacar.pk/&opi=1',
        address: 'Address: Office # 13-A Basement, Sharjah Center, G-10 Markaz G 10/2 G-10, Islamabad, Pakistan',
        category: 'Car rental agency',
        rating: '4.9 stars',
        reviews: '16 reviews',
      },
    });
    assert.equal(s.name, 'Ideal Rent a Car Islamabad');
    assert.equal(s.companyName, 'Ideal Rent a Car Islamabad');
    assert.equal(s.phone, '+923002776070');
    assert.equal(s.website, 'idealrentacar.pk');
    assert.equal(s.city, 'Islamabad');
    assert.equal(s.profileType, 'BUSINESS');
    assert.equal(s.contactSource, 'BUSINESS_CONTACT_BUTTON');
    assert.match(s.notes, /Car rental agency/);
    assert.match(s.notes, /⭐ 4\.9 \(16 reviews\)/);
    assert.match(s.notes, /Website: idealrentacar\.pk/);
  });

  it('a business WITHOUT a website is marked clearly (that is the sales opportunity)', () => {
    const s = suggestFields({ url: PLACE, title: 'Al-Sadiq Rent a Car - Google Maps', maps: { name: 'Al-Sadiq Rent a Car', phone: '0300 1234567', website: '', address: 'Blue Area, Islamabad, Pakistan' } });
    assert.equal(s.website, undefined);
    assert.match(s.notes, /NO WEBSITE/);
  });

  it('Maps changed its page (nothing readable) → falls back to the tab title; nothing is invented', () => {
    const s = suggestFields({ url: PLACE, title: 'Al-Sadiq Rent a Car - Google Maps', selection: '', maps: null });
    assert.equal(s.name, 'Al-Sadiq Rent a Car');
    assert.equal(s.phone, undefined);
    assert.equal(s.website, undefined);
    assert.equal(s.city, undefined);
  });

  it('every suggested value passes the server validation (Save never fails because of auto-fill)', () => {
    const s = suggestFields({ url: PLACE, title: 'Ideal - Google Maps', maps: { name: 'Ideal', phone: '+92 300 2776070', website: 'https://idealrentacar.pk/', address: 'G-10, Islamabad 44000, Pakistan', rating: '4.9', reviews: '(1,203)' } });
    const parsed = saveLeadBody.safeParse({ pageUrl: PLACE, pageTitle: 'Ideal - Google Maps', ...s });
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data.website, 'https://idealrentacar.pk');
  });
});

describe('extension auto-fill — small helpers', () => {
  it('Maps title suffix removed (also on the server for the name fallback)', () => {
    assert.equal(cleanTitle('Ali Salon - Google Maps'), 'Ali Salon');
    assert.equal(cleanPageTitle('Ali Salon – Google Maps'), 'Ali Salon');
    assert.equal(cleanPageTitle('Need a website? | Facebook'), 'Need a website? | Facebook');
  });

  it('Google redirect links are unwrapped; non-http links are dropped', () => {
    assert.equal(unwrapGoogleLink('https://www.google.com/url?q=https://site.pk/a&sa=U'), 'https://site.pk/a');
    assert.equal(unwrapGoogleLink('https://site.pk/'), 'https://site.pk/');
    assert.equal(unwrapGoogleLink('javascript:alert(1)'), '');
  });

  it('phones: only realistic numbers in a format the server accepts', () => {
    assert.equal(cleanPhone('+92 300 2776070'), '+92 300 2776070');
    assert.equal(cleanPhone('Phone: 0300-1234567'), '0300-1234567');
    assert.equal(cleanPhone('12345'), '');
    assert.equal(cleanPhone('1234567890123456789'), '');
  });

  it('city from an address: country, post codes and plus codes removed', () => {
    assert.equal(cityFromAddress('Office 13-A, G-10 Markaz, Islamabad, Pakistan'), 'Islamabad');
    assert.equal(cityFromAddress('Shop 5, Gulberg III, Lahore 54000, Pakistan'), 'Lahore');
    assert.equal(cityFromAddress('12 George St, Sydney NSW 2000, Australia'), 'Sydney NSW');
    assert.equal(cityFromAddress('Islamabad'), '');
    assert.equal(cityFromAddress(''), '');
  });

  it('selected text: phone, e-mail and the business website — social/e-mail domains are not "websites"', () => {
    const c = contactsFromText('Call 0300 1234567 or mail info@alisalon.pk — visit www.alisalon.pk or facebook.com/alisalon');
    assert.deepEqual(c.phones, ['0300 1234567']);
    assert.deepEqual(c.emails, ['info@alisalon.pk']);
    assert.deepEqual(c.websites, ['alisalon.pk']);
  });

  it('a Facebook post with contacts in the selected text fills phone and e-mail too', () => {
    const s = suggestFields({ url: 'https://www.facebook.com/groups/1/posts/2', title: 'Facebook', selection: 'Need a website for my shop. WhatsApp +92 321 7654321, ali@gmail.com' });
    assert.equal(s.phone, '+92 321 7654321');
    assert.equal(s.email, 'ali@gmail.com');
    assert.equal(s.website, undefined);
    assert.equal(s.name, undefined); // not a Maps place → the user names the lead
  });
});

describe('Google Maps place URL → one canonical URL (duplicate check works)', () => {
  it('different zoom/position/search for the same place → the same URL, keeping the place id', () => {
    const other = 'https://www.google.com/maps/place/Ideal+Rent+a+Car+Islamabad/@33.70,73.01,15z/data=!3m1!4b1!4m6!3m5!1s0x38dfbf7f649f342d:0xb4a922a1a9ec07aa!8m2!3d33.67!4d73.01?hl=en';
    const want = 'https://www.google.com/maps/place/Ideal+Rent+a+Car+Islamabad/data=!4m2!3m1!1s0x38dfbf7f649f342d:0xb4a922a1a9ec07aa';
    assert.equal(canonicalPageUrl(PLACE), want);
    assert.equal(canonicalPageUrl(other), want);
    assert.ok(canonicalPageUrl(PLACE).length < 150);
  });

  it('two different businesses from the same search stay different', () => {
    const b = PLACE.replace('Ideal+Rent+a+Car+Islamabad', 'Royal+Rent+A+Car').replace('0x38dfbf7f649f342d:0xb4a922a1a9ec07aa', '0x38dfbf1111111111:0xaaaaaaaaaaaaaaaa');
    assert.notEqual(canonicalPageUrl(PLACE), canonicalPageUrl(b));
  });
});
