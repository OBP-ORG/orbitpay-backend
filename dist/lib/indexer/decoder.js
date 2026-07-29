"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEventData = void 0;
const topicToString = (topic) => {
    if (typeof topic === 'string')
        return topic;
    if (typeof topic === 'number')
        return String(topic);
    if (topic && typeof topic === 'object') {
        return JSON.stringify(topic);
    }
    return 'Unknown';
};
const decodeEventData = (event) => {
    try {
        const ledger = typeof event.ledger === 'number'
            ? event.ledger
            : 0;
        const txHash = event.txHash ?? 'unknown';
        const contractId = String(event.contractId ?? 'unknown');
        const rawTopic = event.topic;
        const topic = topicToString(rawTopic);
        const rawValue = event.value;
        let data = {};
        if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
            data = { ...rawValue };
        }
        else if (typeof rawValue === 'string') {
            data = { raw: rawValue };
        }
        const timestamp = event.ledgerClosedAt
            ? Math.floor(new Date(String(event.ledgerClosedAt)).getTime() / 1000)
            : Math.floor(Date.now() / 1000);
        const eventId = event.id ?? `ev-${ledger}-${txHash}`;
        return { eventId, ledger, txHash, contractId, topic, data, timestamp };
    }
    catch {
        return null;
    }
};
exports.decodeEventData = decodeEventData;
