"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.notFound = void 0;
const logger_1 = require("../lib/logger");
const notFound = (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `${req.method} ${req.path} does not exist`,
        requestId: req.requestId,
    });
};
exports.notFound = notFound;
const errorHandler = (err, req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
_next) => {
    logger_1.logger.error(req, 'Unhandled error', err instanceof Error ? err.message : err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred.',
        requestId: req.requestId,
    });
};
exports.errorHandler = errorHandler;
