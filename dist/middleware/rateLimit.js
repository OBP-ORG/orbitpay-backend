"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimitMiddleware = void 0;
const config_1 = require("../config");
const redis_1 = require("../lib/redis");
const logger_1 = require("../lib/logger");
const inMemoryEntries = new Map();
const IN_MEMORY_CLEANUP_INTERVAL = 60_000;
const inMemoryCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of inMemoryEntries) {
        if (now - entry.windowStartedAt > config_1.config.rateLimit.windowMs * 2 && entry.blockedUntil < now) {
            inMemoryEntries.delete(key);
        }
    }
}, IN_MEMORY_CLEANUP_INTERVAL);
if (inMemoryCleanupTimer.unref)
    inMemoryCleanupTimer.unref();
const getClientIp = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
};
const getKey = (req) => {
    if (config_1.config.rateLimit.strategy === 'wallet' && req.walletAddress) {
        return `wallet:${req.walletAddress}`;
    }
    return `ip:${getClientIp(req)}`;
};
const inMemoryRateLimit = (key) => {
    const now = Date.now();
    const current = inMemoryEntries.get(key);
    // Safe: Node.js single-threaded event loop prevents concurrent map mutations
    if (!current || now - current.windowStartedAt >= config_1.config.rateLimit.windowMs) {
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
    if (current.count > config_1.config.rateLimit.maxRequests) {
        current.violations += 1;
        const backoffMs = config_1.config.rateLimit.backoffBaseMs * 2 ** (current.violations - 1);
        current.blockedUntil = now + backoffMs;
        return { allowed: false, retryAfter: Math.ceil(backoffMs / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
};
const redisRateLimit = async (key) => {
    try {
        const redis = await (0, redis_1.getRedisClient)();
        if (!redis.isOpen) {
            return inMemoryRateLimit(key);
        }
        const now = Date.now();
        const windowMs = config_1.config.rateLimit.windowMs;
        const maxReq = config_1.config.rateLimit.maxRequests;
        const backoffBase = config_1.config.rateLimit.backoffBaseMs;
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
        redis.call('DEL', violations_key)
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
        const [allowed, backoffMs] = result;
        if (allowed === 1)
            return { allowed: true, retryAfter: 0 };
        return { allowed: false, retryAfter: Math.ceil(backoffMs / 1000) };
    }
    catch (err) {
        logger_1.logger.warn(null, 'Redis rate limit failed, falling back to in-memory', { error: String(err) });
        return inMemoryRateLimit(key);
    }
};
const rateLimitMiddleware = async (req, res, next) => {
    if (req.path === '/health') {
        next();
        return;
    }
    const key = getKey(req);
    const { allowed, retryAfter } = config_1.config.rateLimit.useRedis
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
exports.rateLimitMiddleware = rateLimitMiddleware;
