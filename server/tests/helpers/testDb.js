// Starts a temporary in-memory MongoDB for tests (your Atlas data is never touched).
// Optional: set TEST_MONGODB_URI to a separate *test* database instead.
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from '../../src/config/mongoose.js';

let memoryServer = null;

export async function startTestDb() {
  let uri = process.env.TEST_MONGODB_URI;
  const shared = process.env.TEST_MONGODB_SERVER_URI; // one MongoDB started by scripts/runTests.mjs for ALL files
  if (!uri && shared) {
    // each test file gets its OWN fresh database on the shared server (dropped again in stopTestDb)
    const [base, query] = shared.split('?');
    uri = `${base.replace(/\/+$/, '')}/leadflow_test_${crypto.randomBytes(5).toString('hex')}${query ? `?${query}` : ''}`;
  } else if (uri) {
    if (!/test/i.test(new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).pathname)) {
      throw new Error('TEST_MONGODB_URI database name must contain "test" (safety check)');
    }
  } else {
    // Windows + antivirus can make the first start slow → generous time limit (default is 10 s)
    memoryServer = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });
    uri = memoryServer.getUri('leadflow_test');
  }
  await mongoose.connect(uri);
  // Each test block uses a fresh database → make sure unique indexes exist there too
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
}

export async function stopTestDb() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  if (memoryServer) await memoryServer.stop();
}
