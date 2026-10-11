// "Meta refused the connection" → WHICH setup step is wrong (no database, no network).
// Why: a beginner cannot debug Meta's OAuth. The callback now names the broken step
// (redirect URI, App Secret, App ID, Graph version, permissions) — and never logs tokens/secrets.
import './helpers/setupEnv.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MetaError, diagnoseMetaError, safeMetaMessage } from '../src/services/integrations/meta/metaClient.js';

const err = (metaMessage, code = 100, extra = {}) => new MetaError('Meta refused the request', { code, metaMessage, ...extra });

describe('Meta connection diagnosis', () => {
  it('wrong redirect URI → redirect_uri_mismatch', () => {
    assert.equal(diagnoseMetaError(err('Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request'), 'code'), 'redirect_uri_mismatch');
    assert.equal(diagnoseMetaError(err('URL Blocked: This redirect failed', 191), 'code'), 'redirect_uri_mismatch');
  });

  it('wrong App Secret / App ID / Graph version are told apart', () => {
    assert.equal(diagnoseMetaError(err('Error validating client secret.', 1), 'code'), 'bad_app_secret');
    assert.equal(diagnoseMetaError(err('Invalid appsecret_proof provided in the API argument'), 'accounts'), 'bad_app_secret');
    assert.equal(diagnoseMetaError(err('Error validating application. Invalid application ID.', 101), 'code'), 'bad_app_id');
    assert.equal(diagnoseMetaError(err('Unknown path components: /v99.0/oauth/access_token', 2500), 'code'), 'meta_refused');
    assert.equal(diagnoseMetaError(err('Unsupported version: v99.0', 100), 'code'), 'bad_graph_version');
  });

  it('expired code, missing permission, no network, unknown → right reason', () => {
    assert.equal(diagnoseMetaError(err('This authorization code has expired.'), 'code'), 'expired_or_invalid');
    assert.equal(diagnoseMetaError(err('(#10) Requires pages_show_list permission', 10), 'accounts'), 'missing_permission');
    assert.equal(diagnoseMetaError(new MetaError('Could not reach Meta', { network: true }), 'code'), 'meta_unreachable');
    assert.equal(diagnoseMetaError(err('Something else', 2), 'code'), 'meta_refused');
    assert.equal(diagnoseMetaError(new Error('boom'), 'code'), 'meta_refused');
  });

  it('Meta messages kept for the log WITHOUT tokens, codes or secrets', () => {
    const tokenish = 'EAAGm0PX4ZCpsBAKZCZAqZBx7ZB8ZCZBZB9ZBZBZCZCZCxyzABC123456789';
    const out = safeMetaMessage(`Invalid token ${tokenish} for app 1710622593335177`);
    assert.ok(!out.includes(tokenish));
    assert.match(out, /Invalid token … for app 1710622593335177/);
    assert.equal(safeMetaMessage(''), null);
    assert.ok(safeMetaMessage('x'.repeat(500)).length <= 200);
  });
});
