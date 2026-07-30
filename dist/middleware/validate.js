"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bodyFields = exports.parsePagePagination = exports.requireStellarAddress = exports.parsePagination = exports.DEFAULT_LIMIT = exports.MAX_LIMIT = void 0;
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.MAX_LIMIT = 100;
exports.DEFAULT_LIMIT = 10;
/** Validate and coerce ?limit and ?cursor query params. Sends 400 on invalid input. */
const parsePagination = (req, res) => {
    const rawLimit = req.query.limit;
    const rawCursor = req.query.cursor;
    const take = rawLimit === undefined ? exports.DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(take) || take < 1 || take > exports.MAX_LIMIT) {
        res.status(400).json({
            error: 'Bad Request',
            message: `limit must be an integer between 1 and ${exports.MAX_LIMIT}`,
            requestId: req.requestId,
        });
        return null;
    }
    const cursorId = rawCursor !== undefined ? String(rawCursor) : undefined;
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
exports.parsePagination = parsePagination;
/** Reject requests where a required Stellar wallet address is malformed. */
const requireStellarAddress = (address, field, req, res) => {
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
exports.requireStellarAddress = requireStellarAddress;
/** Validate page-based pagination params. */
const parsePagePagination = (req, res) => {
    const rawPage = req.query.page ?? '1';
    const rawLimit = req.query.limit ?? String(exports.DEFAULT_LIMIT);
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
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > exports.MAX_LIMIT) {
        res.status(400).json({
            error: 'Bad Request',
            message: `limit must be an integer between 1 and ${exports.MAX_LIMIT}`,
            requestId: req.requestId,
        });
        return null;
    }
    return { page, limitNum };
};
exports.parsePagePagination = parsePagePagination;
/** Middleware factory — reject requests with unknown extra body fields. */
const bodyFields = (allowed) => (req, res, next) => {
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
exports.bodyFields = bodyFields;
