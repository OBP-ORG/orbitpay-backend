import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

export interface ApiError {
  error: string;
  message: string;
  requestId?: string;
}

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    error: 'Not Found',
    message: `${req.method} ${req.path} does not exist`,
    requestId: req.requestId,
  } satisfies ApiError);
};

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  logger.error(req, 'Unhandled error', err instanceof Error ? err.message : err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred.',
    requestId: req.requestId,
  } satisfies ApiError);
};
