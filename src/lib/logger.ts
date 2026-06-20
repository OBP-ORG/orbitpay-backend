import type { Request } from 'express';

type Level = 'info' | 'warn' | 'error';

const emit = (level: Level, requestId: string | undefined, msg: string, meta?: unknown) => {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (requestId) entry.requestId = requestId;
  if (meta !== undefined) entry.meta = meta;
  // eslint-disable-next-line no-console
  console[level === 'info' ? 'log' : level](JSON.stringify(entry));
};

export const logger = {
  info: (req: Request | null, msg: string, meta?: unknown) =>
    emit('info', req?.requestId, msg, meta),
  warn: (req: Request | null, msg: string, meta?: unknown) =>
    emit('warn', req?.requestId, msg, meta),
  error: (req: Request | null, msg: string, meta?: unknown) =>
    emit('error', req?.requestId, msg, meta),
};
