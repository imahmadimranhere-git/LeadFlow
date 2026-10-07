import express from 'express';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';
import env from './config/env.js';
import logger from './config/logger.js';
import requestId from './middleware/requestId.js';
import {
  securityHeaders,
  permissionsPolicy,
  corsMiddleware,
  globalLimiter,
} from './middleware/security.js';
import rejectMongoOperators from './middleware/rejectMongoOperators.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';
import webhookRoutes from './routes/webhooks.routes.js';

const app = express();

// Hide "X-Powered-By: Express" (don't advertise our stack)
app.disable('x-powered-by');
// "simple" parser: ?a[$ne]=1 is NOT turned into an object → no operator injection via query string
app.set('query parser', 'simple');
// Behind Render/Railway proxy → needed for correct client IP in rate limiter
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(requestId);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
  })
);
app.use(securityHeaders);
app.use(permissionsPolicy);
app.use(corsMiddleware);
app.use(globalLimiter);

// Webhooks need the RAW body for signature checks → mounted before the JSON parser
app.use('/api/v1/webhooks', webhookRoutes);

// Body size limits (protects against huge payload DoS)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

// Block $operators / dotted keys / __proto__ in body, query, params
app.use(rejectMongoOperators);

app.use('/api/v1', apiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
