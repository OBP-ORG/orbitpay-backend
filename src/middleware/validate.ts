import type { NextFunction, Request, Response } from 'express';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 10;

/** Validate and coerce ?limit and ?cursor query params. Sends 400 on invalid input. */
export const parsePagination = (
  req: Request,
  res: Response,
): { take: number; skip: number; cursorId: string | undefined } | null => {
  const rawLimit = req.query.limit;
  const rawCursor = req.query.cursor;

  const take = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);

  if (!Number.isInteger(take) || take < 1 || take > MAX_LIMIT) {
    res.status(400).json({
      error: 'Bad Request',
      message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
      requestId: req.requestId,
    });
    return null;
  }

  const cursorId =
    rawCursor !== undefined ? String(rawCursor) : undefined;

  if (cursorId !== undefined && !UUID_RE.test(cursorId)) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'cursor must be a valid UUID',
      requestId: req.requestId,
    });
    return null;
  }

  return { take, skip: cursorId ? 1 : 0, cursorId };
};

/** Reject requests where a required Stellar wallet address is malformed. */
export const requireStellarAddress = (
  address: string,
  field: string,
  req: Request,
  res: Response,
): boolean => {
  if (!STELLAR_ADDRESS_RE.test(address)) {
    res.status(400).json({
      error: 'Bad Request',
      message: `${field} must be a valid Stellar public key (G…, 56 chars)`,
      requestId: req.requestId,
    });
    return false;
  }
  return true;
};

/** Validate page-based pagination params. */
export const parsePagePagination = (
  req: Request,
  res: Response,
): { page: number; limitNum: number } | null => {
  const rawPage = req.query.page ?? '1';
  const rawLimit = req.query.limit ?? String(DEFAULT_LIMIT);

  const page = Number(rawPage);
  const limitNum = Number(rawLimit);

  if (!Number.isInteger(page) || page < 1) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'page must be a positive integer',
      requestId: req.requestId,
    });
    return null;
  }

  if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > MAX_LIMIT) {
    res.status(400).json({
      error: 'Bad Request',
      message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
      requestId: req.requestId,
    });
    return null;
  }

  return { page, limitNum };
};

/** Middleware factory — reject requests with unknown extra body fields. */
export const bodyFields =
  (allowed: string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const extra = Object.keys(req.body ?? {}).filter((k) => !allowed.includes(k));
    if (extra.length > 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Unexpected fields: ${extra.join(', ')}`,
        requestId: req.requestId,
      });
      return;
    }
    next();
  };
