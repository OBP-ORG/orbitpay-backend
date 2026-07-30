"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeFailures = exports.eventsProcessed = exports.retriesTotal = exports.failuresTotal = exports.lagSeconds = exports.indexedLedger = exports.observedLedger = exports.registry = void 0;
const prom_client_1 = require("prom-client");
exports.registry = new prom_client_1.Registry();
exports.observedLedger = new prom_client_1.Gauge({
    name: 'orbitpay_indexer_observed_ledger',
    help: 'Latest ledger sequence observed from RPC',
    registers: [exports.registry],
});
exports.indexedLedger = new prom_client_1.Gauge({
    name: 'orbitpay_indexer_indexed_ledger',
    help: 'Latest ledger sequence successfully indexed',
    registers: [exports.registry],
});
exports.lagSeconds = new prom_client_1.Gauge({
    name: 'orbitpay_indexer_lag_seconds',
    help: 'Time in seconds the indexer is behind the chain tip',
    registers: [exports.registry],
});
exports.failuresTotal = new prom_client_1.Counter({
    name: 'orbitpay_indexer_failures_total',
    help: 'Total number of indexer poll failures',
    registers: [exports.registry],
});
exports.retriesTotal = new prom_client_1.Counter({
    name: 'orbitpay_indexer_retries_total',
    help: 'Total number of indexer poll retries',
    registers: [exports.registry],
});
exports.eventsProcessed = new prom_client_1.Counter({
    name: 'orbitpay_indexer_events_processed_total',
    help: 'Total number of events successfully processed',
    labelNames: ['contract'],
    registers: [exports.registry],
});
exports.decodeFailures = new prom_client_1.Counter({
    name: 'orbitpay_indexer_decode_failures_total',
    help: 'Total number of events that failed decoding',
    labelNames: ['contract'],
    registers: [exports.registry],
});
