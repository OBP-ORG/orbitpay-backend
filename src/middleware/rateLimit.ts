import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { getRedisClient } from '../lib/redis';

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
  violations: number;
}

const inMemoryEntries = new Map<string, RateLimitEntry>();

const getClientIp = (req: Request): string => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0]!.trim();
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
};

const getKey = (req: Request): string => {
  if (config.rateLimit.strategy === 'wallet' && req.walletAddress) {
    return `wallet:${req.walletAddress}`;
  }
  return `ip:${getClientIp(req)}`;
};

const inMemoryRateLimit = (key: string): { allowed: boolean; retryAfter: number } => {
  const now = Date.now();
  const current = inMemoryEntries.get(key);

  if (!current || now - current.windowStartedAt >= config.rateLimit.windowMs) {
    inMemoryEntries.set(key, {
      count: 1,
      windowStartedAt: now,
      blockedUntil: 0,
      violations: current?.violations ?? 0,
    });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((current.blockedUntil - now) / 1000) };
  }

  current.count += 1;

  if (current.count > config.rateLimit.maxRequests) {
    current.violations += 1;
    const backoffMs = config.rateLimit.backoffBaseMs * 2 ** (current.violations - 1);
    current.blockedUntil = now + backoffMs;
    return { allowed: false, retryAfter: Math.ceil(backoffMs / 1000) };
  }

  inMemoryEntries.set(key, current);
  return { allowed: true, retryAfter: 0 };
};

const redisRateLimit = async (key: string): Promise<{ allowed: boolean; retryAfter: number }> => {
  try {
    const redis = await getRedisClient();
    if (!redis.isOpen) {
      return inMemoryRateLimit(key);
    }

    const now = Date.now();
    const windowMs = config.rateLimit.windowMs;
    const maxReq = config.rateLimit.maxRequests;
    const backoffBase = config.rateLimit.backoffBaseMs;

    const countKey = `orbitpay:ratelimit:${key}:count`;
    const windowKey = `orbitpay:ratelimit:${key}:window`;
    const violationsKey = `orbitpay:ratelimit:${key}:violations`;

    const result = await redis.eval(`
      local count_key = KEYS[1]
      local window_key = KEYS[2]
      local violations_key = KEYS[3]
      local max_req = tonumber(ARGV[1])
      local window_ms = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local backoff_base = tonumber(ARGV[4])

      local window_start = redis.call('GET', window_key)
      if not window_start or (now - tonumber(window_start)) >= window_ms then
        redis.call('SET', window_key, now, 'PX', window_ms)
        redis.call('SET', count_key, 1, 'PX', window_ms)
        return {1, 0}
      end

      local count = redis.call('INCR', count_key)
      redis.call('PEXPIRE', count_key, window_ms)

      if count > max_req then
        local violations = redis.call('INCR', violations_key)
        redis.call('PEXPIRE', violations_key, window_ms * 10)
        local backoff = backoff_base * (2 ^ (violations - 1))
        return {0, backoff}
      end

      return {1, 0}
    `, {
      keys: [countKey, windowKey, violationsKey],
      arguments: [maxReq.toString(), windowMs.toString(), now.toString(), backoffBase.toString()],
    });

    const [allowed, backoffMs] = result as [number, number];
    if (allowed === 1) return { allowed: true, retryAfter: 0 };
    return { allowed: false, retryAfter: Math.ceil(backoffMs / 1000) };
  } catch {
    return inMemoryRateLimit(key);
  }
};

export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (req.path === '/health') {
    next();
    return;
  }

  const key = getKey(req);
  const { allowed, retryAfter } = config.rateLimit.useRedis
    ? await redisRateLimit(key)
    : inMemoryRateLimit(key);

  if (!allowed) {
    res.setHeader('Retry-After', retryAfter.toString());
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please retry after the backoff period.',
      retryAfter,
    });
    return;
  }

  next();
};
