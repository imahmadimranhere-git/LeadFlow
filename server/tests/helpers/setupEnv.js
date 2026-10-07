// MUST be imported first in every test file — sets safe fake env values
// before src/config/env.js validates them. Tests never use your real .env secrets or Atlas DB.
process.env.NODE_ENV = 'test';
process.env.PORT = '5099';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/leadflow_unused_in_tests';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.JWT_SECRET = 'test_jwt_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_bbbbbbbbbbbbbbbbbbbbbbbbbbb';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.RATE_LIMIT_MAX = '1000';
process.env.LOG_LEVEL = 'fatal';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
