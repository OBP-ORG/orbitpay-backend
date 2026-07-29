"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiApp = void 0;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const config_1 = require("./config");
const requestId_1 = require("./middleware/requestId");
const rateLimit_1 = require("./middleware/rateLimit");
const errorHandler_1 = require("./middleware/errorHandler");
const auth_1 = __importDefault(require("./routes/auth"));
const health_1 = __importDefault(require("./routes/health"));
const history_1 = __importDefault(require("./routes/history"));
const proposals_1 = __importDefault(require("./routes/proposals"));
const vesting_1 = __importDefault(require("./routes/vesting"));
const createApiApp = () => {
    const app = (0, express_1.default)();
    // Trust the proxy topology so rate limiting reads real client IPs
    app.set('trust proxy', config_1.config.trustProxy);
    // Serialise Prisma Decimal instances as strings so monetary fields never
    // appear as `{}` in JSON responses (Decimal is not a plain JS number).
    app.set('json replacer', (_key, value) => {
        if (value instanceof client_1.Prisma.Decimal)
            return value.toFixed();
        return value;
    });
    app.use(requestId_1.requestIdMiddleware);
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '64kb' }));
    app.use(rateLimit_1.rateLimitMiddleware);
    // Public routes
    app.use('/health', health_1.default);
    app.use('/auth', auth_1.default);
    // Data routes (public read access; auth required for writes when added)
    app.use('/api/vesting', vesting_1.default);
    app.use('/api/proposals', proposals_1.default);
    app.use('/api', history_1.default);
    // 404 and error handlers must be last
    app.use(errorHandler_1.notFound);
    app.use(errorHandler_1.errorHandler);
    return app;
};
exports.createApiApp = createApiApp;
