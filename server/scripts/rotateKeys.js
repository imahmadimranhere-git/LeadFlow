// Re-encrypts every stored secret with the CURRENT encryption key.
//
// How to rotate the master key (do this if ENCRYPTION_KEY may have leaked, or once a year):
//   1. Generate a new key:   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   2. In server/.env:
//        ENCRYPTION_KEY_PREVIOUS = <the old ENCRYPTION_KEY>
//        ENCRYPTION_KEY          = <the new key>
//        ENCRYPTION_KEY_VERSION  = <old version + 1>   (first rotation: 2)
//   3. Restart the server (old data still decrypts with the previous key).
//   4. Run:  npm run rotate-keys
//   5. When it reports 0 failures, remove ENCRYPTION_KEY_PREVIOUS from .env and restart.
import env from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { reEncrypt } from '../src/utils/crypto.js';
import TenantIntegration from '../src/models/TenantIntegration.js';
import PlatformAdmin from '../src/models/PlatformAdmin.js';
import { recordAudit } from '../src/services/audit/auditService.js';

const stats = { rotated: 0, alreadyCurrent: 0, failed: 0 };

async function rotateField(Model, field) {
  const cursor = Model.find({ [`${field}.ciphertext`]: { $exists: true } }).select(`+${field}`).cursor();
  for await (const doc of cursor) {
    try {
      const next = reEncrypt(doc[field]);
      if (!next) {
        stats.alreadyCurrent += 1;
        continue;
      }
      await Model.updateOne({ _id: doc._id }, { $set: { [field]: next } });
      stats.rotated += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`✘ ${Model.modelName} ${doc._id} (${field}): ${err.message}`);
    }
  }
}

try {
  await connectDB();
  await runAsSystem('maintenance:rotate-keys', async () => {
    await rotateField(TenantIntegration, 'encryptedCredentials');
    await rotateField(PlatformAdmin, 'mfaSecretEnc');
    await rotateField(PlatformAdmin, 'mfaPendingSecretEnc');
  });
  await recordAudit({ actorType: 'SYSTEM', action: 'platform.keys_rotated', metadata: { ...stats, toVersion: env.ENCRYPTION_KEY_VERSION } });
  console.log(`✔ Re-encrypted: ${stats.rotated} · already current: ${stats.alreadyCurrent} · failed: ${stats.failed}`);
  if (stats.failed) process.exitCode = 1;
} catch (err) {
  console.error('❌ Rotation failed:', err.message);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
