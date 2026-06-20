import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

const base64url = (buf: Buffer | string): string =>
  Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const sign = (data: string): string =>
  base64url(createHmac('sha256', config.jwtSecret).update(data).digest());

export const signJwt = (claims: { sub: string }): string => {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: claims.sub,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + config.jwtTtlSeconds,
    }),
  );
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
};

export const verifyJwt = (token: string): JwtPayload | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts as [string, string, string];
    const expected = sign(`${header}.${payload}`);
    // Constant-time comparison to prevent timing attacks
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as JwtPayload;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
};
