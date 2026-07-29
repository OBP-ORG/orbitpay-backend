"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyJwt = exports.signJwt = void 0;
const crypto_1 = require("crypto");
const config_1 = require("../config");
const base64url = (buf) => Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const sign = (data) => base64url((0, crypto_1.createHmac)('sha256', config_1.config.jwtSecret).update(data).digest());
const signJwt = (claims) => {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
        sub: claims.sub,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + config_1.config.jwtTtlSeconds,
    }));
    const sig = sign(`${header}.${payload}`);
    return `${header}.${payload}.${sig}`;
};
exports.signJwt = signJwt;
const verifyJwt = (token) => {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const [header, payload, sig] = parts;
        const expected = sign(`${header}.${payload}`);
        // Constant-time comparison to prevent timing attacks
        if (!(0, crypto_1.timingSafeEqual)(Buffer.from(sig), Buffer.from(expected)))
            return null;
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (decoded.exp < Math.floor(Date.now() / 1000))
            return null;
        return decoded;
    }
    catch {
        return null;
    }
};
exports.verifyJwt = verifyJwt;
