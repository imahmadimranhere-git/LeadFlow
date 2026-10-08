// Reads ONLY: the active tab's address, its title, and the text YOU selected.
// No content scripts on every site, no reading of the page in the background (permission: activeTab).
const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

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
  return { url: tab.url.slice(0, 2048), title: clean(tab.title, 300), selection: clean(selection, 3000) };
}
