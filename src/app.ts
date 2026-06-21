import cors from 'cors';
import express from 'express';
import { Prisma } from '@prisma/client';
import { config } from './config';
import { requestIdMiddleware } from './middleware/requestId';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { errorHandler, notFound } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import historyRoutes from './routes/history';
import proposalRoutes from './routes/proposals';
import vestingRoutes from './routes/vesting';

export const createApiApp = () => {
  const app = express();

  // Trust the proxy topology so rate limiting reads real client IPs
  app.set('trust proxy', config.trustProxy);

  // Serialise Prisma Decimal instances as strings so monetary fields never
  // appear as `{}` in JSON responses (Decimal is not a plain JS number).
  app.set('json replacer', (_key: string, value: unknown) => {
    if (value instanceof Prisma.Decimal) return value.toFixed();
    return value;
  });

  app.use(requestIdMiddleware);
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));
  app.use(rateLimitMiddleware);

  // Public routes
  app.use('/health', healthRoutes);
  app.use('/auth', authRoutes);

  // Data routes (public read access; auth required for writes when added)
  app.use('/api/vesting', vestingRoutes);
  app.use('/api/proposals', proposalRoutes);
  app.use('/api', historyRoutes);

  // 404 and error handlers must be last
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
