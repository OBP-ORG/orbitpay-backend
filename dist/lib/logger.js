"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const emit = (level, requestId, msg, meta) => {
    const entry = {
        ts: new Date().toISOString(),
        level,
        msg,
    };
    if (requestId)
        entry.requestId = requestId;
    if (meta !== undefined)
        entry.meta = meta;
    // eslint-disable-next-line no-console
    console[level === 'info' ? 'log' : level](JSON.stringify(entry));
};
exports.logger = {
    info: (req, msg, meta) => emit('info', req?.requestId, msg, meta),
    warn: (req, msg, meta) => emit('warn', req?.requestId, msg, meta),
    error: (req, msg, meta) => emit('error', req?.requestId, msg, meta),
};
