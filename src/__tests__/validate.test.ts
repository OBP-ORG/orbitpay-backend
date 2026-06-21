import express from 'express';
import request from 'supertest';
import { requestIdMiddleware } from '../middleware/requestId';
import { parsePagination, requireStellarAddress, parsePagePagination } from '../middleware/validate';
import type { Request, Response } from 'express';

const makeApp = (handler: (req: Request, res: Response) => void) => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.get('/test', handler);
  return app;
};

describe('parsePagination', () => {
  it('defaults to limit=10', async () => {
    const app = makeApp((req, res) => {
      const p = parsePagination(req, res);
      if (p) res.json(p);
    });
    const r = await request(app).get('/test');
    expect(r.body.take).toBe(10);
    expect(r.body.skip).toBe(0);
  });

  it('rejects limit > 100', async () => {
    const app = makeApp((req, res) => {
      const p = parsePagination(req, res);
      if (p) res.json(p);
    });
    const r = await request(app).get('/test?limit=101');
    expect(r.status).toBe(400);
  });

  it('rejects limit=0', async () => {
    const app = makeApp((req, res) => {
      const p = parsePagination(req, res);
      if (p) res.json(p);
    });
    const r = await request(app).get('/test?limit=0');
    expect(r.status).toBe(400);
  });

  it('rejects non-UUID cursor', async () => {
    const app = makeApp((req, res) => {
      const p = parsePagination(req, res);
      if (p) res.json(p);
    });
    const r = await request(app).get('/test?cursor=not-a-uuid');
    expect(r.status).toBe(400);
  });

  it('accepts valid cursor UUID', async () => {
    const app = makeApp((req, res) => {
      const p = parsePagination(req, res);
      if (p) res.json(p);
    });
    const r = await request(app).get(
      '/test?cursor=550e8400-e29b-41d4-a716-446655440000',
    );
    expect(r.body.cursorId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(r.body.skip).toBe(1);
  });
});

describe('requireStellarAddress', () => {
  const makeAddrApp = () =>
    makeApp((req, res) => {
      const addr = String(req.query.addr ?? '');
      if (requireStellarAddress(addr, 'addr', req, res)) {
        res.json({ ok: true });
      }
    });

  it('accepts a valid Stellar address', async () => {
    const validAddr = 'G' + 'A'.repeat(55);
    const r = await request(makeAddrApp()).get(`/test?addr=${validAddr}`);
    expect(r.status).toBe(200);
  });

  it('rejects an Ethereum address', async () => {
    const r = await request(makeAddrApp()).get(
      '/test?addr=0xabc123',
    );
    expect(r.status).toBe(400);
  });

  it('rejects a short string', async () => {
    const r = await request(makeAddrApp()).get('/test?addr=GABC');
    expect(r.status).toBe(400);
  });
});

describe('parsePagePagination', () => {
  it('defaults to page=1 limit=10', async () => {
    const app = makeApp((req, res) => {
      const p = parsePagePagination(req, res);
      if (p) res.json(p);
    });
    const r = await request(app).get('/test');
    expect(r.body).toEqual({ page: 1, limitNum: 10 });
  });

  it('rejects page=0', async () => {
    const app = makeApp((req, res) => {
      const p = parsePagePagination(req, res);
      if (p) res.json(p);
    });
    const r = await request(app).get('/test?page=0');
    expect(r.status).toBe(400);
  });
});
