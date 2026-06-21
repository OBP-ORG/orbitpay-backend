import express from 'express';
import request from 'supertest';
import { requestIdMiddleware } from '../middleware/requestId';
import { requireAuth } from '../middleware/auth';
import { signJwt } from '../lib/jwt';

const makeProtectedApp = () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.get('/protected', requireAuth, (req, res) => {
    res.json({ wallet: req.walletAddress });
  });
  return app;
};

describe('requireAuth middleware', () => {
  it('rejects missing Authorization header', async () => {
    const r = await request(makeProtectedApp()).get('/protected');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Unauthorized');
  });

  it('rejects malformed header (no Bearer prefix)', async () => {
    const r = await request(makeProtectedApp())
      .get('/protected')
      .set('Authorization', 'Token abc123');
    expect(r.status).toBe(401);
  });

  it('rejects an invalid JWT', async () => {
    const r = await request(makeProtectedApp())
      .get('/protected')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(r.status).toBe(401);
  });

  it('admits a valid JWT and attaches walletAddress', async () => {
    const wallet = 'G' + 'B'.repeat(55);
    const token = signJwt({ sub: wallet });
    const r = await request(makeProtectedApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.wallet).toBe(wallet);
  });
});

describe('nonce endpoint', () => {
  let app: ReturnType<typeof express>;

  beforeAll(async () => {
    // Mock Redis so nonce tests don't need a real Redis instance
    jest.mock('../lib/redis', () => ({
      getRedisClient: jest.fn().mockResolvedValue({
        set: jest.fn().mockResolvedValue('OK'),
        getDel: jest.fn().mockResolvedValue(null),
        isOpen: true,
      }),
    }));

    const { createApiApp } = await import('../app');
    app = createApiApp();
  });

  afterAll(() => {
    jest.resetModules();
  });

  it('rejects missing walletAddress', async () => {
    const r = await request(app).post('/auth/nonce').send({});
    expect(r.status).toBe(400);
  });

  it('rejects an Ethereum address', async () => {
    const r = await request(app)
      .post('/auth/nonce')
      .send({ walletAddress: '0xdeadbeef' });
    expect(r.status).toBe(400);
  });

  it('rejects unknown body fields', async () => {
    const r = await request(app)
      .post('/auth/nonce')
      .send({ walletAddress: 'G' + 'A'.repeat(55), extra: 'field' });
    expect(r.status).toBe(400);
  });
});

describe('rate limiter', () => {
  it('returns 429 after exceeding limit', async () => {
    // Override config to a 1-request window for this test
    jest.resetModules();
    jest.mock('../config', () => ({
      config: {
        nodeEnv: 'test',
        port: 3001,
        indexerPort: 3002,
        databaseUrl: '',
        redisUrl: '',
        rateLimit: { maxRequests: 1, windowMs: 60000, backoffBaseMs: 60000 },
        jwtSecret: 'test-secret',
        jwtTtlSeconds: 3600,
        trustProxy: 'loopback',
        dbQueryTimeoutMs: 5000,
        redisSocketTimeoutMs: 3000,
        indexerPollIntervalMs: 5000,
      },
    }));

    const { rateLimitMiddleware } = await import('../middleware/rateLimit');
    const testApp = express();
    testApp.use(requestIdMiddleware);
    testApp.use(rateLimitMiddleware);
    testApp.get('/ping', (_req, res) => res.json({ ok: true }));

    await request(testApp).get('/ping'); // first — ok
    const r2 = await request(testApp).get('/ping'); // second — rate limited
    expect(r2.status).toBe(429);
    expect(r2.body.error).toBe('Too Many Requests');
    jest.resetModules();
  });
});
