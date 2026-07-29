"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCursor = exports.getCursor = exports.getCheckpoint = void 0;
const prisma_1 = require("../prisma");
const redis_1 = require("../redis");
const CHECKPOINT_KEY = 'orbitpay:indexer:checkpoint';
const CURSOR_KEY = 'orbitpay:indexer:cursor';
const getCheckpoint = async () => {
    const state = await prisma_1.prisma.indexerState.findUnique({
        where: { id: 'singleton' }
    });
    return state ? state.lastLedger : null;
};
exports.getCheckpoint = getCheckpoint;
const getCursor = async () => {
    const redis = await (0, redis_1.getRedisClient)();
    return await redis.get(CURSOR_KEY);
};
exports.getCursor = getCursor;
const setCursor = async (cursor) => {
    const redis = await (0, redis_1.getRedisClient)();
    await redis.set(CURSOR_KEY, cursor);
};
exports.setCursor = setCursor;
