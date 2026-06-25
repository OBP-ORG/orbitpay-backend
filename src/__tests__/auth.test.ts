import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { requestIdMiddleware } from '../middleware/requestId';
import { requireAuth, buildChallengeMessage, verifyWalletSignature } from '../middleware/auth';
import { signJwt, verifyJwt } from '../lib/jwt';

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

// ---------------------------------------------------------------------------
// Unit tests: verifyWalletSignature with real Stellar Ed25519 keypairs
// ---------------------------------------------------------------------------

describe('verifyWalletSignature — real Stellar Ed25519 keypairs', () => {
  const keypair = Keypair.random();
  const walletAddress = keypair.publicKey();
  const nonce = 'a1b2c3d4e5f6deadbeef';
  const message = buildChallengeMessage(nonce);
  const messageBytes = Buffer.from(message, 'utf8');

  it('returns true for a valid signature from the matching keypair', () => {
    const sig = keypair.sign(messageBytes);
    expect(verifyWalletSignature(walletAddress, sig.toString('base64'), nonce)).toBe(true);
  });

  it('returns false when the signature is for a different message', () => {
    const sig = keypair.sign(Buffer.from('wrong message entirely', 'utf8'));
    expect(verifyWalletSignature(walletAddress, sig.toString('base64'), nonce)).toBe(false);
  });

  it('returns false when the nonce is wrong (message mismatch)', () => {
    const sig = keypair.sign(messageBytes);
    expect(verifyWalletSignature(walletAddress, sig.toString('base64'), 'different-nonce')).toBe(false);
  });

  it('returns false for a single-byte tampered signature', () => {
    const sig = Buffer.from(keypair.sign(messageBytes));
    sig[0] ^= 0xff;
    expect(verifyWalletSignature(walletAddress, sig.toString('base64'), nonce)).toBe(false);
  });

  it('returns false when the signature belongs to a different keypair', () => {
    const other = Keypair.random();
    const sig = other.sign(messageBytes);
    expect(verifyWalletSignature(walletAddress, sig.toString('base64'), nonce)).toBe(false);
  });

  it('returns false for an empty signature string', () => {
    expect(verifyWalletSignature(walletAddress, '', nonce)).toBe(false);
  });

  it('returns false for a non-base64 signature string', () => {
    expect(verifyWalletSignature(walletAddress, '!!!not-base64!!!', nonce)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: real Stellar Ed25519 auth flow through /auth/verify
// ---------------------------------------------------------------------------

describe('POST /auth/verify — real Stellar auth flow', () => {
  const keypair = Keypair.random();
  const walletAddress = keypair.publicKey();
  const nonce = 'integrationnonce9876';
  const message = buildChallengeMessage(nonce);
  const messageBytes = Buffer.from(message, 'utf8');

  let app: ReturnType<typeof express>;
  let getDel: jest.Mock;

  beforeAll(async () => {
    jest.resetModules();
    // Clear any leftover config mock from the rate-limiter test so that
    // the real jwtSecret ('change-me-in-production') is used by the app —
    // it must match the statically-imported verifyJwt's config reference.
    jest.unmock('../config');
    getDel = jest.fn().mockResolvedValue(nonce);
    jest.mock('../lib/redis', () => ({
      getRedisClient: jest.fn().mockResolvedValue({
        set: jest.fn().mockResolvedValue('OK'),
        getDel,
        isOpen: true,
      }),
    }));
    const { createApiApp } = await import('../app');
    app = createApiApp();
  });

  afterAll(() => {
    jest.resetModules();
  });

  it('returns a JWT for a valid real Stellar signature', async () => {
    getDel.mockResolvedValueOnce(nonce);
    const sig = keypair.sign(messageBytes);
    const r = await request(app).post('/auth/verify').send({
      walletAddress,
      signature: sig.toString('base64'),
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    const payload = verifyJwt(r.body.token as string);
    expect(payload?.sub).toBe(walletAddress);
  });

  it('returns 401 when the nonce has expired or is missing', async () => {
    getDel.mockResolvedValueOnce(null);
    const sig = keypair.sign(messageBytes);
    const r = await request(app).post('/auth/verify').send({
      walletAddress,
      signature: sig.toString('base64'),
    });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Unauthorized');
  });

  it('returns 401 when the signature is for the wrong message', async () => {
    getDel.mockResolvedValueOnce(nonce);
    const sig = keypair.sign(Buffer.from('OrbitPay authentication nonce: wrongnonce', 'utf8'));
    const r = await request(app).post('/auth/verify').send({
      walletAddress,
      signature: sig.toString('base64'),
    });
    expect(r.status).toBe(401);
  });

  it('returns 401 when the signature belongs to a different wallet', async () => {
    getDel.mockResolvedValueOnce(nonce);
    const attacker = Keypair.random();
    const sig = attacker.sign(messageBytes);
    const r = await request(app).post('/auth/verify').send({
      walletAddress,
      signature: sig.toString('base64'),
    });
    expect(r.status).toBe(401);
  });

  it('returns 401 when the signature is tampered', async () => {
    getDel.mockResolvedValueOnce(nonce);
    const sig = Buffer.from(keypair.sign(messageBytes));
    sig[31] ^= 0x01;
    const r = await request(app).post('/auth/verify').send({
      walletAddress,
      signature: sig.toString('base64'),
    });
    expect(r.status).toBe(401);
  });

  it('returns 401 on replay — nonce is single-use (getDel returns null second time)', async () => {
    getDel.mockResolvedValueOnce(nonce);
    const sig = keypair.sign(messageBytes);
    const first = await request(app).post('/auth/verify').send({
      walletAddress,
      signature: sig.toString('base64'),
    });
    expect(first.status).toBe(200);

    // Second attempt: nonce already consumed (Redis returns null)
    getDel.mockResolvedValueOnce(null);
    const second = await request(app).post('/auth/verify').send({
      walletAddress,
      signature: sig.toString('base64'),
    });
    expect(second.status).toBe(401);
  });

  it('returns 400 for a missing walletAddress', async () => {
    const r = await request(app).post('/auth/verify').send({ signature: 'abc' });
    expect(r.status).toBe(400);
  });

  it('returns 400 for an Ethereum-format address', async () => {
    const r = await request(app).post('/auth/verify').send({
      walletAddress: '0xdeadbeef',
      signature: 'abc',
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 for a missing signature', async () => {
    const r = await request(app).post('/auth/verify').send({ walletAddress });
    expect(r.status).toBe(400);
  });
});
