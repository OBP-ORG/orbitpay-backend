import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const id = (req.headers['x-request-id'] as string) ?? randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};
