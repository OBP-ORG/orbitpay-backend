"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const health_1 = require("./lib/health");
const engine_1 = require("./lib/indexer/engine");
const engine = (0, engine_1.createIndexerEngine)();
const app = (0, express_1.default)();
app.get('/health', async (_req, res) => {
    const baseHealth = await (0, health_1.getHealthCheckResult)('indexer');
    const engineState = engine.getState();
    const status = baseHealth.status === 'ok' && !engineState.lastError ? 'ok' : 'degraded';
    res.status(status === 'ok' ? 200 : 503).json({
        ...baseHealth,
        status,
        indexer: engineState,
    });
});
app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(await engine.getMetrics());
});
const server = app.listen(config_1.config.indexerPort, () => {
    console.log(`OrbitPay indexer is running on port ${config_1.config.indexerPort}`);
    engine.start();
});
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down indexer...');
    engine.stop();
    server.close();
});
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down indexer...');
    engine.stop();
    server.close();
});
