# LeadFlow — Chrome extension (Manifest V3)

Save the post / profile / website you are looking at as a lead.

## Install (developer mode)
1. Chrome → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → choose this `extension` folder.
3. Copy the extension **ID** (32 letters) into `server/.env`:
   `EXTENSION_ORIGINS=chrome-extension://<ID>` and restart the server.
4. LeadFlow web app → **Settings → Chrome extension → Get pairing code** → type it in the extension.

## Security
- Permissions: `activeTab`, `scripting`, `storage` only. No content scripts, no host permissions.
- Reads only the tab URL, title and the text YOU selected — only when you click the icon.
- On a Google Maps PLACE you opened, it also reads that place's visible name, phone, website and address
  to pre-fill the form (lib/extract.js, tested in server/tests/extensionExtract.test.js). One place, on your click,
  you check and press Save — no bulk collection, nothing saved without you.
- No password: one-time pairing code → 15-minute access token (session storage) + rotating refresh token.
- Only `https://` servers (plain `http://` only for localhost). No cookies, no redirects.
- Everything from the page/server is shown with `textContent`; dashboard links are checked before opening.

## Production
Change the server address in the popup to your `https://api...` domain, set `EXTENSION_ORIGINS`
to the published extension's ID, and publish through the Chrome Web Store (privacy policy required).
