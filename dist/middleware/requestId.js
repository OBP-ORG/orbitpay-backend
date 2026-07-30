"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestIdMiddleware = void 0;
const crypto_1 = require("crypto");
const requestIdMiddleware = (req, res, next) => {
    const id = req.headers['x-request-id'] ?? (0, crypto_1.randomUUID)();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
};
exports.requestIdMiddleware = requestIdMiddleware;
