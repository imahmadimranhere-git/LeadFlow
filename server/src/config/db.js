import mongoose from './mongoose.js';
import env from './env.js';
import logger from './logger.js';

// Note: operator injection ({ "$ne": ... }) is blocked at the HTTP layer
// (middleware/rejectMongoOperators.js + Zod validation + allow-listed query builders).

export async function connectDB(uri = env.MONGODB_URI) {
  try {
    await mongoose.connect(uri, {
      autoIndex: env.NODE_ENV !== 'production',
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 20,
    });
    logger.info('✅ MongoDB connected');
  } catch (err) {
    // Never print the URI (it contains the password)
    logger.fatal({ err: err.message }, '❌ MongoDB connection failed');
    if (env.NODE_ENV === 'test') throw err;
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
}

export async function disconnectDB() {
  await mongoose.connection.close();
}

export function dbStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}
