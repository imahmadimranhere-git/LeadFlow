// Reads ONLY: the active tab's address, its title, the text YOU selected and — on a Google Maps
// place you opened — the name/phone/website/address shown in that place's panel.
// Runs only when you click the extension icon (permission: activeTab). No background reading.
import { isMapsPlaceUrl } from './extract.js';

const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

/** Runs INSIDE the Maps tab (must be self-contained). Reads the visible place panel only. */
function readMapsPlacePanel() {
  const label = (el) => (el ? (el.getAttribute('aria-label') || el.textContent || '') : '').trim();
  const main = document.querySelector('div[role="main"][aria-label]') || document;
  const q = (sel) => main.querySelector(sel) || document.querySelector(sel);
  const phoneEl = q('[data-item-id^="phone:tel:"]');
  const ratingEl = main.querySelector('span[role="img"][aria-label*="star" i]');
  const reviewsEl = main.querySelector('span[aria-label*="review" i], button[aria-label*="review" i]');
  return {
    name: label(main.querySelector('h1')) || (main !== document ? main.getAttribute('aria-label') : '') || '',
    phone: phoneEl ? (phoneEl.getAttribute('data-item-id') || '').replace(/^phone:tel:/, '') || label(phoneEl) : '',
    website: q('a[data-item-id="authority"]')?.href || '',
    address: label(q('button[data-item-id="address"]')),
    category: label(main.querySelector('button[jsaction*="category"]')),
    rating: ratingEl ? label(ratingEl) : '',
    reviews: reviewsEl ? label(reviewsEl) : '',
  };
}

export async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.url !== 'string' || !/^https?:\/\//i.test(tab.url)) {
    return { error: 'Open a normal web page (a post, a profile or a website) and click the extension again.' };
  }
  let selection = '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection ? window.getSelection() : '').slice(0, 3000),
    });
    selection = typeof result?.result === 'string' ? result.result : '';
  } catch {
    // some pages (e.g. the Chrome Web Store) don't allow scripts — the user can paste the text instead
  }

  let maps = null;
  if (isMapsPlaceUrl(tab.url)) {
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readMapsPlacePanel });
      const r = result?.result;
      if (r && typeof r === 'object') {
        maps = {};
        for (const k of ['name', 'phone', 'website', 'address', 'category', 'rating', 'reviews']) maps[k] = clean(r[k], k === 'website' ? 2048 : 300);
      }
    } catch {
      // Maps changed its page → the user fills the form by hand (title + selection still work)
    }
  }
  return { url: tab.url.slice(0, 2048), title: clean(tab.title, 300), selection: clean(selection, 3000), maps };
}
