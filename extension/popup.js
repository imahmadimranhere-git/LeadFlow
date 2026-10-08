// Popup logic. Security notes:
//  - every value from the server or the page is shown with textContent (never innerHTML)
//  - links are opened only if they point to OUR dashboard (/app/leads/<id>)
//  - the server validates everything again; this file only helps the user
import { AuthError, validServer, getServer, setServer, isPaired, pair, call, logout } from './lib/api.js';
import { readActivePage } from './lib/page.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-pair', 'view-main', 'view-done'];
let me = null; // { user, services, dashboardUrl }
let page = null; // { url, title, selection }
let openUrl = null;

function show(view) {
  for (const v of VIEWS) $(v).classList.toggle('hidden', v !== view);
  $('btn-logout').classList.toggle('hidden', view === 'view-pair');
}

function message(text, kind = 'error') {
  const el = $('msg');
  el.textContent = text || '';
  el.className = `msg ${kind}`;
  el.classList.toggle('hidden', !text);
}

/** Only links into our own dashboard's lead pages. */
function safeLeadUrl(url) {
  if (!me?.dashboardUrl || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    const base = new URL(me.dashboardUrl);
    return u.origin === base.origin && /^\/app\/leads\/[a-f0-9]{24}$/.test(u.pathname) ? u.toString() : null;
  } catch {
    return null;
  }
}
const leadUrlFor = (id) => (me?.dashboardUrl && /^[a-f0-9]{24}$/.test(id) ? safeLeadUrl(`${me.dashboardUrl}/app/leads/${id}`) : null);

function openLead(url) {
  const safe = safeLeadUrl(url);
  if (safe) chrome.tabs.create({ url: safe });
}

function errorText(res) {
  const fields = (res.errors || []).filter((e) => e.field).map((e) => `${e.field}: ${e.message}`);
  return [res.message || 'Something went wrong', ...fields].join(' · ');
}

async function handleAuthError(err) {
  if (err instanceof AuthError) {
    me = null;
    await startPair('Please connect the extension again.');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- pairing

async function startPair(note = '') {
  show('view-pair');
  $('who').textContent = '';
  $('pair-server').value = await getServer();
  message(note, 'error');
}

$('btn-pair').addEventListener('click', async () => {
  const origin = validServer($('pair-server').value);
  if (!origin) return message('Server address must start with https:// (http:// only for localhost).');
  const code = $('pair-code').value.trim();
  if (code.replace(/[^A-Za-z0-9]/g, '').length !== 8) return message('The pairing code has 8 letters/numbers, like K7QX-M2PA.');
  $('btn-pair').disabled = true;
  try {
    await setServer(origin);
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || 'computer';
    const res = await pair(code, `Chrome on ${platform}`.slice(0, 60));
    if (!res.ok) return message(res.status === 401 ? 'Wrong or expired code — get a new one in LeadFlow.' : errorText(res));
    $('pair-code').value = '';
    message('');
    await startMain();
  } finally {
    $('btn-pair').disabled = false;
  }
});

// ---------------------------------------------------------------- main

function addLine(container, text, cls = '', linkUrl = null) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  if (linkUrl) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'link';
    a.textContent = ' Open';
    a.addEventListener('click', () => openLead(linkUrl));
    div.append(' ', a);
  }
  container.append(div);
}

