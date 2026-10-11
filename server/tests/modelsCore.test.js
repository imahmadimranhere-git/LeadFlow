// PHASE 28 — pure structural checks on the database models (no database needed):
// every model that holds company data must use the tenant-isolation plugin, and the few platform-level
// exceptions are listed here WITH the reason. A new model that forgets the plugin fails this test.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'models');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const src = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// Models that have a tenantId but are deliberately NOT auto-scoped (used before login / across companies)
const PLATFORM_LEVEL = {
  'AuditLog.js': 'written for super-admin + tenant actions; tenant pages filter by tenantId explicitly',
  'AuthToken.js': 'password-reset / verify links are used BEFORE login (looked up by hash only)',
  'OAuthState.js': 'OAuth callback arrives without a login (looked up by hashed state only)',
  'RefreshToken.js': 'refresh happens before the tenant is known (looked up by hash only)',
};

describe('Database models', () => {
  it('every model with company data uses tenantScopePlugin (exceptions reviewed)', () => {
    const missing = [];
    for (const f of files) {
      const s = src(f);
      const hasTenant = /\btenantId\s*:/.test(s);
      const hasPlugin = /\.plugin\(\s*tenantScopePlugin/.test(s);
      if (hasTenant && !hasPlugin && !PLATFORM_LEVEL[f]) missing.push(f);
      if (hasPlugin && PLATFORM_LEVEL[f]) missing.push(`${f} (listed as platform-level but uses the plugin — update the list)`);
    }
    assert.deepEqual(missing, []);
  });

  it('platform-level models with tenantId are only looked up by a hash or explicit tenant filter', () => {
    for (const f of ['AuthToken.js', 'OAuthState.js', 'RefreshToken.js']) {
      assert.match(src(f), /(tokenHash|stateHash)[^\n]*private:\s*true/, `${f}: the hash is private`);
      assert.match(src(f), /index\(\{\s*(tokenHash|stateHash):\s*1\s*\},\s*\{\s*unique:\s*true/, `${f}: unique hash index`);
    }
  });

  it('a UNIQUE { tenantId: 1 } index switches off the plugin\'s plain tenantId index (no clashing indexes)', () => {
    for (const f of files) {
      const s = src(f);
      if (/index\(\{\s*tenantId:\s*1\s*\},\s*\{[^}]*unique:\s*true/.test(s)) assert.match(s, /plugin\(\s*tenantScopePlugin,\s*\{\s*tenantIndex:\s*false/, f);
    }
  });

  it('strict schemas: unknown fields throw instead of being silently saved (main business models)', () => {
    for (const f of ['User.js', 'Lead.js', 'Quote.js', 'ClientInvoice.js', 'AiUsageLog.js', 'AuthToken.js']) {
      assert.match(src(f), /strict:\s*'throw'/, f);
    }
  });

  it('secrets are never stored in plain text: password + MFA + vault fields are hidden', () => {
    const user = src('User.js');
    assert.match(user, /passwordHash:[^\n]*select:\s*false[^\n]*private:\s*true/);
    assert.match(user, /mfaSecretEnc:[^\n]*select:\s*false[^\n]*private:\s*true/);
    assert.match(user, /mfaRecoveryHashes:[^\n]*select:\s*false[^\n]*private:\s*true/);
    assert.match(src('TenantIntegration.js'), /encryptedCredentials[^\n]*select:\s*false/);
  });
});