async function startMain() {
  show('view-main');
  message('');
  try {
    const meRes = await call('/me');
    if (!meRes.ok) return message(errorText(meRes));
    me = meRes.data;
    $('who').textContent = me.user?.name || '';

    const select = document.querySelector('select[name=requiredService]');
    select.length = 1;
    for (const s of me.services || []) select.add(new Option(String(s), String(s)));

    page = await readActivePage();
    if (page.error) {
      $('form').classList.add('hidden');
      $('page-title').textContent = '';
      $('page-url').textContent = '';
      return message(page.error);
    }
    $('form').classList.remove('hidden');
    $('page-title').textContent = page.title || '(no title)';
    $('page-url').textContent = page.url;
    const form = $('form');
    form.elements.snippet.value = page.selection;

    const check = await call('/check', { method: 'POST', body: { url: page.url } });
    const box = $('check');
    box.textContent = '';
    if (!check.ok) return addLine(box, errorText(check), 'warn');
    const c = check.data;
    $('page-kind').textContent = `${c.platform.toLowerCase()} · ${c.pageKind.toLowerCase()}`;
    if (c.pageKind === 'PROFILE' && !form.elements.profileUrl.value) form.elements.profileUrl.value = c.canonicalUrl;
    for (const l of c.leads) addLine(box, `Already saved: ${l.name} (${l.status.toLowerCase()})`, 'warn', l.url);
    if (c.hiddenMatches) addLine(box, 'A colleague already has a lead for this page.', 'warn');
    if (c.openSignal) addLine(box, `This post is in your Signals inbox${c.openSignal.matchedHashtag ? ` (#${c.openSignal.matchedHashtag})` : ''} — saving converts it into a lead.`);
  } catch (err) {
    if (!(await handleAuthError(err))) message('Something went wrong. Please try again.');
  }
}

function formBody() {
  const f = $('form').elements;
  const body = { pageUrl: page.url, pageTitle: page.title };
  for (const k of ['name', 'personName', 'handle', 'profileUrl', 'profileType', 'companyName', 'phone', 'email', 'website', 'city', 'contactSource', 'requiredService', 'snippet', 'notes', 'lawfulBasis']) {
    const v = f[k].value.trim();
    if (v) body[k] = v;
  }
  return body;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!page?.url) return;
  $('btn-save').disabled = true;
  message('');
  try {
    const res = await call('/leads', { method: 'POST', body: formBody() });
    if (res.ok) {
      openUrl = res.data.url;
      $('done-text').textContent = `✔ Saved: ${res.data.lead.name}${res.data.convertedSignal ? ' (converted from your Signals inbox)' : ''}${res.data.lead.doNotContact ? ' — marked DO NOT CONTACT' : ''}`;
      show('view-done');
      return;
    }
    if (res.status === 409) {
      const dup = (res.details?.duplicates || []).find((d) => d.visible && d.strong);
      if (dup) return showDuplicate(dup);
      return message(res.details?.duplicates?.some((d) => !d.visible) ? 'A colleague already has this lead.' : errorText(res));
    }
    message(errorText(res));
  } catch (err) {
    if (!(await handleAuthError(err))) message('Something went wrong. Please try again.');
  } finally {
    $('btn-save').disabled = false;
  }
});

function showDuplicate(dup) {
  const box = $('check');
  box.textContent = '';
  addLine(box, `This lead already exists: ${dup.name} (matched on ${(dup.matchedOn || []).join(', ')})`, 'warn', leadUrlFor(dup.id));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'secondary';
  btn.textContent = 'Add this page as a source of that lead';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const f = $('form').elements;
      const res = await call(`/leads/${dup.id}/sources`, { method: 'POST', body: { pageUrl: page.url, ...(f.snippet.value.trim() && { snippet: f.snippet.value.trim().slice(0, 1000) }), ...(f.notes.value.trim() && { notes: f.notes.value.trim() }) } });
      if (!res.ok) return message(errorText(res));
      openUrl = res.data.url;
      $('done-text').textContent = `✔ Added this page to: ${res.data.lead.name}`;
      show('view-done');
    } catch (err) {
      if (!(await handleAuthError(err))) message('Something went wrong. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });
  box.append(btn);
  message('Duplicate found — nothing was created.', 'error');
}

// ---------------------------------------------------------------- done / logout

$('btn-open').addEventListener('click', () => openLead(openUrl));
$('btn-again').addEventListener('click', () => {
  $('form').reset();
  startMain();
});
$('btn-logout').addEventListener('click', async () => {
  await logout();
  me = null;
  await startPair('Disconnected.');
});

// ---------------------------------------------------------------- start
(async () => {
  if (!(await isPaired())) return startPair();
  return startMain();
})();

